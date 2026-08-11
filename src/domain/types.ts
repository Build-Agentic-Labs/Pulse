export type ProductStatus = "draft" | "review" | "approved" | "released" | "obsolete";
export type DemandPeriod = "shift" | "day" | "week" | "month" | "year" | "custom";
export type ScenarioType = "current_state" | "future_state" | "prototype" | "production" | "what_if";
export type ScenarioStatus = "draft" | "baseline" | "released" | "archived";
export type TaktStatus = "green" | "yellow" | "red" | "missing";
export type RowType = "task" | "milestone" | "inspection" | "material_gate" | "hold" | "rework" | "buffer";
export type TaskStatus =
  | "not_started"
  | "ready"
  | "in_progress"
  | "complete"
  | "blocked"
  | "hold"
  | "qc_hold"
  | "rework";
export type DependencyType = "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";
export type ConstraintType = "safety" | "quality" | "material" | "tooling" | "labor" | "engineering" | "traveler";
export type SkillLevel = "apprentice" | "trained" | "certified" | "expert";
export type ReworkRisk = "low" | "medium" | "high";
export type ActualEventType =
  | "start"
  | "pause"
  | "resume"
  | "complete"
  | "blocked"
  | "unblocked"
  | "qc_hold"
  | "rework"
  | "note";
export type CustomColumnType =
  | "text"
  | "long_text"
  | "number"
  | "currency"
  | "percent"
  | "duration"
  | "date"
  | "datetime"
  | "checkbox"
  | "select"
  | "multi_select"
  | "person"
  | "formula"
  | "url"
  | "file"
  | "relation"
  | "rollup"
  | "status"
  | "rating"
  | "risk_score";
export type CustomColumnScope = "product" | "scenario" | "station" | "task" | "all";
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type ProjectStatus = "active" | "archived";

// Per-user access level for a workspace project or the Quality Module.
export type AccessLevel = "none" | "view" | "edit";

// Aggregated access for one member, used by the admin Users matrix.
export interface MemberAccess {
  userId: string;
  fullName?: string;
  email?: string;
  role: WorkspaceRole;
  isSelf: boolean;
  joinedAt?: string;
  // projectId -> level (absent = "none")
  projectLevels: Record<string, AccessLevel>;
  orgTools: AccessLevel;
}

export interface ManufacturingStep {
  id: string;
  sequence: number;
  name?: string;
  instruction: string;
  durationMinutes?: number;
  qualityCheck?: string;
  dependencyIds?: string[];
  partReferenceIds?: string[];
  version?: number;
}

export interface PartReference {
  id: string;
  partNumber: string;
  description?: string;
  quantity?: number;
  disposition?: string;
}

