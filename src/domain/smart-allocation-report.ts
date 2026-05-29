import {
  calculateProductKpis,
  calculateTaskManHours,
  formatMinutes,
  getTimelineBounds,
  round,
} from "./calculations";
import {
  formatManHours,
  formatRelativeFromBounds,
  formatSignedMinutes,
  markdownCell,
  periodLabel,
} from "./formatting";
import type { IeSmartAllocationPlan } from "./ie-smart-allocation";
import { buildSmartOperatorAssignments, isAllocatableOperatorTask, isSummaryTask } from "./operator-allocation";
import { getTaskOperatorIds } from "./operator-assignments";
import type { Product, Zone } from "./types";

/**
 * Pure builders for the Smart Allocation review packet (markdown/text).
 * Extracted from line-workspace.tsx. No side effects — these turn an
 * allocation result + KPIs into human-readable review text.
 */

export type SmartAllocationResult = ReturnType<typeof buildSmartOperatorAssignments>;

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

export function buildMarkdownTable(headers: string[], rows: Array<Array<unknown>>) {
  if (rows.length === 0) {
    return "_No rows._";
  }

  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

export function buildSmartAllocationReviewText({
  agentPlan,
  allocation,
  applicationStatus,
  availableOperatorLetters,
  kpis,
  operatorCapacityMinutes,
  product,
  zones,
}: {
  agentPlan?: IeSmartAllocationPlan;
  allocation: SmartAllocationResult;
  applicationStatus?: {
    applied: boolean;
    appliedTaskCount: number;
    proposedTaskCount: number;
    rejectionReason?: string;
  };
  availableOperatorLetters: string[];
  kpis: ReturnType<typeof calculateProductKpis>;
  operatorCapacityMinutes: number;
  product: Product;
  zones: Zone[];
}) {
  const bounds = getTimelineBounds(allocation.tasks);
  const zoneNameById = new Map(zones.map((zone) => [zone.id, zone.name || "Untitled zone"]));
  const taskById = new Map(allocation.tasks.map((task) => [task.id, task]));
  const sortedTasks = [...allocation.tasks].sort((left, right) => Number.parseFloat(left.wbs) - Number.parseFloat(right.wbs));
  const unallocatedWorkReviews = buildUnallocatedWorkReviews({
    allocation,
    kpis,
    operatorCapacityMinutes,
    product,
  });
  const issueRows = allocation.issues.map((issue) => {
    const task = issue.taskId ? taskById.get(issue.taskId) : undefined;
    const conflictingTask = issue.conflictingTaskId ? taskById.get(issue.conflictingTaskId) : undefined;
    return [
      issue.severity ?? "warning",
      issue.kind,
      task ? `${task.wbs} ${task.name}` : "",
      issue.operatorId ?? "",
      conflictingTask ? `${conflictingTask.wbs} ${conflictingTask.name}` : "",
      issueReviewLabel(issue),
      issue.message,
    ];
  });
  const operatorRows = allocation.audit.operators.map((operator) => [
    operator.operatorId,
    operator.assignedTaskCount,
    formatMinutes(operator.assignedMinutes),
    `${round(operator.utilizationPercent, 1)}%`,
    formatSignedMinutes(operator.budgetVarianceMinutes),
    operator.idleGapCount,
    formatMinutes(operator.idleMinutes),
    operator.sameZoneHandoffCount,
    operator.zoneSwitchCount,
    operator.assignedTaskLabels.join("; "),
  ]);
  const taskRows = sortedTasks.map((task) => {
    const operatorIds = getTaskOperatorIds(task, availableOperatorLetters);
    const summary = isSummaryTask(task, allocation.tasks);
    const allocatable = isAllocatableOperatorTask(task, allocation.tasks);
    return [
      task.wbs,
      task.rowType,
      summary ? "yes" : "no",
      allocatable ? "yes" : "no",
      task.zoneId ? zoneNameById.get(task.zoneId) ?? task.zoneId : "Unzoned",
      task.stationId,
      task.name,
      formatRelativeFromBounds(task.plannedStart, bounds.startMs),
      formatRelativeFromBounds(task.plannedFinish, bounds.startMs),
      formatMinutes(task.plannedDurationMinutes),
      task.plannedOperators,
      operatorIds.join(", ") || "-",
      formatManHours(calculateTaskManHours(task)),
      task.dependencyIds.map((dependencyId) => taskById.get(dependencyId)?.wbs ?? dependencyId).join(", ") || "-",
      kpis.taktMinutes > 0 && task.plannedDurationMinutes > kpis.taktMinutes ? "yes" : "no",
      task.criticalPath ? "critical" : task.bottleneckFlag ? "bottleneck" : "",
    ];
  });
  const agentReviewRows = (agentPlan?.reviewItems ?? []).map((item) => {
    const task = item.taskId ? taskById.get(item.taskId) : undefined;
    return [
      item.severity,
      task ? `${task.wbs} ${task.name}` : "",
      item.message,
      item.recommendation,
    ];
  });
  const agentScheduleRows = (agentPlan?.operatorSchedules ?? []).map((schedule) => [
    schedule.operatorId,
    schedule.sequence
      .map((item) => {
        const task = taskById.get(item.taskId);
        return `${formatMinutes(item.startMinute)}-${formatMinutes(item.finishMinute)} ${task ? `${task.wbs} ${task.name}` : item.taskId}`;
      })
      .join("; "),
  ]);
  const unallocatedWorkRows = unallocatedWorkReviews.map((review) => [
    review.taskLabel,
    review.classification,
    review.condition,
    review.impact,
    review.recommendation,
    review.action,
  ]);

  return [
    "# Smart Allocation Review Packet",
    "",
    "## Allocation Inputs",
    `- Product: ${product.name}`,
    `- Demand: ${product.demandQuantity} unit(s) per ${periodLabel(product.demandPeriod)}`,
    `- Net available time per ${periodLabel(product.demandPeriod)}: ${formatMinutes(operatorCapacityMinutes)}`,
    `- Required takt: ${formatMinutes(kpis.taktMinutes)}`,
    `- Target labor content: ${formatManHours(product.targetManHours)} per unit`,
    `- Budgeted crew equivalent: ${round(kpis.budgetedCrewEquivalent, 2)} FTE`,
    `- Whole-person staffing requirement: ${kpis.wholePersonStaffingRequirement}`,
    `- Required average allocation: ${round(kpis.requiredAverageAllocationPercent, 1)}%`,
    `- Full planned MH/unit after allocation: ${formatManHours(kpis.plannedManHours)}`,
    `- Assigned planned MH/unit: ${formatManHours(kpis.assignedPlannedManHours)}`,
    `- Unassigned planned MH/unit: ${formatManHours(kpis.unassignedPlannedManHours)} across ${kpis.unassignedTaskCount} task(s)`,
    `- Planned FTE after allocation: ${round(kpis.plannedLaborLoadFte, 2)} FTE`,
    `- Assigned FTE after allocation: ${round(kpis.assignedLaborLoadFte, 2)} FTE`,
    `- Available operators: ${availableOperatorLetters.join(", ") || "none"}`,
    `- Operator capacity basis: ${formatMinutes(operatorCapacityMinutes)} per operator per ${periodLabel(product.demandPeriod)}`,
    ...(applicationStatus
      ? [
          `- Proposed task changes: ${applicationStatus.proposedTaskCount}`,
          `- Applied to Gantt: ${applicationStatus.applied ? `yes, ${applicationStatus.appliedTaskCount} task(s)` : "no"}`,
          ...(applicationStatus.rejectionReason ? [`- Application blocker: ${applicationStatus.rejectionReason}`] : []),
        ]
      : []),
    ...(agentPlan
      ? [
          "",
          "## IE Agent Summary",
          agentPlan.summary,
          "",
          "## IE Agent Review",
          buildMarkdownTable(["Severity", "Task", "Message", "Recommendation"], agentReviewRows),
          "",
          "## IE Agent Claimed Operator Schedule",
          buildMarkdownTable(["Operator", "Sequence"], agentScheduleRows),
        ]
      : []),
    "",
    "## Allocation Rules Used",
    ...allocation.audit.strategyNotes.map((note) => `- ${note}`),
    "",
    "## Audit Summary",
    `- Eligible task rows: ${allocation.audit.eligibleTaskCount}`,
    `- Assigned task rows: ${allocation.audit.assignedTaskCount}`,
    `- Unassigned task rows: ${allocation.audit.unassignedTaskCount}`,
    `- Coverage: ${round(allocation.audit.assignmentCoveragePercent, 1)}%`,
    `- Summary rows checked: ${allocation.audit.summaryTaskCount}`,
    `- Summary rows with assignments: ${allocation.audit.summaryTaskAssignmentCount}`,
    `- Peak manpower: ${allocation.audit.peakManpower}`,
    `- Blockers: ${allocation.audit.blockerCount}`,
    `- Warnings: ${allocation.audit.warningCount}`,
    `- Schedule conflicts: ${allocation.audit.scheduleConflictCount}`,
    `- Physical capacity overages: ${allocation.audit.physicalCapacityOverageCount}`,
    `- Budget overages: ${allocation.audit.budgetOverageCount}`,
    `- Takt overages: ${allocation.audit.taktOverageCount}`,
    `- Load spread: ${formatMinutes(allocation.audit.loadSpreadMinutes)} (${round(allocation.audit.loadSpreadPercent, 1)}%)`,
    ...(unallocatedWorkReviews.length
      ? [
          `- Plan status: Feasible with ${unallocatedWorkReviews.length} required work exception(s)`,
        ]
      : ["- Plan status: Feasible"]),
    "",
    "## Unallocated Required Work",
    buildMarkdownTable(
      ["Task", "Classification", "Condition", "Impact", "Recommended Fix", "Action"],
      unallocatedWorkRows,
    ),
    "",
    "## Operator Load Audit",
    buildMarkdownTable(
      ["Operator", "Tasks", "Assigned Time", "Utilization", "Budget Variance", "Idle Gaps", "Idle Time", "Same-Zone Handoffs", "Zone Switches", "Assigned Tasks"],
      operatorRows,
    ),
    "",
    "## Review Issues",
    buildMarkdownTable(["Severity", "Kind", "Task", "Operator", "Conflict", "Review Label", "Message"], issueRows),
    "",
    "## Gantt Allocation Data",
    buildMarkdownTable(
      ["WBS", "Row Type", "Summary", "Allocatable", "Zone", "Station ID", "Task", "Start", "Finish", "Duration", "Headcount", "Operators", "MH", "Dependencies", "Over Takt", "Flag"],
      taskRows,
    ),
  ].join("\n");
}
