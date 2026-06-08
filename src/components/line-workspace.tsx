"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardList,
  Copy,
  Download,
  Factory,
  FileText,
  GitBranch,
  ImageIcon,
  ListChecks,
  Package,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sun,
  Moon,
  Tags,
  Timer,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  applyCalculatedFields,
  calculateActiveTaktMinutes,
  calculateAvailabilityMinutesForDemandPeriod,
  calculatePeakManpower,
  calculateTaskManHours,
  calculateProductKpis,
  formatMinutes,
  getTopLevelTasks,
  getTaskWindow,
  getTimelineBounds,
  round,
} from "@/domain/calculations";
import { buildOperatorAssignmentsFromIePlan } from "@/domain/operator-allocation";
import type { IeSmartAllocationPlan, IeSmartAllocationRequest } from "@/domain/ie-smart-allocation";
import { getTaskOperatorIds, getTaskOperatorResetPatch, syncTaskOperatorCount } from "@/domain/operator-assignments";
import { buildMarkdownReport, buildStationSetupDocumentHtml } from "@/domain/report";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { readCachedPlannerState, writeCachedPlannerState } from "@/lib/planner-state-cache";
import { buildStepPhotoAttachment } from "@/lib/step-photo-image";
import { buildPlaybackEvents } from "@/domain/playback";
import {
  buildProcessStationForTask,
  getTaskProcessNumber,
  getTaskWbsSuffix,
  normalizeTaskPlanningContext,
  stationIdForUnzoned,
  stationIdForZone,
} from "@/domain/task-planning";
import {
  applyTaskCode,
  applyTaskCodes,
  enforceStepDerivedDuration,
  ensureNomenclatureCollections,
  removeStepScopedCustomFields,
  taskPatchChangesSchedule,
} from "@/domain/task-mutations";
import {
  buildSmartAllocationReviewText,
  buildUnallocatedWorkReviews,
  issueReviewLabel,
  type UnallocatedWorkReview,
} from "@/domain/smart-allocation-report";
import {
  getStepPhotoAttachments,
  removeStepPhotoAttachment,
  updateStepPhotoAttachment,
  upsertStepPhotoAttachments,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import {
  addStepPartReference,
  attachPartToStep,
  getStepPartReferenceIds,
  getStepPartReferences,
  removePartReferenceFromSteps,
  removeStepPartReference,
} from "@/domain/step-part-references";
import { addStepTool, buildStepToolLibrary, countTaskStepTools, getStepToolList, removeStepTool, removeToolFromAllTasks, renameToolInTasks } from "@/domain/step-tools";
import { buildProjectToolCatalog, planToolNameTidy, removeTaskPartReference, updateTaskPartReference, type ProjectPartCatalogEntry, type ProjectToolCatalogEntry } from "@/domain/project-catalog";
import { buildProjectToolRegistry, type ProjectToolDefinition } from "@/domain/tool-registry";
import { canonicalToolKey, formatToolName } from "@/domain/tool-name-format";
import type { ToolTypeValue } from "@/domain/tool-types";
import {
  PRODUCT_STEP_CHECK_CONFIG_FIELD,
  getManufacturingStepCheckDefinitions,
  getManufacturingStepCheckState,
  normalizeManufacturingStepCheck,
  serializeManufacturingStepCheckDefinitions,
  serializeManufacturingStepCheckState,
  type ManufacturingStepCheckDefinition,
  type ManufacturingStepCheckState,
} from "@/domain/manufacturing-step-checks";
import {
  PRODUCT_MASTER_BOM_FIELD,
  getMasterBom,
  serializeMasterBom,
  type MasterBom,
} from "@/domain/master-bom";
import { createAnnotationId } from "@/domain/photo-annotations";
import { BomPartSearch, type BomPartSelection } from "./bom-part-search";
import {
  defaultDocumentTypeCodes,
  generateTaskCode,
  nextTaskNumberForComponent,
  normalizeCode,
  documentDisplayCode,
  stepDisplayCode,
  taskDisplayCode,
} from "@/domain/nomenclature";
import { applyInstructionBullets, resolveBulletEnter } from "@/domain/instruction-bullets";
import { moveManufacturingStepBetweenTasks } from "@/domain/move-manufacturing-step";
import {
  formatManHours,
  periodLabel,
  safeNumber,
  statusLabel,
} from "@/domain/formatting";
import {
  addMinutes,
  rebuildDependenciesFromTasks,
  relinkTasksForDependency,
  rescheduleTasksByDependencies,
  sanitizeDependencyIds,
  taskDependencyRefBelongsTo,
} from "@/domain/task-scheduling";
import {
  addStepToolToSupabase,
  canPatchTaskFromRealtimePayload,
  createPlannerSupabaseClient,
  deleteToolLibraryFromSupabase,
  deleteScenario,
  duplicateScenario,
  loadPlannerStateFromSupabase,
  loadScenariosForProduct,
  loadTaskFromSupabase,
  renameScenario,
  updateScenarioTarget,
  loadToolLibraryFromSupabase,
  moveManufacturingStepToTaskInSupabase,
  removeStepToolFromSupabase,
  upsertToolLibraryMetadata,
  savePlannerShellToSupabase,
  saveProcedureTaskUpdateToSupabase,
  saveTasksToSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  subscribePlannerStateChanges,
  taskIdFromRealtimePayload,
  uploadStepPhotoAttachment,
  type SaveState,
  type ToolLibraryItem,
} from "@/domain/supabase-planner";
import type {
  DemandPeriod,
  DocumentTypeCode,
  ManufacturingStep,
  ManufacturingComponent,
  PartReference,
  PlannerProjectContext,
  PlannerState,
  Product,
  ProductStatus,
  ScenarioSummary,
  Station,
  Task,
  Zone,
} from "@/domain/types";
import { ClearableNumberInput } from "./clearable-number-input";
import { GanttTimeline } from "./gantt-timeline";
import { ScenarioTabs } from "./scenario-tabs";
import { ThemedFeedbackLayer, type FeedbackConfirm, type FeedbackToast } from "./themed-feedback";
import { WORKER_ICON_LETTERS, WorkerIcon } from "./worker-icon";
import { AppLoadingShell } from "./app-flow-panels";
import { NothingStatus } from "./nothing-ui";
import { PlannerDashboardPanel, buildPlannerChromeContext } from "./planner-dashboard-panel";
import { SidebarWorkspacePanel } from "./sidebar-workspace-panel";
import { SidebarUserPanel } from "./sidebar-user-panel";
import { ProcedureStepToolTable } from "./procedure-step-tool-table";
import { StepPhotoViewer } from "./step-photo-viewer";
import { ProjectCatalogSetupPanel } from "./project-catalog-setup-panel";
import { AppSettingsPanel, settingsSections, type SettingsSection } from "./app-settings-panel";
import { ThemedSelect } from "./themed-select";
import { useTheme } from "./theme-provider";

type ProductNumberField =
  | "targetManHours"
  | "demandQuantity"
  | "grossAvailableMinutes"
  | "breakMinutes"
  | "lunchMinutes"
  | "meetingMinutes"
  | "plannedDowntimeMinutes"
  | "workDaysPerWeek"
  | "workWeeksPerMonth"
  | "manualTaktMinutes";

type ProductTextField = "name" | "productCode" | "sku" | "revision" | "ownerName" | "status" | "demandPeriod";

type ProcedureDraftFieldName = "instruction" | "name";
type ProcedureDraftSaveStatus = "idle" | "dirty" | "saving" | "saved" | "retrying" | "error" | "conflict";

type ProcedureDraftField = {
  taskId: string;
  stepId: string;
  fieldName: ProcedureDraftFieldName;
  value: string;
  baseValue: string;
  baseVersion?: number;
  baseUpdatedAt?: string;
  dirty: boolean;
  active: boolean;
  localEditSeq: number;
  lastEditedAt: number;
  saveStatus: ProcedureDraftSaveStatus;
  latestSaveId?: string;
  savingSeq?: number;
  error?: string;
};

type ProcedureDraftMap = Record<string, ProcedureDraftField>;

type ProcedureTaskSaveQueueState =
  | "idle"
  | "dirty-pending"
  | "saving"
  | "saving-with-newer-pending"
  | "retrying"
  | "error"
  | "conflict";

type ProcedureTaskSaveQueue = {
  state: ProcedureTaskSaveQueueState;
  inFlight: boolean;
  inFlightSaveId?: string;
  inFlightSeq?: number;
  pending: boolean;
  pendingTaskSnapshot?: Task;
  pendingTasksSnapshot?: Task[];
  pendingDraftSnapshot?: ProcedureDraftMap;
  latestSeq: number;
  lastError?: unknown;
};

type DeferredProcedureServerUpdate = {
  serverTask: Task;
  serverVersion?: number;
  serverUpdatedAt?: string;
  receivedAt: number;
  source: "realtime" | "refreshTasks" | "refreshPlanner" | "saveCompletion";
};

type StepPartReferenceEditorProps = {
  task: Task;
  step: ManufacturingStep;
  partReferences: PartReference[];
  draftValue: string;
  compact?: boolean;
  masterBom?: MasterBom;
  onDraftChange: (value: string) => void;
  onAddDraft: () => void;
  onAddFromBom: (entry: BomPartSelection) => void;
  onLinkExisting: (partReferenceId: string) => void;
  onRemove: (partReferenceId: string) => void;
};

type StepPhotoAttachmentEditorProps = {
  step: ManufacturingStep;
  photos: StepPhotoAttachment[];
  compact?: boolean;
  isUploading?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRequestRemove: (photo: StepPhotoAttachment) => void;
  onRemove: (photoId: string) => void;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
};

const demandPeriodOptions: Array<{ value: DemandPeriod; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

const productStatusOptions: Array<{ value: ProductStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "approved", label: "Approved" },
  { value: "released", label: "Released" },
  { value: "obsolete", label: "Obsolete" },
];

const plannerModules = [
  { id: "dashboard", label: "Dashboard", icon: Factory },
  { id: "setup", label: "Setup", icon: ClipboardList },
  { id: "gantt", label: "Gantt", icon: GitBranch },
  { id: "procedure", label: "Procedure", icon: ListChecks },
  { id: "work-instructions", label: "Work Instructions", icon: BookOpen },
  { id: "balance", label: "Balance", icon: BarChart3 },
  { id: "reports", label: "Reports", icon: FileText },
];

const setupSections = [
  { id: "product", label: "Product", icon: Package },
  { id: "nomenclature", label: "Document Control", icon: Tags },
  { id: "procedure-checks", label: "Procedure Checks", icon: ListChecks },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "bom", label: "BOM", icon: Boxes },
] as const;

type SetupSection = (typeof setupSections)[number]["id"];

const comingSoonModuleIds = new Set(["balance", "reports"]);

const SIMULATION_ENABLED = false;

const playbackSpeeds = [
  { label: "1m/s", value: 1 },
  { label: "5m/s", value: 5 },
  { label: "15m/s", value: 15 },
  { label: "1h/s", value: 60 },
];

const PROCEDURE_SAVE_DEBOUNCE_MS = 750;
const PROCEDURE_SAVE_DEBUG = false;
const PROCEDURE_DRAFT_STORAGE_KEY = "buildlogic-line-planner-procedure-draft-v1";
const WORKSPACE_SNAPSHOT_STORAGE_PREFIX = "buildlogic-line-planner-workspace-v1";
const PROJECT_SWITCH_EVENT = "pulse:project-switch-start";
const PROJECT_SWITCH_SESSION_KEY = "pulse:project-switch-started-at";
const PROJECT_SWITCH_TARGET_SESSION_KEY = "pulse:project-switch-target-v1";
const PROJECT_SWITCH_SESSION_MAX_AGE_MS = 15_000;
const PROJECT_SWITCH_SKELETON_MIN_MS = 650;

type ProjectSwitchTarget = {
  projectId: string;
  title: string;
};

type WorkspaceSnapshot = {
  activeModule: string;
  selectedTaskId?: string;
  selectedStationId?: string;
  activeZoneId?: string;
  detailDrawerCollapsed: boolean;
  sidebarCollapsed?: boolean;
  savedAt: string;
};

type LegacyProcedureDraftSnapshot = {
  taskId: string;
  task: Task;
  savedAt: string;
};

type ProcedureFieldDraftSnapshot = {
  version: 2;
  fields: ProcedureDraftField[];
  savedAt: string;
};

type ProcedureDraftSnapshot = LegacyProcedureDraftSnapshot | ProcedureFieldDraftSnapshot;

function makeProcedureDraftKey(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) {
  return `${taskId}:${stepId}:${fieldName}`;
}

function getProcedureStepFieldValue(step: ManufacturingStep | undefined, fieldName: ProcedureDraftFieldName) {
  if (!step) {
    return "";
  }

  return fieldName === "name" ? step.name ?? "" : step.instruction ?? "";
}

function procedureDraftLog(event: string, detail: Partial<ProcedureDraftField> & {
  saveId?: string;
  saveSeq?: number;
  serverVersion?: number;
  serverUpdatedAt?: string;
  source?: string;
} = {}) {
  if (!PROCEDURE_SAVE_DEBUG) {
    return;
  }

  console.debug("[procedure-save]", event, detail);
}

function recentProjectSwitchStartedAt() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const startedAt = Number(window.sessionStorage.getItem(PROJECT_SWITCH_SESSION_KEY));
    return Number.isFinite(startedAt) && Date.now() - startedAt < PROJECT_SWITCH_SESSION_MAX_AGE_MS
      ? startedAt
      : undefined;
  } catch {
    return undefined;
  }
}

function hasRecentProjectSwitchSession() {
  return recentProjectSwitchStartedAt() !== undefined;
}

function readProjectSwitchTarget(): ProjectSwitchTarget | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(PROJECT_SWITCH_TARGET_SESSION_KEY);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<ProjectSwitchTarget>;
    return typeof parsed.projectId === "string" && typeof parsed.title === "string"
      ? { projectId: parsed.projectId, title: parsed.title }
      : undefined;
  } catch {
    return undefined;
  }
}

function buildProjectSwitchTargetContext(target?: ProjectSwitchTarget): ReturnType<typeof buildPlannerChromeContext> | undefined {
  if (!target?.title) {
    return undefined;
  }

  return {
    title: target.title,
    status: "",
    statusClass: undefined,
    detail: undefined,
  };
}

function clearProjectSwitchSession() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(PROJECT_SWITCH_SESSION_KEY);
    window.sessionStorage.removeItem(PROJECT_SWITCH_TARGET_SESSION_KEY);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

function workspaceSnapshotStorageKey(projectId?: string) {
  return `${WORKSPACE_SNAPSHOT_STORAGE_PREFIX}:${projectId || "default"}`;
}

function isKnownModule(moduleId: unknown): moduleId is string {
  return typeof moduleId === "string" && [...plannerModules, { id: "settings" }].some((module) => module.id === moduleId);
}

function readWorkspaceSnapshot(projectId?: string): WorkspaceSnapshot | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawSnapshot = window.localStorage.getItem(workspaceSnapshotStorageKey(projectId));
    if (!rawSnapshot) {
      return undefined;
    }

    const parsed = JSON.parse(rawSnapshot) as Partial<WorkspaceSnapshot>;
    if (!isKnownModule(parsed.activeModule)) {
      return undefined;
    }

    return {
      activeModule: parsed.activeModule,
      selectedTaskId: typeof parsed.selectedTaskId === "string" ? parsed.selectedTaskId : undefined,
      selectedStationId: typeof parsed.selectedStationId === "string" ? parsed.selectedStationId : undefined,
      activeZoneId: typeof parsed.activeZoneId === "string" ? parsed.activeZoneId : undefined,
      detailDrawerCollapsed:
        typeof parsed.detailDrawerCollapsed === "boolean" ? parsed.detailDrawerCollapsed : true,
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function writeWorkspaceSnapshot(projectId: string | undefined, snapshot: WorkspaceSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(workspaceSnapshotStorageKey(projectId), JSON.stringify(snapshot));
  } catch {
    // Losing the view snapshot should not block planner editing.
  }
}

function readProcedureDraftSnapshot() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawDraft = window.localStorage.getItem(PROCEDURE_DRAFT_STORAGE_KEY);
    if (!rawDraft) {
      return undefined;
    }

    const parsed = JSON.parse(rawDraft) as Partial<LegacyProcedureDraftSnapshot> & Partial<ProcedureFieldDraftSnapshot>;
    if (parsed.version === 2) {
      const fields = Array.isArray(parsed.fields)
        ? parsed.fields.filter((field): field is ProcedureDraftField =>
            typeof field?.taskId === "string" &&
            typeof field.stepId === "string" &&
            (field.fieldName === "instruction" || field.fieldName === "name") &&
            typeof field.value === "string",
          )
        : [];

      return {
        version: 2,
        fields: fields.map((field) => ({
          ...field,
          baseValue: typeof field.baseValue === "string" ? field.baseValue : "",
          dirty: field.dirty !== false,
          active: false,
          localEditSeq: Number.isFinite(field.localEditSeq) ? field.localEditSeq : 1,
          lastEditedAt: Number.isFinite(field.lastEditedAt) ? field.lastEditedAt : Date.now(),
          saveStatus: field.dirty === false ? "saved" : "dirty",
        })),
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
      } satisfies ProcedureFieldDraftSnapshot;
    }

    if (!parsed.taskId || !("task" in parsed) || !parsed.task || typeof parsed.task !== "object") {
      return undefined;
    }

    return parsed as LegacyProcedureDraftSnapshot;
  } catch {
    return undefined;
  }
}

function writeProcedureDraftSnapshot(task: Task) {
  if (typeof window === "undefined") {
    return;
  }

  const draft: ProcedureDraftSnapshot = {
    taskId: task.id,
    task,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(PROCEDURE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The in-memory editor state remains the immediate source of truth if local storage is unavailable.
  }
}

function writeProcedureFieldDraftSnapshot(drafts: ProcedureDraftMap) {
  if (typeof window === "undefined") {
    return;
  }

  const fields = Object.values(drafts).filter((field) => field.dirty);
  if (fields.length === 0) {
    clearProcedureDraftSnapshot();
    return;
  }

  const draft: ProcedureFieldDraftSnapshot = {
    version: 2,
    fields,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(PROCEDURE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The in-memory editor state remains the immediate source of truth if local storage is unavailable.
  }
}

function clearProcedureDraftSnapshot(taskId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (taskId) {
    const currentDraft = readProcedureDraftSnapshot();
    if (currentDraft && "version" in currentDraft && currentDraft.version === 2) {
      const remainingFields = currentDraft.fields.filter((field) => field.taskId !== taskId);
      if (remainingFields.length > 0) {
        try {
          window.localStorage.setItem(
            PROCEDURE_DRAFT_STORAGE_KEY,
            JSON.stringify({ version: 2, fields: remainingFields, savedAt: new Date().toISOString() }),
          );
        } catch {
          // Ignore local storage cleanup failures.
        }
        return;
      }
    } else if (currentDraft && "taskId" in currentDraft && currentDraft.taskId !== taskId) {
      return;
    }
  }

  try {
    window.localStorage.removeItem(PROCEDURE_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore local storage cleanup failures.
  }
}

function applyProcedureVersionSnapshot(task: Task, versionSource: Task) {
  const sourceStepById = new Map((versionSource.manufacturingSteps ?? []).map((step) => [step.id, step]));

  return {
    ...task,
    version: versionSource.version,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
      ...step,
      version: sourceStepById.get(step.id)?.version ?? step.version,
    })),
  };
}

function mergeProcedureDraftWithServer(serverTask: Task, draftTask: Task) {
  const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
  const draftStepIds = new Set((draftTask.manufacturingSteps ?? []).map((step) => step.id));
  const mergedSteps = [
    ...(draftTask.manufacturingSteps ?? []).map((draftStep) => {
      const serverStep = serverStepById.get(draftStep.id);
      return serverStep ? { ...serverStep, ...draftStep } : draftStep;
    }),
    ...(serverTask.manufacturingSteps ?? []).filter((step) => !draftStepIds.has(step.id)),
  ];

  return applyProcedureVersionSnapshot(
    {
      ...serverTask,
      ...draftTask,
      manufacturingSteps: mergedSteps.length > 0 ? mergedSteps : serverTask.manufacturingSteps,
    },
    serverTask,
  );
}

function applyTextareaCursor(textarea: HTMLTextAreaElement, cursorPosition: number) {
  window.requestAnimationFrame(() => {
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  });
}

function handleInstructionBulletKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  onValue: (value: string) => void,
) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  const textarea = event.currentTarget;
  const nextValue = resolveBulletEnter(textarea.value, textarea.selectionStart, textarea.selectionEnd);

  if (!nextValue) {
    return;
  }

  event.preventDefault();
  onValue(nextValue.value);
  applyTextareaCursor(textarea, nextValue.selectionStart);
}

async function requestIeSmartAllocationPlan(request: IeSmartAllocationRequest): Promise<IeSmartAllocationPlan> {
  const supabase = createPlannerSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("Sign in before running smart allocation.");
  }

  const response = await fetch("/api/smart-allocation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Smart allocation agent failed.");
  }

  if (!payload.plan) {
    throw new Error("Smart allocation agent did not return a plan.");
  }

  return payload.plan as IeSmartAllocationPlan;
}


