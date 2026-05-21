import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ActualEvent,
  CustomColumn,
  Dependency,
  ManufacturingStep,
  PartReference,
  PlannerState,
  PlannerProjectContext,
  Product,
  Project,
  Scenario,
  Station,
  Task,
  Workspace,
  WorkspaceMemberProfile,
  WorkspaceProjectGroup,
  WorkspaceRole,
  Zone,
} from "./types";
import { STEP_PHOTO_ATTACHMENTS_FIELD, type StepPhotoAttachment } from "./step-photos";
import { mergeStepDependencyRefs, splitStepDependencyRefs } from "./step-part-references";
import { STEP_TOOL_LISTS_FIELD, getTaskStepToolListMap } from "./step-tools";
import { applyCalculatedFields } from "./calculations";
import { formatDisplayTitle } from "@/lib/display-names";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const stepPhotoBucket = "step-photos";
const realtimePlannerTables = [
  "products",
  "scenarios",
  "stations",
  "zones",
  "tasks",
  "task_dependencies",
  "manufacturing_steps",
  "part_references",
  "actual_events",
  "custom_columns",
  "step_photos",
  "step_tools",
  "tool_library",
] as const;

type PlannerRealtimeScope = {
  productId?: string;
  scenarioId?: string;
  taskIds?: string[];
};

