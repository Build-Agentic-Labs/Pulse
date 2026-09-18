/**
 * Work instruction document control — the pure half.
 *
 * A work instruction is generated live from a planner task. A RELEASE freezes that built document
 * as an immutable snapshot with its own revision letter; everything the sheet's header shows about
 * control (revision, effective date, revision history, prepared/approved by) is derived from the
 * release rows here, never typed.
 *
 * No React, no Supabase, no clocks (callers pass `now`).
 * Spec: docs/superpowers/specs/2026-09-18-work-instruction-release-design.md
 */

import type { WorkInstruction, WorkInstructionMeta, WorkInstructionRevision } from "./schema";

/** A release without its frozen document — all the list and the header need. */
export interface WorkInstructionReleaseSummary {
  id: string;
  taskId: string;
  /** 1-based; 1 is Rev A. Assigned by the database. */
  revisionIndex: number;
  /** "A", "B", ... "Z", "AA". Assigned by the database. */
  revision: string;
  documentNumber: string;
  title: string;
  changeDescription: string;
  /** Date only, YYYY-MM-DD. */
  effectiveDate: string;
  contentHash: string;
  /** The same fingerprint with photos left out; see `fingerprintWorkInstruction`. */
  textHash: string;
  releasedBy: string;
  releasedByName: string;
  releasedAt: string;
}

export interface WorkInstructionRelease extends WorkInstructionReleaseSummary {
  /** The default-layout build at release time, with no control meta (see `snapshotForRelease`). */
  content: WorkInstruction;
}

/** 1 -> A, 26 -> Z, 27 -> AA. Mirrors work_instruction_revision_letter() in the database. */
export function revisionLetter(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("Revision index must be a whole number, 1 or greater.");
  }
  let remaining = index;
  let letters = "";
  while (remaining > 0) {
    remaining -= 1;
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26);
  }
  return letters;
}

export function revisionLabel(letter: string): string {
  return letter ? `Rev ${letter}` : "";
}

function byRevision(left: WorkInstructionReleaseSummary, right: WorkInstructionReleaseSummary): number {
  return left.revisionIndex - right.revisionIndex;
}

export function latestRelease<T extends WorkInstructionReleaseSummary>(releases: readonly T[]): T | undefined {
  return [...releases].sort(byRevision).at(-1);
}

/** The letter the NEXT release will get — a preview only; the database decides for real. */
export function nextRevisionLetter(releases: readonly WorkInstructionReleaseSummary[]): string {
  return revisionLetter((latestRelease(releases)?.revisionIndex ?? 0) + 1);
}

/** Deterministic JSON: object keys sorted, `undefined` dropped, arrays in order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/** cyrb53 — a fast 53-bit string hash. Drift detection only; never a security boundary. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * A fingerprint of everything the operator reads, and nothing else.
 *
 * Deliberately EXCLUDES the control meta (a release must not change its own fingerprint) and every
 * photo URL or storage path (signed URLs rotate, and a release re-points photos at frozen copies).
 * A photo is identified by its id, caption and annotations.
 *
 * Callers must pass a DEFAULT-LAYOUT build: cards are split per layout, so a 6-up build of the
 * same task fingerprints differently.
 *
 * `photos: false` leaves photos out entirely. The planner loads a task's photos lazily, so the
 * work instruction LIST usually holds tasks without them; it compares this photo-free
 * fingerprint, and the preview and release dialog (which load the photos) compare the full one.
 */
export function fingerprintWorkInstruction(instruction: WorkInstruction, options: { photos?: boolean } = {}): string {
  const includePhotos = options.photos !== false;
  const comparable = {
    documentNumber: instruction.meta.documentNumber,
    title: instruction.meta.title,
    context: instruction.context,
    setup: instruction.setup,
    cards: instruction.cards.map((card) => ({
      ...card,
      photo: includePhotos && card.photo
        ? {
            id: card.photo.id,
            caption: card.photo.caption,
            width: card.photo.width,
            height: card.photo.height,
            annotations: card.photo.annotations,
          }
        : undefined,
    })),
  };
  return `v1:${cyrb53(stableStringify(comparable))}`;
}

const EMPTY_CONTROL_META: Pick<
  WorkInstructionMeta,
  "revision" | "effectiveDate" | "preparedBy" | "reviewedBy" | "approvedBy" | "revisionHistory"
> = {
  revision: "",
  effectiveDate: "",
  preparedBy: "",
  reviewedBy: "",
  approvedBy: "",
  revisionHistory: [],
};

