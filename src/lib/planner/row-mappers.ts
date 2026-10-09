import { awiTaskLink } from "@/domain/awi-task-link";
// Row mapping and serialization for planner entities: scalar coercion helpers, database-row -> domain
// mappers (workspaces, projects, access grants, products, scenarios, stations, zones, components, document
// types, tasks, steps, parts, dependencies, actual events, custom columns), and domain -> row serializers
// for the same entities, including the task custom-field stripping of step-scoped media and tool maps.
// No network access. Moved verbatim from supabase-planner.ts (Phase 4).

import { awiProcedureSaveBaseline } from "@/domain/awi-procedure-save";
import { EXPLODED_VIEWS_FIELD } from "@/domain/step-exploded-views";
import { mergeStepDependencyRefs, splitStepDependencyRefs } from "@/domain/step-part-references";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "@/domain/step-photos";
import { STEP_TOOL_LISTS_FIELD } from "@/domain/step-tools";
import { TASK_VIDEOS_FIELD } from "@/domain/task-videos";
import type {
  AccessLevel,
  ActualEvent,
  CustomColumn,
  Dependency,
  DocumentTypeCode,
  ManufacturingComponent,
  ManufacturingStep,
  PartReference,
  Product,
  Project,
  Scenario,
  ScenarioSummary,
  Station,
  Task,
  Workspace,
  WorkspaceAccessGrant,
  WorkspaceRole,
  Zone,
} from "@/domain/types";
import type { Json } from "@/lib/database.types";
import { formatDisplayTitle } from "@/lib/display-names";

export function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function maybeNum(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return num(value);
}

export function maybeText(value: unknown) {
  return typeof value === "string" && value.length ? value : undefined;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeAccessLevel(value: unknown): AccessLevel {
  return value === "edit" || value === "view" ? value : "none";
}

export function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapInviteProjectAccess(value: unknown): WorkspaceAccessGrant["projectAccess"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = jsonObject(item);
    const projectId = maybeText(row.projectId ?? row.project_id);
    const level = normalizeAccessLevel(row.level);
    return projectId && level !== "none" ? [{ projectId, level }] : [];
  });
}

function mapInviteDepartmentAccess(value: unknown): WorkspaceAccessGrant["departmentAccess"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = jsonObject(item);
    const departmentId = maybeText(row.departmentId ?? row.department_id);
    const role = row.role;
    const positionTitle = maybeText(row.positionTitle ?? row.position_title) ?? "";
    return departmentId && (role === "author" || role === "reviewer" || role === "approver")
      ? [{ departmentId, role, positionTitle }]
      : [];
  });
}

