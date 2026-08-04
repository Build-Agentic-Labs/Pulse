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

/**
 * One step card in the 3x2 grid.
 *
 * A step whose text does not fit one card produces several cards — parts 1..n
 * of the same step — rather than being clipped or handed back to the author to
 * split. The photo, tools and duration ride on the first part; the checks ride
 * on the last, where the step is actually verified.
 */
export interface WorkInstructionCard {
  stepId: string;
  /** 1-based position within the whole instruction, not within the sheet. */
  sequence: number;
  /** 1-based part of this step. `partCount` is 1 for steps that fit one card. */
  part: number;
  partCount: number;
  /** stepDisplayCode(), e.g. "Z1-A-010-WI1-010". Empty when uncoded. */
  code: string;
  name: string;
  /** This part's slice of the step text. */
  instruction: string;
  /**
   * True only when a single unsplittable token is wider than the card — the one
   * case the splitter cannot resolve and a human must. Drawn loudly, never clipped.
   */
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

/**
 * The setup band's content.
 *
 * There is no separate `materialKit`: a kit is a part number, so it is folded
 * into `parts` as a row rather than getting a block of its own.
 */
export interface WorkInstructionSetup {
  purpose: string;
  safetyNotes: string;
  tools: string[];
  parts: WorkInstructionPart[];
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
 * Cards that share sheet 1 with the setup band.
 *
 * The setup band is sized to exactly one card row (4.32in), so the bottom row
 * of sheet 1 is a normal row of three cards rather than white space. This is
 * purely to conserve sheets: an 8-step instruction is 2 sheets instead of 3.
 */
export const CARDS_ON_FIRST_SHEET = 3;

/**
 * Characters of instruction text a card can hold, by card shape.
 *
 * MEASURED, not estimated (2026-08-04, Chrome at /design/work-instruction):
 * binary-search the rendered `.wi-card-instruction` box for the point where
 * scrollHeight first exceeds clientHeight.
 *
 * Measure the WORST CASE, not whatever the sample happens to contain — a card
 * crowded with all five check types and a six-tool list, since checks and tools
 * share the text column. The sample's own tightest card reads 725, which would
 * set a budget that clips on a busier step.
 *
 * Worst-case first card: 645. Set ~7% under.
 *
 * A first-principles estimate put this at 360, and would have split steps that
 * fit with room to spare. If the card layout changes, re-run the measurement
 * rather than re-deriving it — re-measured after the header grew to 1.20in and
 * the value held.
 */
export const INSTRUCTION_BUDGET_CHARS = 600;

/**
 * Budget for a continuation card, which drops the photo column and runs text
 * the full card width.
 *
 * Worst-case measured the same way: 1,851 — roughly three times a first card,
 * which is why a long step usually needs only one continuation. Crowding the
 * checks does not move it, because they wrap across the full width. Set ~8%
 * under.
 */
export const CONTINUATION_BUDGET_CHARS = 1700;
