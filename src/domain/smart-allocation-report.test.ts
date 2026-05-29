import { describe, expect, it } from "vitest";

import { buildMarkdownTable, issueReviewLabel } from "./smart-allocation-report";

type Issue = Parameters<typeof issueReviewLabel>[0];

function issue(partial: Record<string, unknown>): Issue {
  return partial as unknown as Issue;
}

describe("buildMarkdownTable", () => {
  it("returns a placeholder when there are no rows", () => {
    expect(buildMarkdownTable(["A", "B"], [])).toBe("_No rows._");
  });
  it("renders a header, divider, and escaped cells", () => {
    const table = buildMarkdownTable(["A", "B"], [[1, 2], ["x|y", "z"]]);
    expect(table).toBe(["| A | B |", "| --- | --- |", "| 1 | 2 |", "| x\\|y | z |"].join("\n"));
  });
});

describe("issueReviewLabel", () => {
  it("labels unassigned_task reasons", () => {
    expect(issueReviewLabel(issue({ kind: "unassigned_task", reason: "single_operator_period_capacity" }))).toBe(
      "exceeds one-operator period capacity",
    );
    expect(issueReviewLabel(issue({ kind: "unassigned_task", reason: "all_operators_occupied" }))).toBe(
      "all operators occupied during window",
    );
    expect(issueReviewLabel(issue({ kind: "unassigned_task", reason: "all_operators_over_capacity" }))).toBe(
      "no operator has remaining capacity",
    );
    expect(issueReviewLabel(issue({ kind: "unassigned_task", reason: "no_operators" }))).toBe("no budgeted operators");
    expect(issueReviewLabel(issue({ kind: "unassigned_task", reason: "mixed_constraints" }))).toBe(
      "schedule/capacity blocked",
    );
  });
  it("labels overage and fallback kinds", () => {
    expect(issueReviewLabel(issue({ kind: "takt_overage" }))).toBe("exceeds takt");
    expect(issueReviewLabel(issue({ kind: "budget_overage" }))).toBe("over budgeted allocation");
    expect(issueReviewLabel(issue({ kind: "capacity_overage" }))).toBe("over physical capacity");
    expect(issueReviewLabel(issue({ kind: "schedule_conflict" }))).toBe("schedule conflict");
  });
});
