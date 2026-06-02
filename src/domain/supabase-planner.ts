import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AccessLevel,
  ActualEvent,
  CustomColumn,
  Dependency,
  MemberAccess,
  DocumentTypeCode,
  ManufacturingStep,
  ManufacturingComponent,
  PartReference,
  PlannerState,
  PlannerProjectContext,
  Product,
  Project,
  Scenario,
  Station,
  Task,
  Workspace,
  WorkspaceAccessGrant,
  WorkspaceMemberProfile,
  WorkspaceProjectGroup,
  WorkspaceRole,
  Zone,
} from "./types";
import { STEP_PHOTO_ATTACHMENTS_FIELD, type StepPhotoAttachment } from "./step-photos";
import { mergeStepDependencyRefs, splitStepDependencyRefs } from "./step-part-references";
import { STEP_TOOL_LISTS_FIELD, getTaskStepToolListMap } from "./step-tools";
import { applyCalculatedFields } from "./calculations";
import { defaultDocumentTypeCodes } from "./nomenclature";
import { formatDisplayTitle } from "@/lib/display-names";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const stepPhotoBucket = "step-photos";
const STEP_PHOTO_THUMBNAIL_EDGE = 320;
const STORAGE_SIGNED_URL_SECONDS = 60 * 60;
// Reuse a signed URL across loads until it's within this margin of expiry. The step-photos bucket is
// private, so every image needs a signed URL -- but objects are immutable (paths embed a unique photo
// id), so the only reason to re-sign is token expiry. Re-signing on every planner load (egress audit)
// changed the `?token=` each time, which is the browser's HTTP cache key, so the 1-year cacheControl
// on the objects never took effect and every realtime-triggered reload re-downloaded every photo.
// Caching keeps the URL stable, so each image downloads ~once per token lifetime per browser instead.
const STORAGE_SIGNED_URL_REFRESH_MARGIN_MS = 10 * 60 * 1000;

type CachedSignedUrl = { url: string; expiresAt: number };
// Keyed by storage path. Module-scoped so it survives the planner reloads a single page session
// triggers (where the repeated re-signing happened); a hard refresh starts cold, which is fine.
const signedUrlCache = new Map<string, CachedSignedUrl>();

// Only the browser caches: each user's tab is its own process, so a cached URL can never reach a
// different user. On the server the module is a shared process, so we always sign fresh there -- a
// shared cache could otherwise hand one user a URL signed under another user's RLS check.
function cachedSignedUrl(storagePath: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const entry = signedUrlCache.get(storagePath);
  if (entry && entry.expiresAt - Date.now() > STORAGE_SIGNED_URL_REFRESH_MARGIN_MS) {
    return entry.url;
  }
  return undefined;
}

function rememberSignedUrl(storagePath: string, url: string) {
  if (typeof window === "undefined") {
    return;
  }
  signedUrlCache.set(storagePath, { url, expiresAt: Date.now() + STORAGE_SIGNED_URL_SECONDS * 1000 });
}
const realtimePlannerTables = [
  "products",
  "scenarios",
  "stations",
  "zones",
  "tasks",
  "task_dependencies",
  "manufacturing_components",
  "document_type_codes",
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
  // Membership test for "does this task belong to the scenario I'm showing". Read live at event time
  // (back it with a ref in the component) so the channel never has to be torn down when the task set
  // changes. Task-child tables subscribe unfiltered and are narrowed here instead of by a server-side
  // filter that would rewrite realtime.subscription on every task add/remove/reorder.
  isTaskInScope?: (taskId: string) => boolean;
};

