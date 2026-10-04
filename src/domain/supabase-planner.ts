import { mergeTaskPrivateMedia, type TaskPrivateMedia } from "./task-private-media";
import { awiProcedureSaveBaseline } from "./awi-procedure-save";
import { saveAwiProcedure } from "@/lib/awi/procedure-store";
import { mergeAnnotationDocuments } from "@/lib/photo-annotation-drafts";
import { normalizePhotoAnnotationDocument } from "./photo-annotations";
import { readAllPages, readRowsByIds } from "@/lib/supabase/read-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, TablesUpdate } from "@/lib/database.types";
import type {
  ManufacturingStep,
  PartReference,
  PlannerState,
  PlannerProjectContext,
  Product,
  ScenarioSummary,
  Task,
} from "./types";
import { STEP_PHOTO_ANNOTATIONS_FIELD, getTaskStepPhotoAnnotationMap } from "./step-photos";
import { STEP_TOOL_LISTS_FIELD } from "./step-tools";
import {
  PRODUCT_MASTER_BOM_FIELD,
  getMasterBom,
  serializeMasterBom,
  type MasterBom,
} from "./master-bom";
import { plannerClient } from "@/lib/planner/client";
export { createPlannerSupabaseClient, getUserFromSession } from "@/lib/planner/client";
import {
  assertTaskInProject,
  assertTaskRowInProject,
  customColumnScopeFilter,
  documentTypeScopeFilter,
  isMissingRelationError,
  throwIfError,
} from "@/lib/planner/query-helpers";
import {
  actualEventRow,
  customColumnRow,
  customFieldsRow,
  dependencyRow,
  documentTypeCodeRow,
  jsonObject,
  manufacturingComponentRow,
  manufacturingStepRow,
  manufacturingStepRows,
  mapActualEvent,
  mapCustomColumn,
  mapDependency,
  mapDocumentTypeCode,
  mapManufacturingComponent,
  mapManufacturingStepRecord,
  mapPartReferenceRecord,
  mapProduct,
  mapScenario,
  mapScenarioSummary,
  mapStation,
  mapTask,
  mapZone,
  maybeText,
  normalizeManufacturingStepSequences,
  num,
  partReferenceRows,
  procedureTaskUpdateRow,
  productRow,
  scenarioRow,
  stationRow,
  taskRow,
  zoneRow,
} from "@/lib/planner/row-mappers";
export { mapScenarioSummary, procedureTaskUpdateRow } from "@/lib/planner/row-mappers";
export {
  taskIdFromRealtimePayload,
  canPatchTaskFromRealtimePayload,
  isRealtimePayloadInScope,
  subscribePlannerStateChanges,
} from "@/lib/planner/realtime";
export type { PlannerRealtimePayload } from "@/lib/planner/realtime";
import {
  type StepExplodedViewRow,
  type StepPhotoRow,
  type StepToolRow,
  type TaskVideoRow,
  indexExplodedViews,
  indexStepPhotos,
  indexStepTools,
  indexTaskVideos,
  withNormalizedStepAssets,
} from "@/lib/planner/media-rows";
import {
  type StorageObjectPathRow,
  removeStorageObjects,
  stepPhotoBucket,
  storageObjectPaths,
  taskVideoBucket,
  withSignedExplodedViewRows,
  withSignedStepPhotoRows,
  withSignedTaskVideoRows,
} from "@/lib/planner/media-storage";
export { refreshSignedMediaUrl } from "@/lib/planner/media-storage";
export {
  softDeleteStepPhotoAttachmentFromSupabase,
  softDeleteExplodedViewFromSupabase,
  removeExplodedViewObject,
  updateStepPhotoCaptionInSupabase,
  uploadStepPhotoAttachment,
  removeStepPhotoAttachmentObject,
  copyStepPhotoAttachmentToStep,
  saveExplodedViewToSupabase,
  saveTaskVideoToSupabase,
  softDeleteTaskVideoFromSupabase,
  removeTaskVideoObject,
} from "@/lib/planner/media-store";
export type { ExplodedViewUploadInput, TaskVideoUploadInput } from "@/lib/planner/media-store";
import { syncStepToolsForTask, syncStepToolsForTasks } from "@/lib/planner/tool-store";
export {
  addStepToolToSupabase,
  removeStepToolFromSupabase,
  syncStepToolsForStepToSupabase,
  loadToolLibraryFromSupabase,
  uploadToolLibraryImage,
  upsertToolLibraryMetadata,
  deleteToolLibraryFromSupabase,
} from "@/lib/planner/tool-store";
export type { ToolLibraryItem } from "@/lib/planner/tool-store";
import { loadProjectContext } from "@/lib/planner/access-store";
export {
  fetchIsSuperAdmin,
  fetchOrgToolAccess,
  loadAuditLogFromSupabase,
  setProjectAccessInSupabase,
  setOrgToolAccessInSupabase,
} from "@/lib/planner/access-store";
export type { AuditLogEntry } from "@/lib/planner/access-store";
export {
  ensureDefaultWorkspaceMembership,
  loadWorkspaceProjectGroups,
  createProjectWithStarterPlan,
  updateWorkspaceInSupabase,
  loadProfileNamesByIds,
  updateProjectInSupabase,
  deleteProjectFromSupabase,
  loadWorkspaceMembersFromSupabase,
  loadWorkspaceAccessGrantsFromSupabase,
  upsertWorkspaceAccessGrantInSupabase,
  removeWorkspaceMemberInSupabase,
  updateWorkspaceMemberRoleInSupabase,
  updateOwnProfileNameInSupabase,
  deleteWorkspaceAccessGrantFromSupabase,
  loadMembersAccessForWorkspace,
} from "@/lib/planner/workspace-store";

export type SaveState = "idle" | "loading" | "saving" | "saved" | "draft" | "retrying" | "conflict" | "error";

function manufacturingStepSaveNeedsCollisionSafeResequence(
  nextSteps: ManufacturingStep[],
  existingSteps: Array<{ id: unknown; sequence: unknown }>,
): boolean {
  const normalizedNext = normalizeManufacturingStepSequences(nextSteps);
  const existingById = new Map(existingSteps.map((step) => [String(step.id), num(step.sequence)]));
  const nextIds = new Set(normalizedNext.map((step) => step.id));

  if (new Set(normalizedNext.map((step) => step.sequence)).size !== normalizedNext.length) {
    return true;
  }

  for (const step of normalizedNext) {
    const previousSequence = existingById.get(step.id);

    if (previousSequence === undefined) {
      const sequenceOccupied = existingSteps.some(
        (existingStep) =>
          nextIds.has(String(existingStep.id)) &&
          num(existingStep.sequence) === step.sequence &&
          String(existingStep.id) !== step.id,
      );
      if (sequenceOccupied) {
        return true;
      }
      continue;
    }

    if (previousSequence === step.sequence) {
      continue;
    }

    const sequenceOccupied = existingSteps.some(
      (existingStep) =>
        num(existingStep.sequence) === step.sequence &&
        String(existingStep.id) !== step.id &&
        nextIds.has(String(existingStep.id)),
    );
    if (sequenceOccupied) {
      return true;
    }
  }

  return false;
}

