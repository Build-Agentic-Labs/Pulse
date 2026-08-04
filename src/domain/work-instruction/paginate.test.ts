import { describe, it, expect } from "vitest";
import { paginateWorkInstruction } from "./paginate";
import {
  CARDS_ON_FIRST_SHEET,
  CARDS_PER_SHEET,
  type WorkInstruction,
  type WorkInstructionCard,
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
      materialKit: "",
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

describe("paginateWorkInstruction", () => {
  it("puts the setup sheet first", () => {
    const sheets = paginateWorkInstruction(makeInstruction(3));

    expect(sheets[0].kind).toBe("setup");
    expect(sheets[0].page).toBe(1);
  });

  it("shares the setup sheet with the first three steps", () => {
    const sheets = paginateWorkInstruction(makeInstruction(8));

    expect(sheets[0].cards.map((card) => card.sequence)).toEqual([1, 2, 3]);
  });

  it("fits a three-step instruction on a single sheet", () => {
    const sheets = paginateWorkInstruction(makeInstruction(CARDS_ON_FIRST_SHEET));

    expect(sheets).toHaveLength(1);
    expect(sheets[0].kind).toBe("setup");
  });

  it("spills the fourth step onto a step sheet", () => {
    const sheets = paginateWorkInstruction(makeInstruction(CARDS_ON_FIRST_SHEET + 1));

    expect(sheets).toHaveLength(2);
    expect(sheets[1].kind).toBe("steps");
    expect(sheets[1].cards).toHaveLength(1);
  });

  it("fills a step sheet before starting another", () => {
    const sheets = paginateWorkInstruction(makeInstruction(CARDS_ON_FIRST_SHEET + CARDS_PER_SHEET));

    expect(sheets).toHaveLength(2);
    expect(sheets[1].cards).toHaveLength(CARDS_PER_SHEET);
  });

  it("keeps card order across sheet boundaries", () => {
    const sheets = paginateWorkInstruction(makeInstruction(11));

    const sequences = sheets.flatMap((sheet) => sheet.cards.map((card) => card.sequence));
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  // 15 = 3 on the setup sheet + two full step sheets of 6.
  it("numbers pages sequentially from one", () => {
    const sheets = paginateWorkInstruction(makeInstruction(15));

    expect(sheets.map((sheet) => sheet.page)).toEqual([1, 2, 3]);
  });

  it("stamps the same total on every sheet", () => {
    const sheets = paginateWorkInstruction(makeInstruction(15));

    expect(sheets.every((sheet) => sheet.total === 3)).toBe(true);
  });

  it("opens a fourth sheet for the sixteenth step", () => {
    expect(paginateWorkInstruction(makeInstruction(16))).toHaveLength(4);
  });

  it("saves a sheet versus a setup-only first page", () => {
    // 8 steps: 3 on the setup sheet + 5 on one step sheet. A setup-only first
    // page would need 6 + 2 across two step sheets, so three sheets in total.
    expect(paginateWorkInstruction(makeInstruction(8))).toHaveLength(2);
  });

  it("gives a blank instruction ruled slots on both sheets", () => {
    const sheets = paginateWorkInstruction(makeInstruction(0));

    expect(sheets).toHaveLength(2);
    expect(sheets[0].kind).toBe("setup");
    expect(sheets[1].kind).toBe("steps");
    expect(sheets.every((sheet) => sheet.cards.length === 0)).toBe(true);
  });
});
