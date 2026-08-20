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

import type { CardTextBudget } from "./split-instruction";
import type { PhotoAnnotationDocument } from "../photo-annotations";

export type { CardTextBudget };

/** A photo bound to a step, already resolved to something an <img> can use. */
export interface WorkInstructionPhoto {
  id: string;
  url: string;
  caption: string;
  /** Intrinsic dimensions keep normalized annotation geometry aligned in print. */
  width?: number;
  height?: number;
  annotations?: PhotoAnnotationDocument;
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
  /** Numbered text-to-part references rendered on the first card for this step. */
  partReferences?: WorkInstructionStepPartReference[];
}

/** A part or material consumed by the instruction. */
export interface WorkInstructionPart {
  partNumber: string;
  description: string;
  quantity?: number;
}

export interface WorkInstructionStepPartReference extends WorkInstructionPart {
  marker: number;
  text: string;
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

/**
 * A card-grid variant.
 *
 * The sheet is a fixed two-row grid; what changes between layouts is how many
 * columns those rows carry, and therefore how large a card — and its photo —
 * can be. Everything downstream (pagination, text budgets, the CSS grid) reads
 * from here, so a variant is data rather than a forked renderer.
 */
export interface WorkInstructionLayout {
  id: string;
  label: string;
  /** Columns in the card grid. Rows are always 2. */
  columns: number;
  cardsPerSheet: number;
  /** Cards sharing sheet 1 with the setup band — always one row's worth. */
  cardsOnFirstSheet: number;
  /** CSS width of the photo column inside a card. */
  photoWidth: string;
  /**
   * What a first card's text box holds, in VISUAL LINES.
   *
   * MEASURED in the browser per card shape, never derived: for each, read
   * `lineHeight` and `clientHeight` off the rendered `.wi-card-instruction` to
   * get `lines`, and binary-search a detached probe of the same width for the
   * longest single-line string to get `charsPerLine`. Measure the WORST CASE —
   * a card crowded with all five check types and a six-tool list — because
   * checks and tools steal lines from the text box.
   *
   * Lines, not characters. The box is `white-space: pre-wrap`, so a hard line
   * break costs a full line however short it is; a character budget passed a
   * 487-character step that rendered 20 lines into an 18-line box and clipped it.
   * See `estimate-lines.ts`.
   */
  instruction: CardTextBudget;
  /** Same, for a continuation card — no photo column, so text runs full width. */
  continuation: CardTextBudget;
}

const MARGIN_LINES = 1;

export const WORK_INSTRUCTION_LAYOUTS: Record<string, WorkInstructionLayout> = {
  /**
   * 3x2. Six steps a sheet, 5.25in cards, 2.45in portrait photo.
   *
   * Budgets measured 2026-08-04: a crowded first card holds 16 lines at 45
   * chars, a continuation 19 lines at 91.
   */
  v1: {
    id: "v1",
    label: "6 per sheet",
    columns: 3,
    cardsPerSheet: 6,
    cardsOnFirstSheet: 3,
    photoWidth: "2.45in",
    instruction: { lines: 16 - MARGIN_LINES, charsPerLine: 45 },
    continuation: { lines: 19 - MARGIN_LINES, charsPerLine: 91 },
  },
  /**
   * 2x2. Four steps a sheet, 7.94in cards, 4.40in LANDSCAPE photo — 80% wider
   * than v1 and the right orientation for a shop photo, at the cost of roughly
   * half again as many sheets.
   *
   * Budgets measured 2026-08-04: a crowded first card holds 16 lines at 58
   * chars, a continuation 19 lines at 139.
   */
  v2: {
    id: "v2",
    label: "4 per sheet",
    columns: 2,
    cardsPerSheet: 4,
    cardsOnFirstSheet: 2,
    photoWidth: "4.40in",
    instruction: { lines: 16 - MARGIN_LINES, charsPerLine: 58 },
    continuation: { lines: 19 - MARGIN_LINES, charsPerLine: 139 },
  },
};

/**
 * The layout the app generates unless a caller asks for another.
 *
 * v2 since 2026-08-04: the bigger, landscape photo is what an operator actually
 * works from, and steps authored one sentence long do not need six cards a
 * sheet.
 */
export const DEFAULT_WORK_INSTRUCTION_LAYOUT = WORK_INSTRUCTION_LAYOUTS.v2;

// Convenience aliases for the default layout. Derived, never hardcoded, so
// flipping DEFAULT_WORK_INSTRUCTION_LAYOUT cannot leave them describing a
// layout the app no longer produces.
export const CARDS_PER_SHEET = DEFAULT_WORK_INSTRUCTION_LAYOUT.cardsPerSheet;
export const CARDS_ON_FIRST_SHEET = DEFAULT_WORK_INSTRUCTION_LAYOUT.cardsOnFirstSheet;
export const INSTRUCTION_BUDGET = DEFAULT_WORK_INSTRUCTION_LAYOUT.instruction;
export const CONTINUATION_BUDGET = DEFAULT_WORK_INSTRUCTION_LAYOUT.continuation;
