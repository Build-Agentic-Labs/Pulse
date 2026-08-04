import { describe, it, expect } from "vitest";
import { paginateWorkInstruction } from "./paginate";
import { CARDS_PER_SHEET, type WorkInstruction, type WorkInstructionCard } from "./schema";

function makeCard(sequence: number): WorkInstructionCard {
  return {
    stepId: `step-${sequence}`,
    sequence,
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

  it("fits a full grid on one step sheet", () => {
    const sheets = paginateWorkInstruction(makeInstruction(CARDS_PER_SHEET));

    expect(sheets).toHaveLength(2);
    expect(sheets[1].kind).toBe("steps");
  });

  it("spills the seventh step onto a second step sheet", () => {
    const sheets = paginateWorkInstruction(makeInstruction(CARDS_PER_SHEET + 1));

    expect(sheets).toHaveLength(3);
    expect(sheets[1].cards).toHaveLength(CARDS_PER_SHEET);
    expect(sheets[2].cards).toHaveLength(1);
  });

  it("keeps card order across sheet boundaries", () => {
    const sheets = paginateWorkInstruction(makeInstruction(8));

    const sequences = sheets.flatMap((sheet) => sheet.cards.map((card) => card.sequence));
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("numbers pages sequentially from one", () => {
    const sheets = paginateWorkInstruction(makeInstruction(13));

    expect(sheets.map((sheet) => sheet.page)).toEqual([1, 2, 3, 4]);
  });

  it("stamps the same total on every sheet", () => {
    const sheets = paginateWorkInstruction(makeInstruction(13));

    expect(sheets.every((sheet) => sheet.total === 4)).toBe(true);
  });

  it("emits one empty step sheet for a blank instruction", () => {
    const sheets = paginateWorkInstruction(makeInstruction(0));

    expect(sheets).toHaveLength(2);
    expect(sheets[1].kind).toBe("steps");
    expect(sheets[1].cards).toEqual([]);
  });

  it("gives the setup sheet no cards", () => {
    const sheets = paginateWorkInstruction(makeInstruction(6));

    expect(sheets[0].cards).toEqual([]);
  });
});
