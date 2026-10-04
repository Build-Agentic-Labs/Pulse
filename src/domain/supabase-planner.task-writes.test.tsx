// Characterization of the granular task and step writes Phase 5 moves into
// src/lib/planner/task-store.ts: project assertion before any write, request order, step-sequence
// parking, version checks, the procedure save's single retry, task deletion's storage snapshot, and
// the single-task read the retries depend on. Real functions; the recording client is installed as
// the page's planner client (most of these functions take no client parameter).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import type { ManufacturingStep, Task } from "./types";
import {
  deletePlannerTask,
  loadTaskFromSupabase,
  mergeLatestTaskToSupabase,
  moveManufacturingStepToTaskInSupabase,
  reorderProcedureSteps,
  saveManufacturingStepToSupabase,
  saveProcedureTaskUpdateToSupabase,
  saveTaskAndManufacturingStepToSupabase,
  saveTaskCustomFieldsToSupabase,
  saveTaskRowToSupabase,
  saveTasksToSupabase,
  saveTaskToSupabase,
  saveTaskWithManufacturingStepsToSupabase,
  updateTaskFields,
  upsertProcedureStep,
} from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

type Reply = (request: RecordedRequest) => ScriptedReply | undefined;
const scope = globalThis as { __buildlogicPlannerSupabaseClient?: unknown };
const PROJECT = "proj-1";

/** Resolves every task/scenario to PROJECT unless `reply` answers first. */
function install(reply?: Reply) {
  const db = createRecordingSupabase({
    userId: "user-1",
    reply: (request) => reply?.(request) ??
      (request.target === "task_project_id" || request.target === "scenario_project_id" ? { data: PROJECT } : undefined),
  });
  scope.__buildlogicPlannerSupabaseClient = db.client;
  return db;
}

const step = (id: string, sequence: number, version?: number): ManufacturingStep =>
  ({ id, sequence, name: id, instruction: `Do ${id}`, durationMinutes: 5, version }) as ManufacturingStep;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1", scenarioId: "scenario-1", stationId: "station-1", rowType: "task", wbs: "1", name: "Fit",
    plannedDurationMinutes: 10, dependencyIds: [], customFields: {}, manufacturingSteps: [], partReferences: [],
    ...overrides,
  } as unknown as Task;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { delete scope.__buildlogicPlannerSupabaseClient; warn.mockRestore(); });

describe("task row writes", () => {
  it("asserts every task's project, upserts the rows, then syncs step tools in one batch", async () => {
    const db = install();
    await saveTasksToSupabase([], PROJECT);
    expect(db.requests).toEqual([]);
    const tools = { stepToolLists: { "step-1": ["Hex key"] } };
    await saveTasksToSupabase([task({ customFields: tools }), task({ id: "task-2", scenarioId: "scenario-1" })], PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:scenario_project_id",
        "rpc:scenario_project_id",
        "tasks.upsert",
        "step_tools.select(id, task_id) task_id in [task-1,task-2]",
        "step_tools.upsert",
      ]
    `);
    expect(db.requests.filter((r) => r.target === "scenario_project_id").map((r) => r.payload))
      .toEqual([{ target_scenario_id: "scenario-1" }, { target_scenario_id: "scenario-1" }]);
  });

  it("refuses a task from another project before writing anything", async () => {
    const db = install((r) => (r.target === "scenario_project_id" ? { data: "other" } : undefined));
    await expect(saveTasksToSupabase([task()], PROJECT)).rejects.toThrow("This task does not belong to the active workspace.");
    await expect(saveTaskRowToSupabase(task(), PROJECT)).rejects.toThrow("This task does not belong to the active workspace.");
    expect(db.writes()).toEqual([]);
  });

  it("saves a single task as a one-task batch, and a bare row without tool sync", async () => {
    const one = install();
    await saveTaskToSupabase(task(), PROJECT);
    expect(one.lines()).toMatchInlineSnapshot(`
      [
        "rpc:scenario_project_id",
        "tasks.upsert",
        "step_tools.select(id, task_id) task_id in [task-1]",
      ]
    `);
    const row = install();
    await saveTaskRowToSupabase(task(), PROJECT);
    expect(row.lines()).toMatchInlineSnapshot(`
      [
        "rpc:scenario_project_id",
        "tasks.upsert",
      ]
    `);
  });

  it("writes custom fields alone, without the step-scoped media and tool maps", async () => {
    const db = install();
    await saveTaskCustomFieldsToSupabase("task-1", { keep: "x", stepToolLists: { s: ["Hex key"] } } as Task["customFields"], PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.update id=task-1",
      ]
    `);
    expect(db.requests.at(-1)!.payload).toEqual({ custom_fields: { keep: "x" } });
  });

  it("skips the project assertion when no project is given", async () => {
    const db = install();
    await saveTaskRowToSupabase(task());
    expect(db.lines()).toEqual(["tasks.upsert"]);
  });
});

