import { calculateProductKpis, formatMinutes, getTimelineBounds } from "./calculations";
import { formatRelativeFromBounds, periodLabel } from "./formatting";
import type { buildOperatorAssignmentsFromIePlan } from "./operator-allocation";
import type { Product } from "./types";

/** Pure builders for current operator-allocation review labels and recommendations. */

export type SmartAllocationResult = ReturnType<typeof buildOperatorAssignmentsFromIePlan>;

export function issueReviewLabel(issue: SmartAllocationResult["issues"][number]) {
  if (issue.kind === "unassigned_task") {
    if (issue.reason === "single_operator_period_capacity") {
      return "exceeds one-operator period capacity";
    }

    if (issue.reason === "all_operators_occupied") {
      return "all operators occupied during window";
    }

    if (issue.reason === "all_operators_over_capacity") {
      return "no operator has remaining capacity";
    }

    if (issue.reason === "no_operators") {
      return "no budgeted operators";
    }

    return "schedule/capacity blocked";
  }

  if (issue.kind === "takt_overage") {
    return "exceeds takt";
  }

  if (issue.kind === "budget_overage") {
    return "over budgeted allocation";
  }

  if (issue.kind === "capacity_overage") {
    return "over physical capacity";
  }

  return "schedule conflict";
}

export interface UnallocatedWorkReview {
  taskId: string;
  taskLabel: string;
  classification: "Physically infeasible" | "Window blocked" | "Capacity blocked" | "Policy blocked";
  condition: string;
  impact: string;
  recommendation: string;
  action: string;
}

export function buildUnallocatedWorkReviews({
  allocation,
  kpis,
  operatorCapacityMinutes,
  product,
}: {
  allocation: SmartAllocationResult;
  kpis: ReturnType<typeof calculateProductKpis>;
  operatorCapacityMinutes: number;
  product: Product;
}): UnallocatedWorkReview[] {
  const bounds = getTimelineBounds(allocation.tasks);
  const taskById = new Map(allocation.tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();

  return allocation.issues
    .filter((issue) => issue.kind === "unassigned_task" && issue.taskId)
    .map((issue) => {
      const task = issue.taskId ? taskById.get(issue.taskId) : undefined;
      if (!task || seen.has(task.id)) {
        return undefined;
      }

      seen.add(task.id);
      const taskLabel = `${task.wbs} ${task.name}`;
      const taskPeriodLoadMinutes = task.plannedDurationMinutes * Math.max(product.demandQuantity, 0);
      const taskWindow = `${formatRelativeFromBounds(task.plannedStart, bounds.startMs)}-${formatRelativeFromBounds(task.plannedFinish, bounds.startMs)}`;
      const overTaktText = kpis.taktMinutes > 0 && task.plannedDurationMinutes > kpis.taktMinutes
        ? ` Duration ${formatMinutes(task.plannedDurationMinutes)} is over takt ${formatMinutes(kpis.taktMinutes)}.`
        : "";

      if (issue.reason === "single_operator_period_capacity") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Physically infeasible" as const,
          condition: "Exceeds one-operator period capacity",
          impact: `${formatMinutes(taskPeriodLoadMinutes)} required per ${periodLabel(product.demandPeriod)} vs ${formatMinutes(operatorCapacityMinutes)} available.${overTaktText}`,
          recommendation: "Split the task, reduce duration, add capacity/overtime, or model this as dedicated resource work.",
          action: "Split task / add capacity",
        };
      }

      if (issue.reason === "all_operators_occupied") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Window blocked" as const,
          condition: "All operators occupied during scheduled window",
          impact: `No budgeted operator is free from ${taskWindow}.`,
          recommendation: "Move the task window, move competing work, add an operator, or split/sequence the task.",
          action: "Move work / add operator",
        };
      }

      if (issue.reason === "all_operators_over_capacity" || issue.reason === "no_operators") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Capacity blocked" as const,
          condition: issue.reason === "no_operators" ? "No budgeted operators available" : "No operator has remaining period capacity",
          impact: `${formatMinutes(taskPeriodLoadMinutes)} more period load is required for this task.`,
          recommendation: "Increase the budgeted labor pool, reduce assigned load, or move this work outside the constrained period.",
          action: "Add capacity",
        };
      }

      if (issue.reason === "mixed_constraints") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Window blocked" as const,
          condition: "Schedule and capacity constraints both block assignment",
          impact: `Every operator is blocked by overlap or remaining capacity during ${taskWindow}.`,
          recommendation: "Review the competing work in the same time window, then move or split one of the tasks.",
          action: "Review conflicts",
        };
      }

      return {
        taskId: task.id,
        taskLabel,
        classification: "Policy blocked" as const,
        condition: issueReviewLabel(issue),
        impact: issue.message,
        recommendation: "Review priority, then manually override or adjust the task plan if this work must be staffed.",
        action: "Review priority",
      };
    })
    .filter((review): review is UnallocatedWorkReview => Boolean(review));
}
