"use client";

import { AddTaskMenu } from "./line-workspace/add-task-menu";
import { AWI_TASK_LINK_FIELD, LINKED_AWI_EDIT_MESSAGE, awiTaskLink, withLinkedAwiProcedure } from "@/domain/awi-task-link";
import { AwiEditorActions } from "./awi-editor-actions";
import { settleWriteBatch } from "@/domain/workspace-save-status";
import { useProcedureDrafts } from "./line-workspace/use-procedure-drafts";
import { createProcedureSaveQueueStore, useProcedureSaveQueue } from "./line-workspace/use-procedure-save-queue";
import { usePlannerShellAutosave, useWorkspaceSaves } from "./line-workspace/use-workspace-saves";
import type { SaveScope } from "./line-workspace/workspace-controller-types";
import { installProcedureAutosaveHarness } from "./line-workspace/procedure-autosave-harness";
import { useWorkspaceData } from "./line-workspace/use-workspace-data";
import { useWorkspaceRealtime } from "./line-workspace/use-workspace-realtime";
import { useLinkedAwiRefresh } from "./line-workspace/use-linked-awi-refresh";
import { useWorkspaceScenarios } from "./line-workspace/use-workspace-scenarios";
import { useWorkspaceTools } from "./line-workspace/use-workspace-tools";
import { useWorkspaceMedia } from "./line-workspace/use-workspace-media";
import { reorderTasksInSupabase } from "@/lib/planner/task-order-store";
import { mergeTaskOrder, rollbackTaskOrder } from "@/domain/task-reorder";
import type { AwiMaster } from "@/lib/awi/store";
import { readAnnotationDraft } from "@/lib/photo-annotation-drafts";

// Route-scoped styles: ~37 kB of planner-only rules (procedure, gantt, scenarios,
// setup, dashboard) that previously shipped to every route via globals.css.
import "./line-workspace.css";

