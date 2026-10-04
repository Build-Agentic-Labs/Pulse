// Planner realtime: the payload shape, the helpers that map a change to its owning task and decide whether
// a single-task refresh can absorb it or whether it is in the shown scenario, and the subscription itself
// (structural tables server-filtered by product/scenario; task-child tables filtered locally by task scope so
// adding a task never re-subscribes). Moved verbatim from supabase-planner.ts (Phase 4).

import { plannerClient } from "./client";

export type RealtimePlannerTable =
  | "products"
  | "scenarios"
  | "stations"
  | "zones"
  | "tasks"
  | "task_dependencies"
  | "manufacturing_components"
  | "document_type_codes"
  | "manufacturing_steps"
  | "part_references"
  | "actual_events"
  | "custom_columns"
  | "step_photos"
  | "step_exploded_views"
  | "task_videos"
  | "step_tools"
  | "tool_library";

export type PlannerRealtimeScope = {
  productId?: string;
  scenarioId?: string;
  // Membership test for "does this task belong to the scenario I'm showing". Read live at event time
  // (back it with a ref in the component) so the channel never has to be torn down when the task set
  // changes. Task-child tables subscribe unfiltered and are narrowed here instead of by a server-side
  // filter that would rewrite realtime.subscription on every task add/remove/reorder.
  isTaskInScope?: (taskId: string) => boolean;
};

export type PlannerRealtimePayload = {
  table: RealtimePlannerTable;
  eventType: "INSERT" | "UPDATE" | "DELETE" | "*";
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};

// Extract the owning task id from a realtime payload, for the targeted single-task refresh path.
// Child tables key off `task_id`; the `tasks` table keys off `id`. DELETE payloads still carry these
// because every planner table is REPLICA IDENTITY FULL, so payload.old holds the full row.
export function taskIdFromRealtimePayload(payload: PlannerRealtimePayload): string | undefined {
  const record = payload.new ?? payload.old;
  if (!record) {
    return undefined;
  }

  if (payload.table === "tasks") {
    return typeof record.id === "string" ? record.id : undefined;
  }

  return typeof record.task_id === "string" ? record.task_id : undefined;
}

// Whether a realtime change can be absorbed by re-fetching just the owning task (loadTaskFromSupabase)
// instead of reloading the whole scenario and re-signing every photo. Rows that live ON the task
// (steps, parts, photos, tools) leave their task intact, so ANY event -- including DELETE -- is
// patchable. NOTE: actual_events is deliberately NOT patchable -- those rows load into the top-level
// PlannerState.actualEvents array, not the Task, so loadTaskFromSupabase can't reconcile them; they
// must full-reload (a stale actualEvents can otherwise be re-persisted on save). A `tasks` DELETE
// removes the task and cascades (dependencies, rollups, selection), so it also falls back to a full
// reload.
export function canPatchTaskFromRealtimePayload(payload: PlannerRealtimePayload): boolean {
  switch (payload.table) {
    case "manufacturing_steps":
    case "part_references":
    case "step_photos":
    case "step_exploded_views":
    case "task_videos":
    case "step_tools":
      return true;
    case "tasks":
      return payload.eventType !== "DELETE";
    default:
      return false;
  }
}

// Decide whether a realtime change is relevant to the locally-shown scenario. Structural tables
// (products/scenarios/stations/zones/custom_columns/tasks) are filtered server-side by product/scenario
// scope, so they are always in scope here. Task-child tables subscribe unfiltered -- to keep the
// channel stable across task add/remove -- so they're narrowed to the scenario's tasks at delivery.
// This is a relevance filter, not an authorization boundary: RLS still gates the actual row reads
// (loadTaskFromSupabase / loadPlannerStateFromSupabase), so a missed narrowing leaks no data.
export function isRealtimePayloadInScope(
  payload: PlannerRealtimePayload,
  isTaskInScope: (taskId: string) => boolean,
): boolean {
  const record = payload.new ?? payload.old;
  switch (payload.table) {
    case "manufacturing_steps":
    case "part_references":
    case "actual_events":
    case "step_photos":
    case "step_exploded_views":
    case "task_videos":
    case "step_tools":
      return typeof record?.task_id === "string" && isTaskInScope(record.task_id);
    case "task_dependencies":
      // Dependencies load by successor_task_id (loadTaskFromSupabase / loadProjectPlannerData), so a
      // change is only relevant when the successor is in scope -- this mirrors the server filter this
      // narrowing replaced. A predecessor-only match would force a full reload that can't reflect it.
      return typeof record?.successor_task_id === "string" && isTaskInScope(record.successor_task_id);
    default:
      return true;
  }
}

export function subscribePlannerStateChanges(onChange: (payload: PlannerRealtimePayload) => void, scope?: PlannerRealtimeScope) {
  const supabase = plannerClient();
  const channel = supabase.channel(`planner-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const isTaskInScope = scope?.isTaskInScope;

  // Task-child tables are subscribed unfiltered (so adding/removing a task never re-subscribes the
  // channel); drop here any change whose owning task isn't in the shown scenario. Structural tables
  // are server-filtered by product/scenario scope, so they always pass.
  function emit(payload: PlannerRealtimePayload) {
    if (isTaskInScope && !isRealtimePayloadInScope(payload, isTaskInScope)) {
      return;
    }
    onChange(payload);
  }

  function listen(table: RealtimePlannerTable, filter?: string) {
    channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, (payload) => {
      emit({
        table,
        eventType: payload.eventType as PlannerRealtimePayload["eventType"],
        new: payload.new as Record<string, unknown> | undefined,
        old: payload.old as Record<string, unknown> | undefined,
      });
    });
  }

  listen("products", scope?.productId ? `id=eq.${scope.productId}` : undefined);
  listen("scenarios", scope?.productId ? `product_id=eq.${scope.productId}` : undefined);
  listen("stations", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("zones", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("tasks", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  // No task-id server filter on the child tables: that list changes on every task add/remove, and a
  // filtered postgres_changes subscription rewrites realtime.subscription each time -- the churn this
  // change removes. emit() narrows these to the scenario via isTaskInScope instead.
  listen("task_dependencies");
  listen("manufacturing_steps");
  listen("part_references");
  listen("actual_events");
  listen("step_photos");
  listen("step_exploded_views");
  listen("task_videos");
  listen("step_tools");
  if (scope?.productId) {
    listen("custom_columns", `product_id=eq.${scope.productId}`);
  }
  if (scope?.scenarioId) {
    listen("custom_columns", `scenario_id=eq.${scope.scenarioId}`);
  }

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
