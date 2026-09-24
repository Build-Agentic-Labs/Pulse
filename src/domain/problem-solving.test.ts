import { describe, expect, it } from "vitest";
import { caseLabel, isOverdue, transitionIssues, type ProblemAction, type ProblemCase } from "./problem-solving";

const complete = { owner: "RL", problem: "Wrong label", expected: "Correct label", affected: "Unit 12", containment: "Unit held", root_cause: "Old template", cause_evidence: "Compared revision and printed label", prevention: "Remove obsolete templates", verification_plan: "Inspect next ten units", verification_result: "Ten passed", reported_on: "2026-09-01", verified_on: "2026-09-24" } as ProblemCase;
const actions = ["containment", "corrective", "preventive"].map(kind => ({ kind, status: "done", completion_evidence: "Checked", due_on: "2026-09-20" }) as ProblemAction);
describe("problem solving gates", () => {
  it("allows an incomplete draft but requires definition before containment", () => {
    expect(transitionIssues({ ...complete, affected: " " }, [], "define", "2026-09-24")).toEqual([]);
    expect(transitionIssues({ ...complete, affected: " " }, [], "contain", "2026-09-24")).toHaveLength(1);
  });
  it("requires completed containment before investigating and cause evidence before correction", () => {
    expect(transitionIssues(complete, [], "investigate", "2026-09-24")).toHaveLength(1);
    expect(transitionIssues({ ...complete, cause_evidence: "" }, actions, "correct", "2026-09-24")).toHaveLength(1);
  });
  it("does not equate completed actions with effectiveness", () => {
    expect(transitionIssues({ ...complete, verification_result: "" }, actions, "closed", "2026-09-24")).toHaveLength(1);
    expect(transitionIssues(complete, actions, "closed", "2026-09-24")).toEqual([]);
  });
  it("blocks remaining actions, missing completion evidence and future verification", () => {
    expect(transitionIssues(complete, [...actions, { ...actions[0], status: "open" }], "closed", "2026-09-24")).toHaveLength(1);
    expect(transitionIssues(complete, [{ ...actions[0], completion_evidence: "" }], "investigate", "2026-09-24")).toHaveLength(1);
    expect(transitionIssues({ ...complete, verified_on: "2026-09-25" }, actions, "closed", "2026-09-24")).toHaveLength(1);
  });
  it("counts overdue actions by due date, excluding completed and due-today actions", () => {
    expect(isOverdue({ ...actions[0], status: "open" }, "2026-09-24")).toBe(true);
    expect(isOverdue(actions[0], "2026-09-24")).toBe(false);
    expect(isOverdue({ ...actions[0], status: "open", due_on: "2026-09-24" }, "2026-09-24")).toBe(false);
    expect(caseLabel(12)).toBe("PS-0012");
  });
});
