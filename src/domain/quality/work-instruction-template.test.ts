import { describe, expect, it } from "vitest";
import {
  WI_TEMPLATE_STEPS_PER_PAGE,
  WI_TEMPLATE_STEP_PROMPT,
  blankGeneralWorkInstruction,
  paginateGeneralWorkInstruction,
} from "./work-instruction-template";

describe("paginateGeneralWorkInstruction", () => {
  it("always yields the template's two pages", () => {
    expect(paginateGeneralWorkInstruction(0)).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(paginateGeneralWorkInstruction(2)).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("adds continuation pages of three, keeping a short last page", () => {
    expect(paginateGeneralWorkInstruction(7)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(paginateGeneralWorkInstruction(9)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });
});

describe("blankGeneralWorkInstruction", () => {
  it("fills both template pages with prompts, the instruction hint on step 1 only", () => {
    const blank = blankGeneralWorkInstruction();
    const total = WI_TEMPLATE_STEPS_PER_PAGE[0] + WI_TEMPLATE_STEPS_PER_PAGE[1];
    expect(blank.steps).toHaveLength(total);
    expect(blank.steps[0].instruction).toBe(WI_TEMPLATE_STEP_PROMPT);
    expect(blank.steps.slice(1).every((step) => step.instruction === "")).toBe(true);
    expect(blank.steps.every((step) => step.image === undefined)).toBe(true);
  });
});

describe("document numbers", () => {
  it("gives the blank template the WI-DEPT-### pattern", () => {
    expect(blankGeneralWorkInstruction().documentNumber).toBe("WI-DEPT-###");
  });

  it("numbers the Purchasing sample WI-PUR-001", async () => {
    const { SAMPLE_GENERAL_WORK_INSTRUCTION } = await import("./work-instruction-sample");
    expect(SAMPLE_GENERAL_WORK_INSTRUCTION.documentNumber).toBe("WI-PUR-001");
  });
});
