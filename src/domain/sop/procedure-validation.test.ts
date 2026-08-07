import { describe, expect, it } from "vitest";
import type { SopActivity } from "./schema";
import { decisionBranchRequirement, listDecisionBranchRequirements } from "./procedure-validation";

const baseActivities: SopActivity[] = [
  {
    id: "decision",
    step: 1,
    shape: "decision",
    description: "Is the request approved?",
    assignments: {},
  },
  { id: "approved", step: 2, shape: "process", description: "Approve request", assignments: {} },
  { id: "revise", step: 3, shape: "process", description: "Revise request", assignments: {} },
];

describe("decision branch requirements", () => {
  it("requires every decision outcome to be explicitly configured", () => {
    const requirement = decisionBranchRequirement(baseActivities[0], baseActivities);

    expect(requirement?.affectedOutcomes).toEqual(["yes", "no"]);
    expect(requirement?.message).toContain("choose a destination or End process");
  });

  it("accepts distinct destinations, including an explicit end", () => {
    const activities = baseActivities.map((activity, index) =>
      index === 0
        ? {
            ...activity,
            decisionBranches: { yesTargetActivityId: "approved", noTargetActivityId: null },
          }
        : activity,
    );

    expect(listDecisionBranchRequirements(activities)).toEqual([]);
  });

  it("requires correction when conversion maps Yes and No to the same step", () => {
    const activities = baseActivities.map((activity, index) =>
      index === 0
        ? {
            ...activity,
            decisionBranches: { yesTargetActivityId: "approved", noTargetActivityId: "approved" },
          }
        : activity,
    );

    expect(decisionBranchRequirement(activities[0], activities)).toMatchObject({
      affectedOutcomes: ["yes", "no"],
      message: expect.stringContaining("cannot point to the same destination"),
    });
  });

  it("requires correction when a destination no longer exists", () => {
    const activities = baseActivities.map((activity, index) =>
      index === 0
        ? {
            ...activity,
            decisionBranches: { yesTargetActivityId: "removed", noTargetActivityId: "revise" },
          }
        : activity,
    );

    expect(decisionBranchRequirement(activities[0], activities)).toMatchObject({
      affectedOutcomes: ["yes"],
      message: expect.stringContaining("unavailable destination"),
    });
  });
});