describe("task field patches", () => {
  it("maps only the provided fields, clears null ones, and checks the version", async () => {
    const db = install((r) => (r.target === "tasks" ? { data: { id: "task-1", version: 4 } } : undefined));
    await updateTaskFields("task-1", {}, 3, PROJECT);
    expect(db.requests).toEqual([]);
    await updateTaskFields("task-1", { name: "Renamed", zoneId: undefined, ownerName: null as never, plannedOperators: 2, codeLocked: false }, 3, PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.update id=task-1 version=3 | returning(id,version) maybeSingle",
      ]
    `);
    expect(db.requests.at(-1)!.payload).toEqual({ name: "Renamed", planned_operators: 2, owner_name: null, code_locked: false });
    await updateTaskFields("task-1", { wbs: "2" }, undefined, PROJECT);
    expect(db.lines().at(-1)).toBe("tasks.update id=task-1 | returning(id,version) maybeSingle");
  });

  it("reports a version conflict when no row matched", async () => {
    install();
    await expect(updateTaskFields("task-1", { name: "x" }, 3, PROJECT)).rejects.toThrow("Task save conflict. Reload this task before saving again.");
  });
});

describe("step writes", () => {
  it("parks every existing step, upserts the new set, deletes stale steps, then syncs tools with empty wipe", async () => {
    const db = install((r) => {
      if (r.target === "manufacturing_steps" && r.op === "select") {
        return { data: r.columns === "id" ? [{ id: "keep" }, { id: "stale" }] : [{ id: "keep", sequence: 1 }, { id: "stale", sequence: 2 }] };
      }
      if (r.target === "step_tools" && r.op === "select") return { data: [{ id: "old-tool" }] };
      return undefined;
    });
    await saveTaskWithManufacturingStepsToSupabase(task({ manufacturingSteps: [step("new", 1), step("keep", 2)] }), PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.upsert",
        "manufacturing_steps.select(id) task_id=task-1",
        "manufacturing_steps.select(id,sequence) id in [keep,stale]",
        "manufacturing_steps.update id=keep",
        "manufacturing_steps.update id=stale",
        "manufacturing_steps.upsert",
        "manufacturing_steps.delete id in [stale]",
        "step_tools.select(id) task_id=task-1",
        "step_tools.delete id in [old-tool]",
      ]
    `);
    const bumps = db.requests.filter((r) => r.op === "update").map((r) => r.payload);
    expect(bumps).toEqual([{ sequence: 100003 }, { sequence: 100004 }]);
  });

  it("writes one task and one step, in that order", async () => {
    const db = install();
    await saveTaskAndManufacturingStepToSupabase(task(), step("s1", 1), PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.upsert",
        "manufacturing_steps.upsert",
      ]
    `);
  });

  it("upserts an unversioned step and version-checks a versioned one", async () => {
    const db = install((r) => (r.target === "manufacturing_steps" && r.op === "update" ? { data: { id: "s1", version: 3 } } : undefined));
    await upsertProcedureStep("task-1", step("s1", 1), undefined, PROJECT);
    await upsertProcedureStep("task-1", step("s1", 1), 2, PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "manufacturing_steps.upsert",
        "rpc:task_project_id",
        "manufacturing_steps.update id=s1 version=2 | returning(id,version) maybeSingle",
      ]
    `);
    install();
    await expect(upsertProcedureStep("task-1", step("s1", 1), 2, PROJECT)).rejects.toThrow("Procedure step save conflict. Reload this task before saving again.");
  });

  it("reorders through the atomic RPC, and does nothing for an empty order", async () => {
    const db = install();
    await reorderProcedureSteps("task-1", [], PROJECT);
    expect(db.requests).toEqual([]);
    await reorderProcedureSteps("task-1", ["b", "a"], PROJECT);
    expect(db.requests.at(-1)).toMatchObject({ kind: "rpc", target: "reorder_manufacturing_steps", payload: { p_task_id: "task-1", p_step_ids: ["b", "a"] } });
    expect(db.lines()).toEqual(["rpc:task_project_id", "rpc:reorder_manufacturing_steps"]);
  });
});