export function mapProduct(row: Record<string, unknown>): Product {
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

export function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    ownerId: maybeText(row.owner_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    isAwiMaster: row.is_awi_master === true,
    portfolioCategory: maybeText(row.portfolio_category) as Project["portfolioCategory"],
    portfolioPosition: typeof row.portfolio_position === "number" ? row.portfolio_position : undefined,
    status: String(row.status ?? "active") as Project["status"],
    createdBy: maybeText(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapWorkspaceAccessGrant(row: Record<string, unknown>): WorkspaceAccessGrant {
  return {
    workspaceId: String(row.workspace_id),
    email: String(row.email ?? ""),
    role: String(row.role ?? "editor") as WorkspaceRole,
    qualityAccess: normalizeAccessLevel(row.quality_access),
    productAccess: normalizeAccessLevel(row.product_access),
    accessPackage: String(row.access_package ?? "custom"),
    planningAccess: Boolean(row.planning_access),
    projectAccess: mapInviteProjectAccess(row.project_access),
    departmentAccess: mapInviteDepartmentAccess(row.department_access),
    grantedBy: maybeText(row.granted_by),
    redeemedBy: maybeText(row.redeemed_by),
    redeemedAt: maybeText(row.redeemed_at),
    expiresAt: maybeText(row.expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapScenario(row: Record<string, unknown>): Scenario {
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

// Pure mapper for the lightweight scenario-tab rows. Exported for unit testing.
export function mapScenarioSummary(row: Record<string, unknown>): ScenarioSummary {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    targetOutput: num(row.target_output, 1),
    targetOutputPeriod: String(row.target_output_period ?? "day"),
    notes: maybeText(row.notes),
    createdAt: String(row.created_at),
  };
}

export function mapStation(row: Record<string, unknown>): Station {
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

export function mapZone(row: Record<string, unknown>): Zone {
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

export function mapManufacturingComponent(row: Record<string, unknown>): ManufacturingComponent {
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

export function mapDocumentTypeCode(row: Record<string, unknown>): DocumentTypeCode {
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

export function mapManufacturingStepRecord(row: Record<string, unknown>): ManufacturingStep {
  const stepRefs = splitStepDependencyRefs(textArray(row.dependencyIds ?? row.dependency_ids));
  // Some focused loaders normalize step rows before passing them through mapTask,
  // so this mapper must also accept an already-mapped ManufacturingStep. Without
  // this merge, the second mapping pass discarded partReferenceIds from a
  // successful save response and made a newly linked part disappear in the UI.
  const mappedPartReferenceIds = textArray(row.partReferenceIds ?? row.part_reference_ids);
  const mappedQuantityValues = jsonObject(row.partReferenceQuantities ?? row.part_reference_quantities);
  const mappedPartReferenceQuantities = Object.fromEntries(
    Object.entries(mappedQuantityValues)
      .map(([partReferenceId, quantity]) => [partReferenceId, maybeNum(quantity)] as const)
      .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0),
  );

  return {
    id: String(row.id),
    sequence: num(row.sequence, 1),
    name: String(row.name ?? ""),
    instruction: String(row.instruction ?? ""),
    durationMinutes: num(row.durationMinutes ?? row.duration_minutes),
    qualityCheck: maybeText(row.qualityCheck ?? row.quality_check),
    dependencyIds: stepRefs.dependencyIds,
    partReferenceIds: [...new Set([...stepRefs.partReferenceIds, ...mappedPartReferenceIds])],
    partReferenceQuantities: {
      ...stepRefs.partReferenceQuantities,
      ...mappedPartReferenceQuantities,
    },
    version: maybeNum(row.version),
  };
}

function mapManufacturingSteps(value: unknown): ManufacturingStep[] {
  return Array.isArray(value)
    ? value.map((item) => mapManufacturingStepRecord(jsonObject(item)))
    : [];
}

export function mapPartReferenceRecord(row: Record<string, unknown>): PartReference {
  return {
    id: String(row.id),
    partNumber: String(row.partNumber ?? row.part_number ?? ""),
    // These values also form the optimistic-save baseline. Trimming or dropping
    // an empty string would turn an unchanged persisted part into a conflict.
    description: typeof row.description === "string" ? row.description : undefined,
    quantity: maybeNum(row.quantity),
    disposition: typeof row.disposition === "string" ? row.disposition : undefined,
  };
}

function mapPartReferences(value: unknown): PartReference[] {
  return Array.isArray(value)
    ? value.map((item) => mapPartReferenceRecord(jsonObject(item)))
    : [];
}

export function mapTask(row: Record<string, unknown>): Task {
  const task: Task = {
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
    sopId: maybeText(row.sop_id),
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
  if (typeof task.customFields.awiDocumentNumber === "string" &&
      Array.isArray(row.manufacturing_steps) && Array.isArray(row.part_references)) {
    task.procedureSaveBaseline = awiProcedureSaveBaseline(task);
  }
  return task;
}

export function mapDependency(row: Record<string, unknown>): Dependency {
  return {
    id: String(row.id),
    predecessorTaskId: String(row.predecessor_task_id),
    successorTaskId: String(row.successor_task_id),
    type: String(row.type ?? "finish_to_start") as Dependency["type"],
    lagMinutes: maybeNum(row.lag_minutes),
    constraintType: maybeText(row.constraint_type) as Dependency["constraintType"],
  };
}

export function mapActualEvent(row: Record<string, unknown>): ActualEvent {
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

export function mapCustomColumn(row: Record<string, unknown>): CustomColumn {
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

export function productRow(product: Product) {
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
    // Runtime contract unchanged: custom fields have always been JSON-serialized by
    // supabase-js. The cast states that contract at the serialization boundary.
    custom_fields: (product.customFields ?? {}) as Json,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

export function scenarioRow(scenario: Scenario) {
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

export function stationRow(station: Station) {
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

export function zoneRow(zone: Zone) {
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

export function manufacturingComponentRow(component: ManufacturingComponent) {
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

export function documentTypeCodeRow(documentType: DocumentTypeCode) {
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

export function taskRow(task: Task) {
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
    sop_id: task.sopId ?? null,
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

export function customFieldsRow(customFields: Task["customFields"]) {
  const nextCustomFields = { ...(customFields ?? {}) };
  delete nextCustomFields[STEP_PHOTO_ATTACHMENTS_FIELD];
  delete nextCustomFields[EXPLODED_VIEWS_FIELD];
  delete nextCustomFields[TASK_VIDEOS_FIELD];
  delete nextCustomFields[STEP_TOOL_LISTS_FIELD];
  // Same serialization-boundary contract as productRow's custom_fields.
  return nextCustomFields as Json;
}

export function procedureTaskUpdateRow(task: Task) {
  // The Procedure page owns only free text, its manufacturing steps (saved to their own
  // table), the step-derived task duration, and step-scoped custom fields such as part
  // markers. It must NEVER write planning/relationship columns -- station_id, zone_id,
  // scenario_id, component_id, parent_task_id, sop_id, wbs, planned_start/finish, man-hours,
  // operators. Those belong to the planner shell save, which rewrites them from the same
  // state change. Emitting a full taskRow here meant a stale station_id (one whose station
  // row the shell save had not persisted yet) rode along on every procedure autosave and
  // raised tasks_station_id_fkey, aborting the save -- the 2026-09-11 new-user failure.
  // planned_duration_minutes stays: it is the exact sum of the steps this same write
  // persists, so keeping them in one row prevents a task/step duration mismatch, and unlike
  // the relationship columns a number can never dangle against a foreign key.
  return {
    // Master AWIs own their title in the Procedure editor; product task names
    // remain owned by the planner shell. This marker is created with the master.
    ...(typeof task.customFields?.awiDocumentNumber === "string" ? { name: task.name } : {}),
    description: task.description ?? null,
    safety_notes: task.safetyNotes ?? null,
    planned_duration_minutes: task.plannedDurationMinutes,
    custom_fields: customFieldsRow(task.customFields),
  };
}

export function dependencyRow(dependency: Dependency) {
  return {
    id: dependency.id,
    predecessor_task_id: dependency.predecessorTaskId,
    successor_task_id: dependency.successorTaskId,
    type: dependency.type,
    lag_minutes: dependency.lagMinutes ?? 0,
    constraint_type: dependency.constraintType ?? null,
  };
}

export function manufacturingStepRows(tasks: Task[]) {
  tasks = tasks.filter(task => !awiTaskLink(task));
  return tasks.flatMap((task) =>
    (task.manufacturingSteps ?? []).map((step) => manufacturingStepRow(task.id, step)),
  );
}

export function manufacturingStepRow(taskId: string, step: ManufacturingStep) {
  return {
    id: step.id,
    task_id: taskId,
    sequence: step.sequence,
    name: step.name ?? "",
    instruction: step.instruction,
    duration_minutes: step.durationMinutes ?? 0,
    quality_check: step.qualityCheck ?? null,
    dependency_ids: mergeStepDependencyRefs(
      step.dependencyIds,
      step.partReferenceIds,
      step.partReferenceQuantities,
    ),
  };
}

export function normalizeManufacturingStepSequences(steps: ManufacturingStep[]): ManufacturingStep[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const leftSequence = left.step.sequence >= 100000 ? left.index + 1 : left.step.sequence;
      const rightSequence = right.step.sequence >= 100000 ? right.index + 1 : right.step.sequence;
      return leftSequence - rightSequence || left.index - right.index;
    })
    .map(({ step }, index) => ({ ...step, sequence: index + 1 }));
}

export function partReferenceRows(tasks: Task[]) {
  tasks = tasks.filter(task => !awiTaskLink(task));
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

export function actualEventRow(event: ActualEvent) {
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

export function customColumnRow(column: CustomColumn) {
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
    default_value: (column.defaultValue ?? null) as Json,
    options: column.options ?? [],
    formula: column.formula ?? null,
    unit: column.unit ?? null,
    precision: column.precision ?? null,
    visible: column.visible,
    locked: column.locked,
  };
}