/**
 * The document as it is stored in a release.
 *
 * - Control meta is blanked: it is re-derived from the release rows at render time, so the stored
 *   content never disagrees with them.
 * - A photo with a storage path drops its signed `url` (it would be expired by the time anyone
 *   opens the release; the renderer re-signs from the path). `frozenPhotoPaths` re-points photos
 *   at the release's own copies so deleting a step photo later cannot break a released document.
 */
export function snapshotForRelease(
  instruction: WorkInstruction,
  frozenPhotoPaths: ReadonlyMap<string, string> = new Map(),
): WorkInstruction {
  return {
    ...instruction,
    meta: { ...instruction.meta, ...EMPTY_CONTROL_META },
    cards: instruction.cards.map((card) => {
      if (!card.photo) return card;
      const storagePath = frozenPhotoPaths.get(card.photo.id) ?? card.photo.storagePath;
      return { ...card, photo: storagePath ? { ...card.photo, storagePath, url: "" } : card.photo };
    }),
  };
}

/**
 * `formatDateControlled` parses with `new Date(iso)`, and a bare YYYY-MM-DD parses as UTC midnight
 * — which prints as the PREVIOUS day anywhere west of Greenwich. Anchoring the date at local noon
 * keeps the printed day equal to the day that was chosen.
 */
function controlledDate(dateOnly: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? `${dateOnly}T12:00:00` : dateOnly;
}

function historyThrough(
  releases: readonly WorkInstructionReleaseSummary[],
  through?: WorkInstructionReleaseSummary,
): WorkInstructionRevision[] {
  return [...releases]
    .sort(byRevision)
    .filter((release) => !through || release.revisionIndex <= through.revisionIndex)
    .map((release) => ({
      revision: release.revision,
      date: controlledDate(release.effectiveDate),
      description: release.changeDescription,
      author: release.releasedByName,
    }));
}

export type WorkInstructionReleaseState =
  | { kind: "unreleased" }
  | { kind: "released"; release: WorkInstructionReleaseSummary }
  | { kind: "modified"; release: WorkInstructionReleaseSummary };

/**
 * Where a live (default-layout) build stands against its releases. Pass `photosLoaded: false`
 * when the task's photos have not been loaded, so their absence is not mistaken for a change.
 */
export function releaseStateFor(
  instruction: WorkInstruction,
  releases: readonly WorkInstructionReleaseSummary[],
  options: { photosLoaded?: boolean } = {},
): WorkInstructionReleaseState {
  const latest = latestRelease(releases);
  if (!latest) return { kind: "unreleased" };
  const photosLoaded = options.photosLoaded !== false;
  // A release from before text_hash existed has none; fall back to the full fingerprint.
  const expected = photosLoaded || !latest.textHash ? latest.contentHash : latest.textHash;
  const comparePhotos = photosLoaded || !latest.textHash;
  return expected === fingerprintWorkInstruction(instruction, { photos: comparePhotos })
    ? { kind: "released", release: latest }
    : { kind: "modified", release: latest };
}

/**
 * Control meta for a LIVE build. When it still matches its latest release it carries that
 * release's revision and effective date; otherwise it is marked as a draft, with the history of
 * what has been released so far. For now the releasing author both prepares and approves.
 */
export function withReleaseMeta(
  instruction: WorkInstruction,
  releases: readonly WorkInstructionReleaseSummary[],
  state: WorkInstructionReleaseState,
): WorkInstruction {
  if (instruction.blank && releases.length === 0) return instruction;
  const released = state.kind === "released" ? state.release : undefined;
  return {
    ...instruction,
    meta: {
      ...instruction.meta,
      revision: released ? revisionLabel(released.revision) : "Draft",
      effectiveDate: released ? controlledDate(released.effectiveDate) : "",
      preparedBy: released?.releasedByName ?? "",
      reviewedBy: "",
      approvedBy: released?.releasedByName ?? "",
      revisionHistory: historyThrough(releases),
    },
  };
}

/** A release rendered exactly as it was released: frozen content, history up to that revision. */
export function releasedDocument(
  release: WorkInstructionRelease,
  releases: readonly WorkInstructionReleaseSummary[],
): WorkInstruction {
  return {
    ...release.content,
    meta: {
      ...release.content.meta,
      revision: revisionLabel(release.revision),
      effectiveDate: controlledDate(release.effectiveDate),
      preparedBy: release.releasedByName,
      reviewedBy: "",
      approvedBy: release.releasedByName,
      revisionHistory: historyThrough(releases, release),
    },
  };
}

export interface ReleaseReadiness {
  /** Reasons the document cannot be released yet. */
  blocking: string[];
  /** Worth a look, but the author may release anyway. */
  warnings: string[];
}

