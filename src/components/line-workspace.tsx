"use client";

import { acknowledgeAnnotationDrafts, readAnnotationDraft } from "@/lib/photo-annotation-drafts";

// Route-scoped styles: ~37 kB of planner-only rules (procedure, gantt, scenarios,
// setup, dashboard) that previously shipped to every route via globals.css.
import "./line-workspace.css";

import {
  Activity,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  applyCalculatedFields,
  calculateActiveTaktMinutes,
  calculateAvailabilityMinutesForDemandPeriod,
  calculateProductKpis,
  formatMinutes,
  getTopLevelTasks,
  getTaskWindow,
  getTimelineBounds,
  round,
} from "@/domain/calculations";
import dynamic from "next/dynamic";
import { createPlannerDerivation } from "@/domain/planner-derivation";
import { buildOperatorAssignmentsFromIePlan } from "@/domain/operator-allocation";
import type { IeSmartAllocationPlan, IeSmartAllocationRequest } from "@/domain/ie-smart-allocation";
import { getTaskOperatorIds, getTaskOperatorResetPatch, syncTaskOperatorCount } from "@/domain/operator-assignments";
import { buildStationSetupDocumentHtml } from "@/domain/report";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import {
  readCachedMainPlannerStateSync,
  readCachedPlannerState,
  writeCachedPlannerState,
} from "@/lib/planner-state-cache";
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
  taskPatchChangesSchedule,
} from "@/domain/task-mutations";
import {
  buildSmartAllocationReviewText,
  buildUnallocatedWorkReviews,
  issueReviewLabel,
} from "@/domain/smart-allocation-report";
import {
  duplicateStepPhotoAttachment,
  getStepPhotoAttachments,
  getTaskStepPhotoAnnotationMap,
  removeStepPhotoAttachment,
  upsertStepPhotoAttachments,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import {
  StepPhotoClipboardProvider,
  type StepPhotoTarget,
} from "@/components/line-workspace/step-photo-clipboard-provider";
import type { StepPhotoClipboardEntry } from "@/domain/step-photo-clipboard";
import { applyPastedPhoto, revertPastedPhoto } from "@/domain/step-photo-paste";
import { removeTaskExplodedView, type ExplodedView } from "@/domain/step-exploded-views";
import { removeTaskVideo, type TaskVideo } from "@/domain/task-videos";
import { mergeTaskPrivateMedia } from "@/domain/task-private-media";
import { buildStepToolLibrary, removeToolFromAllTasks, renameToolInTasks } from "@/domain/step-tools";
import type { ProjectToolCatalogEntry } from "@/domain/project-catalog";
import { buildProjectToolRegistry } from "@/domain/tool-registry";
import { canonicalToolKey, formatToolName } from "@/domain/tool-name-format";
import type { ToolTypeValue } from "@/domain/tool-types";
import {
  PRODUCT_STEP_CHECK_CONFIG_FIELD,
  serializeManufacturingStepCheckDefinitions,
  type ManufacturingStepCheckDefinition,
} from "@/domain/manufacturing-step-checks";
import {
  PRODUCT_MASTER_BOM_FIELD,
  getMasterBom,
  serializeMasterBom,
  type MasterBom,
} from "@/domain/master-bom";
import {
  PRODUCT_PFMEA_DOCUMENT_FIELD,
  serializePfmeaDocument,
  type PfmeaDocument,
} from "@/domain/pfmea";
import {
  defaultDocumentTypeCodes,
  nextTaskNumberForComponent,
  taskDisplayCode,
} from "@/domain/nomenclature";
import { moveManufacturingStepBetweenTasks } from "@/domain/move-manufacturing-step";
import {
  formatManHours,
  safeNumber,
} from "@/domain/formatting";
import {
  rebuildDependenciesFromTasks,
  relinkTasksForDependency,
  rescheduleTasksByDependencies,
  sanitizeDependencyIds,
  taskDependencyRefBelongsTo,
} from "@/domain/task-scheduling";
import { optimizeLine as runLineOptimization } from "@/domain/joint-scheduler";
import {
  addStepToolToSupabase,
  canPatchTaskFromRealtimePayload,
  copyStepPhotoAttachmentToStep,
  createPlannerSupabaseClient,
  deleteToolLibraryFromSupabase,
  deleteScenario,
  duplicateScenario,
  listSopSummariesFromSupabase,
  type SopSummary,
  loadPlannerCoreStateFromSupabase,
  loadPlannerStateFromSupabase,
  loadScenariosForProduct,
  loadWorkspaceProjectGroups,
  loadTaskFromSupabase,
  loadTaskPrivateMediaFromSupabase,
  renameScenario,
  updateScenarioTarget,
  loadToolLibraryFromSupabase,
  moveManufacturingStepToTaskInSupabase,
  removeStepToolFromSupabase,
  saveMasterBomToSupabase,
  upsertToolLibraryMetadata,
  savePlannerShellToSupabase,
  savePlannerStateToSupabase,
  saveProcedureTaskUpdateToSupabase,
  saveTaskCustomFieldsToSupabase,
  saveTaskPhotoAnnotationsToSupabase,
  saveTasksToSupabase,
  softDeleteExplodedViewFromSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  softDeleteTaskVideoFromSupabase,
  removeExplodedViewObject,
  removeTaskVideoObject,
  subscribePlannerStateChanges,
  taskIdFromRealtimePayload,
  uploadStepPhotoAttachment,
  type SaveState,
  type ToolLibraryItem,
} from "@/domain/supabase-planner";
import type {
  DocumentTypeCode,
  ManufacturingStep,
  ManufacturingComponent,
  PlannerProjectContext,
  PlannerState,
  Product,
  Project,
  ScenarioSummary,
  Station,
  Task,
  Zone,
} from "@/domain/types";
import { BulkTaskEditor } from "./bulk-task-editor";
import { CommandPalette, type CommandPaletteGroup } from "./command-palette";
import { ScenarioTabs } from "./scenario-tabs";
import { ThemedFeedbackLayer, type FeedbackConfirm, type FeedbackToast } from "./themed-feedback";
import { WORKER_ICON_LETTERS, WorkerIcon } from "./worker-icon";
import { NothingStatus } from "./nothing-ui";
import { PlannerDashboardPanel, buildPlannerChromeContext } from "./planner-dashboard-panel";
import { TopNav } from "./planner-top-nav";
import { announceProjectSwitch, projectPlannerHref } from "./sidebar-workspace-panel";
import { PlannerWorkspaceSkeleton, ProductLoadingState, SettingsLoadingState } from "./space-loading-states";
import { usePlannerPresence, type PresencePeer } from "@/lib/use-planner-presence";
import { AppSettingsPanel, embeddedSettingsSections, type SettingsSection } from "./app-settings-panel";
import { ThemedSelect } from "./themed-select";
import { KpiStrip, LineReadinessPanel } from "./line-workspace/analytics";
import { ChecklistWorkspace } from "./line-workspace/planner-foundation-pages";
import {
  Sidebar,
  SidebarReopenButton,
  quickSwitchModules,
  type SetupSection,
} from "./line-workspace/nav";
import {
  PROJECT_SWITCH_EVENT,
  PROJECT_SWITCH_SKELETON_MIN_MS,
  buildWorkspaceUrl,
  buildProjectSwitchTargetContext,
  clearProcedureDraftSnapshot,
  clearProjectSwitchSession,
  getProcedureStepFieldValue,
  hasRecentProjectSwitchSession,
  makeProcedureDraftKey,
  mergeProcedureDraftWithServer,
  procedureDraftLog,
  procedureDraftStorageKey,
  readProcedureDraftSnapshot,
  readProjectSwitchTarget,
  readWorkspaceSnapshot,
  readWorkspaceUrlSnapshot,
  recentProjectSwitchStartedAt,
  writeProcedureFieldDraftSnapshot,
  writeWorkspaceSnapshot,
  type ProcedureDraftField,
  type ProcedureDraftMap,
  type ProjectSwitchTarget,
  type WorkspaceSnapshot,
} from "./line-workspace/state";
import {
  NomenclatureSetupPanel,
  ProcedureChecksSetupPanel,
  ProductSetupPanel,
  WorkInstructionsPanel,
} from "./line-workspace/setup-panels";
import {
  StatCard,
  type ProcedureDraftFieldName,
  type ProductNumberField,
  type ProductTextField,
} from "./line-workspace/shared";


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
  annotationOnly?: boolean;
  annotationBase?: ReturnType<typeof getTaskStepPhotoAnnotationMap>;
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

const GanttTimeline = dynamic(() => import("./gantt-timeline").then((module) => module.GanttTimeline), { loading: () => <PlannerWorkspaceSkeleton /> });
const OperatorUtilizationPanel = dynamic(() => import("./operator-utilization-panel").then((module) => module.OperatorUtilizationPanel), { loading: () => <PlannerWorkspaceSkeleton /> });
const ProjectCatalogSetupPanel = dynamic(() => import("./project-catalog-setup-panel").then((module) => module.ProjectCatalogSetupPanel), { loading: () => <PlannerWorkspaceSkeleton /> });
const DetailDrawer = dynamic(() => import("./line-workspace/drawer").then((module) => module.DetailDrawer));
const ProcedureWorkspace = dynamic(() => import("./line-workspace/procedure").then((module) => module.ProcedureWorkspace), { loading: () => <PlannerWorkspaceSkeleton /> });
const PfmeaWorkspace = dynamic(() => import("./line-workspace/pfmea-workspace").then((module) => module.PfmeaWorkspace), { loading: () => <PlannerWorkspaceSkeleton /> });

// Cap on the planner undo history. Snapshots are structural-shared PlannerState objects,
// so the memory cost is per-edit deltas, not full copies.
const UNDO_HISTORY_LIMIT = 50;

const SIMULATION_ENABLED = false;

const playbackSpeeds = [
  { label: "1m/s", value: 1 },
  { label: "5m/s", value: 5 },
  { label: "15m/s", value: 15 },
  { label: "1h/s", value: 60 },
];

const PROCEDURE_SAVE_DEBOUNCE_MS = 750;

// Top-level free-text task fields a user types into directly (task name, Task Description, Safety
// Notes, QC checklist, general notes, and the reference-link/material inputs). Unlike
// manufacturing-step fields these are NOT tracked by the per-step procedure-draft system, so a stale
// server echo from our own in-flight save — or a remote refresh that lands between keystrokes —
// would otherwise overwrite characters the user just typed. mergeServerTaskIntoLocalTask preserves
// the local value for these when it can only be unsaved local typing. customFields (custom Gantt
// column cells) get the same treatment via a dedicated object-aware guard in
// preserveLocalEditedTaskText, since this list is string-only. sopId is select-driven rather than
// typed, but shares the same echo race: a procedure save whose snapshot predates the SOP pick
// echoes the old sop id back on completion, so it needs the same local-wins protection.
const LOCAL_EDITED_TASK_TEXT_FIELDS = [
  "name",
  "description",
  "safetyNotes",
  "notes",
  "qcChecklist",
  "sopLink",
  "sopId",
  "workInstructionLink",
  "drawingLink",
  "materialKit",
] as const satisfies ReadonlyArray<keyof Task>;

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
              className="flex h-8 w-8 items-center justify-center rounded bg-accent text-canvas hover:opacity-90"
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
  initialPlannerState,
}: {
  projectId?: string;
  projectContext?: PlannerProjectContext;
  onReady?: () => void;
  /**
   * Server-fetched planner state (refactor plan, Stage 5): painted through the
   * same path as the IndexedDB cache — content on the first frame, destructive
   * shell autosave stays DISABLED until this client's own editable-core load
   * confirms the state (which also closes the realtime stale window). Consumed once, for
   * the first project only.
   */
  initialPlannerState?: PlannerState;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const plannerQueryString = searchParams.toString();
  const hasAutosaveHarnessParam = searchParams.get("autosaveHarness") === "1";
  const urlWorkspaceSnapshot = useMemo<Partial<WorkspaceSnapshot>>(
    () => readWorkspaceUrlSnapshot(plannerQueryString),
    [plannerQueryString],
  );
  const initialPlannerStateMatchesProject = Boolean(
    initialPlannerState &&
      projectId &&
      String(initialPlannerState.product.projectId ?? "") === String(projectId),
  );
  const initialCachedPlannerSnapshotRef = useRef(readCachedMainPlannerStateSync(projectId));
  const initialCachedPlannerState = initialCachedPlannerSnapshotRef.current?.state;
  const initialCachedPlannerStateMatchesProject = Boolean(
    initialCachedPlannerState &&
      projectId &&
      String(initialCachedPlannerState.product.projectId ?? "") === String(projectId),
  );
  const hasInitialDisplayablePlannerState = initialCachedPlannerStateMatchesProject || initialPlannerStateMatchesProject;
  const [plannerState, setPlannerState] = useState<PlannerState>(() =>
    initialCachedPlannerStateMatchesProject && initialCachedPlannerState
      ? ensureNomenclatureCollections(initialCachedPlannerState)
      : initialPlannerStateMatchesProject && initialPlannerState
      ? ensureNomenclatureCollections(initialPlannerState)
      : emptyPlannerState,
  );
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
  const [activeModule, setActiveModule] = useState(() => urlWorkspaceSnapshot.activeModule ?? "dashboard");
  const restoringWorkspaceHistoryRef = useRef(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");
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
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(
    () => hasInitialDisplayablePlannerState || hasRecentProjectSwitchSession(),
  );
  // A server summary or IndexedDB snapshot is displayable but intentionally not
  // editable. Detail modules stay behind the in-workspace skeleton until the
  // complete editable core has arrived and enabled the write safety contract.
  const [hasConfirmedRemoteState, setHasConfirmedRemoteState] = useState(false);
  const [taskDetailHydrationStatus, setTaskDetailHydrationStatus] = useState<
    Record<string, "loading" | "loaded" | "error">
  >({});
  const [isProjectSwitching, setIsProjectSwitching] = useState(
    () => hasRecentProjectSwitchSession() && !hasInitialDisplayablePlannerState,
  );
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const [smartAllocationPending, setSmartAllocationPending] = useState(false);
  const [dismissedPlanningRecommendationKey, setDismissedPlanningRecommendationKey] = useState("");
  const saveInFlightRef = useRef(false);
  const masterBomSaveInFlightRef = useRef(false);
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
  const taskDetailHydrationRequestsRef = useRef<Set<string>>(new Set());
  const fullyHydratedScenarioIdsRef = useRef<Set<string>>(new Set());
  const hasLocalSaveWorkRef = useRef(hasLocalSaveWork);
  hasLocalSaveWorkRef.current = hasLocalSaveWork;
  const flushPendingPlannerSaveRef = useRef(flushPendingPlannerSave);
  const applyProcedureDraftsToTaskRef = useRef(applyProcedureDraftsToTask);
  const mergeServerTaskIntoLocalTaskRef = useRef(mergeServerTaskIntoLocalTask);
  const scheduleProcedureTaskSaveRef = useRef(scheduleProcedureTaskSave);
  const requestRemotePlannerRefreshRef = useRef(requestRemotePlannerRefresh);
  const requestRemoteTaskRefreshRef = useRef(requestRemoteTaskRefresh);
  const startProcedureTaskSaveRef = useRef(startProcedureTaskSave);
  const persistPlannerStateRef = useRef(persistPlannerState);
  const urlWorkspaceSnapshotRef = useRef(urlWorkspaceSnapshot);
  flushPendingPlannerSaveRef.current = flushPendingPlannerSave;
  applyProcedureDraftsToTaskRef.current = applyProcedureDraftsToTask;
  mergeServerTaskIntoLocalTaskRef.current = mergeServerTaskIntoLocalTask;
  scheduleProcedureTaskSaveRef.current = scheduleProcedureTaskSave;
  requestRemotePlannerRefreshRef.current = requestRemotePlannerRefresh;
  requestRemoteTaskRefreshRef.current = requestRemoteTaskRefresh;
  startProcedureTaskSaveRef.current = startProcedureTaskSave;
  persistPlannerStateRef.current = persistPlannerState;
  urlWorkspaceSnapshotRef.current = urlWorkspaceSnapshot;
  const loadedProjectIdRef = useRef<string | undefined>(undefined);
  // True only once the REMOTE planner load has applied for the loaded project. A cached IndexedDB
  // snapshot alone must never enable the shell autosave: savePlannerShellToSupabase is a destructive
  // diff-save, and persisting a stale snapshot would delete rows teammates added since it was written.
  const remoteStateConfirmedRef = useRef(false);
  // The product's Main scenario id (earliest-created, what an unqualified remote load fetches).
  // Recorded alongside cache writes so a reload can tell whether the cached snapshot matches the
  // scenario the remote load will return.
  const mainScenarioIdRef = useRef<string | undefined>(undefined);
  const hasLoadedAnyProjectRef = useRef(hasInitialDisplayablePlannerState || hasRecentProjectSwitchSession());
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
  const workspaceToasts = useMemo<FeedbackToast[]>(
    () => [
      ...(chromeStatus ? [{ id: 0, title: chromeStatus.message, tone: chromeStatus.error ? "danger" as const : "neutral" as const }] : []),
      ...(workspaceNotice ? [{ id: 1, ...workspaceNotice }] : []),
    ],
    [workspaceNotice, chromeStatus],
  );

  const [derivePlanner] = useState(createPlannerDerivation);
  const { state: derivedState, planningTasks } = useMemo(
    () => derivePlanner(plannerState),
    [derivePlanner, plannerState],
  );

  const masterBom = useMemo(
    () => getMasterBom(derivedState.product.customFields),
    [derivedState.product.customFields],
  );
  const hydratedTaskIds = useMemo(
    () =>
      new Set(
        Object.entries(taskDetailHydrationStatus)
          .filter(([, status]) => status === "loaded")
          .map(([taskId]) => taskId),
      ),
    [taskDetailHydrationStatus],
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

  // Keep the Main scenario id current whenever the switcher list refreshes (earliest first = Main).
  useEffect(() => {
    if (scenarios.length > 0) {
      mainScenarioIdRef.current = scenarios[0].id;
    }
  }, [scenarios]);

  useEffect(() => {
    function handlePageHide() {
      flushPendingPlannerSaveRef.current();
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasLocalSaveWorkRef.current()) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    function handleLinkNavigation(event: MouseEvent) {
      if (!masterBomSaveInFlightRef.current) {
        return;
      }
      const eventTarget = event.target;
      const anchor = eventTarget instanceof Element ? eventTarget.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setChromeStatus({ message: "BOM is still saving. Wait for Saved before leaving this page.", error: true });
    }

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkNavigation, true);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkNavigation, true);
      flushPendingPlannerSaveRef.current();
    };
  }, []);

  const kpis = useMemo(
    () => calculateProductKpis(derivedState.product, derivedState.stations, planningTasks),
    [derivedState.product, derivedState.stations, planningTasks],
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

  const timelineBounds = useMemo(() => getTimelineBounds(planningTasks), [planningTasks]);
  const totalHeadcount = kpis.peakManpower;
  const availableOperatorLetters = useMemo(
    () => WORKER_ICON_LETTERS.slice(0, Math.min(Math.max(kpis.wholePersonStaffingRequirement, 0), WORKER_ICON_LETTERS.length)),
    [kpis.wholePersonStaffingRequirement],
  );
  const operatorCapacityMinutes = useMemo(
    () => calculateAvailabilityMinutesForDemandPeriod(derivedState.product),
    [derivedState.product],
  );
  const toolLibrary = useMemo(() => {
    const toolsByKey = new Map<string, string>();
    buildStepToolLibrary(derivedState.tasks).forEach((tool) => {
      toolsByKey.set(canonicalToolKey(tool), tool);
    });
    toolLibraryItems.forEach((item) => {
      const toolName = formatToolName(item.toolName);
      const key = canonicalToolKey(toolName);
      if (key && !toolsByKey.has(key)) {
        toolsByKey.set(key, toolName);
      }
    });
    return [...toolsByKey.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [derivedState.tasks, toolLibraryItems]);
  const currentOperatorAllocation = useMemo(() => buildOperatorAssignmentsFromIePlan({
    assignments: planningTasks.map((task) => ({
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
    tasks: planningTasks,
  }), [
    availableOperatorLetters,
    derivedState.product.demandQuantity,
    planningTasks,
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
  // Per-project view-only access. RLS already rejects these writes server-side; gating
  // here keeps the UI honest instead of letting edits look saved and silently vanish.
  const isViewOnlyAccess = Boolean(
    activeProjectContext &&
      (activeProjectContext.accessLevel === "view" ||
        (activeProjectContext.accessLevel === undefined && activeProjectContext.role === "viewer")),
  );
  const isViewOnlyAccessRef = useRef(isViewOnlyAccess);
  isViewOnlyAccessRef.current = isViewOnlyAccess;
  const viewOnlyNoticeShownRef = useRef(false);
  // Undo/redo history over user-driven plannerState mutations (captured by the effect
  // near the autosave scheduler; remote realtime patches and scenario loads are excluded).
  const undoStackRef = useRef<PlannerState[]>([]);
  const redoStackRef = useRef<PlannerState[]>([]);
  const undoTrackingRef = useRef<{ state: PlannerState; dirtyVersion: number; scenarioId?: string } | null>(null);
  const skipHistoryCaptureRef = useRef(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Cross-app palette data, loaded lazily the first time the palette opens.
  const [paletteProjects, setPaletteProjects] = useState<Array<{ project: Project; workspaceName: string }>>([]);
  const [paletteSops, setPaletteSops] = useState<SopSummary[]>([]);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const presencePeers = usePlannerPresence(projectId);
  const presencePeersRef = useRef<PresencePeer[]>([]);
  presencePeersRef.current = presencePeers;
  const lastConflictNoticeAtRef = useRef(0);
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

  useEffect(() => {
    let active = true;

    loadToolLibraryFromSupabase(activeProjectContext?.projectId)
      .then((tools) => {
        if (active) {
          setToolLibraryItems(tools);
        }
      })
      .catch(() => {
        if (active) {
          setToolLibraryItems([]);
        }
      });

    return () => {
      active = false;
    };
  }, [activeProjectContext?.projectId]);

  // Tool-name cleanup is user-triggered from the Tools catalog ("Tidy names"),
  // not automatic on load — see tidyCatalogToolNames / ProjectCatalogSetupPanel.

  useEffect(() => {
    if (!hasLoadedRemoteState || isProjectSwitching) {
      return;
    }
    if (restoringWorkspaceHistoryRef.current) {
      restoringWorkspaceHistoryRef.current = false;
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

    // Read the live address bar rather than the hook snapshot. Native history
    // updates are intentionally local and may not cause useSearchParams to
    // publish a new value in every supported Next/browser combination.
    const nextUrl = buildWorkspaceUrl(pathname, window.location.search, {
      activeModule,
      selectedTaskId,
      selectedStationId,
      activeZoneId,
    });
    if (nextUrl === `${window.location.pathname}${window.location.search}`) {
      return;
    }

    // These parameters mirror state that already lives in this mounted Product
    // workspace. A Next router navigation would rerun the dynamic server page
    // (and its summary queries) for every sidebar click or task selection. The
    // native History API keeps the shareable URL in sync without a server/RSC
    // round trip; Next patches it so useSearchParams still receives the update.
    window.history.replaceState(window.history.state, "", nextUrl);
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

  useEffect(() => {
    function restoreWorkspaceFromHistory() {
      const snapshot = readWorkspaceUrlSnapshot(window.location.search);
      restoringWorkspaceHistoryRef.current = true;
      setActiveModule(snapshot.activeModule ?? "dashboard");
      if (snapshot.selectedTaskId) setSelectedTaskId(snapshot.selectedTaskId);
      if (snapshot.selectedStationId) setSelectedStationId(snapshot.selectedStationId);
      setActiveZoneId(snapshot.activeZoneId);
    }

    window.addEventListener("popstate", restoreWorkspaceFromHistory);
    return () => window.removeEventListener("popstate", restoreWorkspaceFromHistory);
  }, []);

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

  // Whether a specific task has unconfirmed local edits (a debounced/retrying save pending, or a save
  // in flight). Used to decide whether a remote refresh may safely overwrite the task's top-level
  // free-text fields, or whether the user is actively editing and the local value must be kept.
  function hasPendingProcedureSaveWork(taskId: string) {
    const queue = procedureSaveQueuesRef.current[taskId];
    return Boolean(
      procedureSaveTimersRef.current[taskId] ||
        procedureRetryTimersRef.current[taskId] ||
        (queue && (queue.inFlight || queue.pending)),
    );
  }

  // Rebase any in-progress local edits to the top-level free-text fields back onto a freshly merged
  // server task, so an autosave echo or remote refresh can't wipe text the user just typed.
  //
  // A save completion echoes back exactly what we sent, so any field where the local value now differs
  // is necessarily a keystroke made after that save started — local always wins. For remote refreshes
  // we only keep the local value while a save for this task is still pending/in flight (the user is
  // actively editing); otherwise the server value is authoritative.
  function preserveLocalEditedTaskText(localTask: Task, mergedTask: Task, sourceMeta?: { source?: string }): Task {
    const isSaveCompletion = sourceMeta?.source === "saveCompletion";
    const hasNewerLocalSave = hasPendingProcedureSaveWork(localTask.id);
    if (!isSaveCompletion && !hasNewerLocalSave) {
      return mergedTask;
    }

    const preserved: Partial<Record<keyof Task, unknown>> = {};
    for (const field of LOCAL_EDITED_TASK_TEXT_FIELDS) {
      const localValue = localTask[field];
      if (localValue !== undefined && localValue !== mergedTask[field]) {
        preserved[field] = localValue;
      }
    }

    // customFields hold user-typed custom Gantt column values — same echo/refresh race as the text
    // fields, but it is an object, so compare structurally (the map is rebuilt immutably on every
    // keystroke, making reference equality useless). Local wins under the same conditions as above.
    if (
      localTask.customFields !== undefined &&
      localTask.customFields !== mergedTask.customFields &&
      JSON.stringify(localTask.customFields) !== JSON.stringify(mergedTask.customFields)
    ) {
      preserved.customFields = localTask.customFields;
    }

    // A part can be attached while an older procedure save is still in flight. Keep the newer
    // allocation visible until its queued save completes; otherwise the older server echo briefly
    // removes the part and can make a successful Add look like it failed. Rebase step versions from
    // the response so the queued save can still use the freshest optimistic-lock values.
    if (
      hasNewerLocalSave &&
      JSON.stringify(localTask.manufacturingSteps ?? []) !== JSON.stringify(mergedTask.manufacturingSteps ?? [])
    ) {
      const mergedStepById = new Map((mergedTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
      preserved.manufacturingSteps = (localTask.manufacturingSteps ?? []).map((step) => ({
        ...step,
        version: mergedStepById.get(step.id)?.version ?? step.version,
      }));
    }

    if (
      hasNewerLocalSave &&
      JSON.stringify(localTask.partReferences ?? []) !== JSON.stringify(mergedTask.partReferences ?? [])
    ) {
      preserved.partReferences = localTask.partReferences;
    }

    if (Object.keys(preserved).length === 0) {
      return mergedTask;
    }

    procedureDraftLog("merge preserving local task text", {
      taskId: localTask.id,
      source: sourceMeta?.source,
    });
    return { ...mergedTask, ...preserved } as Task;
  }

  function hasPlannerShellSaveWork() {
    return saveInFlightRef.current || plannerDirtyRef.current || Boolean(plannerSaveTimerRef.current);
  }

  function hasLocalSaveWork() {
    return masterBomSaveInFlightRef.current || hasPlannerShellSaveWork() || hasProcedureSaveWork();
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
    writeProcedureFieldDraftSnapshot(projectId, procedureDraftsRef.current);
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
      return preserveLocalEditedTaskText(localTask, serverTask, sourceMeta);
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

    return preserveLocalEditedTaskText(localTask, mergedTask, sourceMeta);
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
      void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
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
      const previousStorage = window.localStorage.getItem(procedureDraftStorageKey(projectId));

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
          window.localStorage.removeItem(procedureDraftStorageKey(projectId));
        } else {
          window.localStorage.setItem(procedureDraftStorageKey(projectId), previousStorage);
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
    // The development-only harness intentionally installs one snapshot per project. Its helpers
    // read mutable procedure refs, while re-registering on every render would reset test state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAutosaveHarnessParam, projectId]);

  function flushPendingPlannerSave() {
    // Until the remote load has confirmed the state we're editing, the shell diff-save must never
    // run: flushing a cache-era snapshot would delete rows added remotely since it was written.
    if (!remoteStateConfirmedRef.current) {
      return;
    }

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
    setTaskDetailHydrationStatus(
      fullyHydratedScenarioIdsRef.current.has(normalized.scenario.id)
        ? Object.fromEntries(normalized.tasks.map((task) => [task.id, "loaded" as const]))
        : {},
    );
    taskDetailHydrationRequestsRef.current.clear();
  }

  // Switch the Gantt to another scenario. Hard rule (spec §4.2 / §7.4): save first; if the save fails
  // or doesn't settle, ABORT -- show the error and stay on the current scenario. Never switch on a
  // failed/partial save. Realtime re-subscribes automatically via the derivedState.scenario.id effect.
  // Flush + await all local saves before a scenario action; on failure show a warning and return false.
  async function ensureSavedBeforeScenarioAction(failTitle: string, failBody: string): Promise<boolean> {
    // Without a confirmed remote load there is no safe way to persist local changes (the shell save
    // stays disabled); surface an error instead of waiting for a save that can never run.
    if (!remoteStateConfirmedRef.current) {
      notifyFeedback({
        title: failTitle,
        body: "The latest database state hasn't finished loading, so local changes can't be saved safely yet. Try again in a moment.",
        tone: "warning",
      });
      return false;
    }

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
    fullyHydratedScenarioIdsRef.current.add(loaded.scenario.id);
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

  // Whether the workspace still shows the project + scenario a refresh was started for. Refreshes
  // resolve asynchronously; by then the user may have switched, and applying (or caching) the
  // fetched result would contaminate the newly loaded view. Reads live values from refs so that
  // in-flight promise callbacks are not fooled by their captured render's scope.
  function isRefreshTargetCurrent(forProjectId: string, forScenarioId: string) {
    return (
      latestDerivedStateRef.current.scenario.id === forScenarioId && loadedProjectIdRef.current === forProjectId
    );
  }

  function refreshTasksFromSupabase(taskIds: string[]) {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    const forProjectId = projectId ?? "";
    const forScenarioId = latestDerivedStateRef.current.scenario.id;

    void Promise.all(taskIds.map((taskId) => loadTaskFromSupabase(taskId, projectId)))
      .then((latestTasks) => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }

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

        setTaskDetailHydrationStatus((current) => ({
          ...current,
          ...Object.fromEntries([...taskById.keys()].map((taskId) => [taskId, "loaded" as const])),
        }));

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
          void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
          return nextState;
        });
        setSaveError(undefined);
        setSaveState("saved");
      })
      .catch(() => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }
        requestRemotePlannerRefresh();
      });
  }

  function requestRemoteTaskRefresh(taskId: string) {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      maybeNotifyConcurrentEdit();
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
    const forProjectId = projectId ?? "";
    const forScenarioId = latestDerivedStateRef.current.scenario.id;

    void loadPlannerStateFromSupabase(projectId, forScenarioId)
      .then((savedState) => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }

        if (!savedState || hasPlannerShellSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        pendingRemoteRefreshRef.current = false;
        remoteRefreshAppliedRef.current = true;
        fullyHydratedScenarioIdsRef.current.add(savedState.scenario.id);
        setTaskDetailHydrationStatus(
          Object.fromEntries(savedState.tasks.map((task) => [task.id, "loaded" as const])),
        );
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
          void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
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
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }
        setSaveError(error instanceof Error ? error.message : "Unable to refresh database changes.");
        setSaveState("error");
      });
  }

  // A realtime change landed while this user has unsaved local edits. Authorship isn't
  // in the payload, so gate on presence (someone else is actually in this project) to
  // avoid firing on the echo of our own saves, and throttle to one notice a minute.
  function maybeNotifyConcurrentEdit() {
    const peers = presencePeersRef.current;
    if (!peers.length || !plannerDirtyRef.current) {
      return;
    }
    const now = Date.now();
    if (now - lastConflictNoticeAtRef.current < 60_000) {
      return;
    }
    lastConflictNoticeAtRef.current = now;
    notifyFeedback({
      title: `Editing alongside ${peers.map((peer) => peer.name).join(", ")}`,
      body: "This scenario just changed while you have unsaved edits. The latest save wins — coordinate to avoid overwriting each other's work.",
      tone: "warning",
    });
  }

  function requestRemotePlannerRefresh() {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      maybeNotifyConcurrentEdit();
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

  // Ref-captured so the load effect keys on [projectId] alone: a new RSC render of
  // the same page must not restart the whole load flow just for a new prop identity.
  const initialPlannerStateRef = useRef(initialPlannerState);
  initialPlannerStateRef.current = initialPlannerState;
  // Seed once per project: a project switch re-renders the server page with the new
  // project's state, which is a legitimate fresh seed.
  const consumedInitialPlannerStateForRef = useRef<string | undefined>(undefined);
  const consumedInitialCachedPlannerStateForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let remoteLoaded = false;
    let serverSeededThisLoad = false;
    const currentProjectId = projectId ?? "";
    const initialUrlWorkspaceSnapshot = urlWorkspaceSnapshotRef.current;
    const cachedSeedSnapshot = initialCachedPlannerSnapshotRef.current;
    const hasWarmCachedProject = Boolean(
      cachedSeedSnapshot &&
        String(cachedSeedSnapshot.state.product.projectId ?? "") === currentProjectId &&
        cachedSeedSnapshot.scenarioId &&
        cachedSeedSnapshot.mainScenarioId &&
        cachedSeedSnapshot.scenarioId === cachedSeedSnapshot.mainScenarioId,
    );
    const isSwitchingProject = hasLoadedAnyProjectRef.current && loadedProjectIdRef.current !== currentProjectId;

    if (isSwitchingProject && !projectSwitchStartedAtRef.current) {
      projectSwitchStartedAtRef.current = Date.now();
    }
    if (isSwitchingProject) {
      setProjectSwitchTargetContext(buildProjectSwitchTargetContext(readProjectSwitchTarget()));
    }
    setIsProjectSwitching(isSwitchingProject && !hasWarmCachedProject);
    setHasLoadedRemoteState((loaded) => (hasWarmCachedProject || (isSwitchingProject && loaded) ? true : false));
    setHasConfirmedRemoteState(false);
    setSaveState("loading");
    // The shell autosave stays disabled until THIS project's remote load confirms the state; a
    // cached snapshot alone must never be diff-saved back to the database.
    remoteStateConfirmedRef.current = false;
    mainScenarioIdRef.current = undefined;
    taskDetailHydrationRequestsRef.current.clear();
    fullyHydratedScenarioIdsRef.current.clear();
    setTaskDetailHydrationStatus({});

    function applyLoadedPlannerState(savedState: PlannerState, source: "cache" | "remote") {
      const normalizedSavedState = ensureNomenclatureCollections(savedState);
      const procedureDraft = readProcedureDraftSnapshot(projectId);
      const workspaceSnapshot = readWorkspaceSnapshot(projectId);
      let recoveredTaskIds: string[] = [];
      let recoveredTask: Task | undefined;
      let hasUnmatchedRecoveredDrafts = false;
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
        // Only drafts whose task exists in this load can be re-saved here. Others (e.g. another
        // scenario's tasks) stay in storage for a later load instead of flagging a phantom draft.
        const recoveredDraftTaskIds = [...new Set(procedureDraft.fields.map((field) => field.taskId))];
        recoveredTaskIds = recoveredDraftTaskIds.filter((taskId) =>
          normalizedSavedState.tasks.some((task) => task.id === taskId),
        );
        hasUnmatchedRecoveredDrafts = recoveredTaskIds.length < recoveredDraftTaskIds.length;
        hydratedState = {
          ...normalizedSavedState,
          tasks: normalizedSavedState.tasks.map((task) => applyProcedureDraftsToTaskRef.current(task, recoveredDrafts)),
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
        } else {
          hasUnmatchedRecoveredDrafts = true;
        }
      }
      const snapshotTask = workspaceSnapshot?.selectedTaskId
        ? hydratedState.tasks.find((task) => task.id === workspaceSnapshot.selectedTaskId)
        : undefined;
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
        setHasConfirmedRemoteState(false);
        setSaveState("loading");
        return;
      }

      // Only a confirmed remote load may enable the shell autosave. An unqualified remote load
      // always returns the product's Main scenario, so record its id for future cache writes.
      remoteStateConfirmedRef.current = true;
      setHasConfirmedRemoteState(true);
      mainScenarioIdRef.current = hydratedState.scenario.id;
      // The remote state just replaced whatever was on screen (including any cache-era edits, by
      // design), so no unsaved shell work remains; a dangling dirty flag would defer realtime
      // refreshes forever since the gated autosave never ran to clear it.
      plannerDirtyRef.current = false;

      finishProjectSwitch();

      void writeCachedPlannerState(projectId, hydratedState, mainScenarioIdRef.current).catch(() => undefined);

      if (recoveredTaskIds.length > 0) {
        setSaveState("draft");
        window.setTimeout(() => {
          recoveredTaskIds.forEach((taskId) => {
            const taskToSave = hydratedState.tasks.find((task) => task.id === taskId);
            if (taskToSave) {
              scheduleProcedureTaskSaveRef.current(taskToSave, hydratedState.tasks);
            }
          });
        }, 250);
        return;
      }

      // Keep drafts that matched no task in this load (they belong to a different scenario);
      // clearing them here would destroy recoverable typing.
      if (!hasUnmatchedRecoveredDrafts) {
        clearProcedureDraftSnapshot(projectId);
      }
      setSaveState("saved");
    }

    // Server-fetched state paints first when it matches this project (Stage 5).
    // "cache" source: the destructive shell autosave stays disabled until the
    // client's own editable-core load below confirms — that load also closes the
    // window between the server snapshot and the realtime subscription.
    if (
      cachedSeedSnapshot &&
      hasWarmCachedProject &&
      consumedInitialCachedPlannerStateForRef.current !== currentProjectId
    ) {
      consumedInitialCachedPlannerStateForRef.current = currentProjectId;
      serverSeededThisLoad = true;
      applyLoadedPlannerState(cachedSeedSnapshot.state, "cache");
      clearProjectSwitchSession();
      projectSwitchStartedAtRef.current = undefined;
      setProjectSwitchTargetContext(undefined);
      setIsProjectSwitching(false);
    }

    const serverSeedState = initialPlannerStateRef.current;
    if (
      !serverSeededThisLoad &&
      serverSeedState &&
      consumedInitialPlannerStateForRef.current !== currentProjectId &&
      String(serverSeedState.product.projectId ?? "") === currentProjectId
    ) {
      consumedInitialPlannerStateForRef.current = currentProjectId;
      serverSeededThisLoad = true;
      applyLoadedPlannerState(serverSeedState, "cache");
    }

    void readCachedPlannerState(projectId)
      .then((cachedSnapshot) => {
        // Server-seeded data outranks any local cache snapshot — never repaint older data over it.
        if (!mounted || remoteLoaded || !cachedSnapshot || serverSeededThisLoad) {
          return;
        }

        // The remote load below fetches the product's Main scenario. Painting a cached snapshot of
        // a different -- or unknown (older cache records) -- scenario would flash the wrong Gantt
        // until the remote result replaces it, so skip straight to the skeleton in that case.
        const { state: cachedState, scenarioId, mainScenarioId } = cachedSnapshot;
        if (!scenarioId || !mainScenarioId || scenarioId !== mainScenarioId) {
          return;
        }

        applyLoadedPlannerState(cachedState, "cache");
      })
      .catch(() => undefined);

    loadPlannerCoreStateFromSupabase(projectId)
      .then((savedState) => {
        if (!mounted) {
          return;
        }
        remoteLoaded = true;

        if (savedState) {
          applyLoadedPlannerState(savedState, "remote");
          return;
        }

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
        // The remote answered (an empty project); local edits from here start from confirmed state.
        remoteStateConfirmedRef.current = true;
        setHasConfirmedRemoteState(true);
        finishProjectSwitch();
        setHasLoadedRemoteState(true);
        setSaveState("idle");
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }
        remoteLoaded = true;

        // The remote load failed, so the on-screen state (possibly a stale cache) is unconfirmed:
        // remoteStateConfirmedRef stays false, keeping the destructive shell autosave disabled, and
        // the save indicator stays in "error" instead of pretending a cache-only state is saved.
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
    const retryFailedMedia = () => {
      if (document.visibilityState === "hidden") return;
      setTaskDetailHydrationStatus(current => Object.fromEntries(
        Object.entries(current).filter(([, status]) => status !== "error"),
      ));
    };
    window.addEventListener("online", retryFailedMedia);
    window.addEventListener("focus", retryFailedMedia);
    document.addEventListener("visibilitychange", retryFailedMedia);
    return () => {
      window.removeEventListener("online", retryFailedMedia);
      window.removeEventListener("focus", retryFailedMedia);
      document.removeEventListener("visibilitychange", retryFailedMedia);
    };
  }, []);

  // The confirmed Product shell includes procedure steps, parts and tools, but
  // intentionally excludes private media. Hydrate one task at a time only when
  // Procedure needs it, avoiding three all-task media reads and URL signing on
  // every Product entry. Keep the confirmed procedure mounted during this read
  // and merge only private media so a late response cannot replace active edits.
  useEffect(() => {
    if (
      activeModule !== "procedure" ||
      !hasConfirmedRemoteState ||
      !selectedTaskId ||
      taskDetailHydrationStatus[selectedTaskId] === "loaded" ||
      taskDetailHydrationStatus[selectedTaskId] === "error" ||
      taskDetailHydrationRequestsRef.current.has(selectedTaskId)
    ) {
      return;
    }

    const taskId = selectedTaskId;
    const forProjectId = projectId ?? "";
    const forScenarioId = derivedState.scenario.id;
    taskDetailHydrationRequestsRef.current.add(taskId);
    setTaskDetailHydrationStatus((current) => ({ ...current, [taskId]: "loading" }));

    void loadTaskPrivateMediaFromSupabase(taskId, projectId)
      .then((serverTask) => {
        if (!serverTask) {
          throw new Error("This procedure task is no longer available.");
        }
        if (
          loadedProjectIdRef.current !== forProjectId ||
          latestDerivedStateRef.current.scenario.id !== forScenarioId
        ) {
          return;
        }

        setPlannerState((current) => {
          const localTask = current.tasks.find((task) => task.id === taskId);
          if (!localTask) {
            return current;
          }
          const hydratedTask = mergeTaskPrivateMedia(localTask, serverTask);
          const nextState = {
            ...current,
            tasks: current.tasks.map((task) => (task.id === taskId ? hydratedTask : task)),
          };
          void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
          return nextState;
        });
        setTaskDetailHydrationStatus((current) => ({ ...current, [taskId]: "loaded" }));
      })
      .catch((error: unknown) => {
        if (
          loadedProjectIdRef.current !== forProjectId ||
          latestDerivedStateRef.current.scenario.id !== forScenarioId
        ) {
          return;
        }
        setTaskDetailHydrationStatus((current) => ({ ...current, [taskId]: "error" }));
        setWorkspaceNotice({
          title: "Procedure media couldn't be loaded",
          body: error instanceof Error
            ? error.message
            : "Steps remain available, but this task's photos and videos could not be refreshed.",
          tone: "warning",
        });
      })
      .finally(() => {
        taskDetailHydrationRequestsRef.current.delete(taskId);
      });
  }, [activeModule, derivedState.scenario.id, hasConfirmedRemoteState, projectId, selectedTaskId, taskDetailHydrationStatus]);

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
        // A project switch is a context change, so acknowledge it immediately in
        // the canvas even when the target has a warm cache. The cache still makes
        // the transition brief, but the previous project's canvas is never left
        // looking active while the new route commits.
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
    const pendingRemoteTaskIds = pendingRemoteTaskIdsRef.current;

    const unsubscribe = subscribePlannerStateChanges(
      (payload) => {
        const taskId = taskIdFromRealtimePayload(payload);
        if (taskId && canPatchTaskFromRealtimePayload(payload)) {
          requestRemoteTaskRefreshRef.current(taskId);
          return;
        }

        requestRemotePlannerRefreshRef.current();
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
      pendingRemoteTaskIds.clear();
      // FLUSH -- don't drop -- debounced procedure saves for the scope we're leaving; clearing the
      // timers alone would silently discard the user's last keystrokes. Best effort: the queue
      // snapshots were prepared when the save was scheduled, and startProcedureTaskSave no-ops if
      // they are gone. (Scenario switches drain saves beforehand, so this mostly fires on unmount.)
      Object.entries(procedureSaveTimersRef.current).forEach(([taskId, timerId]) => {
        window.clearTimeout(timerId);
        void startProcedureTaskSaveRef.current(taskId);
      });
      procedureSaveTimersRef.current = {};
      Object.values(procedureRetryTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      procedureRetryTimersRef.current = {};
      // NOTE: the project-switch skeleton timer is intentionally NOT cleared here. This cleanup
      // re-runs on every product/scenario change -- exactly when finishProjectSwitch has just armed
      // the timer -- and clearing it wedged the workspace on the switch skeleton forever. It is
      // cleared by a dedicated unmount-only effect below instead.
      unsubscribe();
    };
  }, [derivedState.product.id, derivedState.scenario.id, hasLoadedRemoteState]);

  // Unmount-only cleanup for the project-switch skeleton timer (see note in the effect above).
  useEffect(
    () => () => {
      if (projectSwitchSkeletonTimerRef.current) {
        window.clearTimeout(projectSwitchSkeletonTimerRef.current);
        projectSwitchSkeletonTimerRef.current = null;
      }
    },
    [],
  );

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

  // Undo history capture. dirtyVersion only advances on user-driven edits (markDirty),
  // so remote realtime patches and scenario/project loads never pollute the stack — they
  // just reset the tracking baseline. Undo/redo applications set skipHistoryCaptureRef
  // because they manage the stacks themselves.
  useEffect(() => {
    const tracking = undoTrackingRef.current;
    const scenarioId = plannerState.scenario?.id;

    if (!tracking || tracking.scenarioId !== scenarioId) {
      undoStackRef.current = [];
      redoStackRef.current = [];
    } else if (
      dirtyVersion !== tracking.dirtyVersion &&
      plannerState !== tracking.state &&
      !skipHistoryCaptureRef.current
    ) {
      undoStackRef.current.push(tracking.state);
      if (undoStackRef.current.length > UNDO_HISTORY_LIMIT) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
    }

    skipHistoryCaptureRef.current = false;
    undoTrackingRef.current = { state: plannerState, dirtyVersion, scenarioId };
  }, [plannerState, dirtyVersion]);

  useEffect(() => {
    if (!hasLoadedRemoteState || dirtyVersion === 0) {
      return;
    }

    // A cached snapshot may be editable before the remote load lands, but it must never autosave:
    // the shell save is a destructive diff, and persisting stale state would delete teammates'
    // newer tasks. The remote apply replaces local state wholesale, so nothing is lost by waiting.
    if (!remoteStateConfirmedRef.current) {
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
      void persistPlannerStateRef.current(derivedState);
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

  function dismissWorkspaceNotice(id = 1) {
    if (id === 0) { clearChromeStatusTimer(); setChromeStatus(null); return; }
    setWorkspaceNotice(null);
  }

  function notifyFeedback(message: Omit<FeedbackToast, "id">) {
    if (message.content || message.placement === "center") {
      setWorkspaceNotice(message);
      return;
    }

    clearChromeStatusTimer();
    setChromeStatus(null);
    setWorkspaceNotice({
      ...message,
      autoDismissMs: message.persistent ? undefined : (message.autoDismissMs ?? (message.tone === "danger" || message.tone === "warning" ? 9000 : 5200)),
    });
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
      tone: "neutral",
      autoDismissMs: 4000,
      content: (
        <div className="mt-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs leading-snug text-ink-secondary">{body}</p>
          <button
            type="button"
            onClick={() => {
              dismissWorkspaceNotice();
              onRestore();
            }}
            className="ui-btn-ghost h-7 shrink-0 px-2 text-xs"
          >
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

  // Global shortcuts read the latest handlers through a ref so the window listener can be
  // attached once without re-binding on every render (and without stale closures).
  const keyboardActionsRef = useRef({
    undo: () => {},
    redo: () => {},
    togglePalette: () => {},
    goToModule: (_index: number) => {},
  });
  keyboardActionsRef.current = {
    undo: undoPlannerChange,
    redo: redoPlannerChange,
    togglePalette: () => setCommandPaletteOpen((open) => !open),
    goToModule: (index: number) => {
      const targetModule = quickSwitchModules[index];
      if (targetModule) {
        navigateModule(targetModule.id);
      }
    },
  };

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      if (target.isContentEditable) {
        return true;
      }
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      const actions = keyboardActionsRef.current;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        actions.togglePalette();
        return;
      }

      // Text fields keep their native undo; the planner stack only handles the canvas.
      if (meta && !event.altKey && event.key.toLowerCase() === "z" && !isEditableTarget(event.target)) {
        event.preventDefault();
        if (event.shiftKey) {
          actions.redo();
        } else {
          actions.undo();
        }
        return;
      }

      if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "y" && !isEditableTarget(event.target)) {
        event.preventDefault();
        actions.redo();
        return;
      }

      // event.code sidesteps Alt producing special characters in event.key on macOS.
      if (event.altKey && !meta && event.code.startsWith("Digit") && !isEditableTarget(event.target)) {
        const digit = Number(event.code.slice(5));
        if (digit >= 1 && digit <= quickSwitchModules.length) {
          event.preventDefault();
          actions.goToModule(digit - 1);
        }
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!commandPaletteOpen) {
      return;
    }
    void loadWorkspaceProjectGroups()
      .then((groups) =>
        setPaletteProjects(
          groups.flatMap((group) =>
            group.projects
              .filter((candidate) => candidate.status !== "archived")
              .map((candidate) => ({ project: candidate, workspaceName: group.workspace.name })),
          ),
        ),
      )
      .catch(() => undefined);
    void listSopSummariesFromSupabase()
      .then(setPaletteSops)
      .catch(() => undefined);
  }, [commandPaletteOpen]);

  const commandPaletteGroups = useMemo<CommandPaletteGroup[]>(() => {
    if (!commandPaletteOpen) {
      return [];
    }

    const taskModuleIds = new Set(["gantt", "procedure", "work-instructions"]);
    const ensureTaskModule = () => {
      if (blockMasterBomNavigation()) {
        return false;
      }
      if (!taskModuleIds.has(activeModule)) {
        setActiveModule("gantt");
      }
      return true;
    };

    return [
      {
        label: "Navigate",
        items: [
          ...quickSwitchModules.map((module, index) => ({
            id: `module:${module.id}`,
            label: module.label,
            hint: `Alt+${index + 1}`,
            keywords: "module view open",
            action: () => navigateModule(module.id),
          })),
          {
            id: "settings:account",
            label: "Settings",
            hint: "Account",
            keywords: "account profile password theme",
            action: () => {
              if (!blockMasterBomNavigation()) {
                router.push("/settings");
              }
            },
          },
          {
            id: "settings:organization",
            label: "Members & access",
            hint: "Settings",
            keywords: "invite user role organization access members",
            action: () => {
              if (!blockMasterBomNavigation()) {
                router.push("/settings?section=organization");
              }
            },
          },
        ],
      },
      {
        label: "Scenarios",
        items: scenarios
          .filter((scenario) => scenario.id !== derivedState.scenario.id)
          .map((scenario) => ({
            id: `scenario:${scenario.id}`,
            label: scenario.name,
            hint: "Switch scenario",
            action: () => void switchScenario(scenario.id),
          })),
      },
      {
        label: "Tasks",
        items: derivedState.tasks.map((task) => ({
          id: `task:${task.id}`,
          label: task.name,
          hint: task.wbs,
          keywords: "task",
          action: () => {
            if (ensureTaskModule()) {
              openTaskDetail(task.id);
            }
          },
        })),
      },
      {
        label: "Stations",
        items: derivedState.stations.map((station) => ({
          id: `station:${station.id}`,
          label: station.name,
          hint: "Station",
          action: () => {
            if (ensureTaskModule()) {
              selectStation(station.id);
            }
          },
        })),
      },
      {
        label: "Steps",
        searchOnly: true,
        items: derivedState.tasks.flatMap((task) =>
          (task.manufacturingSteps ?? []).map((step) => ({
            id: `step:${task.id}:${step.id}`,
            label: step.name || step.instruction.slice(0, 80) || `Step ${step.sequence}`,
            hint: task.name,
            keywords: `step ${step.instruction.slice(0, 200)}`,
            action: () => openProcedureStepName(task.id, step.id),
          })),
        ),
      },
      {
        label: "Parts",
        searchOnly: true,
        items: derivedState.tasks.flatMap((task) =>
          (task.partReferences ?? []).map((part) => ({
            id: `part:${task.id}:${part.id}`,
            label: part.partNumber,
            hint: task.name,
            keywords: `part ${part.description ?? ""}`,
            action: () => {
              if (ensureTaskModule()) {
                openTaskDetail(task.id);
              }
            },
          })),
        ),
      },
      {
        label: "Projects",
        items: paletteProjects
          .filter((entry) => entry.project.id !== projectId)
          .map((entry) => ({
            id: `project:${entry.project.id}`,
            label: entry.project.name,
            hint: entry.workspaceName,
            keywords: "project workspace open switch",
            action: () => {
              if (blockMasterBomNavigation()) {
                return;
              }
              announceProjectSwitch(entry.project);
              router.push(projectPlannerHref(entry.project.id));
            },
          })),
      },
      {
        label: "SOPs",
        items: paletteSops.map((sop) => ({
          id: `sop:${sop.id}`,
          label: sop.title || sop.sopNumber || sop.id,
          hint: sop.sopNumber && sop.title ? sop.sopNumber : "SOP",
          keywords: "sop standard operating procedure document",
          action: () => {
            if (!blockMasterBomNavigation()) {
              router.push(`/sops/${sop.id}`);
            }
          },
        })),
      },
      {
        label: "Actions",
        items: [
          {
            id: "action:bulk-edit",
            label: "Bulk edit tasks…",
            hint: "Move / delete",
            keywords: "bulk multi select move zone delete tasks",
            action: () => setBulkEditorOpen(true),
          },
          {
            id: "action:undo",
            label: "Undo last change",
            hint: "⌘Z",
            action: () => undoPlannerChange(),
          },
          {
            id: "action:redo",
            label: "Redo change",
            hint: "⇧⌘Z",
            action: () => redoPlannerChange(),
          },
        ],
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commandPaletteOpen,
    activeModule,
    scenarios,
    derivedState.scenario.id,
    derivedState.tasks,
    derivedState.stations,
    paletteProjects,
    paletteSops,
    projectId,
  ]);

  const isProcedureModule = activeModule === "procedure";
  const isDashboardModule = activeModule === "dashboard";
  const isSettingsModule = activeModule === "settings";
  const requiresCompletePlannerState = !isDashboardModule && !isSettingsModule;
  const sidebarActiveModule = isProjectSwitching ? "dashboard" : activeModule;
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
  const selectedProcedureTaskHydrationStatus = selectedTask
    ? taskDetailHydrationStatus[selectedTask.id]
    : "loaded";
  const isSelectedProcedureTaskHydrating =
    isProcedureModule &&
    Boolean(selectedTask) &&
    selectedProcedureTaskHydrationStatus !== "loaded" &&
    selectedProcedureTaskHydrationStatus !== "error";
  const selectedStation = selectedTask
    ? buildProcessStationForTask(selectedTask, derivedState.tasks, kpis.bottleneckStation?.id)
    : undefined;
  const workspaceGridClass = "ui-workspace-shell";
  const workspaceGridStyle = {
    "--workspace-sidebar-width": sidebarCollapsed ? "0px" : "var(--shell-sidebar)",
    "--detail-drawer-width": detailDrawerCollapsed ? "44px" : `${detailDrawerWidth}px`,
  } as CSSProperties;
  const hasDisplayablePlannerState = Boolean(
    projectId && String(plannerState.product.projectId ?? "") === String(projectId),
  );

  if (urlWorkspaceSnapshot.activeModule === "settings" && (!hasLoadedRemoteState || isProjectSwitching)) {
    return <SettingsLoadingState />;
  }

  if (!hasLoadedRemoteState && !hasDisplayablePlannerState) {
    if (!isProjectSwitching) {
      return <ProductLoadingState />;
    }

    return (
      <div
        className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
        style={workspaceGridStyle}
      >
        <TopNav
          context={displayedPlannerChromeContext}
        />
        <div className={`relative ${workspaceGridClass}`}>
          <SidebarReopenButton
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((value) => !value)}
          />
          <div className={`ui-workspace-sidebar-slot ${sidebarCollapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
            <Sidebar
              activeModule="dashboard"
              settingsSection={settingsSection}
              setupSection={setupSection}
              onChange={() => undefined}
              onSetupSectionChange={() => undefined}
              onOpenSettings={() => undefined}
              onCollapse={() => setSidebarCollapsed(true)}
              project={activeProjectContext}
            />
          </div>
          <PlannerWorkspaceSkeleton />
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

  // True (and shows a one-time notice) when the signed-in user only has view access to
  // this project — callers should skip the write entirely.
  function blockViewOnlyWrite(): boolean {
    if (!isViewOnlyAccessRef.current) {
      return false;
    }
    if (!viewOnlyNoticeShownRef.current) {
      viewOnlyNoticeShownRef.current = true;
      notifyFeedback({
        title: "View-only access",
        body: "You can browse this project, but changes are not saved. Ask an organization admin for edit access.",
        tone: "warning",
      });
    }
    return true;
  }

  function undoPlannerChange() {
    if (blockViewOnlyWrite()) {
      return;
    }
    const previous = undoStackRef.current.pop();
    if (!previous) {
      notifyFeedback({ title: "Nothing to undo", tone: "neutral" });
      return;
    }
    redoStackRef.current.push(undoTrackingRef.current?.state ?? plannerState);
    skipHistoryCaptureRef.current = true;
    setPlannerState(previous);
    markDirty();
    notifyFeedback({ title: "Undid last change", tone: "neutral" });
  }

  function redoPlannerChange() {
    if (blockViewOnlyWrite()) {
      return;
    }
    const next = redoStackRef.current.pop();
    if (!next) {
      notifyFeedback({ title: "Nothing to redo", tone: "neutral" });
      return;
    }
    undoStackRef.current.push(undoTrackingRef.current?.state ?? plannerState);
    skipHistoryCaptureRef.current = true;
    setPlannerState(next);
    markDirty();
    notifyFeedback({ title: "Redid change", tone: "neutral" });
  }

  async function persistPlannerState(stateToSave: PlannerState) {
    if (blockViewOnlyWrite()) {
      plannerDirtyRef.current = false;
      setSaveState("idle");
      return;
    }

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

    if (masterBomSaveInFlightRef.current || saveInFlightRef.current) {
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
      void writeCachedPlannerState(projectId, lastPersistedState, mainScenarioIdRef.current).catch(() => undefined);
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

    if (blockViewOnlyWrite()) {
      queue.pending = false;
      queue.pendingTaskSnapshot = undefined;
      queue.pendingTasksSnapshot = undefined;
      queue.pendingDraftSnapshot = undefined;
      setSaveState("idle");
      return;
    }

    const saveId = generateProcedureSaveId();
    const draftSnapshot = queue.pendingDraftSnapshot ?? cloneProcedureDrafts();
    const saveSeq = maxProcedureDraftSeq(taskId, draftSnapshot);
    const taskSnapshot = applyProcedureDraftsToTask(queue.pendingTaskSnapshot, draftSnapshot);
    const tasksSnapshot = queue.pendingTasksSnapshot.map((task) => (task.id === taskId ? taskSnapshot : task));

    const annotationOnly = queue.annotationOnly;
    const annotationBase = queue.annotationBase;
    queue.annotationOnly = undefined;
    queue.annotationBase = undefined;
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
      savedTask = annotationOnly
        ? await saveTaskPhotoAnnotationsToSupabase(taskSnapshot, annotationBase ?? {}, projectId)
        : await saveProcedureTaskUpdateToSupabase(taskSnapshot, tasksSnapshot, projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save procedure task.";
      const isConflict = message.toLowerCase().includes("conflict");
      queue.inFlight = false;
      if (!queue.pending) {
        queue.pending = true;
        queue.pendingTaskSnapshot = taskSnapshot;
        queue.pendingTasksSnapshot = tasksSnapshot;
        queue.pendingDraftSnapshot = draftSnapshot;
        queue.annotationOnly = annotationOnly;
        queue.annotationBase = annotationBase;
      }
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
          scheduleProcedureTaskSave(latestTaskSnapshot, latestTasksSnapshot, annotationOnly ? annotationBase : undefined);
        }, 2500);
      }
      return;
    }

    queue.inFlight = false;
    queue.inFlightSaveId = undefined;
    queue.inFlightSeq = undefined;

    let confirmedCurrent = true;
    if (savedTask) {
      acknowledgeAnnotationDrafts(taskId, getTaskStepPhotoAnnotationMap(savedTask));
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
        void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
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

  function scheduleProcedureTaskSave(taskToSave: Task, tasksToSave: Task[], annotationBase?: ReturnType<typeof getTaskStepPhotoAnnotationMap>) {
    const taskId = taskToSave.id;
    const queue = getProcedureTaskSaveQueue(taskId);
    const taskSnapshot = applyProcedureDraftsToTask(taskToSave);
    const onlyAnnotations = annotationBase !== undefined;
    queue.annotationOnly = queue.pending ? Boolean(queue.annotationOnly && onlyAnnotations) : onlyAnnotations;
    if (onlyAnnotations) queue.annotationBase = queue.annotationBase ?? annotationBase;

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
    const component = derivedState.components.find((candidate) => candidate.id === componentId);
    requestFeedbackConfirm({
      title: `Delete ${component?.name || component?.code || "component"}?`,
      body: "This removes the component code and clears it from any tasks that use it.",
      tone: "danger",
      confirmLabel: "Delete",
      onConfirm: () => executeDeleteComponentCode(componentId),
    });
  }

  function executeDeleteComponentCode(componentId: string) {
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
    const documentType = derivedState.documentTypes.find((candidate) => candidate.id === documentTypeId);
    requestFeedbackConfirm({
      title: `Delete ${documentType?.name || documentType?.code || "document type"}?`,
      body: "This removes the document type code from this product's setup.",
      tone: "danger",
      confirmLabel: "Delete",
      onConfirm: () => executeDeleteDocumentTypeCode(documentTypeId),
    });
  }

  function executeDeleteDocumentTypeCode(documentTypeId: string) {
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

  function updateProductPfmeaDocument(document: PfmeaDocument) {
    if (blockViewOnlyWrite()) {
      return;
    }
    markDirty();
    setPlannerState((current) => ({
      ...current,
      product: {
        ...current.product,
        customFields: {
          ...(current.product.customFields ?? {}),
          [PRODUCT_PFMEA_DOCUMENT_FIELD]: serializePfmeaDocument(document),
        },
      },
    }));
  }

  async function updateMasterBom(bom: MasterBom | undefined): Promise<void> {
    if (blockViewOnlyWrite()) {
      throw new Error("You have view-only access to this project.");
    }
    if (!remoteStateConfirmedRef.current) {
      throw new Error("The latest database state is still loading. Wait a moment, then retry the BOM upload.");
    }
    if (!projectId) {
      throw new Error("Select a project before updating the master BOM.");
    }

    flushPendingPlannerSave();
    if (hasLocalSaveWork() && !(await waitForLocalSavesToSettle())) {
      throw new Error("Other changes could not be saved. Resolve the save error before updating the BOM.");
    }

    masterBomSaveInFlightRef.current = true;
    setSaveError(undefined);
    saveStateRef.current = "saving";
    setSaveState("saving");

    let verifiedProduct: Product | undefined;
    try {
      verifiedProduct = await saveMasterBomToSupabase(latestDerivedStateRef.current.product, bom, projectId);
      const verifiedBom = getMasterBom(verifiedProduct.customFields);
      const mergeVerifiedBom = (localProduct: Product): Product => {
        const customFields = { ...(localProduct.customFields ?? {}) };
        if (verifiedBom) {
          customFields[PRODUCT_MASTER_BOM_FIELD] = serializeMasterBom(verifiedBom);
        } else {
          delete customFields[PRODUCT_MASTER_BOM_FIELD];
        }
        return { ...localProduct, customFields, updatedAt: verifiedProduct?.updatedAt ?? localProduct.updatedAt };
      };

      const confirmedState = {
        ...latestDerivedStateRef.current,
        product: mergeVerifiedBom(latestDerivedStateRef.current.product),
      };
      latestDerivedStateRef.current = confirmedState;
      setPlannerState((current) => ({ ...current, product: mergeVerifiedBom(current.product) }));
      scenarioCacheRef.current.set(confirmedState.scenario.id, confirmedState);
      void writeCachedPlannerState(projectId, confirmedState, mainScenarioIdRef.current).catch(() => undefined);
      saveStateRef.current = "saved";
      setSaveState("saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The master BOM could not be saved.";
      setSaveError(message);
      saveStateRef.current = "error";
      setSaveState("error");
      notifyFeedback({ title: "BOM save failed", body: message, tone: "danger" });
      throw error;
    } finally {
      masterBomSaveInFlightRef.current = false;
      const queuedState = queuedSaveStateRef.current;
      queuedSaveStateRef.current = null;
      if (queuedState) {
        let nextQueuedState = queuedState;
        if (verifiedProduct) {
          const confirmedBom = getMasterBom(verifiedProduct.customFields);
          const customFields = { ...(queuedState.product.customFields ?? {}) };
          if (confirmedBom) {
            customFields[PRODUCT_MASTER_BOM_FIELD] = serializeMasterBom(confirmedBom);
          } else {
            delete customFields[PRODUCT_MASTER_BOM_FIELD];
          }
          nextQueuedState = {
            ...queuedState,
            product: { ...queuedState.product, customFields, updatedAt: verifiedProduct.updatedAt },
          };
        }
        void persistPlannerState(nextQueuedState);
      } else {
        flushDeferredRemoteRefresh();
      }
    }
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
    const currentTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
    const annotationCustomFields = patch.customFields;
    const photoAnnotationsChanged = Boolean(
      annotationCustomFields &&
        currentTask &&
        JSON.stringify(getTaskStepPhotoAnnotationMap(currentTask)) !==
          JSON.stringify(getTaskStepPhotoAnnotationMap({ customFields: annotationCustomFields })),
    );

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

      if (taskToSave && (!isNormalizedAssetPatch || photoAnnotationsChanged)) {
        const base = photoAnnotationsChanged && isNormalizedAssetPatch && currentTask
          ? getTaskStepPhotoAnnotationMap(currentTask) : undefined;
        if (base) {
          const nextMap = getTaskStepPhotoAnnotationMap(taskToSave);
          for (const photoId of new Set([...Object.keys(base), ...Object.keys(nextMap)])) {
            const draft = readAnnotationDraft(taskId, photoId);
            if (draft) base[photoId] = draft.base;
          }
        }
        scheduleProcedureTaskSave(taskToSave, scheduledTasks, base);
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
        void writeCachedPlannerState(projectId, { ...previousState, tasks: scheduledTasks }, mainScenarioIdRef.current).catch(
          () => undefined,
        );
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
    // This path runs the destructive shell diff-save directly; refuse it until the remote load has
    // confirmed the state being edited (a cached snapshot could delete teammates' newer tasks).
    if (!remoteStateConfirmedRef.current) {
      const message = "The latest database state hasn't finished loading yet. Try again in a moment.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Save blocked", body: message, tone: "warning" });
      return;
    }

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

  /**
   * Place a clipboard photo onto a step, in this or any other task in the project.
   *
   * Order matters: the destination write must land before the source is touched, or a
   * failed paste loses the photo. When source and destination are the SAME task, both
   * edits must be folded into one task object and saved once — two sequential saves of
   * the same task would clobber each other.
   */
  async function pasteStepPhoto(entry: StepPhotoClipboardEntry, target: StepPhotoTarget) {
    const state = latestDerivedStateRef.current;
    const targetTask = state.tasks.find((task) => task.id === target.taskId);
    const targetStep = targetTask?.manufacturingSteps?.find((step) => step.id === target.stepId);
    if (!targetTask || !targetStep) {
      throw new Error("The destination step is no longer available.");
    }

    const isCut = entry.mode === "cut";
    const sameTask = entry.sourceTaskId === target.taskId;
    const pastedPhoto = duplicateStepPhotoAttachment(entry.photo);

    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");
    setPlannerState((current) => ({
      ...current,
      tasks: applyPastedPhoto(current.tasks, entry, target.taskId, target.stepId, pastedPhoto),
    }));

    let metadataSaved = false;
    let destinationSaved = false;
    try {
      // A photo still held only as a data: URL has never been uploaded, so there is no
      // object to copy — upload it the normal way instead.
      const persistedPhoto = entry.photo.storagePath
        ? await copyStepPhotoAttachmentToStep(
            target.taskId,
            target.stepId,
            pastedPhoto,
            entry.photo.storagePath,
            entry.photo.thumbnailStoragePath,
            activeProjectContext,
          )
        : await uploadStepPhotoAttachment(target.taskId, target.stepId, pastedPhoto, activeProjectContext);
      metadataSaved = true;

      const freshTargetTask = latestDerivedStateRef.current.tasks.find((task) => task.id === target.taskId);
      if (!freshTargetTask) {
        throw new Error("The destination task is no longer available.");
      }
      let nextTargetTask = upsertStepPhotoAttachments(freshTargetTask, target.stepId, [persistedPhoto]);
      if (isCut && sameTask) {
        nextTargetTask = removeStepPhotoAttachment(nextTargetTask, entry.sourceStepId, entry.photo.id);
      }
      await saveTaskCustomFieldsToSupabase(target.taskId, nextTargetTask.customFields, projectId);
      destinationSaved = true;

      if (isCut && !sameTask) {
        const freshSourceTask = latestDerivedStateRef.current.tasks.find(
          (task) => task.id === entry.sourceTaskId,
        );
        if (!freshSourceTask) {
          throw new Error("The source task is no longer available.");
        }
        const nextSourceTask = removeStepPhotoAttachment(
          freshSourceTask,
          entry.sourceStepId,
          entry.photo.id,
        );
        await saveTaskCustomFieldsToSupabase(entry.sourceTaskId, nextSourceTask.customFields, projectId);
      }

      if (isCut) {
        await softDeleteStepPhotoAttachmentFromSupabase(entry.photo.id, entry.sourceTaskId, projectId);
      }

      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === target.taskId
            ? upsertStepPhotoAttachments(task, target.stepId, [persistedPhoto])
            : task,
        ),
      }));
      setSaveState("saved");
      notifyFeedback({
        title: isCut ? "Photo moved" : "Photo placed",
        body: `${isCut ? "Moved" : "Placed"} on Step ${targetStep.sequence}${
          targetStep.name?.trim() ? ` — ${targetStep.name.trim()}` : ""
        }.`,
        tone: "success",
      });
    } catch (error) {
      // revertedTasks (below, from latestDerivedStateRef.current) and the UI revert in the
      // setPlannerState call right after (from the updater's own `current`) are two separate
      // reads, not one shared snapshot -- they merely agree in practice, since
      // latestDerivedStateRef.current is kept in sync with the state the updater sees. The
      // compensating saves below are what actually needs a snapshot: they run after
      // setPlannerState resolves, so they read revertedTasks rather than re-deriving it, to
      // stay consistent with what was just written back to Supabase.
      const revertedTasks = revertPastedPhoto(
        latestDerivedStateRef.current.tasks,
        entry,
        target.taskId,
        target.stepId,
        pastedPhoto.id,
      );

      setPlannerState((current) => ({
        ...current,
        tasks: revertPastedPhoto(current.tasks, entry, target.taskId, target.stepId, pastedPhoto.id),
      }));

      if (metadataSaved) {
        await softDeleteStepPhotoAttachmentFromSupabase(pastedPhoto.id, target.taskId, projectId).catch(
          () => undefined,
        );
      }

      // The destination write (and, for a cross-task cut, the source write) may have already
      // committed before something later in the flow threw. Re-save the reverted customFields
      // for whichever tasks were touched so Supabase matches what the user now sees — best
      // effort, so a failure here cannot mask the error we're about to propagate.
      if (destinationSaved) {
        const compensatingSaves: Promise<unknown>[] = [];

        const revertedTarget = revertedTasks.find((task) => task.id === target.taskId);
        if (revertedTarget) {
          compensatingSaves.push(
            saveTaskCustomFieldsToSupabase(target.taskId, revertedTarget.customFields, projectId).catch(
              () => undefined,
            ),
          );
        }

        if (isCut && !sameTask) {
          const revertedSource = revertedTasks.find((task) => task.id === entry.sourceTaskId);
          if (revertedSource) {
            compensatingSaves.push(
              saveTaskCustomFieldsToSupabase(entry.sourceTaskId, revertedSource.customFields, projectId).catch(
                () => undefined,
              ),
            );
          }
        }

        await Promise.all(compensatingSaves);
      }

      const message = error instanceof Error ? error.message : "Unable to paste this photo.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Photo paste failed", body: message, tone: "danger" });
      throw error;
    } finally {
      saveInFlightRef.current = false;
      flushDeferredRemoteRefresh();
    }
  }

  async function deleteTaskVideo(taskId: string, video: TaskVideo) {
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? removeTaskVideo(task, video.id) : task)),
    }));
    try {
      await softDeleteTaskVideoFromSupabase(video.id, taskId, projectId);
      void removeTaskVideoObject(video);
    } catch (error) {
      notifyFeedback({
        title: "Couldn't delete build animation",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "danger",
      });
    }
  }

  async function deleteExplodedView(taskId: string, view: ExplodedView) {
    // Exploded views live in customFields (not persisted on task save), so the soft-delete on the
    // step_exploded_views row is the source of truth; update local state immediately for responsiveness.
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? removeTaskExplodedView(task, view.id) : task)),
    }));
    try {
      await softDeleteExplodedViewFromSupabase(view.id, taskId, projectId);
      void removeExplodedViewObject(view);
    } catch (error) {
      notifyFeedback({
        title: "Couldn't delete exploded view",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "danger",
      });
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
          body: "Removed from this manufacturing step.",
          restoreLabel: "Restore",
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
                const message = error instanceof Error ? error.message : "Unable to restore the selected photo.";
                setSaveError(message);
                setSaveState("error");
                notifyFeedback({ title: "Restore failed", body: message, tone: "danger" });
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

      const message = error instanceof Error ? error.message : "Unable to remove the selected photo.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Delete failed", body: message, tone: "danger" });
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

  // "Optimize line": deterministically schedule dependent work as early as possible (shortest lead
  // time) and balance the crew with the fewest operators, leveling only within free float so the
  // finish never slips. The proposal is written into a fresh duplicated scenario (sandbox) so the
  // source plan is never touched. Replaces the old in-place IE headcount allocation on this button;
  // _smartAllocateHeadcount is kept dormant for the later LLM-strategist phase.
  async function optimizeLineIntoScenario() {
    if (smartAllocationPending || isSwitchingScenario) {
      return;
    }
    const ok = await ensureSavedBeforeScenarioAction(
      "Can't optimize yet",
      "Your changes couldn't be saved, so the line wasn't optimized. Resolve the save error and try again.",
    );
    if (!ok) {
      return;
    }

    setSmartAllocationPending(true);
    setIsSwitchingScenario(true);
    setSaveState("loading");
    try {
      const sourceLabel = isMainScenario ? "Main Plan" : derivedState.scenario.name || "Scenario";
      const newId = await duplicateScenario(derivedState.scenario.id, `⚡ Optimized (${sourceLabel})`);
      const loaded = await loadPlannerStateFromSupabase(projectId, newId);
      if (!loaded) {
        throw new Error("The optimized scenario could not be loaded after duplication.");
      }

      const operatorCapacityMinutes = calculateAvailabilityMinutesForDemandPeriod(loaded.product);
      const { tasks: optimizedTasks, metrics } = runLineOptimization(loaded.tasks, {
        availableOperatorIds: availableOperatorLetters,
        demandQuantity: loaded.product.demandQuantity,
        operatorCapacityMinutes,
      });

      const planningContext = normalizeTaskPlanningContext(
        optimizedTasks,
        loaded.zones,
        loaded.stations,
        loaded.scenario.id,
      );
      const calculated = applyCalculatedFields(
        loaded.product,
        planningContext.stations,
        planningContext.tasks.map(syncTaskOperatorCount),
      );
      const optimizedState = {
        ...loaded,
        product: calculated.product,
        stations: calculated.stations,
        tasks: calculated.tasks,
      };

      await savePlannerStateToSupabase(optimizedState);
      scenarioCacheRef.current.set(newId, optimizedState);
      await refreshScenarioList();
      await loadScenarioIntoView(newId);
      setSaveState("saved");

      const summaryBits = [
        `${metrics.operatorsUsed} operator${metrics.operatorsUsed === 1 ? "" : "s"}`,
        `${formatMinutes(metrics.idleMinutes)} idle`,
        `lead time ${formatMinutes(metrics.leadTimeMinutes)}`,
        metrics.unassignedTaskCount > 0 ? `${metrics.unassignedTaskCount} unassigned (review)` : "",
      ].filter(Boolean).join(" · ");
      notifyFeedback({
        title: "Line optimized into a new scenario",
        body: `Balanced the line for the best mix of lead time and idle — ${summaryBits}. Your source plan is unchanged.`,
        tone: metrics.unassignedTaskCount > 0 ? "warning" : "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to optimize the line.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Optimize failed", body: message, tone: "danger" });
    } finally {
      setSmartAllocationPending(false);
      setIsSwitchingScenario(false);
    }
  }

  async function _smartAllocateHeadcount() {
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
                  <div className="mt-0.5 text-xs font-bold text-ink-secondary">
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
                      <div className="font-medium text-ink-secondary">{review.condition}</div>
                      <div className="mt-1 font-semibold leading-snug text-ink-secondary">{review.impact}</div>
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
              <div className="mt-0.5 text-xs font-bold text-ink-secondary">
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
                <div className="mt-0.5 text-xs font-bold text-ink-secondary">
                  {round(audit.assignmentCoveragePercent, 0)}% coverage · peak {audit.peakManpower} · spread {formatMinutes(audit.loadSpreadMinutes)}
                </div>
              </div>
              <div className="ui-mono-label">
                {audit.assignedTaskCount}/{audit.eligibleTaskCount} eligible task(s)
              </div>
            </div>

            <div className="p-2">
              <div className="overflow-hidden rounded border border-line">
                <div className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-surface-sunken px-2 py-1.5 text-[9px] ui-mono-label tracking-wide text-ink-secondary">
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
                        ? "text-ink-secondary"
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
                        <span className="ml-1 font-bold text-ink-secondary">· {round(operator.utilizationPercent, 0)}%</span>
                      </div>
                      <div className="truncate font-bold text-ink-secondary">
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

            <div className="border-t border-line px-3 py-2 text-[11px] font-semibold leading-snug text-ink-secondary">
              {audit.strategyNotes[audit.strategyNotes.length - 1]}
            </div>
          </div>

          {issueEntries.length ? (
            <div className="ui-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <div className="ui-mono-label">Needs Review</div>
                <div className="text-[10px] font-medium text-ink-secondary">{issueEntries.length} item(s)</div>
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
                  <div className="bg-surface px-3 py-2 text-xs font-bold text-ink-secondary">
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

  function _updateStationOperators(stationId: string, operators: number) {
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

    if (blockViewOnlyWrite()) {
      return;
    }

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
        await writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current);
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
    if (blockMasterBomNavigation()) {
      return;
    }
    selectTask(taskId);
    setFocusedProcedureStepId(stepId);
    pushWorkspaceModuleHistory("procedure");
  }

  function selectStation(stationId: string) {
    setSelectedStationId(stationId);
    const firstStationTask = derivedState.tasks.find((task) => task.stationId === stationId);
    if (firstStationTask) {
      setSelectedTaskId(firstStationTask.id);
    }
  }

  function blockMasterBomNavigation(): boolean {
    if (!masterBomSaveInFlightRef.current) {
      return false;
    }
    notifyFeedback({
      title: "BOM is still saving",
      body: "Wait for Saved before leaving this page.",
      tone: "warning",
    });
    return true;
  }

  function pushWorkspaceModuleHistory(moduleId: string) {
    if (moduleId === activeModule) {
      return;
    }
    const nextUrl = buildWorkspaceUrl(pathname, window.location.search, {
      activeModule: moduleId,
      selectedTaskId,
      selectedStationId,
      activeZoneId,
    });
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState(null, "", nextUrl);
    }
    setActiveModule(moduleId);
  }

  function navigateModule(moduleId: string) {
    if (blockMasterBomNavigation()) {
      return;
    }
    pushWorkspaceModuleHistory(moduleId);
  }

  function navigateSetupSection(section: SetupSection) {
    if (section !== setupSection && blockMasterBomNavigation()) {
      return;
    }
    setSetupSection(section);
  }

  function openSettings(section: SettingsSection = "account") {
    if (blockMasterBomNavigation()) {
      return;
    }
    setSettingsSection(section);
    pushWorkspaceModuleHistory("settings");
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
    <StepPhotoClipboardProvider onPaste={pasteStepPhoto} onNotify={notifyFeedback} resetKey={projectId}>
      <div
        className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
        style={workspaceGridStyle}
      >
        <TopNav
          context={displayedPlannerChromeContext}
          presence={presencePeers}
        />

        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          groups={commandPaletteGroups}
        />

        <BulkTaskEditor
          open={bulkEditorOpen}
          onClose={() => setBulkEditorOpen(false)}
          tasks={derivedState.tasks}
          zones={derivedState.zones}
          taskCode={taskDisplayCode}
          onMoveToZone={moveTasksToZone}
          onDelete={deleteTasks}
        />

        {isViewOnlyAccess ? (
          <section className="ui-workspace-notice">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <NothingStatus>View-only access</NothingStatus>
                <p className="ui-workspace-notice-body">
                  You can browse this project, but you can&apos;t make changes. Ask an organization owner or admin
                  for edit access.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <div className={`relative ${workspaceGridClass}`}>
          <SidebarReopenButton
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((value) => !value)}
          />
          <div className={`ui-workspace-sidebar-slot ${sidebarCollapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
            <Sidebar
              activeModule={sidebarActiveModule}
              settingsSection={settingsSection}
              setupSection={setupSection}
              onChange={navigateModule}
              onSetupSectionChange={navigateSetupSection}
              onOpenSettings={openSettings}
              onCollapse={() => setSidebarCollapsed(true)}
              project={activeProjectContext}
            />
          </div>

          {isProjectSwitching ||
          (requiresCompletePlannerState && !hasConfirmedRemoteState) ? (
            <PlannerWorkspaceSkeleton />
          ) : isProcedureModule ? (
            <ProcedureWorkspace
              project={activeProjectContext}
              product={derivedState.product}
              tasks={derivedState.tasks}
              zones={derivedState.zones}
              selectedTask={selectedTask}
              isTaskHydrating={isSelectedProcedureTaskHydrating}
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
              onDeleteExplodedView={deleteExplodedView}
              onDeleteTaskVideo={deleteTaskVideo}
              onAddStepTool={persistAddStepTool}
              onRemoveStepTool={persistRemoveStepTool}
              toolLibrary={toolLibrary}
              projectToolRegistry={projectToolRegistry}
            />
          ) : isSettingsModule ? (
            <main className="min-h-0 min-w-0 overflow-hidden">
              <AppSettingsPanel
                showSubnav={false}
                section={settingsSection}
                onSectionChange={setSettingsSection}
                project={activeProjectContext}
                sections={embeddedSettingsSections}
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
                          onTidyToolNames={tidyCatalogToolNames}
                          onConfirmAction={requestFeedbackConfirm}
                        />
                      ) : null}
                      {setupSection === "procedure-checks" ? (
                        <ProcedureChecksSetupPanel
                          product={derivedState.product}
                          onProductStepChecks={updateProductStepChecks}
                          onConfirmAction={requestFeedbackConfirm}
                        />
                      ) : null}
                    </div>
                  ) : activeModule === "pfmea" ? (
                    <PfmeaWorkspace
                      product={derivedState.product}
                      scenario={derivedState.scenario}
                      tasks={derivedState.tasks}
                      zones={derivedState.zones}
                      readOnly={isViewOnlyAccess || !hasConfirmedRemoteState}
                      saveState={saveState}
                      saveError={saveError}
                      onDocumentChange={updateProductPfmeaDocument}
                      onOpenTask={(taskId) => {
                        selectTask(taskId);
                        pushWorkspaceModuleHistory("procedure");
                      }}
                    />
                  ) : activeModule === "checklist" ? (
                    <ChecklistWorkspace />
                  ) : activeModule === "work-instructions" ? (
                    <WorkInstructionsPanel
                      tasks={derivedState.tasks}
                      zones={derivedState.zones}
                      product={derivedState.product}
                      initialPlannerState={derivedState}
                      hydratedTaskIds={hydratedTaskIds}
                      onOpenTask={(taskId) => {
                        selectTask(taskId);
                        pushWorkspaceModuleHistory("procedure");
                      }}
                    />
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
                        <button type="button" onClick={exportGanttDocument} className="ui-btn-ghost h-9 gap-2">
                          <Download size={16} />
                          Export Setup
                        </button>
                        <button type="button" onClick={addZone} className="ui-btn-ghost h-9 gap-2">
                          <Plus size={16} />
                          Zone
                        </button>
                        <button type="button" onClick={addTaskAtBottom} className="ui-btn-ghost h-9 gap-2">
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
                          className="ui-btn-ghost h-9 gap-2"
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
                      onSmartAllocate={() => void optimizeLineIntoScenario()}
                      onResetHeadcount={resetTaskHeadcount}
                      onSetTaskDependencies={setTaskDependencies}
                      onLinkTaskStartToFinish={linkTaskStartToFinish}
                      onDeleteTasks={deleteTasks}
                    />
                    <OperatorUtilizationPanel
                      tasks={derivedState.tasks}
                      availableOperatorIds={availableOperatorLetters}
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
              onDeleteExplodedView={deleteExplodedView}
              onDeleteTaskVideo={deleteTaskVideo}
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
          toasts={workspaceToasts}
          onCancelConfirm={() => setFeedbackConfirm(undefined)}
          onConfirm={confirmFeedbackAction}
          onDismissToast={dismissWorkspaceNotice}
        />
      </div>
    </StepPhotoClipboardProvider>
  );
}
