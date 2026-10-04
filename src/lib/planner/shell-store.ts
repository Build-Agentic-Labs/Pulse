// The two guarded whole-plan saves (full state with atomic task-child replacement, and the planner
// shell with dependency sync), their deletion tripwire and station/zone sequence parking, plus the
// save-status type. These are separate requests, not a transaction: their ORDER is the safety property
// (existence reads, tripwire before any write, parents before children, stale rows deleted last in
// foreign-key order). Moved verbatim from supabase-planner.ts (Phase 5); the facade re-exports the
// public names.

import { plannerClient } from "./client";
import { customColumnScopeFilter, documentTypeScopeFilter, throwIfError } from "./query-helpers";
import {
  actualEventRow,
  customColumnRow,
  dependencyRow,
  documentTypeCodeRow,
  manufacturingComponentRow,
  manufacturingStepRows,
  num,
  partReferenceRows,
  productRow,
  scenarioRow,
  stationRow,
  taskRow,
  zoneRow,
} from "./row-mappers";
import type { PlannerState } from "@/domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SaveState = "idle" | "loading" | "saving" | "saved" | "draft" | "retrying" | "conflict" | "error";

type SequencedRow = { id: string; sequence: number };
type ExistingSequencedRow = { id: unknown; sequence: unknown };

// `stations` and `zones` carry UNIQUE (scenario_id, sequence). The planner save upserts them
// before it deletes stale rows (the task FKs are ON DELETE SET NULL, so deleting first would
// blank task.station_id / task.zone_id), and supabase-js upsert only resolves conflicts on the
// primary key. A row about to take a sequence that a DIFFERENT existing row still holds --
// stale or merely reordered -- therefore hits the unique index and aborts the whole save.
// A brand-new project walks straight into this: the first autosave writes the synthetic
// "Unzoned" station at sequence 1, the user's first zone (also sequence 1) derives a station
// that collides with it, and nothing after that point ever persists (2026-09-11).
export function upsertWouldCollideOnSequence(nextRows: SequencedRow[], existingRows: ExistingSequencedRow[]): boolean {
  const holderBySequence = new Map<number, string>();
  existingRows.forEach((row) => holderBySequence.set(num(row.sequence), String(row.id)));

  return nextRows.some((row) => {
    const holder = holderBySequence.get(row.sequence);
    return holder !== undefined && holder !== row.id;
  });
}

// Same remedy as bumpManufacturingStepSequences: park every existing row of the scenario at a
// temporary sequence above anything in use so the upsert can assign the real sequences freely.
// Kept rows get their sequence back from the upsert itself; stale rows are deleted at the end.
async function parkSequencesIfUpsertWouldCollide(
  supabase: SupabaseClient,
  table: "stations" | "zones",
  nextRows: SequencedRow[],
  existingRows: ExistingSequencedRow[],
) {
  if (!upsertWouldCollideOnSequence(nextRows, existingRows)) {
    return;
  }

  const maxSequence = Math.max(100000, ...existingRows.map((row) => num(row.sequence)));
  const temporaryBaseSequence = maxSequence + existingRows.length + 1;

  await Promise.all(
    existingRows.map((row, index) =>
      throwIfError(
        supabase.from(table).update({ sequence: temporaryBaseSequence + index }).eq("id", String(row.id)),
      ),
    ),
  );
}

/**
 * Data-loss tripwire (refactor plan §5). A full-state save hard-deletes every row
 * absent from in-memory state across six tables, and the one credible data-loss
 * chain is a TRUNCATED load: a partial read renders, the user edits, and the save
 * would silently delete everything the read missed — no error anywhere, RLS
 * permits all of it. This guard refuses any save that would delete more than half
 * of an entity's existing rows (once there are enough rows for the fraction to
 * mean anything). Genuine bulk deletions still work in smaller batches.
 *
 * Known limit: it guards row DELETION per entity, not per-task child replacement —
 * a truncated steps array inside a surviving task is not detectable here.
 */
export function assertSaneStateDeletion(entity: string, existingCount: number, staleCount: number): void {
  const MIN_ROWS_FOR_TRIPWIRE = 5;
  const MAX_DELETE_FRACTION = 0.5;
  if (existingCount >= MIN_ROWS_FOR_TRIPWIRE && staleCount > existingCount * MAX_DELETE_FRACTION) {
    throw new Error(
      `Refusing to save: this would delete ${staleCount} of ${existingCount} ${entity}. ` +
        "A truncated planner load looks exactly like mass deletion, so large removals are blocked as a " +
        "safety measure. If the deletion is intentional, remove items in smaller batches.",
    );
  }
}

