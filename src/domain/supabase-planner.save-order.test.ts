// Request-order characterization of the two guarded whole-plan saves Phase 5 moves into
// src/lib/planner/shell-store.ts. These saves are separate requests, not a transaction, so their
// ORDER is the safety property: every existence read first, the deletion tripwire before the first
// write, parents before children (sequence parking before station/zone upserts), and stale rows
// deleted last in foreign-key order. Every request is pinned here, with stale rows in each table.
import { describe, expect, it, vi } from "vitest";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import { emptyPlannerState } from "./empty-planner-state";
import { savePlannerShellToSupabase, savePlannerStateToSupabase } from "./supabase-planner";
import type { PlannerState } from "./types";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const NOW = "2026-10-03T12:00:00.000Z";
type Client = NonNullable<Parameters<typeof savePlannerShellToSupabase>[1]>;

const state = {
  ...emptyPlannerState,
  product: { ...emptyPlannerState.product, id: "product-1", projectId: "proj-1" },
  scenario: { ...emptyPlannerState.scenario, id: "scenario-1", productId: "product-1" },
  stations: [{ id: "station-1", scenarioId: "scenario-1", sequence: 1, name: "S1" }],
  zones: [{ id: "zone-1", scenarioId: "scenario-1", sequence: 1, name: "Z1", createdAt: NOW, updatedAt: NOW }],
  components: [{ id: "comp-1", scenarioId: "scenario-1", code: "C", name: "C", sequence: 1 }],
  documentTypes: [{ id: "doc-1", productId: "product-1", code: "WI", name: "WI", active: true, createdAt: NOW, updatedAt: NOW }],
  tasks: [
    { id: "task-1", scenarioId: "scenario-1", stationId: "station-1", name: "A", customFields: {}, manufacturingSteps: [], partReferences: [] },
    { id: "task-2", scenarioId: "scenario-1", stationId: "station-1", name: "B", customFields: {}, manufacturingSteps: [], partReferences: [] },
  ],
  dependencies: [{ id: "dep-1", predecessorTaskId: "task-1", successorTaskId: "task-2", type: "FS" }],
  customColumns: [{ id: "col-1", productId: "product-1", name: "Owner", key: "owner", type: "text" }],
} as unknown as PlannerState;

// Each table holds one kept row and one stale row; the stale station/zone holds sequence 1.
const existing: Record<string, Array<Record<string, unknown>>> = {
  tasks: [{ id: "task-1" }, { id: "task-2" }, { id: "stale-task" }],
  stations: [{ id: "station-1", sequence: 2 }, { id: "stale-station", sequence: 1 }],
  zones: [{ id: "zone-1", sequence: 2 }, { id: "stale-zone", sequence: 1 }],
  manufacturing_components: [{ id: "comp-1" }, { id: "stale-comp" }],
  document_type_codes: [{ id: "doc-1" }, { id: "stale-doc" }],
  custom_columns: [{ id: "col-1" }, { id: "stale-col" }],
  task_dependencies: [{ id: "dep-1" }, { id: "stale-dep" }],
};

function recorder(rows = existing) {
  return createRecordingSupabase({
    reply: (request: RecordedRequest): ScriptedReply | undefined =>
      request.kind === "from" && request.op === "select" ? { data: rows[request.target] ?? [] } : undefined,
  });
}

const EXISTENCE_READS = [
  "tasks.select(id) scenario_id=scenario-1",
  "stations.select(id,sequence) scenario_id=scenario-1",
  "zones.select(id,sequence) scenario_id=scenario-1",
  "manufacturing_components.select(id) scenario_id=scenario-1",
  "document_type_codes.select(id) or(project_id.eq.proj-1,product_id.eq.product-1)",
  "custom_columns.select(id) or(product_id.eq.product-1,scenario_id.eq.scenario-1)",
];
const PARENT_WRITES = [
  "products.upsert",
  "scenarios.upsert",
  "stations.update id=station-1",
  "stations.update id=stale-station",
  "stations.upsert",
  "zones.update id=zone-1",
  "zones.update id=stale-zone",
  "zones.upsert",
  "manufacturing_components.upsert",
  "document_type_codes.upsert",
  "tasks.upsert",
];
const STALE_DELETES = [
  "custom_columns.upsert",
  "tasks.delete id in [stale-task]",
  "zones.delete id in [stale-zone]",
  "manufacturing_components.delete id in [stale-comp]",
  "document_type_codes.delete id in [stale-doc]",
  "stations.delete id in [stale-station]",
  "custom_columns.delete id in [stale-col]",
];

