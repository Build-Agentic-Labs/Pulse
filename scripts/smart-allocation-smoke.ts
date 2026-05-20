import assert from "node:assert/strict";
import {
  buildOperatorAssignmentsFromIePlan,
  buildSmartOperatorAssignments,
  isAllocatableOperatorTask,
  validateOperatorAllocations,
} from "../src/domain/operator-allocation";
import { calculatePeakManpower, calculateProductKpis } from "../src/domain/calculations";
import { getTaskOperatorIds } from "../src/domain/operator-assignments";
import type { Product, Station, Task } from "../src/domain/types";

const baseMs = Date.parse("2026-05-11T07:00:00.000-07:00");

function atMinute(minute: number) {
  return new Date(baseMs + minute * 60_000).toISOString();
}

function makeTask({
  id,
  name,
  plannedDurationMinutes,
  plannedStart,
  wbs,
  ...overrides
}: Partial<Task> & Pick<Task, "id" | "wbs" | "name" | "plannedStart" | "plannedDurationMinutes">): Task {
  return {
    actualManHours: undefined,
    actualOperators: undefined,
    bottleneckFlag: false,
    criticalPath: false,
    customFields: {},
    dependencyIds: [],
    description: "",
    id,
    manufacturingSteps: [],
    name,
    partReferences: [],
    percentComplete: 0,
    plannedDurationMinutes,
    plannedFinish: atMinute(
      (Date.parse(plannedStart) - baseMs) / 60000 + plannedDurationMinutes,
    ),
    plannedManHours: 0,
    plannedOperators: 0,
    plannedStart,
    qualityGate: false,
    rowType: "task",
    scenarioId: "scenario-test",
    stationId: "station-test",
    status: "not_started",
    travelerSignoffRequired: false,
    wbs,
    ...overrides,
  };
}

function smart(tasks: Task[], overrides: Partial<Parameters<typeof buildSmartOperatorAssignments>[0]> = {}) {
  return buildSmartOperatorAssignments({
    availableOperatorIds: ["A", "B"],
    budgetedAllocationPercent: 100,
    demandQuantity: 1,
    operatorCapacityMinutes: 480,
    preserveExisting: false,
    taktMinutes: 480,
    tasks,
    ...overrides,
  });
}

function operatorIds(taskId: string, tasks: Task[]) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `Missing task ${taskId}`);
  return getTaskOperatorIds(task, ["A", "B"]);
}

function makeProduct(): Product {
  return {
    activeTaktMinutes: 480,
    availableWorkDaysPerMonth: 20,
    breakMinutes: 0,
    calculatedTaktMinutes: 480,
    createdAt: new Date(baseMs).toISOString(),
    demandPeriod: "week",
    demandQuantity: 1,
    description: "",
    family: "",
    grossAvailableMinutes: 480,
    id: "product-test",
    lunchMinutes: 0,
    meetingMinutes: 0,
    monthlyAvailableMinutes: 9600,
    name: "Test Product",
    netAvailableMinutes: 480,
    ownerName: "Manufacturing",
    plannedDowntimeMinutes: 0,
    revision: "A",
    sku: "TEST",
    status: "draft",
    targetManHours: 10,
    updatedAt: new Date(baseMs).toISOString(),
    weeklyAvailableMinutes: 480,
    workDaysPerWeek: 1,
    workWeeksPerMonth: 4,
  };
}

function makeStation(): Station {
  return {
    bottleneckFlag: false,
    id: "station-test",
    name: "Test Station",
    ownerName: "Manufacturing",
    plannedCycleMinutes: 0,
    plannedManHours: 0,
    plannedOperators: 0,
    scenarioId: "scenario-test",
    sequence: 1,
    taktStatus: "missing",
  };
}

