import { describe, expect, it } from "vitest";

import {
  buildProcessStationForTask,
  compareTasksByWbs,
  compareWbsValues,
  getTaskProcessNumber,
  getTaskWbsSuffix,
  normalizeTaskGroupZones,
  normalizeTaskPlanningContext,
  stationIdForUnzoned,
  stationIdForZone,
} from "./task-planning";
import type { Station, Task, Zone } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    scenarioId: "sc1",
    stationId: "s1",
    rowType: "task",
    wbs: "1",
    name: "Task",
    plannedStart: "2026-01-01T08:00:00.000Z",
    plannedFinish: "2026-01-01T09:00:00.000Z",
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

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "z1",
    scenarioId: "sc1",
    sequence: 1,
    name: "Zone 1",
    color: "#fff",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getTaskProcessNumber / getTaskWbsSuffix", () => {
  it("splits the WBS into process and suffix", () => {
    expect(getTaskProcessNumber(makeTask({ wbs: "3.2.1" }))).toBe("3");
    expect(getTaskProcessNumber(makeTask({ wbs: "5" }))).toBe("5");
    expect(getTaskWbsSuffix(makeTask({ wbs: "3.2.1" }))).toBe("2.1");
    expect(getTaskWbsSuffix(makeTask({ wbs: "5" }))).toBe("");
  });
});

describe("normalizeTaskGroupZones", () => {
  it("propagates the top-level task's zone to its sub-tasks", () => {
    const tasks = [
      makeTask({ id: "A", wbs: "1", zoneId: "z1" }),
      makeTask({ id: "B", wbs: "1.1", zoneId: undefined }),
      makeTask({ id: "C", wbs: "2", zoneId: "z2" }),
    ];
    const next = normalizeTaskGroupZones(tasks);
    expect(next.find((task) => task.id === "B")?.zoneId).toBe("z1"); // inherits from A
    expect(next.find((task) => task.id === "C")?.zoneId).toBe("z2");
  });
});

describe("stationIdForZone / stationIdForUnzoned", () => {
  it("builds deterministic station ids", () => {
    expect(stationIdForZone("z1")).toBe("station-z1");
    expect(stationIdForUnzoned("sc1")).toBe("station-sc1-unzoned");
  });
});

describe("normalizeTaskPlanningContext", () => {
  it("assigns zone tasks to a generated zone station", () => {
    const tasks = [makeTask({ id: "A", wbs: "1", zoneId: "z1", scenarioId: "sc1" })];
    const zones = [makeZone({ id: "z1", name: "Welding", scenarioId: "sc1", sequence: 1 })];

    const result = normalizeTaskPlanningContext(tasks, zones, [], "sc1");

    expect(result.tasks[0].stationId).toBe("station-z1");
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0].id).toBe("station-z1");
    expect(result.stations[0].name).toBe("Welding");
  });

  it("routes tasks without a zone into an Unzoned station", () => {
    const tasks = [makeTask({ id: "A", wbs: "1", zoneId: undefined, scenarioId: "sc1" })];

    const result = normalizeTaskPlanningContext(tasks, [], [], "sc1");

    expect(result.tasks[0].stationId).toBe("station-sc1-unzoned");
    expect(result.stations.some((station) => station.name === "Unzoned")).toBe(true);
  });

  // Regression (2026-10-03): with no zones, an Unzoned station that was already saved came back
  // twice (once generated, once passed through as an in-use station), and the stations upsert failed
  // with 21000. Every later shell save of a zero-zone product failed after a partial write.
  function makeStation(overrides: Partial<Station> = {}): Station {
    return {
      id: "s1",
      scenarioId: "sc1",
      sequence: 1,
      name: "Station",
      ownerName: "",
      plannedCycleMinutes: 0,
      plannedOperators: 1,
      plannedManHours: 0,
      taktStatus: "missing",
      bottleneckFlag: false,
      ...overrides,
    };
  }
  const unzonedId = stationIdForUnzoned("sc1");
  const savedUnzoned = makeStation({ id: unzonedId, name: "Unzoned", area: "Unzoned", description: "Kept" });

  it("keeps one Unzoned station when it already exists, deriving repeatedly", () => {
    const tasks = [
      makeTask({ id: "A", wbs: "1", stationId: unzonedId }),
      makeTask({ id: "B", wbs: "2", stationId: unzonedId }),
    ];
    const first = normalizeTaskPlanningContext(tasks, [], [savedUnzoned], "sc1");
    const second = normalizeTaskPlanningContext(first.tasks, [], first.stations, "sc1");
    const third = normalizeTaskPlanningContext(second.tasks, [], second.stations, "sc1");

    for (const result of [first, second, third]) {
      expect(result.stations.map((station) => station.id)).toEqual([unzonedId]);
      expect(result.tasks.map((task) => task.stationId)).toEqual([unzonedId, unzonedId]);
    }
    // The generated Unzoned station still carries the saved description.
    expect(third.stations[0]?.description).toBe("Kept");
  });

  it("still passes through other in-use stations of a zero-zone product, each once", () => {
    const legacy = makeStation({ id: "legacy-station", name: "Legacy" });
    const tasks = [
      makeTask({ id: "A", wbs: "1", stationId: unzonedId }),
      makeTask({ id: "B", wbs: "2", stationId: "legacy-station" }),
    ];
    // A state that already holds a duplicate (from before this fix) is collapsed too.
    const result = normalizeTaskPlanningContext(tasks, [], [savedUnzoned, legacy, savedUnzoned, legacy], "sc1");

    expect(result.stations.map((station) => station.id)).toEqual([unzonedId, "legacy-station"]);
    expect(result.stations[1]).toBe(legacy);
    expect(result.tasks.map((task) => task.stationId)).toEqual([unzonedId, "legacy-station"]);
  });

  it("leaves a zoned product's stations unchanged", () => {
    const zones = [makeZone({ id: "z1", name: "Welding" })];
    const tasks = [
      makeTask({ id: "A", wbs: "1", zoneId: "z1", stationId: "station-z1" }),
      makeTask({ id: "B", wbs: "2", stationId: unzonedId }),
    ];
    const stations = [makeStation({ id: "station-z1", name: "Welding" }), savedUnzoned, makeStation({ id: "orphan" })];
    const result = normalizeTaskPlanningContext(tasks, zones, stations, "sc1");

    expect(result.stations.map((station) => station.id)).toEqual(["station-z1", unzonedId]);
    expect(result.tasks.map((task) => task.stationId)).toEqual(["station-z1", unzonedId]);
  });
});

