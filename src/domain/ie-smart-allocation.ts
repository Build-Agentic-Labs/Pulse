import type { DemandPeriod, PlannerState } from "./types";

export interface IeSmartAllocationConstraints {
  demandQuantity: number;
  demandPeriod: DemandPeriod;
  targetManHours: number;
  taktMinutes: number;
  budgetedCrewEquivalent: number;
  wholePersonStaffingRequirement: number;
  requiredAverageAllocationPercent: number;
  operatorCapacityMinutes: number;
  plannedManHours: number;
  assignedPlannedManHours: number;
  unassignedPlannedManHours: number;
  plannedLaborLoadFte: number;
  assignedLaborLoadFte: number;
  peakManpower: number;
}

export interface IeSmartAllocationRequest {
  plannerState: PlannerState;
  availableOperatorIds: string[];
  constraints: IeSmartAllocationConstraints;
}

export interface IeSmartAllocationAssignment {
  taskId: string;
  operatorIds: string[];
  rationale: string;
}

export interface IeSmartAllocationReviewItem {
  severity: "blocker" | "warning" | "info";
  taskId?: string;
  message: string;
  recommendation: string;
}

export interface IeSmartAllocationOperatorScheduleItem {
  taskId: string;
  startMinute: number;
  finishMinute: number;
}

export interface IeSmartAllocationOperatorSchedule {
  operatorId: string;
  sequence: IeSmartAllocationOperatorScheduleItem[];
}

export interface IeSmartAllocationPlan {
  summary: string;
  assignments: IeSmartAllocationAssignment[];
  operatorSchedules: IeSmartAllocationOperatorSchedule[];
  reviewItems: IeSmartAllocationReviewItem[];
  strategyNotes: string[];
}
