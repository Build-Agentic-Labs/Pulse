import { describe, it, expect } from "vitest";
import { sampleWorkInstruction } from "./sample";
import { CARDS_PER_SHEET, INSTRUCTION_BUDGET_CHARS } from "./schema";
import { paginateWorkInstruction } from "./paginate";

/**
 * The sample drives `/design/work-instruction`, which is where the printed
 * template gets eyeballed. These lock in that it keeps exercising the awkward
 * states — a preview that only shows the happy path hides the bugs.
 */
describe("sampleWorkInstruction", () => {
  it("spans more than one step sheet so pagination is visible", () => {
    const sheets = paginateWorkInstruction(sampleWorkInstruction());

    expect(sheets.filter((sheet) => sheet.kind === "steps").length).toBeGreaterThan(1);
  });

  it("leaves a partly filled last sheet so blank padding is visible", () => {
    const sheets = paginateWorkInstruction(sampleWorkInstruction());
    const last = sheets[sheets.length - 1];

    expect(last.cards.length).toBeGreaterThan(0);
    expect(last.cards.length).toBeLessThan(CARDS_PER_SHEET);
  });

  it("includes a step continued across two cards", () => {
    const cards = sampleWorkInstruction().cards;
    const continued = cards.filter((card) => card.partCount > 1);

    expect(continued.length).toBeGreaterThan(0);
    expect(continued.map((card) => card.part)).toEqual([1, 2]);
  });

  it("splits rather than overflowing — nothing is clipped", () => {
    const cards = sampleWorkInstruction().cards;

    expect(cards.every((card) => !card.overflowing)).toBe(true);
    expect(cards.every((card) => card.instruction.length <= INSTRUCTION_BUDGET_CHARS * 3)).toBe(true);
  });

  it("includes a step with no photo so the ruled empty slot is visible", () => {
    expect(sampleWorkInstruction().cards.some((card) => !card.photo)).toBe(true);
  });

  it("includes a torque spec so the value-carrying check is visible", () => {
    const specs = sampleWorkInstruction().cards.flatMap((card) => card.checks.filter((check) => check.spec));

    expect(specs.length).toBeGreaterThan(0);
  });

  it("produces an all-blank document in blank mode", () => {
    const blank = sampleWorkInstruction({ blank: true });

    expect(blank.blank).toBe(true);
    expect(blank.cards).toEqual([]);
    expect(blank.setup.parts).toEqual([]);
    expect(blank.meta.documentNumber).toBe("");
  });
});
