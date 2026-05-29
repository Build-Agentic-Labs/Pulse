import { describe, expect, it } from "vitest";

import {
  DEFAULT_TAKT_TOLERANCE,
  applyCalculatedFields,
  calculateAvailabilityMinutesForDemandPeriod,
  calculateAvailableMinutes,
  calculateAvailableWorkDaysPerMonth,
  calculateLineBalanceScore,
  calculateMonthlyAvailableMinutes,
  calculatePlannedCycleMinutes,
  calculateProductPlannedManHours,
  calculateStationCycleMinutes,
  calculateStationManHours,
  calculateTaktMinutes,
  calculateTaktStatus,
  calculateTaskManHours,
  calculateWeeklyAvailableMinutes,
  calculateYearlyAvailableMinutes,
  findBottleneckStation,
  formatMinutes,
  getTaskWindow,
  getTopLevelTasks,
  minutesToHours,
  round,
} from "./calculations";
import type { Product, Station, Task } from "./types";

// --- Typed factories: full valid objects with selective overrides -----------

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Widget",
    revision: "A",
    ownerName: "Owner",
    status: "draft",
    targetManHours: 0,
    demandQuantity: 0,
    demandPeriod: "day",
    grossAvailableMinutes: 480,
    breakMinutes: 30,
    lunchMinutes: 30,
    meetingMinutes: 0,
    plannedDowntimeMinutes: 0,
    workDaysPerWeek: 5,
    workWeeksPerMonth: 4,
    availableWorkDaysPerMonth: 0,
    netAvailableMinutes: 0,
    weeklyAvailableMinutes: 0,
    monthlyAvailableMinutes: 0,
    calculatedTaktMinutes: 0,
    activeTaktMinutes: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: "s1",
    scenarioId: "sc1",
    sequence: 1,
    name: "Station 1",
    ownerName: "Owner",
    plannedCycleMinutes: 0,
    plannedOperators: 1,
    plannedManHours: 0,
    taktStatus: "missing",
    bottleneckFlag: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    scenarioId: "sc1",
    stationId: "s1",
    rowType: "task",
    wbs: "1",
    name: "Task 1",
    plannedStart: "2026-01-01T08:00:00Z",
    plannedFinish: "2026-01-01T09:00:00Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
    ...overrides,
  };
}

// --- Pure number helpers -----------------------------------------------------