describe("task deletion", () => {
  it("snapshots storage paths before the row delete and removes the objects after it", async () => {
    const db = install((r) => {
      if (r.target === "step_photos") return { data: [{ storage_path: "a.jpg", thumbnail_storage_path: "a-t.jpg" }] };
      if (r.target === "step_exploded_views") return { data: [{ storage_path: "v.png", thumbnail_storage_path: null }, { storage_path: "a.jpg", thumbnail_storage_path: null }] };
      if (r.target === "task_videos") return { data: [{ storage_path: "m.webm", thumbnail_storage_path: null }] };
      return undefined;
    });
    await deletePlannerTask("task-1", PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "step_photos.select(storage_path,thumbnail_storage_path) task_id=task-1",
        "step_exploded_views.select(storage_path,thumbnail_storage_path) task_id=task-1",
        "task_videos.select(storage_path,thumbnail_storage_path) task_id=task-1",
        "tasks.delete id=task-1",
        "storage:step-photos.remove([a.jpg,a-t.jpg,v.png])",
        "storage:task-videos.remove([m.webm])",
      ]
    `);
  });

  it("stops before deleting when the project check fails, and keeps the row delete when cleanup fails", async () => {
    const refused = install((r) => (r.target === "task_project_id" ? { data: "other" } : undefined));
    await expect(deletePlannerTask("task-1", PROJECT)).rejects.toThrow("does not belong");
    expect(refused.lines()).toEqual(["rpc:task_project_id"]);
    const cleanupFails = install((r) => {
      if (r.target === "step_photos") return { data: [{ storage_path: "a.jpg" }] };
      if (r.kind === "storage") return { error: { message: "storage down" } };
      return undefined;
    });
    await expect(deletePlannerTask("task-1", PROJECT)).resolves.toBeUndefined();
    expect(cleanupFails.lines()).toContain("tasks.delete id=task-1");
    expect(warn).toHaveBeenCalledWith("Failed to remove 1 object(s) from the step-photos bucket: storage down");
  });
});

describe("single-task read", () => {
  it("asserts the project, reads the row, then its children and media together", async () => {
    const db = install((r) => {
      if (r.target === "tasks") return { data: { id: "task-1", scenario_id: "scenario-1", name: "Fit", custom_fields: {}, version: 5 } };
      if (r.target === "manufacturing_steps") return { data: [{ id: "s2", task_id: "task-1", sequence: 9, version: 1 }, { id: "s1", task_id: "task-1", sequence: 3, version: 1 }] };
      if (r.target === "task_dependencies") return { data: [{ predecessor_task_id: "task-0" }] };
      return undefined;
    });
    const loaded = await loadTaskFromSupabase("task-1", PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.select(*) id=task-1 | maybeSingle",
        "task_dependencies.select(*) successor_task_id=task-1",
        "manufacturing_steps.select(*) task_id=task-1 | order(sequence) order(id) range(0,499)",
        "part_references.select(*) task_id=task-1 | order(created_at) order(id) range(0,499)",
        "step_photos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "step_tools.select(*) task_id=task-1 | order(sequence)",
        "step_exploded_views.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "task_videos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
      ]
    `);
    expect(loaded).toMatchObject({ id: "task-1", version: 5, dependencyIds: ["task-0"] });
    expect(loaded!.manufacturingSteps!.map((s) => [s.id, s.sequence])).toEqual([["s1", 1], ["s2", 2]]);
    const missing = install();
    await expect(loadTaskFromSupabase("task-1", PROJECT)).resolves.toBeNull();
    expect(missing.lines()).toEqual(["rpc:task_project_id", "tasks.select(*) id=task-1 | maybeSingle"]);
  });
});

