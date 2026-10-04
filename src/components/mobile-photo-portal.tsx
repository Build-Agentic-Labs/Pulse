"use client";

// Route-scoped styles: ~24 kB of .mobile-photo-* / .ui-photo-mobile-* rules that
// previously shipped to every route via globals.css. Loading them with this
// dynamically-imported component keeps them off every other page.
import "./mobile-photo-portal.css";

import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardList,
  ImageIcon,
  Menu,
  Plus,
  Timer,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import NextImage from "next/image";
import { applyCalculatedFields, formatMinutes, getTopLevelTasks } from "@/domain/calculations";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import {
  getManufacturingStepCheckSet,
  getManufacturingStepCheckDefinitions,
  getManufacturingStepCheckState,
  serializeManufacturingStepCheckState,
  type ManufacturingStepCheckValue,
} from "@/domain/manufacturing-step-checks";
import { generateTaskCode, nextTaskNumberForComponent, stepDisplayCode, taskDisplayCode } from "@/domain/nomenclature";
import {
  STEP_PHOTO_ATTACHMENTS_FIELD,
  getStepPhotoAttachments,
  removeStepPhotoAttachment,
  upsertStepPhotoAttachments,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import { getTaskExplodedViews } from "@/domain/step-exploded-views";
import { compareTasksByWbs } from "@/domain/task-planning";
import { getTaskVideos } from "@/domain/task-videos";
import { STEP_TOOL_LISTS_FIELD, addStepTool, buildStepToolLibrary, countTaskStepTools, getStepToolList, removeStepTool } from "@/domain/step-tools";
import {
  createPlannerSupabaseClient,
  getUserFromSession,
  addStepToolToSupabase,
  deletePlannerTask,
  canPatchTaskFromRealtimePayload,
  loadPlannerStateFromSupabase,
  loadTaskFromSupabase,
  removeStepToolFromSupabase,
  saveMobileStepToSupabase,
  savePlannerStateToSupabase,
  saveTaskToSupabase,
  saveTaskWithManufacturingStepsToSupabase,
  saveTasksToSupabase,
  syncStepToolsForStepToSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  subscribePlannerStateChanges,
  taskIdFromRealtimePayload,
  uploadStepPhotoAttachment,
} from "@/domain/supabase-planner";
import type { ManufacturingStep, PlannerProjectContext, PlannerState, Task } from "@/domain/types";
import { AppLoadingShell } from "@/components/app-flow-panels";
import { NothingSpinner } from "@/components/nothing-ui";
import { StepExplodedViewGallery } from "@/components/step-exploded-view-gallery";
import { TaskVideoGallery } from "@/components/task-video-gallery";
import { ProcedureToolPicker } from "@/components/procedure-tool-picker";
import { ThemedSelect } from "@/components/themed-select";

import { ProcedureStepChecksEditor } from "@/components/line-workspace/step-editors";
import {
  EMPTY_CAPTURE_TIMER,
  buildMobileCaptureSessionSnapshot,
  collectHeaderCaptureTimers,
  elapsedMinutesFromTimer,
  formatElapsedTimer,
  freezeCaptureTimer,
  getCaptureTimerElapsed,
  getCaptureTimerLapElapsed,
  isRecord,
  preserveRunningCaptureTimer,
  readMobileCaptureSession,
  restoreRunningCaptureTimer,
  writeMobileCaptureSession,
  type CaptureTimerState,
  type ParkedTaskCaptureState,
} from "@/components/mobile-photo-portal/capture-session";
import {
  loadMobileNewStepRecoveryDraft,
  isMobileRecoveryPayload,
  type MobileNewStepDraftRecord,
  createMobileRecoveryDraftStore,
  type ScopedRecoveryDraft,
  readBlobAsDataUrl,
  recoveryDraftKey,
} from "@/components/mobile-photo-portal/recovery-draft-store";

import { LegacyDraftReview } from "./mobile-photo-portal/legacy-draft-review";

const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.72;

type RestorePrompt = {
  title: string;
  body: string;
  restoreLabel: string;
  onRestore: () => Promise<void>;
};

type ConfirmPrompt = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};


function sortManufacturingSteps(steps: ManufacturingStep[]) {
  return [...steps].sort((left, right) => left.sequence - right.sequence);
}

function getTaskProcessNumber(task: Task) {
  return task.wbs.split(".")[0] || task.wbs;
}

function getTaskWbsSuffix(task: Task) {
  const parts = task.wbs.split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : "";
}

function stationIdForZone(zoneId: string) {
  return `station-${zoneId}`;
}

function stationIdForUnzoned(scenarioId: string) {
  return `station-${scenarioId}-unzoned`;
}

function removeStepScopedCustomFields(task: Task, stepId: string): Task {
  const nextCustomFields = { ...task.customFields };

  [STEP_PHOTO_ATTACHMENTS_FIELD, STEP_TOOL_LISTS_FIELD].forEach((field) => {
    const fieldValue = nextCustomFields[field];

    if (!isRecord(fieldValue)) {
      return;
    }

    const nextMap = { ...fieldValue };
    delete nextMap[stepId];

    if (Object.keys(nextMap).length > 0) {
      nextCustomFields[field] = nextMap;
    } else {
      delete nextCustomFields[field];
    }
  });

  return {
    ...task,
    customFields: nextCustomFields,
  };
}

const MOBILE_TEXTAREA_MAX_HEIGHT_PX = 224;

function resizeTextareaToContent(textarea: HTMLTextAreaElement, maxHeight = MOBILE_TEXTAREA_MAX_HEIGHT_PX) {
  textarea.style.height = "auto";
  const scrollHeight = textarea.scrollHeight;
  const nextHeight = Math.min(scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
}

function ensureMobileFieldVisible(element: HTMLElement | null, headerHeight: number) {
  if (!element || !element.isConnected) {
    return;
  }

  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const visibleTop = viewportTop + headerHeight + 8;
  const visibleBottom = viewportTop + viewportHeight - 16;
  const rect = element.getBoundingClientRect();

  if (rect.bottom > visibleBottom) {
    window.scrollBy({ top: rect.bottom - visibleBottom, behavior: "auto" });
  } else if (rect.top < visibleTop) {
    window.scrollBy({ top: rect.top - visibleTop, behavior: "auto" });
  }
}

function manufacturingStepDisplayName(step: Pick<ManufacturingStep, "name" | "sequence">) {
  const trimmed = step.name?.trim();
  return trimmed || `Step ${step.sequence}`;
}

function parseManufacturingStepNameInput(value: string, sequence: number) {
  const trimmed = value.trim();
  const fallback = `Step ${sequence}`;

  if (!trimmed || trimmed === fallback) {
    return "";
  }

  return trimmed;
}

function getNextTopLevelWbs(tasks: Task[]) {
  return String(
    Math.max(
      0,
      ...tasks
        .map((task) => Number.parseInt(task.wbs.split(".")[0] ?? "0", 10))
        .filter(Number.isFinite),
    ) + 1,
  );
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to read ${file.name || "photo"}.`));
    };
    image.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Unable to compress photo."));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

async function buildPhotoAttachment(file: File): Promise<StepPhotoAttachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name || "Selected file"} is not an image.`);
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare photo compression.");
  }

  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToJpegBlob(canvas);
  const dataUrl = await readBlobAsDataUrl(blob);

  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "Step photo.jpg",
    dataUrl,
    capturedAt: new Date().toISOString(),
    contentType: blob.type,
    sizeBytes: blob.size,
    width,
    height,
  };
}

function rescheduleTasksByDependencies(tasks: Task[]) {
  if (tasks.length === 0) {
    return tasks;
  }

  const taskStartTimes = tasks.map((task) => Date.parse(task.plannedStart)).filter(Number.isFinite);
  const lineStartMs = taskStartTimes.length ? Math.min(...taskStartTimes) : Date.now();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const scheduledById = new Map<string, { startMs: number; finishMs: number }>();
  const visiting = new Set<string>();

  function resolveSchedule(taskId: string): { startMs: number; finishMs: number } {
    const existing = scheduledById.get(taskId);
    if (existing) {
      return existing;
    }

    const task = taskById.get(taskId);
    if (!task) {
      return { startMs: lineStartMs, finishMs: lineStartMs };
    }

    if (visiting.has(taskId)) {
      const fallbackStartMs = Date.parse(task.plannedStart);
      const startMs = Number.isFinite(fallbackStartMs) ? fallbackStartMs : lineStartMs;
      return {
        startMs,
        finishMs: startMs + Math.max(task.plannedDurationMinutes, 0) * 60_000,
      };
    }

    visiting.add(taskId);

    const plannedStartMs = Date.parse(task.plannedStart);
    const manualStartMs = Number.isFinite(plannedStartMs) ? Math.max(lineStartMs, plannedStartMs) : lineStartMs;
    const dependencyFinishMs = task.dependencyIds.reduce((latestFinish, dependencyId) => {
      const predecessor = taskById.get(dependencyId);
      if (!predecessor) {
        return latestFinish;
      }

      return Math.max(latestFinish, resolveSchedule(predecessor.id).finishMs);
    }, lineStartMs);
    const startMs = task.dependencyIds.length > 0
      ? Math.max(lineStartMs, dependencyFinishMs)
      : Math.max(lineStartMs, manualStartMs);
    const finishMs = startMs + Math.max(task.plannedDurationMinutes, 0) * 60_000;
    const schedule = { startMs, finishMs };
    scheduledById.set(taskId, schedule);
    visiting.delete(taskId);

    return schedule;
  }

  return tasks.map((task) => {
    const { startMs, finishMs } = resolveSchedule(task.id);

    return {
      ...task,
      plannedStart: new Date(startMs).toISOString(),
      plannedFinish: new Date(finishMs).toISOString(),
    };
  });
}

function withStepDerivedDuration(task: Task, nextSteps: ManufacturingStep[]): Task {
  const plannedDurationMinutes = nextSteps.reduce(
    (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
    0,
  );
  const plannedStartMs = Date.parse(task.plannedStart);
  const plannedFinish =
    Number.isFinite(plannedStartMs)
      ? new Date(plannedStartMs + plannedDurationMinutes * 60_000).toISOString()
      : task.plannedFinish;

  return {
    ...task,
    manufacturingSteps: nextSteps,
    plannedDurationMinutes,
    plannedFinish,
  };
}

function withUpdatedTask(state: PlannerState, nextTask: Task, shouldReschedule = false): PlannerState {
  const updatedAt = new Date().toISOString();
  const tasks = state.tasks.map((task) => (task.id === nextTask.id ? nextTask : task));

  return {
    ...state,
    product: {
      ...state.product,
      updatedAt,
    },
    scenario: {
      ...state.scenario,
      updatedAt,
    },
    tasks: shouldReschedule ? rescheduleTasksByDependencies(tasks) : tasks,
  };
}

type MobilePhotoPortalProps = {
  projectId?: string;
  projectContext?: PlannerProjectContext;
  onBackToProjects?: () => void;
  onReady?: () => void;
  initialPlannerState?: PlannerState;
};

// Account changes remount the editor, so old parked fields, retry queues and draft state cannot
// become the next account's work. Invalidate synchronously in the auth callback before React commits.
export function MobilePhotoPortal(props: MobilePhotoPortalProps) {
  const [identity, setIdentity] = useState<{ userId: string | null; generation: number } | null>(null);
  const identityRef = useRef<{ userId: string | null; generation: number } | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const client = createPlannerSupabaseClient();
    function accept(userId: string | null) {
      if (!active || (identityRef.current && identityRef.current.userId === userId)) return;
      const next = { userId, generation: (identityRef.current?.generation ?? 0) + 1 };
      identityRef.current = next;
      setIdentity(next);
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      revision += 1;
      accept(session?.user.id ?? null);
    });
    const initialRevision = revision;
    void getUserFromSession(client).then(({ data }) => {
      if (revision === initialRevision) accept(data.user?.id ?? null);
    }).catch(() => { if (revision === initialRevision) accept(null); });
    return () => { active = false; identityRef.current = null; data.subscription.unsubscribe(); };
  }, []);
  if (!identity) return <AppLoadingShell title="Loading mobile capture…" />;
  return <AccountMobilePhotoPortal {...props} key={`${props.projectId ?? ""}:${identity.generation}`}
    initialPlannerState={identity.generation === 1 ? props.initialPlannerState : undefined}
    userId={identity.userId} isAccountCurrent={() => identityRef.current === identity} />;
}