describe("round", () => {
  it("rounds to one decimal by default", () => {
    expect(round(1.26)).toBe(1.3);
    expect(round(1.24)).toBe(1.2);
  });
  it("honors a custom precision", () => {
    expect(round(1.2345, 2)).toBe(1.23);
  });
  it("returns 0 for non-finite input", () => {
    expect(round(Number.NaN)).toBe(0);
    expect(round(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("minutesToHours", () => {
  it("divides minutes by 60", () => {
    expect(minutesToHours(90)).toBe(1.5);
  });
});

describe("formatMinutes", () => {
  it("formats sub-hour values", () => {
    expect(formatMinutes(59)).toBe("59m");
  });
  it("formats whole hours", () => {
    expect(formatMinutes(60)).toBe("1h");
  });
  it("formats hours and minutes", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(125)).toBe("2h 5m");
  });
  it("clamps negatives and non-finite to 0m", () => {
    expect(formatMinutes(-5)).toBe("0m");
    expect(formatMinutes(Number.NaN)).toBe("0m");
  });
});

// --- Availability calculations ----------------------------------------------

describe("availability calculations", () => {
  it("subtracts breaks/lunch/meetings/downtime and clamps at 0", () => {
    expect(calculateAvailableMinutes(makeProduct())).toBe(420); // 480-30-30
    const drained = makeProduct({ grossAvailableMinutes: 10, breakMinutes: 100 });
    expect(calculateAvailableMinutes(drained)).toBe(0);
  });
  it("scales weekly / monthly / yearly off net available minutes", () => {
    const product = makeProduct();
    expect(calculateWeeklyAvailableMinutes(product)).toBe(2100); // 420*5
    expect(calculateAvailableWorkDaysPerMonth(product)).toBe(20); // 5*4
    expect(calculateMonthlyAvailableMinutes(product)).toBe(8400); // 420*20
    expect(calculateYearlyAvailableMinutes(product)).toBe(100800); // 8400*12
  });
  it("selects the right period basis for demand", () => {
    expect(calculateAvailabilityMinutesForDemandPeriod(makeProduct({ demandPeriod: "week" }))).toBe(2100);
    expect(calculateAvailabilityMinutesForDemandPeriod(makeProduct({ demandPeriod: "month" }))).toBe(8400);
    expect(calculateAvailabilityMinutesForDemandPeriod(makeProduct({ demandPeriod: "year" }))).toBe(100800);
    expect(calculateAvailabilityMinutesForDemandPeriod(makeProduct({ demandPeriod: "day" }))).toBe(420);
  });
});

describe("calculateTaktMinutes", () => {
  it("uses the manual override when positive", () => {
    expect(calculateTaktMinutes(makeProduct({ manualTaktMinutes: 12, demandQuantity: 10 }))).toBe(12);
  });
  it("returns 0 when demand is not positive", () => {
    expect(calculateTaktMinutes(makeProduct({ demandQuantity: 0 }))).toBe(0);
  });
  it("divides available period minutes by demand", () => {
    expect(calculateTaktMinutes(makeProduct({ demandPeriod: "day", demandQuantity: 10 }))).toBe(42); // 420/10
  });
});

// --- Task / station rollups --------------------------------------------------

describe("man-hour rollups", () => {
  it("computes per-task man hours", () => {
    expect(calculateTaskManHours({ plannedDurationMinutes: 60, plannedOperators: 2 })).toBe(2);
  });
  it("sums station cycle and man hours by station id", () => {
    const tasks = [
      makeTask({ id: "a", stationId: "s1", plannedDurationMinutes: 30, plannedOperators: 2 }),
      makeTask({ id: "b", stationId: "s1", plannedDurationMinutes: 30, plannedOperators: 1 }),
      makeTask({ id: "c", stationId: "s2", plannedDurationMinutes: 99, plannedOperators: 1 }),
    ];
    expect(calculateStationCycleMinutes("s1", tasks)).toBe(60);
    expect(calculateStationManHours("s1", tasks)).toBe(1.5); // (0.5*2)+(0.5*1)
    expect(calculateProductPlannedManHours(tasks)).toBeCloseTo(1.5 + 99 / 60, 5);
  });
});

describe("calculatePlannedCycleMinutes", () => {
  it("spans min start to max finish", () => {
    const tasks = [
      makeTask({ id: "a", plannedStart: "2026-01-01T08:00:00Z", plannedFinish: "2026-01-01T09:00:00Z" }),
      makeTask({ id: "b", plannedStart: "2026-01-01T08:30:00Z", plannedFinish: "2026-01-01T10:00:00Z" }),
    ];
    expect(calculatePlannedCycleMinutes(tasks)).toBe(120); // 08:00 -> 10:00
  });
  it("returns 0 for no tasks", () => {
    expect(calculatePlannedCycleMinutes([])).toBe(0);
  });
});

describe("calculateTaktStatus", () => {
  it("is missing when cycle or takt is non-positive", () => {
    expect(calculateTaktStatus(0, 100)).toBe("missing");
    expect(calculateTaktStatus(50, 0)).toBe("missing");
  });
  it("is green at or under takt", () => {
    expect(calculateTaktStatus(90, 100)).toBe("green");
    expect(calculateTaktStatus(100, 100)).toBe("green");
  });
  it("is yellow within tolerance, red beyond", () => {
    expect(calculateTaktStatus(105, 100)).toBe("yellow"); // <= 110
    expect(calculateTaktStatus(110, 100)).toBe("yellow");
    expect(calculateTaktStatus(120, 100)).toBe("red");
  });
  it("exposes the default tolerance constant", () => {
    expect(DEFAULT_TAKT_TOLERANCE).toBe(0.1);
  });
});

describe("findBottleneckStation", () => {
  it("returns the highest-cycle active station", () => {
    const stations = [
      makeStation({ id: "a", plannedCycleMinutes: 40 }),
      makeStation({ id: "b", plannedCycleMinutes: 90 }),
      makeStation({ id: "c", plannedCycleMinutes: 0 }),
    ];
    expect(findBottleneckStation(stations)?.id).toBe("b");
  });
  it("returns undefined when no station is active", () => {
    expect(findBottleneckStation([makeStation({ plannedCycleMinutes: 0 })])).toBeUndefined();
  });
});

describe("calculateLineBalanceScore", () => {
  it("returns balance percentage relative to the bottleneck", () => {
    const stations = [
      makeStation({ id: "a", plannedCycleMinutes: 50 }),
      makeStation({ id: "b", plannedCycleMinutes: 100 }),
    ];
    expect(calculateLineBalanceScore(stations)).toBe(75); // 150 / (100*2) * 100
  });
  it("returns 0 for empty or zero-work stations", () => {
    expect(calculateLineBalanceScore([])).toBe(0);
    expect(calculateLineBalanceScore([makeStation({ plannedCycleMinutes: 0 })])).toBe(0);
  });
});

describe("getTopLevelTasks", () => {
  it("excludes tasks with a parent", () => {
    const tasks = [makeTask({ id: "root" }), makeTask({ id: "child", parentTaskId: "root" })];
    expect(getTopLevelTasks(tasks).map((task) => task.id)).toEqual(["root"]);
  });
});

describe("getTaskWindow", () => {
  it("computes offset minutes from the timeline start and clamps at 0", () => {
    const start = Date.parse("2026-01-01T08:00:00Z");
    const task = makeTask({ plannedStart: "2026-01-01T08:30:00Z", plannedFinish: "2026-01-01T09:00:00Z" });
    expect(getTaskWindow(task, start)).toEqual({ startMinute: 30, finishMinute: 60 });
    const earlier = makeTask({ plannedStart: "2026-01-01T07:00:00Z", plannedFinish: "2026-01-01T07:30:00Z" });
    expect(getTaskWindow(earlier, start)).toEqual({ startMinute: 0, finishMinute: 0 });
  });
});

describe("applyCalculatedFields", () => {
  it("derives product/station/task fields and flags the bottleneck", () => {
    const product = makeProduct({ demandPeriod: "day", demandQuantity: 10 });
    const stations = [makeStation({ id: "s1" }), makeStation({ id: "s2" })];
    const tasks = [
      makeTask({ id: "a", stationId: "s1", plannedDurationMinutes: 30, plannedOperators: 2 }),
      makeTask({ id: "b", stationId: "s2", plannedDurationMinutes: 90, plannedOperators: 1 }),
    ];

    const result = applyCalculatedFields(product, stations, tasks);

    expect(result.product.netAvailableMinutes).toBe(420);
    expect(result.product.calculatedTaktMinutes).toBe(42);
    expect(result.tasks.find((task) => task.id === "a")?.plannedManHours).toBe(1); // 0.5h * 2
    const s2 = result.stations.find((station) => station.id === "s2");
    expect(s2?.plannedCycleMinutes).toBe(90);
    expect(s2?.bottleneckFlag).toBe(true); // 90 > 30
    expect(result.stations.find((station) => station.id === "s1")?.bottleneckFlag).toBe(false);
  });
});