function StatusPill({ status }: { status: string }) {
  const tone =
    status === "green" || status === "released" || status === "complete"
      ? "border-accent/20 bg-accent/10 text-accent"
      : status === "yellow" || status === "review" || status === "ready" || status === "in_progress"
        ? "border-warn/30 bg-warn-muted/20 text-warn-strong"
        : status === "red" || status === "blocked" || status === "qc_hold" || status === "rework"
          ? "border-danger/25 bg-danger-muted/10 text-danger"
          : "border-line bg-surface-sunken text-steel";

  return (
    <span className={`ui-chip ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

function NumericField({
  label,
  value,
  suffix,
  onChange,
  precision,
  normalize,
  readOnly = false,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  onChange: (value: number) => void;
  precision?: number;
  normalize?: (value: number) => number;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="ui-field-label">{label}</span>
      <div className={`ui-field-shell ${readOnly ? "ui-field-shell-readonly" : ""}`}>
        <ClearableNumberInput
          className={`number-input ui-field-control ${readOnly ? "ui-field-control-readonly" : ""}`}
          value={value}
          min={0}
          fallbackValue={value ?? 0}
          precision={precision}
          normalize={normalize}
          readOnly={readOnly}
          aria-readonly={readOnly}
          onValueChange={(nextValue) => {
            if (!readOnly) {
              onChange(nextValue);
            }
          }}
        />
        {suffix ? <span className="ui-field-suffix">{suffix}</span> : null}
      </div>
    </label>
  );
}

function StepPhotoAttachmentEditor({
  step,
  photos,
  compact = false,
  isUploading = false,
  onFilesSelected,
  onRequestRemove,
  onRemove,
  onUpdatePhoto,
}: StepPhotoAttachmentEditorProps) {
  const thumbnailClass = compact ? "h-24 w-28" : "h-36 w-48";
  const [previewPhoto, setPreviewPhoto] = useState<StepPhotoAttachment | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="ui-field-label mb-0 flex items-center gap-1">
          Photos
          {photos.length > 0 ? <span className="text-steel/70">({photos.length})</span> : null}
        </div>
        <label
          className={`ui-btn-ghost cursor-pointer ${compact ? "h-8 gap-1.5 px-2" : "h-10 gap-2"} ${
            isUploading ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <ImageIcon size={compact ? 14 : 16} />
          {isUploading ? "Uploading" : "Upload"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={isUploading}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length > 0) {
                onFilesSelected(files);
              }
            }}
          />
        </label>
      </div>

      {photos.length > 0 ? (
        <div className="step-photo-strip flex max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-2">
          {photos.map((photo) => (
            <div key={photo.id} className={compact ? "w-28 shrink-0" : "w-48 shrink-0"}>
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(photo)}
                  className="block rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label={`Open step ${step.sequence} photo ${photo.name}`}
                  title="Open photo"
                >
                  <img
                    src={photo.thumbnailUrl ?? photo.dataUrl}
                    alt={`Step ${step.sequence} photo`}
                    loading="lazy"
                    decoding="async"
                    className={`${thumbnailClass} rounded border border-line object-cover transition group-hover:border-accent`}
                  />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestRemove(photo);
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-surface/90 text-steel opacity-0 transition hover:text-danger focus:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={`Remove photo from step ${step.sequence}`}
                  title="Remove photo"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-dashed border-line pt-2 text-xs font-semibold text-steel">
          No photos attached to this step yet.
        </div>
      )}
      {previewPhoto ? (
        <StepPhotoViewer
          stepSequence={step.sequence}
          photo={photos.find((candidate) => candidate.id === previewPhoto.id) ?? previewPhoto}
          photos={photos}
          onClose={() => setPreviewPhoto(null)}
          onPhotoChange={setPreviewPhoto}
          onUpdatePhoto={onUpdatePhoto}
        />
      ) : null}
    </div>
  );
}

function StepPartReferenceEditor({
  task,
  step,
  partReferences,
  draftValue,
  compact = false,
  masterBom,
  onDraftChange,
  onAddDraft,
  onAddFromBom,
  onLinkExisting,
  onRemove,
}: StepPartReferenceEditorProps) {
  const hasMasterBom = Boolean(masterBom && masterBom.rows.length > 0);
  const linkedPartIds = new Set(getStepPartReferenceIds(task, step.id));
  const linkedParts = getStepPartReferences(task, step.id);
  const availableParts = partReferences.filter((part) => part.partNumber.trim() && !linkedPartIds.has(part.id));
  const gridClass = "grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-1";
  const compactInputClass =
    "h-7 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-accent";
  const compactAddClass = "h-7 text-[10px] ui-mono-label text-ink-secondary hover:text-accent";

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className={gridClass}>
          <span className="ui-field-label mb-0">Parts</span>
          <input
            className={compactInputClass}
            value={draftValue}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddDraft();
              }
            }}
            placeholder="Part number"
          />
          <button type="button" onClick={onAddDraft} className={compactAddClass}>
            Add
          </button>
        </div>

        {hasMasterBom && masterBom ? (
          <div className="pl-[42px]">
            <BomPartSearch masterBom={masterBom} onSelect={onAddFromBom} compact />
          </div>
        ) : null}

        {availableParts.length > 0 ? (
          <div className="pl-[42px]">
            <ThemedSelect
              aria-label={`Link existing part to step ${step.sequence}`}
              value=""
              className="w-full"
              triggerClassName="h-9 px-2 text-xs"
              options={[
                { value: "", label: "Link existing part" },
                ...availableParts.map((part) => ({
                  value: part.id,
                  label: `${part.partNumber}${part.description ? ` - ${part.description}` : ""}`,
                })),
              ]}
              onChange={(value) => {
                if (value) {
                  onLinkExisting(value);
                }
              }}
            />
          </div>
        ) : null}

        {linkedParts.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pl-[42px]">
            {linkedParts.map((part) => (
              <span key={part.id} className="ui-chip inline-flex min-w-0 items-center gap-1 normal-case tracking-normal">
                <span className="max-w-[220px] truncate" title={part.description || part.partNumber}>
                  {part.partNumber}
                  {part.quantity ? ` x${part.quantity}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(part.id)}
                  className="text-steel/70 hover:text-danger"
                  aria-label={`Remove ${part.partNumber} from step ${step.sequence}`}
                  title={`Remove ${part.partNumber}`}
                >
                  <Trash2 size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-procedure-step-detail">
      <span className="ui-field-label mb-0 block">Parts</span>
      {hasMasterBom && masterBom ? (
        <div className="mb-2">
          <BomPartSearch masterBom={masterBom} onSelect={onAddFromBom} />
        </div>
      ) : null}
      <div className="ui-procedure-step-add-row">
        <input
          className="ui-procedure-step-inline-text"
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddDraft();
            }
          }}
          placeholder="Part number"
        />
        <button type="button" onClick={onAddDraft} className="ui-btn-ghost h-8 shrink-0 px-2 text-[10px]">
          Add
        </button>
        {availableParts.length > 0 ? (
          <ThemedSelect
            aria-label={`Link existing part to step ${step.sequence}`}
            value=""
            className="min-w-36"
            triggerClassName="h-8 rounded-none border-0 border-b bg-transparent px-0 text-xs"
            options={[
              { value: "", label: "Link existing part" },
              ...availableParts.map((part) => ({
                value: part.id,
                label: `${part.partNumber}${part.description ? ` - ${part.description}` : ""}`,
              })),
            ]}
            onChange={(value) => {
              if (value) {
                onLinkExisting(value);
              }
            }}
          />
        ) : null}
      </div>

      {linkedParts.length > 0 ? (
        <div className="ui-procedure-step-chip-list">
          {linkedParts.map((part) => (
            <span key={part.id} className="ui-procedure-tag group">
              <span className="min-w-0 truncate" title={part.description || part.partNumber}>
                {part.partNumber}
                {part.quantity ? ` x${part.quantity}` : ""}
              </span>
              <button
                type="button"
                onClick={() => onRemove(part.id)}
                className="ui-procedure-tag-remove"
                aria-label={`Remove ${part.partNumber} from step ${step.sequence}`}
                title={`Remove ${part.partNumber}`}
              >
                <Trash2 size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProcedureStepChecksEditor({
  ariaLabel,
  definitions,
  qualityCheck,
  compact = false,
  onChange,
}: {
  ariaLabel: string;
  definitions: ManufacturingStepCheckDefinition[];
  qualityCheck?: string;
  compact?: boolean;
  onChange: (qualityCheck: string) => void;
}) {
  const checkState = getManufacturingStepCheckState(qualityCheck, definitions);
  const enabledDefinitions = definitions.filter((definition) => definition.enabled);

  function commit(nextState: ManufacturingStepCheckState) {
    onChange(serializeManufacturingStepCheckState(nextState, definitions));
  }

  function toggleCheck(key: string, checked: boolean) {
    const selected = new Set(checkState.selected);
    const values = { ...checkState.values };

    if (checked) {
      selected.add(key);
    } else {
      selected.delete(key);
    }

    commit({ selected, values });
  }

  function updateCheckValue(definition: ManufacturingStepCheckDefinition, patch: Partial<{ value: number; unit: string }>) {
    const selected = new Set(checkState.selected);
    selected.add(definition.key);
    const currentValue = checkState.values[definition.key] ?? {};
    commit({
      selected,
      values: {
        ...checkState.values,
        [definition.key]: {
          ...currentValue,
          ...patch,
        },
      },
    });
  }

  if (enabledDefinitions.length === 0) {
    return <div className="text-xs text-steel">No checks configured for this workspace.</div>;
  }

  return (
    <div
      className={compact ? "grid grid-cols-2 gap-1" : "ui-procedure-step-checks"}
      role="group"
      aria-label={ariaLabel}
    >
      {enabledDefinitions.map((definition) => {
        const checked = checkState.selected.has(definition.key);
        const checkValue = checkState.values[definition.key] ?? {};

        if (definition.inputType === "number") {
          const unitOptions = definition.unitOptions?.length ? definition.unitOptions : ["Nm", "ft-lb"];
          const activeUnit = checkValue.unit ?? definition.defaultUnit ?? unitOptions[0];

          return (
            <div
              key={definition.key}
              className={`ui-procedure-step-check ${checked ? "ui-procedure-step-check-active" : ""} ${
                compact ? "min-h-8 flex-wrap justify-start gap-1 px-1.5 py-1" : "gap-2"
              }`}
            >
              <label className="inline-flex min-w-0 items-center gap-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleCheck(definition.key, event.target.checked)}
                />
                <span className="truncate">{definition.label}</span>
              </label>
              {checked ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <ClearableNumberInput
                    aria-label={`${definition.label} value`}
                    className="number-input h-7 w-16 rounded border border-line bg-surface px-1.5 text-right text-xs outline-none"
                    value={checkValue.value ?? 0}
                    min={0}
                    fallbackValue={checkValue.value ?? 0}
                    precision={2}
                    onValueChange={(value) => updateCheckValue(definition, { value })}
                  />
                  <ThemedSelect
                    aria-label={`${definition.label} unit`}
                    className="w-20"
                    triggerClassName="h-7 px-1.5 text-[10px]"
                    value={activeUnit}
                    options={unitOptions.map((unit) => ({ value: unit, label: unit }))}
                    onChange={(unit) => updateCheckValue(definition, { unit })}
                  />
                </span>
              ) : null}
            </div>
          );
        }

        return (
          <label
            key={definition.key}
            className={`ui-procedure-step-check ${checked ? "ui-procedure-step-check-active" : ""}`}
            title={definition.label}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => toggleCheck(definition.key, event.target.checked)}
            />
            <span className="truncate">{definition.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "ui-metric-card-good"
      : tone === "warn"
        ? "ui-metric-card-warn"
        : tone === "bad"
          ? "ui-metric-card-bad"
          : "";

  return (
    <div className={`ui-metric-card ${toneClass}`}>
      <div className="ui-metric-card-label">{label}</div>
      <div className="ui-metric-card-value">{value}</div>
      {meta ? <div className="ui-metric-card-meta">{meta}</div> : null}
    </div>
  );
}

function TopNav({
  onExport,
  sidebarCollapsed,
  onToggleSidebar,
  context,
  chromeStatus,
}: {
  onExport: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  context?: ReturnType<typeof buildPlannerChromeContext>;
  chromeStatus?: { message: string; error?: boolean } | null;
}) {
  const { theme, toggleTheme } = useTheme();

  if (context) {
    return (
      <header className="ui-chrome ui-chrome-planner z-40 h-12 shrink-0">
        <div className="ui-chrome-planner-brand">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="ui-btn-ghost hidden h-8 w-8 shrink-0 items-center justify-center px-0 lg:inline-flex"
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!sidebarCollapsed}
          >
            <ChevronLeft
              size={14}
              strokeWidth={1.75}
              className={`transition-transform duration-300 ease-ui ${sidebarCollapsed ? "rotate-180" : ""}`}
            />
          </button>
          <div className="ui-brand-compact shrink-0">Pulse</div>
        </div>

        <div className="ui-chrome-planner-context min-w-0">
          <span className="ui-chrome-context-title truncate">{context.title}</span>
          <span className="ui-chrome-context-meta hidden min-w-0 truncate sm:inline">
            <span className={context.statusClass}>{context.status}</span>
            {context.detail ? (
              <>
                <span aria-hidden> · </span>
                <span>{context.detail}</span>
              </>
            ) : null}
          </span>
        </div>

        <div className="ui-chrome-planner-actions">
          {chromeStatus ? (
            <div className="ui-chrome-status max-w-[min(28rem,42vw)]">
              <NothingStatus error={chromeStatus.error}>{chromeStatus.message}</NothingStatus>
            </div>
          ) : null}
          <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button type="button" onClick={onExport} className="ui-btn-ghost h-10 gap-2">
            <Download size={16} />
            Export
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between gap-3 px-3 sm:px-4 lg:px-0">
      <div className="ui-chrome-brand flex min-w-0 items-center gap-1 sm:gap-2 lg:gap-0.5 lg:px-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="ui-btn-ghost hidden h-8 w-8 shrink-0 items-center justify-center px-0 lg:inline-flex"
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-expanded={!sidebarCollapsed}
        >
          <ChevronLeft
            size={14}
            strokeWidth={1.75}
            className={`transition-transform duration-300 ease-ui ${sidebarCollapsed ? "rotate-180" : ""}`}
          />
        </button>
        <div className="ui-brand-compact shrink-0">Pulse</div>
      </div>

      <div className="flex min-w-0 flex-1 lg:hidden" />

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 lg:pr-4">
        {chromeStatus ? (
          <div className="ui-chrome-status max-w-[min(24rem,38vw)]">
            <NothingStatus error={chromeStatus.error}>{chromeStatus.message}</NothingStatus>
          </div>
        ) : null}
        <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" onClick={onExport} className="ui-btn-ghost h-10 gap-2">
          <Download size={16} />
          Export
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  activeModule,
  settingsSection,
  setupSection,
  onChange,
  onSetupSectionChange,
  onOpenSettings,
  project,
}: {
  activeModule: string;
  settingsSection: SettingsSection;
  setupSection: SetupSection;
  onChange: (moduleId: string) => void;
  onSetupSectionChange: (section: SetupSection) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  project?: PlannerProjectContext;
}) {
  const isSettingsModule = activeModule === "settings";
  const isSetupModule = activeModule === "setup";

  return (
    <aside className="ui-nav-sidebar">
      <SidebarWorkspacePanel activeProject={project} />

      <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-2">
        {isSettingsModule ? (
          <>
            <button
              type="button"
              onClick={() => onChange("dashboard")}
              className="ui-settings-back"
              title="Back to planner"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
              Back to planner
            </button>
            <div className="space-y-0.5">
              {settingsSections.map((item) => {
                const Icon = item.icon;
                const active = settingsSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => onOpenSettings(item.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : isSetupModule ? (
          <>
            <button
              type="button"
              onClick={() => onChange("dashboard")}
              className="ui-settings-back"
              title="Back to planner"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
              Back to planner
            </button>
            <div className="ui-nav-section">Setup</div>
            <div className="space-y-0.5">
              {setupSections.map((item) => {
                const Icon = item.icon;
                const active = setupSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => onSetupSectionChange(item.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="ui-nav-section">Planner</div>
            <div className="space-y-0.5">
              {plannerModules.map((module) => {
                const Icon = module.icon;
                const active = activeModule === module.id;
                return (
                  <button
                    key={module.id}
                    type="button"
                    title={module.label}
                    onClick={() => onChange(module.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{module.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="mt-auto space-y-2 px-2 py-2">
        {/* Org-level tools — cross-department, not scoped to this project/workspace. */}
        <div>
          <div className="ui-nav-section">Org</div>
          <Link href="/sops" className="ui-nav-item ui-nav-item-idle" title="SOPs">
            <FileText size={15} strokeWidth={1.75} />
            <span>SOPs</span>
          </Link>
        </div>

        {!isSettingsModule ? (
          <button
            type="button"
            onClick={() => onOpenSettings("general")}
            className="ui-nav-footer-item"
          >
            <Settings size={15} strokeWidth={1.75} />
            Settings
          </button>
        ) : (
          <SidebarUserPanel />
        )}
      </div>
    </aside>
  );
}

function WorkspaceSwitchSkeleton() {
  const metricWidths = ["w-28", "w-24", "w-32", "w-24", "w-28"];
  const lineClass = "ui-skeleton-line";

  return (
    <main className="ui-workspace-content p-0 pb-6">
      <div className="ui-planner-dashboard">
        <section className="border-b border-line px-6 py-4">
          <div className={`${lineClass} h-3 w-40`} />
          <div className={`${lineClass} mt-3 h-2 w-72`} />
        </section>

        <section className="grid grid-cols-2 gap-6 border-b border-line px-6 py-4 md:grid-cols-5">
          {metricWidths.map((width, index) => (
            <div key={index} className="space-y-2">
              <div className={`${lineClass} h-2 ${width}`} />
              <div className={`${lineClass} h-5 w-20`} />
              <div className={`${lineClass} h-2 w-28`} />
            </div>
          ))}
        </section>

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="px-6 py-6">
            <div className={`${lineClass} h-4 w-32`} />
            <div className={`${lineClass} mt-2 h-2 w-48`} />

            <div className="mt-8 grid grid-cols-4 gap-5">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="space-y-2">
                  <div className={`${lineClass} h-2 w-24`} />
                  <div className={`${lineClass} h-5 w-12`} />
                  <div className={`${lineClass} h-2 w-28`} />
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="border-t border-line pt-4">
                  <div className={`${lineClass} h-3 w-48`} />
                  <div className={`${lineClass} mt-2 h-2 w-80 max-w-full`} />
                  <div className={`${lineClass} mt-2 h-2 w-[28rem] max-w-full`} />
                </div>
              ))}
            </div>
          </div>

          <aside className="border-l border-line px-5 py-6">
            <div className={`${lineClass} h-4 w-28`} />
            <div className="mt-6 space-y-4">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="border-b border-line pb-3">
                  <div className={`${lineClass} h-2 w-24`} />
                  <div className={`${lineClass} mt-2 h-3 w-32`} />
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function ScrollDownHint({ className = "" }: { className?: string }) {
  const hintRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollContainer = hintRef.current?.parentElement;

    if (!scrollContainer) {
      return;
    }

    const scrollElement = scrollContainer;

    function updateHintVisibility() {
      const canScrollDown = scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop > 24;
      const isNearTop = scrollElement.scrollTop < 16;

      setVisible(canScrollDown && isNearTop);
    }

    updateHintVisibility();
    scrollElement.addEventListener("scroll", updateHintVisibility, { passive: true });
    window.addEventListener("resize", updateHintVisibility);

    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateHintVisibility);
    resizeObserver?.observe(scrollElement);

    const mutationObserver = new MutationObserver(updateHintVisibility);
    mutationObserver.observe(scrollElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      scrollElement.removeEventListener("scroll", updateHintVisibility);
      window.removeEventListener("resize", updateHintVisibility);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={hintRef}
      className={`pointer-events-none sticky bottom-3 z-20 flex justify-center transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      } ${className}`}
      aria-hidden="true"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-secondary">
        <ChevronDown size={15} strokeWidth={2.4} />
      </div>
    </div>
  );
}

type ProcedureSectionKey = "photos" | "checks" | "tools" | "parts";

// Sections that can be temporarily hidden on every step to declutter the page
// while authoring instructions. The step header + instruction are never hidden.
const PROCEDURE_STEP_SECTIONS: { key: ProcedureSectionKey; label: string; Icon: typeof Wrench }[] = [
  { key: "photos", label: "Photos", Icon: ImageIcon },
  { key: "checks", label: "Checks", Icon: ListChecks },
  { key: "tools", label: "Tools", Icon: Wrench },
  { key: "parts", label: "Parts", Icon: Package },
];

// The hidden-section filter is a personal authoring preference, kept in
// localStorage so it persists across refreshes for this user on this device.
const PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY = "pulse:procedure-hidden-sections";

function readHiddenStepSections(): Set<ProcedureSectionKey> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw) as unknown;
    const validKeys = new Set(PROCEDURE_STEP_SECTIONS.map((section) => section.key));
    const keys = Array.isArray(parsed)
      ? parsed.filter(
          (value): value is ProcedureSectionKey =>
            typeof value === "string" && validKeys.has(value as ProcedureSectionKey),
        )
      : [];
    return new Set(keys);
  } catch {
    return new Set();
  }
}

function writeHiddenStepSections(sections: Set<ProcedureSectionKey>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY, JSON.stringify([...sections]));
  } catch {
    // Ignore storage failures (private browsing, quota).
  }
}

function ProcedureWorkspace({
  product,
  tasks,
  zones,
  selectedTask,
  focusedStepId,
  onSelectTask,
  onConfirmAction,
  onStepDeleted,
  onUpdateTask,
  getProcedureFieldValue,
  onProcedureFieldFocus,
  onProcedureFieldBlur,
  onProcedureFieldChange,
  onMoveStepToTask,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onAddStepTool,
  onRemoveStepTool,
  projectToolRegistry,
}: {
  product: Product;
  tasks: Task[];
  zones: Zone[];
  selectedTask?: Task;
  focusedStepId?: string;
  onSelectTask: (taskId: string) => void;
  onConfirmAction: (message: FeedbackConfirm) => void;
  onStepDeleted: (taskSnapshot: Task, step: ManufacturingStep) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  getProcedureFieldValue: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) => string;
  onProcedureFieldFocus: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) => void;
  onProcedureFieldBlur: (taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) => void;
  onProcedureFieldChange: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    value: string,
  ) => void;
  onMoveStepToTask: (sourceTaskId: string, targetTaskId: string, stepId: string) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
  projectToolRegistry: Map<string, ProjectToolDefinition>;
}) {
  const [newStepToolNames, setNewStepToolNames] = useState<Record<string, string>>({});
  const [newStepPartNumbers, setNewStepPartNumbers] = useState<Record<string, string>>({});
  const [stepPhotoUploadCounts, setStepPhotoUploadCounts] = useState<Record<string, number>>({});
  const [navigatorWidth, setNavigatorWidth] = useState(320);
  const [isResizingNavigator, setIsResizingNavigator] = useState(false);
  const navigatorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Which step sections are hidden. View-only filter; persisted per user via
  // localStorage and never touches saved project data.
  const [hiddenStepSections, setHiddenStepSections] = useState<Set<ProcedureSectionKey>>(() =>
    readHiddenStepSections(),
  );
  const [isSectionFilterOpen, setIsSectionFilterOpen] = useState(false);
  const sectionFilterRef = useRef<HTMLDivElement | null>(null);
  const showPhotos = !hiddenStepSections.has("photos");
  const showChecks = !hiddenStepSections.has("checks");
  const showTools = !hiddenStepSections.has("tools");
  const showParts = !hiddenStepSections.has("parts");
  const showStepDetails = showChecks || showTools || showParts;
  function toggleStepSection(key: ProcedureSectionKey) {
    setHiddenStepSections((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeHiddenStepSections(next);
      return next;
    });
  }

  useEffect(() => {
    if (!isSectionFilterOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (sectionFilterRef.current && !sectionFilterRef.current.contains(event.target as Node)) {
        setIsSectionFilterOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSectionFilterOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSectionFilterOpen]);
  const stepCheckDefinitions = getManufacturingStepCheckDefinitions(product.customFields);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; color: string; sequence: number; tasks: Task[] }>();

    [...tasks]
      .sort((left, right) => Number.parseFloat(left.wbs) - Number.parseFloat(right.wbs))
      .forEach((task) => {
        const zone = task.zoneId ? zoneById.get(task.zoneId) : undefined;
        const groupId = zone?.id ?? "zone-unzoned";
        const group = groups.get(groupId) ?? {
          id: groupId,
          name: zone?.name || "Unzoned",
          color: zone?.color ?? "#52606d",
          sequence: zone?.sequence ?? Number.MAX_SAFE_INTEGER,
          tasks: [],
        };

        group.tasks.push(task);
        groups.set(groupId, group);
      });

    return [...groups.values()].sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));
  }, [tasks, zoneById]);

  const task = selectedTask;
  const manufacturingSteps = useMemo(
    () => [...(task?.manufacturingSteps ?? [])].sort((left, right) => left.sequence - right.sequence),
    [task?.manufacturingSteps],
  );
  const toolLibrary = useMemo(() => buildStepToolLibrary(tasks), [tasks]);
  const moveTargetTasks = useMemo(
    () => tasks.filter((candidate) => candidate.rowType === "task" && candidate.id !== task?.id),
    [task?.id, tasks],
  );
  const partReferences = task?.partReferences ?? [];
  const masterBom = useMemo(() => getMasterBom(product.customFields), [product.customFields]);
  const manufacturingStepDurationMinutes = manufacturingSteps.reduce(
    (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
    0,
  );
  const currentManHours = task ? calculateTaskManHours({ ...task, plannedDurationMinutes: task.plannedDurationMinutes }) : 0;
  const stepDerivedManHours = task
    ? calculateTaskManHours({ ...task, plannedDurationMinutes: manufacturingStepDurationMinutes })
    : 0;
  const procedureGridStyle = {
    width: navigatorWidth,
  } as CSSProperties;

  useEffect(() => {
    if (!focusedStepId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-step-name-id="${focusedStepId}"]`);
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
      input?.focus();
      input?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [focusedStepId, task?.id]);

  useEffect(() => {
    if (!isResizingNavigator) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function clampNavigatorWidth(width: number) {
      return Math.min(Math.max(width, 260), Math.min(560, window.innerWidth - 760));
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = navigatorResizeRef.current;
      if (!resizeStart) {
        return;
      }

      setNavigatorWidth(clampNavigatorWidth(resizeStart.startWidth + event.clientX - resizeStart.startX));
    }

    function stopResize() {
      navigatorResizeRef.current = null;
      setIsResizingNavigator(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [isResizingNavigator]);

  function startNavigatorResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    navigatorResizeRef.current = {
      startX: event.clientX,
      startWidth: navigatorWidth,
    };
    setIsResizingNavigator(true);
  }

  function patchManufacturingSteps(nextSteps: ManufacturingStep[]) {
    if (!task) {
      return;
    }

    const normalizedSteps = nextSteps.map((step, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = normalizedSteps.reduce(
      (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
      0,
    );

    onUpdateTask(task.id, {
      manufacturingSteps: normalizedSteps,
      plannedDurationMinutes,
    });
  }

  function updateManufacturingStep(stepId: string, patch: Partial<ManufacturingStep>) {
    patchManufacturingSteps(manufacturingSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
  }

  function moveManufacturingStep(stepId: string, sequence: number) {
    const targetIndex = Math.min(Math.max(Math.round(sequence) - 1, 0), Math.max(manufacturingSteps.length - 1, 0));
    const currentIndex = manufacturingSteps.findIndex((step) => step.id === stepId);

    if (currentIndex < 0) {
      return;
    }

    const nextSteps = [...manufacturingSteps];
    const [step] = nextSteps.splice(currentIndex, 1);
    nextSteps.splice(targetIndex, 0, step);
    patchManufacturingSteps(nextSteps);
  }

  function addManufacturingStep() {
    if (!task) {
      return;
    }

    patchManufacturingSteps([
      ...manufacturingSteps,
      {
        id: `step-${task.id}-${Date.now()}`,
        sequence: manufacturingSteps.length + 1,
        instruction: "",
        durationMinutes: 0,
        qualityCheck: "",
      },
    ]);
  }

  function removeManufacturingStep(stepId: string) {
    if (!task) {
      return;
    }

    const stepToDelete = manufacturingSteps.find((step) => step.id === stepId);
    const nextSteps = manufacturingSteps
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = nextSteps.reduce(
      (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
      0,
    );
    const nextTask = removeStepScopedCustomFields(task, stepId);

    onUpdateTask(task.id, {
      manufacturingSteps: nextSteps,
      plannedDurationMinutes,
      customFields: nextTask.customFields,
    });

    if (stepToDelete) {
      onStepDeleted(task, stepToDelete);
    }
  }

  function requestRemoveManufacturingStep(stepId: string) {
    const step = manufacturingSteps.find((candidate) => candidate.id === stepId);
    if (!step) {
      return;
    }

    onConfirmAction({
      title: `Delete step ${step.sequence}?`,
      body: "This removes the manufacturing step, its tools, part links, and attached photos from this task.",
      tone: "danger",
      confirmLabel: "Delete Step",
      onConfirm: () => removeManufacturingStep(stepId),
    });
  }

  function updatePartReference(partId: string, patch: Partial<PartReference>) {
    if (!task) {
      return;
    }

    onUpdateTask(task.id, {
      partReferences: partReferences.map((part) => (part.id === partId ? { ...part, ...patch } : part)),
    });
  }

  function addPartReference() {
    if (!task) {
      return;
    }

    onUpdateTask(task.id, {
      partReferences: [
        ...partReferences,
        {
          id: `part-${task.id}-${Date.now()}`,
          partNumber: "",
          description: "",
          quantity: 1,
          disposition: "",
        },
      ],
    });
  }

  function removePartReference(partId: string) {
    if (!task) {
      return;
    }

    const taskWithoutPart = {
      ...task,
      partReferences: partReferences.filter((part) => part.id !== partId),
    };
    const nextTask = removePartReferenceFromSteps(taskWithoutPart, partId);

    onUpdateTask(task.id, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
  }

  function requestRemovePartReference(part: PartReference) {
    onConfirmAction({
      title: "Delete part reference?",
      body: "This removes the part reference from this task and unlinks it from any manufacturing steps.",
      tone: "danger",
      confirmLabel: "Delete Part",
      onConfirm: () => removePartReference(part.id),
    });
  }

  function addManufacturingStepPartReference(stepId: string) {
    if (!task) {
      return;
    }

    const nextTask = attachPartToStep(task, stepId, { partNumber: newStepPartNumbers[stepId] ?? "" }, () =>
      createAnnotationId("part"),
    );
    if (!nextTask) {
      return;
    }

    onUpdateTask(task.id, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
    setNewStepPartNumbers((current) => ({ ...current, [stepId]: "" }));
  }

  function addStepPartFromBom(stepId: string, entry: BomPartSelection) {
    if (!task) {
      return;
    }

    const nextTask = attachPartToStep(task, stepId, entry, () => createAnnotationId("part"));
    if (!nextTask) {
      return;
    }

    onUpdateTask(task.id, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
  }

  function linkExistingPartToManufacturingStep(stepId: string, partReferenceId: string) {
    if (!task) {
      return;
    }

	    const nextTask = addStepPartReference(task, stepId, partReferenceId);
	    onUpdateTask(task.id, { manufacturingSteps: nextTask.manufacturingSteps });
  }

  function removeManufacturingStepPartReference(stepId: string, partReferenceId: string) {
    if (!task) {
      return;
    }

	    const nextTask = removeStepPartReference(task, stepId, partReferenceId);
	    onUpdateTask(task.id, { manufacturingSteps: nextTask.manufacturingSteps });
  }

  function addManufacturingStepTool(stepId: string) {
    if (!task) {
      return;
    }

    const nextTool = (newStepToolNames[stepId] ?? "").trim();
    if (!nextTool) {
      return;
    }

    const nextTask = addStepTool(task, stepId, nextTool);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onAddStepTool(task.id, stepId, nextTool, getStepToolList(nextTask, stepId).length);
    setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
  }

  function addManufacturingStepToolFromLibrary(stepId: string, toolName: string) {
    if (!task || !toolName) {
      return;
    }

    const nextTask = addStepTool(task, stepId, toolName);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onAddStepTool(task.id, stepId, toolName, getStepToolList(nextTask, stepId).length);
  }

  function removeManufacturingStepTool(stepId: string, toolToRemove: string) {
    if (!task) {
      return;
    }

    const nextTask = removeStepTool(task, stepId, toolToRemove);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onRemoveStepTool(stepId, toolToRemove);
  }

  async function uploadManufacturingStepPhotos(stepId: string, files: File[]) {
    if (!task || files.length === 0) {
      return;
    }

    setStepPhotoUploadCounts((current) => ({ ...current, [stepId]: (current[stepId] ?? 0) + 1 }));

    try {
      await onUploadStepPhotos(task.id, stepId, files);
    } finally {
      setStepPhotoUploadCounts((current) => {
        const nextCount = Math.max(0, (current[stepId] ?? 0) - 1);
        const nextCounts = { ...current };

        if (nextCount > 0) {
          nextCounts[stepId] = nextCount;
        } else {
          delete nextCounts[stepId];
        }

        return nextCounts;
      });
    }
  }

  function removeManufacturingStepPhoto(stepId: string, photoId: string) {
    if (!task) {
      return;
    }

    void onRemoveStepPhoto(task.id, stepId, photoId);
  }

  function updateManufacturingStepPhoto(stepId: string, photoId: string, patch: Partial<StepPhotoAttachment>) {
    if (!task) {
      return;
    }

    const nextTask = updateStepPhotoAttachment(task, stepId, photoId, patch);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
  }

  function requestRemoveManufacturingStepPhoto(stepId: string, photo: StepPhotoAttachment) {
    if (!task) {
      return;
    }

    onConfirmAction({
      title: "Delete photo?",
      body: "This removes the photo from the shared step record.",
      tone: "danger",
      confirmLabel: "Delete Photo",
      onConfirm: () => removeManufacturingStepPhoto(stepId, photo.id),
    });
  }

  if (!task) {
    return (
      <section className="ui-workspace-content h-full min-h-0 overflow-hidden p-4">
        <div className="ui-panel p-5 text-sm font-bold text-steel">
          No task is available for procedure authoring.
        </div>
      </section>
    );
  }

  return (
    <section className="ui-workspace-content ui-procedure-workspace flex h-full min-h-0 overflow-hidden">
      <aside
        style={procedureGridStyle}
        className="ui-procedure-sidebar relative shrink-0 overflow-x-hidden overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-surface-raised px-2 pb-2 pt-3">
          <div className="ui-nav-section mb-0 px-0">Procedure tasks</div>
          <div className="mt-1 text-[11px] text-ink-tertiary">{tasks.length} task rows</div>
        </div>

        <div className="px-2 pb-2">
          {groupedTasks.map((group) => (
            <div key={group.id} className="mb-3 last:mb-0">
              <div className="ui-nav-section ui-procedure-zone-heading mb-1 flex items-center gap-1.5 px-0 normal-case tracking-[0.08em]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="min-w-0 truncate">{group.name}</span>
                <span className="ml-auto tabular-nums">{group.tasks.length}</span>
              </div>
              <div className="space-y-0.5">
                {group.tasks.map((item) => {
                  const active = item.id === task.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectTask(item.id)}
                      title={item.name || "Untitled task"}
                      className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                    >
                      <span className="w-[82px] shrink-0 truncate font-mono text-[10px] tabular-nums text-ink-tertiary">
                        {taskDisplayCode(item)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.name || "Untitled task"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <ScrollDownHint className="pb-1" />
        <button
          type="button"
          onPointerDown={startNavigatorResize}
          className={`absolute right-0 top-0 z-20 hidden h-full w-3 translate-x-1/2 cursor-col-resize touch-none outline-none transition lg:block ${
            isResizingNavigator ? "bg-accent/10" : "hover:bg-accent/10 focus-visible:bg-accent/10"
          }`}
          aria-label="Resize procedure task navigator"
          title="Drag to resize procedure task navigator"
        >
          <span
            className={`absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
              isResizingNavigator ? "bg-accent" : "bg-steel/25"
            }`}
          />
        </button>
      </aside>

      <main
        className="ui-procedure-main min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6"
      >
        <div className="mx-auto max-w-[1500px] space-y-5">
          <section>
            <div className="flex items-start justify-between gap-3">
              <h1 className="ui-section-title ui-procedure-title">{task.name || "Untitled task"}</h1>
              <div className="relative shrink-0" ref={sectionFilterRef}>
                <button
                  type="button"
                  onClick={() => setIsSectionFilterOpen((open) => !open)}
                  aria-haspopup="true"
                  aria-expanded={isSectionFilterOpen}
                  title="Show or hide step sections"
                  className="ui-btn-ghost h-9 gap-2 px-3"
                >
                  <SlidersHorizontal size={14} strokeWidth={1.75} />
                  Filter
                  {hiddenStepSections.size > 0 ? (
                    <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                      {hiddenStepSections.size}
                    </span>
                  ) : null}
                </button>
                {isSectionFilterOpen ? (
                  <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-line bg-surface-raised p-3 shadow-lg">
                    <div className="ui-field-label mb-2">Show on every step</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PROCEDURE_STEP_SECTIONS.map(({ key, label, Icon }) => {
                        const shown = !hiddenStepSections.has(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleStepSection(key)}
                            aria-pressed={shown}
                            title={shown ? `Hide ${label} on every step` : `Show ${label} on every step`}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
                              shown
                                ? "border-accent/40 bg-accent/10 text-ink"
                                : "border-line bg-surface-raised text-steel opacity-70"
                            }`}
                          >
                            <Icon size={12} strokeWidth={1.75} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="ui-metric-strip mt-4">
              {[
                ["Zone", zoneById.get(task.zoneId ?? "")?.name ?? "Unzoned"],
                ["Duration", formatMinutes(task.plannedDurationMinutes)],
                ["Man-Hours", formatManHours(currentManHours)],
                ["Operators", `${task.plannedOperators}`],
              ].map(([label, value]) => (
                <StatCard key={label} label={label} value={value} />
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <label className="block">
              <span className="ui-field-label">Task Description</span>
              <textarea
                className="ui-field-standalone min-h-[96px] h-auto resize-y py-2 leading-relaxed"
                value={task.description ?? ""}
                onChange={(event) => onUpdateTask(task.id, { description: event.target.value })}
                placeholder="Describe the task scope, boundaries, and expected output."
              />
            </label>

            <label className="block">
              <span className="ui-field-label">Safety Notes</span>
              <textarea
                className="ui-field-standalone min-h-[96px] h-auto resize-y py-2 leading-relaxed"
                value={task.safetyNotes ?? ""}
                onChange={(event) => onUpdateTask(task.id, { safetyNotes: event.target.value })}
                placeholder="Safety, lockout, PPE, lifting, or handling notes."
              />
            </label>
          </section>

          <section className="ui-procedure-manufacturing-section">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="ui-setup-section-title">Manufacturing Steps</h2>
                <p className="ui-setup-section-desc">
                  {manufacturingSteps.length} step(s) · step total {formatMinutes(manufacturingStepDurationMinutes)} · {formatManHours(stepDerivedManHours)}
                </p>
              </div>
              <button type="button" onClick={addManufacturingStep} className="ui-btn-ghost h-10 gap-2">
                <Plus size={14} strokeWidth={1.75} />
                Add Step
              </button>
            </div>

            <div className="ui-procedure-steps">
              {manufacturingSteps.length === 0 ? (
                <div className="ui-procedure-empty">
                  Add a blank step to start authoring the procedure for this task.
                </div>
              ) : (
                manufacturingSteps.map((step) => {
                  const stepPhotos = getStepPhotoAttachments(task, step.id);
                  const stepTools = getStepToolList(task, step.id);

                  return (
                    <div key={step.id} className="ui-procedure-step space-y-3">
                      <div>
                        <div className="ui-procedure-step-header mb-1">
                          <div className="ui-procedure-step-header-fields">
                            <label className="ui-procedure-step-title-field">
                              <span className="ui-procedure-step-title">Step {step.sequence}</span>
                              <input
                                aria-label={`Step ${step.sequence} name`}
                                data-step-name-id={step.id}
                                className="ui-procedure-step-inline-text ui-procedure-step-name-input"
                                value={getProcedureFieldValue(task.id, step.id, "name", step.name ?? "")}
                                onFocus={() => onProcedureFieldFocus(task.id, step.id, "name", step.name ?? "")}
                                onBlur={() => onProcedureFieldBlur(task.id, step.id, "name")}
                                onChange={(event) =>
                                  onProcedureFieldChange(task.id, step.id, "name", event.target.value)
                                }
                                placeholder={`Step ${step.sequence} name`}
                              />
                            </label>
                            <label className="ui-procedure-step-inline-field">
                              <span className="ui-field-label mb-0">Seq</span>
                              <ClearableNumberInput
                                aria-label={`Step ${step.sequence} sequence`}
                                className="number-input ui-procedure-step-inline-value"
                                value={step.sequence}
                                min={1}
                                fallbackValue={step.sequence}
                                precision={0}
                                normalize={Math.round}
                                onValueChange={(value) => moveManufacturingStep(step.id, value)}
                              />
                            </label>
                            <label className="ui-procedure-step-inline-field">
                              <span className="ui-field-label mb-0">Min</span>
                              <ClearableNumberInput
                                aria-label={`Step ${step.sequence} duration minutes`}
                                className="number-input ui-procedure-step-inline-value ui-procedure-step-inline-value-wide"
                                value={step.durationMinutes ?? 0}
                                min={0}
                                fallbackValue={step.durationMinutes ?? 0}
                                precision={1}
                                onValueChange={(value) => updateManufacturingStep(step.id, { durationMinutes: value })}
                              />
                            </label>
                          </div>
                          <div className="ui-procedure-step-toolbar">
                            {moveTargetTasks.length > 0 ? (
                              <ThemedSelect
                                ariaLabel={`Move step ${step.sequence} to another task`}
                                value=""
                                className="w-[9.5rem]"
                                triggerClassName="h-7 px-2 text-[10px]"
                                placeholder="Move"
                                options={[
                                  { value: "", label: "Move" },
                                  ...moveTargetTasks.map((targetTask) => ({
                                    value: targetTask.id,
                                    label: `${taskDisplayCode(targetTask)} ${targetTask.name || "Untitled task"}`,
                                  })),
                                ]}
                                onChange={(targetTaskId) => {
                                  if (!targetTaskId || !task) {
                                    return;
                                  }

                                  const targetTask = moveTargetTasks.find((candidate) => candidate.id === targetTaskId);
                                  onConfirmAction({
                                    title: `Move step ${step.sequence}?`,
                                    body: `Move this step from ${taskDisplayCode(task)} ${task.name || "Untitled task"} to ${
                                      targetTask ? `${taskDisplayCode(targetTask)} ${targetTask.name || "Untitled task"}` : "the selected task"
                                    }. Tools, part links, and photos move with it.`,
                                    tone: "warning",
                                    confirmLabel: "Move Step",
                                    onConfirm: () => onMoveStepToTask(task.id, targetTaskId, step.id),
                                  });
                                }}
                              />
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                onProcedureFieldChange(
                                  task.id,
                                  step.id,
                                  "instruction",
                                  applyInstructionBullets(
                                    getProcedureFieldValue(task.id, step.id, "instruction", step.instruction),
                                  ),
                                )
                              }
                              className="ui-btn-ghost h-7 gap-1 px-2 text-[10px]"
                              title={`Format step ${step.sequence} as bullets`}
                              aria-label={`Format step ${step.sequence} as bullets`}
                            >
                              <ListChecks size={12} strokeWidth={1.75} />
                              Bullets
                            </button>
                            <button
                              type="button"
                              onClick={() => requestRemoveManufacturingStep(step.id)}
                              className="ui-btn-ghost h-7 gap-1 px-2 text-[10px] text-danger hover:text-danger"
                              title={`Delete step ${step.sequence}`}
                              aria-label={`Delete step ${step.sequence}`}
                            >
                              <Trash2 size={12} strokeWidth={1.75} />
                              Delete
                            </button>
                          </div>
                        </div>
                        <label className="ui-procedure-step-instruction-field block">
                          <span className="ui-field-label mb-0 block">Instruction</span>
                          <textarea
                            aria-label={`Step ${step.sequence} instruction`}
                            className="ui-field-standalone ui-procedure-step-instruction h-auto w-full resize-y"
                            value={getProcedureFieldValue(task.id, step.id, "instruction", step.instruction)}
                            onFocus={() => onProcedureFieldFocus(task.id, step.id, "instruction", step.instruction)}
                            onBlur={() => onProcedureFieldBlur(task.id, step.id, "instruction")}
                            onChange={(event) =>
                              onProcedureFieldChange(task.id, step.id, "instruction", event.target.value)
                            }
                            onKeyDown={(event) =>
                              handleInstructionBulletKeyDown(event, (instruction) =>
                                onProcedureFieldChange(task.id, step.id, "instruction", instruction),
                              )
                            }
                            placeholder="Write the manufacturing instruction for this operation."
                          />
                        </label>
                      </div>

                      {showPhotos ? (
                        <div className="ui-procedure-step-divider">
                          <StepPhotoAttachmentEditor
                            step={step}
                            photos={stepPhotos}
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onRemove={(photoId) => removeManufacturingStepPhoto(step.id, photoId)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
                          />
                        </div>
                      ) : null}

                      {showStepDetails ? (
                      <div className="ui-procedure-step-details">
                        {showChecks ? (
                        <div className="ui-procedure-step-detail">
                          <span className="ui-field-label mb-0 block">Checks</span>
                          <ProcedureStepChecksEditor
                            ariaLabel={`Step ${step.sequence} checks`}
                            definitions={stepCheckDefinitions}
                            qualityCheck={step.qualityCheck}
                            onChange={(qualityCheck) => updateManufacturingStep(step.id, { qualityCheck })}
                          />
                        </div>
                        ) : null}

                        {showTools ? (
                        <div className="ui-procedure-step-detail">
                          <span className="ui-field-label mb-0 block">Tools</span>
                          <div className="ui-procedure-step-add-row">
                            <input
                              className="ui-procedure-step-inline-text"
                              value={newStepToolNames[step.id] ?? ""}
                              onChange={(event) =>
                                setNewStepToolNames((current) => ({ ...current, [step.id]: event.target.value }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  addManufacturingStepTool(step.id);
                                }
                              }}
                              placeholder="Add tool"
                            />
                            <button
                              type="button"
                              onClick={() => addManufacturingStepTool(step.id)}
                              className="ui-btn-ghost h-8 shrink-0 px-2 text-[10px]"
                            >
                              Add
                            </button>
                            {toolLibrary.length > 0 ? (
                              <ThemedSelect
                                aria-label={`Add saved tool to step ${step.sequence}`}
                                value=""
                                className="min-w-36"
                                triggerClassName="h-8 rounded-none border-0 border-b bg-transparent px-0 text-xs"
                                options={[
                                  { value: "", label: "Tool library" },
                                  ...toolLibrary
                                    .filter((tool) => !stepTools.some((stepTool) => stepTool.toLocaleLowerCase() === tool.toLocaleLowerCase()))
                                    .map((tool) => ({ value: tool, label: tool })),
                                ]}
                                onChange={(value) => {
                                  if (value) {
                                    addManufacturingStepToolFromLibrary(step.id, value);
                                  }
                                }}
                              />
                            ) : null}
                          </div>
                          <ProcedureStepToolTable
                            tools={stepTools}
                            registry={projectToolRegistry}
                            onRemove={(toolName) => removeManufacturingStepTool(step.id, toolName)}
                            removeAriaLabel={(toolName) => `Remove ${toolName} from step ${step.sequence}`}
                          />
                        </div>
                        ) : null}

                        {showParts ? (
                        <StepPartReferenceEditor
                          task={task}
                          step={step}
                          partReferences={partReferences}
                          draftValue={newStepPartNumbers[step.id] ?? ""}
                          masterBom={masterBom}
                          onDraftChange={(value) =>
                            setNewStepPartNumbers((current) => ({ ...current, [step.id]: value }))
                          }
                          onAddDraft={() => addManufacturingStepPartReference(step.id)}
                          onAddFromBom={(entry) => addStepPartFromBom(step.id, entry)}
                          onLinkExisting={(partReferenceId) => linkExistingPartToManufacturingStep(step.id, partReferenceId)}
                          onRemove={(partReferenceId) => removeManufacturingStepPartReference(step.id, partReferenceId)}
                        />
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {showParts ? (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="ui-setup-section-title">Part References</h2>
                <p className="ui-setup-section-desc">{partReferences.length} part reference(s)</p>
              </div>
              <button type="button" onClick={addPartReference} className="ui-btn-ghost h-10 gap-2">
                <Plus size={14} strokeWidth={1.75} />
                Part
              </button>
            </div>
            {partReferences.length === 0 ? (
              <div className="ui-procedure-empty">
                No part references on this task yet.
              </div>
            ) : (
              <div className="ui-procedure-part-editor">
                {partReferences.map((part) => (
                  <div key={part.id} className="ui-procedure-part-row group">
                    <label className="block min-w-0">
                      <span className="ui-field-label">Part Number</span>
                      <input
                        className="ui-procedure-step-inline-text w-full min-w-0"
                        value={part.partNumber}
                        onChange={(event) => updatePartReference(part.id, { partNumber: event.target.value })}
                        placeholder="Part number"
                      />
                    </label>
                    <label className="block">
                      <span className="ui-field-label">Qty</span>
                      <ClearableNumberInput
                        className="number-input ui-procedure-step-inline-value"
                        value={part.quantity ?? 0}
                        min={0}
                        fallbackValue={part.quantity ?? 0}
                        precision={0}
                        normalize={Math.round}
                        onValueChange={(value) => updatePartReference(part.id, { quantity: value })}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="ui-field-label">Description</span>
                      <input
                        className="ui-procedure-step-inline-text w-full min-w-0"
                        value={part.description ?? ""}
                        onChange={(event) => updatePartReference(part.id, { description: event.target.value })}
                        placeholder="Description"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="ui-field-label">Disposition / Note</span>
                      <input
                        className="ui-procedure-step-inline-text w-full min-w-0"
                        value={part.disposition ?? ""}
                        onChange={(event) => updatePartReference(part.id, { disposition: event.target.value })}
                        placeholder="Note"
                      />
                    </label>
                    <button
                      type="button"
                      className="ui-procedure-tool-table-remove mt-5 justify-self-end"
                      onClick={() => requestRemovePartReference(part)}
                      aria-label={`Delete part reference ${part.partNumber || "unnamed part"}`}
                      title="Delete part"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          ) : null}
        </div>
        <ScrollDownHint />
      </main>
    </section>
  );
}

function SetupFieldGroup({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-setup-section ${className}`}>
      <div className="ui-setup-section-head">
        <div className="ui-setup-section-title">{title}</div>
        {description ? <div className="ui-setup-section-desc">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ProductSetupPanel({
  product,
  onProductNumber,
  onProductText,
}: {
  product: Product;
  onProductNumber: (field: ProductNumberField, value: number) => void;
  onProductText: (field: ProductTextField, value: string) => void;
}) {
  return (
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Product Setup</h2>
          <div className="ui-section-subtitle">Demand, available time, takt, and target labor</div>
        </div>
      </div>

      <div className="ui-product-setup-body">
        <SetupFieldGroup title="Product Identity" description="What is being planned">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(110px,0.55fr)_minmax(150px,0.7fr)_minmax(130px,0.6fr)_minmax(150px,0.7fr)]">
            <label className="block">
              <span className="ui-field-label">Product</span>
              <input
                className="ui-field-standalone"
                value={product.name}
                onChange={(event) => onProductText("name", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Product Code</span>
              <input
                className="ui-field-standalone font-mono uppercase"
                value={product.productCode ?? ""}
                onChange={(event) =>
                  onProductText("productCode", event.target.value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 20))
                }
                placeholder="FB-V2"
              />
            </label>
            <label className="block">
              <span className="ui-field-label">SKU</span>
              <input
                className="ui-field-standalone"
                value={product.sku ?? ""}
                onChange={(event) => onProductText("sku", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Revision</span>
              <input
                className="ui-field-standalone"
                value={product.revision}
                onChange={(event) => onProductText("revision", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Status</span>
              <ThemedSelect
                className="w-full"
                value={product.status}
                options={productStatusOptions}
                onChange={(value) => onProductText("status", value as ProductStatus)}
              />
            </label>
          </div>
        </SetupFieldGroup>

        <div className="ui-product-setup-split">
          <SetupFieldGroup title="Demand & Labor" description="Volume, takt override, and labor target">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <label className="block">
                <span className="ui-field-label">Demand</span>
                <div className="ui-field-shell ui-field-shell-select-combo">
                  <ClearableNumberInput
                    className="number-input ui-field-control"
                    value={product.demandQuantity}
                    min={0}
                    step={1}
                    precision={0}
                    normalize={Math.round}
                    onValueChange={(value) => onProductNumber("demandQuantity", value)}
                  />
                  <ThemedSelect
                    className="w-28 shrink-0"
                    triggerClassName="h-10 rounded-none rounded-r-lg border-0 border-l px-2 ui-mono-label"
                    value={product.demandPeriod}
                    options={demandPeriodOptions}
                    onChange={(value) => onProductText("demandPeriod", value as DemandPeriod)}
                  />
                </div>
              </label>
              <NumericField
                label="Manual Takt"
                value={product.manualTaktMinutes ?? 0}
                suffix="min"
                onChange={(value) => onProductNumber("manualTaktMinutes", value)}
              />
              <NumericField
                label="Target MH"
                value={product.targetManHours}
                suffix="MH"
                onChange={(value) => onProductNumber("targetManHours", value)}
              />
            </div>
          </SetupFieldGroup>

          <SetupFieldGroup title="Available Workday" description="Shift time minus planned non-production time">
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              <NumericField
                label="Workday"
                value={product.grossAvailableMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("grossAvailableMinutes", value)}
              />
              <NumericField
                label="Breaks"
                value={product.breakMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("breakMinutes", value)}
              />
              <NumericField
                label="Lunch"
                value={product.lunchMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("lunchMinutes", value)}
              />
              <NumericField
                label="Meetings"
                value={product.meetingMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("meetingMinutes", value)}
              />
              <NumericField
                label="Planned Downtime"
                value={product.plannedDowntimeMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("plannedDowntimeMinutes", value)}
              />
            </div>
          </SetupFieldGroup>
        </div>

        <SetupFieldGroup title="Calendar" description="Working pattern used for weekly and monthly capacity">
          <div className="grid gap-3 md:grid-cols-3">
            <NumericField
              label="Days / Week"
              value={product.workDaysPerWeek}
              suffix="days"
              precision={2}
              onChange={(value) => onProductNumber("workDaysPerWeek", value)}
            />
            <NumericField
              label="Weeks / Month"
              value={product.workWeeksPerMonth}
              suffix="wk"
              precision={2}
              onChange={(value) => onProductNumber("workWeeksPerMonth", value)}
            />
            <NumericField
              label="Days / Month"
              value={product.availableWorkDaysPerMonth}
              suffix="days"
              precision={1}
              readOnly
              onChange={() => undefined}
            />
          </div>
        </SetupFieldGroup>

      </div>
    </section>
  );
}

function ProcedureChecksSetupPanel({
  product,
  onProductStepChecks,
}: {
  product: Product;
  onProductStepChecks: (definitions: ManufacturingStepCheckDefinition[]) => void;
}) {
  const checkDefinitions = getManufacturingStepCheckDefinitions(product.customFields);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  function setLabelDraft(key: string, value: string) {
    setLabelDrafts((current) => ({ ...current, [key]: value }));
  }

  function commitLabel(definition: ManufacturingStepCheckDefinition) {
    const draft = labelDrafts[definition.key];
    setLabelDrafts((current) => {
      if (!(definition.key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[definition.key];
      return next;
    });

    if (draft === undefined) {
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed || trimmed === definition.label) {
      return;
    }

    updateCheckDefinition(definition.key, { label: trimmed });
  }

  function updateCheckDefinition(key: string, patch: Partial<ManufacturingStepCheckDefinition>) {
    onProductStepChecks(
      checkDefinitions.map((definition) =>
        definition.key === key
          ? {
              ...definition,
              ...patch,
            }
          : definition,
      ),
    );
  }

  function getUniqueCheckKey(label: string) {
    const baseKey = normalizeManufacturingStepCheck(label) || "custom_check";
    const existingKeys = new Set(checkDefinitions.map((definition) => definition.key));
    let candidate = baseKey;
    let index = 2;

    while (existingKeys.has(candidate)) {
      candidate = `${baseKey}_${index}`;
      index += 1;
    }

    return candidate;
  }

  function addCheckDefinition() {
    const label = "New check";
    onProductStepChecks([
      ...checkDefinitions,
      {
        key: getUniqueCheckKey(label),
        label,
        enabled: true,
        inputType: "checkbox",
      },
    ]);
  }

  function removeCheckDefinition(key: string) {
    setLabelDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    onProductStepChecks(checkDefinitions.filter((definition) => definition.key !== key));
  }

  return (
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Procedure Checks</h2>
          <div className="ui-section-subtitle">Choose the checks shown on manufacturing steps</div>
        </div>
        <button type="button" onClick={addCheckDefinition} className="ui-btn-ghost h-10 gap-2">
          <Plus size={15} strokeWidth={1.75} />
          Check
        </button>
      </div>

      <div className="ui-product-setup-body">
        <div className="ui-procedure-checks">
          {checkDefinitions.map((definition) => (
            <div
              key={definition.key}
              data-enabled={definition.enabled}
              className="ui-procedure-checks-row flex items-center gap-3"
            >
              <input
                type="checkbox"
                checked={definition.enabled}
                onChange={(event) => updateCheckDefinition(definition.key, { enabled: event.target.checked })}
                aria-label={`Enable ${definition.label}`}
              />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Check name</span>
                <input
                  className="ui-procedure-step-inline-text w-full min-w-0 text-xs"
                  value={labelDrafts[definition.key] ?? definition.label}
                  onChange={(event) => setLabelDraft(definition.key, event.target.value)}
                  onBlur={() => commitLabel(definition)}
                />
              </label>
              {definition.inputType === "number" ? (
                <ThemedSelect
                  aria-label={`${definition.label} default unit`}
                  className="w-24 shrink-0"
                  triggerClassName="h-9"
                  value={definition.defaultUnit ?? definition.unitOptions?.[0] ?? "Nm"}
                  options={(definition.unitOptions?.length ? definition.unitOptions : ["Nm", "ft-lb"]).map((unit) => ({
                    value: unit,
                    label: unit,
                  }))}
                  onChange={(unit) => updateCheckDefinition(definition.key, { defaultUnit: unit })}
                />
              ) : null}
              <button
                type="button"
                className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded text-ink-tertiary transition hover:bg-danger-muted hover:text-danger"
                onClick={() => removeCheckDefinition(definition.key)}
                aria-label={`Remove ${definition.label}`}
                title={`Remove ${definition.label}`}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkInstructionsPanel({
  tasks,
  zones,
  product,
  onOpenTask,
}: {
  tasks: Task[];
  zones: Zone[];
  product: Product;
  onOpenTask: (taskId: string) => void;
}) {
  const parentIds = new Set(tasks.map((task) => task.parentTaskId).filter((id): id is string => Boolean(id)));
  // One work instruction per leaf work-task (skip summary rows, milestones, holds, etc.).
  const workTasks = tasks.filter((task) => task.rowType === "task" && !parentIds.has(task.id));
  const checkDefinitions = getManufacturingStepCheckDefinitions(product.customFields);

  const hasWorkInstruction = (task: Task) => Boolean(task.workInstructionLink || task.sopLink);
  const hasTools = (task: Task) => countTaskStepTools(task) > 0;
  const hasChecks = (task: Task) =>
    (task.manufacturingSteps ?? []).some((step) => getManufacturingStepCheckState(step.qualityCheck, checkDefinitions).selected.size > 0);
  // Prerequisites for generating a work instruction: it needs tools AND a checklist first.
  const isReady = (task: Task) => hasTools(task) && hasChecks(task);

  const createdCount = workTasks.filter(hasWorkInstruction).length;
  const readyCount = workTasks.filter((task) => !hasWorkInstruction(task) && isReady(task)).length;
  const incompleteCount = workTasks.filter((task) => !hasWorkInstruction(task) && !isReady(task)).length;

  const UNZONED_KEY = "__unzoned__";
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const grouped = new Map<string, Task[]>();
  workTasks.forEach((task) => {
    const key = task.zoneId && zoneById.has(task.zoneId) ? task.zoneId : UNZONED_KEY;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  });
  const orderedZoneKeys = [
    ...zones.map((zone) => zone.id).filter((id) => grouped.has(id)),
    ...(grouped.has(UNZONED_KEY) ? [UNZONED_KEY] : []),
  ];

  function statusOf(task: Task) {
    if (hasWorkInstruction(task)) {
      return { label: "Created", className: "border-accent/30 bg-accent/5 text-ink-secondary" };
    }
    if (isReady(task)) {
      return { label: "Ready", className: "border-accent/50 bg-accent/10 text-ink" };
    }
    return { label: "Incomplete", className: "border-line bg-surface-raised text-steel" };
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header className="space-y-1">
        <h2 className="ui-section-title">Work Instructions</h2>
        <p className="ui-section-subtitle">
          {workTasks.length === 0
            ? "Add tasks in the Gantt to see the work instructions you need to build."
            : `${readyCount} of ${workTasks.length} ready to generate · ${incompleteCount} still need tools & checks.`}
        </p>
        <p className="text-xs text-ink-tertiary">
          A work instruction can be generated once its steps have both tools and a checklist assigned.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Needed" value={String(workTasks.length)} meta="one per task" />
        <StatCard label="Ready" value={String(readyCount)} tone={readyCount > 0 ? "good" : "neutral"} meta="tools + checks done" />
        <StatCard label="Incomplete" value={String(incompleteCount)} tone={incompleteCount > 0 ? "warn" : "neutral"} meta="missing tools / checks" />
        <StatCard label="Created" value={String(createdCount)} meta="generated / linked" />
      </div>

      {workTasks.length === 0 ? null : (
        <div className="space-y-5">
          {orderedZoneKeys.map((zoneKey) => {
            const zone = zoneKey === UNZONED_KEY ? undefined : zoneById.get(zoneKey);
            const zoneTasks = grouped.get(zoneKey) ?? [];
            return (
              <section key={zoneKey} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="ui-setup-section-title">{zone ? zone.name : "Unzoned"}</h3>
                  <span className="ui-section-subtitle">
                    {zoneTasks.length} task{zoneTasks.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-line">
                  {zoneTasks.map((task, index) => {
                    const status = statusOf(task);
                    return (
                      <button
                        type="button"
                        key={task.id}
                        onClick={() => onOpenTask(task.id)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-raised ${
                          index > 0 ? "border-t border-line" : ""
                        }`}
                      >
                        <span className="ui-mono-label w-32 shrink-0 truncate text-ink-secondary">
                          {task.manufacturingCode || "Uncoded"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.name}</span>
                        <span className="flex shrink-0 items-center gap-2 text-ink-tertiary">
                          <span
                            title={hasTools(task) ? "Tools assigned" : "No tools assigned"}
                            className={hasTools(task) ? "text-ink-secondary" : "opacity-30"}
                          >
                            <Wrench size={13} strokeWidth={1.75} />
                          </span>
                          <span
                            title={hasChecks(task) ? "Checks assigned" : "No checks assigned"}
                            className={hasChecks(task) ? "text-ink-secondary" : "opacity-30"}
                          >
                            <ListChecks size={13} strokeWidth={1.75} />
                          </span>
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NomenclatureSetupPanel({
  product,
  zones,
  tasks,
  components,
  documentTypes,
  onProductText,
  onUpdateZone,
  onAddComponent,
  onUpdateComponent,
  onDeleteComponent,
  onAddDocumentType,
  onUpdateDocumentType,
  onDeleteDocumentType,
  onAddMissingDefaultDocumentTypes,
}: {
  product: Product;
  zones: Zone[];
  tasks: Task[];
  components: ManufacturingComponent[];
  documentTypes: DocumentTypeCode[];
  onProductText: (field: ProductTextField, value: string) => void;
  onUpdateZone: (zoneId: string, patch: Partial<Zone>) => void;
  onAddComponent: () => void;
  onUpdateComponent: (componentId: string, patch: Partial<ManufacturingComponent>) => void;
  onDeleteComponent: (componentId: string) => void;
  onAddDocumentType: () => void;
  onUpdateDocumentType: (documentTypeId: string, patch: Partial<DocumentTypeCode>) => void;
  onDeleteDocumentType: (documentTypeId: string) => void;
  onAddMissingDefaultDocumentTypes: () => void;
}) {
  const duplicateCodeEntries = Array.from(
    tasks.reduce((codeMap, task) => {
      const code = task.manufacturingCode?.trim();
      if (!code) {
        return codeMap;
      }

      codeMap.set(code, [...(codeMap.get(code) ?? []), task]);
      return codeMap;
    }, new Map<string, Task[]>()),
  ).filter(([, codedTasks]) => codedTasks.length > 1);
  const uncodedTaskCount = tasks.filter((task) => !task.manufacturingCode?.trim()).length;

  const programCode = product.productCode?.trim().toUpperCase() || "FB-V2";
  const exampleComponent = components.find((component) => component.code?.trim())?.code?.trim().toUpperCase() || "CLU";
  const exampleZone = zones.find((zone) => zone.code?.trim())?.code?.trim().toUpperCase() || "SUB";
  const exampleDocType =
    documentTypes.find((documentType) => documentType.active && documentType.code?.trim())?.code?.trim().toUpperCase() ||
    documentTypes.find((documentType) => documentType.code?.trim())?.code?.trim().toUpperCase() ||
    "WI";
  const exampleDocName =
    documentTypes.find((documentType) => documentType.code?.trim().toUpperCase() === exampleDocType)?.name?.trim() || "Work Instruction";
  const nomenclatureSegments = [
    { value: exampleComponent, label: "Component", means: "Which system / assembly the work is on", source: "Component Codes (below)" },
    { value: exampleZone, label: "Zone", means: "Major process area — the middle segment", source: "Zone Codes (below)" },
    { value: "10", label: "Task #", means: "Sequential number for the task", source: "Auto-assigned in the Gantt" },
    { value: `${exampleDocType}1`, label: "Document", means: `${exampleDocName} + document number`, source: "Document Types (below)" },
    { value: "S10", label: "Step", means: "Step number inside the document", source: "Procedure tab" },
  ];

  return (
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Document Control</h2>
          <div className="ui-section-subtitle">Map product, zone, component, task, and document codes</div>
        </div>
      </div>

      <div className="ui-product-setup-body">
        <div className="ui-nomenclature-legend">
          <div className="ui-nomenclature-legend-head">
            <span className="ui-nomenclature-legend-eyebrow">Code anatomy</span>
            <span className="ui-nomenclature-legend-program">Program · {programCode}</span>
          </div>
          <div className="ui-nomenclature-legend-code" aria-hidden="true">
            {nomenclatureSegments.flatMap((segment, index) => {
              const token = (
                <span className="ui-nomenclature-seg" key={segment.label}>
                  <span className="ui-nomenclature-seg-value">{segment.value}</span>
                  <span className="ui-nomenclature-seg-label">{segment.label}</span>
                </span>
              );
              return index === 0
                ? [token]
                : [
                    <span className="ui-nomenclature-legend-sep" key={`sep-${segment.label}`}>
                      –
                    </span>,
                    token,
                  ];
            })}
          </div>
          <dl className="ui-nomenclature-legend-list">
            {nomenclatureSegments.map((segment, index) => (
              <div className="ui-nomenclature-legend-item" key={segment.label}>
                <span className="ui-nomenclature-legend-num">{index + 1}</span>
                <div className="min-w-0">
                  <dt className="ui-nomenclature-legend-term">
                    <span className="ui-nomenclature-legend-chip">{segment.value}</span>
                    {segment.label}
                  </dt>
                  <dd className="ui-nomenclature-legend-desc">
                    {segment.means}
                    <span className="ui-nomenclature-legend-source">{segment.source}</span>
                  </dd>
                </div>
              </div>
            ))}
          </dl>

          <p className="ui-nomenclature-legend-note">
            <span className="ui-nomenclature-legend-note-label">Where this code shows up</span>
            Printed on work instructions, travelers, and QC sheets — and used as the export file path, e.g.{" "}
            <code className="ui-nomenclature-legend-path">
              {programCode}/{exampleComponent}-{exampleZone}-10-{exampleDocType}1-S10
            </code>
          </p>
        </div>

        {duplicateCodeEntries.length || uncodedTaskCount ? (
          <div className="rounded border border-warn/35 bg-warn-muted px-3 py-2 text-sm font-semibold text-ink">
            {duplicateCodeEntries.length ? (
              <div>
                Duplicate task codes:{" "}
                {duplicateCodeEntries
                  .slice(0, 4)
                  .map(([code, codedTasks]) => `${code} (${codedTasks.length})`)
                  .join(", ")}
              </div>
            ) : null}
            {uncodedTaskCount ? <div>{uncodedTaskCount} task{uncodedTaskCount === 1 ? "" : "s"} still uncoded.</div> : null}
          </div>
        ) : null}

        <SetupFieldGroup title="Product Code" description="Top-level program code used in exports and document paths">
          <label className="block max-w-xs">
            <span className="ui-field-label">Product ID</span>
            <input
              className="ui-field-standalone font-mono uppercase"
              value={product.productCode ?? ""}
              onChange={(event) =>
                onProductText("productCode", event.target.value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 20))
              }
              placeholder="FB-V2"
            />
          </label>
        </SetupFieldGroup>

        <SetupFieldGroup title="Zone Codes" description="Major process zones used as the middle segment of task codes">
          <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="grid grid-cols-[90px_minmax(180px,1fr)_minmax(220px,1.4fr)] gap-2 border-b border-line bg-surface-sunken px-3 py-2 ui-mono-label">
              <span>Code</span>
              <span>Zone</span>
              <span>Description</span>
            </div>
            {zones.map((zone) => (
              <div key={zone.id} className="grid grid-cols-[90px_minmax(180px,1fr)_minmax(220px,1.4fr)] gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  className="ui-field-standalone h-8 font-mono uppercase"
                  value={zone.code ?? ""}
                  onChange={(event) => onUpdateZone(zone.id, { code: normalizeCode(event.target.value) })}
                  placeholder="SUB"
                />
                <input
                  className="ui-field-standalone h-8"
                  value={zone.name}
                  onChange={(event) => onUpdateZone(zone.id, { name: event.target.value })}
                />
                <input
                  className="ui-field-standalone h-8"
                  value={zone.description ?? ""}
                  onChange={(event) => onUpdateZone(zone.id, { description: event.target.value })}
                  placeholder="Optional description"
                />
              </div>
            ))}
            {zones.length === 0 ? <div className="px-3 py-3 text-sm font-semibold text-steel">Add zones in the Gantt before assigning zone codes.</div> : null}
          </div>
        </SetupFieldGroup>

        <SetupFieldGroup title="Component Codes" description="Reusable system/component codes assigned to tasks">
          <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line bg-surface-sunken px-3 py-2 ui-mono-label">
              <span>Code</span>
              <span>Component</span>
              <span />
            </div>
            {components.map((component) => (
              <div key={component.id} className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  className="ui-field-standalone h-8 font-mono uppercase"
                  value={component.code}
                  onChange={(event) => onUpdateComponent(component.id, { code: normalizeCode(event.target.value) })}
                  placeholder="CLU"
                />
                <input
                  className="ui-field-standalone h-8"
                  value={component.name}
                  onChange={(event) => onUpdateComponent(component.id, { name: event.target.value })}
                  placeholder="Clutch Assembly"
                />
                <button
                  type="button"
                  onClick={() => onDeleteComponent(component.id)}
                  className="inline-flex h-8 items-center justify-center rounded border border-line bg-surface text-steel hover:border-danger hover:text-danger"
                  title="Delete component"
                  aria-label={`Delete ${component.name || component.code || "component"}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {components.length === 0 ? <div className="px-3 py-3 text-sm font-semibold text-steel">Add component codes such as CLU, ALT, BAT, or PNL.</div> : null}
          </div>
          <button type="button" onClick={onAddComponent} className="ui-btn-ghost mt-3 h-9 gap-2">
            <Plus size={14} />
            Component
          </button>
        </SetupFieldGroup>

        <SetupFieldGroup title="Document Types" description="Suffix codes for task documents and work instructions">
          <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line bg-surface-sunken px-3 py-2 ui-mono-label">
              <span>Code</span>
              <span>Document Type</span>
              <span />
            </div>
            {documentTypes.map((documentType) => (
              <div key={documentType.id} className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  className="ui-field-standalone h-8 font-mono uppercase"
                  value={documentType.code}
                  onChange={(event) => onUpdateDocumentType(documentType.id, { code: normalizeCode(event.target.value) })}
                  placeholder="WI"
                />
                <input
                  className="ui-field-standalone h-8"
                  value={documentType.name}
                  onChange={(event) => onUpdateDocumentType(documentType.id, { name: event.target.value })}
                  placeholder="Work Instruction"
                />
                <button
                  type="button"
                  onClick={() => onDeleteDocumentType(documentType.id)}
                  className="inline-flex h-8 items-center justify-center rounded border border-line bg-surface text-steel hover:border-danger hover:text-danger"
                  title="Delete document type"
                  aria-label={`Delete ${documentType.name || documentType.code || "document type"}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onAddDocumentType} className="ui-btn-ghost h-9 gap-2">
              <Plus size={14} />
              Document Type
            </button>
            <button type="button" onClick={onAddMissingDefaultDocumentTypes} className="ui-btn-ghost h-9 gap-2">
              Defaults
            </button>
          </div>
        </SetupFieldGroup>
      </div>
    </section>
  );
}

function KpiStrip({ kpis, product }: { kpis: ReturnType<typeof calculateProductKpis>; product: Product }) {
  const varianceTone = kpis.targetVariance <= 0 ? "good" : kpis.targetVariancePercent <= 10 ? "warn" : "bad";
  const taktTone = kpis.taktMinutes <= 0 ? "neutral" : kpis.plannedCycleMinutes <= kpis.taktMinutes ? "good" : "bad";
  const crewTone = kpis.plannedLaborLoadFte <= kpis.budgetedCrewEquivalent ? "good" : "bad";
  const balanceTone = kpis.lineBalanceScore >= 85 ? "good" : kpis.lineBalanceScore >= 70 ? "warn" : "bad";
  const bottleneckTone = kpis.bottleneckStation
    ? kpis.bottleneckStation.taktStatus === "red"
      ? "bad"
      : kpis.bottleneckStation.taktStatus === "yellow"
        ? "warn"
        : "neutral"
    : "neutral";
  const plannedMhMeta = kpis.unassignedTaskCount > 0
    ? `${formatManHours(kpis.assignedPlannedManHours)} assigned - ${formatManHours(kpis.unassignedPlannedManHours)} unassigned`
    : `Target ${formatManHours(product.targetManHours)}`;
  const requiredCrewValue = kpis.wholePersonStaffingRequirement > 0
    ? `${kpis.wholePersonStaffingRequirement} people`
    : "0 people";
  const requiredCrewMeta = `${round(kpis.budgetedCrewEquivalent, 2)} FTE - ${round(kpis.requiredAverageAllocationPercent, 1)}% avg`;
  const bottleneckValue = kpis.bottleneckStation?.name ?? "-";
  const bottleneckMeta = kpis.bottleneckStation
    ? `Cycle ${formatMinutes(kpis.bottleneckStation.plannedCycleMinutes)}`
    : "No scheduled work";
  const balanceMeta = `Variance ${formatManHours(kpis.targetVariance)} vs target`;

  return (
    <section className="ui-kpi-strip">
      <StatCard label="Required Takt" value={formatMinutes(kpis.taktMinutes)} meta="Active takt" tone={taktTone} />
      <StatCard label="Unit Lead Time" value={formatMinutes(kpis.plannedCycleMinutes)} meta="First task start to final finish" />
      <StatCard label="Planned MH" value={formatManHours(kpis.plannedManHours)} meta={plannedMhMeta} tone={varianceTone} />
      <StatCard label="Required Crew" value={requiredCrewValue} meta={requiredCrewMeta} tone={crewTone} />
      <StatCard label="Bottleneck" value={bottleneckValue} meta={bottleneckMeta} tone={bottleneckTone} />
      <StatCard label="Line Balance" value={`${round(kpis.lineBalanceScore, 1)}%`} meta={balanceMeta} tone={balanceTone} />
    </section>
  );
}

function ComingSoonModuleView({
  children,
  moduleLabel,
}: {
  children: ReactNode;
  moduleLabel: string;
}) {
  return (
    <section className="ui-coming-soon-module" aria-label={`${moduleLabel} coming soon`}>
      <div className="ui-coming-soon-module-preview" aria-hidden="true">
        {children}
      </div>
      <div className="ui-coming-soon-module-overlay">
        <div className="ui-coming-soon-module-panel">
          <div className="ui-mono-label">Coming soon</div>
          <h2 className="ui-section-title">{moduleLabel}</h2>
          <p className="ui-section-subtitle">
            This workspace is not ready yet. The current planner data is preserved.
          </p>
        </div>
      </div>
    </section>
  );
}

interface ZoneMetric {
  id: string;
  name: string;
  color: string;
  taskCount: number;
  headcount: number;
  manHours: number;
  cycleMinutes: number;
}

function buildZoneMetrics(zones: Zone[], tasks: Task[]): ZoneMetric[] {
  const topLevelTasks = getTopLevelTasks(tasks);
  const sortedZones = [...zones].sort((a, b) => a.sequence - b.sequence);
  const metrics = sortedZones.map((zone) => {
    const zoneTasks = topLevelTasks.filter((task) => task.zoneId === zone.id);
    return {
      id: zone.id,
      name: zone.name || "Untitled zone",
      color: zone.color,
      taskCount: zoneTasks.length,
      headcount: calculatePeakManpower(zoneTasks),
      manHours: zoneTasks.reduce((total, task) => total + calculateTaskManHours(task), 0),
      cycleMinutes: Math.max(0, ...zoneTasks.map((task) => task.plannedDurationMinutes)),
    };
  });

  const assignedZoneIds = new Set(sortedZones.map((zone) => zone.id));
  const unzonedTasks = topLevelTasks.filter((task) => !task.zoneId || !assignedZoneIds.has(task.zoneId));
  if (unzonedTasks.length) {
    metrics.push({
      id: "zone-unzoned",
      name: "Unzoned",
      color: "#52606d",
      taskCount: unzonedTasks.length,
      headcount: calculatePeakManpower(unzonedTasks),
      manHours: unzonedTasks.reduce((total, task) => total + calculateTaskManHours(task), 0),
      cycleMinutes: Math.max(0, ...unzonedTasks.map((task) => task.plannedDurationMinutes)),
    });
  }

  return metrics;
}

function ZoneMetricsPanel({
  zones,
  tasks,
  compact = false,
  embedded = false,
}: {
  zones: Zone[];
  tasks: Task[];
  compact?: boolean;
  embedded?: boolean;
}) {
  const metrics = buildZoneMetrics(zones, tasks);

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line bg-surface-raised p-3 text-xs font-semibold text-steel">
        Create a zone in the Gantt to see headcount, man-hours, and cycle time by area.
      </div>
    );
  }

  if (embedded) {
    return (
      <div className="ui-planner-zone-list">
        {metrics.map((metric) => (
          <div key={metric.id} className="ui-planner-zone-row">
            <div className="ui-planner-zone-name">
              <span className="ui-planner-zone-dot" style={{ backgroundColor: metric.color }} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{metric.name}</div>
                <div className="text-[11px] text-ink-tertiary">{metric.taskCount} tasks</div>
              </div>
            </div>
            <div className="ui-planner-zone-metrics">
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">HC</div>
                <div className="ui-row-value mt-0.5">{round(metric.headcount, 1)}</div>
              </div>
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">MH</div>
                <div className="ui-row-value mt-0.5">{formatManHours(metric.manHours)}</div>
              </div>
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">Cycle</div>
                <div className="ui-row-value mt-0.5">{formatMinutes(metric.cycleMinutes)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3"}`}>
      {metrics.map((metric) => (
        <div key={metric.id} className="ui-panel-raised p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs ui-mono-label tracking-wide text-ink">{metric.name}</div>
              <div className="text-[11px] font-semibold text-steel">{metric.taskCount} high-level task(s)</div>
            </div>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: metric.color }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="ui-mono-label">{compact ? "HC" : "Headcount"}</div>
              <div className="mt-1 text-lg font-medium text-ink">{round(metric.headcount, 1)}</div>
            </div>
            <div>
              <div className="ui-mono-label">MHs</div>
              <div className="mt-1 text-lg font-medium text-ink">{formatManHours(metric.manHours)}</div>
            </div>
            <div>
              <div className="ui-mono-label">Cycle</div>
              <div className="mt-1 text-lg font-medium text-ink">{formatMinutes(metric.cycleMinutes)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CrewReadinessCard({
  kpis,
  onClearPlanningRecommendations,
  onOpenTaskDetail,
  planningRecommendations = [],
  product,
  tasks,
  compact = false,
  embedded = false,
}: {
  kpis: ReturnType<typeof calculateProductKpis>;
  onClearPlanningRecommendations?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  planningRecommendations?: UnallocatedWorkReview[];
  product: Product;
  tasks: Task[];
  compact?: boolean;
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const period = periodLabel(product.demandPeriod);
  const plannedLaborFits = kpis.plannedManHours <= product.targetManHours;
  const plannedFteFits = kpis.plannedLaborLoadFte <= kpis.budgetedCrewEquivalent;
  const peakFits = kpis.peakManpower <= kpis.wholePersonStaffingRequirement;
  const feasible = plannedLaborFits && plannedFteFits && peakFits;
  const visibleWorkerCount = Math.min(Math.max(kpis.wholePersonStaffingRequirement, 0), WORKER_ICON_LETTERS.length);
  const visibleWorkers = WORKER_ICON_LETTERS.slice(0, visibleWorkerCount);
  const operatorAllocations = useMemo(() => {
    const periodMinutes = calculateAvailabilityMinutesForDemandPeriod(product);
    const demandQuantity = Math.max(product.demandQuantity, 0);
    const allocationMinutes = Object.fromEntries(visibleWorkers.map((letter) => [letter, 0]));

    getTopLevelTasks(tasks).forEach((task) => {
      const assignedOperators = getTaskOperatorIds(task, visibleWorkers);
      const taskPeriodMinutes = Math.max(task.plannedDurationMinutes, 0) * demandQuantity;

      assignedOperators.forEach((operatorId) => {
        allocationMinutes[operatorId] = (allocationMinutes[operatorId] ?? 0) + taskPeriodMinutes;
      });
    });

    return Object.fromEntries(
      visibleWorkers.map((letter) => [
        letter,
        periodMinutes > 0 ? Math.min((allocationMinutes[letter] / periodMinutes) * 100, 999) : 0,
      ]),
    );
  }, [product, tasks, visibleWorkers]);
  const roundingCreatesUnusedCapacity =
    feasible && kpis.wholePersonStaffingRequirement > 0 && kpis.wholePersonStaffingRequirement > kpis.budgetedCrewEquivalent;
  const toneClass = !feasible
    ? "border-line border-l-danger"
    : roundingCreatesUnusedCapacity
      ? "border-line border-l-warn"
      : "border-line border-l-accent";
  const statusClass = !feasible
    ? "border-danger/25 bg-danger-muted/10 text-danger"
    : roundingCreatesUnusedCapacity
      ? "border-warn/30 bg-warn-muted/20 text-warn-strong"
      : "border-accent/20 bg-accent/10 text-accent";
  const statusLabel = feasible ? "Feasible" : "Needs Review";
  const planChecks = [
    {
      label: "Planned MH/unit",
      value: `${formatManHours(kpis.plannedManHours)} / ${formatManHours(product.targetManHours)}`,
      fits: plannedLaborFits,
    },
    {
      label: "Planned Load",
      value: `${round(kpis.plannedLaborLoadFte, 2)} / ${round(kpis.budgetedCrewEquivalent, 2)} FTE`,
      fits: plannedFteFits,
    },
    {
      label: "Peak Manpower",
      value: `${round(kpis.peakManpower, 1)} / ${kpis.wholePersonStaffingRequirement}`,
      fits: peakFits,
    },
    ...(kpis.unassignedTaskCount > 0
      ? [
          {
            label: "Unassigned Labor",
            value: `${formatManHours(kpis.unassignedPlannedManHours)} · ${kpis.unassignedTaskCount} task(s)`,
            fits: false,
          },
        ]
      : []),
  ];

  const expandedBody = expanded ? (
    <>
      <div className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "xl:grid-cols-[250px_minmax(0,1fr)_220px]"}`}>
        <div className={`space-y-2 ${compact ? "" : "xl:border-r xl:border-line xl:pr-4"}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Rounded Staffing</span>
            <span className="text-sm font-medium text-ink">{kpis.wholePersonStaffingRequirement} people</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Avg Allocation</span>
            <span className="text-sm font-medium text-ink">{round(kpis.requiredAverageAllocationPercent, 1)}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Labor Budget</span>
            <span className="text-sm font-medium text-ink">{formatManHours(kpis.targetLaborBudgetManHours)}/{period}</span>
          </div>
        </div>

        <div className={`min-w-0 ${compact ? "border-t border-line pt-3" : "xl:border-r xl:border-line xl:px-4"}`}>
          <div className="mb-2 ui-mono-label">Plan Fit</div>
          <div className={`grid gap-x-5 gap-y-2 ${compact ? "grid-cols-1" : "sm:grid-cols-4"}`}>
            {planChecks.map((check) => (
              <div key={check.label} className="min-w-0">
                <div className="flex items-center gap-1.5 ui-mono-label">
                  <span className={`h-1.5 w-1.5 rounded-full ${check.fits ? "bg-accent" : "bg-danger"}`} />
                  {check.label}
                </div>
                <div className={`mt-1 text-sm font-medium ${check.fits ? "text-ink" : "text-danger"}`}>{check.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`min-w-0 bg-surface ${compact ? "border-t border-line pt-3" : "xl:pl-1"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="ui-mono-label">Operators</div>
            <div className="text-[10px] font-medium text-steel">
              {visibleWorkerCount}/{kpis.wholePersonStaffingRequirement}
            </div>
          </div>
          {visibleWorkers.length ? (
            <div className="grid grid-cols-4 gap-x-2 gap-y-2">
              {visibleWorkers.map((letter, index) => {
                const allocation = operatorAllocations[letter] ?? 0;
                return (
                  <div
                    key={letter}
                    className="flex min-w-0 flex-col items-center gap-0.5 bg-surface"
                    title={`Operator ${letter}: ${allocation}% allocated`}
                  >
                    <WorkerIcon colorIndex={index} letter={letter} />
                    <span className="text-[9px] font-medium leading-none text-steel">{round(allocation, 0)}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] font-semibold text-steel">No staffing requirement yet.</div>
          )}
          {kpis.wholePersonStaffingRequirement > WORKER_ICON_LETTERS.length ? (
            <div className="mt-2 text-[10px] font-semibold text-steel">First {WORKER_ICON_LETTERS.length} icons shown.</div>
          ) : null}
        </div>
      </div>

      {!embedded ? (
        <PlanningRecommendationsPanel
          compact={compact}
          onClear={onClearPlanningRecommendations}
          recommendations={planningRecommendations}
          onOpenTaskDetail={onOpenTaskDetail}
        />
      ) : null}
    </>
  ) : null;

  if (embedded) {
    return (
      <div className="ui-planner-crew">
        <div className="ui-metric-strip ui-planner-crew-metrics">
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Budgeted crew</div>
            <div className="ui-metric-card-value">{round(kpis.budgetedCrewEquivalent, 2)} FTE</div>
            <div className="ui-metric-card-meta">
              {kpis.wholePersonStaffingRequirement} people · {round(kpis.requiredAverageAllocationPercent, 1)}% avg
            </div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Peak manpower</div>
            <div className="ui-metric-card-value">{round(kpis.peakManpower, 1)}</div>
            <div className="ui-metric-card-meta">Rounded {kpis.wholePersonStaffingRequirement}</div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Planned load</div>
            <div className="ui-metric-card-value">{round(kpis.plannedLaborLoadFte, 2)} FTE</div>
            <div className="ui-metric-card-meta">Budget {round(kpis.budgetedCrewEquivalent, 2)} FTE</div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Status</div>
            <div className={`ui-metric-card-value ${feasible ? "" : "text-danger"}`}>{statusLabel}</div>
            {planningRecommendations.length > 0 ? (
              <div className="ui-metric-card-meta text-warn-strong">{planningRecommendations.length} open</div>
            ) : null}
          </div>
        </div>
        {planningRecommendations.length > 0 ? (
          <PlanningRecommendationsPanel
            compact
            embedded
            onClear={onClearPlanningRecommendations}
            recommendations={planningRecommendations}
            onOpenTaskDetail={onOpenTaskDetail}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`ui-crew-card rounded-md border border-l-4 bg-surface ${expanded ? "p-3" : "p-3"} ${toneClass}`}>
      <div
        className={`flex flex-wrap items-start justify-between gap-3 ${expanded ? "border-b border-line pb-3" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="ui-eyebrow">Budgeted Crew</div>
          <div className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-1">
            <span className="text-xl font-medium leading-none tracking-normal text-ink">
              {round(kpis.budgetedCrewEquivalent, 2)}
            </span>
            <span className="pb-0.5 text-xs ui-mono-label text-ink">FTE</span>
            {!expanded ? (
              <span className="pb-0.5 text-[11px] font-medium text-ink-secondary">
                · {kpis.wholePersonStaffingRequirement} people · {round(kpis.requiredAverageAllocationPercent, 1)}% avg
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {planningRecommendations.length > 0 ? (
            <span className="inline-flex h-6 items-center rounded border border-warn/35 bg-accent-muted px-2 text-[10px] ui-mono-label tracking-wide text-warn-strong">
              {planningRecommendations.length} open
            </span>
          ) : null}
          <span className={`inline-flex h-7 items-center rounded border px-2 text-[11px] ui-mono-label ${statusClass}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-ink-secondary transition hover:border-line hover:bg-surface-muted hover:text-ink"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse crew plan" : "Expand crew plan"}
            title={expanded ? "Collapse crew plan" : "Expand crew plan"}
          >
            {expanded ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {expandedBody}
    </div>
  );
}

function PlanningRecommendationsPanel({
  compact = false,
  embedded = false,
  onClear,
  onOpenTaskDetail,
  recommendations,
}: {
  compact?: boolean;
  embedded?: boolean;
  onClear?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  recommendations: UnallocatedWorkReview[];
}) {
  const [showAll, setShowAll] = useState(false);

  if (recommendations.length === 0) {
    return null;
  }

  const visibleRecommendations = embedded
    ? recommendations.slice(0, 3)
    : showAll
      ? recommendations
      : recommendations.slice(0, 4);
  const hiddenCount = recommendations.length - visibleRecommendations.length;

  if (embedded) {
    return (
      <div className="ui-planner-recommendations">
        <div className="ui-planner-readiness-section-head">
          <div>
            <div className="ui-planner-recommendations-title">Open allocations</div>
            <p className="ui-planner-recommendations-subtitle">
              {recommendations.length} required task{recommendations.length === 1 ? "" : "s"} still unallocated
            </p>
          </div>
          {onClear ? (
            <button type="button" onClick={onClear} className="ui-btn-ghost h-8 px-2 text-xs">
              Clear
            </button>
          ) : null}
        </div>

        <div>
          {visibleRecommendations.map((recommendation) => (
            <div key={recommendation.taskId} className="ui-planner-recommendation-row">
              <div className="min-w-0 flex-1">
                <div className="ui-planner-recommendation-title truncate" title={recommendation.taskLabel}>
                  {recommendation.taskLabel}
                </div>
                <div className="ui-planner-recommendation-condition">{recommendation.condition}</div>
                <div className="ui-planner-recommendation-copy">{recommendation.recommendation}</div>
              </div>
              {onOpenTaskDetail ? (
                <button
                  type="button"
                  onClick={() => onOpenTaskDetail(recommendation.taskId)}
                  className="ui-btn-ghost h-8 shrink-0 px-2 text-xs"
                >
                  Review
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {hiddenCount > 0 ? (
          <p className="ui-planner-recommendations-more">
            {hiddenCount} more in the Smart Allocation audit packet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-planner-recommendations-compact mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] ui-mono-label tracking-wide text-warn-strong">
            <AlertTriangle size={13} />
            Planning Recommendations
          </div>
          <div className="mt-1 text-[11px] leading-snug text-steel">
            {recommendations.length} allocation issue{recommendations.length === 1 ? "" : "s"} need review.
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hiddenCount > 0 || showAll ? (
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              className="ui-btn-ghost h-7 px-2 text-[10px]"
            >
              {showAll ? "Show less" : `Show all ${recommendations.length}`}
            </button>
          ) : null}
          {onClear ? (
            <button type="button" onClick={onClear} className="ui-btn-ghost h-7 px-2 text-[10px]">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 divide-y divide-line border-y border-line">
        {visibleRecommendations.map((recommendation) => (
          <div key={recommendation.taskId} className="grid gap-2 py-2.5 text-xs lg:grid-cols-[minmax(150px,0.7fr)_minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium text-ink" title={recommendation.taskLabel}>
                {recommendation.taskLabel}
              </div>
              <div className="mt-0.5 text-[10px] ui-mono-label text-warn-strong">{recommendation.classification}</div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] leading-snug text-steel" title={recommendation.condition}>
                {recommendation.condition}
              </div>
              <div className="truncate text-[11px] leading-snug text-ink" title={recommendation.recommendation}>
                {recommendation.recommendation}
              </div>
            </div>
            {onOpenTaskDetail ? (
              <button
                type="button"
                onClick={() => onOpenTaskDetail(recommendation.taskId)}
                className="ui-btn-ghost h-7 justify-self-start px-2 text-[10px] lg:justify-self-end"
              >
                Review
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineReadinessPanel({
  allocationRecommendations,
  onClearPlanningRecommendations,
  scenarioName,
  stationCount,
  taskCount,
  zones,
  tasks,
  bottleneckStation,
  targetVariance,
  targetVariancePercent,
  kpis,
  onOpenTaskDetail,
  product,
  compact = false,
  embedded = false,
}: {
  allocationRecommendations?: UnallocatedWorkReview[];
  onClearPlanningRecommendations?: () => void;
  scenarioName: string;
  stationCount: number;
  taskCount: number;
  zones: Zone[];
  tasks: Task[];
  bottleneckStation?: Station;
  targetVariance: number;
  targetVariancePercent: number;
  kpis: ReturnType<typeof calculateProductKpis>;
  onOpenTaskDetail?: (taskId: string) => void;
  product: Product;
  compact?: boolean;
  embedded?: boolean;
}) {
  const content = (
    <div className={embedded ? "ui-planner-readiness" : "space-y-5"}>
      {!embedded ? (
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="ui-section-title text-base">Line readiness</h2>
            <div className="ui-section-subtitle">{scenarioName}</div>
          </div>
          <Timer className="text-accent" size={20} />
        </div>
      ) : (
        <div className="ui-planner-readiness-head">
          <h2 className="ui-section-title">Line readiness</h2>
          <p className="ui-section-subtitle">{scenarioName}</p>
        </div>
      )}

      {!embedded ? (
        <div>
          <div className="mb-3 ui-mono-label">Line summary</div>
          <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
            <StatCard label="Stations" value={`${stationCount}`} meta="High-level tasks" />
            <StatCard label="Tasks" value={`${taskCount}`} meta="Schedulable rows" />
            <StatCard
              label="Bottleneck"
              value={bottleneckStation ? `${bottleneckStation.sequence}` : "-"}
              meta={bottleneckStation?.name ?? "No scheduled work"}
              tone={bottleneckStation ? (bottleneckStation.taktStatus === "red" ? "bad" : "warn") : "neutral"}
            />
            <StatCard
              label="Variance"
              value={formatManHours(targetVariance)}
              meta={`${round(targetVariancePercent, 1)}% vs target`}
              tone={targetVariance <= 0 ? "good" : "bad"}
            />
          </div>
        </div>
      ) : null}

      <section className={embedded ? "ui-planner-readiness-section" : undefined}>
        {embedded ? (
          <div className="ui-planner-readiness-section-head">
            <div>
              <h3 className="ui-planner-readiness-section-title">Crew plan</h3>
              <p className="ui-section-subtitle">Budget, load, and staffing fit</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 ui-mono-label">Crew plan</div>
        )}
        <CrewReadinessCard
          kpis={kpis}
          onClearPlanningRecommendations={onClearPlanningRecommendations}
          onOpenTaskDetail={onOpenTaskDetail}
          planningRecommendations={allocationRecommendations}
          product={product}
          tasks={tasks}
          compact={compact || embedded}
          embedded={embedded}
        />
      </section>

      <section className={embedded ? "ui-planner-readiness-section" : undefined}>
        {embedded ? (
          <div className="ui-planner-readiness-section-head">
            <div>
              <h3 className="ui-planner-readiness-section-title">Zones</h3>
              <p className="ui-section-subtitle">Headcount, man-hours, and cycle by area</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 ui-mono-label">Zone metrics</div>
        )}
        <ZoneMetricsPanel zones={zones} tasks={tasks} compact={compact || embedded} embedded={embedded} />
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <section className="ui-readiness-workspace">{content}</section>;
}

function StationBalance({
  stations,
  taktMinutes,
  selectedStationId,
  onSelectStation,
  onUpdateOperators,
}: {
  stations: Station[];
  taktMinutes: number;
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
  onUpdateOperators: (stationId: string, operators: number) => void;
}) {
  const maxCycle = Math.max(...stations.map((station) => station.plannedCycleMinutes), taktMinutes, 1);

  return (
    <section className="ui-panel p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-ink">Station Balance</h2>
          <div className="text-xs font-semibold text-steel">Takt line: {formatMinutes(taktMinutes)}</div>
        </div>
        <BarChart3 className="text-accent" size={22} />
      </div>
      <div className="space-y-3">
        {stations.map((station) => {
          const width = Math.max((station.plannedCycleMinutes / maxCycle) * 100, 3);
          const taktPosition = Math.min((taktMinutes / maxCycle) * 100, 100);
          return (
            <button
              key={station.id}
              type="button"
              onClick={() => onSelectStation(station.id)}
              className={`w-full rounded border p-3 text-left transition ${
                selectedStationId === station.id ? "border-accent bg-accent-muted" : "border-line bg-surface-raised hover:bg-surface-sunken"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    {station.sequence}. {station.name}
                  </div>
                  <div className="text-xs font-semibold text-steel">
                    {formatMinutes(station.plannedCycleMinutes)} / {formatManHours(station.plannedManHours)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {station.bottleneckFlag ? <AlertTriangle size={17} className="text-danger" /> : null}
                  <StatusPill status={station.taktStatus} />
                </div>
              </div>
              <div className="relative h-5 overflow-hidden rounded bg-surface-sunken">
                <div className="absolute inset-y-0 w-[2px] bg-danger" style={{ left: `${taktPosition}%` }} />
                <div
                  className={`h-full rounded ${station.bottleneckFlag ? "bg-danger" : "bg-accent"}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-steel">
                <span>Operators</span>
                <ClearableNumberInput
                  aria-label={`${station.name} operators`}
                  className="number-input h-8 w-16 rounded border border-line bg-surface px-2 text-right font-bold text-ink outline-none"
                  value={station.plannedOperators}
                  min={0}
                  fallbackValue={station.plannedOperators}
                  precision={0}
                  normalize={Math.round}
                  onClick={(event) => event.stopPropagation()}
                  onValueChange={(value) => onUpdateOperators(station.id, value)}
                />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DetailDrawer({
  task,
  station,
  zones,
  components,
  tasks,
  collapsed,
  isResizing,
  onConfirmAction,
  onStepDeleted,
  onToggleCollapsed,
  onResizeStart,
  onUpdateTask,
  getProcedureFieldValue,
  onProcedureFieldFocus,
  onProcedureFieldBlur,
  onProcedureFieldChange,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onAddStepTool,
  onRemoveStepTool,
  toolLibrary,
  masterBom,
}: {
  task?: Task;
  station?: Station;
  zones: Zone[];
  components: ManufacturingComponent[];
  tasks: Task[];
  collapsed: boolean;
  isResizing: boolean;
  masterBom?: MasterBom;
  onConfirmAction: (message: FeedbackConfirm) => void;
  onStepDeleted: (taskSnapshot: Task, step: ManufacturingStep) => void;
  onToggleCollapsed: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  getProcedureFieldValue: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) => string;
  onProcedureFieldFocus: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) => void;
  onProcedureFieldBlur: (taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) => void;
  onProcedureFieldChange: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    value: string,
  ) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
  toolLibrary: string[];
}) {
  const drawerClass = `relative hidden h-full min-h-0 overflow-hidden border-l border-line transition-colors duration-300 ease-out xl:block ${
    collapsed ? "bg-accent text-canvas" : "bg-surface-raised text-ink"
  }`;
  const railClass = `absolute inset-0 flex flex-col items-center pb-44 transition-all duration-200 ease-out ${
    collapsed ? "translate-x-0 opacity-100 delay-100" : "pointer-events-none -translate-x-2 opacity-0"
  }`;
  const contentClass = `h-full overflow-auto p-4 pb-44 transition-all duration-200 ease-out ${
    collapsed ? "pointer-events-none translate-x-3 opacity-0" : "translate-x-0 opacity-100 delay-75"
  }`;
  const [newStepToolNames, setNewStepToolNames] = useState<Record<string, string>>({});
  const [newStepPartNumbers, setNewStepPartNumbers] = useState<Record<string, string>>({});
  const [stepPhotoUploadCounts, setStepPhotoUploadCounts] = useState<Record<string, number>>({});
  const stepCheckDefinitions = getManufacturingStepCheckDefinitions();
  const collapsedRail = (
    <div aria-hidden={!collapsed} className={railClass}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="mt-4 flex h-8 w-8 items-center justify-center rounded bg-surface/10 text-canvas transition hover:bg-surface/20"
        title="Expand selected task drawer"
        aria-label="Expand selected task drawer"
      >
        <ChevronsLeft size={16} />
      </button>
      <div
        className="mt-5 max-h-[220px] max-w-[20px] text-center text-[10px] ui-mono-label tracking-wide text-white/70"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Selected Task
      </div>
      <div className="mt-4 flex h-8 w-8 items-center justify-center rounded border border-line/15 bg-surface/10 text-[11px] font-medium">
        {task ? taskDisplayCode(task) : "-"}
      </div>
    </div>
  );
  const resizeHandle = collapsed ? null : (
    <button
      type="button"
      onPointerDown={onResizeStart}
      className={`absolute left-0 top-0 z-30 h-full w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none transition ${
        isResizing ? "bg-accent/10" : "hover:bg-accent/10 focus-visible:bg-accent/10"
      }`}
      aria-label="Resize selected task drawer"
      title="Drag to resize selected task drawer"
    >
      <span
        className={`absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
          isResizing ? "bg-accent" : "bg-steel/25"
        }`}
      />
    </button>
  );

  if (!task || !station) {
    return (
      <aside data-detail-drawer="true" data-drawer-state={collapsed ? "collapsed" : "expanded"} className={drawerClass}>
        {resizeHandle}
        {collapsedRail}
        <div aria-hidden={collapsed} className={contentClass}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-ink">Detail</div>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-steel transition hover:bg-surface-sunken"
              title="Collapse selected task drawer"
              aria-label="Collapse selected task drawer"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      </aside>
    );
  }

  const taskId = task.id;
  const currentTask = task;
  const manufacturingSteps = task.manufacturingSteps ?? [];
  const manufacturingStepDurationMinutes = manufacturingSteps.reduce(
    (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
    0,
  );
  const durationIsStepDerived = manufacturingSteps.length > 0;
  const partReferences = task.partReferences ?? [];
  const availableComponents = components.filter((component) => component.active || component.id === task.componentId);

  function patchManufacturingSteps(nextSteps: ManufacturingStep[]) {
    const normalizedSteps = nextSteps
      .map((step, index) => ({ step, index }))
      .sort((left, right) => left.step.sequence - right.step.sequence || left.index - right.index)
      .map(({ step }, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = normalizedSteps.length
      ? normalizedSteps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0)
      : currentTask.plannedDurationMinutes;

    onUpdateTask(taskId, {
      manufacturingSteps: normalizedSteps,
      plannedDurationMinutes,
    });
  }

  function updateManufacturingStep(stepId: string, patch: Partial<ManufacturingStep>) {
    patchManufacturingSteps(manufacturingSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
  }

  function addManufacturingStep() {
    patchManufacturingSteps([
      ...manufacturingSteps,
      {
        id: `step-${taskId}-${Date.now()}`,
        sequence: manufacturingSteps.length + 1,
        instruction: "",
        durationMinutes: manufacturingSteps.length === 0 ? currentTask.plannedDurationMinutes : 0,
        qualityCheck: "",
      },
    ]);
  }

  function removeManufacturingStep(stepId: string) {
    const stepToDelete = manufacturingSteps.find((step) => step.id === stepId);
    const nextSteps = manufacturingSteps
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = nextSteps.length
      ? nextSteps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0)
      : currentTask.plannedDurationMinutes;
    const nextTask = removeStepScopedCustomFields(currentTask, stepId);

    onUpdateTask(taskId, {
      manufacturingSteps: nextSteps,
      plannedDurationMinutes,
      customFields: nextTask.customFields,
    });

    if (stepToDelete) {
      onStepDeleted(currentTask, stepToDelete);
    }
  }

  function requestRemoveManufacturingStep(stepId: string) {
    const step = manufacturingSteps.find((candidate) => candidate.id === stepId);
    if (!step) {
      return;
    }

    onConfirmAction({
      title: `Delete step ${step.sequence}?`,
      body: "This removes the manufacturing step, its tools, part links, and attached photos from this task.",
      tone: "danger",
      confirmLabel: "Delete Step",
      onConfirm: () => removeManufacturingStep(stepId),
    });
  }

  function updatePartReference(partId: string, patch: Partial<PartReference>) {
    onUpdateTask(taskId, {
      partReferences: partReferences.map((part) => (part.id === partId ? { ...part, ...patch } : part)),
    });
  }

  function addPartReference() {
    onUpdateTask(taskId, {
      partReferences: [
        ...partReferences,
        {
          id: `part-${taskId}-${Date.now()}`,
          partNumber: "",
          description: "",
          quantity: 1,
          disposition: "",
        },
      ],
    });
  }

  function removePartReference(partId: string) {
    const taskWithoutPart = {
      ...currentTask,
      partReferences: partReferences.filter((part) => part.id !== partId),
    };
    const nextTask = removePartReferenceFromSteps(taskWithoutPart, partId);

	    onUpdateTask(taskId, {
	      manufacturingSteps: nextTask.manufacturingSteps,
	      partReferences: nextTask.partReferences,
	    });
  }

  function addManufacturingStepPartReference(stepId: string) {
    const nextTask = attachPartToStep(currentTask, stepId, { partNumber: newStepPartNumbers[stepId] ?? "" }, () =>
      createAnnotationId("part"),
    );
    if (!nextTask) {
      return;
    }

    onUpdateTask(taskId, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
    setNewStepPartNumbers((current) => ({ ...current, [stepId]: "" }));
  }

  function addStepPartFromBom(stepId: string, entry: BomPartSelection) {
    const nextTask = attachPartToStep(currentTask, stepId, entry, () => createAnnotationId("part"));
    if (!nextTask) {
      return;
    }

    onUpdateTask(taskId, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
  }

	  function linkExistingPartToManufacturingStep(stepId: string, partReferenceId: string) {
	    const nextTask = addStepPartReference(currentTask, stepId, partReferenceId);
	    onUpdateTask(taskId, { manufacturingSteps: nextTask.manufacturingSteps });
	  }

	  function removeManufacturingStepPartReference(stepId: string, partReferenceId: string) {
	    const nextTask = removeStepPartReference(currentTask, stepId, partReferenceId);
	    onUpdateTask(taskId, { manufacturingSteps: nextTask.manufacturingSteps });
	  }

  function addManufacturingStepTool(stepId: string) {
    const nextTool = (newStepToolNames[stepId] ?? "").trim();
    if (!nextTool) {
      return;
    }

    const nextTask = addStepTool(currentTask, stepId, nextTool);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
    void onAddStepTool(taskId, stepId, nextTool, getStepToolList(nextTask, stepId).length);
    setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
  }

  function addManufacturingStepToolFromLibrary(stepId: string, toolName: string) {
    if (!toolName) {
      return;
    }

    const nextTask = addStepTool(currentTask, stepId, toolName);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
    void onAddStepTool(taskId, stepId, toolName, getStepToolList(nextTask, stepId).length);
  }

  function removeManufacturingStepTool(stepId: string, toolToRemove: string) {
    const nextTask = removeStepTool(currentTask, stepId, toolToRemove);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
    void onRemoveStepTool(stepId, toolToRemove);
  }

  async function uploadManufacturingStepPhotos(stepId: string, files: File[]) {
    if (files.length === 0) {
      return;
    }

    setStepPhotoUploadCounts((current) => ({ ...current, [stepId]: (current[stepId] ?? 0) + 1 }));

    try {
      await onUploadStepPhotos(taskId, stepId, files);
    } finally {
      setStepPhotoUploadCounts((current) => {
        const nextCount = Math.max(0, (current[stepId] ?? 0) - 1);
        const nextCounts = { ...current };

        if (nextCount > 0) {
          nextCounts[stepId] = nextCount;
        } else {
          delete nextCounts[stepId];
        }

        return nextCounts;
      });
    }
  }

  function removeManufacturingStepPhoto(stepId: string, photoId: string) {
    void onRemoveStepPhoto(taskId, stepId, photoId);
  }

  function updateManufacturingStepPhoto(stepId: string, photoId: string, patch: Partial<StepPhotoAttachment>) {
    const nextTask = updateStepPhotoAttachment(currentTask, stepId, photoId, patch);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
  }

  function requestRemoveManufacturingStepPhoto(stepId: string, photo: StepPhotoAttachment) {
    onConfirmAction({
      title: "Delete photo?",
      body: "This removes the photo from the shared step record.",
      tone: "danger",
      confirmLabel: "Delete Photo",
      onConfirm: () => removeManufacturingStepPhoto(stepId, photo.id),
    });
  }

  return (
    <aside data-detail-drawer="true" data-drawer-state={collapsed ? "collapsed" : "expanded"} className={drawerClass}>
      {resizeHandle}
      {collapsedRail}
      <div aria-hidden={collapsed} className={contentClass}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ui-eyebrow">Selected Task</div>
            <h2 className="ui-section-title mt-1">{task.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-steel hover:bg-surface-sunken"
              title="Collapse selected task drawer"
              aria-label="Collapse selected task drawer"
            >
              <ChevronsRight size={16} />
            </button>
            <StatusPill status={task.status} />
          </div>
        </div>

        <div className="space-y-4">
        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-steel">Manufacturing Code</div>
          <div className="mb-3 font-mono text-lg font-bold text-ink">{taskDisplayCode(task)}</div>
          <div className="mb-3 rounded border border-line bg-surface-sunken px-2 py-1.5 font-mono text-xs font-semibold text-steel">
            {documentDisplayCode(task) || "Work instruction code pending"}
          </div>
          <div className="grid gap-2">
            <label className="block">
              <span className="ui-field-label">Zone</span>
              <ThemedSelect
                value={task.zoneId ?? ""}
                options={[
                  { value: "", label: "Unzoned" },
                  ...zones.map((zone) => ({ value: zone.id, label: `${zone.code || zone.name} - ${zone.name}` })),
                ]}
                onChange={(zoneId) => onUpdateTask(task.id, { zoneId: zoneId || undefined })}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Component</span>
              <ThemedSelect
                value={task.componentId ?? ""}
                options={[
                  { value: "", label: "No component" },
                  ...availableComponents.map((component) => ({
                    value: component.id,
                    label: `${component.code || "CODE"} - ${component.name || "Unnamed component"}`,
                  })),
                ]}
                onChange={(componentId) => {
                  const nextNumber = componentId ? nextTaskNumberForComponent(tasks, componentId, task.zoneId) : undefined;
                  onUpdateTask(task.id, { componentId: componentId || undefined, taskNumber: task.taskNumber ?? nextNumber });
                }}
              />
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <NumericField
                label="Task Number"
                value={task.taskNumber ?? 0}
                onChange={(value) => onUpdateTask(task.id, { taskNumber: Math.max(0, Math.round(value)) || undefined })}
              />
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(task.codeLocked)}
                  onChange={(event) => onUpdateTask(task.id, { codeLocked: event.target.checked })}
                />
                Lock
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateTask(task.id, {
                  manufacturingCode: generateTaskCode(task, zones, components) || undefined,
                  codeGeneratedAt: new Date().toISOString(),
                  codeLocked: false,
                })
              }
              className="ui-btn-ghost h-8 gap-2"
            >
              <RotateCcw size={13} />
              Regenerate
            </button>
          </div>
        </div>
        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-steel">Station</div>
          <div className="text-sm font-bold text-ink">{station.sequence}. {station.name}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-steel">
            <span>Cycle {formatMinutes(station.plannedCycleMinutes)}</span>
            <span>{formatManHours(station.plannedManHours)}</span>
            <span>Operators {station.plannedOperators}</span>
            <span>{station.bottleneckFlag ? "Bottleneck" : "Balanced"}</span>
          </div>
        </div>

        <label className="block">
          <span className="ui-field-label">Description</span>
          <textarea
            className="ui-field-standalone min-h-[110px] resize-none py-2"
            value={task.description ?? ""}
            onChange={(event) => onUpdateTask(task.id, { description: event.target.value })}
          />
        </label>

        <div className="ui-panel p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs ui-mono-label tracking-wide text-steel">Manufacturing Steps</div>
              <div className="text-xs font-semibold text-steel">{manufacturingSteps.length} step(s)</div>
            </div>
            <button
              type="button"
              onClick={addManufacturingStep}
              className="ui-btn-primary h-8 gap-1 px-3 text-xs"
            >
              <Plus size={14} />
              Step
            </button>
          </div>
          {manufacturingSteps.length === 0 ? (
            <div className="border-t border-dashed border-line px-1 py-2 text-xs font-semibold text-steel">
              Add operation-level steps for this task.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-2">
                {manufacturingSteps.map((step) => {
                  const stepPhotos = getStepPhotoAttachments(currentTask, step.id);
                  const stepTools = getStepToolList(currentTask, step.id);
                  const generatedStepCode = stepDisplayCode(currentTask, step);

                  return (
                    <div
                      key={step.id}
                      className="grid grid-cols-[minmax(0,1fr)_22px] gap-1.5 border-b border-line/70 px-1 pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1 ui-mono-label">
                          <span className="max-w-[150px] shrink-0 truncate" title={generatedStepCode || `Step ${step.sequence}`}>
                            {generatedStepCode || "Step"}
                          </span>
                          <ClearableNumberInput
                            aria-label={`Step ${step.sequence} sequence`}
                            className="number-input ui-field-standalone h-6 w-8 px-0.5 text-center text-xs"
                            value={step.sequence}
                            min={1}
                            fallbackValue={step.sequence}
                            precision={0}
                            normalize={Math.round}
                            onValueChange={(value) => updateManufacturingStep(step.id, { sequence: value })}
                          />
                          <span className="ml-1 shrink-0">Min</span>
                          <ClearableNumberInput
                            aria-label={`Step ${step.sequence} duration minutes`}
                            className="number-input ui-field-standalone h-6 w-12 px-0.5 text-center text-xs"
                            value={step.durationMinutes ?? 0}
                            min={0}
                            fallbackValue={step.durationMinutes ?? 0}
                            precision={1}
                            onValueChange={(value) => updateManufacturingStep(step.id, { durationMinutes: value })}
                          />
                        </div>
                        <textarea
                          aria-label={`Step ${step.sequence} instruction`}
                          className="ui-field-standalone min-h-[86px] resize-none py-2 text-sm leading-snug"
                          value={getProcedureFieldValue(taskId, step.id, "instruction", step.instruction)}
                          onFocus={() => onProcedureFieldFocus(taskId, step.id, "instruction", step.instruction)}
                          onBlur={() => onProcedureFieldBlur(taskId, step.id, "instruction")}
                          onChange={(event) =>
                            onProcedureFieldChange(taskId, step.id, "instruction", event.target.value)
                          }
                          onKeyDown={(event) =>
                            handleInstructionBulletKeyDown(event, (instruction) =>
                              onProcedureFieldChange(taskId, step.id, "instruction", instruction),
                            )
                          }
                          placeholder="Describe the manufacturing step"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onProcedureFieldChange(
                              taskId,
                              step.id,
                              "instruction",
                              applyInstructionBullets(
                                getProcedureFieldValue(taskId, step.id, "instruction", step.instruction),
                              ),
                            )
                          }
                          className="ui-btn-ghost h-8 gap-1.5 px-2"
                          aria-label={`Format step ${step.sequence} as bullets`}
                          title={`Format step ${step.sequence} as bullets`}
                        >
                          <ListChecks size={11} />
                          Bullets
                        </button>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="ui-mono-label">Tools</span>
                            {toolLibrary.length > 0 ? (
                              <ThemedSelect
                                aria-label={`Add saved tool to step ${step.sequence}`}
                                value=""
                                className="max-w-[150px]"
                                triggerClassName="h-7 px-1.5 text-[10px]"
                                options={[
                                  { value: "", label: "Library" },
                                  ...toolLibrary
                                    .filter((tool) => !stepTools.some((stepTool) => stepTool.toLocaleLowerCase() === tool.toLocaleLowerCase()))
                                    .map((tool) => ({ value: tool, label: tool })),
                                ]}
                                onChange={(value) => {
                                  if (value) {
                                    addManufacturingStepToolFromLibrary(step.id, value);
                                  }
                                }}
                              />
                            ) : null}
                          </div>
                          <div className="grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-1">
                            <span className="ui-mono-label">New</span>
                            <input
                              className="h-7 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-accent"
                              value={newStepToolNames[step.id] ?? ""}
                              onChange={(event) =>
                                setNewStepToolNames((current) => ({ ...current, [step.id]: event.target.value }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  addManufacturingStepTool(step.id);
                                }
                              }}
                              placeholder="Add tool"
                            />
                            <button
                              type="button"
                              onClick={() => addManufacturingStepTool(step.id)}
                              className="h-7 text-[10px] ui-mono-label text-ink-secondary hover:text-accent"
                            >
                              Add
                            </button>
                          </div>
                          {stepTools.length > 0 ? (
                            <div className="flex flex-wrap gap-x-2 gap-y-1 pl-[42px] text-[10px] font-bold text-steel">
                              {stepTools.map((tool) => (
                                <span
                                  key={tool}
                                  className="inline-flex min-w-0 items-center gap-1"
                                >
                                  <span className="max-w-[170px] truncate">{tool}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeManufacturingStepTool(step.id, tool)}
                                    className="text-steel/70 hover:text-danger"
                                    aria-label={`Remove ${tool}`}
                                    title={`Remove ${tool}`}
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </span>
                              ))}
                            </div>
	                          ) : null}
	                        </div>
	                        <StepPartReferenceEditor
	                          task={currentTask}
	                          step={step}
	                          partReferences={partReferences}
	                          draftValue={newStepPartNumbers[step.id] ?? ""}
	                          compact
	                          masterBom={masterBom}
	                          onDraftChange={(value) =>
	                            setNewStepPartNumbers((current) => ({ ...current, [step.id]: value }))
	                          }
	                          onAddDraft={() => addManufacturingStepPartReference(step.id)}
	                          onAddFromBom={(entry) => addStepPartFromBom(step.id, entry)}
	                          onLinkExisting={(partReferenceId) => linkExistingPartToManufacturingStep(step.id, partReferenceId)}
	                          onRemove={(partReferenceId) => removeManufacturingStepPartReference(step.id, partReferenceId)}
	                        />
                        <div className="border-t border-line pt-2">
                          <StepPhotoAttachmentEditor
                            step={step}
                            photos={stepPhotos}
                            compact
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onRemove={(photoId) => removeManufacturingStepPhoto(step.id, photoId)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
                          />
                        </div>
                        <div
                          className="min-w-0"
                        >
                          <ProcedureStepChecksEditor
                            ariaLabel={`Step ${step.sequence} checks`}
                            compact
                            definitions={stepCheckDefinitions}
                            qualityCheck={step.qualityCheck}
                            onChange={(qualityCheck) => updateManufacturingStep(step.id, { qualityCheck })}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => requestRemoveManufacturingStep(step.id)}
                        className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-steel hover:bg-danger-muted hover:text-danger"
                        title="Remove step"
                        aria-label={`Remove step ${step.sequence}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="ui-panel p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs ui-mono-label tracking-wide text-steel">Part References</div>
              <div className="text-xs font-semibold text-steel">{partReferences.length} part number(s)</div>
            </div>
            <button
              type="button"
              onClick={addPartReference}
              className="ui-btn-primary h-8 gap-1 px-3 text-xs"
            >
              <Plus size={14} />
              Part
            </button>
          </div>
          <div className="space-y-3">
            {partReferences.length === 0 ? (
              <div className="rounded border border-dashed border-line bg-surface-raised p-3 text-xs font-semibold text-steel">
                Add part numbers, quantities, and disposition notes used by this task.
              </div>
            ) : null}
            {partReferences.map((part) => (
              <div key={part.id} className="rounded border border-line bg-surface-raised p-2">
                <div className="mb-2 grid grid-cols-[1fr_74px_34px] items-end gap-2">
                  <label className="block">
                    <span className="ui-field-label">Part Number</span>
                    <input
                      className="ui-field-standalone h-8 px-2 text-sm"
                      value={part.partNumber}
                      onChange={(event) => updatePartReference(part.id, { partNumber: event.target.value })}
                      placeholder="PN / kit / drawing ref"
                    />
                  </label>
                  <label className="block">
                    <span className="ui-field-label">Qty</span>
                    <ClearableNumberInput
                      className="number-input ui-field-standalone h-8 px-2 text-sm"
                      value={part.quantity ?? 0}
                      min={0}
                      fallbackValue={part.quantity ?? 0}
                      precision={0}
                      normalize={Math.round}
                      onValueChange={(value) => updatePartReference(part.id, { quantity: value })}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removePartReference(part.id)}
                    className="flex h-8 items-center justify-center rounded border border-line bg-surface text-steel hover:border-danger hover:text-danger"
                    title="Remove part reference"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <label className="mb-2 block">
                  <span className="ui-field-label">Description</span>
                  <input
                    className="ui-field-standalone h-8 px-2 text-sm"
                    value={part.description ?? ""}
                    onChange={(event) => updatePartReference(part.id, { description: event.target.value })}
                    placeholder="What the reference is used for"
                  />
                </label>
                <label className="block">
                  <span className="ui-field-label">Disposition / Reference Note</span>
                  <input
                    className="ui-field-standalone h-8 px-2 text-sm"
                    value={part.disposition ?? ""}
                    onChange={(event) => updatePartReference(part.id, { disposition: event.target.value })}
                    placeholder="Reuse, rework, service part, QC hold, etc."
                  />
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumericField
            label="Duration"
            value={durationIsStepDerived ? manufacturingStepDurationMinutes : task.plannedDurationMinutes}
            suffix="min"
            readOnly={durationIsStepDerived}
            onChange={(value) => onUpdateTask(task.id, { plannedDurationMinutes: value, plannedFinish: addMinutes(task.plannedStart, value) })}
          />
          <div>
            <div className="ui-field-label">Headcount</div>
            <div className="flex h-10 items-center rounded border border-line bg-surface-sunken px-3 text-lg font-medium text-ink">
              {task.plannedOperators}
            </div>
          </div>
        </div>

        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-steel">Gates</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.qualityGate}
                onChange={(event) => onUpdateTask(task.id, { qualityGate: event.target.checked })}
              />
              QC Gate
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.travelerSignoffRequired}
                onChange={(event) => onUpdateTask(task.id, { travelerSignoffRequired: event.target.checked })}
              />
              Traveler
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.criticalPath}
                onChange={(event) => onUpdateTask(task.id, { criticalPath: event.target.checked })}
              />
              Critical
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.bottleneckFlag}
                onChange={(event) => onUpdateTask(task.id, { bottleneckFlag: event.target.checked })}
              />
              Flag
            </label>
          </div>
        </div>

        <label className="block">
          <span className="ui-field-label">Safety Notes</span>
          <textarea
            className="ui-field-standalone min-h-[88px] resize-none py-2"
            value={task.safetyNotes ?? ""}
            onChange={(event) => onUpdateTask(task.id, { safetyNotes: event.target.value })}
          />
        </label>
        </div>
      </div>
    </aside>
  );
}

function PlaybackPanel({
  tasks,
  stations,
  currentMinute,
  speed,
  isPlaying,
  collapsed,
  onPlayPause,
  onReset,
  onStep,
  onSpeed,
  onToggleCollapsed,
}: {
  tasks: Task[];
  stations: Station[];
  currentMinute: number;
  speed: number;
  isPlaying: boolean;
  collapsed: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onStep: (delta: number) => void;
  onSpeed: (speed: number) => void;
  onToggleCollapsed: () => void;
}) {
  const bounds = getTimelineBounds(tasks);
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const activeTasks = tasks.filter((task) => {
    const window = getTaskWindow(task, bounds.startMs);
    return currentMinute >= window.startMinute && currentMinute < window.finishMinute;
  });
  const operatorsActive = activeTasks.reduce((total, task) => total + task.plannedOperators, 0);
  const consumedManHours = tasks.reduce((total, task) => {
    const window = getTaskWindow(task, bounds.startMs);
    if (currentMinute >= window.finishMinute) {
      return total + task.plannedManHours;
    }

    if (currentMinute > window.startMinute) {
      const progress = Math.min((currentMinute - window.startMinute) / Math.max(task.plannedDurationMinutes, 1), 1);
      return total + task.plannedManHours * progress;
    }

    return total;
  }, 0);
  const events = buildPlaybackEvents(tasks, bounds.startMs, currentMinute);
  const nextMilestone = tasks
    .filter((task) => task.rowType === "milestone")
    .find((task) => getTaskWindow(task, bounds.startMs).finishMinute > currentMinute);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface text-ink">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="absolute left-1/2 top-0 flex h-7 w-10 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-xl border border-b-0 border-line bg-surface text-ink-secondary hover:text-ink"
        title={collapsed ? "Expand playback footer" : "Collapse playback footer"}
        aria-label={collapsed ? "Expand playback footer" : "Collapse playback footer"}
      >
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {collapsed ? (
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-canvas hover:opacity-90"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <div className="text-[11px] font-semibold text-ink-secondary">Simulation time</div>
            <div className="font-mono text-sm font-semibold text-ink">{formatMinutes(currentMinute)}</div>
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min((currentMinute / bounds.durationMinutes) * 100, 100)}%` }}
              />
            </div>
            <div className="truncate text-xs font-medium text-ink-secondary">{activeTasks[0]?.name ?? "Idle"}</div>
          </div>
        </div>
      ) : (
      <div className="grid min-h-36 gap-3 px-4 py-3 lg:grid-cols-[360px_minmax(0,1fr)_420px]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-canvas hover:opacity-90"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              type="button"
              onClick={() => onStep(-15)}
              className="flex h-10 w-10 items-center justify-center ui-panel text-ink-secondary hover:bg-surface-muted hover:text-ink"
              title="Step back"
            >
              <SkipBack size={17} />
            </button>
            <button
              type="button"
              onClick={() => onStep(15)}
              className="flex h-10 w-10 items-center justify-center ui-panel text-ink-secondary hover:bg-surface-muted hover:text-ink"
              title="Step forward"
            >
              <SkipForward size={17} />
            </button>
            <button
              type="button"
              onClick={onReset}
              className="flex h-10 w-10 items-center justify-center ui-panel text-ink-secondary hover:bg-surface-muted hover:text-ink"
              title="Restart"
            >
              <RotateCcw size={17} />
            </button>
            <ThemedSelect
              className="w-24"
              triggerClassName="h-10 ui-panel px-2 text-sm font-semibold"
              value={String(speed)}
              options={playbackSpeeds.map((option) => ({ value: String(option.value), label: option.label }))}
              onChange={(value) => onSpeed(safeNumber(value, speed))}
            />
          </div>
          <div className="text-[11px] font-semibold text-ink-secondary">Simulation time</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{formatMinutes(currentMinute)}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min((currentMinute / bounds.durationMinutes) * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <StatCard label="Active Tasks" value={`${activeTasks.length}`} meta={activeTasks[0]?.name ?? "Idle"} />
          <StatCard label="Operators" value={`${operatorsActive}`} meta="Active now" />
          <StatCard label="MH Burned" value={formatManHours(consumedManHours)} meta="Planned playback" />
          <StatCard label="Station" value={activeTasks[0] ? `${stationById.get(activeTasks[0].stationId)?.sequence}` : "-"} meta={activeTasks[0] ? stationById.get(activeTasks[0].stationId)?.name : "Idle"} />
          <StatCard label="Next Gate" value={nextMilestone ? nextMilestone.wbs : "-"} meta={nextMilestone?.name ?? "Complete"} />
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-surface-muted">
          <div className="flex h-8 items-center gap-2 border-b border-line px-3 text-xs font-semibold text-ink-secondary">
            <Activity size={14} />
            Event log
          </div>
          <div className="max-h-[104px] overflow-auto px-3 py-2">
            {events.map((event) => (
              <div key={`${event.time}-${event.label}`} className="grid grid-cols-[62px_1fr] gap-2 py-1 text-xs">
                <span className="font-mono font-medium text-ink-tertiary">{formatMinutes(event.time)}</span>
                <span className="truncate font-medium text-ink">{event.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </footer>
  );
}

export function LineWorkspace({
  projectId,
  projectContext,
  onReady,
}: {
  projectId?: string;
  projectContext?: PlannerProjectContext;
  onReady?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const plannerQueryString = searchParams.toString();
  const hasAutosaveHarnessParam = searchParams.get("autosaveHarness") === "1";
  const urlWorkspaceSnapshot = useMemo<Partial<WorkspaceSnapshot>>(() => {
    const params = new URLSearchParams(plannerQueryString);
    const requestedModule = params.get("view");
    return {
      activeModule: isKnownModule(requestedModule) ? requestedModule : undefined,
      selectedTaskId: params.get("task") ?? undefined,
      selectedStationId: params.get("station") ?? undefined,
      activeZoneId: params.get("zone") ?? undefined,
    };
  }, [plannerQueryString]);
  const [plannerState, setPlannerState] = useState<PlannerState>(emptyPlannerState);
  // Scenario switcher: lightweight list for the tabs + an in-flight flag for the reload-on-switch.
  // The "active" scenario is always derivedState.scenario.id (the currently loaded one), so we don't
  // track a separate id that could drift out of sync with the loaded planner state.
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [isSwitchingScenario, setIsSwitchingScenario] = useState(false);
  // The scenario id being switched to, set immediately on click so the target tab highlights right
  // away (instant feedback) even while the reload is in flight.
  const [switchTargetId, setSwitchTargetId] = useState<string | undefined>();
  // In-memory cache of loaded scenarios, keyed by scenario id, for INSTANT switching (no DB reload).
  // The active scenario's latest state is mirrored here continuously (see the effect below), so the
  // cache always matches what's saved; switching to a cached scenario is a pure in-memory setState.
  const scenarioCacheRef = useRef<Map<string, PlannerState>>(new Map());
  const [activeModule, setActiveModule] = useState("dashboard");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [setupSection, setSetupSection] = useState<SetupSection>("product");
  const [selectedTaskId, setSelectedTaskId] = useState(emptyPlannerState.tasks[0]?.id);
  const [focusedProcedureStepId, setFocusedProcedureStepId] = useState<string | undefined>();
  const [selectedStationId, setSelectedStationId] = useState(emptyPlannerState.stations[0]?.id);
  const [activeZoneId, setActiveZoneId] = useState<string>();
  const [currentMinute, setCurrentMinute] = useState(0);
  const [speed, setSpeed] = useState(5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackCollapsed, setPlaybackCollapsed] = useState(true);
  const [detailDrawerCollapsed, setDetailDrawerCollapsed] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailDrawerWidth, setDetailDrawerWidth] = useState(360);
  const [isResizingDetailDrawer, setIsResizingDetailDrawer] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  // Mirror of saveState readable synchronously inside async flows (e.g. save-before-scenario-switch).
  const saveStateRef = useRef<SaveState>("loading");
  const [saveError, setSaveError] = useState<string>();
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(() => hasRecentProjectSwitchSession());
  const [isProjectSwitching, setIsProjectSwitching] = useState(() => hasRecentProjectSwitchSession());
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const [smartAllocationPending, setSmartAllocationPending] = useState(false);
  const [dismissedPlanningRecommendationKey, setDismissedPlanningRecommendationKey] = useState("");
  const saveInFlightRef = useRef(false);
  const queuedSaveStateRef = useRef<PlannerState | null>(null);
  const plannerDirtyRef = useRef(false);
  const plannerSaveTimerRef = useRef<number | null>(null);
  const latestDerivedStateRef = useRef<PlannerState>(plannerState);
  const procedureDraftsRef = useRef<ProcedureDraftMap>({});
  const procedureEditSeqRef = useRef(0);
  const procedureSaveQueuesRef = useRef<Record<string, ProcedureTaskSaveQueue>>({});
  const procedureSaveTimersRef = useRef<Record<string, number>>({});
  const procedureRetryTimersRef = useRef<Record<string, number>>({});
  const deferredProcedureServerUpdatesRef = useRef<Record<string, DeferredProcedureServerUpdate>>({});
  const autosaveHarnessRanRef = useRef(false);
  const [, setProcedureDraftVersion] = useState(0);
  const remoteRefreshTimerRef = useRef<number | null>(null);
  const remoteRefreshAppliedRef = useRef(false);
  const pendingRemoteRefreshRef = useRef(false);
  const remoteTaskRefreshTimerRef = useRef<number | null>(null);
  const pendingRemoteTaskIdsRef = useRef<Set<string>>(new Set());
  const loadedProjectIdRef = useRef<string | undefined>(undefined);
  const hasLoadedAnyProjectRef = useRef(hasRecentProjectSwitchSession());
  const projectSwitchStartedAtRef = useRef<number | undefined>(recentProjectSwitchStartedAt());
  const projectSwitchSkeletonTimerRef = useRef<number | null>(null);
  const stablePlannerChromeContextRef = useRef<ReturnType<typeof buildPlannerChromeContext> | undefined>(undefined);
  const [projectSwitchTargetContext, setProjectSwitchTargetContext] = useState(
    () => buildProjectSwitchTargetContext(readProjectSwitchTarget()),
  );
  const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();
  const [chromeStatus, setChromeStatus] = useState<{ message: string; error?: boolean } | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<Omit<FeedbackToast, "id"> | null>(null);
  const [toolLibraryItems, setToolLibraryItems] = useState<ToolLibraryItem[]>([]);
  const chromeStatusTimerRef = useRef<number | null>(null);
  const detailDrawerResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const derivedState = useMemo<PlannerState>(() => {
    const planningContext = normalizeTaskPlanningContext(
      plannerState.tasks,
      plannerState.zones,
      plannerState.stations,
      plannerState.scenario.id,
    );
    const normalizedTasks = planningContext.tasks.map(syncTaskOperatorCount);
    const calculated = applyCalculatedFields(plannerState.product, planningContext.stations, normalizedTasks);
    return {
      ...plannerState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };
  }, [plannerState]);

  const masterBom = useMemo(
    () => getMasterBom(derivedState.product.customFields),
    [derivedState.product.customFields],
  );

  useEffect(() => {
    latestDerivedStateRef.current = derivedState;
  }, [derivedState]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  // Drop the scenario cache when the project changes (a different project = different scenarios).
  useEffect(() => {
    scenarioCacheRef.current.clear();
  }, [projectId]);

  // Keep the active scenario's latest state mirrored in the cache so a later switch back is instant
  // and reflects any edits made while it was active.
  useEffect(() => {
    if (hasLoadedRemoteState && derivedState.scenario.id !== emptyPlannerState.scenario.id) {
      scenarioCacheRef.current.set(derivedState.scenario.id, derivedState);
    }
  }, [derivedState, hasLoadedRemoteState]);

  // Load the lightweight scenario list for the switcher tabs once a real project is loaded.
  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return;
    }
    const productId = derivedState.product.id;
    if (!productId || productId === emptyPlannerState.product.id) {
      return;
    }
    let cancelled = false;
    void loadScenariosForProduct(productId)
      .then((list) => {
        if (!cancelled) {
          setScenarios(list);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [derivedState.product.id, hasLoadedRemoteState]);

  useEffect(() => {
    function handlePageHide() {
      flushPendingPlannerSave();
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flushPendingPlannerSave();
    };
  }, []);

  const kpis = useMemo(
    () => calculateProductKpis(derivedState.product, derivedState.stations, derivedState.tasks),
    [derivedState.product, derivedState.stations, derivedState.tasks],
  );

  // Main Plan = the earliest-created scenario; it always uses the canonical product-level takt so its
  // Gantt flagging is byte-identical to before this feature. Until the scenario list loads we also
  // treat the active scenario as Main (safe product fallback).
  const isMainScenario = useMemo(() => {
    if (scenarios.length === 0) {
      return true;
    }
    return derivedState.scenario.id === scenarios[0]?.id;
  }, [scenarios, derivedState.scenario.id]);

  // Takt that drives the Gantt's over-takt flagging. Non-main (projection) scenarios use their own
  // target (with a safe product-level fallback when missing/zero/invalid); Main uses the product takt.
  const activeTaktMinutes = useMemo(
    () =>
      isMainScenario
        ? kpis.taktMinutes
        : calculateActiveTaktMinutes(derivedState.product, derivedState.scenario),
    [isMainScenario, kpis.taktMinutes, derivedState.product, derivedState.scenario],
  );

  const timelineBounds = useMemo(() => getTimelineBounds(derivedState.tasks), [derivedState.tasks]);
  const totalHeadcount = kpis.peakManpower;
  const availableOperatorLetters = useMemo(
    () => WORKER_ICON_LETTERS.slice(0, Math.min(Math.max(kpis.wholePersonStaffingRequirement, 0), WORKER_ICON_LETTERS.length)),
    [kpis.wholePersonStaffingRequirement],
  );
  const operatorCapacityMinutes = useMemo(
    () => calculateAvailabilityMinutesForDemandPeriod(derivedState.product),
    [derivedState.product],
  );
  const toolLibrary = useMemo(() => buildStepToolLibrary(derivedState.tasks), [derivedState.tasks]);
  const currentOperatorAllocation = useMemo(() => buildOperatorAssignmentsFromIePlan({
    assignments: derivedState.tasks.map((task) => ({
      taskId: task.id,
      operatorIds: getTaskOperatorIds(task, availableOperatorLetters),
      rationale: "Current Gantt assignment",
    })),
    availableOperatorIds: availableOperatorLetters,
    budgetedAllocationPercent: kpis.requiredAverageAllocationPercent,
    demandQuantity: derivedState.product.demandQuantity,
    operatorCapacityMinutes,
    strategyNotes: ["Current Gantt assignments were audited for planning recommendations."],
    taktMinutes: kpis.taktMinutes,
    tasks: derivedState.tasks,
  }), [
    availableOperatorLetters,
    derivedState.product.demandQuantity,
    derivedState.tasks,
    kpis.requiredAverageAllocationPercent,
    kpis.taktMinutes,
    operatorCapacityMinutes,
  ]);
  const currentAllocationRecommendations = useMemo(() => buildUnallocatedWorkReviews({
    allocation: currentOperatorAllocation,
    kpis,
    operatorCapacityMinutes,
    product: derivedState.product,
  }), [currentOperatorAllocation, derivedState.product, kpis, operatorCapacityMinutes]);
  const currentAllocationRecommendationKey = useMemo(
    () => currentAllocationRecommendations
      .map((recommendation) => [
        recommendation.taskId,
        recommendation.classification,
        recommendation.condition,
        recommendation.action,
      ].join(":"))
      .join("|"),
    [currentAllocationRecommendations],
  );
  const visibleAllocationRecommendations =
    currentAllocationRecommendationKey && dismissedPlanningRecommendationKey === currentAllocationRecommendationKey
      ? []
      : currentAllocationRecommendations;
  const activeProjectContext = derivedState.project ?? projectContext;
  const projectToolRegistry = useMemo(
    () => buildProjectToolRegistry(derivedState.tasks, toolLibraryItems),
    [derivedState.tasks, toolLibraryItems],
  );
  const realtimeTaskIdSet = useMemo(
    () => new Set(derivedState.tasks.map((task) => task.id)),
    [derivedState.tasks],
  );
  // Keep the latest set readable from the (deliberately stable) realtime subscription without making
  // it a dependency -- otherwise the channel would tear down and re-subscribe on every task add/remove.
  const realtimeTaskIdSetRef = useRef(realtimeTaskIdSet);
  realtimeTaskIdSetRef.current = realtimeTaskIdSet;

  const [toolLibraryLoaded, setToolLibraryLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    setToolLibraryLoaded(false);

    loadToolLibraryFromSupabase(activeProjectContext?.projectId)
      .then((tools) => {
        if (active) {
          setToolLibraryItems(tools);
          setToolLibraryLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setToolLibraryItems([]);
          setToolLibraryLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [activeProjectContext?.projectId]);

  // Auto-clean existing tool names once per project (replaces the manual Tidy
  // button). Ref-guarded so it runs once and never loops on its own task write.
  // Waits for the tool library to load so library rows are migrated too (not
  // just the task strings) — otherwise a fast task load would tidy with an empty
  // library and leave the DB rows messy.
  const autoTidiedProjectRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!projectId || !hasLoadedRemoteState || isProjectSwitching || !toolLibraryLoaded) {
      return;
    }
    if (autoTidiedProjectRef.current === projectId || derivedState.tasks.length === 0) {
      return;
    }
    // Evaluate once per project after load; mark checked regardless so a fully
    // clean project doesn't rebuild the catalog on every later task edit.
    autoTidiedProjectRef.current = projectId;
    const plan = planToolNameTidy(
      buildProjectToolCatalog(derivedState.tasks, projectToolRegistry, toolLibraryItems),
    );
    if (plan.length > 0) {
      void tidyCatalogToolNames(plan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, hasLoadedRemoteState, isProjectSwitching, toolLibraryLoaded, derivedState.tasks, projectToolRegistry, toolLibraryItems]);

  useEffect(() => {
    if (!hasLoadedRemoteState || isProjectSwitching) {
      return;
    }

    writeWorkspaceSnapshot(projectId, {
      activeModule,
      selectedTaskId,
      selectedStationId,
      activeZoneId,
      detailDrawerCollapsed,
      sidebarCollapsed,
      savedAt: new Date().toISOString(),
    });
  }, [
    activeModule,
    activeZoneId,
    detailDrawerCollapsed,
    sidebarCollapsed,
    hasLoadedRemoteState,
    isProjectSwitching,
    projectId,
    selectedStationId,
    selectedTaskId,
  ]);

  useEffect(() => {
    if (!hasLoadedRemoteState || isProjectSwitching) {
      return;
    }

    const params = new URLSearchParams(plannerQueryString);
    params.set("view", activeModule);
    if (selectedTaskId) {
      params.set("task", selectedTaskId);
    } else {
      params.delete("task");
    }
    if (selectedStationId) {
      params.set("station", selectedStationId);
    } else {
      params.delete("station");
    }
    if (activeZoneId) {
      params.set("zone", activeZoneId);
    } else {
      params.delete("zone");
    }

    const nextQueryString = params.toString();
    if (nextQueryString === plannerQueryString) {
      return;
    }

    router.replace(nextQueryString ? `${pathname}?${nextQueryString}` : pathname, { scroll: false });
  }, [
    activeModule,
    activeZoneId,
    hasLoadedRemoteState,
    isProjectSwitching,
    pathname,
    plannerQueryString,
    router,
    selectedStationId,
    selectedTaskId,
  ]);

  function bumpProcedureDraftVersion() {
    setProcedureDraftVersion((version) => version + 1);
  }

  function cloneProcedureDrafts(drafts: ProcedureDraftMap = procedureDraftsRef.current): ProcedureDraftMap {
    return Object.fromEntries(Object.entries(drafts).map(([key, draft]) => [key, { ...draft }]));
  }

  function getProcedureFieldDraft(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) {
    return procedureDraftsRef.current[makeProcedureDraftKey(taskId, stepId, fieldName)];
  }

  function getProcedureFieldValue(
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) {
    const draft = getProcedureFieldDraft(taskId, stepId, fieldName);
    return draft?.active || draft?.dirty ? draft.value : fallbackValue;
  }

  function getProcedureDraftsForTask(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return Object.values(drafts).filter((draft) => draft.taskId === taskId);
  }

  function getDirtyProcedureDraftsForTask(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return getProcedureDraftsForTask(taskId, drafts).filter((draft) => draft.dirty);
  }

  function hasDirtyOrActiveProcedureDrafts(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return getProcedureDraftsForTask(taskId, drafts).some((draft) => draft.dirty || draft.active);
  }

  function maxProcedureDraftSeq(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return getProcedureDraftsForTask(taskId, drafts).reduce(
      (maxSeq, draft) => Math.max(maxSeq, draft.localEditSeq),
      0,
    );
  }

  function getProcedureTaskSaveQueue(taskId: string) {
    const existing = procedureSaveQueuesRef.current[taskId];
    if (existing) {
      return existing;
    }

    const queue: ProcedureTaskSaveQueue = {
      state: "idle",
      inFlight: false,
      pending: false,
      latestSeq: 0,
    };
    procedureSaveQueuesRef.current[taskId] = queue;
    return queue;
  }

  function hasProcedureSaveWork() {
    return (
      Object.keys(procedureSaveTimersRef.current).length > 0 ||
      Object.keys(procedureRetryTimersRef.current).length > 0 ||
      Object.values(procedureSaveQueuesRef.current).some((queue) => queue.inFlight || queue.pending)
    );
  }

  function hasPlannerShellSaveWork() {
    return saveInFlightRef.current || plannerDirtyRef.current || Boolean(plannerSaveTimerRef.current);
  }

  function hasLocalSaveWork() {
    return hasPlannerShellSaveWork() || hasProcedureSaveWork();
  }

  function generateProcedureSaveId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }

    return `procedure-save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function applyProcedureDraftsToTask(task: Task, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    const taskDrafts = getProcedureDraftsForTask(task.id, drafts).filter((draft) => draft.dirty || draft.active);
    if (taskDrafts.length === 0) {
      return task;
    }

    const draftByStepId = new Map<string, ProcedureDraftField[]>();
    taskDrafts.forEach((draft) => {
      const stepDrafts = draftByStepId.get(draft.stepId) ?? [];
      stepDrafts.push(draft);
      draftByStepId.set(draft.stepId, stepDrafts);
    });

    return {
      ...task,
      manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => {
        const stepDrafts = draftByStepId.get(step.id);
        if (!stepDrafts?.length) {
          return step;
        }

        return stepDrafts.reduce<ManufacturingStep>(
          (nextStep, draft) => ({
            ...nextStep,
            [draft.fieldName]: draft.value,
          }),
          step,
        );
      }),
    };
  }

  function updateProcedureDraftSnapshotStorage() {
    writeProcedureFieldDraftSnapshot(procedureDraftsRef.current);
  }

  function cleanupCleanProcedureDrafts(taskId?: string) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(nextDrafts).forEach(([key, draft]) => {
      if (taskId && draft.taskId !== taskId) {
        return;
      }

      const queue = procedureSaveQueuesRef.current[draft.taskId];
      const pendingReferencesDraft =
        queue?.pendingDraftSnapshot?.[key]?.localEditSeq === draft.localEditSeq ||
        queue?.pendingDraftSnapshot?.[key]?.value === draft.value;

      if (!draft.dirty && !draft.active && !pendingReferencesDraft && draft.baseValue === draft.value) {
        delete nextDrafts[key];
        changed = true;
      }
    });

    if (!changed) {
      return;
    }

    procedureDraftsRef.current = nextDrafts;
    updateProcedureDraftSnapshotStorage();
    bumpProcedureDraftVersion();
  }

  function markProcedureDraftsForTask(
    taskId: string,
    patch: Partial<Pick<ProcedureDraftField, "saveStatus" | "latestSaveId" | "savingSeq" | "error">>,
    onlyDirty = true,
  ) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(nextDrafts).forEach(([key, draft]) => {
      if (draft.taskId !== taskId || (onlyDirty && !draft.dirty)) {
        return;
      }

      nextDrafts[key] = { ...draft, ...patch };
      changed = true;
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }
  }

  function markProcedureDraftsForSave(taskId: string, saveId: string, draftSnapshot: ProcedureDraftMap) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(draftSnapshot).forEach(([key, sentDraft]) => {
      if (sentDraft.taskId !== taskId || !sentDraft.dirty || !nextDrafts[key]) {
        return;
      }

      nextDrafts[key] = {
        ...nextDrafts[key],
        latestSaveId: saveId,
        savingSeq: sentDraft.localEditSeq,
        saveStatus: "saving",
        error: undefined,
      };
      changed = true;
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }
  }

  function markProcedureStepDraftsConflict(taskId: string, stepId: string, error: string) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(nextDrafts).forEach(([key, draft]) => {
      if (draft.taskId !== taskId || draft.stepId !== stepId || (!draft.dirty && !draft.active)) {
        return;
      }

      nextDrafts[key] = { ...draft, saveStatus: "conflict", error };
      changed = true;
      procedureDraftLog("conflict detected", { ...draft, error });
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }
  }

  function mergeServerTaskIntoLocalTask(
    localTask: Task,
    serverTask: Task,
    procedureDrafts: ProcedureDraftMap = procedureDraftsRef.current,
    sourceMeta?: { source?: string },
  ) {
    const protectedDrafts = getProcedureDraftsForTask(localTask.id, procedureDrafts).filter(
      (draft) => draft.dirty || draft.active,
    );

    if (protectedDrafts.length === 0) {
      procedureDraftLog("server update merged", {
        taskId: serverTask.id,
        serverVersion: serverTask.version,
        source: sourceMeta?.source,
      });
      return serverTask;
    }

    const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
    const serverStepIds = new Set(serverStepById.keys());
    const protectedDraftsByStepId = new Map<string, ProcedureDraftField[]>();
    protectedDrafts.forEach((draft) => {
      const stepDrafts = protectedDraftsByStepId.get(draft.stepId) ?? [];
      stepDrafts.push(draft);
      protectedDraftsByStepId.set(draft.stepId, stepDrafts);
    });

    const localSteps = localTask.manufacturingSteps ?? [];
    const mergedLocalSteps = localSteps.map((localStep) => {
      const serverStep = serverStepById.get(localStep.id);
      const stepDrafts = protectedDraftsByStepId.get(localStep.id) ?? [];

      if (!serverStep && stepDrafts.length > 0) {
        markProcedureStepDraftsConflict(localTask.id, localStep.id, "Server deleted this step while it had local edits.");
        return localStep;
      }

      const mergedStep = serverStep
        ? {
            ...localStep,
            ...serverStep,
            sequence: localStep.sequence,
          }
        : localStep;

      if (stepDrafts.length === 0) {
        return mergedStep;
      }

      return stepDrafts.reduce<ManufacturingStep>(
        (nextStep, draft) => ({
          ...nextStep,
          [draft.fieldName]: draft.value,
        }),
        mergedStep,
      );
    });

    const localStepIds = new Set(localSteps.map((step) => step.id));
    const insertedServerSteps = (serverTask.manufacturingSteps ?? []).filter((step) => !localStepIds.has(step.id));
    const mergedTask = {
      ...localTask,
      ...serverTask,
      manufacturingSteps: [...mergedLocalSteps, ...insertedServerSteps],
    };

    protectedDrafts.forEach((draft) => {
      if (!serverStepIds.has(draft.stepId)) {
        return;
      }

      procedureDraftLog("merge preserving local field", {
        ...draft,
        serverVersion: serverTask.version,
        source: sourceMeta?.source,
      });
    });

    return mergedTask;
  }

  function isDeferredProcedureUpdateOlderThanLocal(localTask: Task, update: DeferredProcedureServerUpdate) {
    return (
      typeof update.serverVersion === "number" &&
      typeof localTask.version === "number" &&
      update.serverVersion < localTask.version
    );
  }

  function storeDeferredProcedureServerUpdate(update: DeferredProcedureServerUpdate) {
    const existing = deferredProcedureServerUpdatesRef.current[update.serverTask.id];
    let shouldReplace = !existing;

    if (existing) {
      if (typeof update.serverVersion === "number" && typeof existing.serverVersion === "number") {
        shouldReplace = update.serverVersion >= existing.serverVersion;
      } else if (update.serverUpdatedAt && existing.serverUpdatedAt) {
        shouldReplace = update.serverUpdatedAt >= existing.serverUpdatedAt;
      } else {
        shouldReplace = update.receivedAt >= existing.receivedAt;
      }
    }

    if (!shouldReplace) {
      procedureDraftLog("deferred update discarded", {
        taskId: update.serverTask.id,
        serverVersion: update.serverVersion,
        serverUpdatedAt: update.serverUpdatedAt,
        source: update.source,
      });
      return;
    }

    deferredProcedureServerUpdatesRef.current[update.serverTask.id] = update;
    procedureDraftLog("server update deferred", {
      taskId: update.serverTask.id,
      serverVersion: update.serverVersion,
      serverUpdatedAt: update.serverUpdatedAt,
      source: update.source,
    });
  }

  function applyDeferredProcedureServerUpdate(taskId: string) {
    const deferredUpdate = deferredProcedureServerUpdatesRef.current[taskId];
    if (!deferredUpdate || hasDirtyOrActiveProcedureDrafts(taskId)) {
      return;
    }

    delete deferredProcedureServerUpdatesRef.current[taskId];
    setPlannerState((current) => {
      const localTask = current.tasks.find((task) => task.id === taskId);
      if (!localTask) {
        return current;
      }

      if (isDeferredProcedureUpdateOlderThanLocal(localTask, deferredUpdate)) {
        procedureDraftLog("deferred update discarded", {
          taskId,
          serverVersion: deferredUpdate.serverVersion,
          serverUpdatedAt: deferredUpdate.serverUpdatedAt,
          source: deferredUpdate.source,
        });
        return current;
      }

      const nextState = {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? mergeServerTaskIntoLocalTask(task, deferredUpdate.serverTask, procedureDraftsRef.current, {
                source: deferredUpdate.source,
              })
            : task,
        ),
      };
      void writeCachedPlannerState(projectId, nextState).catch(() => undefined);
      return nextState;
    });
  }

  function markProcedureFieldActive(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName, fallbackValue: string) {
    const key = makeProcedureDraftKey(taskId, stepId, fieldName);
    const existing = procedureDraftsRef.current[key];
    const now = Date.now();
    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: existing
        ? { ...existing, active: true }
        : {
            taskId,
            stepId,
            fieldName,
            value: fallbackValue,
            baseValue: fallbackValue,
            dirty: false,
            active: true,
            localEditSeq: ++procedureEditSeqRef.current,
            lastEditedAt: now,
            saveStatus: "idle",
          },
    };
    procedureDraftLog("draft focused", procedureDraftsRef.current[key]);
    bumpProcedureDraftVersion();
  }

  function markProcedureFieldInactive(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) {
    const key = makeProcedureDraftKey(taskId, stepId, fieldName);
    const existing = procedureDraftsRef.current[key];
    if (!existing) {
      return;
    }

    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: { ...existing, active: false },
    };
    procedureDraftLog("draft blurred", procedureDraftsRef.current[key]);
    cleanupCleanProcedureDrafts(taskId);
    bumpProcedureDraftVersion();
    applyDeferredProcedureServerUpdate(taskId);
  }

  function setProcedureFieldDraft(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName, value: string) {
    const key = makeProcedureDraftKey(taskId, stepId, fieldName);
    const currentTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
    const currentStep = currentTask?.manufacturingSteps?.find((step) => step.id === stepId);
    const fallbackValue = getProcedureStepFieldValue(currentStep, fieldName);
    const existing = procedureDraftsRef.current[key];
    const now = Date.now();
    const draft: ProcedureDraftField = {
      taskId,
      stepId,
      fieldName,
      value,
      baseValue: existing?.baseValue ?? fallbackValue,
      baseVersion: existing?.baseVersion ?? currentStep?.version,
      dirty: true,
      active: true,
      localEditSeq: ++procedureEditSeqRef.current,
      lastEditedAt: now,
      saveStatus: "dirty",
    };

    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: draft,
    };
    procedureDraftLog(existing ? "draft edited" : "draft created", draft);
    updateProcedureDraftSnapshotStorage();
    bumpProcedureDraftVersion();
    return draft;
  }

  function updateProcedureStepField(
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    value: string,
  ) {
    setSaveError(undefined);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "draft"));
    setProcedureFieldDraft(taskId, stepId, fieldName, value);

    setPlannerState((current) => {
      const patchedTasks = current.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        return {
          ...task,
          manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
            step.id === stepId ? { ...step, [fieldName]: value } : step,
          ),
        };
      });
      const taskToSave = patchedTasks.find((task) => task.id === taskId);

      if (taskToSave) {
        scheduleProcedureTaskSave(applyProcedureDraftsToTask(taskToSave), patchedTasks);
      }

      return {
        ...current,
        tasks: patchedTasks,
      };
    });
  }

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
      return undefined;
    }

    type HarnessTestResult = {
      name: string;
      pass: boolean;
      detail: Record<string, unknown>;
    };
    type HarnessWindow = Window & {
      __PULSE_PROCEDURE_AUTOSAVE_HARNESS__?: {
        runAll: () => HarnessTestResult[];
      };
    };

    function harnessStep(id: string, instruction: string, name = "Harness step", version = 1): ManufacturingStep {
      return {
        id,
        sequence: 1,
        name,
        instruction,
        durationMinutes: 1,
        qualityCheck: "",
        version,
      };
    }

    function harnessTask(
      id: string,
      instruction: string,
      name = "Harness step",
      taskVersion = 1,
      stepVersion = 1,
      steps?: ManufacturingStep[],
    ): Task {
      return {
        id,
        scenarioId: "scenario-harness",
        stationId: "station-harness",
        zoneId: "zone-harness",
        rowType: "task",
        wbs: "1",
        name: "Harness task",
        description: "",
        plannedStart: "0h",
        plannedFinish: "1h",
        plannedDurationMinutes: 60,
        plannedOperators: 1,
        plannedManHours: 1,
        status: "not_started",
        percentComplete: 0,
        dependencyIds: [],
        criticalPath: false,
        bottleneckFlag: false,
        qualityGate: false,
        travelerSignoffRequired: false,
        safetyNotes: "",
        manufacturingSteps: steps ?? [harnessStep("step-harness", instruction, name, stepVersion)],
        partReferences: [],
        customFields: {},
        version: taskVersion,
      };
    }

    function harnessDraft(
      taskId: string,
      stepId: string,
      fieldName: ProcedureDraftFieldName,
      value: string,
      seq: number,
      active = true,
      dirty = true,
    ): ProcedureDraftField {
      return {
        taskId,
        stepId,
        fieldName,
        value,
        baseValue: "server-base",
        baseVersion: 1,
        dirty,
        active,
        localEditSeq: seq,
        lastEditedAt: Date.now(),
        saveStatus: dirty ? "dirty" : "saved",
      };
    }

    function withSyntheticProcedureState(run: () => HarnessTestResult[]) {
      const previousDrafts = procedureDraftsRef.current;
      const previousQueues = procedureSaveQueuesRef.current;
      const previousDeferred = deferredProcedureServerUpdatesRef.current;
      const previousStorage = window.localStorage.getItem(PROCEDURE_DRAFT_STORAGE_KEY);

      try {
        procedureDraftsRef.current = {};
        procedureSaveQueuesRef.current = {};
        deferredProcedureServerUpdatesRef.current = {};
        return run();
      } finally {
        procedureDraftsRef.current = previousDrafts;
        procedureSaveQueuesRef.current = previousQueues;
        deferredProcedureServerUpdatesRef.current = previousDeferred;
        if (previousStorage === null) {
          window.localStorage.removeItem(PROCEDURE_DRAFT_STORAGE_KEY);
        } else {
          window.localStorage.setItem(PROCEDURE_DRAFT_STORAGE_KEY, previousStorage);
        }
      }
    }

    function runDelayedSaveResponseSimulation(): HarnessTestResult {
      const taskId = "task-harness-delayed";
      const stepId = "step-harness";
      const key = makeProcedureDraftKey(taskId, stepId, "instruction");
      const valueA = "typed A";
      const valueB = "typed B";

      procedureDraftsRef.current = {
        [key]: harnessDraft(taskId, stepId, "instruction", valueA, 1),
      };
      const snapshotA = cloneProcedureDrafts();
      markProcedureDraftsForSave(taskId, "save-a", snapshotA);

      procedureDraftsRef.current = {
        ...procedureDraftsRef.current,
        [key]: harnessDraft(taskId, stepId, "instruction", valueB, 2),
      };

      const saveAConfirmed = confirmProcedureDraftsFromSave(
        taskId,
        "save-a",
        1,
        snapshotA,
        harnessTask(taskId, valueA, "Harness step", 2, 2),
      );
      const afterA = procedureDraftsRef.current[key];

      const snapshotB = cloneProcedureDrafts();
      markProcedureDraftsForSave(taskId, "save-b", snapshotB);
      const saveBConfirmed = confirmProcedureDraftsFromSave(
        taskId,
        "save-b",
        2,
        snapshotB,
        harnessTask(taskId, valueB, "Harness step", 3, 3),
      );
      const afterB = procedureDraftsRef.current[key];

      const pass =
        !saveAConfirmed &&
        afterA.value === valueB &&
        afterA.dirty &&
        saveBConfirmed &&
        afterB.value === valueB &&
        !afterB.dirty;

      return {
        name: "delayed save response",
        pass,
        detail: {
          saveAConfirmed,
          afterAValue: afterA.value,
          afterADirty: afterA.dirty,
          saveBConfirmed,
          afterBValue: afterB.value,
          afterBDirty: afterB.dirty,
        },
      };
    }

    function runRealtimeDirtyRefreshSimulation(): HarnessTestResult {
      const taskId = "task-harness-realtime";
      const stepId = "step-harness";
      const key = makeProcedureDraftKey(taskId, stepId, "instruction");
      const localValue = "local dirty";
      const oldServerValue = "old server";
      const newServerValue = "new server";
      const localTask = harnessTask(taskId, localValue, "Harness step", 4, 4);
      const oldServerTask = harnessTask(taskId, oldServerValue, "Harness step", 1, 1);
      const newerServerTask = harnessTask(taskId, newServerValue, "Harness step", 3, 3);
      const lowerVersionLaterTask = harnessTask(taskId, "lower version later", "Harness step", 2, 2);

      procedureDraftsRef.current = {
        [key]: harnessDraft(taskId, stepId, "instruction", localValue, 1),
      };

      storeDeferredProcedureServerUpdate({
        serverTask: oldServerTask,
        serverVersion: oldServerTask.version,
        receivedAt: 100,
        source: "refreshTasks",
      });
      const mergedDirty = mergeServerTaskIntoLocalTask(localTask, oldServerTask, procedureDraftsRef.current, {
        source: "refreshTasks",
      });
      storeDeferredProcedureServerUpdate({
        serverTask: newerServerTask,
        serverVersion: newerServerTask.version,
        receivedAt: 200,
        source: "realtime",
      });
      storeDeferredProcedureServerUpdate({
        serverTask: lowerVersionLaterTask,
        serverVersion: lowerVersionLaterTask.version,
        receivedAt: 300,
        source: "realtime",
      });

      const deferred = deferredProcedureServerUpdatesRef.current[taskId];
      const staleDiscarded = isDeferredProcedureUpdateOlderThanLocal(harnessTask(taskId, localValue, "Harness step", 4, 4), deferred);
      procedureDraftsRef.current[key] = {
        ...procedureDraftsRef.current[key],
        dirty: false,
        active: false,
        baseValue: localValue,
        value: localValue,
      };
      const cleanMerge = staleDiscarded
        ? localTask
        : mergeServerTaskIntoLocalTask(localTask, deferred.serverTask, procedureDraftsRef.current, { source: "realtime" });

      const pass =
        mergedDirty.manufacturingSteps?.[0]?.instruction === localValue &&
        deferred.serverTask.manufacturingSteps?.[0]?.instruction === newServerValue &&
        staleDiscarded &&
        cleanMerge.manufacturingSteps?.[0]?.instruction === localValue;

      return {
        name: "realtime/task refresh while dirty",
        pass,
        detail: {
          mergedDirtyInstruction: mergedDirty.manufacturingSteps?.[0]?.instruction,
          deferredVersion: deferred.serverVersion,
          deferredInstruction: deferred.serverTask.manufacturingSteps?.[0]?.instruction,
          staleDiscarded,
          cleanMergeInstruction: cleanMerge.manufacturingSteps?.[0]?.instruction,
        },
      };
    }

    function runFullPlannerRefreshSimulation(): HarnessTestResult {
      const taskId = "task-harness-planner-refresh";
      const stepId = "step-harness";
      const key = makeProcedureDraftKey(taskId, stepId, "name");
      const localValue = "local dirty name";
      const serverValue = "old server name";
      const localTask = harnessTask(taskId, "instruction", localValue, 2, 2);
      const serverTask = harnessTask(taskId, "instruction", serverValue, 1, 1);

      procedureDraftsRef.current = {
        [key]: harnessDraft(taskId, stepId, "name", localValue, 1),
      };

      const mergedTask = mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
        source: "refreshPlanner",
      });
      const pass = mergedTask.manufacturingSteps?.[0]?.name === localValue;

      return {
        name: "full planner refresh while typing",
        pass,
        detail: {
          mergedName: mergedTask.manufacturingSteps?.[0]?.name,
          serverName: serverValue,
        },
      };
    }

    function runServerDeletedDirtyStepSimulation(): HarnessTestResult {
      const taskId = "task-harness-deleted-step";
      const stepId = "step-harness";
      const key = makeProcedureDraftKey(taskId, stepId, "instruction");
      const localValue = "local dirty deleted step";
      const localTask = harnessTask(taskId, localValue, "Harness step", 2, 2);
      const serverTask = harnessTask(taskId, "unused", "Harness step", 3, 3, []);

      procedureDraftsRef.current = {
        [key]: harnessDraft(taskId, stepId, "instruction", localValue, 1),
      };

      const mergedTask = mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
        source: "refreshTasks",
      });
      const draft = procedureDraftsRef.current[key];
      const pass =
        mergedTask.manufacturingSteps?.some((step) => step.id === stepId && step.instruction === localValue) === true &&
        draft.saveStatus === "conflict" &&
        draft.value === localValue;

      return {
        name: "server-deleted dirty step conflict",
        pass,
        detail: {
          preservedStepCount: mergedTask.manufacturingSteps?.length ?? 0,
          draftStatus: draft.saveStatus,
          draftValue: draft.value,
        },
      };
    }

    function runCleanTaskServerUpdateSimulation(): HarnessTestResult {
      const taskId = "task-harness-clean";
      const serverValue = "server update accepted";
      const localTask = harnessTask(taskId, "local clean", "Harness step", 1, 1);
      const serverTask = harnessTask(taskId, serverValue, "Harness step", 2, 2);
      procedureDraftsRef.current = {};

      const mergedTask = mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
        source: "refreshTasks",
      });
      const pass = mergedTask.manufacturingSteps?.[0]?.instruction === serverValue && mergedTask.version === 2;

      return {
        name: "clean task server update",
        pass,
        detail: {
          mergedInstruction: mergedTask.manufacturingSteps?.[0]?.instruction,
          mergedVersion: mergedTask.version,
        },
      };
    }

    function runCleanupConfirmationSimulation(): HarnessTestResult {
      const taskId = "task-harness-cleanup";
      const stepId = "step-harness";
      const key = makeProcedureDraftKey(taskId, stepId, "instruction");
      procedureDraftsRef.current = {
        [key]: {
          ...harnessDraft(taskId, stepId, "instruction", "confirmed", 1, false, false),
          baseValue: "confirmed",
          saveStatus: "saved",
        },
      };
      cleanupCleanProcedureDrafts(taskId);
      const removedWhenConfirmed = !procedureDraftsRef.current[key];

      procedureDraftsRef.current = {
        [key]: {
          ...harnessDraft(taskId, stepId, "instruction", "not-confirmed", 2, false, false),
          baseValue: "different-server-value",
          saveStatus: "saved",
        },
      };
      cleanupCleanProcedureDrafts(taskId);
      const keptWhenNotConfirmed = Boolean(procedureDraftsRef.current[key]);

      return {
        name: "cleanup confirmation guard",
        pass: removedWhenConfirmed && keptWhenNotConfirmed,
        detail: {
          removedWhenConfirmed,
          keptWhenNotConfirmed,
        },
      };
    }

    const harnessWindow = window as HarnessWindow;
    const shouldRunHarness = hasAutosaveHarnessParam && !autosaveHarnessRanRef.current;
    const runAllHarnessTests = () =>
        withSyntheticProcedureState(() => [
          runDelayedSaveResponseSimulation(),
          runRealtimeDirtyRefreshSimulation(),
          runFullPlannerRefreshSimulation(),
          runServerDeletedDirtyStepSimulation(),
          runCleanTaskServerUpdateSimulation(),
          runCleanupConfirmationSimulation(),
          {
            name: "updatedAt watch item",
            pass: true,
            detail: {
              status: "Task has no updatedAt field; deferred freshness relies on version first, then serverUpdatedAt if provided, then receivedAt.",
            },
          },
        ]);
    const handleHarnessRun = () => {
      document.documentElement.dataset.pulseProcedureAutosaveHarnessResult = JSON.stringify(runAllHarnessTests());
    };
    harnessWindow.__PULSE_PROCEDURE_AUTOSAVE_HARNESS__ = {
      runAll: runAllHarnessTests,
    };
    document.documentElement.dataset.pulseProcedureAutosaveHarnessReady = "true";
    if (shouldRunHarness) {
      autosaveHarnessRanRef.current = true;
      handleHarnessRun();
    }

    return () => {
      delete harnessWindow.__PULSE_PROCEDURE_AUTOSAVE_HARNESS__;
      autosaveHarnessRanRef.current = false;
      delete document.documentElement.dataset.pulseProcedureAutosaveHarnessReady;
      delete document.documentElement.dataset.pulseProcedureAutosaveHarnessResult;
    };
  }, [hasAutosaveHarnessParam]);

  function flushPendingPlannerSave() {
    if (!plannerDirtyRef.current && !plannerSaveTimerRef.current) {
      return;
    }

    if (plannerSaveTimerRef.current) {
      window.clearTimeout(plannerSaveTimerRef.current);
      plannerSaveTimerRef.current = null;
    }

    void persistPlannerState(latestDerivedStateRef.current);
  }

  // Wait for every local save path (planner-shell autosave + per-field procedure saves) to drain.
  // Returns false if a save errored or it didn't settle in time -- the caller must NOT switch then.
  async function waitForLocalSavesToSettle(timeoutMs = 12000): Promise<boolean> {
    const startedAt = Date.now();
    while (hasLocalSaveWork()) {
      if (saveStateRef.current === "error" || saveStateRef.current === "conflict") {
        return false;
      }
      if (Date.now() - startedAt > timeoutMs) {
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    // Settled with no outstanding work; a lingering error/conflict means the last save did not land.
    return saveStateRef.current !== "error" && saveStateRef.current !== "conflict";
  }

  // Apply a freshly-loaded scenario for a switch. We only reach here AFTER a successful save, so any
  // procedure drafts from the previous scenario are stale and must be dropped (never carried across).
  function applyScenarioSwitch(loaded: PlannerState) {
    const normalized = ensureNomenclatureCollections(loaded);
    procedureDraftsRef.current = {};
    setProcedureDraftVersion((version) => version + 1);
    plannerDirtyRef.current = false;
    setPlannerState(normalized);
    setSelectedTaskId(normalized.tasks[0]?.id);
    setSelectedStationId(normalized.stations[0]?.id ?? "");
    setActiveZoneId(undefined);
    setFocusedProcedureStepId(undefined);
  }

  // Switch the Gantt to another scenario. Hard rule (spec §4.2 / §7.4): save first; if the save fails
  // or doesn't settle, ABORT -- show the error and stay on the current scenario. Never switch on a
  // failed/partial save. Realtime re-subscribes automatically via the derivedState.scenario.id effect.
  // Flush + await all local saves before a scenario action; on failure show a warning and return false.
  async function ensureSavedBeforeScenarioAction(failTitle: string, failBody: string): Promise<boolean> {
    flushPendingPlannerSave();
    const saved = await waitForLocalSavesToSettle();
    if (!saved) {
      notifyFeedback({ title: failTitle, body: failBody, tone: "warning" });
      return false;
    }
    return true;
  }

  // Load a scenario into the active view: instant from the in-memory cache, else load once and cache
  // it. Throws if it can't be loaded. The caller owns the surrounding save-state / busy messaging.
  async function loadScenarioIntoView(scenarioId: string) {
    const cached = scenarioCacheRef.current.get(scenarioId);
    if (cached) {
      applyScenarioSwitch(cached);
      return;
    }
    setSaveState("loading");
    const loaded = await loadPlannerStateFromSupabase(projectId, scenarioId);
    if (!loaded) {
      throw new Error("That scenario could not be loaded.");
    }
    scenarioCacheRef.current.set(scenarioId, loaded);
    applyScenarioSwitch(loaded);
  }

  // Reload the scenario tab list for the current product and return it.
  async function refreshScenarioList(): Promise<ScenarioSummary[]> {
    const list = await loadScenariosForProduct(derivedState.product.id);
    setScenarios(list);
    return list;
  }

  async function switchScenario(targetScenarioId: string) {
    if (isSwitchingScenario || targetScenarioId === derivedState.scenario.id) {
      return;
    }

    // Highlight the target tab immediately (instant feedback) for the whole save+load duration.
    setSwitchTargetId(targetScenarioId);
    setIsSwitchingScenario(true);
    try {
      const ok = await ensureSavedBeforeScenarioAction(
        "Can't switch scenarios",
        "Your changes couldn't be saved, so the scenario was not switched. Resolve the save error and try again.",
      );
      if (!ok) {
        return;
      }
      await loadScenarioIntoView(targetScenarioId);
      setSaveState("saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load that scenario.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Scenario load failed", body: message, tone: "danger" });
    } finally {
      setIsSwitchingScenario(false);
      setSwitchTargetId(undefined);
    }
  }

  // Rename a (non-main) scenario. Optimistically updates local state, then persists; reverts on failure.
  async function renameScenarioById(scenarioId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || scenarioId === scenarios[0]?.id) {
      return;
    }
    const previousName = scenarios.find((scenario) => scenario.id === scenarioId)?.name;
    const applyName = (value: string) => {
      setScenarios((current) =>
        current.map((scenario) => (scenario.id === scenarioId ? { ...scenario, name: value } : scenario)),
      );
      if (scenarioId === latestDerivedStateRef.current.scenario.id) {
        setPlannerState((current) => ({ ...current, scenario: { ...current.scenario, name: value } }));
      }
    };
    applyName(trimmed);
    try {
      await renameScenario(scenarioId, trimmed);
    } catch (error) {
      if (previousName !== undefined) {
        applyName(previousName);
      }
      notifyFeedback({
        title: "Couldn't rename scenario",
        body: error instanceof Error ? error.message : "The scenario could not be renamed.",
        tone: "danger",
      });
    }
  }

  // Confirm, then delete a (non-main) projection scenario.
  function requestDeleteScenario(scenarioId: string) {
    const scenario = scenarios.find((entry) => entry.id === scenarioId);
    if (!scenario || scenarioId === scenarios[0]?.id) {
      return;
    }
    setFeedbackConfirm({
      title: `Delete "${scenario.name || "this scenario"}"?`,
      body: "This permanently removes this projection and its Gantt. Main Plan and other scenarios are unaffected. This can't be undone.",
      tone: "danger",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => {
        setFeedbackConfirm(undefined);
        void deleteScenarioById(scenarioId);
      },
    });
  }

  async function deleteScenarioById(scenarioId: string) {
    if (isSwitchingScenario || scenarioId === scenarios[0]?.id) {
      return;
    }
    const wasActive = scenarioId === latestDerivedStateRef.current.scenario.id;
    setIsSwitchingScenario(true);
    setSaveState("loading");
    try {
      await deleteScenario(scenarioId);
      scenarioCacheRef.current.delete(scenarioId);
      const list = await refreshScenarioList();

      // If the deleted scenario was the one on screen, fall back to Main (instant from cache).
      if (wasActive && list[0]?.id) {
        await loadScenarioIntoView(list[0].id);
      }
      setSaveState("saved");
      notifyFeedback({
        title: "Scenario deleted",
        body: "The projection was removed. Main Plan is unaffected.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete the scenario.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Delete failed", body: message, tone: "danger" });
    } finally {
      setIsSwitchingScenario(false);
    }
  }

  // Duplicate the active scenario into a new independent high-level projection, then switch to it.
  async function duplicateActiveScenario() {
    if (isSwitchingScenario) {
      return;
    }
    // The RPC copies from the DB, so flush local edits first (same guard as switching).
    const ok = await ensureSavedBeforeScenarioAction(
      "Can't duplicate yet",
      "Your changes couldn't be saved, so the scenario was not duplicated. Resolve the save error and try again.",
    );
    if (!ok) {
      return;
    }

    setIsSwitchingScenario(true);
    setSaveState("loading");
    try {
      const sourceLabel = isMainScenario ? "Main Plan" : derivedState.scenario.name || "Scenario";
      const newId = await duplicateScenario(derivedState.scenario.id, `${sourceLabel} copy`);
      await refreshScenarioList();
      await loadScenarioIntoView(newId);
      setSaveState("saved");
      notifyFeedback({
        title: "Scenario duplicated",
        body: `Created "${sourceLabel} copy" as an independent projection (high-level Gantt, no progress).`,
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to duplicate the scenario.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Duplicate failed", body: message, tone: "danger" });
    } finally {
      setIsSwitchingScenario(false);
    }
  }

  // Edit a (non-main) scenario's projection target. Optimistically updates local state so the active
  // scenario's takt re-flags the Gantt immediately, then persists.
  async function editScenarioTarget(scenarioId: string, targetOutput: number, targetOutputPeriod: string) {
    const previous = scenarios.find((scenario) => scenario.id === scenarioId);
    const applyTarget = (units: number, period: string) => {
      setScenarios((current) =>
        current.map((scenario) =>
          scenario.id === scenarioId ? { ...scenario, targetOutput: units, targetOutputPeriod: period } : scenario,
        ),
      );
      if (scenarioId === latestDerivedStateRef.current.scenario.id) {
        setPlannerState((current) => ({
          ...current,
          scenario: { ...current.scenario, targetOutput: units, targetOutputPeriod: period },
        }));
      }
    };
    applyTarget(targetOutput, targetOutputPeriod);
    try {
      await updateScenarioTarget(scenarioId, targetOutput, targetOutputPeriod);
    } catch (error) {
      if (previous) {
        applyTarget(previous.targetOutput, previous.targetOutputPeriod);
      }
      notifyFeedback({
        title: "Couldn't save target",
        body: error instanceof Error ? error.message : "The scenario target could not be saved.",
        tone: "danger",
      });
    }
  }

  function refreshTasksFromSupabase(taskIds: string[]) {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    void Promise.all(taskIds.map((taskId) => loadTaskFromSupabase(taskId, projectId)))
      .then((latestTasks) => {
        if (hasPlannerShellSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        const taskById = new Map(
          latestTasks
            .filter((task): task is Task => Boolean(task))
            .map((task) => [task.id, task]),
        );
        if (taskById.size === 0) {
          return;
        }

        remoteRefreshAppliedRef.current = true;
        setPlannerState((current) => {
          const existingTaskIds = new Set(current.tasks.map((task) => task.id));
          const insertedTasks = [...taskById.values()].filter((task) => !existingTaskIds.has(task.id));
          const mergedTasks = current.tasks.map((task) => {
            const serverTask = taskById.get(task.id);
            if (!serverTask) {
              return task;
            }

            if (hasDirtyOrActiveProcedureDrafts(task.id)) {
              storeDeferredProcedureServerUpdate({
                serverTask,
                serverVersion: serverTask.version,
                receivedAt: Date.now(),
                source: "refreshTasks",
              });
              return mergeServerTaskIntoLocalTask(task, serverTask, procedureDraftsRef.current, { source: "refreshTasks" });
            }

            return mergeServerTaskIntoLocalTask(task, serverTask, procedureDraftsRef.current, { source: "refreshTasks" });
          });
          const nextState = {
            ...current,
            tasks: [...mergedTasks, ...insertedTasks],
          };
          void writeCachedPlannerState(projectId, nextState).catch(() => undefined);
          return nextState;
        });
        setSaveError(undefined);
        setSaveState("saved");
      })
      .catch(() => {
        requestRemotePlannerRefresh();
      });
  }

  function requestRemoteTaskRefresh(taskId: string) {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    pendingRemoteTaskIdsRef.current.add(taskId);

    if (remoteTaskRefreshTimerRef.current) {
      window.clearTimeout(remoteTaskRefreshTimerRef.current);
    }

    remoteTaskRefreshTimerRef.current = window.setTimeout(() => {
      remoteTaskRefreshTimerRef.current = null;
      const taskIds = [...pendingRemoteTaskIdsRef.current];
      pendingRemoteTaskIdsRef.current.clear();
      refreshTasksFromSupabase(taskIds);
    }, 250);
  }

  function refreshPlannerFromSupabase() {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    // Refresh the ACTIVE scenario, not the product's default. Without the scenario id this reloads the
    // earliest (Main) scenario and overwrites whichever projection is open -- the "switch bounces back
    // to Main" bug. The active scenario id is read live from the derived-state ref.
    void loadPlannerStateFromSupabase(projectId, latestDerivedStateRef.current.scenario.id)
      .then((savedState) => {
        if (!savedState || hasPlannerShellSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        pendingRemoteRefreshRef.current = false;
        remoteRefreshAppliedRef.current = true;
        setPlannerState((current) => {
          const localTaskById = new Map(current.tasks.map((task) => [task.id, task]));
          const savedTaskIds = new Set(savedState.tasks.map((task) => task.id));
          const mergedTasks = savedState.tasks.map((serverTask) => {
            const localTask = localTaskById.get(serverTask.id);
            if (!localTask) {
              return serverTask;
            }

            if (hasDirtyOrActiveProcedureDrafts(serverTask.id)) {
              storeDeferredProcedureServerUpdate({
                serverTask,
                serverVersion: serverTask.version,
                receivedAt: Date.now(),
                source: "refreshPlanner",
              });
              procedureDraftLog("full planner refresh protected a field", {
                taskId: serverTask.id,
                serverVersion: serverTask.version,
                source: "refreshPlanner",
              });
            }

            return mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
              source: "refreshPlanner",
            });
          });
          const nextState = {
            ...savedState,
            tasks: [
              ...mergedTasks,
              ...current.tasks.filter((task) => !savedTaskIds.has(task.id) && hasDirtyOrActiveProcedureDrafts(task.id)),
            ],
          };
          void writeCachedPlannerState(projectId, nextState).catch(() => undefined);
          return nextState;
        });
        setSelectedTaskId((currentTaskId) =>
          savedState.tasks.some((task) => task.id === currentTaskId)
            ? currentTaskId
            : savedState.tasks[0]?.id ?? "",
        );
        setSelectedStationId((currentStationId) =>
          savedState.stations.some((station) => station.id === currentStationId)
            ? currentStationId
            : savedState.stations[0]?.id ?? savedState.tasks[0]?.stationId ?? "",
        );
        setSaveError(undefined);
        setSaveState("saved");
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : "Unable to refresh database changes.");
        setSaveState("error");
      });
  }

  function requestRemotePlannerRefresh() {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    if (remoteRefreshTimerRef.current) {
      window.clearTimeout(remoteRefreshTimerRef.current);
    }

    remoteRefreshTimerRef.current = window.setTimeout(() => {
      remoteRefreshTimerRef.current = null;
      refreshPlannerFromSupabase();
    }, 350);
  }

  function flushDeferredRemoteRefresh() {
    if (!pendingRemoteRefreshRef.current || hasLocalSaveWork()) {
      return;
    }

    pendingRemoteRefreshRef.current = false;
    requestRemotePlannerRefresh();
  }

  function finishProjectSwitch() {
    const startedAt = projectSwitchStartedAtRef.current;
    const elapsed = startedAt ? Date.now() - startedAt : PROJECT_SWITCH_SKELETON_MIN_MS;
    const remaining = Math.max(PROJECT_SWITCH_SKELETON_MIN_MS - elapsed, 0);

    if (projectSwitchSkeletonTimerRef.current) {
      window.clearTimeout(projectSwitchSkeletonTimerRef.current);
      projectSwitchSkeletonTimerRef.current = null;
    }

    projectSwitchSkeletonTimerRef.current = window.setTimeout(() => {
      clearProjectSwitchSession();
      projectSwitchStartedAtRef.current = undefined;
      projectSwitchSkeletonTimerRef.current = null;
      setProjectSwitchTargetContext(undefined);
      setIsProjectSwitching(false);
    }, remaining);
  }

  useEffect(() => {
    let mounted = true;
    let remoteLoaded = false;
    const currentProjectId = projectId ?? "";
    const isSwitchingProject = hasLoadedAnyProjectRef.current && loadedProjectIdRef.current !== currentProjectId;

    if (isSwitchingProject && !projectSwitchStartedAtRef.current) {
      projectSwitchStartedAtRef.current = Date.now();
    }
    if (isSwitchingProject) {
      setProjectSwitchTargetContext(buildProjectSwitchTargetContext(readProjectSwitchTarget()));
    }
    setIsProjectSwitching(isSwitchingProject);
    setHasLoadedRemoteState((loaded) => (isSwitchingProject && loaded ? true : false));
    setSaveState("loading");

    function applyLoadedPlannerState(savedState: PlannerState, source: "cache" | "remote") {
      const normalizedSavedState = ensureNomenclatureCollections(savedState);
      const procedureDraft = readProcedureDraftSnapshot();
      const workspaceSnapshot = readWorkspaceSnapshot(projectId);
      let recoveredTaskIds: string[] = [];
      let recoveredTask: Task | undefined;
      let hydratedState = normalizedSavedState;

      if (procedureDraft && "version" in procedureDraft && procedureDraft.version === 2) {
        const recoveredDrafts = { ...procedureDraftsRef.current };
        procedureDraft.fields.forEach((field) => {
          const key = makeProcedureDraftKey(field.taskId, field.stepId, field.fieldName);
          recoveredDrafts[key] = {
            ...field,
            active: false,
            dirty: field.dirty !== false,
            saveStatus: field.dirty === false ? "saved" : "dirty",
          };
          procedureEditSeqRef.current = Math.max(procedureEditSeqRef.current, recoveredDrafts[key].localEditSeq);
          procedureDraftLog("recovery restored a draft", recoveredDrafts[key]);
        });
        procedureDraftsRef.current = recoveredDrafts;
        recoveredTaskIds = [...new Set(procedureDraft.fields.map((field) => field.taskId))];
        hydratedState = {
          ...normalizedSavedState,
          tasks: normalizedSavedState.tasks.map((task) => applyProcedureDraftsToTask(task, recoveredDrafts)),
        };
        recoveredTask = hydratedState.tasks.find((task) => recoveredTaskIds.includes(task.id));
      } else if (procedureDraft && "taskId" in procedureDraft) {
        const draftTask = normalizedSavedState.tasks.find((task) => task.id === procedureDraft.taskId);
        const mergedDraftTask = draftTask ? mergeProcedureDraftWithServer(draftTask, procedureDraft.task) : undefined;
        if (mergedDraftTask) {
          recoveredTaskIds = [mergedDraftTask.id];
          recoveredTask = mergedDraftTask;
          hydratedState = {
            ...normalizedSavedState,
            tasks: normalizedSavedState.tasks.map((task) => (task.id === mergedDraftTask.id ? mergedDraftTask : task)),
          };
        }
      }
      const snapshotTask = workspaceSnapshot?.selectedTaskId
        ? hydratedState.tasks.find((task) => task.id === workspaceSnapshot.selectedTaskId)
        : undefined;
      const initialUrlWorkspaceSnapshot = urlWorkspaceSnapshot;
      const urlTask = initialUrlWorkspaceSnapshot.selectedTaskId
        ? hydratedState.tasks.find((task) => task.id === initialUrlWorkspaceSnapshot.selectedTaskId)
        : undefined;
      const selectedTask = recoveredTask ?? urlTask ?? snapshotTask ?? hydratedState.tasks[0];
      const snapshotStation = workspaceSnapshot?.selectedStationId
        ? hydratedState.stations.find((station) => station.id === workspaceSnapshot.selectedStationId)
        : undefined;
      const urlStation = initialUrlWorkspaceSnapshot.selectedStationId
        ? hydratedState.stations.find((station) => station.id === initialUrlWorkspaceSnapshot.selectedStationId)
        : undefined;
      const snapshotZone = workspaceSnapshot?.activeZoneId
        ? hydratedState.zones.find((zone) => zone.id === workspaceSnapshot.activeZoneId)
        : undefined;
      const urlZone = initialUrlWorkspaceSnapshot.activeZoneId
        ? hydratedState.zones.find((zone) => zone.id === initialUrlWorkspaceSnapshot.activeZoneId)
        : undefined;

      setPlannerState(hydratedState);
      // Restore the view that was active when this load started -- but only if the
      // user has not navigated away since. The remote load can resolve seconds
      // later; without this guard it yanks the user back to the view they were on
      // at (re)load time. The live URL is kept in sync with the active view by the
      // view-sync effect, so a mismatch means the user has since navigated.
      const capturedView = initialUrlWorkspaceSnapshot.activeModule ?? workspaceSnapshot?.activeModule;
      if (capturedView) {
        const currentUrlView =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
        const userNavigatedAway = !!currentUrlView && currentUrlView !== capturedView;
        if (!userNavigatedAway) {
          setActiveModule(capturedView);
        }
      }
      setSelectedTaskId(selectedTask?.id ?? "");
      setSelectedStationId(urlStation?.id ?? snapshotStation?.id ?? selectedTask?.stationId ?? hydratedState.tasks[0]?.stationId ?? "");
      setActiveZoneId(urlZone?.id ?? snapshotZone?.id);
      setDetailDrawerCollapsed(workspaceSnapshot?.detailDrawerCollapsed ?? true);
      setSidebarCollapsed(workspaceSnapshot?.sidebarCollapsed ?? false);
      loadedProjectIdRef.current = currentProjectId;
      hasLoadedAnyProjectRef.current = true;
      setHasLoadedRemoteState(true);

      if (source === "cache") {
        setSaveState("loading");
        return;
      }

      finishProjectSwitch();

      void writeCachedPlannerState(projectId, hydratedState).catch(() => undefined);

      if (recoveredTaskIds.length > 0) {
        setSaveState("draft");
        window.setTimeout(() => {
          recoveredTaskIds.forEach((taskId) => {
            const taskToSave = hydratedState.tasks.find((task) => task.id === taskId);
            if (taskToSave) {
              scheduleProcedureTaskSave(taskToSave, hydratedState.tasks);
            }
          });
        }, 250);
        return;
      }

      clearProcedureDraftSnapshot();
      setSaveState("saved");
    }

    void readCachedPlannerState(projectId)
      .then((cachedState) => {
        if (!mounted || remoteLoaded || !cachedState) {
          return;
        }

        applyLoadedPlannerState(cachedState, "cache");
      })
      .catch(() => undefined);

    loadPlannerStateFromSupabase(projectId)
      .then((savedState) => {
        if (!mounted) {
          return;
        }
        remoteLoaded = true;

        if (savedState) {
          applyLoadedPlannerState(savedState, "remote");
          return;
        }

        const initialUrlWorkspaceSnapshot = urlWorkspaceSnapshot;
        if (initialUrlWorkspaceSnapshot.activeModule) {
          setActiveModule(initialUrlWorkspaceSnapshot.activeModule);
        }
        const urlTask = initialUrlWorkspaceSnapshot.selectedTaskId
          ? emptyPlannerState.tasks.find((task) => task.id === initialUrlWorkspaceSnapshot.selectedTaskId)
          : undefined;
        const urlStation = initialUrlWorkspaceSnapshot.selectedStationId
          ? emptyPlannerState.stations.find((station) => station.id === initialUrlWorkspaceSnapshot.selectedStationId)
          : undefined;
        if (urlTask) {
          setSelectedTaskId(urlTask.id);
        }
        if (urlStation || urlTask) {
          setSelectedStationId(urlStation?.id ?? urlTask?.stationId ?? "");
        }
        loadedProjectIdRef.current = currentProjectId;
        hasLoadedAnyProjectRef.current = true;
        finishProjectSwitch();
        setHasLoadedRemoteState(true);
        setSaveState("idle");
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }
        remoteLoaded = true;

        setSaveError(error instanceof Error ? error.message : "Unable to load database state.");
        finishProjectSwitch();
        setHasLoadedRemoteState(true);
        setSaveState("error");
      });

    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (hasLoadedRemoteState) {
      onReady?.();
    }
  }, [hasLoadedRemoteState, onReady]);

  useEffect(() => {
    function handleProjectSwitchStart(event: Event) {
      if (hasLoadedAnyProjectRef.current) {
        projectSwitchStartedAtRef.current = Date.now();
        const target = event instanceof CustomEvent
          ? event.detail as ProjectSwitchTarget | undefined
          : readProjectSwitchTarget();
        setProjectSwitchTargetContext(buildProjectSwitchTargetContext(target));
        setActiveModule("dashboard");
        setIsProjectSwitching(true);
        setSaveState("loading");
      }
    }

    window.addEventListener(PROJECT_SWITCH_EVENT, handleProjectSwitchStart);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, handleProjectSwitchStart);
  }, []);

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return undefined;
    }

    const unsubscribe = subscribePlannerStateChanges(
      (payload) => {
        const taskId = taskIdFromRealtimePayload(payload);
        if (taskId && canPatchTaskFromRealtimePayload(payload)) {
          requestRemoteTaskRefresh(taskId);
          return;
        }

        requestRemotePlannerRefresh();
      },
      {
        productId: derivedState.product.id,
        scenarioId: derivedState.scenario.id,
        isTaskInScope: (taskId) => realtimeTaskIdSetRef.current.has(taskId),
      },
    );

    return () => {
      if (remoteRefreshTimerRef.current) {
        window.clearTimeout(remoteRefreshTimerRef.current);
      }
      if (remoteTaskRefreshTimerRef.current) {
        window.clearTimeout(remoteTaskRefreshTimerRef.current);
        remoteTaskRefreshTimerRef.current = null;
      }
      // Drop any task ids still queued for the scenario we're leaving -- otherwise a same-project
      // scenario switch would refresh them into (and contaminate) the next scenario's task list.
      pendingRemoteTaskIdsRef.current.clear();
      Object.values(procedureSaveTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      procedureSaveTimersRef.current = {};
      Object.values(procedureRetryTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      procedureRetryTimersRef.current = {};
      if (projectSwitchSkeletonTimerRef.current) {
        window.clearTimeout(projectSwitchSkeletonTimerRef.current);
        projectSwitchSkeletonTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [derivedState.product.id, derivedState.scenario.id, hasLoadedRemoteState]);

  useEffect(() => {
    if (!SIMULATION_ENABLED || !isPlaying) {
      return;
    }

    const interval = window.setInterval(() => {
      setCurrentMinute((minute) => {
        const nextMinute = minute + speed / 4;
        if (nextMinute >= timelineBounds.durationMinutes) {
          setIsPlaying(false);
          return timelineBounds.durationMinutes;
        }

        return nextMinute;
      });
    }, 250);

    return () => window.clearInterval(interval);
  }, [isPlaying, speed, timelineBounds.durationMinutes]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickedTask = target.closest("[data-task-select]");
      const clickedDrawer = target.closest("[data-detail-drawer]");

      if (!clickedTask && !clickedDrawer) {
        setDetailDrawerCollapsed((current) => (current ? current : true));
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    if (!hasLoadedRemoteState || dirtyVersion === 0) {
      return;
    }

    if (remoteRefreshAppliedRef.current) {
      remoteRefreshAppliedRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      if (plannerSaveTimerRef.current === timeout) {
        plannerSaveTimerRef.current = null;
      }
      void persistPlannerState(derivedState);
    }, 900);
    plannerSaveTimerRef.current = timeout;

    return () => {
      window.clearTimeout(timeout);
      if (plannerSaveTimerRef.current === timeout) {
        plannerSaveTimerRef.current = null;
      }
    };
  }, [dirtyVersion, derivedState, hasLoadedRemoteState]);

  useEffect(() => () => clearChromeStatusTimer(), []);

  useEffect(() => {
    if (!isResizingDetailDrawer) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function clampDrawerWidth(width: number) {
      const viewportMax = Math.max(360, window.innerWidth - 520);
      return Math.min(Math.max(width, 320), Math.min(760, viewportMax));
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = detailDrawerResizeRef.current;
      if (!resizeStart) return;

      setDetailDrawerWidth(clampDrawerWidth(resizeStart.startWidth + resizeStart.startX - event.clientX));
    }

    function stopResize() {
      detailDrawerResizeRef.current = null;
      setIsResizingDetailDrawer(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [isResizingDetailDrawer]);

  function clearChromeStatusTimer() {
    if (chromeStatusTimerRef.current) {
      window.clearTimeout(chromeStatusTimerRef.current);
      chromeStatusTimerRef.current = null;
    }
  }

  function dismissWorkspaceNotice() {
    setWorkspaceNotice(null);
  }

  function notifyFeedback(message: Omit<FeedbackToast, "id">) {
    if (message.content || message.placement === "center") {
      setWorkspaceNotice(message);
      return;
    }

    const statusText = [message.title, message.body].filter(Boolean).join(": ");
    const error = message.tone === "danger" || message.tone === "warning";

    clearChromeStatusTimer();
    setChromeStatus({ message: statusText, error });

    if (!message.persistent) {
      chromeStatusTimerRef.current = window.setTimeout(() => {
        setChromeStatus(null);
        chromeStatusTimerRef.current = null;
      }, error ? 9000 : 5200);
    }
  }

  function notifyRestoreAction({
    body,
    onRestore,
    restoreLabel = "Restore",
    title,
  }: {
    body: string;
    onRestore: () => void;
    restoreLabel?: string;
    title: string;
  }) {
    setWorkspaceNotice({
      title,
      tone: "warning",
      persistent: true,
      content: (
        <div className="space-y-3">
          <p className="ui-workspace-notice-body">{body}</p>
          <button type="button" onClick={onRestore} className="ui-btn-secondary h-8 px-3">
            {restoreLabel}
          </button>
        </div>
      ),
    });
  }

  function requestFeedbackConfirm(message: FeedbackConfirm) {
    setFeedbackConfirm(message);
  }

  function confirmFeedbackAction() {
    const action = feedbackConfirm?.onConfirm;
    setFeedbackConfirm(undefined);
    action?.();
  }

  function startDetailDrawerResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (detailDrawerCollapsed) return;

    event.preventDefault();
    event.stopPropagation();
    detailDrawerResizeRef.current = {
      startX: event.clientX,
      startWidth: detailDrawerWidth,
    };
    setIsResizingDetailDrawer(true);
  }

  const isProcedureModule = activeModule === "procedure";
  const isDashboardModule = activeModule === "dashboard";
  const isSettingsModule = activeModule === "settings";
  const sidebarActiveModule = isProjectSwitching ? "dashboard" : activeModule;
  const isComingSoonModule = comingSoonModuleIds.has(activeModule);
  const comingSoonModuleLabel = plannerModules.find((module) => module.id === activeModule)?.label ?? "Workspace";
  const plannerChromeContext = isDashboardModule ? buildPlannerChromeContext(derivedState.product) : undefined;
  if (!isProjectSwitching && plannerChromeContext) {
    stablePlannerChromeContextRef.current = plannerChromeContext;
  }
  const displayedPlannerChromeContext = isProjectSwitching
    ? projectSwitchTargetContext ?? stablePlannerChromeContextRef.current ?? plannerChromeContext
    : plannerChromeContext;
  const showDetailDrawer = false;
  const showsSchedulingWorkspace = activeModule === "gantt";
  const selectedTask = derivedState.tasks.find((task) => task.id === selectedTaskId) ?? derivedState.tasks[0];
  const selectedStation = selectedTask
    ? buildProcessStationForTask(selectedTask, derivedState.tasks, kpis.bottleneckStation?.id)
    : undefined;
  const workspaceGridClass = "ui-workspace-shell";
  const workspaceGridStyle = {
    "--workspace-sidebar-width": sidebarCollapsed ? "0px" : "var(--shell-sidebar)",
    "--detail-drawer-width": detailDrawerCollapsed ? "44px" : `${detailDrawerWidth}px`,
  } as CSSProperties;

  if (!hasLoadedRemoteState) {
    if (!isProjectSwitching) {
      return <AppLoadingShell title="Loading workspace" />;
    }

    return (
      <div
        className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
        style={workspaceGridStyle}
      >
        <TopNav
          onExport={() => undefined}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          context={displayedPlannerChromeContext}
          chromeStatus={chromeStatus}
        />
        <div className={workspaceGridClass}>
          <div className={`ui-workspace-sidebar-slot ${sidebarCollapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
            <Sidebar
              activeModule="dashboard"
              settingsSection={settingsSection}
              setupSection={setupSection}
              onChange={() => undefined}
              onSetupSectionChange={() => undefined}
              onOpenSettings={() => undefined}
              project={activeProjectContext}
            />
          </div>
          <WorkspaceSwitchSkeleton />
        </div>
      </div>
    );
  }

  function markDirty() {
    plannerDirtyRef.current = true;
    setSaveError(undefined);
    setDirtyVersion((version) => version + 1);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "idle"));
  }

  async function persistPlannerState(stateToSave: PlannerState) {
    if (stateToSave.tasks.length === 0) {
      const message = "Refusing to save an empty Gantt. Add at least one task before saving.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({
        title: "Save blocked",
        body: message,
        tone: "warning",
      });
      return;
    }

    if (saveInFlightRef.current) {
      queuedSaveStateRef.current = stateToSave;
      setSaveState("saving");
      return;
    }

    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    let nextState: PlannerState | null = stateToSave;
    let lastPersistedState: PlannerState | null = null;

    while (nextState) {
      queuedSaveStateRef.current = null;

      try {
        await savePlannerShellToSupabase(nextState);
        lastPersistedState = nextState;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to save planner state.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Save failed",
          body: message,
          tone: "danger",
        });
        saveInFlightRef.current = false;
        return;
      }

      nextState = queuedSaveStateRef.current;
    }

    saveInFlightRef.current = false;
    plannerDirtyRef.current = false;
    if (lastPersistedState) {
      void writeCachedPlannerState(projectId, lastPersistedState).catch(() => undefined);
    }
    setSaveState("saved");
    flushDeferredRemoteRefresh();
  }

  function confirmProcedureDraftsFromSave(
    taskId: string,
    saveId: string,
    saveSeq: number,
    draftSnapshot: ProcedureDraftMap,
    savedTask: Task,
  ) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;
    let staleResponse = false;

    Object.entries(draftSnapshot).forEach(([key, sentDraft]) => {
      if (sentDraft.taskId !== taskId || !sentDraft.dirty) {
        return;
      }

      const currentDraft = nextDrafts[key];
      if (!currentDraft) {
        return;
      }

      const serverStep = savedTask.manufacturingSteps?.find((step) => step.id === sentDraft.stepId);
      const serverValue = getProcedureStepFieldValue(serverStep, sentDraft.fieldName);
      const fieldSaveSeq = sentDraft.localEditSeq;
      const confirmsExactCurrentDraft =
        currentDraft.taskId === sentDraft.taskId &&
        currentDraft.stepId === sentDraft.stepId &&
        currentDraft.fieldName === sentDraft.fieldName &&
        currentDraft.localEditSeq === fieldSaveSeq &&
        currentDraft.value === sentDraft.value &&
        serverValue === currentDraft.value &&
        currentDraft.latestSaveId === saveId &&
        currentDraft.savingSeq === fieldSaveSeq;

      if (!confirmsExactCurrentDraft) {
        staleResponse = true;
        nextDrafts[key] = {
          ...currentDraft,
          dirty: true,
          saveStatus: currentDraft.saveStatus === "saving" ? "dirty" : currentDraft.saveStatus,
        };
        changed = true;
        procedureDraftLog("save returned stale", {
          ...currentDraft,
          saveId,
          saveSeq,
          serverVersion: savedTask.version,
        });
        return;
      }

      nextDrafts[key] = {
        ...currentDraft,
        baseValue: serverValue,
        baseVersion: serverStep?.version,
        dirty: false,
        saveStatus: "saved",
        latestSaveId: undefined,
        savingSeq: undefined,
        error: undefined,
      };
      changed = true;
      procedureDraftLog("field marked clean", {
        ...nextDrafts[key],
        saveId,
        saveSeq,
        serverVersion: savedTask.version,
      });
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }

    return !staleResponse;
  }

  async function startProcedureTaskSave(taskId: string) {
    const queue = getProcedureTaskSaveQueue(taskId);
    if (queue.inFlight || !queue.pendingTaskSnapshot || !queue.pendingTasksSnapshot) {
      return;
    }

    const saveId = generateProcedureSaveId();
    const draftSnapshot = queue.pendingDraftSnapshot ?? cloneProcedureDrafts();
    const saveSeq = maxProcedureDraftSeq(taskId, draftSnapshot);
    const taskSnapshot = applyProcedureDraftsToTask(queue.pendingTaskSnapshot, draftSnapshot);
    const tasksSnapshot = queue.pendingTasksSnapshot.map((task) => (task.id === taskId ? taskSnapshot : task));

    queue.inFlight = true;
    queue.pending = false;
    queue.inFlightSaveId = saveId;
    queue.inFlightSeq = saveSeq;
    queue.state = "saving";
    queue.pendingTaskSnapshot = undefined;
    queue.pendingTasksSnapshot = undefined;
    queue.pendingDraftSnapshot = undefined;
    setSaveError(undefined);
    setSaveState("saving");
    markProcedureDraftsForSave(taskId, saveId, draftSnapshot);
    procedureDraftLog("save started", { taskId, saveId, saveSeq });

    let savedTask: Task | null = null;

    try {
      savedTask = await saveProcedureTaskUpdateToSupabase(taskSnapshot, tasksSnapshot, projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save procedure task.";
      const isConflict = message.toLowerCase().includes("conflict");
      queue.inFlight = false;
      queue.state = isConflict ? "conflict" : "retrying";
      queue.lastError = error;
      markProcedureDraftsForTask(taskId, {
        saveStatus: isConflict ? "conflict" : "retrying",
        error: message,
      });
      updateProcedureDraftSnapshotStorage();
      setSaveError(message);
      setSaveState(isConflict ? "error" : "retrying");
      notifyFeedback({
        title: isConflict ? "Save conflict" : "Save failed - retrying",
        body: message,
        tone: isConflict ? "danger" : "warning",
      });
      flushDeferredRemoteRefresh();

      if (!isConflict && !procedureRetryTimersRef.current[taskId]) {
        procedureRetryTimersRef.current[taskId] = window.setTimeout(() => {
          delete procedureRetryTimersRef.current[taskId];
          const latestTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
          if (!latestTask) {
            return;
          }

          const latestTaskSnapshot = applyProcedureDraftsToTask(latestTask);
          const latestTasksSnapshot = latestDerivedStateRef.current.tasks.map((task) =>
            task.id === taskId ? latestTaskSnapshot : task,
          );
          scheduleProcedureTaskSave(latestTaskSnapshot, latestTasksSnapshot);
        }, 2500);
      }
      return;
    }

    queue.inFlight = false;
    queue.inFlightSaveId = undefined;
    queue.inFlightSeq = undefined;

    let confirmedCurrent = true;
    if (savedTask) {
      confirmedCurrent = confirmProcedureDraftsFromSave(taskId, saveId, saveSeq, draftSnapshot, savedTask);
      remoteRefreshAppliedRef.current = true;
      setPlannerState((current) => {
        const nextState = {
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === savedTask?.id
              ? mergeServerTaskIntoLocalTask(task, savedTask, procedureDraftsRef.current, { source: "saveCompletion" })
              : task,
          ),
        };
        void writeCachedPlannerState(projectId, nextState).catch(() => undefined);
        return nextState;
      });

      if (confirmedCurrent) {
        cleanupCleanProcedureDrafts(taskId);
      }
    }

    const hasNewerPending = !confirmedCurrent || queue.pending || maxProcedureDraftSeq(taskId) > saveSeq;
    if (hasNewerPending) {
      if (queue.pending && queue.pendingTaskSnapshot && queue.pendingTasksSnapshot) {
        queue.state = "saving-with-newer-pending";
        void startProcedureTaskSave(taskId);
        return;
      }

      const latestTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
      if (latestTask) {
        const latestTaskSnapshot = applyProcedureDraftsToTask(latestTask);
        const latestTasksSnapshot = latestDerivedStateRef.current.tasks.map((task) =>
          task.id === taskId ? latestTaskSnapshot : task,
        );
        queue.pending = true;
        queue.pendingTaskSnapshot = latestTaskSnapshot;
        queue.pendingTasksSnapshot = latestTasksSnapshot;
        queue.pendingDraftSnapshot = cloneProcedureDrafts();
        queue.latestSeq = maxProcedureDraftSeq(taskId);
        queue.state = "saving-with-newer-pending";
        void startProcedureTaskSave(taskId);
        return;
      }
    }

    queue.state = "idle";
    setSaveState("saved");
    applyDeferredProcedureServerUpdate(taskId);
    flushDeferredRemoteRefresh();
  }

  async function persistProcedureTaskUpdate(taskToSave: Task, tasksToSave: Task[]) {
    const taskId = taskToSave.id;
    const queue = getProcedureTaskSaveQueue(taskId);
    queue.pending = true;
    queue.pendingTaskSnapshot = applyProcedureDraftsToTask(taskToSave);
    queue.pendingTasksSnapshot = tasksToSave.map((task) => (task.id === taskId ? queue.pendingTaskSnapshot ?? task : task));
    queue.pendingDraftSnapshot = cloneProcedureDrafts();
    queue.latestSeq = maxProcedureDraftSeq(taskId);
    queue.state = queue.inFlight ? "saving-with-newer-pending" : "dirty-pending";
    procedureDraftLog("save scheduled", { taskId, saveSeq: queue.latestSeq });
    await startProcedureTaskSave(taskId);
  }

  function scheduleProcedureTaskSave(taskToSave: Task, tasksToSave: Task[]) {
    const taskId = taskToSave.id;
    const queue = getProcedureTaskSaveQueue(taskId);
    const taskSnapshot = applyProcedureDraftsToTask(taskToSave);

    queue.pending = true;
    queue.pendingTaskSnapshot = taskSnapshot;
    queue.pendingTasksSnapshot = tasksToSave.map((task) => (task.id === taskId ? taskSnapshot : task));
    queue.pendingDraftSnapshot = cloneProcedureDrafts();
    queue.latestSeq = maxProcedureDraftSeq(taskId);
    queue.state = queue.inFlight ? "saving-with-newer-pending" : "dirty-pending";
    updateProcedureDraftSnapshotStorage();
    procedureDraftLog("save scheduled", { taskId, saveSeq: queue.latestSeq });

    if (procedureSaveTimersRef.current[taskId]) {
      window.clearTimeout(procedureSaveTimersRef.current[taskId]);
    }

    if (procedureRetryTimersRef.current[taskId]) {
      window.clearTimeout(procedureRetryTimersRef.current[taskId]);
      delete procedureRetryTimersRef.current[taskId];
    }

    procedureSaveTimersRef.current[taskId] = window.setTimeout(() => {
      delete procedureSaveTimersRef.current[taskId];
      void persistProcedureTaskUpdate(taskSnapshot, queue.pendingTasksSnapshot ?? tasksToSave);
    }, PROCEDURE_SAVE_DEBOUNCE_MS);
  }
  function updateProductNumber(field: ProductNumberField, value: number) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      product: {
        ...current.product,
        [field]: Math.max(value, 0),
      },
    }));
  }

  function updateProductText(field: ProductTextField, value: string) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      product: {
        ...current.product,
        [field]: value,
      },
    }));
  }

  function updateNomenclatureZone(zoneId: string, patch: Partial<Zone>) {
    markDirty();
    setPlannerState((current) => {
      const zones = current.zones.map((zone) =>
        zone.id === zoneId ? { ...zone, ...patch, updatedAt: new Date().toISOString() } : zone,
      );
      return {
        ...current,
        zones,
        tasks: applyTaskCodes(current.tasks, zones, current.components),
      };
    });
  }

  function addComponentCode() {
    markDirty();
    const now = new Date().toISOString();
    setPlannerState((current) => {
      const nextSequence = Math.max(0, ...current.components.map((component) => component.sequence)) + 1;
      const component: ManufacturingComponent = {
        id: `component-${Date.now()}`,
        scenarioId: current.scenario.id,
        code: "",
        name: "",
        sequence: nextSequence,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...current,
        components: [...current.components, component],
      };
    });
  }

  function updateComponentCode(componentId: string, patch: Partial<ManufacturingComponent>) {
    markDirty();
    setPlannerState((current) => {
      const components = current.components.map((component) =>
        component.id === componentId ? { ...component, ...patch, updatedAt: new Date().toISOString() } : component,
      );
      return {
        ...current,
        components,
        tasks: applyTaskCodes(current.tasks, current.zones, components),
      };
    });
  }

  function deleteComponentCode(componentId: string) {
    markDirty();
    setPlannerState((current) => {
      const components = current.components.filter((component) => component.id !== componentId);
      const tasks = current.tasks.map((task) =>
        task.componentId === componentId
          ? applyTaskCode({ ...task, componentId: undefined, taskNumber: undefined }, current.zones, components, true)
          : task,
      );

      return {
        ...current,
        components,
        tasks,
      };
    });
  }

  function addDocumentTypeCode(defaultType?: Pick<DocumentTypeCode, "code" | "name" | "active">) {
    markDirty();
    const now = new Date().toISOString();
    setPlannerState((current) => {
      const documentType: DocumentTypeCode = {
        id: `document-type-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productId: current.product.id,
        code: defaultType?.code ?? "",
        name: defaultType?.name ?? "",
        active: defaultType?.active ?? true,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...current,
        documentTypes: [...current.documentTypes, documentType],
      };
    });
  }

  function addMissingDefaultDocumentTypeCodes() {
    const existingCodes = new Set(plannerState.documentTypes.map((documentType) => documentType.code));
    defaultDocumentTypeCodes
      .filter((documentType) => !existingCodes.has(documentType.code))
      .forEach((documentType) => addDocumentTypeCode(documentType));
  }

  function updateDocumentTypeCode(documentTypeId: string, patch: Partial<DocumentTypeCode>) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      documentTypes: current.documentTypes.map((documentType) =>
        documentType.id === documentTypeId ? { ...documentType, ...patch, updatedAt: new Date().toISOString() } : documentType,
      ),
    }));
  }

  function deleteDocumentTypeCode(documentTypeId: string) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      documentTypes: current.documentTypes.filter((documentType) => documentType.id !== documentTypeId),
    }));
  }

  function updateProductStepChecks(definitions: ManufacturingStepCheckDefinition[]) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      product: {
        ...current.product,
        customFields: {
          ...(current.product.customFields ?? {}),
          [PRODUCT_STEP_CHECK_CONFIG_FIELD]: serializeManufacturingStepCheckDefinitions(definitions),
        },
      },
    }));
  }

  function updateMasterBom(bom: MasterBom | undefined) {
    markDirty();
    setPlannerState((current) => {
      const customFields = { ...(current.product.customFields ?? {}) };
      if (bom) {
        customFields[PRODUCT_MASTER_BOM_FIELD] = serializeMasterBom(bom);
      } else {
        delete customFields[PRODUCT_MASTER_BOM_FIELD];
      }
      return {
        ...current,
        product: { ...current.product, customFields },
      };
    });
  }

  function updateTask(taskId: string, patch: Partial<Task>) {
    markDirty();
    if (patch.stationId && taskId === selectedTaskId) {
      setSelectedStationId(patch.stationId);
    }

    setPlannerState((current) => {
      const currentTask = current.tasks.find((task) => task.id === taskId);
      const safePatch = currentTask ? enforceStepDerivedDuration(currentTask, patch) : patch;
      const tasks = current.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        const patchedTask = { ...task, ...safePatch };
        return safePatch.zoneId !== undefined || safePatch.componentId !== undefined || safePatch.taskNumber !== undefined
          ? applyTaskCode(patchedTask, current.zones, current.components)
          : patchedTask;
      });

      return {
        ...current,
        tasks: taskPatchChangesSchedule(safePatch)
          ? rescheduleTasksByDependencies(tasks, {
            preserveManualStartTaskIds: safePatch.plannedStart !== undefined ? new Set([taskId]) : undefined,
          })
          : tasks,
      };
    });
  }

  function updateProcedureTask(taskId: string, patch: Partial<Task>) {
    setSaveError(undefined);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "draft"));
    if (patch.stationId && taskId === selectedTaskId) {
      setSelectedStationId(patch.stationId);
    }

    const patchKeys = Object.keys(patch) as Array<keyof Task>;
    const isNormalizedAssetPatch = patchKeys.length === 1 && patchKeys[0] === "customFields";

    setPlannerState((current) => {
      const currentTask = current.tasks.find((task) => task.id === taskId);
      const safePatch = currentTask ? enforceStepDerivedDuration(currentTask, patch) : patch;
      const patchedTasks = current.tasks.map((task) => (task.id === taskId ? { ...task, ...safePatch } : task));
      const scheduledTasks = taskPatchChangesSchedule(safePatch)
        ? rescheduleTasksByDependencies(patchedTasks, {
          preserveManualStartTaskIds: safePatch.plannedStart !== undefined ? new Set([taskId]) : undefined,
        })
        : patchedTasks;
      const taskToSave = scheduledTasks.find((task) => task.id === taskId);

      if (taskToSave && !isNormalizedAssetPatch) {
        scheduleProcedureTaskSave(taskToSave, scheduledTasks);
      }

      return {
        ...current,
        tasks: scheduledTasks,
      };
    });
  }

  function moveProcedureStepToTask(sourceTaskId: string, targetTaskId: string, stepId: string) {
    const sourceTask = plannerState.tasks.find((task) => task.id === sourceTaskId);
    const targetTask = plannerState.tasks.find((task) => task.id === targetTaskId);
    const movedTasks = moveManufacturingStepBetweenTasks(plannerState.tasks, sourceTaskId, targetTaskId, stepId);

    if (!sourceTask || !targetTask || !movedTasks) {
      notifyFeedback({
        title: "Step move failed",
        body: "The source step or target task is no longer available.",
        tone: "danger",
      });
      return;
    }

    const scheduledTasks = rescheduleTasksByDependencies(movedTasks);
    const nextSourceTask = scheduledTasks.find((task) => task.id === sourceTaskId);
    const nextTargetTask = scheduledTasks.find((task) => task.id === targetTaskId);

    if (!nextSourceTask || !nextTargetTask) {
      notifyFeedback({
        title: "Step move failed",
        body: "The moved step could not be prepared for saving.",
        tone: "danger",
      });
      return;
    }

    const previousState = plannerState;
    setSaveError(undefined);
    setSaveState("saving");
    setPlannerState((current) => ({ ...current, tasks: scheduledTasks }));

    void moveManufacturingStepToTaskInSupabase(nextSourceTask, nextTargetTask, stepId, scheduledTasks, projectId)
      .then(() => {
        setSaveState("saved");
        void writeCachedPlannerState(projectId, { ...previousState, tasks: scheduledTasks }).catch(() => undefined);
        notifyFeedback({
          title: "Step moved",
          body: `Moved the step to ${taskDisplayCode(nextTargetTask)} ${nextTargetTask.name || "Untitled task"}.`,
          tone: "success",
        });
      })
      .catch((error: unknown) => {
        setPlannerState(previousState);
        const message = error instanceof Error ? error.message : "Unable to move the procedure step.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Step move failed",
          body: message,
          tone: "danger",
        });
      });
  }

  async function persistAddStepTool(taskId: string, stepId: string, toolName: string, sequence = 1) {
    setSaveError(undefined);
    setSaveState("saving");

    try {
      await addStepToolToSupabase(taskId, stepId, toolName, sequence, projectId);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to add the tool.");
      setSaveState("error");
    }
  }

  async function persistRemoveStepTool(stepId: string, toolName: string) {
    setSaveError(undefined);
    setSaveState("saving");

    try {
      const taskId = derivedState.tasks.find((task) =>
        (task.manufacturingSteps ?? []).some((step) => step.id === stepId),
      )?.id;
      await removeStepToolFromSupabase(stepId, toolName, taskId, projectId);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to remove the tool.");
      setSaveState("error");
    }
  }

  async function applyProjectTasksUpdate(nextTasks: Task[], options?: { silent?: boolean }) {
    setSaveError(undefined);
    setSaveState("saving");

    const calculated = applyCalculatedFields(derivedState.product, derivedState.stations, nextTasks);
    const nextState = {
      ...derivedState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };

    setPlannerState(nextState);

    try {
      await savePlannerShellToSupabase(nextState);
      setSaveState("saved");
      if (!options?.silent) {
        notifyFeedback({
          title: "Build catalog updated",
          body: "Tool assignments were saved across the workspace.",
          tone: "success",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save build catalog changes.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({
        title: "Save failed",
        body: message,
        tone: "danger",
      });
      throw error;
    }
  }

  async function saveCatalogTool(
    entry: ProjectToolCatalogEntry,
    draft: { name: string; category: ToolTypeValue },
  ) {
    const formattedName = formatToolName(draft.name);
    if (!formattedName) {
      notifyFeedback({
        title: "Tool name required",
        body: "Enter a tool name before saving.",
        tone: "danger",
      });
      return;
    }

    const nameChanged = canonicalToolKey(formattedName) !== entry.key;

    if (nameChanged) {
      // Match the raw stored occurrence by canonical key, rewriting it in place.
      const nextTasks = renameToolInTasks(derivedState.tasks, entry.rawName, formattedName);
      await applyProjectTasksUpdate(nextTasks);
    }

    // Target the real library row by canonical key, so a messy stored name still
    // migrates (and its category survives — the upsert wipes category otherwise).
    const existingItem = toolLibraryItems.find(
      (item) => canonicalToolKey(item.toolName) === entry.key,
    );

    await upsertToolLibraryMetadata({
      toolName: formattedName,
      category: draft.category,
      projectId,
      previousToolName:
        existingItem && existingItem.toolName.trim() !== formattedName ? existingItem.toolName : undefined,
    });

    const tools = await loadToolLibraryFromSupabase(projectId);
    setToolLibraryItems(tools);

    if (!nameChanged) {
      notifyFeedback({
        title: "Tool updated",
        body: `${formattedName} type saved.`,
        tone: "success",
      });
    }
  }

  async function tidyCatalogToolNames(plan: Array<{ from: string; to: string }>) {
    if (plan.length === 0) {
      return;
    }

    try {
      // 1. Rewrite every stored occurrence in one project write. Silent: the
      //    "Tool names cleaned up" toast below is the user-facing signal.
      const nextTasks = plan.reduce(
        (tasks, rename) => renameToolInTasks(tasks, rename.from, rename.to),
        derivedState.tasks,
      );
      await applyProjectTasksUpdate(nextTasks, { silent: true });

      // 2. Migrate library rows that exist (preserving category); collect failures.
      let metadataFailures = 0;
      for (const rename of plan) {
        const key = canonicalToolKey(rename.from);
        const existingItem = toolLibraryItems.find((item) => canonicalToolKey(item.toolName) === key);
        if (!existingItem || existingItem.toolName.trim() === rename.to) {
          continue;
        }
        try {
          await upsertToolLibraryMetadata({
            toolName: rename.to,
            category: existingItem.category,
            projectId,
            previousToolName: existingItem.toolName,
          });
        } catch {
          metadataFailures += 1;
        }
      }

      const failureNote = metadataFailures > 0 ? `, ${metadataFailures} could not be saved` : "";
      notifyFeedback({
        title: "Tool names cleaned up",
        body: `Cleaned up ${plan.length} tool name${plan.length === 1 ? "" : "s"}${failureNote}.`,
        tone: metadataFailures > 0 ? "warning" : "neutral",
      });
    } catch {
      // applyProjectTasksUpdate already surfaced an error toast; abandon the
      // tidy (no partial task write — the shell save is atomic) without
      // rejecting, since this runs fire-and-forget from the load effect.
    } finally {
      // Always reflect whatever persisted, even on partial failure.
      try {
        const tools = await loadToolLibraryFromSupabase(projectId);
        setToolLibraryItems(tools);
      } catch {
        // Reload failure is non-fatal; the next load will reconcile.
      }
    }
  }

  async function deleteCatalogTool(entry: ProjectToolCatalogEntry) {
    const nextTasks = removeToolFromAllTasks(derivedState.tasks, entry.rawName);
    await applyProjectTasksUpdate(nextTasks);

    if (entry.libraryId) {
      await deleteToolLibraryFromSupabase(entry.libraryId, projectId);
      const tools = await loadToolLibraryFromSupabase(projectId);
      setToolLibraryItems(tools);
    }
  }

  async function saveCatalogPart(
    entry: ProjectPartCatalogEntry,
    draft: { partNumber: string; description: string; quantity: number; disposition: string },
  ) {
    const nextTasks = updateTaskPartReference(derivedState.tasks, entry.taskId, entry.part.id, {
      partNumber: draft.partNumber,
      description: draft.description,
      quantity: draft.quantity,
      disposition: draft.disposition,
    });
    const task = nextTasks.find((candidate) => candidate.id === entry.taskId);

    if (task) {
      updateProcedureTask(entry.taskId, { partReferences: task.partReferences });
    }
  }

  async function deleteCatalogPart(entry: ProjectPartCatalogEntry) {
    const nextTasks = removeTaskPartReference(derivedState.tasks, entry.taskId, entry.part.id);
    const task = nextTasks.find((candidate) => candidate.id === entry.taskId);

    if (task) {
      updateProcedureTask(entry.taskId, {
        partReferences: task.partReferences,
        manufacturingSteps: task.manufacturingSteps,
      });
    }
  }

  async function uploadStepPhotos(taskId: string, stepId: string, files: File[]) {
    if (files.length === 0) {
      return;
    }

    let localPhotos: StepPhotoAttachment[] = [];
    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    try {
      localPhotos = await Promise.all(files.map(buildStepPhotoAttachment));

      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? upsertStepPhotoAttachments(task, stepId, localPhotos) : task,
        ),
      }));

      const uploadedPhotos = await Promise.all(
        localPhotos.map((photo) => uploadStepPhotoAttachment(taskId, stepId, photo, activeProjectContext)),
      );

      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? upsertStepPhotoAttachments(task, stepId, uploadedPhotos) : task,
        ),
      }));

      setSaveState("saved");
    } catch (error) {
      if (localPhotos.length > 0) {
        setPlannerState((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? localPhotos.reduce(
                  (taskWithoutFailedPhoto, photo) => removeStepPhotoAttachment(taskWithoutFailedPhoto, stepId, photo.id),
                  task,
                )
              : task,
          ),
        }));
      }

      setSaveError(error instanceof Error ? error.message : "Unable to attach the selected photo.");
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      flushDeferredRemoteRefresh();
    }
  }

  async function removeStepPhoto(taskId: string, stepId: string, photoId: string) {
    let removedPhoto: StepPhotoAttachment | undefined;
    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    setPlannerState((current) => {
      const currentTask = current.tasks.find((task) => task.id === taskId);
      removedPhoto = currentTask ? getStepPhotoAttachments(currentTask, stepId).find((photo) => photo.id === photoId) : undefined;

      return {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? removeStepPhotoAttachment(task, stepId, photoId) : task,
        ),
      };
    });

    try {
      await softDeleteStepPhotoAttachmentFromSupabase(photoId, taskId, projectId);

      setSaveState("saved");
      if (removedPhoto) {
        notifyRestoreAction({
          title: "Deleted photo",
          body: "Restore will attach this photo back to the same manufacturing step.",
          restoreLabel: "Restore Photo",
          onRestore: () => {
            setSaveError(undefined);
            setSaveState("saving");
            setPlannerState((current) => ({
              ...current,
              tasks: current.tasks.map((task) =>
                task.id === taskId ? upsertStepPhotoAttachments(task, stepId, [removedPhoto as StepPhotoAttachment]) : task,
              ),
            }));
            void uploadStepPhotoAttachment(taskId, stepId, removedPhoto as StepPhotoAttachment, activeProjectContext)
              .then(() => setSaveState("saved"))
              .catch((error: unknown) => {
                setSaveError(error instanceof Error ? error.message : "Unable to restore the selected photo.");
                setSaveState("error");
              });
          },
        });
      }
    } catch (error) {
      if (removedPhoto) {
        setPlannerState((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId ? upsertStepPhotoAttachments(task, stepId, [removedPhoto as StepPhotoAttachment]) : task,
          ),
        }));
      }

      setSaveError(error instanceof Error ? error.message : "Unable to remove the selected photo.");
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      flushDeferredRemoteRefresh();
    }
  }

  function resetTaskHeadcount() {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => ({ ...task, ...getTaskOperatorResetPatch(task) })),
    }));
  }

  function copyTextWithSelection(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);

    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function copySmartAllocationReview(text: string) {
    let copied = false;
    const errors: string[] = [];

    try {
      copied = copyTextWithSelection(text);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Legacy clipboard copy failed.");
    }

    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Clipboard API copy failed.");
      }
    }

    if (copied) {
      notifyFeedback({
        title: "Allocation audit copied",
        body: "Paste it here and I can review the allocation inputs, audit, issues, and Gantt rows.",
        tone: "success",
      });
      return;
    }

    notifyFeedback({
      title: "Manual copy needed",
      content: (
        <div className="space-y-3">
          <p className="ui-workspace-notice-body">
            The browser blocked clipboard access. Select the text below and copy it manually.
          </p>
          <textarea
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="ui-field-standalone h-[320px] resize-none p-3 font-mono text-xs leading-relaxed"
          />
          {errors.length ? (
            <p className="ui-workspace-notice-body text-danger">{errors.join(" ")}</p>
          ) : null}
        </div>
      ),
      tone: "warning",
      placement: "center",
      persistent: true,
    });
  }

  async function smartAllocateHeadcount() {
    if (smartAllocationPending) {
      return;
    }

    const operatorCapacityMinutes = calculateAvailabilityMinutesForDemandPeriod(derivedState.product);
    const clearedTasks = derivedState.tasks.map((task) => ({
      ...task,
      ...getTaskOperatorResetPatch(task),
    }));
    const clearedPlanningContext = normalizeTaskPlanningContext(
      clearedTasks,
      derivedState.zones,
      derivedState.stations,
      derivedState.scenario.id,
    );
    const clearedCalculatedState = applyCalculatedFields(
      derivedState.product,
      clearedPlanningContext.stations,
      clearedPlanningContext.tasks.map(syncTaskOperatorCount),
    );
    const clearedKpis = calculateProductKpis(
      clearedCalculatedState.product,
      clearedCalculatedState.stations,
      clearedCalculatedState.tasks,
    );
    const request: IeSmartAllocationRequest = {
      plannerState: {
        ...derivedState,
        product: clearedCalculatedState.product,
        stations: clearedCalculatedState.stations,
        tasks: clearedCalculatedState.tasks,
      },
      availableOperatorIds: availableOperatorLetters,
      constraints: {
        demandPeriod: derivedState.product.demandPeriod,
        demandQuantity: derivedState.product.demandQuantity,
        targetManHours: derivedState.product.targetManHours,
        taktMinutes: clearedKpis.taktMinutes,
        budgetedCrewEquivalent: clearedKpis.budgetedCrewEquivalent,
        wholePersonStaffingRequirement: clearedKpis.wholePersonStaffingRequirement,
        requiredAverageAllocationPercent: clearedKpis.requiredAverageAllocationPercent,
        operatorCapacityMinutes,
        plannedManHours: clearedKpis.plannedManHours,
        assignedPlannedManHours: clearedKpis.assignedPlannedManHours,
        unassignedPlannedManHours: clearedKpis.unassignedPlannedManHours,
        plannedLaborLoadFte: clearedKpis.plannedLaborLoadFte,
        assignedLaborLoadFte: clearedKpis.assignedLaborLoadFte,
        peakManpower: clearedKpis.peakManpower,
      },
    };

    let agentPlan: IeSmartAllocationPlan;
    try {
      setSmartAllocationPending(true);
      agentPlan = await requestIeSmartAllocationPlan(request);
    } catch (error) {
      notifyFeedback({
        title: "Smart allocation unavailable",
        body: error instanceof Error ? error.message : "The IE allocation agent could not return a plan.",
        tone: "danger",
        placement: "center",
        persistent: true,
      });
      setSmartAllocationPending(false);
      return;
    }

    const allocation = buildOperatorAssignmentsFromIePlan({
      assignments: agentPlan.assignments,
      availableOperatorIds: availableOperatorLetters,
      budgetedAllocationPercent: clearedKpis.requiredAverageAllocationPercent,
      demandQuantity: derivedState.product.demandQuantity,
      operatorCapacityMinutes,
      strategyNotes: agentPlan.strategyNotes,
      taktMinutes: clearedKpis.taktMinutes,
      tasks: clearedCalculatedState.tasks,
    });
    const reviewPlanningContext = normalizeTaskPlanningContext(
      allocation.tasks,
      derivedState.zones,
      derivedState.stations,
      derivedState.scenario.id,
    );
    const reviewCalculatedState = applyCalculatedFields(
      derivedState.product,
      reviewPlanningContext.stations,
      reviewPlanningContext.tasks.map(syncTaskOperatorCount),
    );
    const reviewKpis = calculateProductKpis(
      reviewCalculatedState.product,
      reviewCalculatedState.stations,
      reviewCalculatedState.tasks,
    );
    const allocatedTaskById = new Map(allocation.tasks.map((task) => [task.id, task]));
    const proposedChangedTaskIds = derivedState.tasks
      .filter((task) => {
        const allocatedTask = allocatedTaskById.get(task.id);
        if (!allocatedTask) {
          return false;
        }

        return (
          getTaskOperatorIds(task, availableOperatorLetters).join("|") !==
            getTaskOperatorIds(allocatedTask, availableOperatorLetters).join("|") ||
          task.plannedOperators !== allocatedTask.plannedOperators
        );
      })
      .map((task) => task.id);
    const hardValidationFailure =
      allocation.audit.scheduleConflictCount > 0 ||
      allocation.audit.physicalCapacityOverageCount > 0 ||
      allocation.audit.summaryTaskAssignmentCount > 0;
    const validationRejectionReason = hardValidationFailure
      ? [
          allocation.audit.scheduleConflictCount > 0 ? `${allocation.audit.scheduleConflictCount} schedule conflict(s)` : "",
          allocation.audit.physicalCapacityOverageCount > 0 ? `${allocation.audit.physicalCapacityOverageCount} physical capacity overage(s)` : "",
          allocation.audit.summaryTaskAssignmentCount > 0 ? `${allocation.audit.summaryTaskAssignmentCount} summary row assignment(s)` : "",
        ].filter(Boolean).join(", ")
      : undefined;
    const changedTaskIds = hardValidationFailure ? [] : proposedChangedTaskIds;
    const reviewText = buildSmartAllocationReviewText({
      agentPlan,
      allocation: {
        ...allocation,
        tasks: reviewCalculatedState.tasks,
      },
      applicationStatus: {
        applied: !hardValidationFailure,
        appliedTaskCount: changedTaskIds.length,
        proposedTaskCount: proposedChangedTaskIds.length,
        rejectionReason: validationRejectionReason,
      },
      availableOperatorLetters,
      kpis: reviewKpis,
      operatorCapacityMinutes,
      product: derivedState.product,
      zones: derivedState.zones,
    });

    if (changedTaskIds.length > 0) {
      markDirty();
      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => {
          const allocatedTask = allocatedTaskById.get(task.id);
          if (!allocatedTask) {
            return task;
          }

          return {
            ...task,
            customFields: allocatedTask.customFields,
            plannedOperators: allocatedTask.plannedOperators,
          };
        }),
      }));
    }

    const issueGroups = allocation.issues.reduce((groups, issue) => {
      const key = issue.taskId ?? issue.operatorId ?? issue.message;
      const current = groups.get(key) ?? {
        label: issue.taskId
          ? allocation.tasks.find((task) => task.id === issue.taskId)?.name ?? issue.message
          : issue.operatorId
            ? `Operator ${issue.operatorId}`
            : issue.message,
        blockers: new Set<string>(),
        warnings: new Set<string>(),
      };
      const severity =
        issue.severity ??
        (issue.kind === "unassigned_task" || issue.kind === "capacity_overage" || issue.kind === "schedule_conflict"
          ? "blocker"
          : "warning");
      const reason =
        issue.kind === "unassigned_task"
          ? issueReviewLabel(issue)
          : issue.kind === "takt_overage"
            ? "exceeds takt"
            : issue.kind === "budget_overage"
              ? "over budgeted allocation"
              : issue.kind === "capacity_overage"
                ? "over physical capacity"
                : "schedule conflict";

      if (severity === "blocker") {
        current.blockers.add(reason);
      } else {
        current.warnings.add(reason);
      }
      groups.set(key, current);
      return groups;
    }, new Map<string, { label: string; blockers: Set<string>; warnings: Set<string> }>());
    const issueEntries = [...issueGroups.values()].map((issue) => ({
      label: issue.label,
      blockers: [...issue.blockers],
      warnings: [...issue.warnings],
    }));
    const unallocatedWorkReviews = buildUnallocatedWorkReviews({
      allocation,
      kpis: reviewKpis,
      operatorCapacityMinutes,
      product: derivedState.product,
    });
    const nonUnallocatedBlockerCount = allocation.issues.filter((issue) => {
      const severity =
        issue.severity ??
        (issue.kind === "unassigned_task" || issue.kind === "capacity_overage" || issue.kind === "schedule_conflict"
          ? "blocker"
          : "warning");
      return severity === "blocker" && issue.kind !== "unassigned_task";
    }).length;
    const audit = allocation.audit;
    const visibleIssueEntries = issueEntries.slice(0, 6);
    const issueRemainder = issueEntries.length - visibleIssueEntries.length;
    notifyFeedback({
      title: hardValidationFailure
        ? "IE allocation rejected"
        : unallocatedWorkReviews.length
          ? "Feasible with exceptions"
          : "IE smart allocation complete",
      content: (
        <div className="space-y-3">
          <div className="ui-panel-raised p-3">
            <div className="ui-mono-label">IE Agent Summary</div>
            <div className="mt-1 text-sm font-bold leading-snug text-ink">{agentPlan.summary}</div>
          </div>

          {hardValidationFailure ? (
            <div className="rounded-md border border-danger/30 bg-danger-muted p-3">
              <div className="text-[10px] ui-mono-label tracking-wide text-danger">Not Applied</div>
              <div className="mt-1 text-sm font-bold leading-snug text-ink">
                The IE agent returned an invalid headcount plan. No Gantt assignments were changed because validation found {validationRejectionReason}.
              </div>
            </div>
          ) : null}

          {unallocatedWorkReviews.length ? (
            <div className="rounded-md border border-warn/35 bg-accent-muted">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warn/25 px-3 py-2">
                <div>
                  <div className="text-[10px] ui-mono-label tracking-wide text-warn-strong">Unallocated Required Work</div>
                  <div className="mt-0.5 text-xs font-bold text-steel">
                    The plan is feasible only after these staffing exceptions are resolved.
                  </div>
                </div>
                <div className="text-[10px] font-medium text-warn-strong">{unallocatedWorkReviews.length} exception(s)</div>
              </div>
              <div className="max-h-[190px] overflow-auto">
                {unallocatedWorkReviews.map((review) => (
                  <div
                    key={review.taskId}
                    className="grid gap-2 border-b border-warn/20 bg-surface px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(150px,0.8fr)_1.3fr_minmax(120px,0.55fr)]"
                  >
                    <div>
                      <div className="font-medium leading-snug text-ink">{review.taskLabel}</div>
                      <div className="mt-1 inline-flex rounded border border-warn/35 bg-accent-muted px-2 py-0.5 text-[9px] ui-mono-label tracking-wide text-warn-strong">
                        {review.classification}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-steel">{review.condition}</div>
                      <div className="mt-1 font-semibold leading-snug text-steel">{review.impact}</div>
                      <div className="mt-1 font-bold leading-snug text-ink">{review.recommendation}</div>
                    </div>
                    <div className="flex items-start sm:justify-end">
                      <span className="inline-flex rounded border border-graphite/20 bg-surface-sunken px-2 py-1 text-[10px] ui-mono-label tracking-wide text-ink-secondary">
                        {review.action}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 ui-panel-raised px-3 py-2">
            <div>
              <div className="ui-mono-label">Review Packet</div>
              <div className="mt-0.5 text-xs font-bold text-steel">
                Copies audit text plus the Gantt data used by Smart Allocation.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void copySmartAllocationReview(reviewText)}
              className="ui-btn-primary h-9 gap-2 px-3 text-xs"
            >
              <Copy size={14} />
              Copy Audit
            </button>
          </div>

          <div className="ui-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div>
                <div className="ui-mono-label">Allocation Audit</div>
                <div className="mt-0.5 text-xs font-bold text-steel">
                  {round(audit.assignmentCoveragePercent, 0)}% coverage · peak {audit.peakManpower} · spread {formatMinutes(audit.loadSpreadMinutes)}
                </div>
              </div>
              <div className="ui-mono-label">
                {audit.assignedTaskCount}/{audit.eligibleTaskCount} eligible task(s)
              </div>
            </div>

            <div className="p-2">
              <div className="overflow-hidden rounded border border-line">
                <div className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-surface-sunken px-2 py-1.5 text-[9px] ui-mono-label tracking-wide text-steel">
                  <div>Op</div>
                  <div>Load</div>
                  <div>Work</div>
                  <div>Budget</div>
                </div>
                {audit.operators.map((operator, index) => {
                  const budgetTone =
                    operator.budgetVarianceMinutes > 1
                      ? "text-warn-strong"
                      : operator.budgetVarianceMinutes < -1
                        ? "text-steel"
                        : "text-accent";
                  return (
                    <div
                      key={operator.operatorId}
                      className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-surface-raised px-2 py-1.5 text-xs last:border-b-0"
                      title={operator.assignedTaskLabels.join("\n")}
                    >
                      <div className="flex items-center gap-2">
                        <WorkerIcon className="h-6 w-6 shrink-0" colorIndex={index} letter={operator.operatorId} />
                      </div>
                      <div className="whitespace-nowrap">
                        <span className="font-medium text-ink">{formatMinutes(operator.assignedMinutes)}</span>
                        <span className="ml-1 font-bold text-steel">· {round(operator.utilizationPercent, 0)}%</span>
                      </div>
                      <div className="truncate font-bold text-steel">
                        {operator.assignedTaskCount} task(s) · {operator.idleGapCount > 0 ? `${formatMinutes(operator.idleMinutes)} idle` : "continuous"}
                      </div>
                      <div className={`truncate font-medium ${budgetTone}`}>
                        {operator.budgetVarianceMinutes > 1
                          ? `+${formatMinutes(operator.budgetVarianceMinutes)} vs budget`
                          : operator.budgetVarianceMinutes < -1
                            ? `${formatMinutes(Math.abs(operator.budgetVarianceMinutes))} under budget`
                            : "on budget"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-line px-3 py-2 text-[11px] font-semibold leading-snug text-steel">
              {audit.strategyNotes[audit.strategyNotes.length - 1]}
            </div>
          </div>

          {issueEntries.length ? (
            <div className="ui-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <div className="ui-mono-label">Needs Review</div>
                <div className="text-[10px] font-medium text-steel">{issueEntries.length} item(s)</div>
              </div>
              <div className="max-h-[170px] overflow-auto">
                {visibleIssueEntries.map((issue) => (
                  <div key={issue.label} className="grid gap-2 border-b border-line bg-surface-raised px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(180px,1fr)_1.35fr] sm:items-center">
                    <div className="truncate text-sm font-medium leading-snug text-ink" title={issue.label}>
                      {issue.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {issue.blockers.map((reason) => (
                        <span
                          key={reason}
                          className="inline-flex h-6 items-center rounded border border-danger/30 bg-danger-muted px-2 text-[9px] ui-mono-label tracking-wide text-danger"
                        >
                          {reason}
                        </span>
                      ))}
                      {issue.warnings.map((reason) => (
                        <span
                          key={reason}
                          className="inline-flex h-6 items-center rounded border border-warn/35 bg-accent-muted px-2 text-[9px] ui-mono-label tracking-wide text-warn-strong"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {issueRemainder > 0 ? (
                  <div className="bg-surface px-3 py-2 text-xs font-bold text-steel">
                    {issueRemainder} more item(s)
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-accent/25 bg-accent-muted p-3 text-sm font-bold text-accent">
              All eligible tasks were assigned without review items.
            </div>
          )}
        </div>
      ),
      tone: hardValidationFailure || nonUnallocatedBlockerCount ? "danger" : issueEntries.length ? "warning" : "success",
      placement: "center",
      persistent: true,
    });
    setSmartAllocationPending(false);
  }

  function setTaskDependencies(taskId: string, dependencyIds: string[]) {
    markDirty();
    setPlannerState((current) => {
      const sanitizedDependencyIds = sanitizeDependencyIds(current.tasks, taskId, dependencyIds);
      const existingDependencies = new Map(
        current.dependencies
          .filter((dependency) => dependency.successorTaskId === taskId)
          .map((dependency) => [dependency.predecessorTaskId, dependency]),
      );
      const successorTask = current.tasks.find((task) => task.id === taskId);

      const tasks = current.tasks.map((task) =>
        task.id === taskId ? { ...task, dependencyIds: sanitizedDependencyIds } : task,
      );
      const scheduledTasks = rescheduleTasksByDependencies(tasks);

      return {
        ...current,
        tasks: scheduledTasks,
        dependencies: [
          ...current.dependencies.filter((dependency) => dependency.successorTaskId !== taskId),
          ...sanitizedDependencyIds.map((predecessorTaskId, index) => {
            const existing = existingDependencies.get(predecessorTaskId);
            return {
              id: existing?.id ?? `dep-${predecessorTaskId}-${taskId}-${index}`,
              predecessorTaskId,
              successorTaskId: taskId,
              type: existing?.type ?? "finish_to_start",
              lagMinutes: existing?.lagMinutes,
              constraintType: existing?.constraintType ?? (successorTask?.qualityGate ? "quality" : undefined),
            };
          }),
        ],
      };
    });
  }

  function linkTaskStartToFinish(targetTaskId: string, predecessorTaskId: string) {
    markDirty();
    setPlannerState((current) => {
      const targetTask = current.tasks.find((task) => task.id === targetTaskId);
      const predecessorTask = current.tasks.find((task) => task.id === predecessorTaskId);

      if (!targetTask || !predecessorTask) {
        return current;
      }

      const relinkedTasks = relinkTasksForDependency(current.tasks, targetTaskId, predecessorTaskId);
      const predecessorScheduledTasks = rescheduleTasksByDependencies(relinkedTasks);
      const scheduledPredecessor = predecessorScheduledTasks.find((task) => task.id === predecessorTaskId);
      const predecessorFinishMs = Date.parse(scheduledPredecessor?.plannedFinish ?? predecessorTask.plannedFinish);
      const anchoredTasks = predecessorScheduledTasks.map((task) => {
        if (task.id !== targetTaskId || !Number.isFinite(predecessorFinishMs)) {
          return task;
        }

        const plannedStart = new Date(predecessorFinishMs).toISOString();

        return {
          ...task,
          plannedStart,
          plannedFinish: new Date(predecessorFinishMs + Math.max(task.plannedDurationMinutes, 0) * 60_000).toISOString(),
        };
      });
      const scheduledTasks = rescheduleTasksByDependencies(anchoredTasks);

      return {
        ...current,
        tasks: scheduledTasks,
        dependencies: rebuildDependenciesFromTasks(scheduledTasks, current.dependencies),
      };
    });

    setSelectedTaskId(targetTaskId);
    const targetTask = derivedState.tasks.find((task) => task.id === targetTaskId);
    if (targetTask) {
      setSelectedStationId(targetTask.stationId);
    }
  }

  function updateStationOperators(stationId: string, operators: number) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      stations: current.stations.map((station) =>
        station.id === stationId ? { ...station, plannedOperators: Math.max(operators, 0) } : station,
      ),
    }));
  }

  function addZone() {
    markDirty();
    const now = new Date().toISOString();
    const colors = ["#15756d", "#b7642c", "#52606d", "#c88a18", "#7d5a9e", "#3d6f8f"];
    const zoneId = `zone-${Date.now()}`;
    setPlannerState((current) => {
      const nextSequence = Math.max(0, ...current.zones.map((zone) => zone.sequence)) + 1;
      const zone: Zone = {
        id: zoneId,
        scenarioId: current.scenario.id,
        sequence: nextSequence,
        name: "",
        color: colors[(nextSequence - 1) % colors.length],
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...current,
        zones: [...current.zones, zone],
      };
    });
    setActiveZoneId(zoneId);
  }

  function createZoneFromTasks(name: string, taskIds: string[]) {
    const trimmedName = name.trim();
    if (!trimmedName || taskIds.length === 0) {
      return;
    }

    markDirty();
    const now = new Date().toISOString();
    const colors = ["#15756d", "#b7642c", "#52606d", "#c88a18", "#7d5a9e", "#3d6f8f"];
    const zoneId = `zone-${Date.now()}`;
    const taskIdSet = new Set(taskIds);

    setPlannerState((current) => {
      const nextSequence = Math.max(0, ...current.zones.map((zone) => zone.sequence)) + 1;
      const zone: Zone = {
        id: zoneId,
        scenarioId: current.scenario.id,
        sequence: nextSequence,
        name: trimmedName,
        color: colors[(nextSequence - 1) % colors.length],
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...current,
        zones: [...current.zones, zone],
        tasks: current.tasks.map((task) => (taskIdSet.has(task.id) ? { ...task, zoneId, stationId: stationIdForZone(zoneId) } : task)),
      };
    });
    setActiveZoneId(zoneId);
  }

  function updateZone(zoneId: string, patch: Partial<Zone>) {
    updateNomenclatureZone(zoneId, patch);
  }

  function restorePlannerSnapshot(snapshot: PlannerState, restoreSelection?: { taskId?: string; stationId?: string; zoneId?: string }) {
    markDirty();
    remoteRefreshAppliedRef.current = true;
    setPlannerState(snapshot);
    setSelectedTaskId(restoreSelection?.taskId ?? snapshot.tasks[0]?.id ?? "");
    setSelectedStationId(restoreSelection?.stationId ?? snapshot.tasks[0]?.stationId ?? "");
    setActiveZoneId(restoreSelection?.zoneId);
  }

  async function restoreTaskProcedureSnapshot(taskSnapshot: Task, step: ManufacturingStep) {
    updateProcedureTask(taskSnapshot.id, {
      manufacturingSteps: taskSnapshot.manufacturingSteps,
      plannedDurationMinutes: taskSnapshot.plannedDurationMinutes,
      customFields: taskSnapshot.customFields,
      partReferences: taskSnapshot.partReferences,
    });

    const stepPhotos = getStepPhotoAttachments(taskSnapshot, step.id);
    if (stepPhotos.length > 0) {
      try {
        await Promise.all(
          stepPhotos.map((photo) => uploadStepPhotoAttachment(taskSnapshot.id, step.id, photo, activeProjectContext)),
        );
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Step restored, but one or more photos could not be restored.");
        setSaveState("error");
      }
    }
  }

  function notifyDeletedStepRestore(taskSnapshot: Task, step: ManufacturingStep) {
    notifyRestoreAction({
      title: `Deleted step ${step.sequence}`,
      body: "Restore will put the step, tools, part links, and available photo records back on this task.",
      restoreLabel: "Restore Step",
      onRestore: () => void restoreTaskProcedureSnapshot(taskSnapshot, step),
    });
  }

  function executeDeleteZone(zoneId: string) {
    const snapshot = plannerState;
    const deletedZone = derivedState.zones.find((zone) => zone.id === zoneId);
    markDirty();
    setPlannerState((current) => ({
      ...current,
      zones: current.zones
        .filter((zone) => zone.id !== zoneId)
        .map((zone, index) => ({ ...zone, sequence: index + 1 })),
      tasks: current.tasks.map((task) =>
        task.zoneId === zoneId
          ? { ...task, zoneId: undefined, stationId: stationIdForUnzoned(task.scenarioId || current.scenario.id) }
          : task,
      ),
    }));
    setActiveZoneId((current) => (current === zoneId ? undefined : current));
    notifyRestoreAction({
      title: `Deleted ${deletedZone?.name || "zone"}`,
      body: "Tasks were moved out of the deleted zone. Restore will bring the previous zone layout back.",
      restoreLabel: "Restore Zone",
      onRestore: () =>
        restorePlannerSnapshot(snapshot, {
          taskId: selectedTaskId,
          stationId: selectedStationId,
          zoneId,
        }),
    });
  }

  function deleteZone(zoneId: string) {
    const zone = derivedState.zones.find((candidate) => candidate.id === zoneId);
    requestFeedbackConfirm({
      title: `Delete ${zone?.name || "zone"}?`,
      body: "This removes the zone and moves its tasks into the unzoned section.",
      tone: "danger",
      confirmLabel: "Delete Zone",
      onConfirm: () => executeDeleteZone(zoneId),
    });
  }

  function moveTasksToZone(taskIds: string[], zoneId?: string) {
    markDirty();
    const taskIdSet = new Set(taskIds);
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        taskIdSet.has(task.id)
          ? {
              ...task,
              zoneId,
              stationId: zoneId ? stationIdForZone(zoneId) : stationIdForUnzoned(task.scenarioId || current.scenario.id),
            }
          : task,
      ),
    }));
    setActiveZoneId(zoneId);
  }

  function reorderTaskGroups(
    sourceTaskIds: string[],
    targetTaskIds: string[],
    targetZoneId: string | undefined,
    placement: "before" | "after",
  ) {
    const sourceTaskIdSet = new Set(sourceTaskIds);
    const targetTaskIdSet = new Set(targetTaskIds);

    function buildReorderedTasks(currentTasks: Task[]) {
      const grouped = new Map<string, Task[]>();
      currentTasks.forEach((task) => {
        const processNumber = getTaskProcessNumber(task);
        const group = grouped.get(processNumber);
        if (group) {
          group.push(task);
        } else {
          grouped.set(processNumber, [task]);
        }
      });

      const groups = Array.from(grouped.entries())
        .map(([processNumber, groupTasks]) => ({
          processNumber,
          tasks: groupTasks,
          isSource: groupTasks.some((task) => sourceTaskIdSet.has(task.id)),
          isTarget: groupTasks.some((task) => targetTaskIdSet.has(task.id)),
        }))
        .sort((a, b) => Number.parseFloat(a.processNumber) - Number.parseFloat(b.processNumber));

      const sourceGroup = groups.find((group) => group.isSource);
      const targetGroup = groups.find((group) => group.isTarget);

      if (!sourceGroup || !targetGroup || sourceGroup.processNumber === targetGroup.processNumber) {
        return null;
      }

      const remainingGroups = groups.filter((group) => group !== sourceGroup);
      const targetIndex = remainingGroups.findIndex((group) => group === targetGroup);
      const insertIndex = targetIndex < 0 ? remainingGroups.length : targetIndex + (placement === "after" ? 1 : 0);
      const orderedGroups = [
        ...remainingGroups.slice(0, insertIndex),
        sourceGroup,
        ...remainingGroups.slice(insertIndex),
      ];

      return orderedGroups.flatMap((group, groupIndex) => {
        const nextProcessNumber = String(groupIndex + 1);
        const movedIntoZone = group === sourceGroup;

        return group.tasks.map((task) => {
          const suffix = getTaskWbsSuffix(task);
          const nextZoneId = movedIntoZone ? targetZoneId : task.zoneId;
          return {
            ...task,
            zoneId: nextZoneId,
            stationId: nextZoneId ? stationIdForZone(nextZoneId) : stationIdForUnzoned(task.scenarioId || plannerState.scenario.id),
            wbs: suffix ? `${nextProcessNumber}.${suffix}` : nextProcessNumber,
          };
        });
      });
    }

    const reorderedTasks = buildReorderedTasks(plannerState.tasks);
    if (!reorderedTasks) {
      return;
    }

    const changedTasks = reorderedTasks.filter((task) => {
      const currentTask = plannerState.tasks.find((candidate) => candidate.id === task.id);
      return (
        !currentTask ||
        currentTask.wbs !== task.wbs ||
        currentTask.zoneId !== task.zoneId ||
        currentTask.stationId !== task.stationId
      );
    });

    if (changedTasks.length === 0) {
      return;
    }

    const nextState: PlannerState = {
      ...plannerState,
      tasks: reorderedTasks,
    };

    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");
    setPlannerState(nextState);
    setActiveZoneId(targetZoneId);

    void (async () => {
      try {
        const token = Date.now().toString(36);
        await saveTasksToSupabase(
          changedTasks.map((task, index) => ({ ...task, wbs: `tmp-${token}-${index + 1}` })),
          projectId,
        );
        await saveTasksToSupabase(changedTasks, projectId);
        await writeCachedPlannerState(projectId, nextState);
        setSaveState("saved");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to save Gantt order.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Save failed",
          body: message,
          tone: "danger",
        });
      } finally {
        saveInFlightRef.current = false;
        flushDeferredRemoteRefresh();
      }
    })();
  }

  function addTaskToZone(zoneId?: string) {
    markDirty();
    const currentTasks = plannerState.tasks;
    const zoneTasks = currentTasks.filter((task) => (zoneId ? task.zoneId === zoneId : !task.zoneId));
    const lastZoneTask = zoneTasks[zoneTasks.length - 1];
    const lastTask = lastZoneTask ?? currentTasks[currentTasks.length - 1];
    const stationId = zoneId ? stationIdForZone(zoneId) : lastTask?.stationId ?? plannerState.stations[0]?.id ?? "";
    const defaultComponentId = lastZoneTask?.componentId;
    const defaultComponent = defaultComponentId
      ? plannerState.components.find((component) => component.id === defaultComponentId && component.active)
      : undefined;
    const taskNumber = nextTaskNumberForComponent(currentTasks, defaultComponent?.id, zoneId);
    const nextWbs = String(
      Math.max(0, ...currentTasks.map((task) => Number.parseInt(task.wbs.split(".")[0] ?? "0", 10)).filter(Number.isFinite)) + 1,
    );
    const start = lastTask?.plannedFinish ?? plannerState.tasks[0]?.plannedStart ?? new Date().toISOString();
    const newTask: Task = {
      id: `task-${Date.now()}`,
      scenarioId: plannerState.scenario.id,
      stationId,
      zoneId,
      componentId: defaultComponent?.id,
      taskNumber,
      rowType: "task",
      wbs: nextWbs,
      name: "",
      description: "",
      plannedStart: start,
      plannedFinish: start,
      plannedDurationMinutes: 0,
      plannedOperators: 0,
      plannedManHours: 0,
      status: "not_started",
      percentComplete: 0,
      dependencyIds: [],
      criticalPath: false,
      bottleneckFlag: false,
      qualityGate: false,
      travelerSignoffRequired: false,
      manufacturingSteps: [],
      partReferences: [],
      customFields: {},
    };
    const codedTask = applyTaskCode(newTask, plannerState.zones, plannerState.components, true);

    setPlannerState((current) => {
      return {
        ...current,
        tasks: [...current.tasks, codedTask],
      };
    });
    setSelectedTaskId(codedTask.id);
    setSelectedStationId(stationId);
    setActiveZoneId(zoneId);
  }

  function addTaskAtBottom() {
    addTaskToZone(activeZoneId ?? plannerState.tasks[plannerState.tasks.length - 1]?.zoneId);
  }

  function executeDeleteTasks(taskIds: string[]) {
    if (taskIds.length === 0) {
      return;
    }

    const snapshot = plannerState;
    const deletedTasks = derivedState.tasks.filter((task) => taskIds.includes(task.id));
    markDirty();
    const taskIdsToDelete = new Set(taskIds);
    const nextSelectedTask =
      selectedTaskId && !taskIdsToDelete.has(selectedTaskId)
        ? derivedState.tasks.find((task) => task.id === selectedTaskId)
        : derivedState.tasks.find((task) => !taskIdsToDelete.has(task.id));

    setPlannerState((current) => {
      const remainingTasks = current.tasks
        .filter((task) => !taskIdsToDelete.has(task.id))
        .map((task) => ({
          ...task,
          dependencyIds: task.dependencyIds.filter((dependencyId) => !taskIdsToDelete.has(dependencyId)),
          manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
            ...step,
            dependencyIds: (step.dependencyIds ?? []).filter(
              (dependencyId) => !taskDependencyRefBelongsTo(dependencyId, taskIdsToDelete),
            ),
          })),
        }));
      return {
        ...current,
        tasks: remainingTasks,
        dependencies: rebuildDependenciesFromTasks(remainingTasks, current.dependencies),
      };
    });

    setSelectedTaskId(nextSelectedTask?.id ?? "");
    setSelectedStationId(nextSelectedTask?.stationId ?? "");
    notifyRestoreAction({
      title: deletedTasks.length === 1 ? `Deleted task ${taskDisplayCode(deletedTasks[0])}` : `Deleted ${deletedTasks.length} tasks`,
      body: "Restore will bring back the deleted task data and the previous Gantt dependencies.",
      restoreLabel: deletedTasks.length === 1 ? "Restore Task" : "Restore Tasks",
      onRestore: () =>
        restorePlannerSnapshot(snapshot, {
          taskId: selectedTaskId,
          stationId: selectedStationId,
          zoneId: activeZoneId,
        }),
    });
  }

  function deleteTasks(taskIds: string[]) {
    const tasksToDelete = derivedState.tasks.filter((task) => taskIds.includes(task.id));
    if (tasksToDelete.length === 0) {
      return;
    }

    requestFeedbackConfirm({
      title: tasksToDelete.length === 1 ? `Delete task ${taskDisplayCode(tasksToDelete[0])}?` : `Delete ${tasksToDelete.length} tasks?`,
      body: "This removes the selected task data, manufacturing steps, and related Gantt dependencies.",
      tone: "danger",
      confirmLabel: tasksToDelete.length === 1 ? "Delete Task" : "Delete Tasks",
      onConfirm: () => executeDeleteTasks(taskIds),
    });
  }

  function downloadTextFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);

    return { filename, url };
  }

  function exportMarkdown() {
    const markdown = buildMarkdownReport(derivedState);
    const exportFile = downloadTextFile(
      markdown,
      `${derivedState.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-line-plan.md`,
      "text/markdown;charset=utf-8",
    );
    notifyFeedback({
      title: "Line plan export ready",
      content: (
        <div className="space-y-2">
          <p className="ui-workspace-notice-body">The download should start automatically.</p>
          <a
            href={exportFile.url}
            download={exportFile.filename}
            className="ui-btn-secondary inline-flex h-8 items-center px-3 text-xs"
          >
            Download manually
          </a>
        </div>
      ),
      tone: "success",
    });
  }

  function exportGanttDocument() {
    try {
      const documentHtml = buildStationSetupDocumentHtml(derivedState);
      const exportFile = downloadTextFile(
        documentHtml,
        `${derivedState.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-station-setup.html`,
        "text/html;charset=utf-8",
      );
      notifyFeedback({
        title: "Station setup document ready",
        content: (
          <div className="space-y-2">
            <p className="ui-workspace-notice-body">
              The HTML document should download automatically and can be opened in any browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={exportFile.url}
                download={exportFile.filename}
                className="ui-btn-secondary inline-flex h-8 items-center px-3 text-xs"
              >
                Download manually
              </a>
              <a
                href={exportFile.url}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-ghost inline-flex h-8 items-center px-3 text-xs"
              >
                Open preview
              </a>
            </div>
          </div>
        ),
        tone: "success",
      });
    } catch (error) {
      notifyFeedback({
        title: "Station setup export failed",
        body: error instanceof Error ? error.message : "The station setup document could not be generated.",
        tone: "danger",
        placement: "center",
        persistent: true,
      });
    }
  }

  function selectTask(taskId: string) {
    const task = derivedState.tasks.find((item) => item.id === taskId);
    setSelectedTaskId(taskId);
    if (task) {
      setSelectedStationId(task.stationId);
    }
  }

  function openTaskDetail(taskId: string) {
    selectTask(taskId);
    if (showDetailDrawer) {
      setDetailDrawerCollapsed(false);
    }
  }

  function openProcedureStepName(taskId: string, stepId: string) {
    selectTask(taskId);
    setFocusedProcedureStepId(stepId);
    setActiveModule("procedure");
  }

  function selectStation(stationId: string) {
    setSelectedStationId(stationId);
    const firstStationTask = derivedState.tasks.find((task) => task.stationId === stationId);
    if (firstStationTask) {
      setSelectedTaskId(firstStationTask.id);
    }
  }

  function navigateModule(moduleId: string) {
    setActiveModule(moduleId);
  }

  function openSettings(section: SettingsSection = "general") {
    setSettingsSection(section);
    setActiveModule("settings");
  }

  const lineReadinessPanel = (
    <LineReadinessPanel
      allocationRecommendations={visibleAllocationRecommendations}
      onClearPlanningRecommendations={
        currentAllocationRecommendationKey
          ? () => setDismissedPlanningRecommendationKey(currentAllocationRecommendationKey)
          : undefined
      }
      scenarioName={derivedState.scenario.name}
      stationCount={getTopLevelTasks(derivedState.tasks).length}
      taskCount={derivedState.tasks.length}
      zones={derivedState.zones}
      tasks={derivedState.tasks}
      bottleneckStation={kpis.bottleneckStation}
      targetVariance={kpis.targetVariance}
      targetVariancePercent={kpis.targetVariancePercent}
      kpis={kpis}
      onOpenTaskDetail={openTaskDetail}
      product={derivedState.product}
    />
  );

  const dashboardLineReadinessPanel = (
    <LineReadinessPanel
      embedded
      allocationRecommendations={visibleAllocationRecommendations}
      onClearPlanningRecommendations={
        currentAllocationRecommendationKey
          ? () => setDismissedPlanningRecommendationKey(currentAllocationRecommendationKey)
          : undefined
      }
      scenarioName={derivedState.scenario.name}
      stationCount={getTopLevelTasks(derivedState.tasks).length}
      taskCount={derivedState.tasks.length}
      zones={derivedState.zones}
      tasks={derivedState.tasks}
      bottleneckStation={kpis.bottleneckStation}
      targetVariance={kpis.targetVariance}
      targetVariancePercent={kpis.targetVariancePercent}
      kpis={kpis}
      onOpenTaskDetail={openTaskDetail}
      product={derivedState.product}
    />
  );

  return (
    <div
      className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
      style={workspaceGridStyle}
    >
      <TopNav
        onExport={exportMarkdown}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        context={displayedPlannerChromeContext}
        chromeStatus={chromeStatus}
      />

      {workspaceNotice ? (
        <section className="ui-workspace-notice">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <NothingStatus error={workspaceNotice.tone === "danger" || workspaceNotice.tone === "warning"}>
                {workspaceNotice.title}
              </NothingStatus>
              {workspaceNotice.content ?? (
                workspaceNotice.body ? <p className="ui-workspace-notice-body">{workspaceNotice.body}</p> : null
              )}
            </div>
            <button type="button" onClick={dismissWorkspaceNotice} className="ui-btn-ghost h-8 shrink-0 px-2">
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <div className={workspaceGridClass}>
        <div className={`ui-workspace-sidebar-slot ${sidebarCollapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
          <Sidebar
            activeModule={sidebarActiveModule}
            settingsSection={settingsSection}
            setupSection={setupSection}
            onChange={navigateModule}
            onSetupSectionChange={setSetupSection}
            onOpenSettings={openSettings}
            project={activeProjectContext}
          />
        </div>

        {isProjectSwitching ? (
          <WorkspaceSwitchSkeleton />
        ) : isProcedureModule ? (
          <ProcedureWorkspace
            product={derivedState.product}
            tasks={derivedState.tasks}
            zones={derivedState.zones}
            selectedTask={selectedTask}
            focusedStepId={focusedProcedureStepId}
            onSelectTask={selectTask}
            onConfirmAction={requestFeedbackConfirm}
            onStepDeleted={notifyDeletedStepRestore}
            onUpdateTask={updateProcedureTask}
            getProcedureFieldValue={getProcedureFieldValue}
            onProcedureFieldFocus={markProcedureFieldActive}
            onProcedureFieldBlur={markProcedureFieldInactive}
            onProcedureFieldChange={updateProcedureStepField}
            onMoveStepToTask={moveProcedureStepToTask}
            onUploadStepPhotos={uploadStepPhotos}
            onRemoveStepPhoto={removeStepPhoto}
            onAddStepTool={persistAddStepTool}
            onRemoveStepTool={persistRemoveStepTool}
            projectToolRegistry={projectToolRegistry}
          />
        ) : isSettingsModule ? (
          <main className="min-h-0 min-w-0 overflow-hidden">
            <AppSettingsPanel
              showSubnav={false}
              section={settingsSection}
              onSectionChange={setSettingsSection}
              project={activeProjectContext}
            />
          </main>
        ) : (
          <main
            className={`ui-workspace-content ${activeModule === "gantt" ? "ui-gantt-page" : ""} ${
              isDashboardModule
                ? "p-0 pb-6"
                : `space-y-4 p-3 sm:p-4 ${SIMULATION_ENABLED ? (playbackCollapsed ? "pb-20" : "pb-44") : "pb-6"}`
            }`}
          >
            {isDashboardModule ? (
              <PlannerDashboardPanel
                product={derivedState.product}
                saveError={saveError}
                kpis={kpis}
                flowDurationMinutes={timelineBounds.durationMinutes}
                zoneCount={derivedState.zones.length}
                taskCount={derivedState.tasks.length}
                stationCount={getTopLevelTasks(derivedState.tasks).length}
                planningRecommendationCount={visibleAllocationRecommendations.length}
              >
                {dashboardLineReadinessPanel}
              </PlannerDashboardPanel>
            ) : (
              <>
                {activeModule === "setup" ? (
                  <div className="ui-setup-page space-y-4">
                    {setupSection === "product" ? (
                      <ProductSetupPanel
                        product={derivedState.product}
                        onProductNumber={updateProductNumber}
                        onProductText={updateProductText}
                      />
                    ) : null}
                    {setupSection === "nomenclature" ? (
                      <NomenclatureSetupPanel
                        product={derivedState.product}
                        zones={derivedState.zones}
                        tasks={derivedState.tasks}
                        components={derivedState.components}
                        documentTypes={derivedState.documentTypes}
                        onProductText={updateProductText}
                        onUpdateZone={updateZone}
                        onAddComponent={addComponentCode}
                        onUpdateComponent={updateComponentCode}
                        onDeleteComponent={deleteComponentCode}
                        onAddDocumentType={() => addDocumentTypeCode()}
                        onUpdateDocumentType={updateDocumentTypeCode}
                        onDeleteDocumentType={deleteDocumentTypeCode}
                        onAddMissingDefaultDocumentTypes={addMissingDefaultDocumentTypeCodes}
                      />
                    ) : null}
                    {setupSection === "tools" || setupSection === "bom" ? (
                      <ProjectCatalogSetupPanel
                        tasks={derivedState.tasks}
                        projectToolRegistry={projectToolRegistry}
                        toolLibraryItems={toolLibraryItems}
                        section={setupSection === "tools" ? "tools" : "parts"}
                        masterBom={masterBom}
                        onMasterBomChange={updateMasterBom}
                        onSaveTool={saveCatalogTool}
                        onDeleteTool={deleteCatalogTool}
                        onSavePart={saveCatalogPart}
                        onDeletePart={deleteCatalogPart}
                        onConfirmAction={requestFeedbackConfirm}
                      />
                    ) : null}
                    {setupSection === "procedure-checks" ? (
                      <ProcedureChecksSetupPanel
                        product={derivedState.product}
                        onProductStepChecks={updateProductStepChecks}
                      />
                    ) : null}
                  </div>
                ) : activeModule === "work-instructions" ? (
                  <WorkInstructionsPanel
                    tasks={derivedState.tasks}
                    zones={derivedState.zones}
                    product={derivedState.product}
                    onOpenTask={(taskId) => {
                      selectTask(taskId);
                      setActiveModule("procedure");
                    }}
                  />
                ) : isComingSoonModule ? (
                  <ComingSoonModuleView moduleLabel={comingSoonModuleLabel}>
                    <KpiStrip kpis={kpis} product={derivedState.product} />
                    {lineReadinessPanel}
                  </ComingSoonModuleView>
                ) : (
                  <>
                    <KpiStrip kpis={kpis} product={derivedState.product} />
                    {lineReadinessPanel}
                  </>
                )}

                {showsSchedulingWorkspace ? (
              <>
                <section className="ui-gantt-workspace">
                  <div className="ui-gantt-workspace-head">
                    <div>
                      <h2 className="ui-section-title">Manufacturing Gantt</h2>
                      <p className="ui-section-subtitle">
                        {formatMinutes(timelineBounds.durationMinutes)} planned flow / {totalHeadcount} headcount
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
                      <button type="button" onClick={exportGanttDocument} className="ui-btn-ghost h-10 gap-2">
                        <Download size={16} />
                        Export Setup
                      </button>
                      <button type="button" onClick={addZone} className="ui-btn-ghost h-10 gap-2">
                        <Plus size={16} />
                        Zone
                      </button>
                      <button type="button" onClick={addTaskAtBottom} className="ui-btn-ghost h-10 gap-2">
                        <Plus size={16} />
                        Task
                      </button>
                      {SIMULATION_ENABLED ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPlaybackCollapsed(false);
                          setIsPlaying(true);
                        }}
                        className="ui-btn-ghost h-10 gap-2"
                      >
                        <Play size={16} />
                        Playback
                      </button>
                      ) : null}
                    </div>
                  </div>
                  <ScenarioTabs
                    scenarios={scenarios}
                    activeScenarioId={derivedState.scenario.id}
                    pendingScenarioId={switchTargetId}
                    isSwitching={isSwitchingScenario}
                    onSwitch={(scenarioId) => void switchScenario(scenarioId)}
                    onDuplicate={() => void duplicateActiveScenario()}
                    onRename={(scenarioId, name) => void renameScenarioById(scenarioId, name)}
                    onDelete={(scenarioId) => requestDeleteScenario(scenarioId)}
                    onEditTarget={(scenarioId, targetOutput, targetOutputPeriod) =>
                      void editScenarioTarget(scenarioId, targetOutput, targetOutputPeriod)
                    }
                  />
                  <GanttTimeline
                    tasks={derivedState.tasks}
                    stations={derivedState.stations}
                    zones={derivedState.zones}
                    components={derivedState.components}
                    activeZoneId={activeZoneId}
                    selectedTaskId={selectedTaskId}
                    taktMinutes={activeTaktMinutes}
                    availableOperatorLetters={availableOperatorLetters}
                    operatorCapacityMinutes={operatorCapacityMinutes}
                    demandQuantity={derivedState.product.demandQuantity}
                    currentMinute={currentMinute}
                    showPlaybackMarker={SIMULATION_ENABLED && (isPlaying || currentMinute > 0)}
                    onSelectTask={selectTask}
                    onOpenTaskDetail={openTaskDetail}
                    onOpenProcedureStepName={openProcedureStepName}
                    onUpdateTask={updateTask}
                    onUpdateZone={updateZone}
                    onCreateZoneFromTasks={createZoneFromTasks}
                    onDeleteZone={deleteZone}
                    onAddTaskToZone={addTaskToZone}
                    onActivateZone={setActiveZoneId}
                    onMoveTasksToZone={moveTasksToZone}
                    onReorderTaskGroups={reorderTaskGroups}
                    onNotify={notifyFeedback}
                    onConfirmAction={requestFeedbackConfirm}
                    smartAllocationPending={smartAllocationPending}
                    onSmartAllocate={() => void smartAllocateHeadcount()}
                    onResetHeadcount={resetTaskHeadcount}
                    onSetTaskDependencies={setTaskDependencies}
                    onLinkTaskStartToFinish={linkTaskStartToFinish}
                    onDeleteTasks={deleteTasks}
                  />
                </section>

              </>
            ) : null}
              </>
            )}
          </main>
        )}

        {showDetailDrawer ? (
          <DetailDrawer
            task={selectedTask}
            station={selectedStation}
            zones={derivedState.zones}
            components={derivedState.components}
            tasks={derivedState.tasks}
            collapsed={detailDrawerCollapsed}
            isResizing={isResizingDetailDrawer}
            onConfirmAction={requestFeedbackConfirm}
            onStepDeleted={notifyDeletedStepRestore}
            onToggleCollapsed={() => setDetailDrawerCollapsed((collapsed) => !collapsed)}
            onResizeStart={startDetailDrawerResize}
            onUpdateTask={updateTask}
            getProcedureFieldValue={getProcedureFieldValue}
            onProcedureFieldFocus={markProcedureFieldActive}
            onProcedureFieldBlur={markProcedureFieldInactive}
            onProcedureFieldChange={updateProcedureStepField}
            onUploadStepPhotos={uploadStepPhotos}
            onRemoveStepPhoto={removeStepPhoto}
            onAddStepTool={persistAddStepTool}
            onRemoveStepTool={persistRemoveStepTool}
            toolLibrary={toolLibrary}
            masterBom={masterBom}
          />
        ) : null}
      </div>

      {SIMULATION_ENABLED && !isProcedureModule && !isDashboardModule ? (
        <PlaybackPanel
          tasks={derivedState.tasks}
          stations={derivedState.stations}
          currentMinute={currentMinute}
          speed={speed}
          isPlaying={isPlaying}
          collapsed={playbackCollapsed}
          onPlayPause={() => setIsPlaying((value) => !value)}
          onReset={() => {
            setCurrentMinute(0);
            setIsPlaying(false);
          }}
          onStep={(delta) => setCurrentMinute((minute) => Math.min(Math.max(minute + delta, 0), timelineBounds.durationMinutes))}
          onSpeed={setSpeed}
          onToggleCollapsed={() => setPlaybackCollapsed((value) => !value)}
        />
      ) : null}
      <ThemedFeedbackLayer
        confirm={feedbackConfirm}
        toasts={[]}
        onCancelConfirm={() => setFeedbackConfirm(undefined)}
        onConfirm={confirmFeedbackAction}
        onDismissToast={() => {}}
      />
    </div>
  );
}
