import { describe, expect, it } from "vitest";

import { emptyPlannerState } from "./empty-planner-state";
import {
  savePlannerShellToSupabase,
  savePlannerStateToSupabase,
  upsertWouldCollideOnSequence,
} from "./supabase-planner";
import type { PlannerState, Station, Task, Zone } from "./types";

// Regression for the 2026-09-11 new-user save failure. `stations` and `zones` carry
// UNIQUE (scenario_id, sequence). The planner save upserts stations/zones FIRST and deletes
// stale rows LAST (the task FKs are ON DELETE SET NULL, so deleting early would blank
// task.station_id). When a zone's derived station takes the sequence a stale "Unzoned"
// station still holds, the upsert must not be allowed to hit the unique index.

const NOW = "2026-09-11T15:17:43.000Z";
const SCENARIO_ID = "scenario-1";
const UNZONED_STATION_ID = `station-${SCENARIO_ID}-unzoned`;

type RecordedCall = {
  table: string;
  op: "select" | "upsert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

function createRecordingClient(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: RecordedCall[] = [];

  class Query {
    private current: RecordedCall | undefined;

    constructor(private readonly table: string) {}

    private record(op: RecordedCall["op"], payload?: unknown) {
      this.current = { table: this.table, op, payload, filters: [] };
      calls.push(this.current);
      return this;
    }

    select() {
      return this.record("select");
    }

    upsert(payload: unknown) {
      return this.record("upsert", payload);
    }

    update(payload: unknown) {
      return this.record("update", payload);
    }

    delete() {
      return this.record("delete");
    }

    eq(column: string, value: unknown) {
      this.current?.filters.push([column, value]);
      return this;
    }

    in(column: string, value: unknown) {
      this.current?.filters.push([column, value]);
      return this;
    }

    or(filter: string) {
      this.current?.filters.push(["or", filter]);
      return this;
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const data = this.current?.op === "select" ? (rows[this.table] ?? []) : null;
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from(table: string) {
      return new Query(table);
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { client, calls };
}

function station(id: string, sequence: number, name: string): Station {
  return {
    id,
    scenarioId: SCENARIO_ID,
    sequence,
    name,
    ownerName: "",
    plannedCycleMinutes: 0,
    plannedOperators: 1,
    plannedManHours: 0,
    taktStatus: "missing",
    bottleneckFlag: false,
    area: name,
  };
}

function zone(id: string, sequence: number, name: string): Zone {
  return {
    id,
    scenarioId: SCENARIO_ID,
    sequence,
    name,
    color: "#15756d",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function task(id: string, stationId: string, zoneId?: string): Task {
  return {
    id,
    scenarioId: SCENARIO_ID,
    stationId,
    zoneId,
    rowType: "task",
    wbs: "1",
    name: "Install Telematic",
    description: "",
    plannedStart: "0h",
    plannedFinish: "1h",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 1,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    safetyNotes: "",
    manufacturingSteps: [],
    partReferences: [],
    customFields: {},
    version: 1,
  };
}

function plannerState(overrides: Partial<PlannerState>): PlannerState {
  return {
    ...emptyPlannerState,
    product: { ...emptyPlannerState.product, id: "product-1", projectId: "project-1" },
    scenario: { ...emptyPlannerState.scenario, id: SCENARIO_ID, productId: "product-1" },
    ...overrides,
  };
}

// Patrick's exact shape: the first save wrote an Unzoned station at sequence 1; the user then
// created a first zone (sequence 1) and moved every task into it.
function firstZoneAfterUnzonedSave() {
  const rows = {
    tasks: [{ id: "task-1" }],
    stations: [{ id: UNZONED_STATION_ID, sequence: 1 }],
    zones: [],
    manufacturing_components: [],
    document_type_codes: [],
    custom_columns: [],
    task_dependencies: [],
  };
  const state = plannerState({
    zones: [zone("zone-1", 1, "Assembly")],
    stations: [station("station-zone-1", 1, "Assembly")],
    tasks: [task("task-1", "station-zone-1", "zone-1")],
  });
  return { rows, state };
}

function indexOf(calls: RecordedCall[], table: string, op: RecordedCall["op"]) {
  return calls.findIndex((call) => call.table === table && call.op === op);
}

function sequenceBumps(calls: RecordedCall[], table: string) {
  return calls.filter(
    (call) =>
      call.table === table &&
      call.op === "update" &&
      typeof (call.payload as { sequence?: unknown })?.sequence === "number",
  );
}

describe("upsertWouldCollideOnSequence", () => {
  it("flags a new row taking the sequence a stale row still holds", () => {
    expect(
      upsertWouldCollideOnSequence(
        [{ id: "station-zone-1", sequence: 1 }],
        [{ id: UNZONED_STATION_ID, sequence: 1 }],
      ),
    ).toBe(true);
  });

  it("flags kept rows that swap sequences", () => {
    expect(
      upsertWouldCollideOnSequence(
        [
          { id: "zone-a", sequence: 2 },
          { id: "zone-b", sequence: 1 },
        ],
        [
          { id: "zone-a", sequence: 1 },
          { id: "zone-b", sequence: 2 },
        ],
      ),
    ).toBe(true);
  });

  it("stays quiet when every row keeps its own sequence or takes a free one", () => {
    expect(
      upsertWouldCollideOnSequence(
        [
          { id: "zone-a", sequence: 1 },
          { id: "zone-c", sequence: 3 },
        ],
        [
          { id: "zone-a", sequence: 1 },
          { id: "zone-b", sequence: 2 },
        ],
      ),
    ).toBe(false);
  });

  it("stays quiet with no existing rows", () => {
    expect(upsertWouldCollideOnSequence([{ id: "zone-a", sequence: 1 }], [])).toBe(false);
  });

  it("tolerates database sequences arriving as strings", () => {
    expect(
      upsertWouldCollideOnSequence([{ id: "station-zone-1", sequence: 1 }], [{ id: "other", sequence: "1" }]),
    ).toBe(true);
  });
});

describe.each([
  ["savePlannerShellToSupabase", savePlannerShellToSupabase],
  ["savePlannerStateToSupabase", savePlannerStateToSupabase],
] as const)("%s station sequence collisions", (_name, save) => {
  it("parks the stale station's sequence out of range before upserting the new station", async () => {
    const { rows, state } = firstZoneAfterUnzonedSave();
    const { client, calls } = createRecordingClient(rows);

    await save(state, client as never);

    const bumps = sequenceBumps(calls, "stations");
    expect(bumps).toHaveLength(1);
    expect(bumps[0].filters).toEqual([["id", UNZONED_STATION_ID]]);
    expect((bumps[0].payload as { sequence: number }).sequence).toBeGreaterThanOrEqual(100000);

    const bumpIndex = calls.indexOf(bumps[0]);
    const upsertIndex = indexOf(calls, "stations", "upsert");
    expect(upsertIndex).toBeGreaterThan(bumpIndex);
    expect(calls[upsertIndex].payload).toEqual([expect.objectContaining({ id: "station-zone-1", sequence: 1 })]);
  });

  it("still deletes the stale station only after tasks have been re-pointed", async () => {
    const { rows, state } = firstZoneAfterUnzonedSave();
    const { client, calls } = createRecordingClient(rows);

    await save(state, client as never);

    const deleteIndex = indexOf(calls, "stations", "delete");
    expect(deleteIndex).toBeGreaterThan(indexOf(calls, "tasks", "upsert"));
    expect(calls[deleteIndex].filters).toEqual([["id", [UNZONED_STATION_ID]]]);
  });

  it("reads station sequences so the collision check has something to compare", async () => {
    const { rows, state } = firstZoneAfterUnzonedSave();
    const { client, calls } = createRecordingClient(rows);

    await save(state, client as never);

    expect(sequenceBumps(calls, "stations")).toHaveLength(1);
  });

  it("does not touch sequences when nothing collides", async () => {
    const rows = {
      tasks: [{ id: "task-1" }],
      stations: [{ id: "station-zone-1", sequence: 1 }],
      zones: [{ id: "zone-1", sequence: 1 }],
      manufacturing_components: [],
      document_type_codes: [],
      custom_columns: [],
      task_dependencies: [],
    };
    const state = plannerState({
      zones: [zone("zone-1", 1, "Assembly")],
      stations: [station("station-zone-1", 1, "Assembly")],
      tasks: [task("task-1", "station-zone-1", "zone-1")],
    });
    const { client, calls } = createRecordingClient(rows);

    await save(state, client as never);

    expect(sequenceBumps(calls, "stations")).toHaveLength(0);
    expect(sequenceBumps(calls, "zones")).toHaveLength(0);
  });
});

describe.each([
  ["savePlannerShellToSupabase", savePlannerShellToSupabase],
  ["savePlannerStateToSupabase", savePlannerStateToSupabase],
] as const)("%s zone sequence collisions", (_name, save) => {
  it("parks every existing zone out of range before a reorder swaps sequences", async () => {
    const rows = {
      tasks: [{ id: "task-1" }],
      stations: [
        { id: "station-zone-a", sequence: 1 },
        { id: "station-zone-b", sequence: 2 },
      ],
      zones: [
        { id: "zone-a", sequence: 1 },
        { id: "zone-b", sequence: 2 },
      ],
      manufacturing_components: [],
      document_type_codes: [],
      custom_columns: [],
      task_dependencies: [],
    };
    const state = plannerState({
      zones: [zone("zone-a", 2, "Assembly"), zone("zone-b", 1, "Kitting")],
      stations: [station("station-zone-a", 2, "Assembly"), station("station-zone-b", 1, "Kitting")],
      tasks: [task("task-1", "station-zone-a", "zone-a")],
    });
    const { client, calls } = createRecordingClient(rows);

    await save(state, client as never);

    const zoneBumps = sequenceBumps(calls, "zones");
    expect(zoneBumps.map((bump) => bump.filters)).toEqual([[["id", "zone-a"]], [["id", "zone-b"]]]);
    expect(new Set(zoneBumps.map((bump) => (bump.payload as { sequence: number }).sequence)).size).toBe(2);
    expect(Math.max(...calls.filter((call) => zoneBumps.includes(call)).map((call) => calls.indexOf(call)))).toBeLessThan(
      indexOf(calls, "zones", "upsert"),
    );

    const stationBumps = sequenceBumps(calls, "stations");
    expect(stationBumps).toHaveLength(2);
    expect(Math.max(...stationBumps.map((call) => calls.indexOf(call)))).toBeLessThan(indexOf(calls, "stations", "upsert"));
  });
});
