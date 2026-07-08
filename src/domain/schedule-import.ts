// Schedule-import resolution: pure logic that turns a production-schedule line into a
// GEN/PM/TRL work-order set (or a specific, actionable flag). No I/O — the importer and the
// dry-run validator both call these. See docs/superpowers/specs/2026-07-07-schedule-import-hardening.md.

/** What a MODEL TYPE string denotes. Only `hybrid` needs customer-scoped template resolution. */
export type ModelKind = "hybrid" | "power_module" | "trailer" | "other" | "blank";

export interface ParsedModel {
  kind: ModelKind;
  /** Hybrid only: the `{A}-{B}` combo (first two numbers of the (E)BOSS name). */
  combo?: string;
  /** Hybrid + standalone PM: the power-module size (`{A}`). */
  pmSize?: string;
  /** Hybrid only: the SDG generator size (`{B}`). */
  genSize?: string;
  /** Trailer only: the SDG size on the trailer line. */
  trailerSize?: string;
  raw: string;
}

/**
 * Classify a MODEL TYPE string. Per the (E)BOSS nomenclature, `(E)BOSS{A}-{B}` is a hybrid
 * whose PM is `{A}` and generator is SDG`{B}`; a name with a size but no dash and a PM marker
 * is a standalone power module; an `SDG… TRAILER/TRLR` is a trailer. Everything else is `other`.
 */
export function parseModel(model: string): ParsedModel {
  const raw = model ?? "";
  const text = raw.trim();
  if (!text) {
    return { kind: "blank", raw };
  }

  const hybrid = /\bE?BOSS\s*(\d+)-(\d+)/i.exec(text);
  if (hybrid) {
    const [pmSize, genSize] = [hybrid[1], hybrid[2]];
    return { kind: "hybrid", combo: `${pmSize}-${genSize}`, pmSize, genSize, raw };
  }

  // PM / TRLR markers may be glued to the size (e.g. "BOSS400PM", "SDG150TRLR") — the shop's own
  // template library uses those spellings — so we do not require a leading word boundary.
  if (/PM\b|power\s*module/i.test(text)) {
    const size = /(\d+)/.exec(text)?.[1];
    return { kind: "power_module", pmSize: size, raw };
  }

  if (/trailer|trlr/i.test(text)) {
    const size = /(\d+)/.exec(text)?.[1];
    return { kind: "trailer", trailerSize: size, raw };
  }

  return { kind: "other", raw };
}

/** The canonical customer + the template suffix it maps to. */
export interface CustomerIdentity {
  canonical: string;
  /** Upper-case template suffix, e.g. "ES", "HERC". Compared case-insensitively against template names. */
  suffix: string;
}