export interface Product {
  id: string;
  projectId?: string;
  productCode?: string;
  name: string;
  sku?: string;
  family?: string;
  revision: string;
  description?: string;
  ownerId?: string;
  ownerName: string;
  status: ProductStatus;
  targetManHours: number;
  demandQuantity: number;
  demandPeriod: DemandPeriod;
  grossAvailableMinutes: number;
  breakMinutes: number;
  lunchMinutes: number;
  meetingMinutes: number;
  plannedDowntimeMinutes: number;
  workDaysPerWeek: number;
  workWeeksPerMonth: number;
  availableWorkDaysPerMonth: number;
  netAvailableMinutes: number;
  weeklyAvailableMinutes: number;
  monthlyAvailableMinutes: number;
  calculatedTaktMinutes: number;
  manualTaktMinutes?: number;
  activeTaktMinutes: number;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMemberProfile extends WorkspaceMember {
  fullName?: string;
  avatarUrl?: string;
  email?: string;
}

export interface WorkspaceAccessGrant {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  qualityAccess: AccessLevel;
  accessPackage: string;
  planningAccess: boolean;
  projectAccess: Array<{ projectId: string; level: Exclude<AccessLevel, "none"> }>;
  departmentAccess: Array<{
    departmentId: string;
    role: "author" | "reviewer" | "approver";
    positionTitle: string;
  }>;
  grantedBy?: string;
  redeemedBy?: string;
  redeemedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  createdBy?: string;
  // The signed-in user's effective access to this project (when loaded for that user).
  accessLevel?: AccessLevel;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerProjectContext {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  role?: WorkspaceRole;
  accessLevel?: AccessLevel;
}

export interface WorkspaceProjectGroup {
  workspace: Workspace;
  role: WorkspaceRole;
  isSuperAdmin?: boolean;
  projects: Project[];
}

export interface Scenario {
  id: string;
  productId: string;
  name: string;
  description?: string;
  type: ScenarioType;
  status: ScenarioStatus;
  targetOutput: number;
  targetOutputPeriod: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Lightweight scenario row for the scenario switcher tabs — no heavy planner data.
export interface ScenarioSummary {
  id: string;
  name: string;
  targetOutput: number;
  targetOutputPeriod: string;
  notes?: string;
  createdAt: string;
}

export interface Station {
  id: string;
  scenarioId: string;
  sequence: number;
  name: string;
  description?: string;
  ownerId?: string;
  ownerName: string;
  plannedCycleMinutes: number;
  actualCycleMinutes?: number;
  plannedOperators: number;
  actualOperators?: number;
  plannedManHours: number;
  actualManHours?: number;
  taktStatus: TaktStatus;
  bottleneckFlag: boolean;
  wipLimit?: number;
  area?: string;
  toolsRequired?: string[];
  equipmentRequired?: string[];
  safetyNotes?: string;
  qcNotes?: string;
}

export interface Zone {
  id: string;
  scenarioId: string;
  sequence: number;
  name: string;
  code?: string;
  description?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManufacturingComponent {
  id: string;
  scenarioId: string;
  zoneId?: string;
  code: string;
  name: string;
  description?: string;
  sequence: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentTypeCode {
  id: string;
  projectId?: string;
  productId?: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  scenarioId: string;
  stationId: string;
  zoneId?: string;
  componentId?: string;
  taskNumber?: number;
  manufacturingCode?: string;
  codeLocked?: boolean;
  codeGeneratedAt?: string;
  parentTaskId?: string;
  rowType: RowType;
  wbs: string;
  name: string;
  description?: string;
  plannedStart: string;
  plannedFinish: string;
  plannedDurationMinutes: number;
  actualStart?: string;
  actualFinish?: string;
  actualDurationMinutes?: number;
  plannedOperators: number;
  actualOperators?: number;
  plannedManHours: number;
  actualManHours?: number;
  status: TaskStatus;
  percentComplete: number;
  ownerId?: string;
  ownerName?: string;
  role?: string;
  skillLevel?: SkillLevel;
  dependencyIds: string[];
  criticalPath: boolean;
  bottleneckFlag: boolean;
  qualityGate: boolean;
  travelerSignoffRequired: boolean;
  sopLink?: string;
  sopId?: string;
  workInstructionLink?: string;
  drawingLink?: string;
  materialKit?: string;
  toolsRequired?: string[];
  equipmentRequired?: string[];
  safetyNotes?: string;
  qcChecklist?: string;
  reworkRisk?: ReworkRisk;
  notes?: string;
  manufacturingSteps?: ManufacturingStep[];
  partReferences?: PartReference[];
  customFields: Record<string, unknown>;
  version?: number;
}

export interface Dependency {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
  lagMinutes?: number;
  constraintType?: ConstraintType;
}

export interface ActualEvent {
  id: string;
  taskId: string;
  eventType: ActualEventType;
  timestamp: string;
  userId?: string;
  notes?: string;
  reasonCode?: string;
}

export interface CustomColumn {
  id: string;
  productId?: string;
  scenarioId?: string;
  name: string;
  key: string;
  description?: string;
  type: CustomColumnType;
  appliesTo: CustomColumnScope;
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
  formula?: string;
  unit?: string;
  precision?: number;
  visible: boolean;
  locked: boolean;
}

export interface PlannerState {
  project?: PlannerProjectContext;
  product: Product;
  scenario: Scenario;
  stations: Station[];
  zones: Zone[];
  components: ManufacturingComponent[];
  documentTypes: DocumentTypeCode[];
  tasks: Task[];
  dependencies: Dependency[];
  actualEvents: ActualEvent[];
  customColumns: CustomColumn[];
}

export interface ProductKpis {
  availableMinutes: number;
  netAvailableMinutes: number;
  weeklyAvailableMinutes: number;
  monthlyAvailableMinutes: number;
  availableWorkDaysPerMonth: number;
  taktMinutes: number;
  plannedCycleMinutes: number;
  plannedManHours: number;
  assignedPlannedManHours: number;
  unassignedPlannedManHours: number;
  unassignedTaskCount: number;
  targetVariance: number;
  targetVariancePercent: number;
  lineBalanceScore: number;
  bottleneckStation?: Station;
  capacityGapManHours: number;
  targetLaborBudgetManHours: number;
  budgetedCrewEquivalent: number;
  wholePersonStaffingRequirement: number;
  requiredAverageAllocationPercent: number;
  plannedLaborLoadFte: number;
  assignedLaborLoadFte: number;
  peakManpower: number;
  crewUtilizationPercent: number;
}

export interface PlaybackEvent {
  time: number;
  label: string;
  taskId?: string;
  stationId?: string;
}
