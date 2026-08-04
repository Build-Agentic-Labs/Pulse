/**
 * Shape of a printable assembly work instruction.
 *
 * Deliberately decoupled from `Task` / `ManufacturingStep`: the print document
 * renders only what is in here, so the renderer never reaches back into planner
 * state, and the future document-control layer can populate `meta` from its own
 * tables without touching the renderer.
 *
 * See docs/superpowers/specs/2026-08-04-assembly-work-instruction-design.md
 */

/** A photo bound to a step, already resolved to something an <img> can use. */
export interface WorkInstructionPhoto {
  id: string;
  url: string;
  caption: string;
}

/** A single quality check, flattened from ManufacturingStepCheckState. */
export interface WorkInstructionCheck {
  key: string;
  label: string;
  /** Rendered spec for value-carrying checks, e.g. "45 Nm". Empty for checkboxes. */
  spec: string;
}

/** One step card in the 3x2 grid. */
export interface WorkInstructionCard {
  stepId: string;
  /** 1-based position within the whole instruction, not within the sheet. */
  sequence: number;
  /** stepDisplayCode(), e.g. "Z1-A-010-WI1-010". Empty when uncoded. */
  code: string;
  name: string;
  instruction: string;
  /** True when `instruction` exceeds the card's line budget — drawn loudly, never clipped. */
  overflowing: boolean;
  durationMinutes?: number;
  tools: string[];
  checks: WorkInstructionCheck[];
  photo?: WorkInstructionPhoto;
}

/** A part or material consumed by the instruction. */
export interface WorkInstructionPart {
  partNumber: string;
  description: string;
  quantity?: number;
}

/**
 * Document-control fields.
 *
 * Every field is populated from task data or left blank in this phase. The
 * control layer changes where the values come from, not how they are drawn —
 * this interface is the seam.
 */
export interface WorkInstructionMeta {
  /** documentDisplayCode(task, "WI", 1). Empty when the task has no manufacturing code. */
  documentNumber: string;
  title: string;
  revision: string;
  effectiveDate: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  revisionHistory: WorkInstructionRevision[];
}

export interface WorkInstructionRevision {
  revision: string;
  date: string;
  description: string;
  author: string;
}

/** Context shown in the header band and footer of every sheet. */
export interface WorkInstructionContext {
  productName: string;
  productCode: string;
  productRevision: string;
  zoneName: string;
  manufacturingCode: string;
}

/** The setup sheet's non-step content. */
export interface WorkInstructionSetup {
  purpose: string;
  safetyNotes: string;
  tools: string[];
  parts: WorkInstructionPart[];
  materialKit: string;
  drawingLink: string;
  sopLink: string;
  plannedDurationMinutes: number;
  plannedOperators: number;
  qualityGate: boolean;
}

export interface WorkInstruction {
  taskId: string;
  meta: WorkInstructionMeta;
  context: WorkInstructionContext;
  setup: WorkInstructionSetup;
  cards: WorkInstructionCard[];
  /** True when built with no steps — the renderer draws ruled blanks instead. */
  blank: boolean;
}

/**
 * One printed ledger sheet.
 *
 * `cards` is always present (empty on the setup sheet) so callers can flatten
 * across sheets without narrowing on `kind` first.
 */
export interface WorkInstructionSheet {
  kind: "setup" | "steps";
  /** 1-based, across the whole document. */
  page: number;
  /** Total sheets in the document — the M in "Page N of M". */
  total: number;
  cards: WorkInstructionCard[];
}

/** Cards per step sheet: the 3x2 grid is fixed, which is what makes pagination pure. */
export const CARDS_PER_SHEET = 6;

/**
 * Characters of instruction text a card can hold before it clips.
 *
 * MEASURED, not estimated (2026-08-04, Chrome at /design/work-instruction):
 * binary-searched the real rendered `.wi-card-instruction` box for the point
 * where scrollHeight first exceeds clientHeight. The tightest card — three
 * tools, three checks and the overflow note all competing for the text column —
 * held 644 characters; the roomiest held 765. This sits ~7% under the tightest
 * so the warning fires just before text is actually lost, never before.
 *
 * A first-principles estimate put this at 360 and would have told authors to
 * split steps that fit with room to spare. If the card layout changes, re-run
 * the measurement rather than re-deriving it.
 */
export const INSTRUCTION_BUDGET_CHARS = 600;