export type PlannerRealtimePayload = {
  table: (typeof realtimePlannerTables)[number];
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
// instead of reloading the whole scenario and re-signing every photo. Child-table rows (steps, parts,
// events, photos, tools) leave their task intact, so ANY event -- including DELETE -- is patchable.
// A `tasks` DELETE removes the task and cascades (dependencies, station/product rollups, selection),
// so that case falls back to a full reload.
export function canPatchTaskFromRealtimePayload(payload: PlannerRealtimePayload): boolean {
  switch (payload.table) {
    case "manufacturing_steps":
    case "part_references":
    case "actual_events":
    case "step_photos":
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
    case "step_tools":
      return typeof record?.task_id === "string" && isTaskInScope(record.task_id);
    case "task_dependencies":
      return (
        (typeof record?.successor_task_id === "string" && isTaskInScope(record.successor_task_id)) ||
        (typeof record?.predecessor_task_id === "string" && isTaskInScope(record.predecessor_task_id))
      );
    default:
      return true;
  }
}

type StepPhotoRow = {
  id: string;
  task_id: string;
  step_id: string;
  storage_path: string;
  public_url: string;
  thumbnail_url?: string | null;
  thumbnail_storage_path?: string | null;
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

function normalizeAccessLevel(value: unknown): AccessLevel {
  return value === "edit" || value === "view" ? value : "none";
}

// PostgREST/Postgres error codes meaning "this table or function isn't in the schema yet"
// (i.e. a migration hasn't been applied). Callers use this to degrade gracefully.
const MISSING_RELATION_CODES = ["42P01", "PGRST205", "PGRST202"];

function isMissingRelationError(error: { code?: string } | null): boolean {
  return Boolean(error && error.code && MISSING_RELATION_CODES.includes(error.code));
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    projectId: maybeText(row.project_id),
    productCode: maybeText(row.product_code),
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
    customFields: jsonObject(row.custom_fields),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Exact columns consumed by mapWorkspace/mapProject -- avoids select('*') on the hot
// sidebar load path (audit #9). Keep in sync with the mappers below.
const WORKSPACE_COLUMNS = "id, name, owner_id, created_at, updated_at";
const PROJECT_COLUMNS = "id, workspace_id, name, description, status, created_by, created_at, updated_at";

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

function mapWorkspaceAccessGrant(row: Record<string, unknown>): WorkspaceAccessGrant {
  return {
    workspaceId: String(row.workspace_id),
    email: String(row.email ?? ""),
    role: String(row.role ?? "editor") as WorkspaceRole,
    grantedBy: maybeText(row.granted_by),
    redeemedBy: maybeText(row.redeemed_by),
    redeemedAt: maybeText(row.redeemed_at),
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
    code: maybeText(row.code),
    description: maybeText(row.description),
    color: String(row.color ?? "#15756d"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapManufacturingComponent(row: Record<string, unknown>): ManufacturingComponent {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    zoneId: maybeText(row.zone_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    sequence: num(row.sequence, 1),
    active: row.active !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapDocumentTypeCode(row: Record<string, unknown>): DocumentTypeCode {
  return {
    id: String(row.id),
    projectId: maybeText(row.project_id),
    productId: maybeText(row.product_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    active: row.active !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapManufacturingStepRecord(row: Record<string, unknown>): ManufacturingStep {
  const stepRefs = splitStepDependencyRefs(textArray(row.dependencyIds ?? row.dependency_ids));

  return {
    id: String(row.id),
    sequence: num(row.sequence, 1),
    name: String(row.name ?? ""),
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
    componentId: maybeText(row.component_id),
    taskNumber: maybeNum(row.task_number),
    manufacturingCode: maybeText(row.manufacturing_code),
    codeLocked: Boolean(row.code_locked),
    codeGeneratedAt: maybeText(row.code_generated_at),
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
    product_code: product.productCode ?? null,
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
    custom_fields: product.customFields ?? {},
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
    code: zone.code ?? null,
    description: zone.description ?? null,
    color: zone.color,
    created_at: zone.createdAt,
    updated_at: zone.updatedAt,
  };
}

function manufacturingComponentRow(component: ManufacturingComponent) {
  return {
    id: component.id,
    scenario_id: component.scenarioId,
    zone_id: component.zoneId ?? null,
    code: component.code,
    name: component.name,
    description: component.description ?? null,
    sequence: component.sequence,
    active: component.active,
    created_at: component.createdAt,
    updated_at: component.updatedAt,
  };
}

function documentTypeCodeRow(documentType: DocumentTypeCode) {
  return {
    id: documentType.id,
    project_id: documentType.projectId ?? null,
    product_id: documentType.productId ?? null,
    code: documentType.code,
    name: documentType.name,
    active: documentType.active,
    created_at: documentType.createdAt,
    updated_at: documentType.updatedAt,
  };
}

// PostgREST `.or()` filters are raw strings where comma, parens, and whitespace are
// structural. App IDs are UUIDs / safeStorageSegment output and never contain these, so any
// occurrence means a malformed or hostile value -- reject it rather than let it alter the query.
function assertSafeOrFilterValue(value: string): string {
  if (!value || /[(),\s]/.test(value)) {
    throw new Error(`Unsafe identifier in query filter: ${JSON.stringify(value)}`);
  }
  return value;
}

// Build a PostgREST `.or()` disjunction from column/value pairs, validating every value.
function buildOrFilter(...pairs: ReadonlyArray<readonly [column: string, value: string]>): string {
  return pairs.map(([column, value]) => `${column}.eq.${assertSafeOrFilterValue(value)}`).join(",");
}

function documentTypeScopeFilter(product: Pick<Product, "id" | "projectId">) {
  return product.projectId
    ? buildOrFilter(["project_id", product.projectId], ["product_id", String(product.id)])
    : buildOrFilter(["product_id", String(product.id)]);
}

function customColumnScopeFilter(productId: string, scenarioId: string): string {
  return buildOrFilter(["product_id", productId], ["scenario_id", scenarioId]);
}

function taskRow(task: Task) {
  return {
    id: task.id,
    scenario_id: task.scenarioId,
    station_id: task.stationId || null,
    zone_id: task.zoneId ?? null,
    component_id: task.componentId ?? null,
    task_number: task.taskNumber ?? null,
    manufacturing_code: task.manufacturingCode ?? null,
    code_locked: Boolean(task.codeLocked),
    code_generated_at: task.codeGeneratedAt ?? null,
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
    name: step.name ?? "",
    instruction: step.instruction,
    duration_minutes: step.durationMinutes ?? 0,
    quality_check: step.qualityCheck ?? null,
    dependency_ids: mergeStepDependencyRefs(step.dependencyIds, step.partReferenceIds),
  };
}

function normalizeManufacturingStepSequences(steps: ManufacturingStep[]): ManufacturingStep[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const leftSequence = left.step.sequence >= 100000 ? left.index + 1 : left.step.sequence;
      const rightSequence = right.step.sequence >= 100000 ? right.index + 1 : right.step.sequence;
      return leftSequence - rightSequence || left.index - right.index;
    })
    .map(({ step }, index) => ({ ...step, sequence: index + 1 }));
}

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
    thumbnailUrl: maybeText(row.thumbnail_url),
    thumbnailStoragePath: maybeText(row.thumbnail_storage_path),
    caption: maybeText(row.caption),
  };
}

async function signedStorageUrl(supabase: SupabaseClient, storagePath?: string | null) {
  if (!storagePath) {
    return undefined;
  }

  const cached = cachedSignedUrl(storagePath);
  if (cached) {
    return cached;
  }

  const { data, error } = await supabase.storage
    .from(stepPhotoBucket)
    .createSignedUrl(storagePath, STORAGE_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    return undefined;
  }

  rememberSignedUrl(storagePath, data.signedUrl);
  return data.signedUrl;
}

async function signedStorageUrls(supabase: SupabaseClient, storagePaths: string[]) {
  const uniquePaths = [...new Set(storagePaths.filter(Boolean))];
  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (const path of uniquePaths) {
    const cached = cachedSignedUrl(path);
    if (cached) {
      resolved.set(path, cached);
    } else {
      missing.push(path);
    }
  }

  if (missing.length === 0) {
    return resolved;
  }

  const { data, error } = await supabase.storage
    .from(stepPhotoBucket)
    .createSignedUrls(missing, STORAGE_SIGNED_URL_SECONDS);

  if (error || !data) {
    return resolved;
  }

  for (const entry of data) {
    if (entry.path && entry.signedUrl) {
      const path = String(entry.path);
      const url = String(entry.signedUrl);
      rememberSignedUrl(path, url);
      resolved.set(path, url);
    }
  }

  return resolved;
}

async function withSignedStepPhotoRows(supabase: SupabaseClient, rows: StepPhotoRow[] = []) {
  const signedUrls = await signedStorageUrls(
    supabase,
    rows.flatMap((row) => [row.storage_path, row.thumbnail_storage_path].filter((value): value is string => Boolean(value))),
  );

  return rows.map((row) => ({
    ...row,
    public_url: (row.storage_path ? signedUrls.get(row.storage_path) : undefined) ?? row.public_url,
    thumbnail_url:
      (row.thumbnail_storage_path ? signedUrls.get(row.thumbnail_storage_path) : undefined) ?? row.thumbnail_url ?? null,
  }));
}

async function withSignedToolLibraryRows(supabase: SupabaseClient, rows: ToolLibraryRow[] = []) {
  const signedUrls = await signedStorageUrls(
    supabase,
    rows.map((row) => row.storage_path).filter((value): value is string => Boolean(value)),
  );

  return rows.map((row) => ({
    ...row,
    image_url: (row.storage_path ? signedUrls.get(row.storage_path) : undefined) ?? row.image_url ?? null,
  }));
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

// Project-membership assertions are advisory UX guards -- the real enforcement is RLS, which
// gates every write on has_project_access(). These resolve a task/scenario's project in ONE
// round-trip via the SECURITY DEFINER resolver functions (was 3 sequential queries each).
async function assertTaskInProject(supabase: ReturnType<typeof plannerClient>, taskId: string, projectId?: string) {
  if (!projectId) {
    return;
  }

  const resolvedProjectId = await throwIfError(supabase.rpc("task_project_id", { target_task_id: taskId }));
  if (!resolvedProjectId || String(resolvedProjectId) !== projectId) {
    throw new Error("This task does not belong to the active project.");
  }
}

async function assertTaskRowInProject(supabase: ReturnType<typeof plannerClient>, task: Task, projectId?: string) {
  if (!projectId) {
    return;
  }

  // A task's project is determined by its scenario; this works for both new (not-yet-saved)
  // and existing tasks. RLS still independently blocks any cross-project write.
  const resolvedProjectId = await throwIfError(
    supabase.rpc("scenario_project_id", { target_scenario_id: task.scenarioId }),
  );
  if (!resolvedProjectId || String(resolvedProjectId) !== projectId) {
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

function projectScopedThumbnailStoragePath(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
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
        "thumbnails",
        `${photo.id}.webp`,
      ]
    : [taskId, stepId, "thumbnails", `${photo.id}.webp`];

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

  if (state.components.length) {
    await throwIfError(supabase.from("manufacturing_components").insert(state.components.map(manufacturingComponentRow)));
  }

  if (state.documentTypes.length) {
    await throwIfError(supabase.from("document_type_codes").insert(state.documentTypes.map(documentTypeCodeRow)));
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
    components: [],
    documentTypes: defaultDocumentTypeCodes.map((documentType) => ({
      id: `document-type-${productId}-${documentType.code.toLowerCase()}`,
      productId,
      code: documentType.code,
      name: documentType.name,
      active: documentType.active,
      createdAt: now,
      updatedAt: now,
    })),
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

  const superAdmin = await fetchIsSuperAdmin(supabase);
  const memberRole = member?.role ? (String(member.role) as WorkspaceRole) : undefined;
  // Workspace managers (and superadmins) see/edit every project they manage.
  const isManager = superAdmin || memberRole === "owner" || memberRole === "admin";

  let role: WorkspaceRole | undefined;
  let accessLevel: AccessLevel | undefined;

  if (isManager) {
    role = memberRole ?? "owner";
    accessLevel = "edit";
  } else {
    const level = userData.user
      ? await fetchProjectAccessLevel(supabase, String(project.id), userData.user.id)
      : undefined;
    if (level === undefined) {
      // Access model not available yet — fall back to legacy workspace role.
      role = memberRole;
    } else {
      accessLevel = level;
      // Reuse role-based edit gating: edit -> editor, view -> viewer, none -> no access.
      role = level === "edit" ? "editor" : level === "view" ? "viewer" : undefined;
    }
  }

  return {
    projectId: String(project.id),
    projectName: String(project.name ?? ""),
    workspaceId: String(workspace.id),
    workspaceName: String(workspace.name ?? ""),
    role,
    accessLevel,
  };
}

// Whether the signed-in user is a platform superadmin. Returns false (rather than throwing)
// when the migration has not been applied yet, so the app degrades gracefully.
export async function fetchIsSuperAdmin(
  supabase: ReturnType<typeof plannerClient> = plannerClient(),
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_super_admin");
  if (error) {
    if (error.code === "PGRST202") {
      return false;
    }
    throw error;
  }
  return data === true;
}

// The signed-in user's access level for a single project. Returns undefined when the
// project_access table doesn't exist yet (pre-migration) so callers can fall back to
// legacy role-based behavior.
async function fetchProjectAccessLevel(
  supabase: ReturnType<typeof plannerClient>,
  projectId: string,
  userId: string,
): Promise<AccessLevel | undefined> {
  const { data, error } = await supabase
    .from("project_access")
    .select("level")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return undefined;
    }
    throw error;
  }
  return normalizeAccessLevel(data?.level);
}

// The signed-in user's full project-access map (projectId -> level). Returns undefined when
// the project_access table doesn't exist yet (pre-migration) so callers skip filtering.
async function fetchUserProjectAccessMap(
  supabase: ReturnType<typeof plannerClient>,
  userId: string,
): Promise<Map<string, AccessLevel> | undefined> {
  const { data, error } = await supabase.from("project_access").select("project_id, level").eq("user_id", userId);
  if (error) {
    if (isMissingRelationError(error)) {
      return undefined;
    }
    throw error;
  }
  return new Map((data ?? []).map((row) => [String(row.project_id), normalizeAccessLevel(row.level)]));
}

// The signed-in user's Org tools access level ("edit" for superadmins).
export async function fetchOrgToolAccess(
  supabase: ReturnType<typeof plannerClient> = plannerClient(),
): Promise<AccessLevel> {
  if (await fetchIsSuperAdmin(supabase)) {
    return "edit";
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return "none";
  }
  const { data, error } = await supabase
    .from("org_tool_access")
    .select("level")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return "none";
    }
    throw error;
  }
  const level = data?.level ? String(data.level) : "none";
  return level === "edit" || level === "view" ? (level as AccessLevel) : "none";
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

  const { error: redeemError } = await supabase.rpc("redeem_workspace_access_grants");

  if (redeemError && redeemError.code !== "PGRST202") {
    throw redeemError;
  }

  return loadWorkspaceProjectGroups();
}

export async function loadWorkspaceProjectGroups(): Promise<WorkspaceProjectGroup[]> {
  const supabase = plannerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error(userError?.message ?? "Sign in before loading workspaces.");
  }

  const isSuperAdmin = await fetchIsSuperAdmin(supabase);

  // Superadmins see every workspace and project (RLS grants full read access), acting as
  // owner with no module restrictions, regardless of membership rows.
  if (isSuperAdmin) {
    const [workspaces, projects] = await Promise.all([
      throwIfError(supabase.from("workspaces").select(WORKSPACE_COLUMNS).order("created_at")),
      throwIfError(supabase.from("projects").select(PROJECT_COLUMNS).order("created_at")),
    ]);

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
        role: "owner" as WorkspaceRole,
        isSuperAdmin: true,
        projects: projectsByWorkspaceId.get(mappedWorkspace.id) ?? [],
      };
    });
  }

  const memberships = await throwIfError(
    supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userData.user.id)
      .order("created_at"),
  );

  const workspaceIds = [...new Set((memberships ?? []).map((membership) => String(membership.workspace_id)))];

  if (!workspaceIds.length) {
    return [];
  }

  const [workspaces, projects] = await Promise.all([
    throwIfError(supabase.from("workspaces").select(WORKSPACE_COLUMNS).in("id", workspaceIds).order("created_at")),
    throwIfError(supabase.from("projects").select(PROJECT_COLUMNS).in("workspace_id", workspaceIds).order("created_at")),
  ]);

  const membershipByWorkspaceId = new Map(
    (memberships ?? []).map((membership) => [String(membership.workspace_id), membership]),
  );
  const projectsByWorkspaceId = new Map<string, Project[]>();

  (projects ?? []).forEach((project) => {
    const mappedProject = mapProject(project);
    projectsByWorkspaceId.set(mappedProject.workspaceId, [
      ...(projectsByWorkspaceId.get(mappedProject.workspaceId) ?? []),
      mappedProject,
    ]);
  });

  // The user's per-project access. Managers (owner/admin) see every project in workspaces
  // they manage; other members see only projects they've been granted view/edit on.
  // undefined map = pre-migration: don't filter (legacy behavior).
  const accessMap = await fetchUserProjectAccessMap(supabase, userData.user.id);

  return (workspaces ?? []).map((workspace) => {
    const mappedWorkspace = mapWorkspace(workspace);
    const membership = membershipByWorkspaceId.get(mappedWorkspace.id);
    const role = membership?.role ? (String(membership.role) as WorkspaceRole) : "viewer";
    const isManager = role === "owner" || role === "admin";
    const allProjects = projectsByWorkspaceId.get(mappedWorkspace.id) ?? [];

    let visibleProjects: Project[];
    if (isManager || !accessMap) {
      visibleProjects = allProjects.map((project) => ({
        ...project,
        accessLevel: isManager ? "edit" : project.accessLevel,
      }));
    } else {
      visibleProjects = allProjects
        .map((project) => ({ ...project, accessLevel: accessMap.get(project.id) ?? "none" }))
        .filter((project) => project.accessLevel !== "none");
    }

    return {
      workspace: mappedWorkspace,
      role,
      isSuperAdmin: false,
      projects: visibleProjects,
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

  // Grant the creator edit access on the new project (no-op if the table doesn't exist yet).
  if (userData.user) {
    const { error: accessError } = await supabase
      .from("project_access")
      .upsert(
        { project_id: projectId, user_id: userData.user.id, level: "edit", granted_by: userData.user.id },
        { onConflict: "project_id,user_id" },
      );
    if (accessError && !isMissingRelationError(accessError)) {
      throw accessError;
    }
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
  // Fetch members and profiles separately and merge in JS. There is no direct foreign key
  // between workspace_members and profiles (both only reference auth.users), so a PostgREST
  // embed (`profiles(...)`) fails with PGRST200. Profile names for fellow members are
  // visible thanks to the "profiles workspace manager read" policy.
  const rows = await throwIfError(
    supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );
  const members = rows ?? [];

  const userIds = [...new Set(members.map((row) => String(row.user_id)))];
  const profileRows = userIds.length
    ? await throwIfError(supabase.from("profiles").select("id,full_name,avatar_url").in("id", userIds))
    : [];
  const profileById = new Map((profileRows ?? []).map((profile) => [String(profile.id), profile]));

  return members.map((row) => {
    const profile = profileById.get(String(row.user_id));
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

export async function loadWorkspaceAccessGrantsFromSupabase(workspaceId: string): Promise<WorkspaceAccessGrant[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("workspace_access_grants")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );

  return (rows ?? []).map(mapWorkspaceAccessGrant);
}

export async function upsertWorkspaceAccessGrantInSupabase(
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail.endsWith("@anacorp.com")) {
    throw new Error("Only Anacorp work emails can be granted access.");
  }

  const supabase = plannerClient();
  const { data: userData } = await supabase.auth.getUser();

  await throwIfError(
    supabase.from("workspace_access_grants").upsert(
      {
        workspace_id: workspaceId,
        email: normalizedEmail,
        role,
        granted_by: userData.user?.id ?? null,
      },
      { onConflict: "workspace_id,email" },
    ),
  );
}

export async function deleteWorkspaceAccessGrantFromSupabase(workspaceId: string, email: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(
    supabase
      .from("workspace_access_grants")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("email", email.trim().toLowerCase()),
  );
}

// Per-member access matrix for a workspace: each member's role plus their per-project level
// and Org tools level. Readable by workspace managers and superadmins.
export async function loadMembersAccessForWorkspace(workspaceId: string): Promise<MemberAccess[]> {
  const supabase = plannerClient();
  const { data: userData } = await supabase.auth.getUser();
  const selfId = userData.user?.id;

  // Members and the workspace's project list are independent — fetch them together.
  const [members, projectRows] = await Promise.all([
    loadWorkspaceMembersFromSupabase(workspaceId),
    throwIfError(supabase.from("projects").select("id").eq("workspace_id", workspaceId).order("created_at")),
  ]);
  const projectIds = (projectRows ?? []).map((row) => String(row.id));
  const userIds = members.map((member) => member.userId);

  // project_access and org_tool_access are likewise independent of each other.
  const [accessRows, orgRows] = await Promise.all([
    projectIds.length
      ? throwIfError(supabase.from("project_access").select("project_id, user_id, level").in("project_id", projectIds))
      : Promise.resolve([]),
    userIds.length
      ? throwIfError(supabase.from("org_tool_access").select("user_id, level").in("user_id", userIds))
      : Promise.resolve([]),
  ]);

  const levelByUserProject = new Map<string, AccessLevel>();
  (accessRows ?? []).forEach((row) => {
    levelByUserProject.set(`${row.user_id}|${row.project_id}`, normalizeAccessLevel(row.level));
  });
  const orgByUser = new Map<string, AccessLevel>();
  (orgRows ?? []).forEach((row) => {
    orgByUser.set(String(row.user_id), normalizeAccessLevel(row.level));
  });

  return members.map((member) => {
    const projectLevels: Record<string, AccessLevel> = {};
    projectIds.forEach((projectId) => {
      projectLevels[projectId] = levelByUserProject.get(`${member.userId}|${projectId}`) ?? "none";
    });
    return {
      userId: member.userId,
      fullName: member.fullName,
      role: member.role,
      isSelf: member.userId === selfId,
      projectLevels,
      orgTools: orgByUser.get(member.userId) ?? "none",
    };
  });
}

export async function setProjectAccessInSupabase(
  projectId: string,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await supabase.auth.getUser();
  await throwIfError(
    supabase.from("project_access").upsert(
      { project_id: projectId, user_id: userId, level, granted_by: userData.user?.id ?? null },
      { onConflict: "project_id,user_id" },
    ),
  );
}

export async function setOrgToolAccessInSupabase(userId: string, level: AccessLevel): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await supabase.auth.getUser();
  await throwIfError(
    supabase.from("org_tool_access").upsert(
      { user_id: userId, level, granted_by: userData.user?.id ?? null },
      { onConflict: "user_id" },
    ),
  );
}

export async function loadPlannerStateWithProjectFromSupabase(projectId?: string): Promise<{
  state: PlannerState;
  project: PlannerProjectContext;
} | null> {
  const supabase = plannerClient();
  let project: PlannerProjectContext | undefined;
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

  const documentTypeFilter = documentTypeScopeFilter({ id: String(product.id), projectId: maybeText(product.project_id) });
  const [stations, zones, components, documentTypes, taskRows, customColumns] = await Promise.all([
    throwIfError(supabase.from("stations").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("zones").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("manufacturing_components").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(
      supabase
        .from("document_type_codes")
        .select("*")
        .or(documentTypeFilter)
        .order("created_at"),
    ),
    throwIfError(supabase.from("tasks").select("*").eq("scenario_id", scenario.id).order("wbs")),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("*")
        .or(customColumnScopeFilter(String(product.id), String(scenario.id)))
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
  const signedStepPhotos = await withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]);
  const photosByTaskId = indexStepPhotos(signedStepPhotos);
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
    throw new Error("This product is not assigned to a project yet.");
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
  const [existingTasks, existingStations, existingZones, existingComponents, existingDocumentTypes, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id").eq("scenario_id", state.scenario.id)),
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

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
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

export async function savePlannerShellToSupabase(state: PlannerState) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a project before saving planner data.");
  }

  const supabase = plannerClient();
  const [existingTasks, existingStations, existingZones, existingComponents, existingDocumentTypes, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id").eq("scenario_id", state.scenario.id)),
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

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
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

export async function syncStepToolsForStepToSupabase(
  taskId: string,
  stepId: string,
  toolNames: string[],
  projectId?: string,
) {
  const cleanedToolNames = toolNames
    .map((toolName) => toolName.trim())
    .filter(Boolean)
    .filter(
      (tool, index, list) =>
        list.findIndex((candidate) => candidate.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index,
    );
  const nextTools = cleanedToolNames.map((toolName, index) => ({
    id: stepToolId(stepId, toolName),
    task_id: taskId,
    step_id: stepId,
    tool_name: toolName,
    sequence: index + 1,
  }));
  const nextToolIds = nextTools.map((tool) => tool.id);
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const existingTools = await throwIfError(
    supabase.from("step_tools").select("id").eq("task_id", taskId).eq("step_id", stepId),
  );
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

// Tools are project-scoped; every tool-library mutation requires a project context.
function requireToolLibraryProjectId(projectId: string | undefined, action: string): string {
  if (!projectId) {
    throw new Error(`Select a project before ${action} the library.`);
  }
  return projectId;
}

export async function loadToolLibraryFromSupabase(projectId?: string): Promise<ToolLibraryItem[]> {
  // Tools are project-scoped; with no project context there is no library to load.
  if (!projectId) {
    return [];
  }

  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase.from("tool_library").select("*").eq("project_id", projectId).order("tool_name"),
  );
  const signedRows = await withSignedToolLibraryRows(supabase, (rows ?? []) as ToolLibraryRow[]);
  return signedRows.map(mapToolLibraryRow);
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

  if (!project) {
    throw new Error("Select a project before adding tools to the library.");
  }

  const supabase = plannerClient();
  const projectId = project.projectId;
  const blob = await dataUrlToBlob(photo.dataUrl);
  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const pathSegments = ["workspaces", project.workspaceId, "projects", project.projectId, "tool-library", `${toolLibraryId(tool, projectId)}.${extension}`];
  const storagePath = pathSegments.map(safeStorageSegment).join("/");

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType: photo.contentType ?? blob.type ?? "image/jpeg",
      upsert: true,
    }),
  );

  const row = {
    id: toolLibraryId(tool, projectId),
    project_id: projectId,
    tool_name: tool,
    image_url: stableStoragePublicUrl(storagePath),
    storage_path: storagePath,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  const [signedSaved] = await withSignedToolLibraryRows(supabase, [saved as ToolLibraryRow]);
  return mapToolLibraryRow(signedSaved);
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

  const projectId = requireToolLibraryProjectId(input.projectId, "saving tools to");

  const supabase = plannerClient();
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
    project_id: projectId,
    tool_name: toolName,
    category: input.category?.trim() || null,
    image_url: existing?.image_url ?? null,
    storage_path: existing?.storage_path ?? null,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  const [signedSaved] = await withSignedToolLibraryRows(supabase, [saved as ToolLibraryRow]);
  return mapToolLibraryRow(signedSaved);
}

export async function deleteToolLibraryFromSupabase(id: string, projectId?: string) {
  const ensuredProjectId = requireToolLibraryProjectId(projectId, "removing tools from");
  const supabase = plannerClient();
  await throwIfError(
    supabase.from("tool_library").delete().eq("id", id).eq("project_id", ensuredProjectId),
  );
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
  // task_dependencies (both endpoints), manufacturing_steps, part_references, actual_events and
  // step_tools all FK to tasks ON DELETE CASCADE, so deleting the task atomically removes them.
  // The previous manual dependency deletes were redundant and opened a split-brain window
  // (edges gone, task still present) if the task delete then failed.
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
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  const normalizedSteps = normalizeManufacturingStepSequences(task.manufacturingSteps ?? []);
  const taskToSave = { ...task, manufacturingSteps: normalizedSteps };
  const { custom_fields: _customFields, ...taskProcedurePatch } = taskRow(taskToSave);
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

  await saveProcedureTaskUpdateToSupabase(sourceTask, scheduledTasks, projectId);
  await saveProcedureTaskUpdateToSupabase(targetTask, scheduledTasks, projectId);
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
    manufacturing_steps: normalizeManufacturingStepSequences((manufacturingSteps ?? []).map(mapManufacturingStepRecord)),
    part_references: (partReferences ?? []).map(mapPartReferenceRecord),
  });

  return withNormalizedStepAssets(
    mappedTask,
    indexStepPhotos(await withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[])),
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
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Unable to prepare photo for upload.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const metadataParts = metadata.split(";");
  const contentType = metadataParts[0] || "application/octet-stream";
  const isBase64 = metadataParts.includes("base64");
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: contentType });
}

function blobToImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof Image === "undefined" || typeof URL === "undefined") {
      reject(new Error("Photo thumbnails can only be generated in the browser."));
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to generate photo thumbnail."));
    };
    image.src = objectUrl;
  });
}

