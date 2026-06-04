import { getStoredTaskOperatorIds } from "./operator-assignments";
import type { DemandPeriod, Product, ProductKpis, Scenario, Station, TaktStatus, Task } from "./types";

export const DEFAULT_TAKT_TOLERANCE = 0.1;

export function round(value: number, precision = 1) {
  const multiplier = 10 ** precision;
  return Math.round((Number.isFinite(value) ? value : 0) * multiplier) / multiplier;
}

export function minutesToHours(minutes: number) {
  return minutes / 60;
}

export function formatMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return "0m";
  }

  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

export function calculateAvailableMinutes(product: Product) {
  return Math.max(
    product.grossAvailableMinutes
      - product.breakMinutes
      - (product.lunchMinutes ?? 0)
      - (product.meetingMinutes ?? 0)
      - (product.plannedDowntimeMinutes ?? 0),
    0,
  );
}

export function calculateWeeklyAvailableMinutes(product: Product) {
  return calculateAvailableMinutes(product) * Math.max(product.workDaysPerWeek ?? 0, 0);
}

export function calculateAvailableWorkDaysPerMonth(product: Product) {
  return Math.max(product.workDaysPerWeek ?? 0, 0) * Math.max(product.workWeeksPerMonth ?? 0, 0);
}

export function calculateMonthlyAvailableMinutes(product: Product) {
  return calculateAvailableMinutes(product) * calculateAvailableWorkDaysPerMonth(product);
}

export function calculateYearlyAvailableMinutes(product: Product) {
  return calculateMonthlyAvailableMinutes(product) * 12;
}

// `period` defaults to the product's own demand period (so existing callers are unchanged); pass an
// explicit period to compute availability for a scenario whose target period differs from the product.
export function calculateAvailabilityMinutesForDemandPeriod(
  product: Product,
  period: DemandPeriod = product.demandPeriod,
) {
  if (period === "week") {
    return calculateWeeklyAvailableMinutes(product);
  }

  if (period === "month") {
    return calculateMonthlyAvailableMinutes(product);
  }

  if (period === "year") {
    return calculateYearlyAvailableMinutes(product);
  }

  return calculateAvailableMinutes(product);
}

export function calculateNetAvailableMinutes(product: Product) {
  return calculateAvailableMinutes(product);
}

export function calculateTaktMinutes(product: Product) {
  const availableMinutes = calculateAvailabilityMinutesForDemandPeriod(product);
  if (product.manualTaktMinutes && product.manualTaktMinutes > 0) {
    return product.manualTaktMinutes;
  }

  if (product.demandQuantity <= 0) {
    return 0;
  }

  return availableMinutes / product.demandQuantity;
}

const RECOGNIZED_DEMAND_PERIODS: ReadonlySet<DemandPeriod> = new Set([
  "shift",
  "day",
  "week",
  "month",
  "year",
  "custom",
]);

// Takt for a non-main (projection) scenario: cadence is driven by the scenario's own
// targetOutput/targetOutputPeriod. If that target is missing, zero, negative, non-finite, or the
// period is unrecognized, fall back to the product-level takt so the Gantt never renders a broken
// (NaN/Infinity/0) cadence. The Main scenario is handled by the caller, which uses the product takt
// directly so its behavior is byte-identical to before this feature.
export function calculateActiveTaktMinutes(
  product: Product,
  scenario: Pick<Scenario, "targetOutput" | "targetOutputPeriod">,
): number {
  const target = scenario.targetOutput;
  const period = scenario.targetOutputPeriod;
  const periodIsValid = typeof period === "string" && RECOGNIZED_DEMAND_PERIODS.has(period as DemandPeriod);

  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0 || !periodIsValid) {
    return calculateTaktMinutes(product);
  }

  const availableMinutes = calculateAvailabilityMinutesForDemandPeriod(product, period as DemandPeriod);
  if (!Number.isFinite(availableMinutes) || availableMinutes <= 0) {
    return calculateTaktMinutes(product);
  }

  return availableMinutes / target;
}

export function calculateTaskManHours(task: Pick<Task, "plannedDurationMinutes" | "plannedOperators">) {
  return minutesToHours(task.plannedDurationMinutes) * task.plannedOperators;
}