/**
 * Step numbers as a short readable list: consecutive runs collapse to ranges, so 19 steps read as
 * "2–12, 14–16, 18–20" instead of a wall of numbers.
 */
export function formatStepNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((left, right) => left - right);
  const runs: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index];
    }
    // A run of two reads better as "4, 5" than "4–5".
    runs.push(end === start ? String(start) : end === start + 1 ? `${start}, ${end}` : `${start}–${end}`);
  }
  return runs.join(", ");
}

function stepsPhrase(numbers: readonly number[]): string {
  return `${new Set(numbers).size === 1 ? "Step" : "Steps"} ${formatStepNumbers(numbers)}`;
}

/**
 * What stands between this (default-layout) build and a release. Pass `photosLoaded: false` while
 * the task's photos are still loading, so their absence is not reported as missing photos.
 */
export function releaseReadiness(instruction: WorkInstruction, options: { photosLoaded?: boolean } = {}): ReleaseReadiness {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const firstCards = instruction.cards.filter((card) => card.part === 1);

  if (firstCards.length === 0) blocking.push("Add at least one step.");
  if (!instruction.meta.documentNumber) blocking.push("Give the task a manufacturing code so the document gets a WI number.");
  if (!instruction.meta.title.trim()) blocking.push("Name the task; its name is the document title.");
  const overflowing = instruction.cards.filter((card) => card.overflowing).map((card) => card.sequence);
  if (overflowing.length > 0) {
    const plural = new Set(overflowing).size > 1;
    blocking.push(`${stepsPhrase(overflowing)} ${plural ? "have" : "has"} text too wide to print; shorten or break it.`);
  }
  if (firstCards.length > 0 && instruction.setup.tools.length === 0) blocking.push("Assign tools to the steps.");
  if (firstCards.length > 0 && !instruction.cards.some((card) => card.checks.length > 0)) {
    blocking.push("Assign a checklist to at least one step.");
  }

  const withoutText = firstCards.filter((card) => !card.instruction.trim()).map((card) => card.sequence);
  if (withoutText.length > 0) {
    warnings.push(
      withoutText.length === 1
        ? `Step ${withoutText[0]} has no instruction text.`
        : `${withoutText.length} of ${firstCards.length} steps have no instruction text (${formatStepNumbers(withoutText)}).`,
    );
  }
  if (options.photosLoaded !== false) {
    const withoutPhoto = firstCards.filter((card) => !card.photo);
    if (withoutPhoto.length > 0) warnings.push(`${withoutPhoto.length} of ${firstCards.length} steps have no photo.`);
  }
  if (!instruction.setup.purpose.trim()) warnings.push("No purpose / scope recorded.");
  if (!instruction.setup.safetyNotes.trim()) warnings.push("No safety / PPE notes recorded.");

  return { blocking, warnings };
}

export const CHANGE_DESCRIPTION_MAX = 500;

/** Local calendar date as YYYY-MM-DD. */
export function isoDateOnly(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export interface ReleaseInput {
  changeDescription: string;
  effectiveDate: string;
}

/** Returns a sentence when the input is unusable, otherwise null. Mirrors the table's CHECKs. */
export function validateReleaseInput(input: ReleaseInput): string | null {
  const description = input.changeDescription.trim();
  if (!description) return "Describe what changed in this revision.";
  if (description.length > CHANGE_DESCRIPTION_MAX) return `Keep the change description under ${CHANGE_DESCRIPTION_MAX} characters.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) || Number.isNaN(new Date(`${input.effectiveDate}T12:00:00`).getTime())) {
    return "Choose an effective date.";
  }
  return null;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";
}

/**
 * Where a release keeps its own copy of a step photo: inside the project-scoped prefix the
 * step-photos bucket's RLS governs, whatever shape the SOURCE path has. Older photos live at
 * legacy paths (`task-…/step-…/photo.jpg`) outside that prefix, so the destination is built from
 * the release's own workspace and project rather than derived from the source — a legacy photo
 * gets a frozen copy like any other. The workspace and project are used verbatim (RLS compares
 * them exactly); returns null only when they cannot form a path.
 */
export function frozenPhotoPath(input: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  batchId: string;
  photoId: string;
  sourcePath: string;
}): string | null {
  if (!input.sourcePath) return null;
  if (!input.workspaceId || input.workspaceId.includes("/") || !input.projectId || input.projectId.includes("/")) return null;
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(input.sourcePath)?.[1]?.toLowerCase();
  const segments = [input.taskId, input.batchId, input.photoId].map(safePathSegment);
  return `workspaces/${input.workspaceId}/projects/${input.projectId}/wi-releases/${segments.join("/")}${extension ? `.${extension}` : ""}`;
}
