import type { SopActivity } from "./schema";

export type DecisionOutcome = "yes" | "no";

export type DecisionBranchRequirement = {
  activityId: string;
  step: number;
  affectedOutcomes: DecisionOutcome[];
  message: string;
};

function outcomeLabel(outcomes: DecisionOutcome[]): string {
  if (outcomes.length === 2) return "Yes and No outcomes";
  return `${outcomes[0] === "yes" ? "Yes" : "No"} outcome`;
}

/**
 * Return the author action required to make one decision safe to submit. Drafts may remain
 * incomplete while they are being edited, but both outcomes must resolve before review starts.
 */
export function decisionBranchRequirement(
  activity: SopActivity,
  activities: readonly SopActivity[],
): DecisionBranchRequirement | undefined {
  if (activity.shape !== "decision") return undefined;

  const ids = new Set(activities.map((candidate) => candidate.id));
  const targets = {
    yes: activity.decisionBranches?.yesTargetActivityId,
    no: activity.decisionBranches?.noTargetActivityId,
  };
  const missing = (["yes", "no"] as const).filter((outcome) => targets[outcome] === undefined);
  if (missing.length) {
    return {
      activityId: activity.id,
      step: activity.step,
      affectedOutcomes: missing,
      message: `Required: choose a destination or End process for the ${outcomeLabel(missing)} in decision step ${activity.step}.`,
    };
  }

  const invalid = (["yes", "no"] as const).filter((outcome) => {
    const target = targets[outcome];
    return typeof target === "string" && (!ids.has(target) || target === activity.id);
  });
  if (invalid.length) {
    return {
      activityId: activity.id,
      step: activity.step,
      affectedOutcomes: invalid,
      message: `Required: replace the unavailable destination for the ${outcomeLabel(invalid)} in decision step ${activity.step}.`,
    };
  }

  if (targets.yes === targets.no) {
    return {
      activityId: activity.id,
      step: activity.step,
      affectedOutcomes: ["yes", "no"],
      message: `Required: Yes and No cannot point to the same destination in decision step ${activity.step}. Choose a different step or End process for one branch.`,
    };
  }

  return undefined;
}

export function listDecisionBranchRequirements(
  activities: readonly SopActivity[],
): DecisionBranchRequirement[] {
  return activities.flatMap((activity) => {
    const requirement = decisionBranchRequirement(activity, activities);
    return requirement ? [requirement] : [];
  });
}