export function calculateStationCycleMinutes(stationId: string, tasks: Task[]) {
  return tasks
    .filter((task) => task.stationId === stationId)
    .reduce((total, task) => total + task.plannedDurationMinutes, 0);
}

export function calculateStationManHours(stationId: string, tasks: Task[]) {
  return tasks
    .filter((task) => task.stationId === stationId)
    .reduce((total, task) => total + calculateTaskManHours(task), 0);
}

export function calculateProductPlannedManHours(tasks: Task[]) {
  return tasks.reduce((total, task) => total + calculateTaskManHours(task), 0);
}

export function calculatePlannedCycleMinutes(tasks: Task[]) {
  if (tasks.length === 0) {
    return 0;
  }

  const starts = tasks.map((task) => Date.parse(task.plannedStart)).filter(Number.isFinite);
  const finishes = tasks.map((task) => Date.parse(task.plannedFinish)).filter(Number.isFinite);

  if (starts.length === 0 || finishes.length === 0) {
    return tasks.reduce((total, task) => total + task.plannedDurationMinutes, 0);
  }

  return Math.max((Math.max(...finishes) - Math.min(...starts)) / 60000, 0);
}

export function calculateTaktStatus(
  plannedCycleMinutes: number,
  taktMinutes: number,
  tolerance = DEFAULT_TAKT_TOLERANCE,
): TaktStatus {
  if (plannedCycleMinutes <= 0 || taktMinutes <= 0) {
    return "missing";
  }

  if (plannedCycleMinutes <= taktMinutes) {
    return "green";
  }

  if (plannedCycleMinutes <= taktMinutes * (1 + tolerance)) {
    return "yellow";
  }

  return "red";
}

export function findBottleneckStation(stations: Station[]) {
  const activeStations = stations.filter((station) => station.plannedCycleMinutes > 0);
  if (activeStations.length === 0) {
    return undefined;
  }

  return [...activeStations].sort((a, b) => b.plannedCycleMinutes - a.plannedCycleMinutes)[0];
}

export function getTopLevelTasks(tasks: Task[]) {
  return tasks.filter((task) => !task.parentTaskId);
}

function isSummaryPlanningTask(task: Task, tasks: Task[]) {
  const childPrefix = `${task.wbs}.`;
  return tasks.some((candidate) => candidate.id !== task.id && candidate.wbs.startsWith(childPrefix));
}

function getSchedulablePlanningTasks(tasks: Task[]) {
  return tasks.filter((task) => task.plannedDurationMinutes > 0 && !isSummaryPlanningTask(task, tasks));
}

export function calculateUnassignedPlannedManHours(tasks: Task[]) {
  return getSchedulablePlanningTasks(tasks).reduce((total, task) => {
    if (getStoredTaskOperatorIds(task).length > 0 || task.plannedOperators > 0) {
      return total;
    }

    return total + minutesToHours(task.plannedDurationMinutes);
  }, 0);
}

export function countUnassignedPlanningTasks(tasks: Task[]) {
  return getSchedulablePlanningTasks(tasks).filter(
    (task) => getStoredTaskOperatorIds(task).length === 0 && task.plannedOperators <= 0,
  ).length;
}

export function calculatePeakManpower(tasks: Task[]) {
  const scheduledTasks = getTopLevelTasks(tasks)
    .map((task) => {
      const startMs = Date.parse(task.plannedStart);
      const finishMs = Date.parse(task.plannedFinish);
      const operatorIds = getStoredTaskOperatorIds(task);

      return {
        task,
        startMs,
        finishMs,
        operatorIds,
      };
    })
    .filter(({ startMs, finishMs, operatorIds }) => Number.isFinite(startMs) && Number.isFinite(finishMs) && finishMs > startMs && operatorIds.length > 0);

  if (scheduledTasks.length === 0) {
    return 0;
  }

  const eventTimes = [...new Set(scheduledTasks.flatMap(({ startMs, finishMs }) => [startMs, finishMs]))].sort((a, b) => a - b);

  return eventTimes.reduce((peak, time) => {
    const activeOperatorIds = new Set<string>();

    scheduledTasks.forEach(({ operatorIds, startMs, finishMs }) => {
      if (!(startMs <= time && time < finishMs)) {
        return;
      }

      operatorIds.forEach((operatorId) => activeOperatorIds.add(operatorId));
    });

    return Math.max(peak, activeOperatorIds.size);
  }, 0);
}