export async function savePlannerStateToSupabase(state: PlannerState, client?: ReturnType<typeof plannerClient>) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a workspace before saving planner data.");
  }

  const supabase = client ?? plannerClient();
  const [existingTasks, existingStations, existingZones, existingComponents, existingDocumentTypes, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id,sequence").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id,sequence").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("manufacturing_components").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(
      supabase
        .from("document_type_codes")
        .select("id")
        .or(documentTypeScopeFilter(state.product)),
    ),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("id")
        .or(customColumnScopeFilter(String(state.product.id), String(state.scenario.id))),
    ),
  ]);

  const nextTaskIds = state.tasks.map((task) => task.id);
  const taskIds = [...new Set([...(existingTasks ?? []).map((task) => String(task.id)), ...nextTaskIds])];
  const staleTaskIds = (existingTasks ?? [])
    .map((task) => String(task.id))
    .filter((taskId) => !nextTaskIds.includes(taskId));
  const nextStationIds = state.stations.map((station) => station.id);
  const staleStationIds = (existingStations ?? [])
    .map((station) => String(station.id))
    .filter((stationId) => !nextStationIds.includes(stationId));
  const nextZoneIds = state.zones.map((zone) => zone.id);
  const staleZoneIds = (existingZones ?? [])
    .map((zone) => String(zone.id))
    .filter((zoneId) => !nextZoneIds.includes(zoneId));
  const nextComponentIds = state.components.map((component) => component.id);
  const staleComponentIds = (existingComponents ?? [])
    .map((component) => String(component.id))
    .filter((componentId) => !nextComponentIds.includes(componentId));
  const nextDocumentTypeIds = state.documentTypes.map((documentType) => documentType.id);
  const staleDocumentTypeIds = (existingDocumentTypes ?? [])
    .map((documentType) => String(documentType.id))
    .filter((documentTypeId) => !nextDocumentTypeIds.includes(documentTypeId));
  const nextCustomColumnIds = state.customColumns.map((column) => column.id);
  const staleCustomColumnIds = (existingCustomColumns ?? [])
    .map((column) => String(column.id))
    .filter((columnId) => !nextCustomColumnIds.includes(columnId));

  // Tripwire BEFORE any write: refuse mass deletion that signals a truncated load.
  assertSaneStateDeletion("tasks", (existingTasks ?? []).length, staleTaskIds.length);
  assertSaneStateDeletion("stations", (existingStations ?? []).length, staleStationIds.length);
  assertSaneStateDeletion("zones", (existingZones ?? []).length, staleZoneIds.length);
  assertSaneStateDeletion("components", (existingComponents ?? []).length, staleComponentIds.length);
  assertSaneStateDeletion("document types", (existingDocumentTypes ?? []).length, staleDocumentTypeIds.length);
  assertSaneStateDeletion("custom columns", (existingCustomColumns ?? []).length, staleCustomColumnIds.length);

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await parkSequencesIfUpsertWouldCollide(supabase, "stations", state.stations, existingStations ?? []);
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await parkSequencesIfUpsertWouldCollide(supabase, "zones", state.zones, existingZones ?? []);
    await throwIfError(supabase.from("zones").upsert(state.zones.map(zoneRow)));
  }

  if (state.components.length) {
    await throwIfError(supabase.from("manufacturing_components").upsert(state.components.map(manufacturingComponentRow)));
  }

  if (state.documentTypes.length) {
    await throwIfError(supabase.from("document_type_codes").upsert(state.documentTypes.map(documentTypeCodeRow)));
  }

  await throwIfError(supabase.from("tasks").upsert(state.tasks.map(taskRow)));

  // Atomically replace every child row for these tasks in a single server-side transaction.
  // Previously this was 5 deletes followed by 4 inserts as separate requests -- a failure in
  // the gap permanently lost steps/parts/events. The RPC deletes + re-inserts in one
  // transaction, so the children are never missing and the UNIQUE(task_id, sequence) constraint
  // on steps is never transiently violated.
  await throwIfError(
    supabase.rpc("replace_task_children", {
      p_task_ids: taskIds,
      p_dependencies: state.dependencies.map(dependencyRow),
      p_steps: manufacturingStepRows(state.tasks),
      p_parts: partReferenceRows(state.tasks),
      p_actual_events: state.actualEvents.map(actualEventRow),
    }),
  );

  if (state.customColumns.length) {
    await throwIfError(supabase.from("custom_columns").upsert(state.customColumns.map(customColumnRow)));
  }

  if (staleTaskIds.length) {
    await throwIfError(supabase.from("tasks").delete().in("id", staleTaskIds));
  }

  if (staleZoneIds.length) {
    await throwIfError(supabase.from("zones").delete().in("id", staleZoneIds));
  }

  if (staleComponentIds.length) {
    await throwIfError(supabase.from("manufacturing_components").delete().in("id", staleComponentIds));
  }

  if (staleDocumentTypeIds.length) {
    await throwIfError(supabase.from("document_type_codes").delete().in("id", staleDocumentTypeIds));
  }

  if (staleStationIds.length) {
    await throwIfError(supabase.from("stations").delete().in("id", staleStationIds));
  }

  if (staleCustomColumnIds.length) {
    await throwIfError(supabase.from("custom_columns").delete().in("id", staleCustomColumnIds));
  }
}