{
  const tasks = [
    makeTask({ id: "prep", wbs: "1", name: "Prep", plannedStart: atMinute(0), plannedDurationMinutes: 60, zoneId: "z1" }),
    makeTask({ id: "build", wbs: "2", name: "Build", plannedStart: atMinute(60), plannedDurationMinutes: 60, zoneId: "z1" }),
  ];
  const allocation = smart(tasks);

  assert.deepEqual(operatorIds("prep", allocation.tasks), ["A"]);
  assert.deepEqual(operatorIds("build", allocation.tasks), ["A"]);
  assert.equal(calculatePeakManpower(allocation.tasks), 1);
  assert.equal(allocation.audit.assignmentCoveragePercent, 100);
  assert.equal(allocation.audit.operators.find((operator) => operator.operatorId === "A")?.idleGapCount, 0);
}

{
  const tasks = [
    makeTask({ id: "one", wbs: "1", name: "One", plannedStart: atMinute(0), plannedDurationMinutes: 240, zoneId: "z1" }),
    makeTask({ id: "two", wbs: "2", name: "Two", plannedStart: atMinute(240), plannedDurationMinutes: 240, zoneId: "z1" }),
    makeTask({ id: "three", wbs: "3", name: "Three", plannedStart: atMinute(480), plannedDurationMinutes: 240, zoneId: "z1" }),
    makeTask({ id: "four", wbs: "4", name: "Four", plannedStart: atMinute(720), plannedDurationMinutes: 240, zoneId: "z1" }),
  ];
  const allocation = smart(tasks, { operatorCapacityMinutes: 1000 });

  assert.equal(allocation.audit.unassignedTaskCount, 0);
  assert.equal(allocation.audit.loadSpreadMinutes <= 480, true);
}

{
  const tasks = [
    makeTask({ id: "left", wbs: "1", name: "Left", plannedStart: atMinute(0), plannedDurationMinutes: 120 }),
    makeTask({ id: "right", wbs: "2", name: "Right", plannedStart: atMinute(0), plannedDurationMinutes: 120 }),
  ];
  const allocation = smart(tasks);

  assert.deepEqual(operatorIds("left", allocation.tasks), ["A"]);
  assert.deepEqual(operatorIds("right", allocation.tasks), ["B"]);
  assert.equal(
    validateOperatorAllocations({
      availableOperatorIds: ["A", "B"],
      demandQuantity: 1,
      operatorCapacityMinutes: 480,
      taktMinutes: 480,
      tasks: allocation.tasks,
    }).some((issue) => issue.kind === "schedule_conflict"),
    false,
  );
  assert.equal(allocation.audit.scheduleConflictCount, 0);
  assert.equal(allocation.audit.peakManpower, 2);
}

{
  const tasks = [
    makeTask({ id: "assigned", wbs: "1", name: "Assigned", plannedStart: atMinute(0), plannedDurationMinutes: 60, plannedOperators: 1, customFields: { operatorIds: ["A"] } }),
    makeTask({ id: "unassigned", wbs: "2", name: "Unassigned", plannedStart: atMinute(60), plannedDurationMinutes: 120 }),
  ];
  const kpis = calculateProductKpis(makeProduct(), [makeStation()], tasks);

  assert.equal(kpis.assignedPlannedManHours, 1);
  assert.equal(kpis.unassignedPlannedManHours, 2);
  assert.equal(kpis.plannedManHours, 3);
  assert.equal(kpis.unassignedTaskCount, 1);
}

{
  const tasks = [
    makeTask({ id: "long", wbs: "1", name: "Long task", plannedStart: atMinute(0), plannedDurationMinutes: 600 }),
  ];
  const allocation = smart(tasks);

  assert.deepEqual(operatorIds("long", allocation.tasks), []);
  assert.equal(allocation.issues.some((issue) => issue.kind === "unassigned_task" && issue.severity === "blocker"), true);
  assert.equal(allocation.audit.unassignedTaskCount, 1);
  assert.equal(allocation.audit.blockerCount, 1);
}