type StepPhotoRow = {
  id: string;
  task_id: string;
  step_id: string;
  storage_path: string;
  public_url: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  captured_at?: string | null;
  uploaded_by?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

type StepToolRow = {
  id: string;
  task_id: string;
  step_id: string;
  tool_name: string;
  sequence: number;
};

type ToolLibraryRow = {
  id: string;
  project_id?: string | null;
  tool_name: string;
  image_url?: string | null;
  storage_path?: string | null;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ToolLibraryItem = {
  id: string;
  projectId?: string;
  toolName: string;
  imageUrl?: string;
  storagePath?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SaveState = "idle" | "loading" | "saving" | "saved" | "draft" | "retrying" | "conflict" | "error";

type PlannerSupabaseGlobal = typeof globalThis & {
  __buildlogicPlannerSupabaseClient?: SupabaseClient;
};

let serverPlannerSupabaseClient: SupabaseClient | undefined;

function plannerClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  if (typeof window !== "undefined") {
    const globalScope = globalThis as PlannerSupabaseGlobal;
    globalScope.__buildlogicPlannerSupabaseClient ??= createClient(supabaseUrl, supabaseAnonKey);
    return globalScope.__buildlogicPlannerSupabaseClient;
  }

  serverPlannerSupabaseClient ??= createClient(supabaseUrl, supabaseAnonKey);
  return serverPlannerSupabaseClient;
}

export function createPlannerSupabaseClient() {
  return plannerClient();
}

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maybeNum(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return num(value);
}

function maybeText(value: unknown) {
  return typeof value === "string" && value.length ? value : undefined;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    projectId: maybeText(row.project_id),
    name: String(row.name ?? ""),
    sku: maybeText(row.sku),
    family: maybeText(row.family),
    revision: String(row.revision ?? "Rev A"),
    description: maybeText(row.description),
    ownerId: maybeText(row.owner_id),
    ownerName: String(row.owner_name ?? "Manufacturing Engineering"),
    status: String(row.status ?? "draft") as Product["status"],
    targetManHours: num(row.target_man_hours),
    demandQuantity: num(row.demand_quantity, 1),
    demandPeriod: String(row.demand_period ?? "day") as Product["demandPeriod"],
    grossAvailableMinutes: num(row.gross_available_minutes),
    breakMinutes: num(row.break_minutes),
    lunchMinutes: num(row.lunch_minutes),
    meetingMinutes: num(row.meeting_minutes),
    plannedDowntimeMinutes: num(row.planned_downtime_minutes),
    workDaysPerWeek: num(row.work_days_per_week, 5),
    workWeeksPerMonth: num(row.work_weeks_per_month, 4.33),
    availableWorkDaysPerMonth: num(row.available_work_days_per_month),
    netAvailableMinutes: num(row.net_available_minutes),
    weeklyAvailableMinutes: num(row.weekly_available_minutes),
    monthlyAvailableMinutes: num(row.monthly_available_minutes),
    calculatedTaktMinutes: num(row.calculated_takt_minutes),
    manualTaktMinutes: maybeNum(row.manual_takt_minutes),
    activeTaktMinutes: num(row.active_takt_minutes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    ownerId: maybeText(row.owner_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    status: String(row.status ?? "active") as Project["status"],
    createdBy: maybeText(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapScenario(row: Record<string, unknown>): Scenario {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    type: String(row.type ?? "current_state") as Scenario["type"],
    status: String(row.status ?? "draft") as Scenario["status"],
    targetOutput: num(row.target_output, 1),
    targetOutputPeriod: String(row.target_output_period ?? "day"),
    notes: maybeText(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapStation(row: Record<string, unknown>): Station {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    sequence: num(row.sequence, 1),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    ownerId: maybeText(row.owner_id),
    ownerName: String(row.owner_name ?? "Manufacturing Engineering"),
    plannedCycleMinutes: num(row.planned_cycle_minutes),
    actualCycleMinutes: maybeNum(row.actual_cycle_minutes),
    plannedOperators: num(row.planned_operators, 1),
    actualOperators: maybeNum(row.actual_operators),
    plannedManHours: num(row.planned_man_hours),
    actualManHours: maybeNum(row.actual_man_hours),
    taktStatus: String(row.takt_status ?? "missing") as Station["taktStatus"],
    bottleneckFlag: Boolean(row.bottleneck_flag),
    wipLimit: maybeNum(row.wip_limit),
    area: maybeText(row.area),
    toolsRequired: textArray(row.tools_required),
    equipmentRequired: textArray(row.equipment_required),
    safetyNotes: maybeText(row.safety_notes),
    qcNotes: maybeText(row.qc_notes),
  };
}

function mapZone(row: Record<string, unknown>): Zone {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    sequence: num(row.sequence, 1),
    name: formatDisplayTitle(String(row.name ?? "")),
    color: String(row.color ?? "#15756d"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapManufacturingStepRecord(row: Record<string, unknown>): ManufacturingStep {
  const stepRefs = splitStepDependencyRefs(textArray(row.dependencyIds ?? row.dependency_ids));

  return {
    id: String(row.id),
    sequence: num(row.sequence, 1),
    instruction: String(row.instruction ?? ""),
    durationMinutes: num(row.durationMinutes ?? row.duration_minutes),
    qualityCheck: maybeText(row.qualityCheck ?? row.quality_check),
    dependencyIds: stepRefs.dependencyIds,
    partReferenceIds: stepRefs.partReferenceIds,
    version: maybeNum(row.version),
  };
}

function mapManufacturingSteps(value: unknown): ManufacturingStep[] {
  return Array.isArray(value)
    ? value.map((item) => mapManufacturingStepRecord(jsonObject(item)))
    : [];
}

function mapPartReferenceRecord(row: Record<string, unknown>): PartReference {
  return {
    id: String(row.id),
    partNumber: String(row.partNumber ?? row.part_number ?? ""),
    description: maybeText(row.description),
    quantity: maybeNum(row.quantity),
    disposition: maybeText(row.disposition),
  };
}

function mapPartReferences(value: unknown): PartReference[] {
  return Array.isArray(value)
    ? value.map((item) => mapPartReferenceRecord(jsonObject(item)))
    : [];
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    stationId: String(row.station_id ?? ""),
    zoneId: maybeText(row.zone_id),
    parentTaskId: maybeText(row.parent_task_id),
    rowType: String(row.row_type ?? "task") as Task["rowType"],
    wbs: String(row.wbs ?? ""),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    plannedStart: String(row.planned_start),
    plannedFinish: String(row.planned_finish),
    plannedDurationMinutes: num(row.planned_duration_minutes),
    actualStart: maybeText(row.actual_start),
    actualFinish: maybeText(row.actual_finish),
    actualDurationMinutes: maybeNum(row.actual_duration_minutes),
    plannedOperators: num(row.planned_operators, 1),
    actualOperators: maybeNum(row.actual_operators),
    plannedManHours: num(row.planned_man_hours),
    actualManHours: maybeNum(row.actual_man_hours),
    status: String(row.status ?? "not_started") as Task["status"],
    percentComplete: num(row.percent_complete),
    ownerId: maybeText(row.owner_id),
    ownerName: maybeText(row.owner_name),
    role: maybeText(row.role),
    skillLevel: maybeText(row.skill_level) as Task["skillLevel"],
    dependencyIds: textArray(row.dependency_ids),
    criticalPath: Boolean(row.critical_path),
    bottleneckFlag: Boolean(row.bottleneck_flag),
    qualityGate: Boolean(row.quality_gate),
    travelerSignoffRequired: Boolean(row.traveler_signoff_required),
    sopLink: maybeText(row.sop_link),
    workInstructionLink: maybeText(row.work_instruction_link),
    drawingLink: maybeText(row.drawing_link),
    materialKit: maybeText(row.material_kit),
    toolsRequired: textArray(row.tools_required),
    equipmentRequired: textArray(row.equipment_required),
    safetyNotes: maybeText(row.safety_notes),
    qcChecklist: maybeText(row.qc_checklist),
    reworkRisk: maybeText(row.rework_risk) as Task["reworkRisk"],
    notes: maybeText(row.notes),
    manufacturingSteps: mapManufacturingSteps(row.manufacturing_steps),
    partReferences: mapPartReferences(row.part_references),
    customFields: jsonObject(row.custom_fields),
    version: maybeNum(row.version),
  };
}

function mapDependency(row: Record<string, unknown>): Dependency {
  return {
    id: String(row.id),
    predecessorTaskId: String(row.predecessor_task_id),
    successorTaskId: String(row.successor_task_id),
    type: String(row.type ?? "finish_to_start") as Dependency["type"],
    lagMinutes: maybeNum(row.lag_minutes),
    constraintType: maybeText(row.constraint_type) as Dependency["constraintType"],
  };
}

function mapActualEvent(row: Record<string, unknown>): ActualEvent {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    eventType: String(row.event_type ?? "note") as ActualEvent["eventType"],
    timestamp: String(row.timestamp),
    userId: maybeText(row.user_id),
    notes: maybeText(row.notes),
    reasonCode: maybeText(row.reason_code),
  };
}

function mapCustomColumn(row: Record<string, unknown>): CustomColumn {
  return {
    id: String(row.id),
    productId: maybeText(row.product_id),
    scenarioId: maybeText(row.scenario_id),
    name: String(row.name ?? ""),
    key: String(row.key ?? ""),
    description: maybeText(row.description),
    type: String(row.type ?? "text") as CustomColumn["type"],
    appliesTo: String(row.applies_to ?? "task") as CustomColumn["appliesTo"],
    required: Boolean(row.required),
    defaultValue: row.default_value,
    options: textArray(row.options),
    formula: maybeText(row.formula),
    unit: maybeText(row.unit),
    precision: maybeNum(row.precision),
    visible: row.visible !== false,
    locked: Boolean(row.locked),
  };
}

function productRow(product: Product) {
  return {
    id: product.id,
    project_id: product.projectId ?? null,
    name: product.name,
    sku: product.sku ?? null,
    family: product.family ?? null,
    revision: product.revision,
    description: product.description ?? null,
    owner_id: product.ownerId ?? null,
    owner_name: product.ownerName,
    status: product.status,
    target_man_hours: product.targetManHours,
    demand_quantity: product.demandQuantity,
    demand_period: product.demandPeriod,
    gross_available_minutes: product.grossAvailableMinutes,
    break_minutes: product.breakMinutes,
    lunch_minutes: product.lunchMinutes,
    meeting_minutes: product.meetingMinutes,
    planned_downtime_minutes: product.plannedDowntimeMinutes,
    work_days_per_week: product.workDaysPerWeek,
    work_weeks_per_month: product.workWeeksPerMonth,
    available_work_days_per_month: product.availableWorkDaysPerMonth,
    net_available_minutes: product.netAvailableMinutes,
    weekly_available_minutes: product.weeklyAvailableMinutes,
    monthly_available_minutes: product.monthlyAvailableMinutes,
    calculated_takt_minutes: product.calculatedTaktMinutes,
    manual_takt_minutes: product.manualTaktMinutes ?? null,
    active_takt_minutes: product.activeTaktMinutes,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

function scenarioRow(scenario: Scenario) {
  return {
    id: scenario.id,
    product_id: scenario.productId,
    name: scenario.name,
    description: scenario.description ?? null,
    type: scenario.type,
    status: scenario.status,
    target_output: scenario.targetOutput,
    target_output_period: scenario.targetOutputPeriod,
    notes: scenario.notes ?? null,
    created_at: scenario.createdAt,
    updated_at: scenario.updatedAt,
  };
}

function stationRow(station: Station) {
  return {
    id: station.id,
    scenario_id: station.scenarioId,
    sequence: station.sequence,
    name: station.name,
    description: station.description ?? null,
    owner_id: station.ownerId ?? null,
    owner_name: station.ownerName,
    planned_cycle_minutes: station.plannedCycleMinutes,
    actual_cycle_minutes: station.actualCycleMinutes ?? null,
    planned_operators: station.plannedOperators,
    actual_operators: station.actualOperators ?? null,
    planned_man_hours: station.plannedManHours,
    actual_man_hours: station.actualManHours ?? null,
    takt_status: station.taktStatus,
    bottleneck_flag: station.bottleneckFlag,
    wip_limit: station.wipLimit ?? null,
    area: station.area ?? null,
    tools_required: station.toolsRequired ?? [],
    equipment_required: station.equipmentRequired ?? [],
    safety_notes: station.safetyNotes ?? null,
    qc_notes: station.qcNotes ?? null,
  };
}

function zoneRow(zone: Zone) {
  return {
    id: zone.id,
    scenario_id: zone.scenarioId,
    sequence: zone.sequence,
    name: zone.name,
    color: zone.color,
    created_at: zone.createdAt,
    updated_at: zone.updatedAt,
  };
}

function taskRow(task: Task) {
  return {
    id: task.id,
    scenario_id: task.scenarioId,
    station_id: task.stationId || null,
    zone_id: task.zoneId ?? null,
    parent_task_id: task.parentTaskId ?? null,
    row_type: task.rowType,
    wbs: task.wbs,
    name: task.name,
    description: task.description ?? null,
    planned_start: task.plannedStart,
    planned_finish: task.plannedFinish,
    planned_duration_minutes: task.plannedDurationMinutes,
    actual_start: task.actualStart ?? null,
    actual_finish: task.actualFinish ?? null,
    actual_duration_minutes: task.actualDurationMinutes ?? null,
    planned_operators: task.plannedOperators,
    actual_operators: task.actualOperators ?? null,
    planned_man_hours: task.plannedManHours,
    actual_man_hours: task.actualManHours ?? null,
    status: task.status,
    percent_complete: task.percentComplete,
    owner_id: task.ownerId ?? null,
    owner_name: task.ownerName ?? null,
    role: task.role ?? null,
    skill_level: task.skillLevel ?? null,
    critical_path: task.criticalPath,
    bottleneck_flag: task.bottleneckFlag,
    quality_gate: task.qualityGate,
    traveler_signoff_required: task.travelerSignoffRequired,
    sop_link: task.sopLink ?? null,
    work_instruction_link: task.workInstructionLink ?? null,
    drawing_link: task.drawingLink ?? null,
    material_kit: task.materialKit ?? null,
    tools_required: task.toolsRequired ?? [],
    equipment_required: task.equipmentRequired ?? [],
    safety_notes: task.safetyNotes ?? null,
    qc_checklist: task.qcChecklist ?? null,
    rework_risk: task.reworkRisk ?? null,
    notes: task.notes ?? null,
    custom_fields: customFieldsRow(task.customFields),
  };
}

function customFieldsRow(customFields: Task["customFields"]) {
  const nextCustomFields = { ...(customFields ?? {}) };
  delete nextCustomFields[STEP_PHOTO_ATTACHMENTS_FIELD];
  delete nextCustomFields[STEP_TOOL_LISTS_FIELD];
  return nextCustomFields;
}

function dependencyRow(dependency: Dependency) {
  return {
    id: dependency.id,
    predecessor_task_id: dependency.predecessorTaskId,
    successor_task_id: dependency.successorTaskId,
    type: dependency.type,
    lag_minutes: dependency.lagMinutes ?? 0,
    constraint_type: dependency.constraintType ?? null,
  };
}

function manufacturingStepRows(tasks: Task[]) {
  return tasks.flatMap((task) =>
    (task.manufacturingSteps ?? []).map((step) => manufacturingStepRow(task.id, step)),
  );
}

function manufacturingStepRow(taskId: string, step: ManufacturingStep) {
  return {
    id: step.id,
    task_id: taskId,
    sequence: step.sequence,
    instruction: step.instruction,
    duration_minutes: step.durationMinutes ?? 0,
    quality_check: step.qualityCheck ?? null,
    dependency_ids: mergeStepDependencyRefs(step.dependencyIds, step.partReferenceIds),
  };
}

function mapStepPhotoRecord(row: Record<string, unknown>): StepPhotoAttachment {
  return {
    id: String(row.id),
    name: String(row.file_name ?? "Step photo"),
    dataUrl: String(row.public_url ?? ""),
    capturedAt: String(row.captured_at ?? row.created_at ?? new Date().toISOString()),
    contentType: maybeText(row.mime_type),
    sizeBytes: maybeNum(row.size_bytes),
    width: maybeNum(row.width),
    height: maybeNum(row.height),
    storagePath: maybeText(row.storage_path),
    caption: maybeText(row.caption),
  };
}

function withNormalizedStepAssets(
  task: Task,
  photosByTaskId: Map<string, Map<string, StepPhotoAttachment[]>>,
  toolsByTaskId: Map<string, Map<string, string[]>>,
): Task {
  const photoMap = photosByTaskId.get(task.id);
  const toolMap = toolsByTaskId.get(task.id);

  if (!photoMap && !toolMap) {
    return task;
  }

  const customFields = { ...task.customFields };

  if (photoMap) {
    customFields[STEP_PHOTO_ATTACHMENTS_FIELD] = Object.fromEntries(photoMap);
  }

  if (toolMap) {
    customFields[STEP_TOOL_LISTS_FIELD] = Object.fromEntries(toolMap);
  }

  return {
    ...task,
    customFields,
  };
}

function indexStepPhotos(rows: StepPhotoRow[] = []) {
  const photosByTaskId = new Map<string, Map<string, StepPhotoAttachment[]>>();

  rows
    .filter((row) => !row.deleted_at)
    .forEach((row) => {
      const taskId = String(row.task_id);
      const stepId = String(row.step_id);
      const stepMap = photosByTaskId.get(taskId) ?? new Map<string, StepPhotoAttachment[]>();
      stepMap.set(stepId, [...(stepMap.get(stepId) ?? []), mapStepPhotoRecord(row as unknown as Record<string, unknown>)]);
      photosByTaskId.set(taskId, stepMap);
    });

  return photosByTaskId;
}

function indexStepTools(rows: StepToolRow[] = []) {
  const toolsByTaskId = new Map<string, Map<string, string[]>>();

  [...rows]
    .sort((left, right) => left.sequence - right.sequence || left.tool_name.localeCompare(right.tool_name))
    .forEach((row) => {
      const taskId = String(row.task_id);
      const stepId = String(row.step_id);
      const stepMap = toolsByTaskId.get(taskId) ?? new Map<string, string[]>();
      stepMap.set(stepId, [...(stepMap.get(stepId) ?? []), String(row.tool_name)]);
      toolsByTaskId.set(taskId, stepMap);
    });

  return toolsByTaskId;
}

function partReferenceRows(tasks: Task[]) {
  return tasks.flatMap((task) =>
    (task.partReferences ?? []).map((part) => ({
      id: part.id,
      task_id: task.id,
      part_number: part.partNumber,
      description: part.description ?? null,
      quantity: part.quantity ?? null,
      disposition: part.disposition ?? null,
    })),
  );
}

async function assertTaskInProject(supabase: ReturnType<typeof plannerClient>, taskId: string, projectId?: string) {
  if (!projectId) {
    return;
  }

  const task = await throwIfError(supabase.from("tasks").select("scenario_id").eq("id", taskId).maybeSingle());
  if (!task) {
    throw new Error("Task not found or you do not have access to it.");
  }

  const scenario = await throwIfError(supabase.from("scenarios").select("product_id").eq("id", task.scenario_id).maybeSingle());
  if (!scenario) {
    throw new Error("Scenario not found for this task.");
  }

  const product = await throwIfError(supabase.from("products").select("project_id").eq("id", scenario.product_id).maybeSingle());
  if (!product || String(product.project_id) !== projectId) {
    throw new Error("This task does not belong to the active project.");
  }
}

function projectScopedStoragePath(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
  extension = "jpg",
) {
  const pathSegments = project
    ? [
        "workspaces",
        project.workspaceId,
        "projects",
        project.projectId,
        "tasks",
        taskId,
        "steps",
        stepId,
        `${photo.id}.${extension}`,
      ]
    : [taskId, stepId, `${photo.id}.${extension}`];

  return pathSegments.map(safeStorageSegment).join("/");
}

function actualEventRow(event: ActualEvent) {
  return {
    id: event.id,
    task_id: event.taskId,
    event_type: event.eventType,
    timestamp: event.timestamp,
    user_id: event.userId ?? null,
    notes: event.notes ?? null,
    reason_code: event.reasonCode ?? null,
  };
}

function customColumnRow(column: CustomColumn) {
  return {
    id: column.id,
    product_id: column.productId ?? null,
    scenario_id: column.scenarioId ?? null,
    name: column.name,
    key: column.key,
    description: column.description ?? null,
    type: column.type,
    applies_to: column.appliesTo,
    required: column.required,
    default_value: column.defaultValue ?? null,
    options: column.options ?? [],
    formula: column.formula ?? null,
    unit: column.unit ?? null,
    precision: column.precision ?? null,
    visible: column.visible,
    locked: column.locked,
  };
}

async function throwIfError<T>(operation: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await operation;
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function newScopedId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId}`;
}

async function insertNewProjectPlannerState(state: PlannerState) {
  if (!state.product.projectId) {
    throw new Error("Project id is required to seed planner data.");
  }

  const supabase = plannerClient();

  await throwIfError(supabase.from("products").insert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").insert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").insert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await throwIfError(supabase.from("zones").insert(state.zones.map(zoneRow)));
  }

  if (state.tasks.length) {
    await throwIfError(supabase.from("tasks").insert(state.tasks.map(taskRow)));
  }

  if (state.dependencies.length) {
    await throwIfError(supabase.from("task_dependencies").insert(state.dependencies.map(dependencyRow)));
  }

  const steps = manufacturingStepRows(state.tasks);
  if (steps.length) {
    await throwIfError(supabase.from("manufacturing_steps").insert(steps));
  }

  const parts = partReferenceRows(state.tasks);
  if (parts.length) {
    await throwIfError(supabase.from("part_references").insert(parts));
  }

  if (state.actualEvents.length) {
    await throwIfError(supabase.from("actual_events").insert(state.actualEvents.map(actualEventRow)));
  }

  if (state.customColumns.length) {
    await throwIfError(supabase.from("custom_columns").insert(state.customColumns.map(customColumnRow)));
  }
}

function createEmptyPlannerStateForProject(projectId: string, projectName: string): PlannerState {
  const token = newScopedId("seed").replace(/^seed-/, "");
  const productId = `product-${token}`;
  const scenarioId = `scenario-${token}`;
  const now = new Date().toISOString();

  const { product } = applyCalculatedFields(
    {
      id: productId,
      projectId,
      name: projectName,
      revision: "",
      ownerName: "",
      status: "draft",
      targetManHours: 0,
      demandQuantity: 1,
      demandPeriod: "day",
      grossAvailableMinutes: 540,
      breakMinutes: 30,
      lunchMinutes: 60,
      meetingMinutes: 15,
      plannedDowntimeMinutes: 15,
      workDaysPerWeek: 5,
      workWeeksPerMonth: 4.33,
      availableWorkDaysPerMonth: 0,
      netAvailableMinutes: 0,
      weeklyAvailableMinutes: 0,
      monthlyAvailableMinutes: 0,
      calculatedTaktMinutes: 0,
      activeTaktMinutes: 0,
      createdAt: now,
      updatedAt: now,
    },
    [],
    [],
  );

  return {
    project: undefined,
    product,
    scenario: {
      id: scenarioId,
      productId,
      name: "Current State",
      type: "current_state",
      status: "draft",
      targetOutput: 1,
      targetOutputPeriod: "day",
      createdAt: now,
      updatedAt: now,
    },
    stations: [],
    zones: [],
    tasks: [],
    dependencies: [],
    actualEvents: [],
    customColumns: [],
  };
}

async function loadProjectContext(
  supabase: ReturnType<typeof plannerClient>,
  projectId: string,
): Promise<PlannerProjectContext> {
  const project = await throwIfError(supabase.from("projects").select("*").eq("id", projectId).maybeSingle());

  if (!project) {
    throw new Error("Project not found or you do not have access to it.");
  }

  const workspace = await throwIfError(supabase.from("workspaces").select("*").eq("id", project.workspace_id).maybeSingle());

  if (!workspace) {
    throw new Error("Workspace not found or you do not have access to it.");
  }

  const { data: userData } = await supabase.auth.getUser();
  const member = userData.user
    ? await throwIfError(
        supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", project.workspace_id)
          .eq("user_id", userData.user.id)
          .maybeSingle(),
      )
    : null;

  return {
    projectId: String(project.id),
    projectName: String(project.name ?? ""),
    workspaceId: String(workspace.id),
    workspaceName: String(workspace.name ?? ""),
    role: member?.role ? (String(member.role) as WorkspaceRole) : undefined,
  };
}

export async function ensureDefaultWorkspaceMembership(): Promise<WorkspaceProjectGroup[]> {
  const supabase = plannerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error(userError?.message ?? "Sign in before loading workspaces.");
  }

  await throwIfError(
    supabase.from("profiles").upsert({
      id: userData.user.id,
      full_name: userData.user.user_metadata?.full_name ?? userData.user.email ?? "Pulse User",
      avatar_url: userData.user.user_metadata?.avatar_url ?? null,
    }),
  );

  const memberships = await throwIfError(
    supabase.from("workspace_members").select("workspace_id, role").eq("user_id", userData.user.id),
  );

  if (!memberships?.length) {
    let workspace = await throwIfError(
      supabase.from("workspaces").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    );

    if (!workspace) {
      workspace = await throwIfError(
        supabase
          .from("workspaces")
          .insert({ name: "Pulse Workspace", owner_id: userData.user.id })
          .select("*")
          .maybeSingle(),
      );
    }

    if (workspace) {
      await throwIfError(
        supabase.from("workspace_members").insert({
          workspace_id: workspace.id,
          user_id: userData.user.id,
          role: "owner",
        }),
      );
      await throwIfError(supabase.from("workspaces").update({ owner_id: userData.user.id }).eq("id", workspace.id));
    }
  }

  return loadWorkspaceProjectGroups();
}

export async function loadWorkspaceProjectGroups(): Promise<WorkspaceProjectGroup[]> {
  const supabase = plannerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error(userError?.message ?? "Sign in before loading workspaces.");
  }

  const memberships = await throwIfError(
    supabase.from("workspace_members").select("workspace_id, role").eq("user_id", userData.user.id).order("created_at"),
  );

  const workspaceIds = [...new Set((memberships ?? []).map((membership) => String(membership.workspace_id)))];

  if (!workspaceIds.length) {
    return [];
  }

  const [workspaces, projects] = await Promise.all([
    throwIfError(supabase.from("workspaces").select("*").in("id", workspaceIds).order("created_at")),
    throwIfError(supabase.from("projects").select("*").in("workspace_id", workspaceIds).order("created_at")),
  ]);

  const membershipByWorkspaceId = new Map(
    (memberships ?? []).map((membership) => [String(membership.workspace_id), String(membership.role) as WorkspaceRole]),
  );
  const projectsByWorkspaceId = new Map<string, Project[]>();

  (projects ?? []).forEach((project) => {
    const mappedProject = mapProject(project);
    projectsByWorkspaceId.set(mappedProject.workspaceId, [
      ...(projectsByWorkspaceId.get(mappedProject.workspaceId) ?? []),
      mappedProject,
    ]);
  });

  return (workspaces ?? []).map((workspace) => {
    const mappedWorkspace = mapWorkspace(workspace);
    return {
      workspace: mappedWorkspace,
      role: membershipByWorkspaceId.get(mappedWorkspace.id) ?? "viewer",
      projects: projectsByWorkspaceId.get(mappedWorkspace.id) ?? [],
    };
  });
}

export async function createProjectWithStarterPlan(workspaceId: string, name: string): Promise<PlannerProjectContext> {
  const supabase = plannerClient();
  const { data: userData } = await supabase.auth.getUser();
  const projectId = newScopedId("project");
  const projectName = name.trim() || "New Process Map";

  await throwIfError(
    supabase.from("projects").insert({
      id: projectId,
      workspace_id: workspaceId,
      name: projectName,
      status: "active",
      created_by: userData.user?.id ?? null,
    }),
  );

  const starterState = createEmptyPlannerStateForProject(projectId, projectName);

  try {
    await insertNewProjectPlannerState(starterState);
  } catch (error) {
    await supabase.from("projects").delete().eq("id", projectId);
    throw error;
  }

  return loadProjectContext(supabase, projectId);
}

export async function updateWorkspaceInSupabase(workspaceId: string, patch: { name?: string }) {
  const name = patch.name?.trim();
  if (!name) {
    throw new Error("Workspace name is required.");
  }

  const supabase = plannerClient();
  await throwIfError(supabase.from("workspaces").update({ name }).eq("id", workspaceId));
}

export async function updateProjectInSupabase(
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: Project["status"];
  },
) {
  const row: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) {
      throw new Error("Project name is required.");
    }
    row.name = name;
  }

  if (patch.description !== undefined) {
    row.description = patch.description?.trim() ? patch.description.trim() : null;
  }

  if (patch.status !== undefined) {
    row.status = patch.status;
  }

  if (!Object.keys(row).length) {
    return;
  }

  const supabase = plannerClient();
  await throwIfError(supabase.from("projects").update(row).eq("id", projectId));
}

export async function deleteProjectFromSupabase(projectId: string) {
  const supabase = plannerClient();

  await throwIfError(supabase.from("products").delete().eq("project_id", projectId));
  await throwIfError(supabase.from("projects").delete().eq("id", projectId));
}

export async function loadWorkspaceMembersFromSupabase(workspaceId: string): Promise<WorkspaceMemberProfile[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role,created_at,profiles(full_name,avatar_url)")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );

  return (rows ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      workspaceId: String(row.workspace_id),
      userId: String(row.user_id),
      role: String(row.role) as WorkspaceRole,
      createdAt: String(row.created_at),
      fullName: maybeText(profile?.full_name),
      avatarUrl: maybeText(profile?.avatar_url),
    };
  });
}

export async function loadPlannerStateWithProjectFromSupabase(projectId?: string): Promise<{
  state: PlannerState;
  project: PlannerProjectContext;
} | null> {
  const supabase = plannerClient();
  let project: PlannerProjectContext | undefined;
  let product = projectId
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

  if (projectId || product.project_id) {
    project = await loadProjectContext(supabase, String(projectId ?? product.project_id));
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

  const [stations, zones, taskRows, customColumns] = await Promise.all([
    throwIfError(supabase.from("stations").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("zones").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("tasks").select("*").eq("scenario_id", scenario.id).order("wbs")),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("*")
        .or(`product_id.eq.${product.id},scenario_id.eq.${scenario.id}`)
        .order("created_at"),
    ),
  ]);

  const taskIds = (taskRows ?? []).map((task) => String(task.id));
  const [dependencies, manufacturingSteps, partReferences, actualEvents, stepPhotos, stepTools] = taskIds.length
    ? await Promise.all([
        throwIfError(supabase.from("task_dependencies").select("*").in("successor_task_id", taskIds)),
        throwIfError(supabase.from("manufacturing_steps").select("*").in("task_id", taskIds).order("sequence")),
        throwIfError(supabase.from("part_references").select("*").in("task_id", taskIds).order("created_at")),
        throwIfError(supabase.from("actual_events").select("*").in("task_id", taskIds).order("timestamp")),
        throwIfError(supabase.from("step_photos").select("*").in("task_id", taskIds).is("deleted_at", null).order("captured_at")),
        throwIfError(supabase.from("step_tools").select("*").in("task_id", taskIds).order("sequence")),
      ])
    : [[], [], [], [], [], []];
  const scenarioTaskIds = new Set(taskIds);
  const dependencyIdsByTaskId = new Map<string, string[]>();
  const stepsByTaskId = new Map<string, ManufacturingStep[]>();
  const partsByTaskId = new Map<string, PartReference[]>();
  const photosByTaskId = indexStepPhotos((stepPhotos ?? []) as StepPhotoRow[]);
  const toolsByTaskId = indexStepTools((stepTools ?? []) as StepToolRow[]);

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
    stepsByTaskId.set(taskId, currentSteps);
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
    throw new Error("This product is not assigned to a project yet.");
  }

  const state: PlannerState = {
    project: projectContext,
    product: mappedProduct,
    scenario: mapScenario(scenario),
    stations: (stations ?? []).map(mapStation),
    zones: (zones ?? []).map(mapZone),
    tasks: (taskRows ?? []).map((task) => {
      const mappedTask = mapTask({
        ...task,
        dependency_ids: dependencyIdsByTaskId.get(String(task.id)) ?? [],
        manufacturing_steps: stepsByTaskId.get(String(task.id)) ?? [],
        part_references: partsByTaskId.get(String(task.id)) ?? [],
      });

      return withNormalizedStepAssets(mappedTask, photosByTaskId, toolsByTaskId);
    }),
    dependencies: (dependencies ?? [])
      .filter(
        (dependency) =>
          scenarioTaskIds.has(String(dependency.predecessor_task_id)) ||
          scenarioTaskIds.has(String(dependency.successor_task_id)),
      )
      .map(mapDependency),
    actualEvents: (actualEvents ?? []).filter((event) => scenarioTaskIds.has(String(event.task_id))).map(mapActualEvent),
    customColumns: (customColumns ?? []).map(mapCustomColumn),
  };

  return { state, project: projectContext };
}

export async function loadPlannerStateFromSupabase(projectId?: string): Promise<PlannerState | null> {
  const loaded = await loadPlannerStateWithProjectFromSupabase(projectId);
  return loaded?.state ?? null;
}

export async function savePlannerStateToSupabase(state: PlannerState) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a project before saving planner data.");
  }

  const supabase = plannerClient();
  const [existingTasks, existingStations, existingZones, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("id")
        .or(`product_id.eq.${state.product.id},scenario_id.eq.${state.scenario.id}`),
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
  const nextCustomColumnIds = state.customColumns.map((column) => column.id);
  const staleCustomColumnIds = (existingCustomColumns ?? [])
    .map((column) => String(column.id))
    .filter((columnId) => !nextCustomColumnIds.includes(columnId));

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await throwIfError(supabase.from("zones").upsert(state.zones.map(zoneRow)));
  }

  await throwIfError(supabase.from("tasks").upsert(state.tasks.map(taskRow)));

  if (taskIds.length) {
    await throwIfError(supabase.from("task_dependencies").delete().in("successor_task_id", taskIds));
    await throwIfError(supabase.from("task_dependencies").delete().in("predecessor_task_id", taskIds));
    await throwIfError(supabase.from("manufacturing_steps").delete().in("task_id", taskIds));
    await throwIfError(supabase.from("part_references").delete().in("task_id", taskIds));
    await throwIfError(supabase.from("actual_events").delete().in("task_id", taskIds));
  }

  if (state.dependencies.length) {
    await throwIfError(supabase.from("task_dependencies").insert(state.dependencies.map(dependencyRow)));
  }

  const steps = manufacturingStepRows(state.tasks);
  if (steps.length) {
    await throwIfError(supabase.from("manufacturing_steps").insert(steps));
  }

  const parts = partReferenceRows(state.tasks);
  if (parts.length) {
    await throwIfError(supabase.from("part_references").insert(parts));
  }

  if (state.actualEvents.length) {
    await throwIfError(supabase.from("actual_events").insert(state.actualEvents.map(actualEventRow)));
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

  if (staleStationIds.length) {
    await throwIfError(supabase.from("stations").delete().in("id", staleStationIds));
  }

  if (staleCustomColumnIds.length) {
    await throwIfError(supabase.from("custom_columns").delete().in("id", staleCustomColumnIds));
  }
}

export async function savePlannerShellToSupabase(state: PlannerState) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a project before saving planner data.");
  }

  const supabase = plannerClient();
  const [existingTasks, existingStations, existingZones, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("id")
        .or(`product_id.eq.${state.product.id},scenario_id.eq.${state.scenario.id}`),
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
  const nextCustomColumnIds = state.customColumns.map((column) => column.id);
  const staleCustomColumnIds = (existingCustomColumns ?? [])
    .map((column) => String(column.id))
    .filter((columnId) => !nextCustomColumnIds.includes(columnId));

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await throwIfError(supabase.from("zones").upsert(state.zones.map(zoneRow)));
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

  if (staleStationIds.length) {
    await throwIfError(supabase.from("stations").delete().in("id", staleStationIds));
  }

  if (staleCustomColumnIds.length) {
    await throwIfError(supabase.from("custom_columns").delete().in("id", staleCustomColumnIds));
  }
}

export async function saveTasksToSupabase(tasks: Task[], projectId?: string) {
  if (tasks.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await Promise.all(tasks.map((task) => assertTaskInProject(supabase, task.id, projectId)));
  await throwIfError(supabase.from("tasks").upsert(tasks.map(taskRow)));
  await Promise.all(tasks.map((task) => syncStepToolsForTask(supabase, task)));
}

export async function saveTaskToSupabase(task: Task, projectId?: string) {
  await saveTasksToSupabase([task], projectId);
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
    await Promise.all(
      existingSteps.map((step, index) =>
        throwIfError(supabase.from("manufacturing_steps").update({ sequence: 100000 + index }).eq("id", step.id)),
      ),
    );
  }

  const steps = manufacturingStepRows([task]);
  if (steps.length) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(steps));
  }

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  await syncStepToolsForTask(supabase, task);
}

export async function saveTaskAndManufacturingStepToSupabase(task: Task, step: ManufacturingStep, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(task.id, step)));
  await syncStepToolsForTask(supabase, task);
}

export async function saveManufacturingStepToSupabase(taskId: string, step: ManufacturingStep, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(taskId, step)));
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
    | "stationId"
    | "wbs"
  >
>;

function taskFieldPatchRow(patch: TaskFieldPatch) {
  const row: Record<string, unknown> = {};
  const setters: [keyof TaskFieldPatch, string][] = [
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
    ["stationId", "station_id"],
    ["wbs", "wbs"],
  ];

  setters.forEach(([key, column]) => {
    if (patch[key] !== undefined) {
      row[column] = patch[key] ?? null;
    }
  });

  return row;
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
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await Promise.all(
    orderedStepIds.map((stepId, index) =>
      throwIfError(supabase.from("manufacturing_steps").update({ sequence: 100000 + index }).eq("task_id", taskId).eq("id", stepId)),
    ),
  );
  await Promise.all(
    orderedStepIds.map((stepId, index) =>
      throwIfError(supabase.from("manufacturing_steps").update({ sequence: index + 1 }).eq("task_id", taskId).eq("id", stepId)),
    ),
  );
}

export async function addStepToolToSupabase(taskId: string, stepId: string, toolName: string, sequence = 1, projectId?: string) {
  const tool = toolName.trim();
  if (!tool) {
    return;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(
    supabase.from("step_tools").upsert({
      id: stepToolId(stepId, tool),
      task_id: taskId,
      step_id: stepId,
      tool_name: tool,
      sequence,
    }),
  );
}

export async function removeStepToolFromSupabase(stepId: string, toolName: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(supabase.from("step_tools").delete().eq("id", stepToolId(stepId, toolName)));
}

export async function loadToolLibraryFromSupabase(projectId?: string): Promise<ToolLibraryItem[]> {
  const supabase = plannerClient();
  let query = supabase.from("tool_library").select("*").order("tool_name");

  if (projectId) {
    query = query.or(`project_id.is.null,project_id.eq.${projectId}`);
  } else {
    query = query.is("project_id", null);
  }

  const rows = await throwIfError(query);
  return ((rows ?? []) as ToolLibraryRow[]).map(mapToolLibraryRow);
}

export async function uploadToolLibraryImage(
  toolName: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
): Promise<ToolLibraryItem> {
  const tool = toolName.trim();
  if (!tool) {
    throw new Error("Add a tool name before uploading an image.");
  }

  const supabase = plannerClient();
  const projectId = project?.projectId;
  const blob = await dataUrlToBlob(photo.dataUrl);
  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const pathSegments = project
    ? ["workspaces", project.workspaceId, "projects", project.projectId, "tool-library", `${toolLibraryId(tool, projectId)}.${extension}`]
    : ["tool-library", `${toolLibraryId(tool)}.${extension}`];
  const storagePath = pathSegments.map(safeStorageSegment).join("/");

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType: photo.contentType ?? blob.type ?? "image/jpeg",
      upsert: true,
    }),
  );

  const { data } = supabase.storage.from(stepPhotoBucket).getPublicUrl(storagePath);
  const row = {
    id: toolLibraryId(tool, projectId),
    project_id: projectId ?? null,
    tool_name: tool,
    image_url: data.publicUrl,
    storage_path: storagePath,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  return mapToolLibraryRow(saved as ToolLibraryRow);
}

export async function upsertToolLibraryMetadata(input: {
  toolName: string;
  category?: string;
  projectId?: string;
  previousToolName?: string;
}): Promise<ToolLibraryItem> {
  const toolName = input.toolName.trim();
  if (!toolName) {
    throw new Error("Tool name is required.");
  }

  const supabase = plannerClient();
  const projectId = input.projectId;
  const previousName = input.previousToolName?.trim();
  let existing: ToolLibraryRow | null = null;

  if (previousName && previousName.toLocaleLowerCase() !== toolName.toLocaleLowerCase()) {
    const oldId = toolLibraryId(previousName, projectId);
    existing = (await throwIfError(
      supabase.from("tool_library").select("*").eq("id", oldId).maybeSingle(),
    )) as ToolLibraryRow | null;

    if (existing) {
      await throwIfError(supabase.from("tool_library").delete().eq("id", oldId));
    }
  } else {
    existing = (await throwIfError(
      supabase.from("tool_library").select("*").eq("id", toolLibraryId(toolName, projectId)).maybeSingle(),
    )) as ToolLibraryRow | null;
  }

  const row = {
    id: toolLibraryId(toolName, projectId),
    project_id: projectId ?? null,
    tool_name: toolName,
    category: input.category?.trim() || null,
    image_url: existing?.image_url ?? null,
    storage_path: existing?.storage_path ?? null,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  return mapToolLibraryRow(saved as ToolLibraryRow);
}

export async function deleteToolLibraryFromSupabase(id: string, projectId?: string) {
  const supabase = plannerClient();
  let query = supabase.from("tool_library").delete().eq("id", id);

  if (projectId) {
    query = query.or(`project_id.is.null,project_id.eq.${projectId}`);
  }

  await throwIfError(query);
}

export async function softDeleteStepPhotoAttachmentFromSupabase(photoId: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(supabase.from("step_photos").update({ deleted_at: new Date().toISOString() }).eq("id", photoId));
}

export async function updateStepPhotoCaptionInSupabase(photoId: string, caption: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(
    supabase
      .from("step_photos")
      .update({ caption: caption.trim() ? caption.trim() : null })
      .eq("id", photoId)
      .is("deleted_at", null),
  );
}

export async function deletePlannerTask(taskId: string, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await Promise.all([
    throwIfError(supabase.from("task_dependencies").delete().eq("predecessor_task_id", taskId)),
    throwIfError(supabase.from("task_dependencies").delete().eq("successor_task_id", taskId)),
  ]);
  await throwIfError(supabase.from("tasks").delete().eq("id", taskId));
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
    manufacturingSteps: mergedSteps.length > 0 ? mergedSteps : serverTask.manufacturingSteps,
  };
}

export async function saveProcedureTaskUpdateToSupabase(
  task: Task,
  _scheduledTasks: Task[],
  projectId?: string,
  allowVersionRetry = true,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  const { custom_fields: _customFields, ...taskProcedurePatch } = taskRow(task);
  let taskUpdate = supabase.from("tasks").update(taskProcedurePatch).eq("id", task.id);

  if (task.version !== undefined) {
    taskUpdate = taskUpdate.eq("version", task.version);
  }

  const savedTask = await throwIfError(taskUpdate.select("id,version").maybeSingle());
  if (!savedTask) {
    if (allowVersionRetry && task.version !== undefined) {
      const latestTask = await loadTaskFromSupabase(task.id, projectId);
      if (latestTask) {
        return saveProcedureTaskUpdateToSupabase(
          mergeTaskWithServerVersions(task, latestTask),
          _scheduledTasks,
          projectId,
          false,
        );
      }
    }

    throw new Error("Task save conflict. Reload this task before saving again.");
  }

  const [existingSteps, existingParts] = await Promise.all([
    throwIfError(supabase.from("manufacturing_steps").select("id,sequence,version").eq("task_id", task.id)),
    throwIfError(supabase.from("part_references").select("id").eq("task_id", task.id)),
  ]);
  const existingStepById = new Map((existingSteps ?? []).map((step) => [String(step.id), step]));
  const nextStepIds = (task.manufacturingSteps ?? []).map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));
  const nextPartIds = (task.partReferences ?? []).map((part) => part.id);
  const stalePartIds = (existingParts ?? [])
    .map((part) => String(part.id))
    .filter((partId) => !nextPartIds.includes(partId));

  const existingSequenceByStepId = new Map(
    (existingSteps ?? []).map((step) => [String(step.id), num(step.sequence)]),
  );
  const needsCollisionSafeResequence = (task.manufacturingSteps ?? []).some((step) => {
    const previousSequence = existingSequenceByStepId.get(step.id);
    if (previousSequence === undefined || previousSequence === step.sequence) {
      return false;
    }

    const currentOwner = (existingSteps ?? []).find((existingStep) => num(existingStep.sequence) === step.sequence);
    return Boolean(currentOwner && String(currentOwner.id) !== step.id);
  });

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  if (needsCollisionSafeResequence && existingSteps?.length) {
    await Promise.all(
      existingSteps.map((step, index) =>
        throwIfError(supabase.from("manufacturing_steps").update({ sequence: 100000 + index }).eq("id", step.id)),
      ),
    );
  }

  for (const step of task.manufacturingSteps ?? []) {
    const row = manufacturingStepRow(task.id, step);
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
        const latestTask = await loadTaskFromSupabase(task.id, projectId);
        if (latestTask) {
          return saveProcedureTaskUpdateToSupabase(
            mergeTaskWithServerVersions(task, latestTask),
            _scheduledTasks,
            projectId,
            false,
          );
        }
      }

      throw new Error("Procedure step save conflict. Reload this task before saving again.");
    }
  }

  const parts = partReferenceRows([task]);
  if (parts.length) {
    await throwIfError(supabase.from("part_references").upsert(parts));
  }

  if (stalePartIds.length) {
    await throwIfError(supabase.from("part_references").delete().in("id", stalePartIds));
  }

  return loadTaskFromSupabase(task.id, projectId);
}

export async function loadTaskFromSupabase(taskId: string, projectId?: string): Promise<Task | null> {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const task = await throwIfError(supabase.from("tasks").select("*").eq("id", taskId).maybeSingle());

  if (!task) {
    return null;
  }

  const [dependencies, manufacturingSteps, partReferences, stepPhotos, stepTools] = await Promise.all([
    throwIfError(supabase.from("task_dependencies").select("*").eq("successor_task_id", taskId)),
    throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", taskId).order("sequence")),
    throwIfError(supabase.from("part_references").select("*").eq("task_id", taskId).order("created_at")),
    throwIfError(supabase.from("step_photos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
    throwIfError(supabase.from("step_tools").select("*").eq("task_id", taskId).order("sequence")),
  ]);

  const mappedTask = mapTask({
    ...task,
    dependency_ids: (dependencies ?? []).map((dependency) => String(dependency.predecessor_task_id)),
    manufacturing_steps: (manufacturingSteps ?? []).map(mapManufacturingStepRecord),
    part_references: (partReferences ?? []).map(mapPartReferenceRecord),
  });

  return withNormalizedStepAssets(
    mappedTask,
    indexStepPhotos((stepPhotos ?? []) as StepPhotoRow[]),
    indexStepTools((stepTools ?? []) as StepToolRow[]),
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

function dataUrlToBlob(dataUrl: string) {
  return fetch(dataUrl).then((response) => {
    if (!response.ok) {
      throw new Error("Unable to prepare photo for upload.");
    }

    return response.blob();
  });
}

function safeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function stepToolId(stepId: string, toolName: string) {
  return `tool-${safeStorageSegment(stepId)}-${safeStorageSegment(toolName.trim().toLocaleLowerCase())}`;
}

function toolLibraryId(toolName: string, projectId?: string) {
  const scope = projectId ? safeStorageSegment(projectId) : "global";
  return `tool-library-${scope}-${safeStorageSegment(toolName.trim().toLocaleLowerCase())}`;
}

function mapToolLibraryRow(row: ToolLibraryRow): ToolLibraryItem {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    toolName: String(row.tool_name),
    imageUrl: row.image_url ?? undefined,
    storagePath: row.storage_path ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function stepToolRowsFromTask(task: Task): StepToolRow[] {
  return Object.entries(getTaskStepToolListMap(task)).flatMap(([stepId, tools]) =>
    tools.map((toolName, index) => ({
      id: stepToolId(stepId, toolName),
      task_id: task.id,
      step_id: stepId,
      tool_name: toolName,
      sequence: index + 1,
    })),
  );
}

async function syncStepToolsForTask(supabase: ReturnType<typeof plannerClient>, task: Task) {
  const nextTools = stepToolRowsFromTask(task);
  const nextToolIds = nextTools.map((tool) => tool.id);
  const existingTools = await throwIfError(supabase.from("step_tools").select("id").eq("task_id", task.id));
  const staleToolIds = (existingTools ?? [])
    .map((tool) => String(tool.id))
    .filter((toolId) => !nextToolIds.includes(toolId));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (staleToolIds.length) {
    await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
  }
}

function stepPhotoRow(taskId: string, stepId: string, photo: StepPhotoAttachment, project?: PlannerProjectContext): StepPhotoRow {
  const storagePath = photo.storagePath || projectScopedStoragePath(taskId, stepId, photo, project);

  return {
    id: photo.id,
    task_id: taskId,
    step_id: stepId,
    storage_path: storagePath,
    public_url: photo.dataUrl,
    file_name: photo.name || "Step photo",
    mime_type: photo.contentType ?? null,
    size_bytes: photo.sizeBytes ?? null,
    width: photo.width ?? null,
    height: photo.height ?? null,
    caption: photo.caption?.trim() ? photo.caption.trim() : null,
    captured_at: photo.capturedAt,
    uploaded_by: null,
    deleted_at: null,
  };
}

async function saveStepPhotoMetadataToSupabase(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, project?.projectId);
  await throwIfError(supabase.from("step_photos").upsert(stepPhotoRow(taskId, stepId, photo, project)));
}

export async function uploadStepPhotoAttachment(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
): Promise<StepPhotoAttachment> {
  if (!photo.dataUrl.startsWith("data:image/")) {
    if (photo.storagePath && /^https?:\/\//.test(photo.dataUrl)) {
      await saveStepPhotoMetadataToSupabase(taskId, stepId, photo, project);
    }
    return photo;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, project?.projectId);
  const blob = await dataUrlToBlob(photo.dataUrl);
  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const storagePath = projectScopedStoragePath(taskId, stepId, photo, project, safeStorageSegment(extension));

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType: photo.contentType ?? blob.type ?? "image/jpeg",
      upsert: true,
    }),
  );

  const { data } = supabase.storage.from(stepPhotoBucket).getPublicUrl(storagePath);

  const uploadedPhoto = {
    ...photo,
    dataUrl: data.publicUrl,
    storagePath,
    contentType: photo.contentType ?? blob.type,
    sizeBytes: blob.size,
  };

  await saveStepPhotoMetadataToSupabase(taskId, stepId, uploadedPhoto, project);

  return uploadedPhoto;
}

export async function removeStepPhotoAttachmentObject(photo: StepPhotoAttachment) {
  if (!photo.storagePath) {
    return;
  }

  const supabase = plannerClient();
  await throwIfError(supabase.storage.from(stepPhotoBucket).remove([photo.storagePath]));
}

export function subscribePlannerStateChanges(onChange: () => void, scope?: PlannerRealtimeScope) {
  const supabase = plannerClient();
  const channel = supabase.channel(`planner-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const taskIds = scope?.taskIds?.filter(Boolean) ?? [];
  const taskIdList = taskIds.map((taskId) => safeStorageSegment(taskId)).join(",");
  const taskFilter = taskIds.length ? `task_id=in.(${taskIdList})` : undefined;

  function listen(table: (typeof realtimePlannerTables)[number], filter?: string) {
    channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, onChange);
  }

  listen("products", scope?.productId ? `id=eq.${scope.productId}` : undefined);
  listen("scenarios", scope?.productId ? `product_id=eq.${scope.productId}` : undefined);
  listen("stations", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("zones", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("tasks", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("task_dependencies", taskIds.length ? `successor_task_id=in.(${taskIdList})` : undefined);
  listen("manufacturing_steps", taskFilter);
  listen("part_references", taskFilter);
  listen("actual_events", taskFilter);
  listen("step_photos", taskFilter);
  listen("step_tools", taskFilter);
  if (scope?.productId) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "custom_columns", filter: `product_id=eq.${scope.productId}` }, onChange);
  }
  if (scope?.scenarioId) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "custom_columns", filter: `scenario_id=eq.${scope.scenarioId}` }, onChange);
  }

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