describe("whole-plan save request order", () => {
  it("full save: reads, tripwire, parents, atomic child replacement, then stale deletes", async () => {
    const db = recorder();
    await savePlannerStateToSupabase(state, db.client as unknown as Client);
    expect(db.lines()).toEqual([...EXISTENCE_READS, ...PARENT_WRITES, "rpc:replace_task_children", ...STALE_DELETES]);
    const replace = db.requests.find((r) => r.target === "replace_task_children")!;
    expect(replace.payload).toMatchObject({ p_task_ids: ["task-1", "task-2", "stale-task"] });
    expect(db.requests.filter((r) => r.op === "update").map((r) => r.payload)).toEqual([
      { sequence: 100003 }, { sequence: 100004 }, { sequence: 100003 }, { sequence: 100004 },
    ]);
  });

  it("shell save: same order, with dependencies synced in place of the child replacement", async () => {
    const db = recorder();
    await savePlannerShellToSupabase(state, db.client as unknown as Client);
    expect(db.lines()).toEqual([
      ...EXISTENCE_READS, ...PARENT_WRITES,
      "task_dependencies.select(id) successor_task_id in [task-1,task-2]",
      "task_dependencies.upsert",
      "task_dependencies.delete id in [stale-dep]",
      ...STALE_DELETES,
    ]);
    expect(db.requests.some((r) => r.target === "replace_task_children")).toBe(false);
  });

  it.each([
    ["full", savePlannerStateToSupabase],
    ["shell", savePlannerShellToSupabase],
  ] as const)("%s save: the tripwire refuses mass deletion before the first write", async (_name, save) => {
    const db = recorder({ ...existing, tasks: ["task-1", "task-2", "x1", "x2", "x3", "x4"].map((id) => ({ id })) });
    await expect(save(state, db.client as unknown as Client)).rejects.toThrow("Refusing to save: this would delete 4 of 6 tasks.");
    expect(db.lines()).toEqual(EXISTENCE_READS);
  });

  it.each([
    ["full", savePlannerStateToSupabase],
    ["shell", savePlannerShellToSupabase],
  ] as const)("%s save: a failed write stops every later request, including stale deletes", async (_name, save) => {
    const db = createRecordingSupabase({
      reply: (r) => (r.target === "tasks" && r.op === "upsert" ? { error: { message: "tasks_station_id_fkey" } }
        : r.kind === "from" && r.op === "select" ? { data: existing[r.target] ?? [] } : undefined),
    });
    await expect(save(state, db.client as unknown as Client)).rejects.toThrow("tasks_station_id_fkey");
    expect(db.lines().at(-1)).toBe("tasks.upsert");
    expect(db.lines().some((line) => line.includes(".delete"))).toBe(false);
  });

  it.each([
    ["full", savePlannerStateToSupabase],
    ["shell", savePlannerShellToSupabase],
  ] as const)("%s save: refuses an empty plan or an unassigned product before any request", async (_name, save) => {
    const db = recorder();
    await expect(save({ ...state, tasks: [] }, db.client as unknown as Client)).rejects.toThrow("Refusing to save an empty Gantt.");
    await expect(save({ ...state, product: { ...state.product, projectId: undefined } }, db.client as unknown as Client))
      .rejects.toThrow("Select a workspace before saving planner data.");
    expect(db.requests).toEqual([]);
  });
});