describe("buildProcessStationForTask", () => {
  it("rolls a WBS process group up into a synthetic station", () => {
    const tasks = [
      makeTask({ id: "A", wbs: "1", name: "Process A", plannedDurationMinutes: 30, plannedOperators: 2 }),
      makeTask({ id: "B", wbs: "1.1", plannedDurationMinutes: 30, plannedOperators: 1 }),
      makeTask({ id: "C", wbs: "2", plannedDurationMinutes: 90 }),
    ];

    const station: Station = buildProcessStationForTask(tasks[0], tasks, "A");

    expect(station.id).toBe("A");
    expect(station.name).toBe("Process A");
    expect(station.sequence).toBe(1);
    expect(station.plannedCycleMinutes).toBe(60); // 30 + 30 (process "1" only)
    expect(station.plannedManHours).toBe(1.5); // 0.5h*2 + 0.5h*1
    expect(station.plannedOperators).toBe(2); // from top-level task
    expect(station.bottleneckFlag).toBe(true); // id matches bottleneckStationId
  });
});

describe("compareWbsValues", () => {
  it("collates numerically per segment, not lexically", () => {
    expect(compareWbsValues("2", "10")).toBeLessThan(0);
    expect(compareWbsValues("1.2", "1.10")).toBeLessThan(0);
    expect(compareWbsValues("1.10", "1.2")).toBeGreaterThan(0);
  });

  it("sorts a parent before its children", () => {
    expect(compareWbsValues("1", "1.1")).toBeLessThan(0);
    expect(compareWbsValues("1.1.1", "1.1")).toBeGreaterThan(0);
  });

  it("returns 0 for identical values", () => {
    expect(compareWbsValues("3.2.1", "3.2.1")).toBe(0);
  });

  it("orders non-numeric segments with numeric-aware comparison", () => {
    expect(compareWbsValues("1.a2", "1.a10")).toBeLessThan(0);
    expect(compareWbsValues("1.A", "1.b")).toBeLessThan(0);
  });
});

describe("compareTasksByWbs", () => {
  it("orders by WBS first", () => {
    const a = makeTask({ id: "a", wbs: "2", name: "Zeta" });
    const b = makeTask({ id: "b", wbs: "10", name: "Alpha" });
    expect(compareTasksByWbs(a, b)).toBeLessThan(0);
  });

  it("breaks WBS ties by task name", () => {
    const a = makeTask({ id: "a", wbs: "1.1", name: "Assemble" });
    const b = makeTask({ id: "b", wbs: "1.1", name: "Weld" });
    expect(compareTasksByWbs(a, b)).toBeLessThan(0);
    expect(compareTasksByWbs(b, a)).toBeGreaterThan(0);
  });
});