function AccountMobilePhotoPortal({ projectId, projectContext, onBackToProjects, onReady, initialPlannerState,
  userId, isAccountCurrent,
}: MobilePhotoPortalProps & { userId: string | null; isAccountCurrent: () => boolean }) {
  const [plannerState, setPlannerState] = useState<PlannerState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [activeScreen, setActiveScreen] = useState<"list" | "detail">("list");
  const [saveState, setSaveState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [photoUploadCounts, setPhotoUploadCounts] = useState<Record<string, number>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskZoneId, setNewTaskZoneId] = useState("");
  const [newTaskComponentId, setNewTaskComponentId] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragTargetTaskId, setDragTargetTaskId] = useState<string | null>(null);
  const [dragTargetPlacement, setDragTargetPlacement] = useState<"before" | "after">("after");
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; width: number } | null>(null);
  const [showNewStepForm, setShowNewStepForm] = useState(false);
  // Steps render collapsed by default: fully expanded, one step runs ~750px on a 812px phone, so a
  // nine-step task was ~8.7 screens of mostly-empty form to scroll past. Expansion is per step and
  // additive -- opening one never closes another, because comparing two steps is a real task here.
  const [swipedTaskId, setSwipedTaskId] = useState<string | null>(null);
  const processSwipeRef = useRef<{ x: number; y: number; horizontal: boolean } | null>(null);
  const suppressProcessClickRef = useRef(false);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => new Set());
  const [newStepName, setNewStepName] = useState("");
  const draftBaseStepsRef = useRef(new Map<string, ManufacturingStep>());
  const failedDraftPatchesRef = useRef(new Map<string, Partial<ManufacturingStep>>());
  const failedDraftToolSyncRef = useRef(new Set<string>());
  const closeDraftAfterSaveRef = useRef(false);
  const [newStepInstruction, setNewStepInstruction] = useState("");
  const [newStepDurationText, setNewStepDurationText] = useState("5");
  const [newStepToolName, setNewStepToolName] = useState("");
  const [newStepId, setNewStepId] = useState<string | null>(null);
  const [newStepDraftTools, setNewStepDraftTools] = useState<string[]>([]);
  const [newStepDraftPhotos, setNewStepDraftPhotos] = useState<StepPhotoAttachment[]>([]);
  const [newStepDraftChecks, setNewStepDraftChecks] = useState<Set<string>>(() => new Set());
  const [newStepDraftCheckValues, setNewStepDraftCheckValues] = useState<Record<string, ManufacturingStepCheckValue>>({});
  const stepCheckDefinitions = useMemo(() => getManufacturingStepCheckDefinitions(plannerState?.product.customFields), [plannerState?.product.customFields]);
  const [writesPending, setWritesPending] = useState(false);
  const [newStepPhotoBusyCount, setNewStepPhotoBusyCount] = useState(0);
  const [newStepToolNames, setNewStepToolNames] = useState<Record<string, string>>({});
  const [confirmDeleteStepId, setConfirmDeleteStepId] = useState<string | null>(null);
  const [restorePrompt, setRestorePrompt] = useState<RestorePrompt | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const [captureTimer, setCaptureTimer] = useState<CaptureTimerState>(EMPTY_CAPTURE_TIMER);
  const [parkedCaptureByTaskId, setParkedCaptureByTaskId] = useState<Record<string, ParkedTaskCaptureState>>({});
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const captureTimerRef = useRef(captureTimer);
  const parkedCaptureByTaskIdRef = useRef(parkedCaptureByTaskId);
  const [mobileHeaderHeight, setMobileHeaderHeight] = useState(72);
  const revealNewProcessForm = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "start" });
  }, []);
  const [newStepMotionPhase, setNewStepMotionPhase] = useState<"idle" | "exit" | "enter">("idle");
  const [recentlyCompletedStepId, setRecentlyCompletedStepId] = useState<string | null>(null);
  const newStepMotionTimersRef = useRef<number[]>([]);
  const saveInFlightRef = useRef(false);
  const localWriteCountRef = useRef(0);
  const photoUploadQueuesRef = useRef<Record<string, Promise<void>>>({});
  const newStepAutosaveTimerRef = useRef<number | null>(null);
  const mobileHeaderRef = useRef<HTMLElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const newStepInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const newStepFormRef = useRef<HTMLDivElement | null>(null);
  const stepInstructionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const stepInstructionRefCallbacksRef = useRef(new Map<string, (node: HTMLTextAreaElement | null) => void>());
  const mobileHeaderHeightRef = useRef(mobileHeaderHeight);
  const bindNewStepInstructionRef = useRef((node: HTMLTextAreaElement | null) => {
    newStepInstructionRef.current = node;
    if (node) {
      window.requestAnimationFrame(() => resizeTextareaToContent(node));
    }
  }).current;
  const draggingTaskIdRef = useRef<string | null>(null);
  const dragTargetTaskIdRef = useRef<string | null>(null);
  const dragTargetPlacementRef = useRef<"before" | "after">("after");
  const [legacyDraft, setLegacyDraft] = useState<MobileNewStepDraftRecord | null>(null);
  const [legacyReviewing, setLegacyReviewing] = useState(false);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const legacyDismissedRef = useRef(false);
  const recoveryStore = useMemo(() => createMobileRecoveryDraftStore(), []);
  const recoverableSnapshotsRef = useRef(new Map<string, { fingerprint: string; record: ScopedRecoveryDraft; stored: Promise<boolean> }>());
  const lifetimeRef = useRef(true);
  const isCurrentRef = useRef(isAccountCurrent);
  useEffect(() => { isCurrentRef.current = isAccountCurrent; }, [isAccountCurrent]);
  const isEditorCurrent = () => lifetimeRef.current && isCurrentRef.current();
  useEffect(() => {
    lifetimeRef.current = true;
    return () => { lifetimeRef.current = false; if (newStepAutosaveTimerRef.current) window.clearTimeout(newStepAutosaveTimerRef.current); };
  }, []);
  const newStepIdRef = useRef<string | null>(null);
  const newStepTouchedRef = useRef(false);
  const plannerStateRef = useRef<PlannerState | null>(null);
  const selectedTaskIdRef = useRef("");
  const remoteRefreshTimerRef = useRef<number | null>(null);
  const remoteTaskRefreshTimerRef = useRef<number | null>(null);
  const pendingRemoteTaskIdsRef = useRef<Set<string>>(new Set());
  const pendingRemoteRefreshRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const hasDraftStepContentRef = useRef(hasDraftStepContent);
  const persistNewStepDraftRef = useRef(persistNewStepDraft);
  const requestRemotePlannerRefreshRef = useRef(requestRemotePlannerRefresh);
  const requestRemoteTaskRefreshRef = useRef(requestRemoteTaskRefresh);
  hasDraftStepContentRef.current = hasDraftStepContent;
  persistNewStepDraftRef.current = persistNewStepDraft;
  requestRemotePlannerRefreshRef.current = requestRemotePlannerRefresh;
  requestRemoteTaskRefreshRef.current = requestRemoteTaskRefresh;

  const derivedState = useMemo<PlannerState | null>(() => {
    if (!plannerState) {
      return null;
    }

    const calculated = applyCalculatedFields(plannerState.product, plannerState.stations, plannerState.tasks);
    return {
      ...plannerState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };
  }, [plannerState]);

  const zoneById = useMemo(() => {
    const map = new Map<string, string>();
    derivedState?.zones.forEach((zone) => map.set(zone.id, zone.name));
    return map;
  }, [derivedState]);

  const taskRows = useMemo(() => {
    if (!derivedState) {
      return [];
    }

    return getTopLevelTasks(derivedState.tasks)
      .filter((task) => task.rowType === "task")
      .sort(compareTasksByWbs);
  }, [derivedState]);
  const toolLibrary = useMemo(() => buildStepToolLibrary(taskRows), [taskRows]);

  const selectedTask = useMemo(() => {
    return taskRows.find((task) => task.id === selectedTaskId) ?? taskRows[0];
  }, [selectedTaskId, taskRows]);

  const selectedTaskSteps = useMemo(
    () => sortManufacturingSteps(selectedTask?.manufacturingSteps ?? []),
    [selectedTask],
  );
  const realtimeTaskIdSet = useMemo(
    () => new Set(plannerState?.tasks.map((task) => task.id) ?? []),
    [plannerState?.tasks],
  );
  // Keep the latest set readable from the (deliberately stable) realtime subscription without making
  // it a dependency -- otherwise the channel would tear down and re-subscribe on every task add/remove.
  const realtimeTaskIdSetRef = useRef(realtimeTaskIdSet);
  realtimeTaskIdSetRef.current = realtimeTaskIdSet;
  const visibleSelectedTaskSteps = useMemo(
    () =>
      showNewStepForm && newStepId
        ? selectedTaskSteps.filter((step) => step.id !== newStepId)
        : selectedTaskSteps,
    [newStepId, selectedTaskSteps, showNewStepForm],
  );
  const draftStepSequence = useMemo(() => {
    if (!selectedTask) {
      return 1;
    }

    if (newStepId) {
      const existingDraft = (selectedTask.manufacturingSteps ?? []).find((step) => step.id === newStepId);
      if (existingDraft) {
        return existingDraft.sequence;
      }
    }

    const steps = selectedTask.manufacturingSteps ?? [];
    if (steps.length === 0) {
      return 1;
    }

    return steps.reduce((highest, step) => Math.max(highest, step.sequence), 0) + 1;
  }, [newStepId, selectedTask]);
  const activeProjectContext = derivedState?.project ?? projectContext;
  const captureTimerElapsedMs = getCaptureTimerElapsed(captureTimer, timerNow);
  const captureTimerLapElapsedMs = getCaptureTimerLapElapsed(captureTimer, timerNow);
  const headerCaptureTimers = useMemo(() => {
    const entries = collectHeaderCaptureTimers(captureTimer, parkedCaptureByTaskId);

    return entries.sort((left, right) => {
      if (activeScreen === "detail") {
        if (left.taskId === selectedTaskId) {
          return -1;
        }
        if (right.taskId === selectedTaskId) {
          return 1;
        }
      }

      if (left.timer.running !== right.timer.running) {
        return left.timer.running ? -1 : 1;
      }

      return left.taskName.localeCompare(right.taskName);
    });
  }, [activeScreen, captureTimer, parkedCaptureByTaskId, selectedTaskId]);
  const viewingHeaderCapture = useMemo(
    () => headerCaptureTimers.find((entry) => activeScreen === "detail" && entry.taskId === selectedTaskId) ?? null,
    [activeScreen, headerCaptureTimers, selectedTaskId],
  );
  const isViewingCaptureTask = Boolean(viewingHeaderCapture?.timer.running);
  const canStartCaptureTimer = Boolean(
    selectedTask &&
      activeScreen === "detail" &&
      !(
        captureTimer.taskId === selectedTask.id &&
        captureTimer.activeStepId &&
        captureTimer.running
      ),
  );
  const isTimerOnSelectedTask = Boolean(
    selectedTask &&
      captureTimer.taskId === selectedTask.id &&
      captureTimer.activeStepId,
  );
  const hasRunningParkedTimers = useMemo(
    () => Object.values(parkedCaptureByTaskId).some((parked) => parked.timer.running),
    [parkedCaptureByTaskId],
  );

  useEffect(() => {
    plannerStateRef.current = plannerState;
  }, [plannerState]);

  useEffect(() => {
    if (saveState !== "loading") {
      onReady?.();
    }
  }, [saveState, onReady]);


  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    newStepIdRef.current = newStepId;
  }, [newStepId]);

  useEffect(() => {
    captureTimerRef.current = captureTimer;
  }, [captureTimer]);

  useEffect(() => {
    parkedCaptureByTaskIdRef.current = parkedCaptureByTaskId;
  }, [parkedCaptureByTaskId]);

  useEffect(() => {
    sessionHydratedRef.current = false;
  }, [projectId, userId]);

  useEffect(() => {
    if (!sessionHydratedRef.current) {
      sessionHydratedRef.current = true;
      const session = readMobileCaptureSession(projectId, userId);
      if (!session) {
        return;
      }

      if (session.selectedTaskId) {
        setSelectedTaskId(session.selectedTaskId);
        selectedTaskIdRef.current = session.selectedTaskId;
      }

      if (session.activeScreen === "detail") {
        setActiveScreen("detail");
      }

      if (session.showNewStepForm) {
        setShowNewStepForm(true);
      }

      if (session.newStepId) {
        setNewStepId(session.newStepId);
        setDraftStepId(session.newStepId);
        newStepIdRef.current = session.newStepId;
      }

      if (session.parkedCaptureByTaskId && Object.keys(session.parkedCaptureByTaskId).length > 0) {
        const now = Date.now();
        const restoredParked = Object.fromEntries(
          Object.entries(session.parkedCaptureByTaskId).map(([taskId, parked]) => [
            taskId,
            {
              ...parked,
              timer: parked.timer.running ? restoreRunningCaptureTimer(parked.timer, now) : parked.timer,
            },
          ]),
        );
        setParkedCaptureByTaskId(restoredParked);
        parkedCaptureByTaskIdRef.current = restoredParked;
      }

      if (session.captureTimer.running) {
        const now = Date.now();
        setCaptureTimer(restoreRunningCaptureTimer(session.captureTimer, now));
        setTimerNow(now);
      } else if (session.captureTimer.storedElapsedMs > 0 || session.captureTimer.activeStepId) {
        setCaptureTimer(session.captureTimer);
      }

      return;
    }

    writeMobileCaptureSession(
      projectId,
      buildMobileCaptureSessionSnapshot({
        captureTimer,
        parkedCaptureByTaskId,
        activeScreen,
        selectedTaskId,
        showNewStepForm,
        newStepId,
      }),
      Date.now(),
      userId,
    );
  }, [captureTimer, parkedCaptureByTaskId, activeScreen, selectedTaskId, showNewStepForm, newStepId, projectId, userId]);

  useEffect(() => {
    function flushSessionSnapshot() {
      if (!sessionHydratedRef.current) {
        return;
      }

      writeMobileCaptureSession(
        projectId,
        buildMobileCaptureSessionSnapshot({
          captureTimer: captureTimerRef.current,
          parkedCaptureByTaskId: parkedCaptureByTaskIdRef.current,
          activeScreen,
          selectedTaskId: selectedTaskIdRef.current,
          showNewStepForm,
          newStepId: newStepIdRef.current,
        }),
        Date.now(),
        userId,
      );
    }

    window.addEventListener("pagehide", flushSessionSnapshot);
    return () => window.removeEventListener("pagehide", flushSessionSnapshot);
  }, [activeScreen, showNewStepForm, projectId, userId]);

  useEffect(() => {
    if (!captureTimer.running && !hasRunningParkedTimers) {
      return undefined;
    }

    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [captureTimer.running, hasRunningParkedTimers]);

  useEffect(() => {
    mobileHeaderHeightRef.current = mobileHeaderHeight;
  }, [mobileHeaderHeight]);

  const getStepInstructionRef = useCallback((stepId: string) => {
    const callbacks = stepInstructionRefCallbacksRef.current;
    let callback = callbacks.get(stepId);

    if (!callback) {
      callback = (node: HTMLTextAreaElement | null) => {
        stepInstructionRefs.current[stepId] = node;

        if (node) {
          window.requestAnimationFrame(() => resizeTextareaToContent(node));
        }
      };
      callbacks.set(stepId, callback);
    }

    return callback;
  }, []);

  const handleMobileFieldFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    window.requestAnimationFrame(() => {
      ensureMobileFieldVisible(event.currentTarget, mobileHeaderHeightRef.current);
    });
  }, []);

  const handleStepInstructionFocus = useCallback((event: FocusEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    resizeTextareaToContent(textarea);
    window.requestAnimationFrame(() => {
      ensureMobileFieldVisible(textarea, mobileHeaderHeightRef.current);
    });
  }, []);

  const handleStepInstructionInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    resizeTextareaToContent(event.currentTarget);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlHeight: html.style.height,
      htmlMinHeight: html.style.minHeight,
      htmlOverflow: html.style.overflow,
      bodyHeight: body.style.height,
      bodyMinHeight: body.style.minHeight,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehaviorY: body.style.overscrollBehaviorY,
    };

    html.style.height = "auto";
    html.style.minHeight = "100%";
    html.style.overflow = "auto";
    body.style.height = "auto";
    body.style.minHeight = "100%";
    // Keep the document as the only scroller; a second body scroller can trap
    // touch scrolling and report the wrong bottom boundary on mobile browsers.
    body.style.overflow = "visible";
    body.style.overscrollBehaviorY = "auto";

    return () => {
      html.style.height = previous.htmlHeight;
      html.style.minHeight = previous.htmlMinHeight;
      html.style.overflow = previous.htmlOverflow;
      body.style.height = previous.bodyHeight;
      body.style.minHeight = previous.bodyMinHeight;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehaviorY = previous.bodyOverscrollBehaviorY;
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    let lastKeyboardGap = window.innerHeight - (viewport?.height ?? window.innerHeight);
    let settleTimer: number | null = null;

    function getMaxDocumentScrollTop() {
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      return Math.max(0, scrollHeight - viewportHeight);
    }

    function settleScrollAfterKeyboardClose() {
      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }

      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const maxScrollTop = getMaxDocumentScrollTop();

        if (window.scrollY > maxScrollTop + 2) {
          window.scrollTo({ top: maxScrollTop, behavior: "auto" });
        }
      }, 80);
    }

    function handleViewportResize() {
      const nextViewportHeight = viewport?.height ?? window.innerHeight;
      const keyboardGap = window.innerHeight - nextViewportHeight;
      const keyboardWasOpen = lastKeyboardGap > 120;
      const keyboardClosed = keyboardWasOpen && keyboardGap < 80;

      // Only settle after the on-screen keyboard closes. Address-bar hide/show also
      // grows the visual viewport and was incorrectly snapping long pages back upward.
      if (keyboardClosed) {
        settleScrollAfterKeyboardClose();
      }

      lastKeyboardGap = keyboardGap;
    }

    viewport?.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", settleScrollAfterKeyboardClose);

    return () => {
      viewport?.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", settleScrollAfterKeyboardClose);
      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }
    };
  }, []);

  useEffect(() => {
    const header = mobileHeaderRef.current;

    if (!header) {
      return undefined;
    }

    const headerElement = header;
    let frame = 0;
    const viewport = window.visualViewport;

    function measureHeader() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setMobileHeaderHeight(Math.ceil(headerElement.getBoundingClientRect().height));
      });
    }

    measureHeader();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureHeader);
    observer?.observe(headerElement);
    window.addEventListener("resize", measureHeader);
    viewport?.addEventListener("resize", measureHeader);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measureHeader);
      viewport?.removeEventListener("resize", measureHeader);
    };
  }, [saveState]);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (saveState === "saving" || saveState === "error" || hasLocalSaveWork()) {
        event.preventDefault();
        event.returnValue = "";
      }
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  });

  useEffect(() => {
    return () => {
      clearNewStepMotionTimers();
    };
  }, []);

  useEffect(() => {
    if (!showNewStepForm || !newStepId || writesPending || saveState === "saving" || saveState === "error" || newStepAutosaveTimerRef.current) return;
    const task = plannerState?.tasks.find((task) => task.id === selectedTaskId);
    const step = task?.manufacturingSteps?.find((step) => step.id === newStepId);
    if (!task || !step) return;
    draftBaseStepsRef.current.set(step.id, step);
    setNewStepName(step.name ?? "");
    setNewStepInstruction(step.instruction ?? "");
    setNewStepDurationText(String(step.durationMinutes ?? 0));
    const checks = getManufacturingStepCheckState(step.qualityCheck, stepCheckDefinitions);
    setNewStepDraftChecks(checks.selected);
    setNewStepDraftCheckValues(checks.values);
    setNewStepDraftTools(getStepToolList(task, step.id));
    setNewStepDraftPhotos(getStepPhotoAttachments(task, step.id));
  }, [plannerState, selectedTaskId, newStepId, showNewStepForm, writesPending, saveState, stepCheckDefinitions]);

  function hasLocalSaveWork() {
    return saveInFlightRef.current || Boolean(newStepAutosaveTimerRef.current) || failedDraftPatchesRef.current.size > 0 || failedDraftToolSyncRef.current.size > 0;
  }

  function refreshPlannerFromSupabase() {
    if (hasLocalSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    void loadPlannerStateFromSupabase(projectId)
      .then((savedState) => {
        if (!savedState || hasLocalSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        pendingRemoteRefreshRef.current = false;
        const firstTask = getTopLevelTasks(savedState.tasks)
          .filter((task) => task.rowType === "task")
          .sort(compareTasksByWbs)[0];
        setPlannerState(savedState);
        setSelectedTaskId((currentTaskId) =>
          savedState.tasks.some((task) => task.id === currentTaskId) ? currentTaskId : firstTask?.id ?? "",
        );
        setSaveState("saved");
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "Unable to refresh planner changes.");
        setSaveState("error");
      });
  }

  function requestRemotePlannerRefresh() {
    if (hasLocalSaveWork()) {
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

  // Targeted counterpart to refreshPlannerFromSupabase: re-fetch only the tasks a realtime change
  // touched (photos, tools, steps, parts, events) instead of reloading the whole scenario. This is
  // the hot path on the phone -- operators adding/removing photos -- so keeping it task-scoped avoids
  // re-downloading and re-signing every photo in the project on each change.
  // Mirrors line-workspace.tsx's refreshTasksFromSupabase; this copy uses a simpler wholesale task
  // replace (no procedure-draft merge). Keep the fetch/insert scaffold in sync.
  function refreshTasksFromSupabase(taskIds: string[]) {
    if (hasLocalSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    void Promise.all(taskIds.map((taskId) => loadTaskFromSupabase(taskId, projectId)))
      .then((latestTasks) => {
        if (hasLocalSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        const taskById = new Map(
          latestTasks.filter((task): task is Task => Boolean(task)).map((task) => [task.id, task]),
        );
        if (taskById.size === 0) {
          return;
        }

        setPlannerState((current) => {
          if (!current) {
            return current;
          }
          const existingTaskIds = new Set(current.tasks.map((task) => task.id));
          const insertedTasks = [...taskById.values()].filter((task) => !existingTaskIds.has(task.id));
          const mergedTasks = current.tasks.map((task) => taskById.get(task.id) ?? task);
          return { ...current, tasks: [...mergedTasks, ...insertedTasks] };
        });
        setSaveState("saved");
      })
      .catch(() => {
        requestRemotePlannerRefresh();
      });
  }

  // Identical to line-workspace.tsx's requestRemoteTaskRefresh (250ms debounce + per-task-id coalesce)
  // apart from the save-work guard -- keep the two in sync.
  function requestRemoteTaskRefresh(taskId: string) {
    if (hasLocalSaveWork()) {
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

  function flushDeferredRemoteRefresh() {
    if (!pendingRemoteRefreshRef.current || hasLocalSaveWork()) {
      return;
    }

    pendingRemoteRefreshRef.current = false;
    requestRemotePlannerRefresh();
  }

  function clearNewStepMotionTimers() {
    newStepMotionTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    newStepMotionTimersRef.current = [];
  }

  function queueNewStepMotionTimer(callback: () => void, delayMs: number) {
    const timerId = window.setTimeout(() => {
      newStepMotionTimersRef.current = newStepMotionTimersRef.current.filter((id) => id !== timerId);
      callback();
    }, delayMs);
    newStepMotionTimersRef.current.push(timerId);
  }

  function animateScrollToElement(element: HTMLElement, headerOffset: number, duration = 580) {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      element.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }

    const startY = window.scrollY;
    const targetY = element.getBoundingClientRect().top + window.scrollY - headerOffset;
    const distance = targetY - startY;

    if (Math.abs(distance) < 6) {
      return;
    }

    const startTime = performance.now();

    function easeOutCubic(progress: number) {
      return 1 - (1 - progress) ** 3;
    }

    function frame(now: number) {
      const progress = Math.min((now - startTime) / duration, 1);
      window.scrollTo(0, startY + distance * easeOutCubic(progress));

      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    }

    requestAnimationFrame(frame);
  }

  function scrollPortalToTop() {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToNewStepForm() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = newStepFormRef.current;
        if (!target) {
          return;
        }

        animateScrollToElement(target, mobileHeaderHeight + 12);

        queueNewStepMotionTimer(() => {
          newStepInstructionRef.current?.focus({ preventScroll: true });
        }, 460);
      });
    });
  }

  function beginNewStepEnterMotion(completedStepId: string | null, onReady: () => void) {
    if (newStepMotionPhase === "exit") {
      return;
    }

    clearNewStepMotionTimers();
    setRecentlyCompletedStepId(completedStepId);
    setNewStepMotionPhase("exit");

    queueNewStepMotionTimer(() => {
      onReady();
      setNewStepMotionPhase("enter");
      scrollToNewStepForm();

      queueNewStepMotionTimer(() => {
        setNewStepMotionPhase("idle");
      }, 560);
    }, 180);

    queueNewStepMotionTimer(() => {
      setRecentlyCompletedStepId(null);
    }, 1600);
  }

  // Ref-captured so the load effect keys on [projectId] alone (same pattern as
  // LineWorkspace's server seed).
  const initialPlannerStateRef = useRef(initialPlannerState);
  initialPlannerStateRef.current = initialPlannerState;
  const consumedInitialPlannerStateForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    // Server-fetched seed paints the capture list immediately; the remote load
    // below still runs and re-applies as the authority (also picking up any
    // changes between the server snapshot and now).
    const serverSeedState = initialPlannerStateRef.current;
    const currentProjectKey = projectId ?? "";
    if (
      serverSeedState &&
      consumedInitialPlannerStateForRef.current !== currentProjectKey &&
      String(serverSeedState.product.projectId ?? "") === currentProjectKey
    ) {
      consumedInitialPlannerStateForRef.current = currentProjectKey;
      applySavedState(serverSeedState);
    }

    function applySavedState(savedState: PlannerState) {
      const firstTask = getTopLevelTasks(savedState.tasks)
          .filter((task) => task.rowType === "task")
          .sort(compareTasksByWbs)[0];
        const session = readMobileCaptureSession(projectId, userId);
        const preferredTaskId = session?.selectedTaskId;
        const resolvedTaskId =
          preferredTaskId && savedState.tasks.some((task) => task.id === preferredTaskId)
            ? preferredTaskId
            : firstTask?.id ?? "";

        setPlannerState(savedState);
        setSelectedTaskId(resolvedTaskId);
        selectedTaskIdRef.current = resolvedTaskId;

        if (session?.parkedCaptureByTaskId && Object.keys(session.parkedCaptureByTaskId).length > 0) {
          const now = Date.now();
          const restoredParked = Object.fromEntries(
            Object.entries(session.parkedCaptureByTaskId).map(([taskId, parked]) => [
              taskId,
              {
                ...parked,
                timer: parked.timer.running ? restoreRunningCaptureTimer(parked.timer, now) : parked.timer,
              },
            ]),
          );
          setParkedCaptureByTaskId(restoredParked);
          parkedCaptureByTaskIdRef.current = restoredParked;
        }

        if (session?.activeScreen === "detail" && resolvedTaskId) {
          setActiveScreen("detail");
        }

        if (session?.showNewStepForm && resolvedTaskId === preferredTaskId) {
          setShowNewStepForm(true);
          const restoredStepId = session.newStepId ?? session.captureTimer.activeStepId;
          if (restoredStepId) {
            setNewStepId(restoredStepId);
            setDraftStepId(restoredStepId);
            newStepIdRef.current = restoredStepId;

            const restoredTask = savedState.tasks.find((task) => task.id === resolvedTaskId);
            const restoredStep = restoredTask?.manufacturingSteps?.find((step) => step.id === restoredStepId);
            if (restoredTask && restoredStep) {
              setNewStepName(restoredStep.name ?? "");
              draftBaseStepsRef.current.set(restoredStep.id, restoredStep);
              setNewStepInstruction(restoredStep.instruction ?? "");
              if ((restoredStep.durationMinutes ?? 0) > 0) {
                setNewStepDurationText(String(restoredStep.durationMinutes));
              }
              setNewStepDraftTools(getStepToolList(restoredTask, restoredStepId));
              setNewStepDraftPhotos(getStepPhotoAttachments(restoredTask, restoredStepId));
              setNewStepDraftChecks(getManufacturingStepCheckSet(restoredStep.qualityCheck, getManufacturingStepCheckDefinitions(savedState.product.customFields)));
              setNewStepDraftCheckValues(getManufacturingStepCheckState(restoredStep.qualityCheck, getManufacturingStepCheckDefinitions(savedState.product.customFields)).values);
              newStepTouchedRef.current = true;
            }
          }
        }

        setSaveState("idle");
    }

    loadPlannerStateFromSupabase(projectId)
      .then((savedState) => {
        if (!mounted) {
          return;
        }

        if (!savedState) {
          if (projectId) {
            setErrorMessage("Unable to load this project's line plan. Confirm you are signed in and have access.");
            setSaveState("error");
            return;
          }

          setPlannerState(emptyPlannerState);
          setSelectedTaskId(
            getTopLevelTasks(emptyPlannerState.tasks)
              .filter((task) => task.rowType === "task")
              .sort(compareTasksByWbs)[0]?.id ?? "",
          );
          setSaveState("idle");
          return;
        }

        applySavedState(savedState);
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Unable to load the saved planner.");
        setSaveState("error");
      });

    return () => {
      mounted = false;
    };
  }, [projectId, userId]);

  function restoreOwnedDraft(draft: ScopedRecoveryDraft) {
    if (!isEditorCurrent() || selectedTaskIdRef.current !== draft.taskId) return false;
    const snapshot = { stepId: draft.stepId, name: draft.name ?? "", instruction: draft.instruction, durationText: draft.durationText, tools: draft.tools, photos: draft.photos, checks: new Set(draft.checks), checkValues: draft.checkValues ?? {} };
    if (!hasDraftStepContentRef.current(snapshot)) return false; // Preserve even empty records.
    recoverableSnapshotsRef.current.set(draft.taskId, { fingerprint: draftFingerprint(snapshot), record: draft, stored: Promise.resolve(true) });
    setActiveScreen("detail"); setShowNewStepForm(true); setDraftStepId(draft.stepId);
    setNewStepName(draft.name ?? ""); setNewStepInstruction(draft.instruction);
    setNewStepDurationText(draft.durationText || "5"); setNewStepDraftTools(draft.tools);
    setNewStepDraftPhotos(draft.photos); setNewStepDraftChecks(snapshot.checks);
    setNewStepDraftCheckValues(snapshot.checkValues); newStepTouchedRef.current = true;
    setSaveState("saving");
    setErrorMessage("Recovered an unsaved phone draft. Saving it now; do not refresh until it shows Saved.");
    clearNewStepAutosaveTimer();
    newStepAutosaveTimerRef.current = window.setTimeout(() => {
      newStepAutosaveTimerRef.current = null;
      if (isEditorCurrent() && selectedTaskIdRef.current === draft.taskId)
        persistNewStepDraftRef.current(snapshot, { saveTask: true, showSaving: true });
    }, 250);
    return true;
  }
  const restoreOwnedDraftRef = useRef(restoreOwnedDraft);
  useEffect(() => { restoreOwnedDraftRef.current = restoreOwnedDraft; });
  const plannerLoaded = Boolean(plannerState);
  useEffect(() => {
    if (!plannerLoaded || !userId || !projectId || !selectedTaskId || !plannerStateRef.current?.tasks.some((task) => task.id === selectedTaskId)) return;
    let active = true;
    void recoveryStore.load({ userId, projectId, taskId: selectedTaskId }).then((draft) => {
      if (active && draft && isCurrentRef.current() && !newStepTouchedRef.current) restoreOwnedDraftRef.current(draft);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [plannerLoaded, selectedTaskId, userId, projectId, recoveryStore]);

  useEffect(() => {
    if (!plannerLoaded || !userId || !projectId || !selectedTaskId || legacyDismissedRef.current) return;
    let active = true;
    void loadMobileNewStepRecoveryDraft().then((draft) => {
      if (!active || !isCurrentRef.current()) return;
      setLegacyDraft(draft && isMobileRecoveryPayload(draft) && draft.taskId === selectedTaskId
        && plannerStateRef.current?.tasks.some((task) => task.id === draft.taskId) ? draft : null);
      setLegacyReviewing(false);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [plannerLoaded, selectedTaskId, userId, projectId]);

  async function adoptReviewedLegacyDraft() {
    if (!legacyDraft || !userId || !projectId || legacyBusy || (showNewStepForm && hasDraftStepContent(getNewStepDraftSnapshot()))) return;
    const taskId = selectedTaskId;
    const touchedBefore = newStepTouchedRef.current;
    const snapshotBefore = recoverableSnapshotsRef.current.get(taskId);
    setLegacyBusy(true);
    try {
      const draft = await recoveryStore.adoptLegacy({ userId, projectId, taskId }, legacyDraft);
      if (!isEditorCurrent() || selectedTaskIdRef.current !== taskId) return;
      if (newStepTouchedRef.current !== touchedBefore || recoverableSnapshotsRef.current.get(taskId) !== snapshotBefore) {
        setErrorMessage("The earlier draft is stored safely. Finish your current draft before reopening it."); return;
      }
      setLegacyDraft(null); legacyDismissedRef.current = true;
      restoreOwnedDraft(draft);
    } catch (error) {
      if (isEditorCurrent()) setErrorMessage(error instanceof Error ? error.message : "Unable to use the earlier draft.");
    } finally { if (isEditorCurrent()) setLegacyBusy(false); }
  }

  useEffect(() => {
    if (!plannerState?.scenario.id) {
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
        productId: plannerState.product.id,
        scenarioId: plannerState.scenario.id,
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
      // Drop task ids queued for the scenario we're leaving so a same-project scenario switch can't
      // refresh them into the next scenario's task list.
      pendingRemoteTaskIds.clear();
      unsubscribe();
    };
  }, [plannerState?.product.id, plannerState?.scenario.id]);

  function refreshWriteLock() {
    if (!isEditorCurrent()) return;
    saveInFlightRef.current =
      localWriteCountRef.current > 0 || Object.keys(photoUploadQueuesRef.current).length > 0;
    setWritesPending(saveInFlightRef.current);
  }

  function beginLocalWrite() {
    localWriteCountRef.current += 1;
    refreshWriteLock();
  }

  function endLocalWrite() {
    localWriteCountRef.current = Math.max(0, localWriteCountRef.current - 1);
    refreshWriteLock();
    flushDeferredRemoteRefresh();
  }

  function updateStepPhotoUploadCount(stepId: string, delta: number) {
    setPhotoUploadCounts((currentCounts) => {
      const nextCount = Math.max(0, (currentCounts[stepId] ?? 0) + delta);
      const nextCounts = { ...currentCounts };

      if (nextCount > 0) {
        nextCounts[stepId] = nextCount;
      } else {
        delete nextCounts[stepId];
      }

      return nextCounts;
    });
  }

  function updateLocalTask(taskId: string, updateTask: (task: Task) => Task, shouldReschedule = false) {
    setPlannerState((currentState) => {
      if (!currentState) {
        return currentState;
      }

      const currentTask = currentState.tasks.find((task) => task.id === taskId);
      if (!currentTask) {
        return currentState;
      }

      const nextState = withUpdatedTask(currentState, updateTask(currentTask), shouldReschedule);
      plannerStateRef.current = nextState;
      return nextState;
    });
  }

  function enqueueTaskScopedWrite(taskId: string, saveOperation: () => Promise<void>) {
    const previousWrite = photoUploadQueuesRef.current[taskId] ?? Promise.resolve();
    const nextWrite = previousWrite.catch(() => undefined).then(() => {
      if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
      return saveOperation();
    });
    photoUploadQueuesRef.current[taskId] = nextWrite;
    refreshWriteLock();

    void nextWrite.catch(() => undefined).finally(() => {
      if (photoUploadQueuesRef.current[taskId] === nextWrite) {
        delete photoUploadQueuesRef.current[taskId];
      }
      refreshWriteLock();
    });

    return nextWrite;
  }

  function clearNewStepAutosaveTimer() {
    if (newStepAutosaveTimerRef.current) {
      window.clearTimeout(newStepAutosaveTimerRef.current);
      newStepAutosaveTimerRef.current = null;
    }
  }

  function buildNewStepId(taskId: string) {
    return `step-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function setDraftStepId(stepId: string | null) {
    newStepIdRef.current = stepId;
    setNewStepId(stepId);
  }

  function ensureDraftStepId(taskId: string) {
    if (newStepIdRef.current) {
      return newStepIdRef.current;
    }

    const stepId = buildNewStepId(taskId);
    setDraftStepId(stepId);
    return stepId;
  }

  function hasDraftStepContent(snapshot: ReturnType<typeof getNewStepDraftSnapshot>) {
    return (
      snapshot.name.trim().length > 0 ||
      snapshot.instruction.trim().length > 0 ||
      snapshot.tools.length > 0 ||
      snapshot.photos.length > 0 ||
      snapshot.checks.size > 0
    );
  }

  function getNewStepDraftSnapshot(overrides: Partial<{
    stepId: string | null;
    name: string;
    instruction: string;
    durationText: string;
    tools: string[];
    photos: StepPhotoAttachment[];
    checks: Set<string>;
    checkValues: Record<string, ManufacturingStepCheckValue>;
  }> = {}) {
    return {
      stepId: overrides.stepId ?? newStepIdRef.current ?? newStepId,
      name: overrides.name ?? newStepName,
      instruction: overrides.instruction ?? newStepInstruction,
      durationText: overrides.durationText ?? newStepDurationText,
      tools: overrides.tools ?? newStepDraftTools,
      photos: overrides.photos ?? newStepDraftPhotos,
      checks: overrides.checks ?? newStepDraftChecks,
      checkValues: overrides.checkValues ?? newStepDraftCheckValues,
    };
  }

  function assertCaptureCurrent() {
    if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
  }

  function draftFingerprint(snapshot: ReturnType<typeof getNewStepDraftSnapshot>) {
    return JSON.stringify({ stepId: snapshot.stepId, name: snapshot.name, instruction: snapshot.instruction, durationText: snapshot.durationText, tools: snapshot.tools, photos: snapshot.photos, checks: [...snapshot.checks], checkValues: snapshot.checkValues });
  }

  function saveRecoverableNewStepDraft(snapshot = getNewStepDraftSnapshot(), options: { taskId?: string } = {}) {
    const taskId = options.taskId ?? selectedTaskIdRef.current;
    if (!isEditorCurrent() || !taskId || !snapshot.stepId || !hasDraftStepContent(snapshot)) return null;
    if (!userId || !projectId) {
      setErrorMessage("This browser could not store the local recovery draft. Copy text/photos before refreshing.");
      return null;
    }
    const fingerprint = draftFingerprint(snapshot);
    const previous = recoverableSnapshotsRef.current.get(taskId);
    if (previous?.fingerprint === fingerprint) return previous;
    const scope = { userId, projectId, taskId };
    const record: ScopedRecoveryDraft = { ...snapshot, ...scope, key: recoveryDraftKey(scope), schemaVersion: 2,
      draftId: snapshot.stepId, checks: [...snapshot.checks], writeToken: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    const stored = recoveryStore.save(record).then(() => true).catch(() => {
      if (isEditorCurrent()) setErrorMessage("This browser could not store the local recovery draft. Copy text/photos before refreshing.");
      return false;
    });
    const pending = { fingerprint, record, stored };
    recoverableSnapshotsRef.current.set(taskId, pending);
    return pending;
  }

  function persistNewStepDraft(
    snapshot = getNewStepDraftSnapshot(),
    options: { saveTask?: boolean; showSaving?: boolean; onSaved?: () => void } = {},
  ) {
    clearNewStepAutosaveTimer();
    const currentState = plannerStateRef.current;
    const taskId = selectedTaskIdRef.current;

    if (!isEditorCurrent() || !currentState || !taskId) {
      return null;
    }

    const currentTask = currentState.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      return null;
    }

    const recovery = saveRecoverableNewStepDraft(snapshot, { taskId });

    const currentSteps = sortManufacturingSteps(currentTask.manufacturingSteps ?? []);
    const stepId = snapshot.stepId ?? ensureDraftStepId(currentTask.id);
    const existingStep = currentSteps.find((step) => step.id === stepId);
    const sequence = existingStep?.sequence ?? currentSteps.reduce((highest, step) => Math.max(highest, step.sequence), 0) + 1;
    const durationMinutes = Math.max(Number.parseFloat(snapshot.durationText) || 0, 0);
    const nextStep: ManufacturingStep = {
      ...existingStep,
      id: stepId,
      sequence,
      name: snapshot.name.trim(),
      instruction: snapshot.instruction.trim(),
      durationMinutes,
      qualityCheck: serializeManufacturingStepCheckState({ selected: snapshot.checks, values: snapshot.checkValues }, stepCheckDefinitions),
    };
    const nextSteps = existingStep
      ? currentSteps.map((step) => (step.id === stepId ? nextStep : step))
      : [...currentSteps, nextStep];
    let nextTask = withStepDerivedDuration(currentTask, nextSteps);
    nextTask = upsertStepPhotoAttachments(nextTask, stepId, snapshot.photos);
    nextTask = snapshot.tools.reduce((taskWithTools, tool) => addStepTool(taskWithTools, stepId, tool), nextTask);
    const nextState = withUpdatedTask(currentState, nextTask, false);

    plannerStateRef.current = nextState;
    setPlannerState(nextState);
    setDraftStepId(stepId);
    setErrorMessage(null);

    if (options.showSaving) {
      setSaveState("saving");
    }

    const baseStep = draftBaseStepsRef.current.get(stepId) ?? existingStep;
    const patch: Partial<ManufacturingStep> = { ...failedDraftPatchesRef.current.get(stepId) };
    for (const key of ["name", "instruction", "durationMinutes", "qualityCheck"] as const) {
      if (!baseStep || baseStep[key] !== nextStep[key]) Object.assign(patch, { [key]: nextStep[key] });
    }
    draftBaseStepsRef.current.set(stepId, nextStep);
    const syncTools = !baseStep || JSON.stringify(snapshot.tools) !== JSON.stringify(getStepToolList(currentTask, stepId));
    beginLocalWrite();

    void enqueueTaskScopedWrite(taskId, async () => {
      Object.assign(patch, { ...failedDraftPatchesRef.current.get(stepId), ...patch });
      if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
      const savedStep = await saveMobileStepToSupabase(currentTask, nextStep, patch, projectId, undefined, assertCaptureCurrent);
      if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
      if (syncTools || failedDraftToolSyncRef.current.has(stepId)) {
        await syncStepToolsForStepToSupabase(taskId, stepId, snapshot.tools, projectId, assertCaptureCurrent);
        if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
        failedDraftToolSyncRef.current.delete(stepId);
      }
      const uploadedPhotos = await Promise.all(
        snapshot.photos.map((photo) => {
          if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
          return uploadStepPhotoAttachment(taskId, stepId, photo, activeProjectContext, assertCaptureCurrent);
        }),
      );
      if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
      updateLocalTask(taskId, (task) => {
        const steps = (task.manufacturingSteps ?? []).map((step) => step.id === stepId ? { ...step, sequence: savedStep.sequence, version: savedStep.version } : step);
        return upsertStepPhotoAttachments(withStepDerivedDuration(task, steps), stepId, uploadedPhotos);
      });
      failedDraftPatchesRef.current.delete(stepId);
    })
      .then(() => {
        if (recovery) void recovery.stored.then((stored) => stored ? recoveryStore.acknowledge(recovery.record) : false).then((cleared) => {
          if (cleared && recoverableSnapshotsRef.current.get(taskId) === recovery) recoverableSnapshotsRef.current.delete(taskId);
        }).catch(() => undefined);
        if (!isEditorCurrent()) return;
        setSaveState("saved");
        if (selectedTaskIdRef.current === taskId && newStepIdRef.current === stepId) options.onSaved?.();
      })
      .catch((error) => {
        if (!isEditorCurrent()) return;
        if (syncTools) failedDraftToolSyncRef.current.add(stepId);
        failedDraftPatchesRef.current.set(stepId, { ...failedDraftPatchesRef.current.get(stepId), ...patch });
        setSaveState("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to autosave the manufacturing step.");
      })
      .finally(() => {
        if (isEditorCurrent()) endLocalWrite();
      });

    return stepId;
  }

  function scheduleNewStepAutosave(overrides: Parameters<typeof getNewStepDraftSnapshot>[0] = {}) {
    if (!isEditorCurrent()) return;
    clearNewStepAutosaveTimer();
    const taskId = selectedTaskIdRef.current;
    const stepId = taskId ? ensureDraftStepId(taskId) : overrides.stepId ?? newStepIdRef.current;
    newStepTouchedRef.current = true;
    const snapshot = getNewStepDraftSnapshot({ ...overrides, stepId });
    saveRecoverableNewStepDraft(snapshot);
    setSaveState("saving");
    newStepAutosaveTimerRef.current = window.setTimeout(() => {
      newStepAutosaveTimerRef.current = null;
      persistNewStepDraft(snapshot, { saveTask: overrides.durationText !== undefined, showSaving: true });
    }, 450);
  }

  async function persistTargetedState(nextState: PlannerState, saveOperation: () => Promise<void>) {
    plannerStateRef.current = nextState;
    setPlannerState(nextState);
    setSaveState("saving");
    setErrorMessage(null);
    beginLocalWrite();

    try {
      await saveOperation();
      setSaveState("saved");
      return true;
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save step photos.");
      return false;
    } finally {
      endLocalWrite();
    }
  }

  async function restoreDeletedSnapshot(snapshot: PlannerState, selectedTaskIdToRestore: string, restoreScreen: "list" | "detail" = "detail") {
    setRestorePrompt(null);
    plannerStateRef.current = snapshot;
    setPlannerState(snapshot);
    setSelectedTaskId(selectedTaskIdToRestore);
    setActiveScreen(restoreScreen);
    setErrorMessage(null);
    setSaveState("saving");
    beginLocalWrite();

    try {
      await savePlannerStateToSupabase(snapshot);
      const photoRestores = snapshot.tasks.flatMap((task) =>
        (task.manufacturingSteps ?? []).flatMap((step) =>
          getStepPhotoAttachments(task, step.id).map((photo) =>
            uploadStepPhotoAttachment(task.id, step.id, photo, activeProjectContext),
          ),
        ),
      );
      if (photoRestores.length) {
        await Promise.allSettled(photoRestores);
      }
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to restore the deleted item.");
    } finally {
      endLocalWrite();
    }
  }

  async function restoreDeletedPhoto(taskId: string, stepId: string, photo: StepPhotoAttachment) {
    setRestorePrompt(null);
    updateLocalTask(taskId, (task) => upsertStepPhotoAttachments(task, stepId, [photo]));
    setErrorMessage(null);
    setSaveState("saving");
    beginLocalWrite();

    try {
      await uploadStepPhotoAttachment(taskId, stepId, photo, activeProjectContext);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to restore the selected photo.");
    } finally {
      endLocalWrite();
    }
  }

  async function updateTask(taskId: string, patch: Partial<Task>, shouldReschedule = false) {
    if (!plannerState) {
      return;
    }

    const currentTask = plannerState.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      return;
    }

    const nextState = withUpdatedTask(plannerState, { ...currentTask, ...patch }, shouldReschedule);
    const persistedTask = nextState.tasks.find((task) => task.id === taskId) ?? { ...currentTask, ...patch };
    await persistTargetedState(nextState, () => saveTaskToSupabase(persistedTask, projectId));
  }

  async function addHighLevelTask() {
    if (!plannerState) {
      return;
    }

    const name = newTaskName.trim();
    if (!name) {
      setErrorMessage("Add a process name before saving.");
      setSaveState("error");
      return;
    }

    const currentTasks = plannerState.tasks;
    const zoneId = newTaskZoneId || undefined;
    const componentId = newTaskComponentId || undefined;
    const taskNumber = componentId ? nextTaskNumberForComponent(currentTasks, componentId, zoneId) : undefined;
    const zoneTasks = taskRows.filter((task) => (zoneId ? task.zoneId === zoneId : !task.zoneId));
    const contextTask = zoneTasks[zoneTasks.length - 1] ?? taskRows[taskRows.length - 1] ?? selectedTask ?? currentTasks[currentTasks.length - 1];
    const fallbackStart = currentTasks[0]?.plannedStart ?? new Date().toISOString();
    const start = contextTask?.plannedFinish ?? fallbackStart;
    const taskDraft: Task = {
      id: `task-${Date.now()}`,
      scenarioId: plannerState.scenario.id,
      stationId: zoneId ? stationIdForZone(zoneId) : contextTask?.stationId ?? plannerState.stations[0]?.id ?? "",
      zoneId,
      componentId,
      taskNumber,
      rowType: "task",
      wbs: getNextTopLevelWbs(currentTasks),
      name,
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
    const manufacturingCode = generateTaskCode(taskDraft, plannerState.zones, plannerState.components);
    const newTask: Task = {
      ...taskDraft,
      manufacturingCode: manufacturingCode || undefined,
      codeGeneratedAt: manufacturingCode ? new Date().toISOString() : undefined,
    };
    const nextState: PlannerState = {
      ...plannerState,
      product: {
        ...plannerState.product,
        updatedAt: new Date().toISOString(),
      },
      scenario: {
        ...plannerState.scenario,
        updatedAt: new Date().toISOString(),
      },
      tasks: [...plannerState.tasks, newTask],
    };

    const saved = await persistTargetedState(nextState, () => enqueueTaskScopedWrite(newTask.id, () => saveTaskToSupabase(newTask, projectId)));
    if (!saved) {
      setPlannerState((state) => state ? { ...state, tasks: state.tasks.filter((task) => task.id !== newTask.id) } : state);
      return;
    }
    selectedTaskIdRef.current = newTask.id;
    setSelectedTaskId(newTask.id);
    setNewTaskName("");
    setNewTaskZoneId("");
    setNewTaskComponentId("");
    setShowNewTaskForm(false);
    setActiveScreen("detail");
    scrollPortalToTop();
  }

  async function persistHighLevelTaskReorder(
    taskId: string,
    targetTaskId: string,
    placement: "before" | "after",
  ) {
    if (!plannerState) {
      return;
    }

    if (taskId === targetTaskId) {
      return;
    }

    const sourceTaskIdSet = new Set([taskId]);
    const targetTaskIdSet = new Set([targetTaskId]);
    const grouped = new Map<string, Task[]>();

    plannerState.tasks.forEach((task) => {
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
      .sort((left, right) => Number.parseFloat(left.processNumber) - Number.parseFloat(right.processNumber));

    const sourceGroup = groups.find((group) => group.isSource);
    const targetGroup = groups.find((group) => group.isTarget);

    if (!sourceGroup || !targetGroup || sourceGroup.processNumber === targetGroup.processNumber) {
      return;
    }

    const remainingGroups = groups.filter((group) => group !== sourceGroup);
    const targetGroupIndex = remainingGroups.findIndex((group) => group === targetGroup);
    const insertIndex = targetGroupIndex < 0 ? remainingGroups.length : targetGroupIndex + (placement === "after" ? 1 : 0);
    const orderedGroups = [
      ...remainingGroups.slice(0, insertIndex),
      sourceGroup,
      ...remainingGroups.slice(insertIndex),
    ];
    const targetZoneId = targetGroup.tasks.find((task) => task.wbs === targetGroup.processNumber)?.zoneId ?? targetGroup.tasks.find((task) => task.zoneId)?.zoneId;
    const reorderedTasks = orderedGroups.flatMap((group, groupIndex) => {
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
      product: {
        ...plannerState.product,
        updatedAt: new Date().toISOString(),
      },
      scenario: {
        ...plannerState.scenario,
        updatedAt: new Date().toISOString(),
      },
      tasks: plannerState.tasks.map((task) => reorderedTasks.find((candidate) => candidate.id === task.id) ?? task),
    };

    setSelectedTaskId(taskId);
    await persistTargetedState(nextState, async () => {
      const token = Date.now().toString(36);
      await saveTasksToSupabase(changedTasks.map((task, index) => ({ ...task, wbs: `tmp-${token}-${index + 1}` })), projectId);
      await saveTasksToSupabase(changedTasks, projectId);
    });
  }

  function clearTaskDragState() {
    draggingTaskIdRef.current = null;
    dragTargetTaskIdRef.current = null;
    dragTargetPlacementRef.current = "after";
    setDraggingTaskId(null);
    setDragTargetTaskId(null);
    setDragTargetPlacement("after");
    setDragPreview(null);
  }

  function updateTaskDragTarget(clientX: number, clientY: number, sourceTaskId: string) {
    const targetElement = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-mobile-task-id]");
    const targetTaskId = targetElement?.dataset.mobileTaskId;

    if (!targetTaskId || targetTaskId === sourceTaskId) {
      dragTargetTaskIdRef.current = null;
      setDragTargetTaskId(null);
      return;
    }

    const targetBounds = targetElement.getBoundingClientRect();
    const lockedPlacement = targetElement.dataset.dropPlacement;
    const placement =
      lockedPlacement === "before" || lockedPlacement === "after"
        ? lockedPlacement
        : clientY < targetBounds.top + targetBounds.height / 2
          ? "before"
          : "after";
    dragTargetTaskIdRef.current = targetTaskId;
    dragTargetPlacementRef.current = placement;
    setDragTargetTaskId(targetTaskId);
    setDragTargetPlacement(placement);
  }

  function startTaskDrag(event: ReactPointerEvent<HTMLButtonElement>, taskId: string) {
    if (saveState === "saving") {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const taskElement = event.currentTarget.closest<HTMLElement>("[data-mobile-task-id]");
    const taskBounds = taskElement?.getBoundingClientRect();
    draggingTaskIdRef.current = taskId;
    dragTargetTaskIdRef.current = null;
    dragTargetPlacementRef.current = "after";
    setDraggingTaskId(taskId);
    setDragTargetTaskId(null);
    setDragTargetPlacement("after");
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      width: taskBounds?.width ?? 320,
    });
  }

  function moveTaskDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const sourceTaskId = draggingTaskIdRef.current;

    if (!sourceTaskId) {
      return;
    }

    event.preventDefault();
    setDragPreview((current) => ({
      x: event.clientX,
      y: event.clientY,
      width: current?.width ?? 320,
    }));
    updateTaskDragTarget(event.clientX, event.clientY, sourceTaskId);
  }

  function cancelTaskDrag() {
    clearTaskDragState();
  }

  function finishTaskDrag() {
    const sourceTaskId = draggingTaskIdRef.current;
    const targetTaskId = dragTargetTaskIdRef.current;
    const placement = dragTargetPlacementRef.current;

    clearTaskDragState();

    if (!sourceTaskId || !targetTaskId) {
      return;
    }

    void persistHighLevelTaskReorder(sourceTaskId, targetTaskId, placement);
  }

  async function handlePhotoFiles(stepId: string, files: File[]) {
    if (!plannerState || !selectedTask || files.length === 0) {
      return;
    }

    const taskId = selectedTask.id;
    let localPhotos: StepPhotoAttachment[] = [];
    updateStepPhotoUploadCount(stepId, 1);
    setErrorMessage(null);
    beginLocalWrite();

    try {
      localPhotos = await Promise.all(files.map(buildPhotoAttachment));
      updateLocalTask(taskId, (task) => upsertStepPhotoAttachments(task, stepId, localPhotos));

      const uploadedPhotos = await Promise.all(
        localPhotos.map((photo) => uploadStepPhotoAttachment(taskId, stepId, photo, activeProjectContext)),
      );
      updateLocalTask(taskId, (task) => upsertStepPhotoAttachments(task, stepId, uploadedPhotos));

      setSaveState("saved");
    } catch (error) {
      if (localPhotos.length > 0) {
        updateLocalTask(taskId, (task) =>
          localPhotos.reduce(
            (taskWithoutFailedPhoto, photo) => removeStepPhotoAttachment(taskWithoutFailedPhoto, stepId, photo.id),
            task,
          ),
        );
      }
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to attach the selected photo.");
    } finally {
      updateStepPhotoUploadCount(stepId, -1);
      endLocalWrite();
    }
  }

  async function removePhoto(stepId: string, photoId: string) {
    if (!plannerState || !selectedTask) {
      return;
    }

    const taskId = selectedTask.id;
    const currentTask = plannerState.tasks.find((task) => task.id === selectedTask.id) ?? selectedTask;
    const removedPhoto = getStepPhotoAttachments(currentTask, stepId).find((photo) => photo.id === photoId);
    updateLocalTask(taskId, (task) => removeStepPhotoAttachment(task, stepId, photoId));
    beginLocalWrite();

    try {
      await softDeleteStepPhotoAttachmentFromSupabase(photoId, taskId, projectId);

      setSaveState("saved");
      if (removedPhoto) {
        setRestorePrompt({
          title: "Deleted photo",
          body: "Restore will attach this photo back to the same manufacturing step.",
          restoreLabel: "Restore Photo",
          onRestore: () => restoreDeletedPhoto(taskId, stepId, removedPhoto),
        });
      }
    } catch (error) {
      if (removedPhoto) {
        updateLocalTask(taskId, (task) => upsertStepPhotoAttachments(task, stepId, [removedPhoto]));
      }
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to remove the selected photo.");
    } finally {
      endLocalWrite();
    }
  }

  function requestRemovePhoto(stepId: string, photo: StepPhotoAttachment) {
    setConfirmPrompt({
      title: "Delete photo?",
      body: "This removes the photo from the shared step record.",
      confirmLabel: "Delete Photo",
      onConfirm: async () => {
        setConfirmPrompt(null);
        await removePhoto(stepId, photo.id);
      },
    });
  }

  async function addManufacturingStepToolFromLibrary(stepId: string, toolName: string) {
    if (!toolName) {
      return;
    }

    setNewStepToolNames((current) => ({ ...current, [stepId]: toolName }));
    const taskId = selectedTask?.id;
    if (!taskId) {
      return;
    }

    updateLocalTask(taskId, (task) => addStepTool(task, stepId, toolName));
    beginLocalWrite();

    try {
      await enqueueTaskScopedWrite(taskId, async () => {
        await addStepToolToSupabase(taskId, stepId, toolName, getStepToolList(selectedTask, stepId).length + 1, projectId);
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to add the tool.");
    } finally {
      setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
      endLocalWrite();
    }
  }

  async function removeManufacturingStepTool(stepId: string, toolToRemove: string) {
    if (!plannerState || !selectedTask) {
      return;
    }

    const taskId = selectedTask.id;
    updateLocalTask(taskId, (task) => removeStepTool(task, stepId, toolToRemove));
    beginLocalWrite();

    try {
      await enqueueTaskScopedWrite(taskId, async () => {
        await removeStepToolFromSupabase(stepId, toolToRemove, selectedTask.id, projectId);
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to remove the tool.");
    } finally {
      endLocalWrite();
    }
  }

  async function retryFailedStepSaves() {
    setSaveState("saving");
    setErrorMessage(null);
    beginLocalWrite();
    try {
      for (const [stepId, patch] of failedDraftPatchesRef.current) {
        const task = plannerStateRef.current?.tasks.find((task) => task.manufacturingSteps?.some((step) => step.id === stepId));
        const step = task?.manufacturingSteps?.find((step) => step.id === stepId);
        if (!task || !step) throw new Error("The process is no longer available. Your draft has been kept.");
        await enqueueTaskScopedWrite(task.id, async () => {
          const savedStep = await saveMobileStepToSupabase(task, step, patch, projectId, undefined, assertCaptureCurrent);
          if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
          if (failedDraftToolSyncRef.current.has(stepId)) {
            await syncStepToolsForStepToSupabase(task.id, stepId, getStepToolList(task, stepId), projectId, assertCaptureCurrent);
            if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
            failedDraftToolSyncRef.current.delete(stepId);
          }
          const photos = await Promise.all(getStepPhotoAttachments(task, stepId).map((photo) => uploadStepPhotoAttachment(task.id, stepId, photo, activeProjectContext, assertCaptureCurrent)));
          if (!isEditorCurrent()) throw new Error("Capture account changed; draft retained.");
          updateLocalTask(task.id, (current) => upsertStepPhotoAttachments({ ...current, manufacturingSteps: current.manufacturingSteps?.map((local) => local.id === stepId ? { ...local, version: savedStep.version, sequence: savedStep.sequence } : local) }, stepId, photos));
          failedDraftPatchesRef.current.delete(stepId);
        });
      }
      if (isEditorCurrent()) setSaveState("saved");
    } catch (error) {
      if (!isEditorCurrent()) return;
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save. Your draft has been kept.");
    } finally {
      if (isEditorCurrent()) endLocalWrite();
    }
  }

  async function updateManufacturingStep(stepId: string, patch: Partial<ManufacturingStep>) {
    if (!plannerState || !selectedTask) {
      return;
    }

    await updateManufacturingStepOnTask(selectedTask.id, stepId, patch);
  }

  async function updateManufacturingStepOnTask(taskId: string, stepId: string, patch: Partial<ManufacturingStep>) {
    if (!plannerState) {
      return;
    }

    const currentTask = plannerState.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      return;
    }

    const nextSteps = sortManufacturingSteps(currentTask.manufacturingSteps ?? []).map((step) =>
      step.id === stepId ? { ...step, ...patch } : step,
    );
    const nextTask = withStepDerivedDuration(currentTask, nextSteps);
    const nextStep = nextSteps.find((step) => step.id === stepId);
    if (!nextStep) return;
    await persistTargetedState(withUpdatedTask(plannerState, nextTask, false), () =>
      enqueueTaskScopedWrite(taskId, async () => {
        const pendingPatch = { ...failedDraftPatchesRef.current.get(stepId), ...patch };
        try {
          await saveMobileStepToSupabase(currentTask, nextStep, pendingPatch, projectId);
          failedDraftPatchesRef.current.delete(stepId);
        } catch (error) {
          failedDraftPatchesRef.current.set(stepId, pendingPatch);
          throw error;
        }
      }),
    );
  }

  function applyLapForTimerState(timer: CaptureTimerState, now = Date.now()) {
    if (!timer.running || !timer.activeStepId || !timer.taskId) {
      return null;
    }

    const lapMinutes = elapsedMinutesFromTimer(getCaptureTimerLapElapsed(timer, now));
    if (!lapMinutes) {
      return null;
    }

    const taskId = timer.taskId;
    const stepId = timer.activeStepId;

    if (selectedTaskIdRef.current === taskId && newStepIdRef.current === stepId) {
      const snapshot = getNewStepDraftSnapshot({ stepId, durationText: String(lapMinutes) });
      if (selectedTaskIdRef.current === taskId) {
        setNewStepDurationText(snapshot.durationText);
        newStepTouchedRef.current = true;
      }
      persistNewStepDraft(snapshot, { saveTask: true, showSaving: true });
      return snapshot;
    }

    const task = plannerStateRef.current?.tasks.find((candidate) => candidate.id === taskId);
    if (task?.manufacturingSteps?.some((step) => step.id === stepId)) {
      void updateManufacturingStepOnTask(taskId, stepId, { durationMinutes: lapMinutes });
      return { stepId, durationText: String(lapMinutes) };
    }

    return null;
  }

  function hasTimedCaptureForTask(taskId: string) {
    const timer = captureTimerRef.current;
    if (timer.taskId === taskId && timer.activeStepId) {
      return true;
    }

    return Boolean(parkedCaptureByTaskIdRef.current[taskId]?.timer.activeStepId);
  }

  function shouldPreserveTimedStepDraft(taskId = selectedTaskIdRef.current) {
    return hasTimedCaptureForTask(taskId);
  }

  function buildParkedTaskCaptureState(taskId: string): ParkedTaskCaptureState | null {
    const timer = captureTimerRef.current;
    if (timer.taskId !== taskId || !timer.activeStepId) {
      return null;
    }

    const snapshot = getNewStepDraftSnapshot({ stepId: timer.activeStepId });
    const now = Date.now();
    return {
      timer: timer.running ? preserveRunningCaptureTimer(timer, now) : freezeCaptureTimer(timer, now),
      showNewStepForm: true,
      newStepId: snapshot.stepId,
      draftName: snapshot.name,
      draftInstruction: snapshot.instruction,
      draftDurationText: snapshot.durationText,
      draftTools: snapshot.tools,
      draftPhotos: snapshot.photos,
      draftChecks: [...snapshot.checks],
      draftCheckValues: snapshot.checkValues,
    };
  }

  function parkTimedCaptureForTask(taskId: string) {
    ensureTimedStepDraftPersisted();

    const parked = buildParkedTaskCaptureState(taskId);
    if (!parked) {
      return;
    }

    const nextParked = {
      ...parkedCaptureByTaskIdRef.current,
      [taskId]: parked,
    };
    parkedCaptureByTaskIdRef.current = nextParked;
    setParkedCaptureByTaskId(nextParked);
    captureTimerRef.current = EMPTY_CAPTURE_TIMER;
    setCaptureTimer(EMPTY_CAPTURE_TIMER);
    setTimerNow(Date.now());
  }

  function applyParkedTaskCaptureState(parked: ParkedTaskCaptureState) {
    setDraftStepId(parked.newStepId);
    setShowNewStepForm(parked.showNewStepForm);
    setNewStepName(parked.draftName ?? "");
    setNewStepInstruction(parked.draftInstruction);
    setNewStepDurationText(parked.draftDurationText || "5");
    setNewStepDraftTools(parked.draftTools);
    setNewStepDraftPhotos(parked.draftPhotos);
    setNewStepDraftChecks(new Set(parked.draftChecks));
    setNewStepDraftCheckValues(parked.draftCheckValues ?? {});
    newStepTouchedRef.current = true;
  }

  function restoreParkedTaskCapture(taskId: string) {
    const parked = parkedCaptureByTaskIdRef.current[taskId];
    if (!parked) {
      return false;
    }

    applyParkedTaskCaptureState(parked);
    const now = Date.now();
    const nextTimer = parked.timer.running
      ? restoreRunningCaptureTimer(parked.timer, now)
      : parked.timer;
    captureTimerRef.current = nextTimer;
    setCaptureTimer(nextTimer);
    setTimerNow(now);

    const nextParked = { ...parkedCaptureByTaskIdRef.current };
    delete nextParked[taskId];
    parkedCaptureByTaskIdRef.current = nextParked;
    setParkedCaptureByTaskId(nextParked);
    return true;
  }

  function resumeCaptureTimerForTask(taskId: string) {
    const timer = captureTimerRef.current;
    if (timer.taskId !== taskId || !timer.activeStepId || timer.running) {
      return;
    }

    const now = Date.now();
    const nextTimer = restoreRunningCaptureTimer(timer, now);
    captureTimerRef.current = nextTimer;
    setCaptureTimer(nextTimer);
    setTimerNow(now);
  }

  function clearTimedCaptureForTask(taskId: string) {
    const nextParked = { ...parkedCaptureByTaskIdRef.current };
    delete nextParked[taskId];
    parkedCaptureByTaskIdRef.current = nextParked;
    setParkedCaptureByTaskId(nextParked);

    if (captureTimerRef.current.taskId === taskId) {
      captureTimerRef.current = EMPTY_CAPTURE_TIMER;
      setCaptureTimer(EMPTY_CAPTURE_TIMER);
      setTimerNow(Date.now());
    }
  }

  function ensureTimedStepDraftPersisted() {
    const timer = captureTimerRef.current;
    const taskId = timer.taskId;
    const stepId = timer.activeStepId;
    const currentState = plannerStateRef.current;

    if (!taskId || !stepId || !currentState) {
      return;
    }

    const task = currentState.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }

    const snapshot = getNewStepDraftSnapshot({ stepId });
    const hasStep = (task.manufacturingSteps ?? []).some((step) => step.id === stepId);

    if (hasStep) {
      saveRecoverableNewStepDraft(snapshot, { taskId });
      return;
    }

    const previousSelectedTaskId = selectedTaskIdRef.current;
    if (previousSelectedTaskId !== taskId) {
      selectedTaskIdRef.current = taskId;
    }

    newStepTouchedRef.current = true;
    persistNewStepDraft(snapshot, { saveTask: true, showSaving: false });

    if (previousSelectedTaskId !== taskId) {
      selectedTaskIdRef.current = previousSelectedTaskId;
    }
  }

  function restoreTimedStepDraft(taskId: string, stepId: string) {
    if (restoreParkedTaskCapture(taskId)) {
      return;
    }

    setDraftStepId(stepId);
    setShowNewStepForm(true);
    newStepTouchedRef.current = true;

    const task = plannerStateRef.current?.tasks.find((candidate) => candidate.id === taskId);
    const step = task?.manufacturingSteps?.find((candidate) => candidate.id === stepId);

    if (task && step) {
      setNewStepName(step.name ?? "");
      draftBaseStepsRef.current.set(step.id, step);
      setNewStepInstruction(step.instruction ?? "");
      if ((step.durationMinutes ?? 0) > 0) {
        setNewStepDurationText(String(step.durationMinutes));
      }
      setNewStepDraftTools(getStepToolList(task, stepId));
      setNewStepDraftPhotos(getStepPhotoAttachments(task, stepId));
      setNewStepDraftChecks(getManufacturingStepCheckSet(step.qualityCheck, stepCheckDefinitions));
      setNewStepDraftCheckValues(getManufacturingStepCheckState(step.qualityCheck, stepCheckDefinitions).values);
    }

    if (!captureTimerRef.current.running || captureTimerRef.current.taskId !== taskId) {
      resumeCaptureTimerForTask(taskId);
    }
  }

  function bindCaptureTimerToStep(task: Task, stepId: string | null) {
    const now = Date.now();
    setCaptureTimer((current) => {
      if (!current.running) {
        return current;
      }

      const elapsed = getCaptureTimerElapsed(current, now);
      return {
        ...current,
        storedElapsedMs: elapsed,
        startedAt: now,
        lapMarkerMs: elapsed,
        taskId: task.id,
        taskName: task.name,
        activeStepId: stepId,
      };
    });
    setTimerNow(now);
  }

  async function deleteManufacturingStep(stepId: string) {
    if (!plannerState || !selectedTask) {
      return;
    }

    const previousState = plannerState;
    const taskId = selectedTask.id;
    const currentTask = plannerState.tasks.find((task) => task.id === taskId) ?? selectedTask;
    const currentSteps = sortManufacturingSteps(currentTask.manufacturingSteps ?? []);
    const stepToDelete = currentSteps.find((step) => step.id === stepId);

    if (!stepToDelete) {
      setConfirmDeleteStepId(null);
      return;
    }

    const removedPhotos = getStepPhotoAttachments(currentTask, stepId);
    const nextSteps = currentSteps
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, sequence: index + 1 }));
    const nextTask = removeStepScopedCustomFields(withStepDerivedDuration(currentTask, nextSteps), stepId);
    const nextState = withUpdatedTask(plannerState, nextTask, false);

    setConfirmDeleteStepId(null);
    setNewStepToolNames((current) => {
      const nextNames = { ...current };
      delete nextNames[stepId];
      return nextNames;
    });
    setPhotoUploadCounts((current) => {
      const nextCounts = { ...current };
      delete nextCounts[stepId];
      return nextCounts;
    });

    await persistTargetedState(nextState, async () => {
      await enqueueTaskScopedWrite(taskId, async () => {
        await saveTaskWithManufacturingStepsToSupabase(nextTask, projectId);
      });
    });

    void Promise.allSettled(removedPhotos.map((photo) => softDeleteStepPhotoAttachmentFromSupabase(photo.id, taskId, projectId)));
    setRestorePrompt({
      title: `Deleted step ${stepToDelete.sequence}`,
      body: "Restore will bring this manufacturing step back with its saved tools, part links, and available photos.",
      restoreLabel: "Restore Step",
      onRestore: () => restoreDeletedSnapshot(previousState, taskId),
    });
  }

  function resetNewStepDraft(durationText = "5", stepId: string | null = null) {
    clearNewStepAutosaveTimer();
    setDraftStepId(stepId);
    newStepTouchedRef.current = false;
    setNewStepName("");
    setNewStepInstruction("");
    setNewStepDurationText(durationText);
    setNewStepToolName("");
    setNewStepDraftTools([]);
    setNewStepDraftPhotos([]);
    setNewStepDraftChecks(new Set());
    setNewStepDraftCheckValues({});
    setNewStepPhotoBusyCount(0);
  }

  function getNewStepDefaultDurationText() {
    const defaultDuration = selectedTaskSteps.length === 0
      ? Math.max(Math.round(selectedTask?.plannedDurationMinutes ?? 5), 5)
      : 5;

    return String(defaultDuration);
  }

  // Set by openNewStepForm, consumed by the effect that runs after the draft panel commits.
  // goToNextManufacturingStep does not use this -- it scrolls from inside a timer callback, by
  // which point the panel is already mounted.
  const pendingNewStepScrollRef = useRef(false);

  useEffect(() => {
    if (!showNewStepForm || !pendingNewStepScrollRef.current) {
      return;
    }

    pendingNewStepScrollRef.current = false;
    scrollToNewStepForm();
    // newStepId is a dependency because opening a draft assigns a fresh id, which remounts the
    // panel and reattaches the ref the scroll depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewStepForm, newStepId]);

  function requestDeleteProcess(task: Task) {
    setConfirmPrompt({
      title: `Delete ${task.name}?`,
      body: "This deletes the process and its steps, photos, and tools from the shared project.",
      confirmLabel: "Delete process",
      onConfirm: async () => {
        setConfirmPrompt(null);
        beginLocalWrite();
        setSaveState("saving");
        try {
          await enqueueTaskScopedWrite(task.id, () => deletePlannerTask(task.id, projectId));
          setPlannerState((current) => {
            if (!current) return current;
            const next = { ...current, tasks: current.tasks.filter((item) => item.id !== task.id),
              dependencies: current.dependencies.filter((item) => item.predecessorTaskId !== task.id && item.successorTaskId !== task.id) };
            plannerStateRef.current = next;
            return next;
          });
          setSwipedTaskId(null);
          setSaveState("saved");
          setErrorMessage(null);
        } catch (error) {
          setSaveState("error");
          setErrorMessage(error instanceof Error ? error.message : "Unable to delete the process.");
        } finally {
          endLocalWrite();
        }
      },
    });
  }

  function toggleStepExpanded(stepId: string) {
    setExpandedStepIds((current) => {
      const next = new Set(current);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }

      return next;
    });
  }

  async function openNewStepForm() {
    if (!selectedTask) {
      return;
    }

    if (userId && projectId) {
      const taskId = selectedTask.id;
      const draft = await recoveryStore.load({ userId, projectId, taskId }).catch(() => null);
      if (!isEditorCurrent() || selectedTaskIdRef.current !== taskId) return;
      if (draft && restoreOwnedDraft(draft)) return;
    }
    const stepId = buildNewStepId(selectedTask.id);
    resetNewStepDraft(getNewStepDefaultDurationText(), stepId);
    setShowNewStepForm(true);

    // The draft panel renders `order-last`, i.e. below every existing step, so on a task with
    // more than a couple of steps it opens off-screen and the tap reads as "nothing happened".
    // Scrolling cannot be requested inline here: scrollToNewStepForm reads newStepFormRef, and
    // the panel this call just asked for has not been committed yet, so the ref is still null and
    // the scroll silently no-ops. Flag it and let the effect below fire once React has mounted it.
    pendingNewStepScrollRef.current = true;

    if (captureTimerRef.current.running && captureTimerRef.current.taskId === selectedTask.id) {
      bindCaptureTimerToStep(selectedTask, stepId);
    }
  }

  function flushPendingNewStepDraft() {
    if (newStepAutosaveTimerRef.current) {
      persistNewStepDraft(getNewStepDraftSnapshot(), { saveTask: true, showSaving: true });
    }
  }

  function closeNewStepForm() {
    if (selectedTask && hasTimedCaptureForTask(selectedTask.id)) {
      return;
    }

    flushPendingNewStepDraft();
    if (hasLocalSaveWork()) {
      closeDraftAfterSaveRef.current = true;
      return;
    }
    clearNewStepAutosaveTimer();
    setShowNewStepForm(false);
    resetNewStepDraft("5", null);
  }

  useEffect(() => {
    if (!closeDraftAfterSaveRef.current || writesPending || saveState !== "saved") return;
    closeDraftAfterSaveRef.current = false;
    closeNewStepForm();
    // Close uses the current draft only after the save queue has finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writesPending, saveState]);

  function applyLapToActiveStep() {
    return applyLapForTimerState(captureTimerRef.current, Date.now());
  }

  function advanceCaptureTimerLap(nextStepId: string | null) {
    const now = Date.now();
    setCaptureTimer((current) => {
      const elapsed = getCaptureTimerElapsed(current, now);
      return {
        ...current,
        storedElapsedMs: elapsed,
        startedAt: now,
        lapMarkerMs: elapsed,
        activeStepId: nextStepId,
      };
    });
    setTimerNow(now);
  }

  function startCaptureTimerForCurrentTask() {
    if (!selectedTask || activeScreen !== "detail") {
      return;
    }

    setErrorMessage(null);

    const stepId = showNewStepForm ? ensureDraftStepId(selectedTask.id) : null;
    const now = Date.now();
    setTimerNow(now);

    if (hasTimedCaptureForTask(selectedTask.id)) {
      if (
        captureTimerRef.current.taskId === selectedTask.id &&
        captureTimerRef.current.activeStepId
      ) {
        if (!captureTimerRef.current.running) {
          resumeCaptureTimerForTask(selectedTask.id);
        }
        return;
      }

      if (restoreParkedTaskCapture(selectedTask.id)) {
        return;
      }
    }

    if (captureTimerRef.current.running && captureTimerRef.current.taskId === selectedTask.id) {
      return;
    }

    const nextTimer: CaptureTimerState = {
      running: true,
      startedAt: now,
      storedElapsedMs: 0,
      lapMarkerMs: 0,
      activeStepId: stepId,
      taskId: selectedTask.id,
      taskName: selectedTask.name,
    };
    captureTimerRef.current = nextTimer;
    setCaptureTimer(nextTimer);
  }

  function stopCaptureTimer() {
    const timer = captureTimerRef.current;
    if (timer.running) {
      applyLapToActiveStep();
    }

    if (timer.taskId) {
      clearTimedCaptureForTask(timer.taskId);
    } else {
      setCaptureTimer(EMPTY_CAPTURE_TIMER);
      setTimerNow(Date.now());
    }
  }

  function addNewStepDraftToolFromLibrary(toolName: string) {
    if (!toolName) {
      return;
    }

    const alreadyExists = newStepDraftTools.some((tool) => tool.toLocaleLowerCase() === toolName.toLocaleLowerCase());
    const nextTools = alreadyExists ? newStepDraftTools : [...newStepDraftTools, toolName];
    setNewStepDraftTools(nextTools);
    newStepTouchedRef.current = true;
    persistNewStepDraft(getNewStepDraftSnapshot({ tools: nextTools }), { saveTask: true, showSaving: true });
  }

  function removeNewStepDraftTool(toolToRemove: string) {
    const nextTools = newStepDraftTools.filter((tool) => tool !== toolToRemove);
    setNewStepDraftTools(nextTools);
    newStepTouchedRef.current = true;
    persistNewStepDraft(getNewStepDraftSnapshot({ tools: nextTools }), { saveTask: true, showSaving: true });
  }


  function renderToolPicker(
    selectedTools: string[],
    onAddTool: (toolName: string) => void,
    onRemoveTool: (toolName: string) => void,
    manualAdd?: {
      value: string;
      sequence: number;
      onChange: (value: string) => void;
      disabled?: boolean;
    },
  ) {
    const toolNames = [...new Set(selectedTools)]
      .filter((tool) => tool.trim())
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    return (
      <div className="ui-photo-mobile-tool-picker">
        {manualAdd ? (
          <ProcedureToolPicker
            mobile
            value={manualAdd.value}
            toolLibrary={toolLibrary}
            assignedTools={toolNames}
            stepSequence={manualAdd.sequence}
            onValueChange={manualAdd.onChange}
            onAdd={onAddTool}
            disabled={manualAdd.disabled}
          />
        ) : null}
        {toolNames.length > 0 ? (
          <div className="ui-photo-mobile-tool-grid">
            {toolNames.map((tool) => {
              return (
                <div
                  key={tool}
                  className="ui-photo-mobile-tool-card group"
                >
                  <div className="ui-photo-mobile-tool-name">{tool}</div>
                    <button
                      type="button"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveTool(tool);
                      }}
                      aria-label={`Remove ${tool}`}
                      title={`Remove ${tool}`}
                    >
                      <Trash2 size={16} />
                    </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ui-photo-mobile-empty">
            No tools added to this step yet.
          </div>
        )}
      </div>
    );
  }

  function updateNewStepDraftChecks(qualityCheck: string) {
    const { selected: checks, values: checkValues } = getManufacturingStepCheckState(qualityCheck, stepCheckDefinitions);
    setNewStepDraftChecks(checks);
    setNewStepDraftCheckValues(checkValues);
    newStepTouchedRef.current = true;
    persistNewStepDraft(getNewStepDraftSnapshot({ checks, checkValues }), { showSaving: true });
  }

  async function handleNewStepPhotoFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setNewStepPhotoBusyCount((currentCount) => currentCount + 1);
    setErrorMessage(null);

    try {
      const photos = await Promise.all(files.map(buildPhotoAttachment));
      const nextPhotos = [...newStepDraftPhotos, ...photos];
      setNewStepDraftPhotos(nextPhotos);
      newStepTouchedRef.current = true;
      persistNewStepDraft(getNewStepDraftSnapshot({ photos: nextPhotos }), { saveTask: true, showSaving: true });
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to attach the selected photo.");
    } finally {
      setNewStepPhotoBusyCount((currentCount) => Math.max(0, currentCount - 1));
    }
  }

  function removeNewStepDraftPhoto(photoId: string) {
    const nextPhotos = newStepDraftPhotos.filter((photo) => photo.id !== photoId);
    setNewStepDraftPhotos(nextPhotos);
    newStepTouchedRef.current = true;
    persistNewStepDraft(getNewStepDraftSnapshot({ photos: nextPhotos }), { saveTask: true, showSaving: true });
  }

  function goToNextManufacturingStep() {
    if (newStepMotionPhase !== "idle") {
      return;
    }

    clearNewStepAutosaveTimer();

    const currentStepId = newStepIdRef.current;
    let snapshot = getNewStepDraftSnapshot({ stepId: currentStepId });

    if (
      captureTimer.running &&
      captureTimer.activeStepId === currentStepId
    ) {
      const lapMinutes = elapsedMinutesFromTimer(getCaptureTimerLapElapsed(captureTimer, Date.now()));
      if (lapMinutes > 0) {
        snapshot = getNewStepDraftSnapshot({ stepId: currentStepId, durationText: String(lapMinutes) });
        setNewStepDurationText(snapshot.durationText);
        newStepTouchedRef.current = true;
      }
    }

    if (!hasDraftStepContent(snapshot) && !newStepTouchedRef.current) {
      setErrorMessage("Add a name, instruction, photo, tool, or check before saving this step.");
      return;
    }
    const taskId = selectedTaskIdRef.current;
    persistNewStepDraft(snapshot, {
      saveTask: true,
      showSaving: true,
      onSaved: () => beginNewStepEnterMotion(currentStepId, () => {
        if (selectedTaskIdRef.current !== taskId) return;
        const nextStepId = taskId ? buildNewStepId(taskId) : null;
        resetNewStepDraft("5", nextStepId);
        setShowNewStepForm(true);
        if (captureTimer.running) advanceCaptureTimerLap(nextStepId);
      }),
    });
  }

  function selectTask(taskId: string) {
    flushPendingNewStepDraft();
    const preserveTimedStep = shouldPreserveTimedStepDraft(taskId);
    const leavingTaskId = selectedTaskIdRef.current;

    if (leavingTaskId && leavingTaskId !== taskId && hasTimedCaptureForTask(leavingTaskId)) {
      parkTimedCaptureForTask(leavingTaskId);
    }

    if (preserveTimedStep) {
      ensureTimedStepDraftPersisted();
      clearNewStepAutosaveTimer();
    } else {
      clearNewStepAutosaveTimer();
      setShowNewStepForm(false);
      resetNewStepDraft("5", null);
    }

    selectedTaskIdRef.current = taskId;
    setSelectedTaskId(taskId);
    setConfirmDeleteStepId(null);
    setShowNewTaskForm(false);
    setActiveScreen("detail");
    setErrorMessage(null);
    scrollPortalToTop();

    if (preserveTimedStep) {
      const stepId =
        captureTimerRef.current.taskId === taskId && captureTimerRef.current.activeStepId
          ? captureTimerRef.current.activeStepId
          : parkedCaptureByTaskIdRef.current[taskId]?.newStepId ?? null;

      if (stepId) {
        restoreTimedStepDraft(taskId, stepId);
      }
    }
  }

  function showProcessList() {
    flushPendingNewStepDraft();
    const preserveTimedStep = shouldPreserveTimedStepDraft();

    if (preserveTimedStep) {
      ensureTimedStepDraftPersisted();
      clearNewStepAutosaveTimer();
      setShowNewStepForm(false);
    } else {
      clearNewStepAutosaveTimer();
      setShowNewStepForm(false);
      resetNewStepDraft("5", null);
    }

    setConfirmDeleteStepId(null);
    setShowNewTaskForm(false);
    setActiveScreen("list");
    setErrorMessage(null);
    scrollPortalToTop();
  }

  function openCaptureTaskFromHeader(taskId: string) {
    if (activeScreen !== "detail" || selectedTaskId !== taskId) {
      selectTask(taskId);
      return;
    }

    resumeCaptureTimerForTask(taskId);
  }

  if (saveState === "loading") {
    return (
      <AppLoadingShell title="Loading workspace" />
    );
  }

  return (
    <main className="mobile-photo-portal min-h-[100svh] bg-canvas text-ink">
      <header
        ref={mobileHeaderRef}
        className="ui-photo-mobile-site-header fixed inset-x-0 top-0 z-50 border-b border-line bg-surface text-ink"
      >
        <div className="mx-auto max-w-xl">
          <div className="ui-photo-mobile-site-header-row">
            {onBackToProjects ? (
              <button type="button" className="ui-photo-mobile-header-btn shrink-0" onClick={() => { flushPendingNewStepDraft(); onBackToProjects(); }}>
                <ChevronLeft size={14} />
                Projects
              </button>
            ) : null}
            <div className="ui-photo-mobile-site-header-brand min-w-0 flex-1">
              <div className="ui-photo-mobile-site-eyebrow">Process builder</div>
              <h1 className="ui-photo-mobile-page-title">{derivedState?.product.name ?? projectContext?.projectName ?? "Process builder"}</h1>
            </div>
            <div className="ui-photo-mobile-header-actions">
              {headerCaptureTimers.length > 0 ? (
                <div className="ui-photo-mobile-header-timers">
                  {headerCaptureTimers.map((entry, index) => {
                    const taskName = taskRows.find((task) => task.id === entry.taskId)?.name ?? entry.taskName;
                    const elapsedMs = getCaptureTimerElapsed(entry.timer, timerNow);
                    const isViewingEntry = activeScreen === "detail" && selectedTaskId === entry.taskId;
                    const timerTitle = `${taskName || "Process"} · ${formatElapsedTimer(elapsedMs)}`;

                    return (
                      <Fragment key={entry.taskId}>
                        {index > 0 ? (
                          <span className="ui-photo-mobile-header-timer-divider" aria-hidden="true" />
                        ) : null}
                        {isViewingEntry ? (
                          <div
                            className="ui-photo-mobile-header-timer-chip ui-photo-mobile-header-timer-current"
                            title={timerTitle}
                          >
                            <span className="ui-photo-mobile-header-timer-name">{taskName || "Process"}</span>
                            <span className="ui-photo-mobile-header-timer-value">
                              {formatElapsedTimer(elapsedMs)}
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openCaptureTaskFromHeader(entry.taskId)}
                            className="ui-photo-mobile-header-timer-chip"
                            title={
                              entry.timer.running
                                ? `Open ${taskName || "this process"} · timer running`
                                : `Open ${taskName || "this process"}`
                            }
                          >
                            <span className="ui-photo-mobile-header-timer-name">{taskName || "Process"}</span>
                            <span className="ui-photo-mobile-header-timer-value">
                              {formatElapsedTimer(elapsedMs)}
                            </span>
                          </button>
                        )}
                      </Fragment>
                    );
                  })}
                  {isViewingCaptureTask ? (
                    <>
                      <span className="ui-photo-mobile-header-timer-divider" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={stopCaptureTimer}
                        className="ui-photo-mobile-header-btn ui-photo-mobile-header-btn-danger shrink-0"
                        title={`Stop timer for ${
                          taskRows.find((task) => task.id === viewingHeaderCapture?.taskId)?.name ??
                          viewingHeaderCapture?.taskName ??
                          "this process"
                        }`}
                      >
                        Stop
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {canStartCaptureTimer ? (
                <button
                  type="button"
                  onClick={startCaptureTimerForCurrentTask}
                  className="ui-photo-mobile-header-btn shrink-0"
                  title={`Start timer for ${selectedTask?.name ?? "this process"}`}
                >
                  <Timer size={12} />
                  Timer
                </button>
              ) : null}
            </div>
            <div className="ui-photo-mobile-header-nav flex shrink-0 items-center gap-1.5">
              <span className={`ui-photo-mobile-save-status ${saveState === "error" ? "text-danger" : "text-ink-secondary"}`}
                role="status" aria-live="polite">
                {saveState === "error" ? "Not saved" : (saveState === "saving" || writesPending) ? "Saving…" : "Saved"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div
        ref={contentScrollRef}
        className="min-h-0"
        style={{
          paddingTop: mobileHeaderHeight,
          scrollPaddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
        }}
      >
      <div
        className="mx-auto max-w-xl p-3 ui-photo-mobile-content"
        style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}
      >
        {restorePrompt ? (
          <div className="mb-3 rounded-md border border-accent/40 bg-accent-muted p-3">
            <div className="ui-photo-mobile-notice-title">{restorePrompt.title}</div>
            <div className="ui-photo-mobile-notice-body">{restorePrompt.body}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRestorePrompt(null)}
                className="ui-photo-mobile-btn-secondary h-9"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => void restorePrompt.onRestore()}
                disabled={saveState === "saving"}
                className="ui-photo-mobile-btn-accent h-9 disabled:opacity-60"
              >
                {restorePrompt.restoreLabel}
              </button>
            </div>
          </div>
        ) : null}
        {confirmPrompt ? (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger-muted p-3">
            <div className="ui-photo-mobile-notice-title text-danger">{confirmPrompt.title}</div>
            <div className="ui-photo-mobile-notice-body">{confirmPrompt.body}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmPrompt(null)}
                className="ui-photo-mobile-btn-secondary h-9"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPrompt.onConfirm()}
                disabled={saveState === "saving"}
                className="ui-photo-mobile-btn-danger h-9 disabled:opacity-60"
              >
                {confirmPrompt.confirmLabel}
              </button>
            </div>
          </div>
        ) : null}
        {activeScreen === "list" ? (
        <section className="min-w-0 ui-panel">
            {errorMessage && !showNewTaskForm ? (
              <div className="m-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 ui-photo-mobile-caption text-danger">
                {errorMessage}
              </div>
            ) : null}

          <div>
            {taskRows.map((task, index) => {
              const stepCount = task.manufacturingSteps?.length ?? 0;
              const zoneName = task.zoneId ? zoneById.get(task.zoneId) : undefined;
              const zoneLabel = zoneName ?? "No zone";
              const previousTask = taskRows[index - 1];
              const previousZoneName = previousTask?.zoneId ? zoneById.get(previousTask.zoneId) : undefined;
              const previousZoneLabel = previousTask ? previousZoneName ?? "No zone" : "";
              const showZoneDivider = index === 0 || previousZoneLabel !== zoneLabel;
              const photoCount = (task.manufacturingSteps ?? []).reduce(
                (total, step) => total + getStepPhotoAttachments(task, step.id).length,
                0,
              );
              const toolCount = countTaskStepTools(task);
              const showDropBefore =
                Boolean(draggingTaskId) && dragTargetTaskId === task.id && dragTargetPlacement === "before";
              const showDropAfter =
                Boolean(draggingTaskId) && dragTargetTaskId === task.id && dragTargetPlacement === "after";

              return (
                <Fragment key={task.id}>
                  {showZoneDivider ? (
                    <div
                      className={`flex items-center gap-2 bg-surface-raised px-3 py-2 ${
                        index === 0 ? "" : "border-t-2 border-accent/35"
                      }`}
                    >
                      <div className="h-px flex-1 bg-line" />
                      <div className="shrink-0 ui-mono-label">
                        {zoneLabel}
                      </div>
                      <div className="h-px flex-1 bg-line" />
                    </div>
                  ) : null}
                  {showDropBefore ? (
                    <div
                      data-mobile-task-id={task.id}
                      data-drop-placement="before"
                      className="mx-3 my-1 h-14 ui-panel-sunken transition-all duration-200"
                    />
                  ) : null}
                <div
                  data-mobile-task-id={task.id}
                  className={`relative flex border-b border-line bg-surface transition-all duration-200 ease-out last:border-b-0 ${
                    draggingTaskId === task.id ? "opacity-35" : ""
                  }`}
                >
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      suppressProcessClickRef.current = false;
                      processSwipeRef.current = { x: event.clientX, y: event.clientY, horizontal: false };
                    }}
                    onPointerMove={(event) => {
                      const swipe = processSwipeRef.current;
                      if (!swipe) return;
                      const dx = event.clientX - swipe.x;
                      const dy = event.clientY - swipe.y;
                      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                        swipe.horizontal = true;
                        suppressProcessClickRef.current = true;
                        setSwipedTaskId(dx < 0 ? task.id : null);
                      }
                    }}
                    onPointerUp={() => { processSwipeRef.current = null; }}
                    onPointerCancel={() => { processSwipeRef.current = null; }}
                    style={{ touchAction: "pan-y" }}
                    onClick={() => {
                      if (suppressProcessClickRef.current) { suppressProcessClickRef.current = false; return; }
                      if (swipedTaskId === task.id) { setSwipedTaskId(null); return; }
                      selectTask(task.id);
                    }}
                    className="block min-w-0 flex-1 bg-surface px-3 py-3 text-left transition active:bg-surface-active"
                  >
                    <div className="flex items-start gap-3">
                      <div className="ui-photo-mobile-wbs-chip mt-0.5">
                        {taskDisplayCode(task)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="ui-photo-mobile-body">{task.name}</div>
                        <div className="ui-photo-mobile-meta mt-1 flex flex-wrap items-center gap-2">
                          <span>
                            {stepCount} {stepCount === 1 ? "step" : "steps"}
                          </span>
                          <span>
                            {photoCount} {photoCount === 1 ? "photo" : "photos"}
                          </span>
                          <span>
                            {toolCount} {toolCount === 1 ? "tool" : "tools"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onPointerDown={(event) => startTaskDrag(event, task.id)}
                    onPointerMove={moveTaskDrag}
                    onPointerUp={finishTaskDrag}
                    onPointerCancel={cancelTaskDrag}
                    disabled={saveState === "saving"}
                    className="flex w-11 shrink-0 touch-none items-center justify-center bg-surface text-steel active:bg-surface-active disabled:opacity-35"
                    aria-label={`Drag ${task.name} to reorder`}
                    title={`Drag ${task.name} to reorder`}
                  >
                    <Menu size={18} strokeWidth={2.4} />
                  </button>
                  {swipedTaskId === task.id ? (
                    <button type="button" className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 bg-danger text-canvas"
                      aria-label={`Delete ${task.name}`} disabled={writesPending || headerCaptureTimers.some((entry) => entry.taskId === task.id)}
                      onClick={() => requestDeleteProcess(task)}>
                      <Trash2 size={18} />
                      <span className="text-sm">Delete</span>
                    </button>
                  ) : null}
                </div>
                  {showDropAfter ? (
                    <div
                      data-mobile-task-id={task.id}
                      data-drop-placement="after"
                      className="mx-3 my-1 h-14 ui-panel-sunken transition-all duration-200"
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </div>
          {draggingTaskId && dragPreview ? (
            (() => {
              const draggingTask = taskRows.find((task) => task.id === draggingTaskId);
              if (!draggingTask) {
                return null;
              }

              const draggingStepCount = draggingTask.manufacturingSteps?.length ?? 0;
              const draggingPhotoCount = (draggingTask.manufacturingSteps ?? []).reduce(
                (total, step) => total + getStepPhotoAttachments(draggingTask, step.id).length,
                0,
              );
              const draggingToolCount = countTaskStepTools(draggingTask);

              return (
                <div
                  className="pointer-events-none fixed z-50 flex ui-panel ring-1 ring-black/5"
                  style={{
                    left: dragPreview.x,
                    top: dragPreview.y,
                    width: Math.min(dragPreview.width, 520),
                    transform: "translate(-88%, -50%)",
                  }}
                >
                  <div className="block min-w-0 flex-1 px-3 py-3 text-left">
                    <div className="flex items-start gap-3">
                      <div className="ui-photo-mobile-wbs-chip ui-photo-mobile-wbs-chip-accent mt-0.5">
                        {taskDisplayCode(draggingTask)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate ui-photo-mobile-body">{draggingTask.name}</div>
                        <div className="ui-photo-mobile-meta mt-1 flex flex-wrap items-center gap-2">
                          <span>
                            {draggingStepCount} {draggingStepCount === 1 ? "step" : "steps"}
                          </span>
                          <span>
                            {draggingPhotoCount} {draggingPhotoCount === 1 ? "photo" : "photos"}
                          </span>
                          <span>
                            {draggingToolCount} {draggingToolCount === 1 ? "tool" : "tools"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex w-11 shrink-0 items-center justify-center border-l border-line bg-surface-raised text-steel">
                    <Menu size={18} strokeWidth={2.4} />
                  </div>
                </div>
              );
            })()
          ) : null}
            {showNewTaskForm ? (
              <div className="m-3 rounded border border-accent/35 bg-accent-muted p-3"
                ref={revealNewProcessForm}
                style={{ scrollMarginTop: mobileHeaderHeight + 12 }}>
                {errorMessage ? <div role="alert" className="mb-3 ui-photo-mobile-caption text-danger">{errorMessage}</div> : null}
                <label className="block">
                  <span className="ui-field-label text-accent">
                    New process
                  </span>
                  <input
                    className="ui-photo-mobile-field h-11"
                    value={newTaskName}
                    onFocus={handleMobileFieldFocus}
                    onChange={(event) => setNewTaskName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void addHighLevelTask();
                      }
                    }}
                    placeholder="Process name"
                  />
                </label>
                <label className="mt-2 block">
                  <span className="ui-field-label text-accent">
                    Zone
                  </span>
                  <ThemedSelect
                    className="w-full"
                    triggerClassName="ui-photo-mobile-field h-11"
                    value={newTaskZoneId}
                    options={[
                      { value: "", label: "No zone" },
                      ...(derivedState?.zones.map((zone) => ({ value: zone.id, label: zone.name })) ?? []),
                    ]}
                    onChange={setNewTaskZoneId}
                  />
                </label>
                <label className="mt-2 block">
                  <span className="ui-field-label text-accent">
                    Component
                  </span>
                  <ThemedSelect
                    className="w-full"
                    triggerClassName="ui-photo-mobile-field h-11"
                    value={newTaskComponentId}
                    options={[
                      { value: "", label: "No component" },
                      ...(derivedState?.components
                        .filter((component) => component.active)
                        .map((component) => ({
                          value: component.id,
                          label: `${component.code || "CODE"} - ${component.name || "Unnamed component"}`,
                        })) ?? []),
                    ]}
                    onChange={setNewTaskComponentId}
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewTaskName("");
                      setNewTaskZoneId("");
                      setNewTaskComponentId("");
                      setShowNewTaskForm(false);
                    }}
                    className="ui-photo-mobile-btn-secondary h-10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void addHighLevelTask()}
                    disabled={saveState === "saving"}
                    className="ui-photo-mobile-btn-accent h-10 disabled:opacity-60"
                  >
                    {saveState === "saving" ? <NothingSpinner inline /> : <Plus size={14} />}
                    Add process
                  </button>
                </div>
              </div>
            ) : null}
        </section>
        ) : (
        <section className="min-w-0 ui-panel">
          {errorMessage && !showNewStepForm ? <div role="alert" className="m-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 ui-photo-mobile-caption text-danger">
            {errorMessage}
            {failedDraftPatchesRef.current.size > 0 ? <button type="button" className="ui-photo-mobile-btn-secondary mt-2" disabled={writesPending} onClick={() => void retryFailedStepSaves()}>Retry save</button> : null}
          </div> : null}
          {selectedTask ? (
            <>
              <div className="ui-photo-mobile-task-header">
                <div className="ui-photo-mobile-task-header-nav">
                  <button
                    type="button"
                    onClick={showProcessList}
                    className="ui-photo-mobile-back-link"
                  >
                    <ChevronLeft size={14} />
                    Process list
                  </button>
                  <span className="ui-photo-mobile-caption truncate">
                    {selectedTask.zoneId ? zoneById.get(selectedTask.zoneId) ?? "Process" : "Process"}
                  </span>
                </div>
                <div className="ui-photo-mobile-task-code" title={taskDisplayCode(selectedTask)}>
                  {taskDisplayCode(selectedTask)}
                </div>
                <div className="ui-photo-mobile-task-header-main">
                  <input
                    key={selectedTask.id}
                    aria-label="Process name"
                    className="ui-photo-mobile-task-name-inline"
                    defaultValue={selectedTask.name}
                    onFocus={handleMobileFieldFocus}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim() || "Untitled task";
                      event.currentTarget.value = name;

                      if (name !== selectedTask.name) {
                        void updateTask(selectedTask.id, { name });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="ui-photo-mobile-task-header-meta">
                  <span>{formatMinutes(selectedTask.plannedDurationMinutes)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {(selectedTask.manufacturingSteps ?? []).length}{" "}
                    {(selectedTask.manufacturingSteps ?? []).length === 1 ? "step" : "steps"}
                  </span>
                </div>
              </div>

              <div className="ui-photo-mobile-step-list flex flex-col gap-6 p-3">
                {legacyDraft && legacyDraft.taskId === selectedTask.id ? <LegacyDraftReview
                  draft={legacyDraft} reviewing={legacyReviewing} busy={legacyBusy}
                  blocked={showNewStepForm && hasDraftStepContent(getNewStepDraftSnapshot())}
                  onReview={() => setLegacyReviewing(true)} onBack={() => setLegacyReviewing(false)}
                  onDismiss={() => { legacyDismissedRef.current = true; setLegacyDraft(null); }}
                  onUse={() => void adoptReviewedLegacyDraft()} /> : null}
                {showNewStepForm ? (
                  <div
                    ref={newStepFormRef}
                    key={newStepId ?? "new-step-draft"}
                    className={`order-last overflow-hidden ui-panel ui-photo-mobile-new-step-panel ${
                      newStepMotionPhase === "exit" ? "is-exiting" : ""
                    } ${newStepMotionPhase === "enter" ? "is-entering" : ""}`}
                    style={{ scrollMarginTop: mobileHeaderHeight + 12 }}
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="ui-photo-mobile-step-kicker">
                          {stepDisplayCode(selectedTask, { sequence: draftStepSequence }) || `Step ${draftStepSequence}`}
                        </div>
                        <input
                          className="ui-photo-mobile-step-name-inline w-full"
                          aria-label="New step name"
                          placeholder={`New step ${draftStepSequence}`}
                          value={newStepName}
                          onFocus={handleMobileFieldFocus}
                          onChange={(event) => {
                            setNewStepName(event.target.value);
                            scheduleNewStepAutosave({ name: event.target.value });
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={closeNewStepForm}
                        disabled={captureTimer.running}
                        className="ui-btn-ghost text-steel disabled:opacity-40"
                      >
                        {captureTimer.running ? "Timer On" : "Close"}
                      </button>
                    </div>
                    {errorMessage ? (
                      <div className="m-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 ui-photo-mobile-caption text-danger">
                        {errorMessage}
                        {saveState === "error" ? <button type="button" className="ui-photo-mobile-btn-secondary mt-2" disabled={writesPending}
                          onClick={() => persistNewStepDraft(getNewStepDraftSnapshot(), { showSaving: true })}>Retry save</button> : null}
                      </div>
                    ) : null}
                    <div className="ui-photo-mobile-section">
                      <div className="ui-photo-mobile-section-head">
                        <div className="ui-mono-label">
                          Photos · {newStepDraftPhotos.length}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="ui-photo-mobile-btn-accent h-10">
                          {newStepPhotoBusyCount > 0 ? <NothingSpinner inline /> : <Camera size={15} />}
                          Camera
                          <input
                            className="sr-only"
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            onChange={(event) => {
                              const files = Array.from(event.currentTarget.files ?? []);
                              event.currentTarget.value = "";
                              void handleNewStepPhotoFiles(files);
                            }}
                          />
                        </label>
                        <label className="ui-photo-mobile-btn-secondary h-10">
                          {newStepPhotoBusyCount > 0 ? <NothingSpinner inline /> : <ImageIcon size={15} />}
                          Upload
                          <input
                            className="sr-only"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                              const files = Array.from(event.currentTarget.files ?? []);
                              event.currentTarget.value = "";
                              void handleNewStepPhotoFiles(files);
                            }}
                          />
                        </label>
                      </div>
                      {newStepDraftPhotos.length > 0 ? (
                        <div className="ui-photo-mobile-step-photo-grid mt-2">
                          {newStepDraftPhotos.map((photo) => (
                            <div key={photo.id} className="ui-photo-mobile-step-photo-card bg-surface-raised">
                              <NextImage
                                src={photo.thumbnailUrl ?? photo.dataUrl}
                                alt="New step photo"
                                width={480}
                                height={640}
                                unoptimized
                                loading="lazy"
                                className="ui-photo-mobile-step-photo-image"
                              />
                              <div className="ui-photo-mobile-step-photo-meta">
                                <div className="min-w-0">
                                  <div className="truncate ui-photo-mobile-caption text-ink">{photo.name}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeNewStepDraftPhoto(photo.id)}
                                  className="ui-photo-mobile-icon-btn ui-photo-mobile-icon-btn-danger shrink-0"
                                  aria-label="Remove photo"
                                  title="Remove photo"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="ui-photo-mobile-empty mt-2 flex items-center gap-2">
                          <ImageIcon size={14} />
                          Photos can be attached before this step is saved.
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-3">
                    <label className="block">
                      <span className="ui-field-label mb-1">Description</span>
                      <textarea
                        ref={bindNewStepInstructionRef}
                        className="ui-photo-mobile-textarea min-h-[104px]"
                        value={newStepInstruction}
                        onChange={(event) => {
                          const instruction = event.target.value;
                          resizeTextareaToContent(event.currentTarget);
                          setNewStepInstruction(instruction);
                          scheduleNewStepAutosave({ instruction });
                        }}
                        onFocus={handleStepInstructionFocus}
                        placeholder="Describe the manufacturing step"
                      />
                    </label>
                    <label className="mt-3 block max-w-[9.5rem]">
                      <span className="mb-1 block ui-mono-label">Duration</span>
                      {captureTimer.running && isTimerOnSelectedTask && captureTimer.activeStepId === newStepId ? (
                        <div className="ui-photo-mobile-caption mb-1">
                          Step lap {formatElapsedTimer(captureTimerLapElapsedMs)}
                          <span className="text-ink-tertiary"> · process {formatElapsedTimer(captureTimerElapsedMs)}</span>
                        </div>
                      ) : captureTimer.running && isTimerOnSelectedTask ? (
                        <div className="ui-photo-mobile-caption mb-1">
                          Process {formatElapsedTimer(captureTimerElapsedMs)}
                        </div>
                      ) : null}
                      <label className="ui-photo-mobile-step-duration">
                        <input
                          className="ui-photo-mobile-step-duration-input"
                          type="text"
                          inputMode="numeric"
                          value={newStepDurationText}
                          onFocus={handleMobileFieldFocus}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (/^\d*\.?\d*$/.test(value)) {
                              setNewStepDurationText(value);
                              scheduleNewStepAutosave({ durationText: value });
                            }
                          }}
                        />
                        <span className="ui-photo-mobile-step-duration-suffix">min</span>
                      </label>
                    </label>
                    </div>
                    <details className="ui-photo-mobile-section">
                      <summary className="ui-photo-mobile-check-summary">Tools <span>{newStepDraftTools.length} added</span></summary>
                      <div className="mt-2">
                        {renderToolPicker(newStepDraftTools, addNewStepDraftToolFromLibrary, removeNewStepDraftTool, {
                        value: newStepToolName,
                        sequence: draftStepSequence,
                        onChange: setNewStepToolName,
                      })}
                      </div>
                    </details>
                    <details className="ui-photo-mobile-section ui-photo-mobile-section-compact">
                      <summary className="ui-photo-mobile-check-summary">Checks <span>{newStepDraftChecks.size} selected</span></summary>
                      <div className="ui-photo-mobile-check-editor mt-2">
                        <ProcedureStepChecksEditor ariaLabel="New step checks" compact definitions={stepCheckDefinitions}
                          qualityCheck={serializeManufacturingStepCheckState({ selected: newStepDraftChecks, values: newStepDraftCheckValues }, stepCheckDefinitions)}
                          onChange={updateNewStepDraftChecks} />
                      </div>
                    </details>
                    <div className="ui-photo-mobile-next-step-bar">
                      <button
                        type="button"
                        onClick={goToNextManufacturingStep}
                        disabled={newStepPhotoBusyCount > 0 || writesPending || saveState === "saving"}
                        className="ui-photo-mobile-btn-primary inline-flex h-11 w-full disabled:opacity-60"
                      >
                        <Plus size={16} />
                        {captureTimer.running ? "Save & start next lap" : "Save & add next"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openNewStepForm}
                    className="ui-photo-mobile-btn-secondary order-last h-11 w-full"
                  >
                    <Plus size={16} />
                    Add step
                  </button>
                )}
                {selectedTaskSteps.length === 0 && !showNewStepForm ? (
                  <div className="rounded-md border border-dashed border-line bg-surface-raised p-5 text-center">
                    <ClipboardList className="mx-auto mb-3 h-7 w-7 text-steel" />
                    <div className="ui-photo-mobile-body">No manufacturing steps yet</div>
                    <div className="ui-photo-mobile-body-secondary mt-1">
                      Add the first step here with its description, tools, and photos.
                    </div>
                  </div>
                ) : null}

                {selectedTask ? <StepExplodedViewGallery views={getTaskExplodedViews(selectedTask)} /> : null}
                {selectedTask ? <TaskVideoGallery videos={getTaskVideos(selectedTask)} /> : null}

                {visibleSelectedTaskSteps.map((step) => {
                  const photos = getStepPhotoAttachments(selectedTask, step.id);
                  const stepTools = getStepToolList(selectedTask, step.id);
                  const selectedChecks = getManufacturingStepCheckSet(step.qualityCheck, stepCheckDefinitions);
                  const uploadCount = photoUploadCounts[step.id] ?? 0;
                  const isUploading = uploadCount > 0;
                  const confirmingDelete = confirmDeleteStepId === step.id;
                  const stepCode = stepDisplayCode(selectedTask, step);
                  const isExpanded = expandedStepIds.has(step.id) || confirmingDelete;

                  if (!isExpanded) {
                    return (
                      <article key={step.id} className="overflow-hidden ui-panel">
                        <button
                          type="button"
                          onClick={() => toggleStepExpanded(step.id)}
                          className="ui-photo-mobile-step-summary"
                          aria-expanded={false}
                          aria-label={`Expand step ${step.sequence}`}
                        >
                          <span className="ui-photo-mobile-step-summary-main">
                            <span className="ui-photo-mobile-step-code">{stepCode || `Step ${step.sequence}`}</span>
                            <span className="ui-photo-mobile-step-summary-name">
                              {manufacturingStepDisplayName(step)}
                            </span>
                            <span className="ui-photo-mobile-step-summary-meta">
                              <span>{step.durationMinutes ?? 0} min</span>
                              {photos.length > 0 ? <span>{photos.length} photo{photos.length === 1 ? "" : "s"}</span> : null}
                              {stepTools.length > 0 ? <span>{stepTools.length} tool{stepTools.length === 1 ? "" : "s"}</span> : null}
                              {selectedChecks.size > 0 ? <span>{selectedChecks.size} check{selectedChecks.size === 1 ? "" : "s"}</span> : null}
                            </span>
                          </span>
                          <ChevronDown size={16} className="ui-photo-mobile-step-summary-chevron" />
                        </button>
                      </article>
                    );
                  }

                  return (
                    <article
                      key={step.id}
                      className={`overflow-hidden ui-panel ${
                        recentlyCompletedStepId === step.id ? "ui-photo-mobile-step-just-saved" : ""
                      }`}
                    >
                      <div className="ui-photo-mobile-step-editor min-w-0 px-3 py-3">
                      <div className="ui-photo-mobile-step-header">
                        <div className="min-w-0 flex-1">
                          <div className="ui-photo-mobile-step-code" title={stepCode || `Step ${step.sequence}`}>
                            {stepCode || `Step ${step.sequence}`}
                          </div>
                          <div className="ui-photo-mobile-step-header-title">
                          <input
                            key={`${step.id}:${step.name ?? ""}`}
                            aria-label={`Step ${step.sequence} name`}
                            className="ui-photo-mobile-step-name-inline"
                            defaultValue={manufacturingStepDisplayName(step)}
                            onFocus={handleMobileFieldFocus}
                            onBlur={(event) => {
                              const name = parseManufacturingStepNameInput(
                                event.currentTarget.value,
                                step.sequence,
                              );
                              event.currentTarget.value = manufacturingStepDisplayName({ ...step, name });

                              if (name !== (step.name ?? "")) {
                                void updateManufacturingStep(step.id, { name });
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                          </div>
                        </div>
                          <button
                            type="button"
                            onClick={() => toggleStepExpanded(step.id)}
                            className="ui-photo-mobile-icon-btn ui-photo-mobile-step-toggle"
                            aria-expanded
                            aria-label={`Collapse step ${step.sequence}`}
                            title={`Collapse step ${step.sequence}`}
                          >
                            <ChevronUp size={16} />
                          </button>
                        <div className="ui-photo-mobile-step-header-actions">
                          <label className="ui-photo-mobile-step-duration">
                            <span className="sr-only">Step {step.sequence} duration minutes</span>
                            <input
                              aria-label={`Step ${step.sequence} duration minutes`}
                              className="ui-photo-mobile-step-duration-input"
                              type="text"
                              inputMode="decimal"
                              defaultValue={String(step.durationMinutes ?? 0)}
                              onFocus={handleMobileFieldFocus}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                if (!/^\d*\.?\d*$/.test(value)) {
                                  event.currentTarget.value = value.replace(/[^\d.]/g, "");
                                }
                              }}
                              onBlur={(event) => {
                                const durationMinutes = Math.max(Number.parseFloat(event.currentTarget.value) || 0, 0);
                                event.currentTarget.value = String(durationMinutes);
                                if (durationMinutes !== (step.durationMinutes ?? 0)) {
                                  void updateManufacturingStep(step.id, { durationMinutes });
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                            <span className="ui-photo-mobile-step-duration-suffix">min</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteStepId(step.id)}
                            disabled={saveState === "saving" || isUploading}
                            className="ui-photo-mobile-icon-btn ui-photo-mobile-icon-btn-danger disabled:opacity-40"
                            aria-label={`Delete step ${step.sequence}`}
                            title={`Delete step ${step.sequence}`}
                          >
                            <Trash2 size={14} />
                          </button>

                        </div>
                      </div>
                        {confirmingDelete ? (
                          <div className="mt-2 rounded border border-danger/30 bg-danger-muted p-2.5">
                            <div className="ui-photo-mobile-caption text-danger">
                              Delete step {step.sequence}?
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStepId(null)}
                                className="ui-photo-mobile-btn-secondary h-9"
                              >
                                Keep step
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteManufacturingStep(step.id)}
                                disabled={saveState === "saving" || isUploading}
                                className="ui-photo-mobile-btn-danger h-9 disabled:opacity-60"
                              >
                                Delete step
                              </button>
                            </div>
                          </div>
                        ) : null}

                      </div>
                      <div className="ui-photo-mobile-section">
                      <div className="ui-photo-mobile-section-head">
                        <div className="ui-mono-label">
                          Photos · {photos.length}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="ui-photo-mobile-btn-accent h-10">
                          {isUploading ? <NothingSpinner inline /> : <Camera size={15} />}
                          Camera
                          <input
                            className="sr-only"
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            onChange={(event) => {
                              const files = Array.from(event.currentTarget.files ?? []);
                              event.currentTarget.value = "";
                              void handlePhotoFiles(step.id, files);
                            }}
                          />
                        </label>
                        <label className="ui-photo-mobile-btn-secondary h-10">
                          {isUploading ? <NothingSpinner inline /> : <ImageIcon size={15} />}
                          Upload
                          <input
                            className="sr-only"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                              const files = Array.from(event.currentTarget.files ?? []);
                              event.currentTarget.value = "";
                              void handlePhotoFiles(step.id, files);
                            }}
                          />
                        </label>
                      </div>

                      {photos.length > 0 ? (
                        <div className="ui-photo-mobile-step-photo-grid">
                          {photos.map((photo) => (
                            <div key={photo.id} className="ui-photo-mobile-step-photo-card">
                              <div
                                className="ui-photo-mobile-step-photo-frame"
                                onContextMenu={(event) => event.preventDefault()}
                              >
                                <NextImage
                                  src={photo.thumbnailUrl ?? photo.dataUrl}
                                  alt={`${selectedTask.name} step ${step.sequence}`}
                                  width={480}
                                  height={640}
                                  unoptimized
                                  loading="lazy"
                                  className="ui-photo-mobile-step-photo-image"
                                />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      requestRemovePhoto(step.id, photo);
                                    }}
                                    className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center bg-transparent text-danger"
                                    aria-label="Remove photo"
                                    title="Remove photo"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="ui-photo-mobile-empty mt-3 flex items-center gap-2">
                          <ImageIcon size={14} />
                          No photos attached to this step yet.
                        </div>
                      )}
                      </div>
                      <div className="px-3 py-3">
                        <label className="block">
                          <span className="ui-field-label mb-1">Description</span>
                          <textarea
                            key={step.id}
                            ref={getStepInstructionRef(step.id)}
                            aria-label={`Step ${step.sequence} description`}
                            className="ui-photo-mobile-textarea min-h-[84px]"
                            defaultValue={step.instruction}
                            onFocus={handleStepInstructionFocus}
                            onInput={handleStepInstructionInput}
                            onBlur={(event) => {
                              const instruction = event.currentTarget.value;
                              if (instruction !== step.instruction) {
                                void updateManufacturingStep(step.id, { instruction });
                              }
                            }}
                            placeholder="Describe the manufacturing step"
                          />
                        </label>
                      </div>
                      <details className="ui-photo-mobile-section">
                        <summary className="ui-photo-mobile-check-summary">Tools <span>{stepTools.length} added</span></summary>
                        <div className="mt-2">
                          {renderToolPicker(
                          stepTools,
                          (toolName) => void addManufacturingStepToolFromLibrary(step.id, toolName),
                          (toolName) => void removeManufacturingStepTool(step.id, toolName),
                          {
                            value: newStepToolNames[step.id] ?? "",
                            sequence: step.sequence,
                            onChange: (value) =>
                              setNewStepToolNames((current) => ({ ...current, [step.id]: value })),
                            disabled: saveState === "saving",
                          },
                        )}
                        </div>
                      </details>
                      <details className="ui-photo-mobile-section ui-photo-mobile-section-compact">
                        <summary className="ui-photo-mobile-check-summary">Checks <span>{selectedChecks.size} selected</span></summary>
                        <div className="ui-photo-mobile-check-editor mt-2">
                          <ProcedureStepChecksEditor ariaLabel={`Step ${step.sequence} checks`} compact definitions={stepCheckDefinitions}
                            qualityCheck={step.qualityCheck}
                            onChange={(qualityCheck) => void updateManufacturingStep(step.id, { qualityCheck })} />
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="ui-photo-mobile-body-secondary p-5">Select a process to capture step photos.</div>
          )}
        </section>
        )}
      </div>
      </div>
      {activeScreen === "list" && !showNewTaskForm ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-3 pt-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <div className="mx-auto max-w-xl">
            <button type="button" className="ui-photo-mobile-btn-primary min-h-11 w-full"
              onClick={() => {
                setNewTaskName("");
                setNewTaskZoneId(selectedTask?.zoneId ?? taskRows[taskRows.length - 1]?.zoneId ?? "");
                setNewTaskComponentId("");
                setShowNewTaskForm(true);
              }}>
              <Plus size={16} />
              Add process
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
