import { describe, it, expect } from "vitest";
import { paginateWorkInstruction } from "./paginate";
import {
  DEFAULT_WORK_INSTRUCTION_LAYOUT,
  WORK_INSTRUCTION_LAYOUTS,
  type WorkInstruction,
  type WorkInstructionCard,
  type WorkInstructionLayout,
} from "./schema";

function makeCard(sequence: number): WorkInstructionCard {
  return {
    stepId: `step-${sequence}`,
    sequence,
    part: 1,
    partCount: 1,
    code: `WI1-${String(sequence).padStart(3, "0")}`,
    name: `Step ${sequence}`,
    instruction: `Do thing ${sequence}`,
    overflowing: false,
    tools: [],
    checks: [],
  };
}

function makeInstruction(cardCount: number): WorkInstruction {
  const cards = Array.from({ length: cardCount }, (_, index) => makeCard(index + 1));
  return {
    taskId: "task-1",
    meta: {
      documentNumber: "FA-INV-010-WI1",
      title: "Mount inverter bracket",
      revision: "B",
      effectiveDate: "",
      preparedBy: "",
      reviewedBy: "",
      approvedBy: "",
      revisionHistory: [],
    },
    context: {
      productName: "EBOSS125-G3",
      productCode: "EB125",
      productRevision: "B",
      zoneName: "Final Assembly",
      manufacturingCode: "FA-INV-010",
    },
    setup: {
      purpose: "",
      safetyNotes: "",
      tools: [],
      parts: [],
      drawingLink: "",
      sopLink: "",
      plannedDurationMinutes: 60,
      plannedOperators: 2,
      qualityGate: false,
    },
    cards,
    blank: cards.length === 0,
  };
}

/** Sheets a layout needs for n cards, derived from the rule rather than counted. */
function expectedSheets(layout: WorkInstructionLayout, cards: number): number {
  const rest = Math.max(0, cards - layout.cardsOnFirstSheet);
  return 1 + Math.ceil(rest / layout.cardsPerSheet);
}

const LAYOUTS = Object.values(WORK_INSTRUCTION_LAYOUTS);

describe("paginateWorkInstruction", () => {
  it("puts the setup sheet first", () => {
    const sheets = paginateWorkInstruction(makeInstruction(3));

    expect(sheets[0].kind).toBe("setup");
    expect(sheets[0].page).toBe(1);
  });

  // Asserted for every layout: these are the pagination rules, not v1 or v2
  // arithmetic. A hardcoded expectation here is what broke when v2 became the
  // default.
  describe.each(LAYOUTS)("$id", (layout) => {
    it("shares the setup sheet with the first row of steps", () => {
      const sheets = paginateWorkInstruction(makeInstruction(20), layout);

      expect(sheets[0].cards).toHaveLength(layout.cardsOnFirstSheet);
      expect(sheets[0].cards.map((card) => card.sequence)).toEqual(
        Array.from({ length: layout.cardsOnFirstSheet }, (_, index) => index + 1),
      );
    });

    it("fits a first-row-sized instruction on a single sheet", () => {
      const sheets = paginateWorkInstruction(makeInstruction(layout.cardsOnFirstSheet), layout);

      expect(sheets).toHaveLength(1);
      expect(sheets[0].kind).toBe("setup");
    });

    it("spills one more step onto a step sheet", () => {
      const sheets = paginateWorkInstruction(makeInstruction(layout.cardsOnFirstSheet + 1), layout);

      expect(sheets).toHaveLength(2);
      expect(sheets[1].kind).toBe("steps");
      expect(sheets[1].cards).toHaveLength(1);
    });

    it("fills a step sheet before starting another", () => {
      const full = layout.cardsOnFirstSheet + layout.cardsPerSheet;
      const sheets = paginateWorkInstruction(makeInstruction(full), layout);

      expect(sheets).toHaveLength(2);
      expect(sheets[1].cards).toHaveLength(layout.cardsPerSheet);
      expect(paginateWorkInstruction(makeInstruction(full + 1), layout)).toHaveLength(3);
    });

    it("keeps card order across sheet boundaries", () => {
      const sheets = paginateWorkInstruction(makeInstruction(11), layout);

      const sequences = sheets.flatMap((sheet) => sheet.cards.map((card) => card.sequence));
      expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it("numbers pages sequentially and stamps one shared total", () => {
      const sheets = paginateWorkInstruction(makeInstruction(13), layout);
      const total = expectedSheets(layout, 13);

      expect(sheets).toHaveLength(total);
      expect(sheets.map((sheet) => sheet.page)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      expect(sheets.every((sheet) => sheet.total === total)).toBe(true);
    });

    it("saves a sheet versus a setup-only first page", () => {
      // The point of sharing sheet 1: a setup-only page would push every card
      // down, costing a sheet whenever the first row would otherwise have filled.
      const cards = layout.cardsOnFirstSheet + layout.cardsPerSheet;
      const setupOnly = 1 + Math.ceil(cards / layout.cardsPerSheet);

      expect(paginateWorkInstruction(makeInstruction(cards), layout).length).toBeLessThan(setupOnly);
    });

    it("gives a blank instruction ruled slots on both sheets", () => {
      const sheets = paginateWorkInstruction(makeInstruction(0), layout);

      expect(sheets).toHaveLength(2);
      expect(sheets[0].kind).toBe("setup");
      expect(sheets[1].kind).toBe("steps");
      expect(sheets.every((sheet) => sheet.cards.length === 0)).toBe(true);
    });
  });

  it("defaults to v2", () => {
    expect(DEFAULT_WORK_INSTRUCTION_LAYOUT.id).toBe("v2");
    expect(paginateWorkInstruction(makeInstruction(10))[0].cards).toHaveLength(2);
  });

  it("paginates a v2 grid at four a sheet, two beside the setup band", () => {
    const sheets = paginateWorkInstruction(makeInstruction(10), WORK_INSTRUCTION_LAYOUTS.v2);

    expect(sheets.map((sheet) => sheet.cards.length)).toEqual([2, 4, 4]);
  });

  it("costs sheets to gain photo size", () => {
    // The trade v2 makes. Nine steps is where the two diverge: v1 fits 3 + 6,
    // v2 needs 2 + 4 + 3. (At ten they tie again, both on three sheets.)
    expect(paginateWorkInstruction(makeInstruction(9), WORK_INSTRUCTION_LAYOUTS.v1)).toHaveLength(2);
    expect(paginateWorkInstruction(makeInstruction(9), WORK_INSTRUCTION_LAYOUTS.v2)).toHaveLength(3);
  });
});