export function derivePlanningStationsFromTasks(tasks: Task[]): Station[] {
  return getTopLevelTasks(tasks).map((task, index) => ({
    id: task.id,
    scenarioId: task.scenarioId,
    sequence: Number.parseFloat(task.wbs) || index + 1,
    name: task.name,
    description: task.description,
    ownerName: task.ownerName ?? "",
    plannedCycleMinutes: task.plannedDurationMinutes,
    plannedOperators: task.plannedOperators,
    plannedManHours: calculateTaskManHours(task),
    taktStatus: "missing",
    bottleneckFlag: false,
  }));
}

export function calculateLineBalanceScore(stations: Station[]) {
  if (stations.length === 0) {
    return 0;
  }

  const bottleneckCycle = Math.max(...stations.map((station) => station.plannedCycleMinutes));
  if (bottleneckCycle <= 0) {
    return 0;
  }

  const totalStationWork = stations.reduce((total, station) => total + station.plannedCycleMinutes, 0);
  return (totalStationWork / (bottleneckCycle * stations.length)) * 100;
}

export function calculateCapacityGapManHours(product: Product, stations: Station[]) {
  const activeStations = stations.filter((station) => station.plannedCycleMinutes > 0);
  if (activeStations.length === 0) {
    return -product.demandQuantity * product.targetManHours;
  }

  const availableHours = minutesToHours(calculateAvailabilityMinutesForDemandPeriod(product));
  const availableOperators = activeStations.reduce((total, station) => total + station.plannedOperators, 0);
  const availableManHours = availableHours * availableOperators;
  const requiredManHours = product.demandQuantity * product.targetManHours;

  return availableManHours - requiredManHours;
}

export function applyCalculatedFields(product: Product, stations: Station[], tasks: Task[]) {
  const availableMinutes = calculateAvailableMinutes(product);
  const weeklyAvailableMinutes = calculateWeeklyAvailableMinutes(product);
  const monthlyAvailableMinutes = calculateMonthlyAvailableMinutes(product);
  const availableWorkDaysPerMonth = calculateAvailableWorkDaysPerMonth(product);
  const taktBasisMinutes = calculateAvailabilityMinutesForDemandPeriod(product);
  const calculatedTaktMinutes = product.demandQuantity > 0 ? taktBasisMinutes / product.demandQuantity : 0;
  const activeTaktMinutes = product.manualTaktMinutes && product.manualTaktMinutes > 0
    ? product.manualTaktMinutes
    : calculatedTaktMinutes;

  const calculatedProduct: Product = {
    ...product,
    netAvailableMinutes: availableMinutes,
    weeklyAvailableMinutes,
    monthlyAvailableMinutes,
    availableWorkDaysPerMonth,
    calculatedTaktMinutes,
    activeTaktMinutes,
  };

  const tasksWithManHours = tasks.map((task) => ({
    ...task,
    plannedManHours: calculateTaskManHours(task),
  }));

  const stationDrafts = stations.map((station) => {
    const plannedCycleMinutes = calculateStationCycleMinutes(station.id, tasksWithManHours);
    const plannedManHours = calculateStationManHours(station.id, tasksWithManHours);

    return {
      ...station,
      plannedCycleMinutes,
      plannedManHours,
      taktStatus: calculateTaktStatus(plannedCycleMinutes, activeTaktMinutes),
      bottleneckFlag: false,
    };
  });

  const bottleneck = findBottleneckStation(stationDrafts);
  const calculatedStations = stationDrafts.map((station) => ({
    ...station,
    bottleneckFlag: station.id === bottleneck?.id,
  }));

  return {
    product: calculatedProduct,
    stations: calculatedStations,
    tasks: tasksWithManHours,
  };
}