{
  const tasks = [
    makeTask({ id: "over-takt", wbs: "1", name: "Over takt", plannedStart: atMinute(0), plannedDurationMinutes: 120 }),
  ];
  const allocation = smart(tasks, { taktMinutes: 60 });

  assert.deepEqual(operatorIds("over-takt", allocation.tasks), ["A"]);
  assert.equal(allocation.issues.some((issue) => issue.kind === "takt_overage" && issue.severity === "warning"), true);
  assert.equal(allocation.audit.taktOverageCount, 1);
  assert.equal(allocation.audit.warningCount, 1);
}

{
  const tasks = [
    makeTask({ id: "left", wbs: "1", name: "Left", plannedStart: atMinute(0), plannedDurationMinutes: 120 }),
    makeTask({ id: "right", wbs: "2", name: "Right", plannedStart: atMinute(0), plannedDurationMinutes: 120 }),
    makeTask({ id: "later", wbs: "3", name: "Later", plannedStart: atMinute(120), plannedDurationMinutes: 60 }),
  ];
  const allocation = buildOperatorAssignmentsFromIePlan({
    assignments: [
      { taskId: "left", operatorIds: ["A"], rationale: "Start one side with A." },
      { taskId: "right", operatorIds: ["B"], rationale: "Parallel work requires B." },
      { taskId: "later", operatorIds: ["A"], rationale: "A can continue after left finishes." },
    ],
    availableOperatorIds: ["A", "B"],
    demandQuantity: 1,
    operatorCapacityMinutes: 480,
    taktMinutes: 480,
    tasks,
  });

  assert.deepEqual(operatorIds("left", allocation.tasks), ["A"]);
  assert.deepEqual(operatorIds("right", allocation.tasks), ["B"]);
  assert.deepEqual(operatorIds("later", allocation.tasks), ["A"]);
  assert.equal(allocation.audit.assignmentCoveragePercent, 100);
  assert.equal(allocation.audit.scheduleConflictCount, 0);
}

{
  const tasks = [
    makeTask({ id: "left", wbs: "1", name: "Left", plannedStart: atMinute(0), plannedDurationMinutes: 120 }),
    makeTask({ id: "right", wbs: "2", name: "Right", plannedStart: atMinute(60), plannedDurationMinutes: 120 }),
  ];
  const allocation = buildOperatorAssignmentsFromIePlan({
    assignments: [
      { taskId: "left", operatorIds: ["A"], rationale: "Invalid test plan." },
      { taskId: "right", operatorIds: ["A"], rationale: "Invalid test plan." },
    ],
    availableOperatorIds: ["A", "B"],
    demandQuantity: 1,
    operatorCapacityMinutes: 480,
    taktMinutes: 480,
    tasks,
  });

  assert.equal(allocation.audit.scheduleConflictCount, 1);
  assert.equal(allocation.issues.some((issue) => issue.kind === "schedule_conflict"), true);
}

{
  const tasks = [
    makeTask({
      id: "summary",
      wbs: "1",
      name: "Summary",
      plannedStart: atMinute(0),
      plannedDurationMinutes: 120,
      plannedOperators: 1,
      customFields: { operatorIds: ["B"] },
    }),
    makeTask({ id: "child-a", wbs: "1.1", name: "Child A", plannedStart: atMinute(0), plannedDurationMinutes: 60, zoneId: "z1" }),
    makeTask({ id: "child-b", wbs: "1.2", name: "Child B", plannedStart: atMinute(60), plannedDurationMinutes: 60, zoneId: "z1" }),
  ];
  const allocation = smart(tasks);

  assert.equal(isAllocatableOperatorTask(tasks[0], tasks), false);
  assert.deepEqual(operatorIds("summary", allocation.tasks), []);
  assert.deepEqual(operatorIds("child-a", allocation.tasks), ["A"]);
  assert.deepEqual(operatorIds("child-b", allocation.tasks), ["A"]);
  assert.equal(allocation.audit.summaryTaskCount, 1);
  assert.equal(allocation.audit.summaryTaskAssignmentCount, 0);
}

console.log("Smart allocation smoke checks passed.");