async function bumpManufacturingStepSequences(supabase: SupabaseClient, stepIds: string[]) {
  if (stepIds.length === 0) {
    return;
  }

  const currentSteps = await throwIfError(supabase.from("manufacturing_steps").select("id,sequence").in("id", stepIds));
  const maxSequence = Math.max(
    100000,
    ...(currentSteps ?? []).map((step) => num(step.sequence)),
  );
  const temporaryBaseSequence = maxSequence + stepIds.length + 1;

  await Promise.all(
    stepIds.map((stepId, index) =>
      throwIfError(supabase.from("manufacturing_steps").update({ sequence: temporaryBaseSequence + index }).eq("id", stepId)),
    ),
  );
}

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

export async function loadPlannerStateWithProjectFromSupabase(
  projectId?: string,
  scenarioId?: string,
  client?: ReturnType<typeof plannerClient>,
  options: { includeTaskMedia?: boolean } = {},
): Promise<{
  state: PlannerState;
  project: PlannerProjectContext;
} | null> {
  const supabase = client ?? plannerClient();
  const includeTaskMedia = options.includeTaskMedia !== false;
  const product = projectId
    ? await throwIfError(
        supabase
          .from("products")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      )
    : await throwIfError(
        supabase.from("products").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle(),
      );

  if (!product) {
    return null;
  }

  // When a scenarioId is given, load that specific scenario (scoped to this product so a caller can
  // never pull another product's scenario). Otherwise fall back to the earliest = "Main" scenario,
  // which preserves the original single-scenario behavior.
  const [project, scenario] = await Promise.all([
    projectId || product.project_id
      ? loadProjectContext(supabase, String(projectId ?? product.project_id))
      : Promise.resolve(undefined),
    throwIfError(
      scenarioId
      ? supabase
          .from("scenarios")
          .select("*")
          .eq("product_id", product.id)
          .eq("id", scenarioId)
          .maybeSingle()
      : supabase
          .from("scenarios")
          .select("*")
          .eq("product_id", product.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
    ),
  ]);

  if (!scenario) {
    return null;
  }

  const documentTypeFilter = documentTypeScopeFilter({ id: String(product.id), projectId: maybeText(product.project_id) });
  const [stations, zones, components, documentTypes, taskRows, customColumns] = await Promise.all([
    readAllPages((from, to) => throwIfError(supabase.from("stations").select("*").eq("scenario_id", scenario.id).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("zones").select("*").eq("scenario_id", scenario.id).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("manufacturing_components").select("*").eq("scenario_id", scenario.id).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(
      supabase
        .from("document_type_codes")
        .select("*")
        .or(documentTypeFilter)
        .order("created_at").order("id").range(from, to),
    )),
    readAllPages((from, to) => throwIfError(supabase.from("tasks").select("*").eq("scenario_id", scenario.id).order("wbs").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(
      supabase
        .from("custom_columns")
        .select("*")
        .or(customColumnScopeFilter(String(product.id), String(scenario.id)))
        .order("created_at").order("id").range(from, to),
    )),
  ]);

  const taskIds = (taskRows ?? []).map((task) => String(task.id));
  const [dependencies, manufacturingSteps, partReferences, actualEvents, stepPhotos, stepTools, explodedViews, taskVideos] = taskIds.length
    ? await Promise.all([
        readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("task_dependencies").select("*").in("successor_task_id", ids).order("id").range(from, to))),
        readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("manufacturing_steps").select("*").in("task_id", ids).order("sequence").order("id").range(from, to))),
        readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("part_references").select("*").in("task_id", ids).order("created_at").order("id").range(from, to))),
        readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("actual_events").select("*").in("task_id", ids).order("timestamp").order("id").range(from, to))),
        includeTaskMedia
          ? readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("step_photos").select("*").in("task_id", ids).is("deleted_at", null).order("captured_at").order("id").range(from, to)))
          : Promise.resolve([]),
        readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("step_tools").select("*").in("task_id", ids).order("sequence").order("id").range(from, to))),
        includeTaskMedia
          ? readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("step_exploded_views").select("*").in("task_id", ids).is("deleted_at", null).order("captured_at").order("id").range(from, to)))
          : Promise.resolve([]),
        includeTaskMedia
          ? readRowsByIds(taskIds, (ids, from, to) => throwIfError(supabase.from("task_videos").select("*").in("task_id", ids).is("deleted_at", null).order("captured_at").order("id").range(from, to)))
          : Promise.resolve([]),
      ])
    : [[], [], [], [], [], [], [], []];
  // Private procedure media is the expensive part of a Product load: three more
  // relational reads followed by storage URL signing. The initial editable-core
  // confirmation deliberately skips it; loadTaskFromSupabase hydrates only the
  // selected task when Procedure is opened. Full callers keep the legacy behavior
  // and all eight task-child queries remain parallel.
  const scenarioTaskIds = new Set(taskIds);
  const dependencyIdsByTaskId = new Map<string, string[]>();
  const stepsByTaskId = new Map<string, ManufacturingStep[]>();
  const partsByTaskId = new Map<string, PartReference[]>();
  const [signedStepPhotos, signedExplodedViews, signedTaskVideos] = await Promise.all([
    withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]),
    withSignedExplodedViewRows(supabase, (explodedViews ?? []) as StepExplodedViewRow[]),
    withSignedTaskVideoRows(supabase, (taskVideos ?? []) as TaskVideoRow[]),
  ]);
  const photosByTaskId = indexStepPhotos(signedStepPhotos);
  const toolsByTaskId = indexStepTools((stepTools ?? []) as StepToolRow[]);
  const explodedViewsByTaskId = indexExplodedViews(signedExplodedViews);
  const videosByTaskId = indexTaskVideos(signedTaskVideos);

  (dependencies ?? []).forEach((dependency) => {
    const successorTaskId = String(dependency.successor_task_id);
    const currentDependencies = dependencyIdsByTaskId.get(successorTaskId) ?? [];
    currentDependencies.push(String(dependency.predecessor_task_id));
    dependencyIdsByTaskId.set(successorTaskId, currentDependencies);
  });

  (manufacturingSteps ?? []).forEach((step) => {
    const taskId = String(step.task_id);
    const currentSteps = stepsByTaskId.get(taskId) ?? [];
    currentSteps.push(mapManufacturingStepRecord(step));
    stepsByTaskId.set(taskId, normalizeManufacturingStepSequences(currentSteps));
  });

  (partReferences ?? []).forEach((part) => {
    const taskId = String(part.task_id);
    const currentParts = partsByTaskId.get(taskId) ?? [];
    currentParts.push(mapPartReferenceRecord(part));
    partsByTaskId.set(taskId, currentParts);
  });

  const mappedProduct = mapProduct(product);
  const projectContext = project ?? (mappedProduct.projectId ? await loadProjectContext(supabase, mappedProduct.projectId) : undefined);

  if (!projectContext) {
    throw new Error("This product is not assigned to a workspace yet.");
  }

  const state: PlannerState = {
    project: projectContext,
    product: mappedProduct,
    scenario: mapScenario(scenario),
    stations: (stations ?? []).map(mapStation),
    zones: (zones ?? []).map(mapZone),
    components: (components ?? []).map(mapManufacturingComponent),
    documentTypes: (documentTypes ?? []).map(mapDocumentTypeCode),
    tasks: (taskRows ?? []).map((task) => {
      const mappedTask = mapTask({
        ...task,
        // Old rows can still contain denormalized media in custom_fields. Do
        // not let those bypass the lazy-media boundary in a core-only load.
        custom_fields: includeTaskMedia ? task.custom_fields : customFieldsRow(jsonObject(task.custom_fields)),
        dependency_ids: dependencyIdsByTaskId.get(String(task.id)) ?? [],
        manufacturing_steps: stepsByTaskId.get(String(task.id)) ?? [],
        part_references: partsByTaskId.get(String(task.id)) ?? [],
      });

      return withNormalizedStepAssets(mappedTask, photosByTaskId, toolsByTaskId, explodedViewsByTaskId, videosByTaskId);
    }),
    dependencies: (dependencies ?? [])
      .filter(
        (dependency) =>
          scenarioTaskIds.has(String(dependency.predecessor_task_id)) ||
          scenarioTaskIds.has(String(dependency.successor_task_id)),
      )
      .map(mapDependency),
    actualEvents: (actualEvents ?? [])
      .filter((event) => scenarioTaskIds.has(String(event.task_id)))
      .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || String(left.id).localeCompare(String(right.id)))
      .map(mapActualEvent),
    customColumns: (customColumns ?? []).map(mapCustomColumn),
  };

  return { state, project: projectContext };
}