/** Squash to upper-case alphanumerics so spelling/punctuation/spacing differences collapse. */
function squash(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** Upper-case alphanumeric word tokens (split on any non-alphanumeric run). */
function words(value: string): string[] {
  return value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

/**
 * Ordered customer-normalization rules (W4). Each rule sees both the squashed string and its word
 * tokens. Long, distinctive names match as a substring (safe); short ambiguous suffixes (HERC,
 * REIC, OES, CAT) match only as a WHOLE WORD so contaminated free text still resolves the real
 * customer ("IWCE tradeshow/ OES…" → OES; "Quinn CAT - DUE BY 6/29" → CAT) without a fragment of
 * an unrelated word firing a false positive ("DOES"↛OES, "HERCULES"↛HERC, "Bobcat"↛CAT).
 * First match wins.
 */
const CUSTOMER_RULES: ReadonlyArray<{
  suffix: string;
  canonical: string;
  match: (squashed: string, tokens: string[]) => boolean;
}> = [
  { suffix: "ES", canonical: "Equipment Share", match: (s) => s.includes("EQUIPMENTSHARE") },
  { suffix: "UR", canonical: "United Rentals", match: (s) => s.includes("UNITEDRENTAL") },
  { suffix: "KIEWIT", canonical: "Kiewit", match: (_s, t) => t.includes("KIEWIT") },
  { suffix: "PEAK", canonical: "Peak", match: (_s, t) => t.includes("PEAK") },
  { suffix: "T-MOBILE", canonical: "T-Mobile", match: (s) => s.includes("TMOBILE") },
  { suffix: "HERC", canonical: "Herc Rentals", match: (_s, t) => t.includes("HERC") },
  { suffix: "REIC", canonical: "REIC", match: (_s, t) => t.includes("REIC") },
  { suffix: "OES", canonical: "OES", match: (_s, t) => t.includes("OES") },
  { suffix: "CAT", canonical: "CAT dealer", match: (_s, t) => t.includes("CAT") },
];

/**
 * Normalize a CUSTOMER NAME to its canonical form + template suffix, or null when the value is
 * blank or not a real customer (location text like "SACRAMENTO"). Only hybrid lines need this —
 * PM/trailer/standalone builds are customer-agnostic.
 */
export function normalizeCustomer(raw: string): CustomerIdentity | null {
  const squashed = squash(raw ?? "");
  if (!squashed) {
    return null;
  }
  const tokens = words(raw ?? "");
  const rule = CUSTOMER_RULES.find((candidate) => candidate.match(squashed, tokens));
  return rule ? { canonical: rule.canonical, suffix: rule.suffix } : null;
}

export type TrailerLetter = "E" | "S";

/**
 * Normalize a BRAKE TYPE string to a trailer config letter, or "none" (PM lines / not applicable).
 * Only two trailers exist: E = Electric, S = Surge / Hydraulic. Plain "Hydraulic" folds into S.
 */
export function normalizeBrake(raw: string): TrailerLetter | "none" {
  const squashed = squash(raw ?? "");
  if (squashed.startsWith("ELECTRIC")) {
    return "E";
  }
  if (squashed.includes("SURGE") || squashed.includes("HYDRAULIC")) {
    return "S";
  }
  return "none";
}

/**
 * Clean a SO# value: extract the sales order (dropping trailing transfer text like " TO5745"),
 * keep a bare transfer order as-is (trailer stock), and flag NEED/blank as a missing SO.
 */
export function cleanSo(raw: string): { so: string; flag: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || /^need\b/i.test(trimmed)) {
    return { so: "", flag: true };
  }
  const salesOrder = /S-?ORD\s*\d+/i.exec(trimmed);
  if (salesOrder) {
    return { so: salesOrder[0].replace(/\s+/g, ""), flag: false };
  }
  return { so: trimmed, flag: false };
}

/** Whether an assembly-order value is entered (`A#####`) or still needs one (NEED…/blank). */
export function aoStatus(raw: string): "ok" | "flag" {
  return /^A\d/i.test((raw ?? "").trim()) ? "ok" : "flag";
}

// ── Template index (built from the current template inventory) ──────────────

/**
 * Parse a generator template NAME into its combo + customer suffix, or null if the name is not a
 * generator template (mocks, junk). Names are the authoritative source — `HEAD UNIT {combo} {suffix}`,
 * optionally `BOSS`-prefixed, with an empty suffix meaning a combo-generic template. The template's
 * `model` column is unreliable (some disagree with the name) so it is not used here.
 */
export function parseGenTemplateName(name: string): { combo: string; suffix: string } | null {
  const match = /^HEAD UNIT\s+(?:E?BOSS)?(\d+-\d+)\s*(.*)$/i.exec((name ?? "").trim());
  if (!match) {
    return null;
  }
  return { combo: match[1], suffix: match[2].trim() };
}

/** The `{A}-{B}` combo carried by a template's `model` column, or null (first two numbers). */
function comboFromModel(model: string): string | null {
  const match = /(\d+)-(\d+)/.exec(model ?? "");
  return match ? `${match[1]}-${match[2]}` : null;
}

/** Read a power-module size from a PM template's model or name (`BOSS220 PM` / `HEAD UNIT 70PM`). */
export function parsePmSize(text: string): string | null {
  return /(\d+)\s*PM\b/i.exec(text ?? "")?.[1] ?? null;
}

/** A raw work-order-template row as returned by the DB. */
export interface TemplateRow {
  id: string;
  name: string;
  model: string;
  order_type: string;
}

/**
 * Build the resolver's `TemplateIndex` from raw template rows + the configured trailer letters.
 * Generator rows whose names don't parse (mocks, one-offs) and PM rows without a size are skipped,
 * so junk in the library never becomes a phantom template match.
 */
export function buildTemplateIndex(rows: readonly TemplateRow[], trailerLetters: readonly string[]): TemplateIndex {
  const gens: TemplateIndexGen[] = [];
  const pms: TemplateIndexPm[] = [];
  for (const row of rows) {
    if (row.order_type === "head_unit") {
      const parsed = parseGenTemplateName(row.name);
      if (parsed) {
        const modelCombo = comboFromModel(row.model);
        const modelMismatch = modelCombo !== null && modelCombo !== parsed.combo;
        gens.push({ id: row.id, combo: parsed.combo, suffix: parsed.suffix, modelMismatch });
      }
    } else if (row.order_type === "power_module") {
      const size = parsePmSize(row.model) ?? parsePmSize(row.name);
      if (size) pms.push({ id: row.id, size });
    }
  }
  return { gens, pms, trailerLetters: new Set(trailerLetters) };
}

/**
 * A production-schedule sheet has category divider rows (a `PLANNED WEEKLY BUILDS` label like
 * "TRAILERS" or "STOCK", no unit data). Such a row carries no MODEL/SO/CUSTOMER/A# and must be
 * skipped, not imported. A blank model WITH unit data present is a real line (flagged), not a divider.
 */
export function isSectionHeaderRow(fields: { model: string; so: string; customer: string; fgAo: string }): boolean {
  return !fields.model.trim() && !fields.so.trim() && !fields.customer.trim() && !fields.fgAo.trim();
}

// ── Line resolution ─────────────────────────────────────────────────────────
// The importer's core lookup: a schedule line + the current template inventory → a complete
// set (gen + PM template, trailer letter, AO status) or an enumerated, actionable flag.

/** A generator (head_unit) template keyed by its combo + customer suffix. */
export interface TemplateIndexGen {
  id: string;
  combo: string;
  /** Customer suffix (e.g. "ES"); compared case-insensitively against the normalized customer. */
  suffix: string;
  /** True when the template's name combo disagrees with its `model` column (a data bug to surface). */
  modelMismatch?: boolean;
}

/** A power-module template keyed by its size (`{A}` of the combo). */
export interface TemplateIndexPm {
  id: string;
  size: string;
}

/** The current template inventory the resolver looks up against. */
export interface TemplateIndex {
  gens: readonly TemplateIndexGen[];
  pms: readonly TemplateIndexPm[];
  /** Configured trailer config letters (e.g. {"E","S"}). */
  trailerLetters: ReadonlySet<string>;
}

/** The relevant raw fields of one production-schedule row. */
export interface ScheduleLineInput {
  model: string;
  customer: string;
  brake: string;
  fgAo: string;
}

export type FlagCode =
  | "blank-model"
  | "unrecognized-model"
  | "unknown-customer"
  | "no-gen-template-for-combo"
  | "no-template-for-customer"
  | "pm-template-missing"
  | "template-model-mismatch"
  | "trailer-letter-unspecified"
  | "trailer-config-missing"
  | "ao-to-enter";

/** A specific, actionable reason a line did not resolve cleanly. `blocking` prevents set creation. */
export interface ResolutionFlag {
  code: FlagCode;
  blocking: boolean;
  detail: string;
}

export interface LineResolution {
  status: "resolved" | "flagged";
  kind: ModelKind;
  combo?: string;
  customer: CustomerIdentity | null;
  trailerLetter: TrailerLetter | "none";
  /** Trailer stock lines: the SDG size to build (e.g. "150"), so the importer picks the right trailer. */
  trailerSize?: string;
  genTemplateId?: string;
  pmTemplateId?: string;
  aoOk: boolean;
  flags: readonly ResolutionFlag[];
}

const advisory = (code: FlagCode, detail: string): ResolutionFlag => ({ code, blocking: false, detail });
const blocking = (code: FlagCode, detail: string): ResolutionFlag => ({ code, blocking: true, detail });

/**
 * Resolve one schedule line against the template inventory. A line is `resolved` when a complete
 * set/order can be built (advisory flags like a missing A# are allowed) and `flagged` when a
 * blocking reason prevents it. Encodes the shop decisions: 25-25 is a GEN+PM set (needs a 25 PM
 * template), unauthored PM sizes flag rather than guess, and an unmatched customer variant is a
 * hard flag (no combo-generic fallback).
 */
export function resolveLine(line: ScheduleLineInput, index: TemplateIndex): LineResolution {
  const parsed = parseModel(line.model);
  const aoOk = aoStatus(line.fgAo) === "ok";
  const flags: ResolutionFlag[] = [];
  const result: Omit<LineResolution, "status"> = {
    kind: parsed.kind,
    customer: null,
    trailerLetter: "none",
    aoOk,
    flags,
  };

  const findPm = (size: string | undefined) => index.pms.find((pm) => pm.size === size);
  const aoFlag = () => {
    if (!aoOk) flags.push(advisory("ao-to-enter", "assembly A# to enter"));
  };
  // A resolved E/S letter that the trailer catalog doesn't contain would dangle — surface it.
  const trailerConfigFlag = (letter: TrailerLetter | "none") => {
    if (letter !== "none" && !index.trailerLetters.has(letter)) {
      flags.push(advisory("trailer-config-missing", `trailer config "${letter}" is not in the catalog`));
    }
  };
  const finalize = (partial: Omit<LineResolution, "status">): LineResolution => ({
    ...partial,
    flags: [...flags],
    status: flags.some((flag) => flag.blocking) ? "flagged" : "resolved",
  });

  if (parsed.kind === "blank") {
    flags.push(blocking("blank-model", "empty MODEL TYPE"));
    return finalize(result);
  }
  if (parsed.kind === "other") {
    flags.push(blocking("unrecognized-model", `"${parsed.raw}" is not a GEN/PM/TRL set product`));
    return finalize(result);
  }

  if (parsed.kind === "trailer") {
    const letter = normalizeBrake(line.brake);
    if (letter === "none") {
      flags.push(advisory("trailer-letter-unspecified", "trailer stock line without an E/S brake — planner picks config"));
    }
    trailerConfigFlag(letter);
    aoFlag();
    return finalize({ ...result, trailerLetter: letter, trailerSize: parsed.trailerSize });
  }

  if (parsed.kind === "power_module") {
    const pm = findPm(parsed.pmSize);
    aoFlag();
    if (!pm) flags.push(blocking("pm-template-missing", `${parsed.pmSize} PM template not authored`));
    return finalize({ ...result, pmTemplateId: pm?.id });
  }

  // hybrid: GEN template (combo + customer) + PM template (size) + trailer letter (from brake).
  const customer = normalizeCustomer(line.customer);
  const letter = normalizeBrake(line.brake);
  let genTemplateId: string | undefined;

  if (!customer) {
    flags.push(blocking("unknown-customer", `CUSTOMER "${line.customer}" not recognized`));
  } else {
    const comboGens = index.gens.filter((gen) => gen.combo === parsed.combo);
    const exact = comboGens.find((gen) => gen.suffix.toUpperCase() === customer.suffix.toUpperCase());
    if (exact) {
      genTemplateId = exact.id;
      if (exact.modelMismatch) {
        flags.push(
          advisory(
            "template-model-mismatch",
            `template for combo ${parsed.combo}/${customer.suffix} has a model column that disagrees with its name — verify its BOM before building`,
          ),
        );
      }
    } else if (comboGens.length === 0) {
      flags.push(blocking("no-gen-template-for-combo", `no generator template for combo ${parsed.combo}`));
    } else {
      const variants = comboGens.map((g) => g.suffix).filter(Boolean);
      const detail =
        variants.length === 0
          ? `combo ${parsed.combo} has only a generic template, no ${customer.suffix} variant`
          : `combo ${parsed.combo} has no ${customer.suffix} variant (have: ${variants.join(", ")})`;
      flags.push(blocking("no-template-for-customer", detail));
    }
  }

  const pm = findPm(parsed.pmSize);
  if (!pm) flags.push(blocking("pm-template-missing", `${parsed.pmSize} PM template not authored`));
  if (letter === "none") {
    flags.push(advisory("trailer-letter-unspecified", "no E/S brake — planner picks trailer config"));
  }
  trailerConfigFlag(letter);
  aoFlag();

  return finalize({ ...result, combo: parsed.combo, customer, trailerLetter: letter, genTemplateId, pmTemplateId: pm?.id });
}
