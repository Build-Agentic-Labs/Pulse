// Planner reads: the full and editable-core planner graph (paged, ID-batched child reads; media signed
// only for full loads), the narrow dashboard summary, a single task with its children and media, a
// task's private media alone, and the SolidWorks task-target feed. Read-only. Moved verbatim from
// supabase-planner.ts (Phase 5); the facade re-exports the public names.

import { loadProjectContext } from "./access-store";
import { plannerClient } from "./client";
import {
  indexExplodedViews,
  indexStepPhotos,
  indexStepTools,
  indexTaskVideos,
  type StepExplodedViewRow,
  type StepPhotoRow,
  type StepToolRow,
  type TaskVideoRow,
  withNormalizedStepAssets,
} from "./media-rows";
import {
  withSignedExplodedViewRows,
  withSignedStepPhotoRows,
  withSignedTaskVideoRows,
} from "./media-storage";
import {
  assertTaskInProject,
  customColumnScopeFilter,
  documentTypeScopeFilter,
  throwIfError,
} from "./query-helpers";
import {
  customFieldsRow,
  jsonObject,
  mapActualEvent,
  mapCustomColumn,
  mapDependency,
  mapDocumentTypeCode,
  mapManufacturingComponent,
  mapManufacturingStepRecord,
  mapPartReferenceRecord,
  mapProduct,
  mapScenario,
  mapStation,
  mapTask,
  mapZone,
  maybeText,
  normalizeManufacturingStepSequences,
  num,
} from "./row-mappers";
import { STEP_PHOTO_ANNOTATIONS_FIELD } from "@/domain/step-photos";
import type { TaskPrivateMedia } from "@/domain/task-private-media";
import type {
  ManufacturingStep,
  PartReference,
  PlannerProjectContext,
  PlannerState,
  Task,
} from "@/domain/types";
import { readAllPages, readRowsByIds } from "@/lib/supabase/read-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function loadTaskFromSupabase(
  taskId: string,
  projectId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<Task | null> {
  const supabase = client ?? plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const task = await throwIfError(supabase.from("tasks").select("*").eq("id", taskId).maybeSingle());

  if (!task) {
    return null;
  }

  // Every child collection is paged and ordered with an `id` tiebreaker, the same shape the full planner
  // load and the private-media hydrate use for these tables: a collection above the API row cap is read
  // completely, and rows sharing a sort key (photos captured in one batch) come back in one stable order.
  const [dependencies, manufacturingSteps, partReferences, stepPhotos, stepTools, explodedViews, taskVideos] = await Promise.all([
    readAllPages((from, to) => throwIfError(supabase.from("task_dependencies").select("*").eq("successor_task_id", taskId).order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", taskId).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("part_references").select("*").eq("task_id", taskId).order("created_at").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("step_photos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("step_tools").select("*").eq("task_id", taskId).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("step_exploded_views").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("task_videos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to))),
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