type PlannerSummaryRows = {
  product: Record<string, unknown>;
  scenario: Record<string, unknown>;
  stations: Record<string, unknown>[];
  zones: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
};

const PRODUCT_SUMMARY_COLUMNS =
  "id,project_id,product_code,name,sku,family,revision,description,owner_id,owner_name,status,target_man_hours,demand_quantity,demand_period,gross_available_minutes,break_minutes,lunch_minutes,meeting_minutes,planned_downtime_minutes,work_days_per_week,work_weeks_per_month,available_work_days_per_month,net_available_minutes,weekly_available_minutes,monthly_available_minutes,calculated_takt_minutes,manual_takt_minutes,active_takt_minutes,created_at,updated_at";

/**
 * Build the deliberately narrow Product-dashboard snapshot.
 *
 * This is not a complete editable PlannerState: task children, dependencies,
 * nomenclature, custom columns and media stay absent until the client's
 * editable-core load confirms them. Keeping this transformation explicit prevents a
 * future relational select from accidentally putting procedures or media back
 * into the route's initial RSC payload.
 */
export function buildPlannerSummaryState({
  product,
  scenario,
  stations,
  zones,
  tasks,
}: PlannerSummaryRows): PlannerState {
  return {
    project: undefined,
    // Product custom fields currently hold the master BOM and procedure check
    // definitions. Neither is used by the dashboard, so keep that potentially
    // large editable payload in the complete background load as well.
    product: mapProduct({ ...product, custom_fields: {} }),
    scenario: mapScenario(scenario),
    stations: stations.map(mapStation),
    zones: zones.map(mapZone),
    components: [],
    documentTypes: [],
    tasks: tasks.map((task) =>
      mapTask({
        ...task,
        custom_fields: customFieldsRow(jsonObject(task.custom_fields)),
        dependency_ids: [],
        manufacturing_steps: [],
        part_references: [],
      }),
    ),
    dependencies: [],
    actualEvents: [],
    customColumns: [],
  };
}

/**
 * Product-dashboard first paint. Unlike loadPlannerStateFromSupabase, this
 * intentionally stops at the task rows and never reads task children or signs
 * media URLs. It is safe to display immediately, but callers must keep writes
 * disabled until the editable-core load has confirmed the graph.
 */