import {
  Download,
  Plus,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  applyCalculatedFields,
  calculateActiveTaktMinutes,
  calculateAvailabilityMinutesForDemandPeriod,
  calculateProductKpis,
  formatMinutes,
  getTopLevelTasks,
  getTimelineBounds,
} from "@/domain/calculations";
import dynamic from "next/dynamic";
import { createPlannerDerivation } from "@/domain/planner-derivation";
import { buildOperatorAssignmentsFromIePlan } from "@/domain/operator-allocation";
import { getTaskOperatorIds, getTaskOperatorResetPatch, syncTaskOperatorCount } from "@/domain/operator-assignments";
import { buildStationSetupDocumentHtml } from "@/domain/report";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import {
  readCachedMainPlannerStateSync,
  writeCachedPlannerState,
} from "@/lib/planner-state-cache";
import {
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
  buildUnallocatedWorkReviews,
} from "@/domain/smart-allocation-report";
import { getStepPhotoAttachments, getTaskStepPhotoAnnotationMap } from "@/domain/step-photos";
import { StepPhotoClipboardProvider } from "@/components/line-workspace/step-photo-clipboard-provider";
import {
  PRODUCT_STEP_CHECK_CONFIG_FIELD,
  serializeManufacturingStepCheckDefinitions,
  type ManufacturingStepCheckDefinition,
} from "@/domain/manufacturing-step-checks";
import { getMasterBom } from "@/domain/master-bom";
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
  rebuildDependenciesFromTasks,
  relinkTasksForDependency,
  rescheduleTasksByDependencies,
  sanitizeDependencyIds,
  taskDependencyRefBelongsTo,
} from "@/domain/task-scheduling";
import { optimizeLine as runLineOptimization } from "@/domain/joint-scheduler";
import {
  duplicateScenario,
  listSopSummariesFromSupabase,
  type SopSummary,
  loadPlannerStateFromSupabase,
  loadTaskFromSupabase,
  loadScenariosForProduct,
  loadWorkspaceProjectGroups,
  moveManufacturingStepToTaskInSupabase,
  savePlannerStateToSupabase,
  uploadStepPhotoAttachment,
  type SaveState,
} from "@/domain/supabase-planner";
import type {
  DocumentTypeCode,
  ManufacturingStep,
  ManufacturingComponent,
  PlannerProjectContext,
  PlannerState,
  Project,
  ScenarioSummary,
  Task,
  Zone,
} from "@/domain/types";
import { BulkTaskEditor } from "./bulk-task-editor";
import { CommandPalette, type CommandPaletteGroup } from "./command-palette";
import { ScenarioTabs } from "./scenario-tabs";
import { ThemedFeedbackLayer, type FeedbackConfirm, type FeedbackToast } from "./themed-feedback";
import { WORKER_ICON_LETTERS } from "./worker-icon";
import { NothingStatus } from "./nothing-ui";
import { PlannerDashboardPanel, buildPlannerChromeContext } from "./planner-dashboard-panel";
import { TopNav } from "./planner-top-nav";
import { announceProjectSwitch, projectPlannerHref } from "./sidebar-workspace-panel";
import { ProcedureWorkspace } from "./line-workspace/procedure";
import { PlannerWorkspaceSkeleton, ProductLoadingState, SettingsLoadingState } from "./space-loading-states";
import { usePlannerPresence, type PresencePeer } from "@/lib/use-planner-presence";
import { AppSettingsPanel, embeddedSettingsSections, type SettingsSection } from "./app-settings-panel";
import { KpiStrip, LineReadinessPanel } from "./line-workspace/analytics";
import { ChecklistWorkspace } from "./line-workspace/planner-foundation-pages";
import {
  Sidebar,
  SidebarReopenButton,
  quickSwitchModules,
  type SetupSection,
} from "./line-workspace/nav";
import {
  buildWorkspaceUrl,
  buildProjectSwitchTargetContext,
  hasRecentProjectSwitchSession,
  readProjectSwitchTarget,
  readWorkspaceUrlSnapshot,
  recentProjectSwitchStartedAt,
  writeWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./line-workspace/state";
import {
  NomenclatureSetupPanel,
  ProcedureChecksSetupPanel,
  ProductSetupPanel,
  WorkInstructionsPanel,
} from "./line-workspace/setup-panels";
import {
  type ProductNumberField,
  type ProductTextField,
} from "./line-workspace/shared";


const GanttTimeline = dynamic(() => import("./gantt-timeline").then((module) => module.GanttTimeline), { loading: () => <PlannerWorkspaceSkeleton /> });
const OperatorUtilizationPanel = dynamic(() => import("./operator-utilization-panel").then((module) => module.OperatorUtilizationPanel), { loading: () => <PlannerWorkspaceSkeleton /> });
const ProjectCatalogSetupPanel = dynamic(() => import("./project-catalog-setup-panel").then((module) => module.ProjectCatalogSetupPanel), { loading: () => <PlannerWorkspaceSkeleton /> });
// Procedure is a primary Product/AWI surface. Include it in the already
// deferred workspace chunk to avoid a second nested Suspense code waterfall.
// Other panels remain lazy, and fresh core confirmation still gates editing.
const PfmeaWorkspace = dynamic(() => import("./line-workspace/pfmea-workspace").then((module) => module.PfmeaWorkspace), { loading: () => <PlannerWorkspaceSkeleton /> });

// Cap on the planner undo history. Snapshots are structural-shared PlannerState objects,
// so the memory cost is per-edit deltas, not full copies.
const UNDO_HISTORY_LIMIT = 50;

export function LineWorkspace({
  awiMaster,
  projectId,
  projectContext,
  onReady,
  initialPlannerState,
}: {
  awiMaster?: AwiMaster;
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
  // In-memory cache of the active scenario and freshly written optimizer seeds, keyed by scenario id.
  // Switching away evicts the departing scenario so revisits load remote changes; fresh optimizer
  // seeds can be applied immediately without another database load.
  const scenarioCacheRef = useRef<Map<string, PlannerState>>(new Map());
  const [activeModule, setActiveModule] = useState(() => urlWorkspaceSnapshot.activeModule ?? (awiMaster ? "procedure" : "dashboard"));
  const restoringWorkspaceHistoryRef = useRef(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");
  const [setupSection, setSetupSection] = useState<SetupSection>("product");
  const [selectedTaskId, setSelectedTaskId] = useState(emptyPlannerState.tasks[0]?.id);
  const [focusedProcedureStepId, setFocusedProcedureStepId] = useState<string | undefined>();
  const [selectedStationId, setSelectedStationId] = useState(emptyPlannerState.stations[0]?.id);
  const [activeZoneId, setActiveZoneId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Reported save status. Save paths and the load/project-switch effects below write it; it stays in
  // this component so those effects keep stable dependencies. useWorkspaceSaves derives what is shown.
  const [reportedSaveState, setSaveState] = useState<SaveState>("loading");
  const [reportedSaveError, setSaveError] = useState<string>();
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
  const [smartAllocationPending, setSmartAllocationPending] = useState(false);
  const [dismissedPlanningRecommendationKey, setDismissedPlanningRecommendationKey] = useState("");
  const plannerDirtyRef = useRef(false);
  const taskReorderInFlightRef = useRef(false);
  const taskReorderLifetimeRef = useRef(true);
  useEffect(() => {
    taskReorderLifetimeRef.current = true;
    return () => { taskReorderLifetimeRef.current = false; };
  }, []);

  const latestDerivedStateRef = useRef<PlannerState>(plannerState);
  // One queue store per mount: queue records are mutated in place across awaits, never recreated.
  const [procedureSaveQueues] = useState(createProcedureSaveQueueStore);
  const autosaveHarnessRanRef = useRef(false);
  const remoteRefreshAppliedRef = useRef(false);
  const pendingRemoteRefreshRef = useRef(false);
  const taskDetailHydrationRequestsRef = useRef<Set<string>>(new Set());
  const fullyHydratedScenarioIdsRef = useRef<Set<string>>(new Set());
  const urlWorkspaceSnapshotRef = useRef(urlWorkspaceSnapshot);
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

  // Drop the scenario cache when the project changes (a different project = different scenarios).
  useEffect(() => {
    scenarioCacheRef.current.clear();
  }, [projectId]);

  // Mirror the active scenario's latest state while it is open. The scenario switch evicts this entry
  // when leaving, because realtime no longer keeps an inactive scenario current.
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

  // The project and scenario on screen, refreshed every render. Saves keep the scope they were issued in;
  // only work in this scope drives the visible save status, the save barrier and the navigation guards.
  const foregroundSaveScopeRef = useRef<SaveScope>({ projectId, scenarioId: derivedState.scenario.id });
  foregroundSaveScopeRef.current = { projectId, scenarioId: derivedState.scenario.id };
  const [isForegroundSaveScope] = useState(() => (scope: SaveScope) =>
    String(scope.projectId ?? "") === String(foregroundSaveScopeRef.current.projectId ?? "") &&
    scope.scenarioId === foregroundSaveScopeRef.current.scenarioId);

  // Workspace saves: shown status, write tracker, guarded shell and BOM saves, the save barrier, and the
  // page-exit / in-app link guards (whose effect keeps its original position here).
  // flushDeferredRemoteRefresh (passed here, to the queue, tools and media) forwards to the realtime hook,
  // which is called later in this render and reads hasLocalSaveWork from this hook. The forwarder closes
  // over a holder created fresh for THIS render and filled with THIS render's realtime functions, so a save
  // issued in a render flushes that render's refresh -- the issuing project, tracker and stale-scope checks
  // -- exactly as the hoisted function declaration did before Phase 3. A ref would redirect it to the
  // latest render instead (docs/history/workspace-structure-plan.md, Phase 3).
  const realtimeOfThisRender: { current?: ReturnType<typeof useWorkspaceRealtime> } = {};
  function flushDeferredRemoteRefresh() {
    realtimeOfThisRender.current?.flushDeferredRemoteRefresh();
  }
  const {
    saveState,
    saveError,
    writeTracker,
    dirtyVersion,
    markDirty,
    saveInFlightRef,
    releaseShellLock,
    plannerSaveTimerRef,
    hasPlannerShellSaveWork,
    hasLocalSaveWork,
    flushPendingPlannerSave,
    waitForLocalSavesToSettle,
    persistPlannerState,
    updateMasterBom,
    blockMasterBomNavigation,
  } = useWorkspaceSaves({
    projectId,
    mainScenarioIdRef,
    latestDerivedStateRef,
    setPlannerState,
    notifyFeedback,
    blockViewOnlyWrite,
    reportedSaveState,
    reportedSaveError,
    setSaveState,
    setSaveError,
    plannerDirtyRef,
    procedureSaveQueues,
    remoteStateConfirmedRef,
    scenarioCacheRef,
    flushDeferredRemoteRefresh,
    setChromeStatus,
    isForegroundSaveScope,
  });

  // Per-field procedure drafts: merge/defer/acknowledge server tasks against local typing.
  const procedureDrafts = useProcedureDrafts({
    projectId,
    mainScenarioIdRef,
    latestDerivedStateRef,
    setPlannerState,
    queueProbe: procedureSaveQueues,
  });
  const {
    procedureDraftsRef,
    getProcedureFieldValue,
    hasDirtyProcedureDrafts,
    hasDirtyOrActiveProcedureDrafts,
    applyProcedureDraftsToTask,
    mergeServerTaskIntoLocalTask,
    storeDeferredProcedureServerUpdate,
    markProcedureFieldActive,
    markProcedureFieldInactive,
    restoreProcedureDraftFields,
    resetProcedureDrafts,
  } = procedureDrafts;
  // The [projectId] load effect reads restore/apply through refs so a new render never restarts it.
  const applyProcedureDraftsToTaskRef = useRef(applyProcedureDraftsToTask);
  const restoreProcedureDraftFieldsRef = useRef(restoreProcedureDraftFields);
  applyProcedureDraftsToTaskRef.current = applyProcedureDraftsToTask;
  restoreProcedureDraftFieldsRef.current = restoreProcedureDraftFields;

  // Per-task granular procedure saves (debounce, retry, exact acknowledgment, scope-exit flush).
  const {
    scheduleProcedureTaskSave,
    updateProcedureStepField,
    flushScheduledProcedureSaves,
    recoverProcedureDraftSaves,
  } = useProcedureSaveQueue({
    store: procedureSaveQueues,
    drafts: procedureDrafts,
    projectId,
    mainScenarioIdRef,
    latestDerivedStateRef,
    setPlannerState,
    setSaveState,
    setSaveError,
    notifyFeedback,
    blockViewOnlyWrite,
    remoteRefreshAppliedRef,
    flushDeferredRemoteRefresh,
    isForegroundSaveScope,
  });
  // Read by the load effect (recovered drafts).
  const recoverProcedureDraftSavesRef = useRef(recoverProcedureDraftSaves);
  recoverProcedureDraftSavesRef.current = recoverProcedureDraftSaves;

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
  // The route gate revalidates Product access on tab return. Prefer its current
  // context to the permission captured inside an older planner snapshot.
  const activeProjectContext = projectContext?.projectId === derivedState.project?.projectId
    ? projectContext
    : derivedState.project ?? projectContext;
  // Module-wide view-only access. RLS already rejects these writes server-side; gating
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

  // Step tools and the project tool catalog (the library load effect keeps its original position here).
  const {
    toolLibraryItems,
    toolLibrary,
    projectToolRegistry,
    persistAddStepTool,
    persistRemoveStepTool,
    saveCatalogTool,
    tidyCatalogToolNames,
    deleteCatalogTool,
  } = useWorkspaceTools({
    projectId,
    libraryProjectId: activeProjectContext?.projectId,
    derivedState,
    setPlannerState,
    writeTracker,
    remoteStateConfirmedRef,
    setSaveState,
    setSaveError,
    notifyFeedback,
    blockViewOnlyWrite,
    flushDeferredRemoteRefresh,
  });
  // Step photos, build animations and exploded views (no effects; hooks above keep their order).
  const { uploadStepPhotos, pasteStepPhoto, deleteTaskVideo, deleteExplodedView, removeStepPhoto } = useWorkspaceMedia({
    projectId,
    activeProjectContext,
    latestDerivedStateRef,
    setPlannerState,
    writeTracker,
    saveInFlightRef,
    releaseShellLock,
    setSaveState,
    setSaveError,
    notifyFeedback,
    notifyRestoreAction,
    flushDeferredRemoteRefresh,
  });

  // Scenario actions (no effects; the scenario list/cache effects above keep their position).
  const {
    isSwitchingScenario,
    setIsSwitchingScenario,
    switchTargetId,
    ensureSavedBeforeScenarioAction,
    loadScenarioIntoView,
    refreshScenarioList,
    switchScenario,
    renameScenarioById,
    requestDeleteScenario,
    editScenarioTarget,
    duplicateActiveScenario,
  } = useWorkspaceScenarios({
    projectId,
    derivedState,
    isMainScenario,
    latestDerivedStateRef,
    setPlannerState,
    setSaveState,
    setSaveError,
    scenarios,
    setScenarios,
    scenarioCacheRef,
    plannerDirtyRef,
    remoteStateConfirmedRef,
    fullyHydratedScenarioIdsRef,
    taskDetailHydrationRequestsRef,
    setTaskDetailHydrationStatus,
    setSelectedTaskId,
    setSelectedStationId,
    setActiveZoneId,
    setFocusedProcedureStepId,
    setFeedbackConfirm,
    notifyFeedback,
    resetProcedureDrafts,
    hasDirtyProcedureDrafts,
    recoverProcedureDraftSaves,
    flushPendingPlannerSave,
    waitForLocalSavesToSettle,
  });


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
      detailDrawerCollapsed: true,
      sidebarCollapsed,
      savedAt: new Date().toISOString(),
    });
  }, [
    activeModule,
    activeZoneId,
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
      setActiveModule(snapshot.activeModule ?? (awiMaster ? "procedure" : "dashboard"));
      if (snapshot.selectedTaskId) setSelectedTaskId(snapshot.selectedTaskId);
      if (snapshot.selectedStationId) setSelectedStationId(snapshot.selectedStationId);
      setActiveZoneId(snapshot.activeZoneId);
    }

    window.addEventListener("popstate", restoreWorkspaceFromHistory);
    return () => window.removeEventListener("popstate", restoreWorkspaceFromHistory);
  }, [awiMaster]);


  useEffect(() => {
    // The constant-folded development check keeps the harness module out of production bundles.
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      return installProcedureAutosaveHarness({
        projectId,
        hasAutosaveHarnessParam,
        autosaveHarnessRanRef,
        procedureSaveQueuesRef: procedureSaveQueues.procedureSaveQueuesRef,
        drafts: procedureDrafts,
      });
    }
    return undefined;
    // The development-only harness intentionally installs one snapshot per project. Its helpers
    // read mutable procedure refs, while re-registering on every render would reset test state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAutosaveHarnessParam, projectId]);

  // Project loading, confirmation, project-switch timing and selected-task media (the load effect's
  // original position; its effects keep their order and dependency arrays).
  useWorkspaceData({
    projectId,
    initialPlannerState,
    onReady,
    activeModule,
    derivedState,
    hasConfirmedRemoteState,
    hasLoadedRemoteState,
    selectedTaskId,
    taskDetailHydrationStatus,
    setProjectSwitchTargetContext,
    setIsProjectSwitching,
    setHasLoadedRemoteState,
    setHasConfirmedRemoteState,
    setSaveState,
    setSaveError,
    setTaskDetailHydrationStatus,
    setPlannerState,
    setActiveModule,
    setSelectedTaskId,
    setSelectedStationId,
    setActiveZoneId,
    setSidebarCollapsed,
    setWorkspaceNotice,
    urlWorkspaceSnapshotRef,
    initialCachedPlannerSnapshotRef,
    hasLoadedAnyProjectRef,
    loadedProjectIdRef,
    projectSwitchStartedAtRef,
    projectSwitchSkeletonTimerRef,
    remoteStateConfirmedRef,
    mainScenarioIdRef,
    taskDetailHydrationRequestsRef,
    fullyHydratedScenarioIdsRef,
    plannerDirtyRef,
    restoreProcedureDraftFieldsRef,
    applyProcedureDraftsToTaskRef,
    recoverProcedureDraftSavesRef,
    latestDerivedStateRef,
  });

  // Realtime refresh and subscription. Called here, at the subscription effect's original position, so
  // effect order is unchanged. This render's functions are stored for the flush forwarder above.
  realtimeOfThisRender.current = useWorkspaceRealtime({
    projectId,
    derivedState,
    hasLoadedRemoteState,
    latestDerivedStateRef,
    setPlannerState,
    setSaveState,
    setSaveError,
    mainScenarioIdRef,
    loadedProjectIdRef,
    pendingRemoteRefreshRef,
    remoteRefreshAppliedRef,
    plannerDirtyRef,
    presencePeersRef,
    fullyHydratedScenarioIdsRef,
    setTaskDetailHydrationStatus,
    setSelectedTaskId,
    setSelectedStationId,
    notifyFeedback,
    hasPlannerShellSaveWork,
    hasLocalSaveWork,
    procedureDraftsRef,
    hasDirtyOrActiveProcedureDrafts,
    storeDeferredProcedureServerUpdate,
    mergeServerTaskIntoLocalTask,
    flushScheduledProcedureSaves,
  });

  // Unmount-only cleanup for the project-switch skeleton timer, armed by finishProjectSwitch
  // (use-workspace-data.ts). The subscription cleanup deliberately leaves it alone (see the note there).
  useEffect(
    () => () => {
      if (projectSwitchSkeletonTimerRef.current) {
        window.clearTimeout(projectSwitchSkeletonTimerRef.current);
        projectSwitchSkeletonTimerRef.current = null;
      }
    },
    [],
  );

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

  usePlannerShellAutosave({
    dirtyVersion,
    plannerDirtyRef,
    plannerSaveTimerRef,
    persistPlannerState,
    derivedState,
    hasLoadedRemoteState,
    remoteStateConfirmedRef,
    remoteRefreshAppliedRef,
  });

  function dismissWorkspaceNotice(id = 1) {
    if (id === 0) { setChromeStatus(null); return; }
    setWorkspaceNotice(null);
  }

  function notifyFeedback(message: Omit<FeedbackToast, "id">) {
    if (message.content || message.placement === "center") {
      setWorkspaceNotice(message);
      return;
    }

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
    void loadWorkspaceProjectGroups(undefined, undefined, "product")
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
  const canDisplayCachedAwi = Boolean(awiMaster && hasLoadedRemoteState && derivedState.product.projectId === projectId);
  const requiresCompletePlannerState = !isDashboardModule && !isSettingsModule;
  const sidebarActiveModule = isProjectSwitching ? "dashboard" : activeModule;
  const plannerChromeContext = awiMaster
    ? { title: derivedState.tasks.find((task) => task.id === awiMaster.task_id)?.name || awiMaster.title, status: "Draft", statusClass: undefined, detail: awiMaster.document_number }
    : isDashboardModule ? buildPlannerChromeContext(derivedState.product) : undefined;
  if (!isProjectSwitching && plannerChromeContext) {
    stablePlannerChromeContextRef.current = plannerChromeContext;
  }
  const displayedPlannerChromeContext = awiMaster ? plannerChromeContext : isProjectSwitching
    ? projectSwitchTargetContext ?? stablePlannerChromeContextRef.current ?? plannerChromeContext
    : plannerChromeContext;
  const showsSchedulingWorkspace = activeModule === "gantt";
  const selectedTask = derivedState.tasks.find((task) => task.id === selectedTaskId) ?? derivedState.tasks[0];
  useLinkedAwiRefresh({ plannerState, setPlannerState });

  const selectedProcedureTaskHydrationStatus = selectedTask
    ? taskDetailHydrationStatus[selectedTask.id]
    : "loaded";
  const isSelectedProcedureTaskHydrating =
    isProcedureModule &&
    Boolean(selectedTask) &&
    selectedProcedureTaskHydrationStatus !== "loaded" &&
    selectedProcedureTaskHydrationStatus !== "error";
  const workspaceGridClass = "ui-workspace-shell";
  const workspaceGridStyle = {
    "--workspace-sidebar-width": sidebarCollapsed ? "0px" : "var(--shell-sidebar)",
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
    const task = plannerState.tasks.find(item => item.id === taskId);
    if (task && awiTaskLink(task)) return;
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
    if ((sourceTask && awiTaskLink(sourceTask)) || (targetTask && awiTaskLink(targetTask))) {
      notifyFeedback({
        title: "Step move failed",
        body: LINKED_AWI_EDIT_MESSAGE,
        tone: "danger",
      });
      return;
    }
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
    const finishWrite = writeTracker.begin(`step-move:${stepId}`);
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
        finishWrite(error);
        const message = error instanceof Error ? error.message : "Unable to move the procedure step.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Step move failed",
          body: message,
          tone: "danger",
        });
      })
      .finally(() => { finishWrite(); flushDeferredRemoteRefresh(); });
  }

  function resetTaskHeadcount() {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => ({ ...task, ...getTaskOperatorResetPatch(task) })),
    }));
  }

  // "Optimize line": deterministically schedule dependent work as early as possible (shortest lead
  // time) and balance the crew with the fewest operators, leveling only within free float so the
  // finish never slips. The proposal is written into a fresh duplicated scenario (sandbox) so the
  // source plan is never touched. Replaces the old in-place IE headcount allocation on this button.
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
    // A restore is a user edit: it autosaves on the normal 900 ms path, never as a server echo.
    markDirty();
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
      const finishWrite = writeTracker.begin(`photo-upload:${taskSnapshot.id}:${step.id}`);
      try {
        await settleWriteBatch(
          stepPhotos.map((photo) => uploadStepPhotoAttachment(taskSnapshot.id, step.id, photo, activeProjectContext)),
        );
      } catch (error) {
        finishWrite(error);
        setSaveError(error instanceof Error ? error.message : "Step restored, but one or more photos could not be restored.");
        setSaveState("error");
      } finally {
        finishWrite();
        flushDeferredRemoteRefresh();
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

  async function reorderTaskGroups(
    sourceTaskIds: string[],
    targetTaskIds: string[],
    targetZoneId: string | undefined,
    placement: "before" | "after",
  ) {
    if (blockViewOnlyWrite() || !hasConfirmedRemoteState || taskReorderInFlightRef.current) return;
    const scope = { projectId, scenarioId: plannerState.scenario.id };
    const isCurrent = () => taskReorderLifetimeRef.current && isForegroundSaveScope(scope);
    const assertCurrent = () => { if (!isCurrent()) throw new Error("Task reorder scope changed."); };
    taskReorderInFlightRef.current = true;
    flushPendingPlannerSave();
    flushScheduledProcedureSaves();
    if (!(await waitForLocalSavesToSettle(12000, "gantt-order")) || !isCurrent()) {
      taskReorderInFlightRef.current = false;
      return;
    }
    const beforeState = latestDerivedStateRef.current;
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

    const reorderedTasks = buildReorderedTasks(beforeState.tasks);
    if (!reorderedTasks) {
      taskReorderInFlightRef.current = false;
      return;
    }

    const changedTasks = reorderedTasks.filter((task) => {
      const currentTask = beforeState.tasks.find((candidate) => candidate.id === task.id);
      return (
        !currentTask ||
        currentTask.wbs !== task.wbs ||
        currentTask.zoneId !== task.zoneId ||
        currentTask.stationId !== task.stationId
      );
    });

    if (changedTasks.length === 0) {
      taskReorderInFlightRef.current = false;
      return;
    }

    const nextState: PlannerState = {
      ...beforeState,
      tasks: reorderedTasks,
    };

    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");
    setPlannerState(nextState);
    setActiveZoneId(targetZoneId);
    const finishWrite = writeTracker.begin("gantt-order");

    void (async () => {
      let reconcileQueuedState: ((state: PlannerState) => PlannerState) | undefined;
      const inReorderScope = (state: PlannerState) =>
        state.product.projectId === scope.projectId && state.scenario.id === scope.scenarioId;
      try {
        const order = await reorderTasksInSupabase(
          String(projectId ?? ""), scope.scenarioId, beforeState.tasks, reorderedTasks, undefined, assertCurrent,
        );
        if (!isCurrent()) return;
        reconcileQueuedState = (current) => inReorderScope(current)
          ? { ...current, tasks: mergeTaskOrder(current.tasks, order) }
          : current;
        setPlannerState(reconcileQueuedState);
        setSaveState("saved");
      } catch (error) {
        finishWrite(error);
        if (!isCurrent()) return;
        reconcileQueuedState = (current) => inReorderScope(current)
          ? { ...current, tasks: rollbackTaskOrder(current.tasks, beforeState.tasks, reorderedTasks) }
          : current;
        setPlannerState(reconcileQueuedState);
        const message = error instanceof Error ? error.message : "Unable to save Gantt order.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Save failed",
          body: message,
          tone: "danger",
        });
      } finally {
        taskReorderInFlightRef.current = false;
        // Always release (and drain) the lock: a scope change mid-request must not leave it held for the
        // mount. isCurrent() gates only state updates and notices.
        // The queued snapshot predates the response. Apply the same order reconciliation as
        // the UI before saving it, preserving unrelated edits and other project/scenario queues.
        releaseShellLock(reconcileQueuedState);
        finishWrite();
        if (isCurrent()) flushDeferredRemoteRefresh();
      }
    })();
  }

  function addTaskToZone(zoneId?: string, linkedMaster?: AwiMaster, masterTask?: Task) {
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
      name: linkedMaster?.title ?? "",
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
      customFields: linkedMaster ? {[AWI_TASK_LINK_FIELD]: {masterId:linkedMaster.id, projectId:linkedMaster.project_id, taskId:linkedMaster.task_id, documentNumber:linkedMaster.document_number}} : {},
      workInstructionLink: linkedMaster ? `/awi/${linkedMaster.id}?view=procedure&task=${encodeURIComponent(linkedMaster.task_id)}` : undefined,
    };
    const codedTask = applyTaskCode(masterTask ? withLinkedAwiProcedure(newTask, masterTask) : newTask, plannerState.zones, plannerState.components, true);

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
          actions={awiMaster ? <AwiEditorActions key={awiMaster.id} master={awiMaster} saveState={saveState} saveError={saveError}
            recoveryDrafts={procedureDraftsRef.current}
            state={hydratedTaskIds.has(awiMaster.task_id) ? derivedState : undefined}
            readOnly={isViewOnlyAccess} ready={hasConfirmedRemoteState}
            beforeSave={() => ensureSavedBeforeScenarioAction("AWI is still saving", "Resolve the save issue before changing AWI details.")} /> : undefined}
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
          (requiresCompletePlannerState && !hasConfirmedRemoteState && !canDisplayCachedAwi) ? (
            <PlannerWorkspaceSkeleton />
          ) : isProcedureModule ? (
            <div className="contents" inert={Boolean(awiMaster && !hasConfirmedRemoteState)} aria-busy={Boolean(awiMaster && !hasConfirmedRemoteState)}>
            <ProcedureWorkspace
              isAwiMaster={Boolean(awiMaster)}
              publishAction={selectedTask && awiTaskLink(selectedTask) ? <>
                {selectedTask.awiMasterStatus === "unavailable" && <span role="status" className="text-xs text-danger">Master AWI unavailable. Reload to retry.</span>}
                <a className="ui-btn-ghost h-9" href={`/awi/${awiTaskLink(selectedTask)!.masterId}?view=procedure&task=${encodeURIComponent(awiTaskLink(selectedTask)!.taskId)}`}>Open master AWI</a></> : awiMaster ? <WorkInstructionsPanel compact isAwiMaster
                tasks={derivedState.tasks.filter(task => task.id === awiMaster.task_id)}
                zones={derivedState.zones} product={derivedState.product}
                initialPlannerState={derivedState} hydratedTaskIds={hydratedTaskIds}
                readOnly={isViewOnlyAccess || !hasConfirmedRemoteState}
                onBeforeRelease={() => ensureSavedBeforeScenarioAction("AWI is still saving", "Resolve the save issue before publishing this AWI.")}
                onOpenTask={selectTask} /> : undefined}
              readOnly={isViewOnlyAccess || !hasConfirmedRemoteState || Boolean(selectedTask && awiTaskLink(selectedTask))}
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
            </div>
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
                  : "space-y-4 p-3 sm:p-4 pb-6"
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
                      onUpdateTask={updateTask}
                      onBeforeRelease={awiMaster ? () => ensureSavedBeforeScenarioAction("AWI is still saving", "Resolve the save issue before releasing this AWI.") : undefined}
                      isAwiMaster={Boolean(awiMaster)}
                      tasks={derivedState.tasks}
                      zones={derivedState.zones}
                      product={derivedState.product}
                      initialPlannerState={derivedState}
                      hydratedTaskIds={hydratedTaskIds}
                      readOnly={isViewOnlyAccess}
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
                        <AddTaskMenu key={projectId} workspaceId={activeProjectContext?.workspaceId} disabled={isViewOnlyAccess || !hasConfirmedRemoteState}
                          onNewTask={addTaskAtBottom}
                          onLinkTask={async master => {
                            const source = await loadTaskFromSupabase(master.task_id, master.project_id);
                            if (latestDerivedStateRef.current.product.projectId !== projectId) throw new Error("The active product changed. Choose the AWI again.");
                            if (!source) throw new Error("This master AWI is unavailable.");
                            addTaskToZone(activeZoneId ?? plannerState.tasks.at(-1)?.zoneId, master, source);
                          }} />
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
        </div>

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
