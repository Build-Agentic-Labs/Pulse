import { describe, expect, it } from "vitest";

import {
  canPatchTaskFromRealtimePayload,
  isRealtimePayloadInScope,
  taskIdFromRealtimePayload,
  type PlannerRealtimePayload,
} from "./supabase-planner";

// These two helpers decide whether a realtime change can be absorbed by re-fetching just the owning
// task (cheap) or must trigger a full scenario reload (re-pulls every task + re-signs every photo).
// The routing is the crux of the egress optimization, so pin it down explicitly.

describe("canPatchTaskFromRealtimePayload", () => {
  const childTables = [
    "manufacturing_steps",
    "part_references",
    "step_photos",
    "step_tools",
  ] as const;

  it("patches child-table changes for every event type, including DELETE", () => {
    for (const table of childTables) {
      for (const eventType of ["INSERT", "UPDATE", "DELETE"] as const) {
        expect(canPatchTaskFromRealtimePayload({ table, eventType })).toBe(true);
      }
    }
  });

  it("does not patch actual_events -- they live in PlannerState.actualEvents, not the Task, so a task refresh can't reconcile them", () => {
    for (const eventType of ["INSERT", "UPDATE", "DELETE"] as const) {
      expect(canPatchTaskFromRealtimePayload({ table: "actual_events", eventType })).toBe(false);
    }
  });

  it("patches task INSERT/UPDATE but not task DELETE (removal cascades -> full reload)", () => {
    expect(canPatchTaskFromRealtimePayload({ table: "tasks", eventType: "INSERT" })).toBe(true);
    expect(canPatchTaskFromRealtimePayload({ table: "tasks", eventType: "UPDATE" })).toBe(true);
    expect(canPatchTaskFromRealtimePayload({ table: "tasks", eventType: "DELETE" })).toBe(false);
  });

  it("does not patch structural / scenario-level tables (full reload)", () => {
    for (const table of ["products", "scenarios", "stations", "zones", "custom_columns", "task_dependencies"] as const) {
      expect(canPatchTaskFromRealtimePayload({ table, eventType: "UPDATE" })).toBe(false);
      expect(canPatchTaskFromRealtimePayload({ table, eventType: "DELETE" })).toBe(false);
    }
  });
});

describe("taskIdFromRealtimePayload", () => {
  it("reads id for the tasks table and task_id for child tables", () => {
    expect(
      taskIdFromRealtimePayload({ table: "tasks", eventType: "UPDATE", new: { id: "task-1" } }),
    ).toBe("task-1");
    expect(
      taskIdFromRealtimePayload({ table: "step_photos", eventType: "INSERT", new: { id: "photo-9", task_id: "task-2" } }),
    ).toBe("task-2");
  });

  it("falls back to payload.old on DELETE (tables are REPLICA IDENTITY FULL, so old has the row)", () => {
    expect(
      taskIdFromRealtimePayload({ table: "step_photos", eventType: "DELETE", old: { id: "photo-9", task_id: "task-3" } }),
    ).toBe("task-3");
    expect(
      taskIdFromRealtimePayload({ table: "tasks", eventType: "DELETE", old: { id: "task-4" } }),
    ).toBe("task-4");
  });

  it("returns undefined when no owning task id is present", () => {
    // task_dependencies carries successor/predecessor ids, not task_id -> falls through to full reload.
    expect(
      taskIdFromRealtimePayload({ table: "task_dependencies", eventType: "UPDATE", new: { successor_task_id: "task-5" } }),
    ).toBeUndefined();
    expect(taskIdFromRealtimePayload({ table: "step_tools", eventType: "DELETE" } as PlannerRealtimePayload)).toBeUndefined();
  });
});

describe("isRealtimePayloadInScope", () => {
  const inScope = new Set(["task-1", "task-2"]);
  const isTaskInScope = (taskId: string) => inScope.has(taskId);

  it("keeps child-table changes whose owning task is in scope and drops the rest", () => {
    expect(
      isRealtimePayloadInScope({ table: "step_photos", eventType: "INSERT", new: { task_id: "task-1" } }, isTaskInScope),
    ).toBe(true);
    expect(
      isRealtimePayloadInScope({ table: "step_tools", eventType: "UPDATE", new: { task_id: "task-9" } }, isTaskInScope),
    ).toBe(false);
  });

  it("narrows child DELETEs via payload.old", () => {
    expect(
      isRealtimePayloadInScope({ table: "manufacturing_steps", eventType: "DELETE", old: { task_id: "task-2" } }, isTaskInScope),
    ).toBe(true);
    expect(
      isRealtimePayloadInScope({ table: "manufacturing_steps", eventType: "DELETE", old: { task_id: "task-9" } }, isTaskInScope),
    ).toBe(false);
  });

  it("keeps a dependency change only when the successor is in scope (mirrors the successor-keyed load query)", () => {
    // successor in scope -> relevant, regardless of predecessor.
    expect(
      isRealtimePayloadInScope(
        { table: "task_dependencies", eventType: "INSERT", new: { successor_task_id: "task-1", predecessor_task_id: "task-9" } },
        isTaskInScope,
      ),
    ).toBe(true);
    // successor out of scope -> not relevant even if the predecessor is in scope; a predecessor-only
    // change can't be reflected by the successor-keyed reload, so it must not force one.
    expect(
      isRealtimePayloadInScope(
        { table: "task_dependencies", eventType: "INSERT", new: { successor_task_id: "task-8", predecessor_task_id: "task-2" } },
        isTaskInScope,
      ),
    ).toBe(false);
    expect(
      isRealtimePayloadInScope(
        { table: "task_dependencies", eventType: "INSERT", new: { successor_task_id: "task-8", predecessor_task_id: "task-9" } },
        isTaskInScope,
      ),
    ).toBe(false);
  });

  it("always keeps structural / server-scoped tables regardless of the predicate", () => {
    // These are filtered server-side by product/scenario, so the client never narrows them further.
    const never = () => false;
    for (const table of ["products", "scenarios", "stations", "zones", "custom_columns", "tasks"] as const) {
      expect(isRealtimePayloadInScope({ table, eventType: "UPDATE", new: { id: "x" } }, never)).toBe(true);
    }
  });
});
