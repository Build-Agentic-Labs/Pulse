import { expect, it } from "vitest";
import { wiPrintPlan } from "./print-plan";
import { blankGeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
it("leaves ordinary authored steps unchanged", () => {
  const document = {
    ...blankGeneralWorkInstruction(),
    purpose: "Scope",
    responsibilities: "Author",
    steps: [{ title: "Open", instruction: "Open the record." }],
  };
  expect(wiPrintPlan(document, 1120)).toEqual({
    document,
    singleStepPages: false,
  });
});
it("splits oversized instructions without changing their authored identity or losing words", () => {
  const instruction = "Detailed action and explanation. ".repeat(180) + "END";
  const document = {
    ...blankGeneralWorkInstruction(),
    purpose: "Scope",
    responsibilities: "Author",
    steps: [{ title: "Open", instruction }],
  };
  const plan = wiPrintPlan(document, 5000);
  expect(plan.singleStepPages).toBe(true);
  expect(plan.document.steps.length).toBeGreaterThan(1);
  expect(plan.document.steps.every((s) => s.sequence === 1)).toBe(true);
  expect(plan.document.steps.at(-1)!.instruction).toContain("END");
  expect(
    plan.document.steps
      .map((s) => s.instruction)
      .join(" ")
      .split(/\s+/),
  ).toEqual(instruction.trim().split(/\s+/));
  expect(document.steps).toHaveLength(1);
});