describe("procedure save (non-AWI)", () => {
  type Server = { taskVersion: number; steps: Array<{ id: string; sequence: number; version: number }>; parts: Array<{ id: string }> };
  /** A small stateful server: version-checked task/step updates succeed only on the current version. */
  function procedureServer(server: Server, options: { conflictTaskUpdates?: number; conflictStepUpdates?: number } = {}) {
    let taskConflicts = options.conflictTaskUpdates ?? 0;
    let stepConflicts = options.conflictStepUpdates ?? 0;
    return install((r) => {
      if (r.target === "tasks" && r.op === "update") {
        if (taskConflicts > 0) { taskConflicts -= 1; return { data: null }; }
        server.taskVersion += 1;
        return { data: { id: "task-1", version: server.taskVersion } };
      }
      if (r.target === "tasks" && r.op === "select") {
        return { data: { id: "task-1", scenario_id: "scenario-1", name: "Server name", custom_fields: {}, version: server.taskVersion } };
      }
      if (r.target === "manufacturing_steps" && r.op === "select") {
        return { data: server.steps.map((s) => ({ ...s, task_id: "task-1", name: `server ${s.id}` })) };
      }
      if (r.target === "manufacturing_steps" && r.op === "update" && r.modifiers.some((m) => m.startsWith("returning"))) {
        if (stepConflicts > 0) { stepConflicts -= 1; return { data: null }; }
        return { data: { id: "x", version: 9 } };
      }
      if (r.target === "part_references" && r.op === "select") return { data: server.parts };
      return undefined;
    });
  }

  it("version-checks the task, then each existing step, upserts new steps, writes parts, and re-reads", async () => {
    const db = procedureServer({ taskVersion: 4, steps: [{ id: "s1", sequence: 1, version: 2 }, { id: "gone", sequence: 2, version: 1 }], parts: [{ id: "old-part" }] });
    const saved = await saveProcedureTaskUpdateToSupabase(
      task({ version: 4, manufacturingSteps: [step("s1", 1, 2), step("s-new", 2)], partReferences: [{ id: "p1", partNumber: "PN", quantity: 1 }] as never }),
      [], PROJECT,
    );
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.update id=task-1 version=4 | returning(id,version) maybeSingle",
        "manufacturing_steps.select(id,sequence,version) task_id=task-1",
        "part_references.select(id) task_id=task-1",
        "manufacturing_steps.delete id in [gone]",
        "manufacturing_steps.update id=s1 version=2 | returning(id,version) maybeSingle",
        "manufacturing_steps.upsert",
        "part_references.upsert",
        "part_references.delete id in [old-part]",
        "rpc:task_project_id",
        "tasks.select(*) id=task-1 | maybeSingle",
        "task_dependencies.select(*) successor_task_id=task-1",
        "manufacturing_steps.select(*) task_id=task-1 | order(sequence) order(id) range(0,499)",
        "part_references.select(*) task_id=task-1 | order(created_at) order(id) range(0,499)",
        "step_photos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "step_tools.select(*) task_id=task-1 | order(sequence)",
        "step_exploded_views.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "task_videos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
      ]
    `);
    expect(saved).toMatchObject({ id: "task-1", version: 5 });
  });

  it("parks existing steps and upserts every step when the new order would collide", async () => {
    const db = procedureServer({ taskVersion: 1, steps: [{ id: "a", sequence: 1, version: 1 }, { id: "b", sequence: 2, version: 1 }], parts: [] });
    await saveProcedureTaskUpdateToSupabase(task({ version: 1, manufacturingSteps: [step("b", 1, 1), step("a", 2, 1)] }), [], PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.update id=task-1 version=1 | returning(id,version) maybeSingle",
        "manufacturing_steps.select(id,sequence,version) task_id=task-1",
        "part_references.select(id) task_id=task-1",
        "manufacturing_steps.select(id,sequence) id in [a,b]",
        "manufacturing_steps.update id=a",
        "manufacturing_steps.update id=b",
        "manufacturing_steps.upsert",
        "manufacturing_steps.upsert",
        "rpc:task_project_id",
        "tasks.select(*) id=task-1 | maybeSingle",
        "task_dependencies.select(*) successor_task_id=task-1",
        "manufacturing_steps.select(*) task_id=task-1 | order(sequence) order(id) range(0,499)",
        "part_references.select(*) task_id=task-1 | order(created_at) order(id) range(0,499)",
        "step_photos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "step_tools.select(*) task_id=task-1 | order(sequence)",
        "step_exploded_views.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "task_videos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
      ]
    `);
  });

  it("retries a task version conflict once on the merged server version, then gives up", async () => {
    const db = procedureServer({ taskVersion: 7, steps: [], parts: [] }, { conflictTaskUpdates: 1 });
    const saved = await saveProcedureTaskUpdateToSupabase(task({ version: 6, description: "Local description" }), [], PROJECT);
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.update id=task-1 version=6 | returning(id,version) maybeSingle",
        "rpc:task_project_id",
        "tasks.select(*) id=task-1 | maybeSingle",
        "task_dependencies.select(*) successor_task_id=task-1",
        "manufacturing_steps.select(*) task_id=task-1 | order(sequence) order(id) range(0,499)",
        "part_references.select(*) task_id=task-1 | order(created_at) order(id) range(0,499)",
        "step_photos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "step_tools.select(*) task_id=task-1 | order(sequence)",
        "step_exploded_views.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "task_videos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "rpc:task_project_id",
        "tasks.update id=task-1 version=7 | returning(id,version) maybeSingle",
        "manufacturing_steps.select(id,sequence,version) task_id=task-1",
        "part_references.select(id) task_id=task-1",
        "rpc:task_project_id",
        "tasks.select(*) id=task-1 | maybeSingle",
        "task_dependencies.select(*) successor_task_id=task-1",
        "manufacturing_steps.select(*) task_id=task-1 | order(sequence) order(id) range(0,499)",
        "part_references.select(*) task_id=task-1 | order(created_at) order(id) range(0,499)",
        "step_photos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "step_tools.select(*) task_id=task-1 | order(sequence)",
        "step_exploded_views.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "task_videos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
      ]
    `);
    const updates = db.requests.filter((r) => r.target === "tasks" && r.op === "update");
    expect(updates.map((r) => r.filters)).toEqual([["id=task-1", "version=6"], ["id=task-1", "version=7"]]);
    expect(updates[1]!.payload).toMatchObject({ description: "Local description" });
    expect(updates[1]!.payload).not.toHaveProperty("name");
    expect(saved).toMatchObject({ version: 8 });

    procedureServer({ taskVersion: 7, steps: [], parts: [] }, { conflictTaskUpdates: 2 });
    await expect(saveProcedureTaskUpdateToSupabase(task({ version: 6 }), [], PROJECT)).rejects.toThrow("Task save conflict. Reload this task before saving again.");
    procedureServer({ taskVersion: 7, steps: [], parts: [] }, { conflictTaskUpdates: 1 });
    await expect(saveProcedureTaskUpdateToSupabase(task({ version: 6 }), [], PROJECT, false)).rejects.toThrow("Task save conflict.");
  });

  it("retries a step version conflict once, keeping the local step edit on the server's version", async () => {
    const db = procedureServer({ taskVersion: 2, steps: [{ id: "s1", sequence: 1, version: 5 }], parts: [] }, { conflictStepUpdates: 1 });
    await saveProcedureTaskUpdateToSupabase(task({ version: 2, manufacturingSteps: [{ ...step("s1", 1, 4), instruction: "Local edit" }] }), [], PROJECT);
    const stepUpdates = db.requests.filter((r) => r.target === "manufacturing_steps" && r.op === "update");
    expect(stepUpdates.map((r) => r.filters)).toEqual([["id=s1", "version=4"], ["id=s1", "version=5"]]);
    expect(stepUpdates[1]!.payload).toMatchObject({ instruction: "Local edit" });

    procedureServer({ taskVersion: 2, steps: [{ id: "s1", sequence: 1, version: 5 }], parts: [] }, { conflictStepUpdates: 2 });
    await expect(saveProcedureTaskUpdateToSupabase(task({ version: 2, manufacturingSteps: [step("s1", 1, 4)] }), [], PROJECT))
      .rejects.toThrow("Procedure step save conflict. Reload this task before saving again.");
  });

  it("uses an injected client for its writes but the page client for the retry read (current behaviour)", async () => {
    const page = procedureServer({ taskVersion: 3, steps: [], parts: [] });
    const injected = createRecordingSupabase({
      reply: (r) => (r.target === "task_project_id" ? { data: PROJECT } : r.target === "tasks" && r.op === "update" ? { data: null } : undefined),
    });
    await expect(saveProcedureTaskUpdateToSupabase(task({ version: 2 }), [], PROJECT, true, injected.client as never))
      .rejects.toThrow("Task save conflict.");
    expect(injected.lines().filter((line) => line.startsWith("tasks."))).toEqual([
      "tasks.update id=task-1 version=2 | returning(id,version) maybeSingle",
      "tasks.update id=task-1 version=3 | returning(id,version) maybeSingle",
    ]);
    expect(page.lines()).toContain("tasks.select(*) id=task-1 | maybeSingle");
  });
});

describe("composite step operations", () => {
  it("moves a step: asserts both tasks, parks the target's steps, reparents the step with its tools and photos, then saves both procedures with version checks", async () => {
    // Server: the target already holds "t-step"; after the reparent it also holds "moved" (sequence 200000).
    const targetSteps = () => [{ id: "t-step", sequence: 100002, version: 2 }, { id: "moved", sequence: 200000, version: 4 }];
    const db = install((r) => {
      if (r.target === "manufacturing_steps" && r.op === "select") {
        if (r.filters.includes("task_id=task-2")) return { data: r.columns === "id" ? [{ id: "t-step" }] : targetSteps() };
        if (r.filters.some((f) => f.startsWith("id in"))) return { data: [{ id: "t-step", sequence: 1 }] };
        return { data: [] };
      }
      if (r.op === "update" && r.modifiers.some((m) => m.startsWith("returning"))) return { data: { id: "x", version: 9 } };
      if (r.target === "tasks" && r.op === "select") return { data: { id: String(r.filters[0]).slice(3), scenario_id: "scenario-1", custom_fields: {}, version: 1 } };
      return undefined;
    });
    const source = task({ id: "task-1", manufacturingSteps: [] });
    const target = task({ id: "task-2", manufacturingSteps: [step("t-step", 1, 2), { ...step("moved", 2, 4), instruction: "Moved here" }] });
    await moveManufacturingStepToTaskInSupabase(source, target, "moved", [], PROJECT);

    const updates = db.requests.filter((r) => r.op === "update").map((r) => ({ target: r.target, filters: r.filters, payload: r.payload }));
    expect(updates.slice(0, 4)).toEqual([
      { target: "manufacturing_steps", filters: ["id=t-step"], payload: { sequence: expect.any(Number) } },      // park the target's steps
      { target: "manufacturing_steps", filters: ["id=moved"], payload: { task_id: "task-2", sequence: 200000 } }, // reparent
      { target: "step_tools", filters: ["step_id=moved"], payload: { task_id: "task-2" } },                      // tools follow the step
      { target: "step_photos", filters: ["step_id=moved", "deleted_at is null"], payload: { task_id: "task-2" } }, // live photos follow the step
    ]);
    expect((updates[0]!.payload as { sequence: number }).sequence).toBeGreaterThan(100000); // parked above every real sequence
    // Both procedures are saved through the version-checked path: the target's existing steps are
    // updated against their server versions, never blindly upserted.
    const taskUpdates = updates.filter((u) => u.target === "tasks").map((u) => u.filters);
    expect(taskUpdates).toEqual([["id=task-1"], ["id=task-2"]]);
    const stepUpdates = updates.filter((u) => u.target === "manufacturing_steps" && u.filters.some((f) => f.startsWith("version=")));
    expect(stepUpdates.map((u) => u.filters)).toEqual([["id=t-step", "version=2"], ["id=moved", "version=4"]]);
    expect(stepUpdates[1]!.payload).toMatchObject({ task_id: "task-2", sequence: 2, instruction: "Moved here" });
    expect(db.requests.some((r) => r.target === "manufacturing_steps" && r.op === "upsert")).toBe(false);
    expect(db.lines().slice(0, 8)).toEqual([
      "rpc:task_project_id",
      "rpc:task_project_id",
      "manufacturing_steps.select(id) task_id=task-2",
      "manufacturing_steps.select(id,sequence) id in [t-step]",
      "manufacturing_steps.update id=t-step",
      "manufacturing_steps.update id=moved",
      "step_tools.update step_id=moved",
      "step_photos.update step_id=moved deleted_at is null",
    ]);
    await expect(moveManufacturingStepToTaskInSupabase(source, target, "absent", [], PROJECT)).rejects.toThrow("Unable to find the manufacturing step to move.");
  });

  it("merges the latest server task through the caller's update before saving it", async () => {
    const db = install((r) => (r.target === "tasks" && r.op === "select" ? { data: { id: "task-1", scenario_id: "scenario-1", name: "Server", custom_fields: {}, version: 3 } } : undefined));
    const next = await mergeLatestTaskToSupabase("task-1", (latest) => ({ ...latest, name: `${latest.name} + local` }), PROJECT);
    expect(next).toMatchObject({ name: "Server + local", version: 3 });
    expect(db.lines()).toMatchInlineSnapshot(`
      [
        "rpc:task_project_id",
        "tasks.select(*) id=task-1 | maybeSingle",
        "task_dependencies.select(*) successor_task_id=task-1",
        "manufacturing_steps.select(*) task_id=task-1 | order(sequence) order(id) range(0,499)",
        "part_references.select(*) task_id=task-1 | order(created_at) order(id) range(0,499)",
        "step_photos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "step_tools.select(*) task_id=task-1 | order(sequence)",
        "step_exploded_views.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "task_videos.select(*) task_id=task-1 deleted_at is null | order(captured_at)",
        "rpc:scenario_project_id",
        "tasks.upsert",
        "step_tools.select(id, task_id) task_id in [task-1]",
      ]
    `);
    const absent = install();
    await expect(mergeLatestTaskToSupabase("task-1", (t) => t, PROJECT)).resolves.toBeNull();
    expect(absent.writes()).toEqual([]);
  });

  it("saves one step by merging it into the freshly read procedure, anchored to the server's step version", async () => {
    const db = install((r) => {
      if (r.target === "tasks" && r.op === "select") return { data: { id: "task-1", scenario_id: "scenario-1", custom_fields: {}, version: 2 } };
      if (r.target === "manufacturing_steps" && r.op === "select") return { data: [{ id: "s1", task_id: "task-1", sequence: 1, version: 6, name: "Server" }] };
      if (r.op === "update" && r.modifiers.some((m) => m.startsWith("returning"))) return { data: { id: "x", version: 1 } };
      return undefined;
    });
    await saveManufacturingStepToSupabase("task-1", { ...step("s1", 1, 1), instruction: "Edited" }, PROJECT);
    const stepUpdate = db.requests.find((r) => r.target === "manufacturing_steps" && r.op === "update")!;
    expect(stepUpdate.filters).toEqual(["id=s1", "version=6"]);
    expect(stepUpdate.payload).toMatchObject({ instruction: "Edited" });
    install();
    await expect(saveManufacturingStepToSupabase("task-1", step("s1", 1), PROJECT)).rejects.toThrow("Task not found or you do not have access to it.");
  });
});
