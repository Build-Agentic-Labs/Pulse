/**
 * Boundary validation for Claude's `emit_sop` tool output.
 *
 * The extract route used to cast `toolUse.input as ExtractedSop` and hope; a model
 * hiccup (wrong-typed scalar, junk array entry, missing section) then crashed the
 * client downstream. This module hand-rolls the coercion (no zod in this project):
 * wrong-typed scalars become strings where sensible, malformed array entries are
 * dropped, missing sections default to empty — mirroring the client-side fallbacks
 * in `sopFromExtraction` — and every string is clamped to a sane cap. Only an
 * unusably malformed payload (not an object / no meaningful content) returns null.
 */

import { RASIC_CODES, type RasicCode, type SopShape } from "./schema";
import type { ExtractedSop } from "./extraction";

/** Cap for short fields: labels, names, roles, dates, meta values. */
const MAX_SHORT_FIELD_CHARS = 2_000;
/** Cap for long prose fields: purpose, scope, flow description, step detail. */
const MAX_BODY_CHARS = 50_000;
/** Cap on entries kept per array — far beyond any real SOP. */
const MAX_ARRAY_ITEMS = 1_000;

const SOP_SHAPES: readonly SopShape[] = ["terminator", "process", "decision"];

type ExtractedActivity = ExtractedSop["procedure"]["activities"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Undo a newline the model escaped twice.
 *
 * Writing multi-paragraph prose into a JSON string field, the model sometimes emits the two
 * characters `\` `n` instead of an escape the JSON decoder consumes. The tool-use input arrives
 * already parsed, so nothing downstream can tell that apart from intended content — the literal
 * flows into the editor and onto the printed controlled document. Observed 2026-07-25 in 3 of 6
 * converted SOPs, all in `purpose` / `scope`; no authored SOP has ever carried one.
 *
 * Once emitted, a literal `\n` is genuinely ambiguous — `C:\network\share` contains one — so this
 * only fires where a backslash sequence CANNOT be content: a paragraph break (`\n\n`), or a break
 * followed by whitespace or a bullet. No Windows path segment starts with a space, a hyphen, or
 * another backslash, which is what makes this deterministic rather than a guess. Every one of the
 * 19 occurrences found in production matched one of these two shapes.
 *
 * A lone `\n` mid-word is left alone on purpose. Under-correcting leaves a visible blemish in a
 * draft someone can fix; over-correcting silently rewrites a path in a controlled document.
 */
function unescapeLiteralNewlines(value: string): string {
  // `(?:\\r)?` — the optional part is the whole two-character `\r`, not a bare `r`. Writing
  // `\\r?\\n` instead would demand TWO backslashes before the n and match nothing real.
  return value
    // Paragraph break, including the CRLF spelling. Collapses to exactly two newlines.
    .replace(/(?:(?:\\r)?\\n){2}/g, "\n\n")
    // Single break introducing a list item or preceding whitespace.
    .replace(/(?:\\r)?\\n(?=[\s\-*•])/g, "\n")
    // Trailing break at the very end of a field.
    .replace(/(?:\\r)?\\n$/, "\n");
}

/** Strings pass through (clamped, newline-normalized); numbers/booleans stringify; else → "". */
function coerceString(value: unknown, maxChars: number = MAX_SHORT_FIELD_CHARS): string {
  if (typeof value === "string") return unescapeLiteralNewlines(value).slice(0, maxChars);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

/** Keeps string/number entries (coerced, non-empty); drops objects, nulls, and the rest. */
function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => coerceString(item))
    .filter((item) => item.length > 0);
}

/** Keeps only plain-object entries of an array (the per-shape coercion runs after). */
function coerceRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, MAX_ARRAY_ITEMS);
}

function coerceMeta(value: unknown): ExtractedSop["meta"] {
  const raw = isRecord(value) ? value : {};
  return {
    sopNumber: coerceString(raw.sopNumber),
    title: coerceString(raw.title),
    version: coerceString(raw.version),
    revisionDate: coerceString(raw.revisionDate),
    effectiveDate: coerceString(raw.effectiveDate),
  };
}

function coerceShape(value: unknown): SopShape | undefined {
  return typeof value === "string" && (SOP_SHAPES as readonly string[]).includes(value)
    ? (value as SopShape)
    : undefined;
}

/** Keeps role → code pairs whose code normalizes to a valid RASIC letter; drops the rest. */
function coerceAssignments(value: unknown): Record<string, RasicCode> {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, RasicCode>>((assignments, [role, code]) => {
    const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
    if (!role || !(RASIC_CODES as readonly string[]).includes(normalized)) {
      return assignments;
    }
    return { ...assignments, [role.slice(0, MAX_SHORT_FIELD_CHARS)]: normalized as RasicCode };
  }, {});
}

function coerceActivity(raw: Record<string, unknown>, index: number): ExtractedActivity {
  const step = typeof raw.step === "number" ? raw.step : Number(raw.step);
  return {
    // sopFromExtraction falls back to index+1 for a falsy step; do the same here so a
    // string/garbage step can't leak NaN into the document.
    step: Number.isFinite(step) && step > 0 ? Math.floor(step) : index + 1,
    shape: coerceShape(raw.shape),
    input: coerceString(raw.input),
    description: coerceString(raw.description),
    detail: coerceString(raw.detail, MAX_BODY_CHARS),
    output: coerceString(raw.output),
    assignments: coerceAssignments(raw.assignments),
  };
}

function coerceDefinitions(value: unknown): ExtractedSop["definitions"] {
  return coerceRecordArray(value)
    .map((raw) => ({ term: coerceString(raw.term), definition: coerceString(raw.definition, MAX_BODY_CHARS) }))
    .filter((entry) => entry.term.length > 0 || entry.definition.length > 0);
}

function coerceAnnexes(value: unknown): ExtractedSop["annexes"] {
  return coerceRecordArray(value)
    .map((raw) => ({ label: coerceString(raw.label), description: coerceString(raw.description, MAX_BODY_CHARS) }))
    .filter((entry) => entry.label.length > 0 || entry.description.length > 0);
}

function coerceChangeHistory(value: unknown): ExtractedSop["changeHistory"] {
  return coerceRecordArray(value)
    .map((raw) => ({
      version: coerceString(raw.version),
      changes: coerceString(raw.changes, MAX_BODY_CHARS),
      createdByName: coerceString(raw.createdByName),
      createdByPosition: coerceString(raw.createdByPosition),
      createdByDate: coerceString(raw.createdByDate),
    }))
    .filter((entry) => Object.values(entry).some((field) => field.length > 0));
}

function coerceApprovals(value: unknown): ExtractedSop["approvals"] {
  return coerceRecordArray(value)
    .map((raw) => ({
      role: coerceString(raw.role),
      name: coerceString(raw.name),
      position: coerceString(raw.position),
      date: coerceString(raw.date),
      // A hint, not a fact: mapApprovalsToDepartments resolves it against the workspace's real
      // departments and drops it when it matches none.
      department: coerceString(raw.department),
    }))
    .filter((entry) => Object.values(entry).some((field) => field.length > 0));
}

function coerceProcedure(value: unknown): ExtractedSop["procedure"] {
  const raw = isRecord(value) ? value : {};
  return {
    processFlowDescription: coerceString(raw.processFlowDescription, MAX_BODY_CHARS),
    roles: coerceStringArray(raw.roles),
    activities: coerceRecordArray(raw.activities)
      .map(coerceActivity)
      // A step with no text at all renders an empty flowchart box; drop it.
      .filter((activity) => activity.description.length > 0 || (activity.detail?.length ?? 0) > 0),
  };
}

/** A payload that coerces to nothing at all isn't worth returning to the editor. */
function hasMeaningfulContent(sop: ExtractedSop): boolean {
  return Boolean(
    sop.meta.title ||
      sop.meta.sopNumber ||
      sop.purpose ||
      sop.scope ||
      sop.procedure.activities.length > 0,
  );
}

/**
 * Coerce Claude's raw tool input into a well-formed `ExtractedSop`.
 * Returns `null` when the payload is unusably malformed (not an object, or empty of
 * any meaningful content after coercion) — the route maps that to a 502.
 */
export function validateExtractedSop(input: unknown): ExtractedSop | null {
  if (!isRecord(input)) {
    return null;
  }

  const sop: ExtractedSop = {
    meta: coerceMeta(input.meta),
    purpose: coerceString(input.purpose, MAX_BODY_CHARS),
    scope: coerceString(input.scope, MAX_BODY_CHARS),
    definitions: coerceDefinitions(input.definitions),
    responsiblePersons: coerceStringArray(input.responsiblePersons),
    references: coerceStringArray(input.references),
    measurements: coerceStringArray(input.measurements),
    procedure: coerceProcedure(input.procedure),
    annexes: coerceAnnexes(input.annexes),
    changeHistory: coerceChangeHistory(input.changeHistory),
    approvals: coerceApprovals(input.approvals),
  };

  return hasMeaningfulContent(sop) ? sop : null;
}