export async function savePlannerShellToSupabase(state: PlannerState, client?: ReturnType<typeof plannerClient>) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a workspace before saving planner data.");
  }

  const supabase = client ?? plannerClient();
  const [existingTasks, existingStations, existingZones, existingComponents, existingDocumentTypes, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id,sequence").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id,sequence").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("manufacturing_components").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(
      supabase
        .from("document_type_codes")
        .select("id")
        .or(documentTypeScopeFilter(state.product)),
    ),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("id")
        .or(customColumnScopeFilter(String(state.product.id), String(state.scenario.id))),
    ),
  ]);

  const nextTaskIds = state.tasks.map((task) => task.id);
  const staleTaskIds = (existingTasks ?? [])
    .map((task) => String(task.id))
    .filter((taskId) => !nextTaskIds.includes(taskId));
  const nextStationIds = state.stations.map((station) => station.id);
  const staleStationIds = (existingStations ?? [])
    .map((station) => String(station.id))
    .filter((stationId) => !nextStationIds.includes(stationId));
  const nextZoneIds = state.zones.map((zone) => zone.id);
  const staleZoneIds = (existingZones ?? [])
    .map((zone) => String(zone.id))
    .filter((zoneId) => !nextZoneIds.includes(zoneId));
  const nextComponentIds = state.components.map((component) => component.id);
  const staleComponentIds = (existingComponents ?? [])
    .map((component) => String(component.id))
    .filter((componentId) => !nextComponentIds.includes(componentId));
  const nextDocumentTypeIds = state.documentTypes.map((documentType) => documentType.id);
  const staleDocumentTypeIds = (existingDocumentTypes ?? [])
    .map((documentType) => String(documentType.id))
    .filter((documentTypeId) => !nextDocumentTypeIds.includes(documentTypeId));
  const nextCustomColumnIds = state.customColumns.map((column) => column.id);
  const staleCustomColumnIds = (existingCustomColumns ?? [])
    .map((column) => String(column.id))
    .filter((columnId) => !nextCustomColumnIds.includes(columnId));

  // Tripwire BEFORE any write: refuse mass deletion that signals a truncated load.
  assertSaneStateDeletion("tasks", (existingTasks ?? []).length, staleTaskIds.length);
  assertSaneStateDeletion("stations", (existingStations ?? []).length, staleStationIds.length);
  assertSaneStateDeletion("zones", (existingZones ?? []).length, staleZoneIds.length);
  assertSaneStateDeletion("components", (existingComponents ?? []).length, staleComponentIds.length);
  assertSaneStateDeletion("document types", (existingDocumentTypes ?? []).length, staleDocumentTypeIds.length);
  assertSaneStateDeletion("custom columns", (existingCustomColumns ?? []).length, staleCustomColumnIds.length);

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await parkSequencesIfUpsertWouldCollide(supabase, "stations", state.stations, existingStations ?? []);
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await parkSequencesIfUpsertWouldCollide(supabase, "zones", state.zones, existingZones ?? []);
    await throwIfError(supabase.from("zones").upsert(state.zones.map(zoneRow)));
  }

  if (state.components.length) {
    await throwIfError(supabase.from("manufacturing_components").upsert(state.components.map(manufacturingComponentRow)));
  }

  if (state.documentTypes.length) {
    await throwIfError(supabase.from("document_type_codes").upsert(state.documentTypes.map(documentTypeCodeRow)));
  }

  await throwIfError(supabase.from("tasks").upsert(state.tasks.map(taskRow)));

  const existingDependencies = await throwIfError(
    supabase.from("task_dependencies").select("id").in("successor_task_id", nextTaskIds),
  );
  const nextDependencyIds = state.dependencies.map((dependency) => dependency.id);
  const staleDependencyIds = (existingDependencies ?? [])
    .map((dependency) => String(dependency.id))
    .filter((dependencyId) => !nextDependencyIds.includes(dependencyId));

  if (state.dependencies.length) {
    await throwIfError(supabase.from("task_dependencies").upsert(state.dependencies.map(dependencyRow)));
  }

  if (staleDependencyIds.length) {
    await throwIfError(supabase.from("task_dependencies").delete().in("id", staleDependencyIds));
  }

  if (state.customColumns.length) {
    await throwIfError(supabase.from("custom_columns").upsert(state.customColumns.map(customColumnRow)));
  }

  if (staleTaskIds.length) {
    await throwIfError(supabase.from("tasks").delete().in("id", staleTaskIds));
  }

  if (staleZoneIds.length) {
    await throwIfError(supabase.from("zones").delete().in("id", staleZoneIds));
  }

  if (staleComponentIds.length) {
    await throwIfError(supabase.from("manufacturing_components").delete().in("id", staleComponentIds));
  }

  if (staleDocumentTypeIds.length) {
    await throwIfError(supabase.from("document_type_codes").delete().in("id", staleDocumentTypeIds));
  }

  if (staleStationIds.length) {
    await throwIfError(supabase.from("stations").delete().in("id", staleStationIds));
  }

  if (staleCustomColumnIds.length) {
    await throwIfError(supabase.from("custom_columns").delete().in("id", staleCustomColumnIds));
  }
}