export function calculateProductKpis(product: Product, _stations: Station[], tasks: Task[]): ProductKpis {
  const assignedPlannedManHours = calculateProductPlannedManHours(tasks);
  const unassignedPlannedManHours = calculateUnassignedPlannedManHours(tasks);
  const unassignedTaskCount = countUnassignedPlanningTasks(tasks);
  const plannedManHours = assignedPlannedManHours + unassignedPlannedManHours;
  const plannedCycleMinutes = calculatePlannedCycleMinutes(tasks);
  const targetVariance = plannedManHours - product.targetManHours;
  const taktMinutes = calculateTaktMinutes(product);
  const availableMinutes = calculateAvailableMinutes(product);
  const netAvailablePeriodMinutes = calculateAvailabilityMinutesForDemandPeriod(product);
  const netAvailablePeriodHours = minutesToHours(netAvailablePeriodMinutes);
  const targetLaborBudgetManHours = product.targetManHours * Math.max(product.demandQuantity, 0);
  const budgetedCrewEquivalent = netAvailablePeriodHours > 0 ? targetLaborBudgetManHours / netAvailablePeriodHours : 0;
  const wholePersonStaffingRequirement = budgetedCrewEquivalent > 0 ? Math.ceil(budgetedCrewEquivalent) : 0;
  const requiredAverageAllocationPercent =
    wholePersonStaffingRequirement > 0 ? (budgetedCrewEquivalent / wholePersonStaffingRequirement) * 100 : 0;
  const assignedLaborLoadFte =
    netAvailablePeriodHours > 0 ? (assignedPlannedManHours * Math.max(product.demandQuantity, 0)) / netAvailablePeriodHours : 0;
  const plannedLaborLoadFte =
    netAvailablePeriodHours > 0 ? (plannedManHours * Math.max(product.demandQuantity, 0)) / netAvailablePeriodHours : 0;
  const crewUtilizationPercent = budgetedCrewEquivalent > 0 ? (plannedLaborLoadFte / budgetedCrewEquivalent) * 100 : 0;
  const planningStations = derivePlanningStationsFromTasks(tasks).map((station) => ({
    ...station,
    taktStatus: calculateTaktStatus(station.plannedCycleMinutes, taktMinutes),
  }));
  const bottleneckStation = findBottleneckStation(planningStations);
  const calculatedPlanningStations = planningStations.map((station) => ({
    ...station,
    bottleneckFlag: station.id === bottleneckStation?.id,
  }));

  return {
    availableMinutes,
    netAvailableMinutes: availableMinutes,
    weeklyAvailableMinutes: calculateWeeklyAvailableMinutes(product),
    monthlyAvailableMinutes: calculateMonthlyAvailableMinutes(product),
    availableWorkDaysPerMonth: calculateAvailableWorkDaysPerMonth(product),
    taktMinutes,
    plannedCycleMinutes,
    plannedManHours,
    assignedPlannedManHours,
    unassignedPlannedManHours,
    unassignedTaskCount,
    targetVariance,
    targetVariancePercent: product.targetManHours > 0 ? (targetVariance / product.targetManHours) * 100 : 0,
    lineBalanceScore: calculateLineBalanceScore(calculatedPlanningStations),
    bottleneckStation,
    capacityGapManHours: calculateCapacityGapManHours(product, calculatedPlanningStations),
    targetLaborBudgetManHours,
    budgetedCrewEquivalent,
    wholePersonStaffingRequirement,
    requiredAverageAllocationPercent,
    plannedLaborLoadFte,
    assignedLaborLoadFte,
    peakManpower: calculatePeakManpower(tasks),
    crewUtilizationPercent,
  };
}

export function getTaskWindow(task: Task, timelineStartMs: number) {
  const startMs = Date.parse(task.plannedStart);
  const finishMs = Date.parse(task.plannedFinish);

  return {
    startMinute: Math.max((startMs - timelineStartMs) / 60000, 0),
    finishMinute: Math.max((finishMs - timelineStartMs) / 60000, 0),
  };
}

export function getTimelineBounds(tasks: Task[]) {
  const starts = tasks.map((task) => Date.parse(task.plannedStart)).filter(Number.isFinite);
  const finishes = tasks.map((task) => Date.parse(task.plannedFinish)).filter(Number.isFinite);
  const startMs = starts.length ? Math.min(...starts) : Date.now();
  const finishMs = finishes.length ? Math.max(...finishes) : startMs + 60 * 60000;

  return {
    startMs,
    finishMs,
    durationMinutes: Math.max((finishMs - startMs) / 60000, 1),
  };
}