export async function loadPlannerSummaryStateFromSupabase(
  projectId: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerState | null> {
  const supabase = client ?? plannerClient();
  const product = await throwIfError(
    supabase
      .from("products")
      .select(PRODUCT_SUMMARY_COLUMNS)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );

  if (!product) {
    return null;
  }

  const scenario = await throwIfError(
    supabase
      .from("scenarios")
      .select("*")
      .eq("product_id", product.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );

  if (!scenario) {
    return null;
  }

  const [stations, zones, tasks] = await Promise.all([
    readAllPages((from, to) => throwIfError(supabase.from("stations").select("*").eq("scenario_id", scenario.id).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("zones").select("*").eq("scenario_id", scenario.id).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("tasks").select("*").eq("scenario_id", scenario.id).order("wbs").order("id").range(from, to))),
  ]);

  return buildPlannerSummaryState({
    product,
    scenario,
    stations: (stations ?? []) as Record<string, unknown>[],
    zones: (zones ?? []) as Record<string, unknown>[],
    tasks: (tasks ?? []) as Record<string, unknown>[],
  });
}

export async function loadPlannerStateFromSupabase(
  projectId?: string,
  scenarioId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerState | null> {
  const loaded = await loadPlannerStateWithProjectFromSupabase(projectId, scenarioId, client);
  return loaded?.state ?? null;
}

/**
 * Editable Product planner graph without private procedure media.
 *
 * This confirms the shell, planning rows, steps, parts and tools so autosave is
 * safe without paying to fetch and sign every task's photos, exploded views and
 * videos. Procedure hydrates those assets one selected task at a time.
 */
export async function loadPlannerCoreStateFromSupabase(
  projectId?: string,
  scenarioId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerState | null> {
  const loaded = await loadPlannerStateWithProjectFromSupabase(projectId, scenarioId, client, {
    includeTaskMedia: false,
  });
  return loaded?.state ?? null;
}

// Lightweight list of a product's scenarios for the switcher tabs (earliest first = "Main").
export async function loadScenariosForProduct(productId: string): Promise<ScenarioSummary[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("scenarios")
      .select("id,name,target_output,target_output_period,notes,created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: true }),
  );
  return ((rows ?? []) as Record<string, unknown>[]).map(mapScenarioSummary);
}

export type SopSummary = {
  id: string;
  sopNumber?: string;
  title?: string;
  status?: string;
};

// Lightweight list of SOPs for the task SOP picker. The sops table is read-gated by org-tools
// access, so a planner user without that access simply gets zero rows back -- callers treat an
// empty list as "hide the picker" rather than an error. Real errors also degrade to [] (with a
// console.warn) so a broken SOP lookup can never break the planner.
export async function listSopSummariesFromSupabase(): Promise<SopSummary[]> {
  try {
    const supabase = plannerClient();
    const { data, error } = await supabase
      .from("sops")
      .select("id,sop_number,title,status")
      .is("deleted_at", null)
      .order("sop_number", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      if (!isMissingRelationError(error)) {
        console.warn(`Failed to load SOP summaries for the task picker: ${error.message}`);
      }
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      sopNumber: maybeText(row.sop_number),
      title: maybeText(row.title),
      status: maybeText(row.status),
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load SOP summaries for the task picker: ${detail}`);
    return [];
  }
}

// Deep-copy a scenario into a new independent "projection" scenario (high-level Gantt only -- stations,
// zones, components, tasks with planned time + manpower, dependencies; no procedures/tools/photos/parts)
// via the duplicate_scenario RPC. Returns the new scenario id.
export async function duplicateScenario(sourceScenarioId: string, newName: string): Promise<string> {
  const supabase = plannerClient();
  const newId = await throwIfError(
    supabase.rpc("duplicate_scenario", {
      p_source_scenario_id: sourceScenarioId,
      p_new_name: newName,
    }),
  );
  return String(newId);
}

// Update a scenario's projection target (units + period). This drives the active-scenario takt for
// non-main scenarios (see calculateActiveTaktMinutes).
export async function updateScenarioTarget(
  scenarioId: string,
  targetOutput: number,
  targetOutputPeriod: string,
): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(
    supabase
      .from("scenarios")
      .update({ target_output: targetOutput, target_output_period: targetOutputPeriod })
      .eq("id", scenarioId),
  );
}

// Rename a scenario (used for projection tabs; the UI prevents renaming Main).
export async function renameScenario(scenarioId: string, name: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(supabase.from("scenarios").update({ name }).eq("id", scenarioId));
}

// Delete a scenario via the guarded RPC (refuses the Main/earliest scenario and the only scenario).
// Children cascade. The UI also hides delete for Main; this is the DB-level half of that guard.
export async function deleteScenario(scenarioId: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(supabase.rpc("delete_scenario", { p_scenario_id: scenarioId }));
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

/**
 * Persist only the product-level master BOM and verify the exact value returned
 * by the database before the UI reports success. This intentionally bypasses
 * the broader planner-shell autosave so an upload cannot be lost to debounce or
 * page-unload timing.
 */
export async function saveMasterBomToSupabase(
  product: Product,
  bom: MasterBom | undefined,
  projectId: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<Product> {
  if (!product.projectId || String(product.projectId) !== String(projectId)) {
    throw new Error("The master BOM does not belong to the active project.");
  }

  const expectedBom = bom ? serializeMasterBom(bom) : undefined;
  const customFields = { ...(product.customFields ?? {}) };
  if (expectedBom) {
    customFields[PRODUCT_MASTER_BOM_FIELD] = expectedBom;
  } else {
    delete customFields[PRODUCT_MASTER_BOM_FIELD];
  }

  const supabase = client ?? plannerClient();
  const savedRow = await throwIfError(
    supabase
      .from("products")
      .update({ custom_fields: customFields as Json })
      .eq("id", product.id)
      .eq("project_id", projectId)
      .select("*")
      .maybeSingle(),
  );

  if (!savedRow) {
    throw new Error("The master BOM could not be saved. Check your project edit access and retry.");
  }

  const savedProduct = mapProduct(savedRow);
  const verifiedBom = getMasterBom(savedProduct.customFields);
  const didVerify = expectedBom
    ? JSON.stringify(verifiedBom) === JSON.stringify(expectedBom)
    : !Object.prototype.hasOwnProperty.call(savedProduct.customFields ?? {}, PRODUCT_MASTER_BOM_FIELD);

  if (!didVerify) {
    throw new Error("The master BOM save could not be verified. Retry before leaving this page.");
  }

  return savedProduct;
}

export async function saveTasksToSupabase(tasks: Task[], projectId?: string) {
  if (tasks.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await Promise.all(tasks.map((task) => assertTaskRowInProject(supabase, task, projectId)));
  await throwIfError(supabase.from("tasks").upsert(tasks.map(taskRow)));
  await syncStepToolsForTasks(supabase, tasks);
}

export async function saveTaskRowToSupabase(task: Task, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskRowInProject(supabase, task, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
}

export async function saveTaskToSupabase(task: Task, projectId?: string) {
  await saveTasksToSupabase([task], projectId);
}

/** Save markup without rewriting steps, parts, or unrelated task metadata. */
export async function saveTaskPhotoAnnotationsToSupabase(task: Task, base: ReturnType<typeof getTaskStepPhotoAnnotationMap>, projectId?: string, providedClient?: SupabaseClient) {
  const supabase = providedClient ?? plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  const local = getTaskStepPhotoAnnotationMap(task);
  const empty = normalizePhotoAnnotationDocument(undefined);
  const changedIds = [...new Set([...Object.keys(base), ...Object.keys(local)])].filter(
    id => JSON.stringify(base[id]?.items ?? []) !== JSON.stringify(local[id]?.items ?? []),
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await throwIfError(supabase.from("tasks").select("custom_fields,version").eq("id", task.id).single());
    if (!row) throw new Error("Photo annotation task is no longer available.");
    const fields = row.custom_fields && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields)
      ? {...row.custom_fields} : {};
    const remote = getTaskStepPhotoAnnotationMap({customFields:fields});
    for (const id of changedIds) {
      const merged = mergeAnnotationDocuments(base[id] ?? empty, local[id] ?? empty, remote[id] ?? empty);
      if (merged.items.length) remote[id] = merged;
      else delete remote[id];
    }
    if (Object.keys(remote).length) fields.stepPhotoAnnotations = remote as unknown as Json;
    else delete fields.stepPhotoAnnotations;
    const saved = await throwIfError(supabase.from("tasks").update({custom_fields:fields})
      .eq("id",task.id).eq("version",row.version).select("version").maybeSingle());
    if (saved) return mergeTaskPrivateMedia({
      ...task, version: Number(saved.version),
      customFields: {...task.customFields, ...fields, stepPhotoAnnotations: remote},
    }, task);
  }
  throw new Error("Photo annotations changed during saving. Please try again.");
}

export async function saveTaskCustomFieldsToSupabase(taskId: string, customFields: Task["customFields"], projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(supabase.from("tasks").update({ custom_fields: customFieldsRow(customFields) }).eq("id", taskId));
}

export async function saveTaskWithManufacturingStepsToSupabase(task: Task, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  const existingSteps = await throwIfError(supabase.from("manufacturing_steps").select("id").eq("task_id", task.id));
  const nextStepIds = (task.manufacturingSteps ?? []).map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));

  if (existingSteps?.length) {
    await bumpManufacturingStepSequences(
      supabase,
      existingSteps.map((step) => String(step.id)),
    );
  }

  const steps = manufacturingStepRows([task]);
  if (steps.length) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(steps));
  }

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  await syncStepToolsForTask(supabase, task, { allowEmptyWipe: true });
}

export async function saveTaskAndManufacturingStepToSupabase(task: Task, step: ManufacturingStep, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(task.id, step)));
}

/** Phone edits own individual step fields, never a stale copy of the entire procedure. */
export async function saveMobileStepToSupabase(
  task: Task,
  step: ManufacturingStep,
  patch: Partial<Pick<ManufacturingStep, "name" | "instruction" | "durationMinutes" | "qualityCheck">>,
  projectId?: string,
  providedClient?: ReturnType<typeof plannerClient>,
): Promise<ManufacturingStep> {
  const supabase = providedClient ?? plannerClient();
  await assertTaskRowInProject(supabase, task, projectId);
  const parent = await throwIfError(supabase.from("tasks").select("id").eq("id", task.id).maybeSingle());
  if (!parent) {
    if (task.version !== undefined) {
      throw new Error("This process is no longer available. Your draft has been kept.");
    }
    // A new local process must exist before any child write. Ignore a simultaneous
    // insert by another save, rather than replacing its metadata with our snapshot.
    await throwIfError(supabase.from("tasks").upsert(taskRow(task), { onConflict: "id", ignoreDuplicates: true }));
  }
  await assertTaskInProject(supabase, task.id, projectId);
  const fields: { name?: string; instruction?: string; duration_minutes?: number; quality_check?: string } = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.instruction !== undefined) fields.instruction = patch.instruction;
  if (patch.durationMinutes !== undefined) fields.duration_minutes = patch.durationMinutes;
  if (patch.qualityCheck !== undefined) fields.quality_check = patch.qualityCheck;
  let saved: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", task.id));
    const existing = (rows ?? []).find((row) => String(row.id) === step.id);
    if (existing) {
      saved = Object.keys(fields).length
        ? await throwIfError(supabase.from("manufacturing_steps").update(fields).eq("id", step.id).eq("task_id", task.id).select("*").maybeSingle())
        : existing;
      break;
    }
    if (step.version !== undefined) {
      throw new Error("This step was deleted on another device. Your draft has been kept.");
    }
    const sequence = (rows ?? []).reduce((max, row) => Math.max(max, Number(row.sequence)), 0) + 1;
    const result = await supabase.from("manufacturing_steps").insert({ ...manufacturingStepRow(task.id, step), sequence }).select("*").maybeSingle();
    if (result.error?.code === "23505" && attempt < 2) continue;
    if (result.error) throw result.error;
    saved = result.data;
    break;
  }
  if (!saved) throw new Error("The step could not be saved. Your draft has been kept.");
  if (patch.durationMinutes !== undefined) {
    const rows = await throwIfError(supabase.from("manufacturing_steps").select("duration_minutes").eq("task_id", task.id));
    const minutes = (rows ?? []).reduce((total, row) => total + Math.max(Number(row.duration_minutes) || 0, 0), 0);
    await throwIfError(supabase.from("tasks").update({ planned_duration_minutes: minutes }).eq("id", task.id));
  }
  return mapManufacturingStepRecord(saved);
}

export async function saveManufacturingStepToSupabase(taskId: string, step: ManufacturingStep, projectId?: string) {
  // Merge the incoming step into the task's current step set and persist via the version-checked,
  // retry-on-conflict procedure path. The previous standalone read-then-upsert had a lost-update
  // window (audit #12): a concurrent write between the read and the upsert was silently
  // overwritten. saveProcedureTaskUpdateToSupabase performs per-step version checks and, on a
  // conflict, reloads the latest server state and re-applies -- so concurrent step edits to the
  // same task serialize instead of clobbering each other.
  const task = await loadTaskFromSupabase(taskId, projectId);
  if (!task) {
    throw new Error("Task not found or you do not have access to it.");
  }

  const existingSteps = task.manufacturingSteps ?? [];
  const mergedSteps = existingSteps.some((candidate) => candidate.id === step.id)
    ? existingSteps.map((candidate) =>
        // Apply the edit but keep the freshly-loaded server version so the optimistic check
        // (and its retry) is anchored to current state, not a stale client value.
        candidate.id === step.id ? { ...candidate, ...step, version: candidate.version } : candidate,
      )
    : [...existingSteps, step];

  await saveProcedureTaskUpdateToSupabase({ ...task, manufacturingSteps: mergedSteps }, [], projectId);
}

type TaskFieldPatch = Partial<
  Pick<
    Task,
    | "name"
    | "description"
    | "plannedStart"
    | "plannedFinish"
    | "plannedDurationMinutes"
    | "plannedOperators"
    | "plannedManHours"
    | "status"
    | "percentComplete"
    | "ownerId"
    | "ownerName"
    | "role"
    | "skillLevel"
    | "criticalPath"
    | "bottleneckFlag"
    | "qualityGate"
    | "travelerSignoffRequired"
    | "safetyNotes"
    | "qcChecklist"
    | "notes"
    | "zoneId"
    | "componentId"
    | "taskNumber"
    | "manufacturingCode"
    | "codeLocked"
    | "codeGeneratedAt"
    | "stationId"
    | "wbs"
  >
>;

function taskFieldPatchRow(patch: TaskFieldPatch) {
  const row: Record<string, unknown> = {};
  // Column names are constrained to the generated schema: a renamed or typo'd
  // column now fails to compile instead of silently no-oping at runtime.
  const setters: [keyof TaskFieldPatch, keyof TablesUpdate<"tasks"> & string][] = [
    ["name", "name"],
    ["description", "description"],
    ["plannedStart", "planned_start"],
    ["plannedFinish", "planned_finish"],
    ["plannedDurationMinutes", "planned_duration_minutes"],
    ["plannedOperators", "planned_operators"],
    ["plannedManHours", "planned_man_hours"],
    ["status", "status"],
    ["percentComplete", "percent_complete"],
    ["ownerId", "owner_id"],
    ["ownerName", "owner_name"],
    ["role", "role"],
    ["skillLevel", "skill_level"],
    ["criticalPath", "critical_path"],
    ["bottleneckFlag", "bottleneck_flag"],
    ["qualityGate", "quality_gate"],
    ["travelerSignoffRequired", "traveler_signoff_required"],
    ["safetyNotes", "safety_notes"],
    ["qcChecklist", "qc_checklist"],
    ["notes", "notes"],
    ["zoneId", "zone_id"],
    ["componentId", "component_id"],
    ["taskNumber", "task_number"],
    ["manufacturingCode", "manufacturing_code"],
    ["codeLocked", "code_locked"],
    ["codeGeneratedAt", "code_generated_at"],
    ["stationId", "station_id"],
    ["wbs", "wbs"],
  ];

  setters.forEach(([key, column]) => {
    if (patch[key] !== undefined) {
      row[column] = patch[key] ?? null;
    }
  });

  // Dynamic build above; the cast is safe because every key came from the
  // schema-constrained setters table.
  return row as TablesUpdate<"tasks">;
}

export async function updateTaskFields(taskId: string, patch: TaskFieldPatch, expectedVersion?: number, projectId?: string) {
  const supabase = plannerClient();
  const row = taskFieldPatchRow(patch);

  if (Object.keys(row).length === 0) {
    return;
  }

  await assertTaskInProject(supabase, taskId, projectId);
  let operation = supabase.from("tasks").update(row).eq("id", taskId);

  if (expectedVersion !== undefined) {
    operation = operation.eq("version", expectedVersion);
  }

  const saved = await throwIfError(operation.select("id,version").maybeSingle());
  if (!saved) {
    throw new Error("Task save conflict. Reload this task before saving again.");
  }
}

export async function upsertProcedureStep(taskId: string, step: ManufacturingStep, expectedVersion?: number, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);

  if (expectedVersion === undefined) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(taskId, step)));
    return;
  }

  const row = manufacturingStepRow(taskId, step);
  const saved = await throwIfError(
    supabase.from("manufacturing_steps").update(row).eq("id", step.id).eq("version", expectedVersion).select("id,version").maybeSingle(),
  );

  if (!saved) {
    throw new Error("Procedure step save conflict. Reload this task before saving again.");
  }
}

export async function reorderProcedureSteps(taskId: string, orderedStepIds: string[], projectId?: string) {
  if (orderedStepIds.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // Atomic, single round-trip: the RPC does the two-phase sequence swap server-side inside one
  // transaction, so a partial failure can no longer leave steps with duplicate sequences.
  await throwIfError(
    supabase.rpc("reorder_manufacturing_steps", { p_task_id: taskId, p_step_ids: orderedStepIds }),
  );
}

export async function deletePlannerTask(taskId: string, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // Snapshot the task's storage object paths BEFORE the row delete: the FK cascade removes the
  // step_photos/step_exploded_views/task_videos rows, after which the paths are unrecoverable and
  // the objects would be orphaned in Storage. Soft-deleted rows are included on purpose -- the
  // cascade removes them too, so their objects would otherwise orphan as well.
  const [photoRows, explodedViewRows, videoRows] = await Promise.all([
    throwIfError(supabase.from("step_photos").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
    throwIfError(supabase.from("step_exploded_views").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
    throwIfError(supabase.from("task_videos").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
  ]);
  // task_dependencies (both endpoints), manufacturing_steps, part_references, actual_events and
  // step_tools all FK to tasks ON DELETE CASCADE, so deleting the task atomically removes them.
  // The previous manual dependency deletes were redundant and opened a split-brain window
  // (edges gone, task still present) if the task delete then failed.
  await throwIfError(supabase.from("tasks").delete().eq("id", taskId));
  // Best-effort storage cleanup once the delete has committed (photos and exploded views share the
  // step-photos bucket; videos live in their own). Failures are logged, not thrown.
  await removeStorageObjects(
    supabase,
    stepPhotoBucket,
    storageObjectPaths([...((photoRows ?? []) as StorageObjectPathRow[]), ...((explodedViewRows ?? []) as StorageObjectPathRow[])]),
  );
  await removeStorageObjects(supabase, taskVideoBucket, storageObjectPaths((videoRows ?? []) as StorageObjectPathRow[]));
}

function mergeTaskWithServerVersions(localTask: Task, serverTask: Task): Task {
  const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
  const localStepIds = new Set((localTask.manufacturingSteps ?? []).map((step) => step.id));
  const mergedSteps = [
    ...(localTask.manufacturingSteps ?? []).map((step) => {
      const serverStep = serverStepById.get(step.id);
      return serverStep ? { ...serverStep, ...step, version: serverStep.version } : step;
    }),
    ...(serverTask.manufacturingSteps ?? []).filter((step) => !localStepIds.has(step.id)),
  ];

  return {
    ...serverTask,
    ...localTask,
    version: serverTask.version,
    manufacturingSteps: normalizeManufacturingStepSequences(
      mergedSteps.length > 0 ? mergedSteps : (serverTask.manufacturingSteps ?? []),
    ),
  };
}

export async function saveProcedureTaskUpdateToSupabase(
  task: Task,
  _scheduledTasks: Task[],
  projectId?: string,
  allowVersionRetry = true,
  client?: ReturnType<typeof plannerClient>,
) {
  const supabase = client ?? plannerClient();
  const normalizedSteps = normalizeManufacturingStepSequences(task.manufacturingSteps ?? []);
  const taskToSave = { ...task, manufacturingSteps: normalizedSteps };
  const taskProcedurePatch = procedureTaskUpdateRow(taskToSave);
  if (typeof task.customFields?.awiDocumentNumber === "string") {
    const baseline = task.procedureSaveBaseline ?? awiProcedureSaveBaseline(task);
    const awiProjectId = projectId ?? await throwIfError(supabase.rpc("task_project_id", { target_task_id: task.id }));
    if (!awiProjectId) throw new Error("This AWI does not belong to an active workspace.");
    const confirmed = jsonObject(await saveAwiProcedure({
      p_task_id: task.id,
      p_project_id: awiProjectId,
      p_expected_version: task.version ?? 0,
      p_expected_step_versions: baseline.stepVersions,
      p_expected_parts: partReferenceRows([{ ...task, partReferences: baseline.partReferences }]),
      p_task_patch: taskProcedurePatch,
      p_steps: manufacturingStepRows([taskToSave]),
      p_parts: partReferenceRows([taskToSave]),
    }, supabase));
    const confirmedRow = jsonObject(confirmed.task);
    if (confirmedRow.id !== task.id || typeof confirmedRow.version !== "number" ||
        !Array.isArray(confirmed.steps) || !Array.isArray(confirmed.parts)) {
      throw new Error("Unable to confirm the saved AWI. Your local draft is preserved; try saving again.");
    }
    const savedTask = mapTask({ ...confirmedRow, manufacturing_steps: confirmed.steps, part_references: confirmed.parts });
    // Media/tools are independently normalized rows; retain the snapshot's signed assets without
    // another read that might acknowledge a different edit committed after this transaction.
    const withMedia = mergeTaskPrivateMedia(savedTask, taskToSave);
    if (STEP_TOOL_LISTS_FIELD in taskToSave.customFields) {
      withMedia.customFields[STEP_TOOL_LISTS_FIELD] = taskToSave.customFields[STEP_TOOL_LISTS_FIELD];
    }
    return withMedia;
  }
  await assertTaskInProject(supabase, task.id, projectId);
  let taskUpdate = supabase.from("tasks").update(taskProcedurePatch).eq("id", task.id);

  if (taskToSave.version !== undefined) {
    taskUpdate = taskUpdate.eq("version", taskToSave.version);
  }

  const savedTask = await throwIfError(taskUpdate.select("id,version").maybeSingle());
  if (!savedTask) {
    if (allowVersionRetry && taskToSave.version !== undefined) {
      const latestTask = await loadTaskFromSupabase(taskToSave.id, projectId);
      if (latestTask) {
        return saveProcedureTaskUpdateToSupabase(
          mergeTaskWithServerVersions(taskToSave, latestTask),
          _scheduledTasks,
          projectId,
          false,
          client,
        );
      }
    }

    throw new Error("Task save conflict. Reload this task before saving again.");
  }

  const [existingSteps, existingParts] = await Promise.all([
    throwIfError(supabase.from("manufacturing_steps").select("id,sequence,version").eq("task_id", taskToSave.id)),
    throwIfError(supabase.from("part_references").select("id").eq("task_id", taskToSave.id)),
  ]);
  const existingStepById = new Map((existingSteps ?? []).map((step) => [String(step.id), step]));
  const nextStepIds = normalizedSteps.map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));
  const nextPartIds = (taskToSave.partReferences ?? []).map((part) => part.id);
  const stalePartIds = (existingParts ?? [])
    .map((part) => String(part.id))
    .filter((partId) => !nextPartIds.includes(partId));

  const needsCollisionSafeResequence = manufacturingStepSaveNeedsCollisionSafeResequence(
    normalizedSteps,
    existingSteps ?? [],
  );

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  if (needsCollisionSafeResequence && existingSteps?.length) {
    await bumpManufacturingStepSequences(
      supabase,
      (existingSteps ?? []).map((step) => String(step.id)),
    );
  }

  for (const step of normalizedSteps) {
    const row = manufacturingStepRow(taskToSave.id, step);
    const existingStep = existingStepById.get(step.id);

    if (!existingStep || needsCollisionSafeResequence) {
      await throwIfError(supabase.from("manufacturing_steps").upsert(row));
      continue;
    }

    let stepUpdate = supabase.from("manufacturing_steps").update(row).eq("id", step.id);
    if (step.version !== undefined) {
      stepUpdate = stepUpdate.eq("version", step.version);
    }

    const savedStep = await throwIfError(stepUpdate.select("id,version").maybeSingle());
    if (!savedStep) {
      if (allowVersionRetry && step.version !== undefined) {
        const latestTask = await loadTaskFromSupabase(taskToSave.id, projectId);
        if (latestTask) {
          return saveProcedureTaskUpdateToSupabase(
            mergeTaskWithServerVersions(taskToSave, latestTask),
            _scheduledTasks,
            projectId,
            false,
            client,
          );
        }
      }

      throw new Error("Procedure step save conflict. Reload this task before saving again.");
    }
  }

  const parts = partReferenceRows([taskToSave]);
  if (parts.length) {
    await throwIfError(supabase.from("part_references").upsert(parts));
  }

  if (stalePartIds.length) {
    await throwIfError(supabase.from("part_references").delete().in("id", stalePartIds));
  }

  return loadTaskFromSupabase(taskToSave.id, projectId);
}

export async function moveManufacturingStepToTaskInSupabase(
  sourceTask: Task,
  targetTask: Task,
  stepId: string,
  scheduledTasks: Task[],
  projectId?: string,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, sourceTask.id, projectId);
  await assertTaskInProject(supabase, targetTask.id, projectId);

  const movedStep = targetTask.manufacturingSteps?.find((step) => step.id === stepId);
  if (!movedStep) {
    throw new Error("Unable to find the manufacturing step to move.");
  }

  const targetExistingSteps =
    (await throwIfError(supabase.from("manufacturing_steps").select("id").eq("task_id", targetTask.id))) ?? [];

  if (targetExistingSteps.length > 0) {
    await bumpManufacturingStepSequences(
      supabase,
      targetExistingSteps.map((step) => String(step.id)),
    );
  }

  await throwIfError(
    supabase
      .from("manufacturing_steps")
      .update({ task_id: targetTask.id, sequence: 200000 })
      .eq("id", stepId),
  );

  await throwIfError(supabase.from("step_tools").update({ task_id: targetTask.id }).eq("step_id", stepId));
  await throwIfError(
    supabase.from("step_photos").update({ task_id: targetTask.id }).eq("step_id", stepId).is("deleted_at", null),
  );
  // Exploded views are task-level (step_id is null), so a step move does not carry them.

  await saveProcedureTaskUpdateToSupabase(sourceTask, scheduledTasks, projectId);
  await saveProcedureTaskUpdateToSupabase(targetTask, scheduledTasks, projectId);
}

export type ProjectTaskTarget = {
  id: string;
  name: string;
  code: string | null;
  scenarioName: string;
  zoneName: string | null;
  zoneCode: string | null;
};

// Lightweight picker feed for the SolidWorks plugin: the tasks of each product's MAIN scenario only
// (exploded views attach at the task level, and we don't want the duplicated "Optimized"/Gantt
// scenarios cluttering the picker with the same task many times). "Main" is the earliest-created
// scenario per product — the same convention the planner uses for its default load. Returns only the
// ids/names the picker needs — no full planner state, photos, or signed URLs. Milestone/inspection
// marker rows are excluded.
//
// Requires a CALLER-SCOPED client (the user's bearer token): products/scenarios/tasks are gated by
// real RLS, so the anon server client would read nothing.
export async function loadProjectTaskTargetsFromSupabase(
  projectId: string,
  supabase: SupabaseClient,
): Promise<ProjectTaskTarget[]> {
  const products = await throwIfError(supabase.from("products").select("id").eq("project_id", projectId));
  const productIds = (products ?? []).map((product) => String(product.id));
  if (!productIds.length) {
    return [];
  }

  // Earliest-created scenario per product is the canonical "Main" plan; ignore the rest.
  const scenarios = await throwIfError(
    supabase.from("scenarios").select("id,name,product_id").in("product_id", productIds).order("created_at", { ascending: true }),
  );
  const mainScenarioIdByProduct = new Map<string, string>();
  const scenarioNameById = new Map<string, string>();
  (scenarios ?? []).forEach((scenario) => {
    const productId = String(scenario.product_id);
    scenarioNameById.set(String(scenario.id), String(scenario.name ?? ""));
    if (!mainScenarioIdByProduct.has(productId)) {
      mainScenarioIdByProduct.set(productId, String(scenario.id)); // first in created_at order = Main
    }
  });
  const scenarioIds = [...mainScenarioIdByProduct.values()];
  if (!scenarioIds.length) {
    return [];
  }

  // Zones of the Main scenarios, so the picker can group tasks by zone (and order by zone sequence).
  const zones = await throwIfError(
    supabase.from("zones").select("id,name,code,sequence").in("scenario_id", scenarioIds),
  );
  const zoneById = new Map(
    (zones ?? []).map((zone) => [
      String(zone.id),
      { name: String(zone.name ?? ""), code: maybeText(zone.code) ?? null, sequence: num(zone.sequence, 0) },
    ]),
  );

  // PostgREST caps a single response at ~1000 rows; page through so a large project never silently
  // drops tasks from the picker.
  const tasks: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    const page = ((await throwIfError(
      supabase
        .from("tasks")
        .select("id,name,manufacturing_code,scenario_id,row_type,zone_id")
        .in("scenario_id", scenarioIds)
        .order("wbs")
        .range(from, from + 999),
    )) ?? []) as Array<Record<string, unknown>>;
    tasks.push(...page);
    if (page.length < 1000) {
      break;
    }
  }

  const NON_WORK_ROWS = new Set(["milestone", "inspection"]);
  const UNZONED_SEQUENCE = Number.MAX_SAFE_INTEGER;
  return tasks
    .filter((task) => !NON_WORK_ROWS.has(String(task.row_type ?? "task")))
    .map((task) => {
      const zone = task.zone_id ? zoneById.get(String(task.zone_id)) : undefined;
      return {
        id: String(task.id),
        name: String(task.name ?? ""),
        code: maybeText(task.manufacturing_code) ?? null,
        scenarioName: scenarioNameById.get(String(task.scenario_id)) ?? "",
        zoneName: zone?.name ?? null,
        zoneCode: zone?.code ?? null,
        zoneSequence: zone?.sequence ?? UNZONED_SEQUENCE,
      };
    })
    // Group by zone (stable sort keeps the within-zone wbs order from the query above).
    .sort((left, right) => left.zoneSequence - right.zoneSequence)
    .map(({ zoneSequence: _zoneSequence, ...target }) => target);
}

/** Refresh private media without re-reading the editable steps, parts, or tools. */
export async function loadTaskPrivateMediaFromSupabase(
  taskId: string, projectId?: string, client?: ReturnType<typeof plannerClient>,
): Promise<TaskPrivateMedia | null> {
  const supabase = client ?? plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // The editable core already owns task text, planning fields, custom values and
  // save baselines. Only photo markup is needed to hydrate normalized media.
  // Select it inside JSONB so legacy embedded photos never cross the network.
  const task = await throwIfError(supabase.from("tasks")
    .select("id,photo_annotations:custom_fields->stepPhotoAnnotations")
    .eq("id", taskId).maybeSingle());

  if (!task) {
    return null;
  }

  const [stepPhotos, explodedViews, taskVideos] = await Promise.all([
    readAllPages((from, to) => throwIfError(supabase.from("step_photos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("step_exploded_views").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("task_videos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to))),
  ]);
  const mappedTask: TaskPrivateMedia = {
    id: String(task.id),
    customFields: { [STEP_PHOTO_ANNOTATIONS_FIELD]: jsonObject(task.photo_annotations) },
  };

  const [signedStepPhotos, signedExplodedViews, signedTaskVideos] = await Promise.all([
    withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]),
    withSignedExplodedViewRows(supabase, (explodedViews ?? []) as StepExplodedViewRow[]),
    withSignedTaskVideoRows(supabase, (taskVideos ?? []) as TaskVideoRow[]),
  ]);

  return withNormalizedStepAssets(
    mappedTask,
    indexStepPhotos(signedStepPhotos),
    new Map(),
    indexExplodedViews(signedExplodedViews),
    indexTaskVideos(signedTaskVideos),
  );
}

export async function loadTaskFromSupabase(taskId: string, projectId?: string): Promise<Task | null> {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const task = await throwIfError(supabase.from("tasks").select("*").eq("id", taskId).maybeSingle());

  if (!task) {
    return null;
  }

  const [dependencies, manufacturingSteps, partReferences, stepPhotos, stepTools, explodedViews, taskVideos] = await Promise.all([
    throwIfError(supabase.from("task_dependencies").select("*").eq("successor_task_id", taskId)),
    readAllPages((from, to) => throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", taskId).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("part_references").select("*").eq("task_id", taskId).order("created_at").order("id").range(from, to))),
    throwIfError(supabase.from("step_photos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
    throwIfError(supabase.from("step_tools").select("*").eq("task_id", taskId).order("sequence")),
    throwIfError(supabase.from("step_exploded_views").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
    throwIfError(supabase.from("task_videos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
  ]);

  const mappedTask = mapTask({
    ...task,
    dependency_ids: (dependencies ?? []).map((dependency) => String(dependency.predecessor_task_id)),
    manufacturing_steps: normalizeManufacturingStepSequences((manufacturingSteps ?? []).map(mapManufacturingStepRecord)),
    part_references: (partReferences ?? []).map(mapPartReferenceRecord),
  });

  const [signedStepPhotos, signedExplodedViews, signedTaskVideos] = await Promise.all([
    withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]),
    withSignedExplodedViewRows(supabase, (explodedViews ?? []) as StepExplodedViewRow[]),
    withSignedTaskVideoRows(supabase, (taskVideos ?? []) as TaskVideoRow[]),
  ]);

  return withNormalizedStepAssets(
    mappedTask,
    indexStepPhotos(signedStepPhotos),
    indexStepTools((stepTools ?? []) as StepToolRow[]),
    indexExplodedViews(signedExplodedViews),
    indexTaskVideos(signedTaskVideos),
  );
}

export async function mergeLatestTaskToSupabase(taskId: string, updateTask: (task: Task) => Task, projectId?: string): Promise<Task | null> {
  const latestTask = await loadTaskFromSupabase(taskId, projectId);
  if (!latestTask) {
    return null;
  }

  const nextTask = updateTask(latestTask);
  await saveTaskToSupabase(nextTask, projectId);
  return nextTask;
}