async function createPhotoThumbnailBlob(blob: Blob) {
  if (typeof document === "undefined") {
    return null;
  }

  const image = await blobToImage(blob);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const scale = Math.min(1, STEP_PHOTO_THUMBNAIL_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, width, height);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((thumbnailBlob) => resolve(thumbnailBlob), "image/webp", 0.78);
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

function stableStoragePublicUrl(storagePath: string) {
  return `${supabaseUrl}/storage/v1/object/public/${stepPhotoBucket}/${storagePath}`;
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

// Batched equivalent of calling syncStepToolsForTask per task: one existence read, one upsert,
// one stale-delete across the whole task set (was 2-3 queries PER task). Preserves the default
// allowEmptyWipe=false semantics -- a task that ends up with no tools keeps its existing tools
// (only tasks that contribute at least one tool have their stale rows removed).
async function syncStepToolsForTasks(supabase: ReturnType<typeof plannerClient>, tasks: Task[]) {
  if (tasks.length === 0) {
    return;
  }

  const taskIds = tasks.map((task) => task.id);
  const nextToolsByTask = new Map(tasks.map((task) => [task.id, stepToolRowsFromTask(task)] as const));
  const nextTools = [...nextToolsByTask.values()].flat();
  const nextToolIds = new Set(nextTools.map((tool) => tool.id));
  const wipeableTaskIds = new Set(
    [...nextToolsByTask].filter(([, tools]) => tools.length > 0).map(([id]) => id),
  );

  const existingTools = await throwIfError(
    supabase.from("step_tools").select("id, task_id").in("task_id", taskIds),
  );
  const staleToolIds = (existingTools ?? [])
    .filter((tool) => !nextToolIds.has(String(tool.id)) && wipeableTaskIds.has(String(tool.task_id)))
    .map((tool) => String(tool.id));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (staleToolIds.length) {
    await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
  }
}

async function syncStepToolsForTask(
  supabase: ReturnType<typeof plannerClient>,
  task: Task,
  options: { allowEmptyWipe?: boolean } = {},
) {
  const nextTools = stepToolRowsFromTask(task);
  const nextToolIds = nextTools.map((tool) => tool.id);
  const existingTools = await throwIfError(supabase.from("step_tools").select("id").eq("task_id", task.id));
  const staleToolIds = (existingTools ?? [])
    .map((tool) => String(tool.id))
    .filter((toolId) => !nextToolIds.includes(toolId));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (!staleToolIds.length) {
    return;
  }

  if (nextTools.length === 0 && !options.allowEmptyWipe) {
    return;
  }

  await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
}

function stepPhotoRow(taskId: string, stepId: string, photo: StepPhotoAttachment, project?: PlannerProjectContext): StepPhotoRow {
  const storagePath = photo.storagePath || projectScopedStoragePath(taskId, stepId, photo, project);

  return {
    id: photo.id,
    task_id: taskId,
    step_id: stepId,
    storage_path: storagePath,
    public_url: stableStoragePublicUrl(storagePath),
    thumbnail_url: photo.thumbnailStoragePath ? stableStoragePublicUrl(photo.thumbnailStoragePath) : (photo.thumbnailUrl ?? null),
    thumbnail_storage_path: photo.thumbnailStoragePath ?? null,
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

  const publicUrl = stableStoragePublicUrl(storagePath);
  const signedUrl = await signedStorageUrl(supabase, storagePath);
  let thumbnailUrl: string | undefined;
  let thumbnailStoragePath: string | undefined;

  const thumbnailBlob = await createPhotoThumbnailBlob(blob).catch(() => null);
  if (thumbnailBlob) {
    thumbnailStoragePath = projectScopedThumbnailStoragePath(taskId, stepId, photo, project);
    await throwIfError(
      supabase.storage.from(stepPhotoBucket).upload(thumbnailStoragePath, thumbnailBlob, {
        cacheControl: "31536000",
        contentType: thumbnailBlob.type || "image/webp",
        upsert: true,
      }),
    );
    thumbnailUrl = await signedStorageUrl(supabase, thumbnailStoragePath);
  }

  const uploadedPhoto = {
    ...photo,
    dataUrl: signedUrl ?? publicUrl,
    storagePath,
    thumbnailUrl,
    thumbnailStoragePath,
    contentType: photo.contentType ?? blob.type,
    sizeBytes: blob.size,
  };

  await saveStepPhotoMetadataToSupabase(taskId, stepId, uploadedPhoto, project);

  return uploadedPhoto;
}

export async function removeStepPhotoAttachmentObject(photo: StepPhotoAttachment) {
  const paths = [photo.storagePath, photo.thumbnailStoragePath].filter((value): value is string => Boolean(value));
  if (!paths.length) {
    return;
  }

  const supabase = plannerClient();
  await throwIfError(supabase.storage.from(stepPhotoBucket).remove(paths));
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

  function listen(table: (typeof realtimePlannerTables)[number], filter?: string) {
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
  listen("step_tools");
  if (scope?.productId) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "custom_columns", filter: `product_id=eq.${scope.productId}` }, (payload) => {
      emit({
        table: "custom_columns",
        eventType: payload.eventType as PlannerRealtimePayload["eventType"],
        new: payload.new as Record<string, unknown> | undefined,
        old: payload.old as Record<string, unknown> | undefined,
      });
    });
  }
  if (scope?.scenarioId) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "custom_columns", filter: `scenario_id=eq.${scope.scenarioId}` }, (payload) => {
      emit({
        table: "custom_columns",
        eventType: payload.eventType as PlannerRealtimePayload["eventType"],
        new: payload.new as Record<string, unknown> | undefined,
        old: payload.old as Record<string, unknown> | undefined,
      });
    });
  }

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
