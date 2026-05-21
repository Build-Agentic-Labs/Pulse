"use client";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  ImageIcon,
  ListChecks,
  Menu,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { applyCalculatedFields, formatMinutes, getTimelineBounds, getTopLevelTasks } from "@/domain/calculations";
import { applyInstructionBullets, resolveBulletEnter } from "@/domain/instruction-bullets";
import { initialPlannerState } from "@/domain/seed";
import {
  getManufacturingStepCheckSet,
  manufacturingStepCheckOptions,
  serializeManufacturingStepCheckSet,
} from "@/domain/manufacturing-step-checks";
import {
  STEP_PHOTO_ATTACHMENTS_FIELD,
  getStepPhotoAttachments,
  removeStepPhotoAttachment,
  updateStepPhotoAttachment,
  upsertStepPhotoAttachments,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import { STEP_TOOL_LISTS_FIELD, addStepTool, buildStepToolLibrary, countTaskStepTools, getStepToolList, removeStepTool } from "@/domain/step-tools";
import {
  addStepToolToSupabase,
  loadToolLibraryFromSupabase,
  loadPlannerStateFromSupabase,
  removeStepToolFromSupabase,
  saveManufacturingStepToSupabase,
  savePlannerStateToSupabase,
  saveTaskAndManufacturingStepToSupabase,
  saveTaskToSupabase,
  saveTaskWithManufacturingStepsToSupabase,
  saveTasksToSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  subscribePlannerStateChanges,
  updateStepPhotoCaptionInSupabase,
  uploadToolLibraryImage,
  uploadStepPhotoAttachment,
  type ToolLibraryItem,
} from "@/domain/supabase-planner";
import type { ManufacturingStep, PlannerProjectContext, PlannerState, Task } from "@/domain/types";
import { NothingLoadingBlock, NothingSpinner } from "@/components/nothing-ui";

const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.72;
const MOBILE_DRAFT_DB_NAME = "buildlogic-mobile-drafts";
const MOBILE_DRAFT_STORE_NAME = "drafts";
const MOBILE_NEW_STEP_DRAFT_KEY = "mobile-new-step-draft-v1";

type MobileNewStepDraftRecord = {
  key: string;
  taskId: string;
  stepId: string | null;
  instruction: string;
  durationText: string;
  tools: string[];
  photos: StepPhotoAttachment[];
  checks: string[];
  updatedAt: string;
};

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

function compareTasksByWbs(left: Task, right: Task) {
  const leftParts = left.wbs.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.wbs.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return left.wbs.localeCompare(right.wbs);
}

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

function formatElapsedTimer(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");

  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

function elapsedMinutesFromTimer(milliseconds: number) {
  return milliseconds > 0 ? Math.max(1, Math.ceil(milliseconds / 60000)) : 0;
}

type CaptureTimerState = {
  running: boolean;
  startedAt: number | null;
  storedElapsedMs: number;
  lapMarkerMs: number;
  activeStepId: string | null;
  taskId: string | null;
  taskName: string;
};

type ParkedTaskCaptureState = {
  timer: CaptureTimerState;
  showNewStepForm: boolean;
  newStepId: string | null;
  draftInstruction: string;
  draftDurationText: string;
  draftTools: string[];
  draftPhotos: StepPhotoAttachment[];
  draftChecks: string[];
};

type MobileCaptureSessionSnapshot = {
  captureTimer: CaptureTimerState;
  parkedCaptureByTaskId: Record<string, ParkedTaskCaptureState>;
  activeScreen: "list" | "detail";
  selectedTaskId: string;
  showNewStepForm: boolean;
  newStepId: string | null;
};

const EMPTY_CAPTURE_TIMER: CaptureTimerState = {
  running: false,
  startedAt: null,
  storedElapsedMs: 0,
  lapMarkerMs: 0,
  activeStepId: null,
  taskId: null,
  taskName: "",
};

const EMPTY_CAPTURE_SESSION: MobileCaptureSessionSnapshot = {
  captureTimer: EMPTY_CAPTURE_TIMER,
  parkedCaptureByTaskId: {},
  activeScreen: "list",
  selectedTaskId: "",
  showNewStepForm: false,
  newStepId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeParkedTaskCaptureState(value: unknown): ParkedTaskCaptureState | null {
  if (!isRecord(value)) {
    return null;
  }

  const timer = normalizeCaptureTimerSnapshot(value.timer as Partial<CaptureTimerState>);
  if (!timer?.taskId || !timer.activeStepId) {
    return null;
  }

  return {
    timer,
    showNewStepForm: Boolean(value.showNewStepForm),
    newStepId: typeof value.newStepId === "string" ? value.newStepId : timer.activeStepId,
    draftInstruction: typeof value.draftInstruction === "string" ? value.draftInstruction : "",
    draftDurationText: typeof value.draftDurationText === "string" ? value.draftDurationText : "5",
    draftTools: Array.isArray(value.draftTools)
      ? value.draftTools.filter((tool): tool is string => typeof tool === "string")
      : [],
    draftPhotos: Array.isArray(value.draftPhotos)
      ? value.draftPhotos.filter((photo): photo is StepPhotoAttachment => isRecord(photo) && typeof photo.id === "string")
      : [],
    draftChecks: Array.isArray(value.draftChecks)
      ? value.draftChecks.filter((check): check is string => typeof check === "string")
      : [],
  };
}

function normalizeParkedCaptureByTaskId(value: unknown): Record<string, ParkedTaskCaptureState> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, ParkedTaskCaptureState>>((parked, [taskId, entry]) => {
    const normalized = normalizeParkedTaskCaptureState(entry);
    if (normalized) {
      parked[taskId] = normalized;
    }
    return parked;
  }, {});
}

function mobileCaptureSessionStorageKey(projectId?: string) {
  return projectId ? `pulse:mobile-capture-session:${projectId}` : "pulse:mobile-capture-session:default";
}

function legacyCaptureTimerStorageKey(projectId?: string) {
  return projectId ? `pulse:capture-timer:${projectId}` : "pulse:capture-timer:default";
}

function normalizeCaptureTimerSnapshot(value: Partial<CaptureTimerState> | null | undefined): CaptureTimerState | null {
  if (!value || typeof value.running !== "boolean") {
    return null;
  }

  return {
    running: value.running,
    startedAt: null,
    storedElapsedMs: typeof value.storedElapsedMs === "number" ? value.storedElapsedMs : 0,
    lapMarkerMs: typeof value.lapMarkerMs === "number" ? value.lapMarkerMs : 0,
    activeStepId: typeof value.activeStepId === "string" ? value.activeStepId : null,
    taskId: typeof value.taskId === "string" ? value.taskId : null,
    taskName: typeof value.taskName === "string" ? value.taskName : "",
  };
}

function readMobileCaptureSession(projectId?: string): MobileCaptureSessionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(mobileCaptureSessionStorageKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MobileCaptureSessionSnapshot>;
      const captureTimer = normalizeCaptureTimerSnapshot(parsed.captureTimer);
      if (!captureTimer) {
        return null;
      }

      return {
        captureTimer,
        parkedCaptureByTaskId: normalizeParkedCaptureByTaskId(parsed.parkedCaptureByTaskId),
        activeScreen: parsed.activeScreen === "detail" ? "detail" : "list",
        selectedTaskId: typeof parsed.selectedTaskId === "string" ? parsed.selectedTaskId : "",
        showNewStepForm: Boolean(parsed.showNewStepForm),
        newStepId: typeof parsed.newStepId === "string" ? parsed.newStepId : null,
      };
    }

    const legacyRaw = window.localStorage.getItem(legacyCaptureTimerStorageKey(projectId));
    if (!legacyRaw) {
      return null;
    }

    const legacyTimer = normalizeCaptureTimerSnapshot(JSON.parse(legacyRaw) as Partial<CaptureTimerState>);
    if (!legacyTimer) {
      return null;
    }

    return {
      captureTimer: legacyTimer,
      parkedCaptureByTaskId: {},
      activeScreen: legacyTimer.taskId ? "detail" : "list",
      selectedTaskId: legacyTimer.taskId ?? "",
      showNewStepForm: Boolean(legacyTimer.activeStepId),
      newStepId: legacyTimer.activeStepId,
    };
  } catch {
    return null;
  }
}

function shouldPersistMobileCaptureSession(session: MobileCaptureSessionSnapshot) {
  return (
    session.captureTimer.running ||
    session.captureTimer.storedElapsedMs > 0 ||
    Object.keys(session.parkedCaptureByTaskId).length > 0 ||
    session.activeScreen === "detail" ||
    session.showNewStepForm ||
    Boolean(session.selectedTaskId)
  );
}

function buildMobileCaptureSessionSnapshot(input: {
  captureTimer: CaptureTimerState;
  parkedCaptureByTaskId: Record<string, ParkedTaskCaptureState>;
  activeScreen: "list" | "detail";
  selectedTaskId: string;
  showNewStepForm: boolean;
  newStepId: string | null;
}): MobileCaptureSessionSnapshot {
  const timedStepId =
    input.captureTimer.taskId === input.selectedTaskId && input.captureTimer.activeStepId
      ? input.captureTimer.activeStepId
      : null;

  return {
    captureTimer: input.captureTimer,
    parkedCaptureByTaskId: input.parkedCaptureByTaskId,
    activeScreen: input.activeScreen,
    selectedTaskId: input.selectedTaskId,
    showNewStepForm: input.showNewStepForm || Boolean(timedStepId),
    newStepId: input.newStepId ?? timedStepId,
  };
}

function writeMobileCaptureSession(
  projectId: string | undefined,
  session: MobileCaptureSessionSnapshot,
  now: number,
) {
  if (typeof window === "undefined") {
    return;
  }

  const key = mobileCaptureSessionStorageKey(projectId);

  if (!shouldPersistMobileCaptureSession(session)) {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(legacyCaptureTimerStorageKey(projectId));
    return;
  }

  const payload: MobileCaptureSessionSnapshot = {
    ...session,
    captureTimer: {
      ...session.captureTimer,
      storedElapsedMs: getCaptureTimerElapsed(session.captureTimer, now),
      startedAt: null,
    },
    parkedCaptureByTaskId: Object.fromEntries(
      Object.entries(session.parkedCaptureByTaskId).map(([taskId, parked]) => [
        taskId,
        {
          ...parked,
          timer: {
            ...parked.timer,
            storedElapsedMs: getCaptureTimerElapsed(parked.timer, now),
            startedAt: null,
          },
        },
      ]),
    ),
  };

  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
    window.localStorage.removeItem(legacyCaptureTimerStorageKey(projectId));
  } catch {
    // Ignore quota/private-mode failures; in-memory state still works for this session.
  }
}

function clearMobileCaptureSession(projectId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(mobileCaptureSessionStorageKey(projectId));
    window.localStorage.removeItem(legacyCaptureTimerStorageKey(projectId));
  } catch {
    // Ignore storage cleanup failures.
  }
}

function restoreRunningCaptureTimer(snapshot: CaptureTimerState, now: number): CaptureTimerState {
  return {
    ...snapshot,
    running: true,
    storedElapsedMs: getCaptureTimerElapsed(snapshot, now),
    startedAt: now,
  };
}

function readCaptureTimerSnapshot(projectId?: string): CaptureTimerState | null {
  return readMobileCaptureSession(projectId)?.captureTimer ?? null;
}

function writeCaptureTimerSnapshot(projectId: string | undefined, timer: CaptureTimerState, now: number) {
  writeMobileCaptureSession(
    projectId,
    {
      ...EMPTY_CAPTURE_SESSION,
      captureTimer: timer,
    },
    now,
  );
}

function clearCaptureTimerSnapshot(projectId?: string) {
  clearMobileCaptureSession(projectId);
}

function getCaptureTimerElapsed(timer: CaptureTimerState, now: number) {
  if (!timer.running || !timer.startedAt) {
    return timer.storedElapsedMs;
  }

  return timer.storedElapsedMs + Math.max(0, now - timer.startedAt);
}

function getCaptureTimerLapElapsed(timer: CaptureTimerState, now: number) {
  return Math.max(0, getCaptureTimerElapsed(timer, now) - timer.lapMarkerMs);
}

function freezeCaptureTimer(timer: CaptureTimerState, now: number): CaptureTimerState {
  const elapsed = getCaptureTimerElapsed(timer, now);
  return {
    ...timer,
    running: false,
    startedAt: null,
    storedElapsedMs: elapsed,
  };
}

function preserveRunningCaptureTimer(timer: CaptureTimerState, now: number): CaptureTimerState {
  if (!timer.running) {
    return timer;
  }

  const elapsed = getCaptureTimerElapsed(timer, now);
  return {
    ...timer,
    running: true,
    startedAt: now,
    storedElapsedMs: elapsed,
  };
}

type HeaderCaptureTimerEntry = {
  taskId: string;
  taskName: string;
  timer: CaptureTimerState;
};

function isActiveHeaderCaptureTimer(timer: CaptureTimerState) {
  return Boolean(timer.taskId && timer.activeStepId && (timer.running || timer.storedElapsedMs > 0));
}

function collectHeaderCaptureTimers(
  captureTimer: CaptureTimerState,
  parkedCaptureByTaskId: Record<string, ParkedTaskCaptureState>,
): HeaderCaptureTimerEntry[] {
  const byTaskId = new Map<string, HeaderCaptureTimerEntry>();

  Object.values(parkedCaptureByTaskId).forEach((parked) => {
    if (!isActiveHeaderCaptureTimer(parked.timer) || !parked.timer.taskId) {
      return;
    }

    byTaskId.set(parked.timer.taskId, {
      taskId: parked.timer.taskId,
      taskName: parked.timer.taskName,
      timer: parked.timer,
    });
  });

  if (isActiveHeaderCaptureTimer(captureTimer) && captureTimer.taskId) {
    byTaskId.set(captureTimer.taskId, {
      taskId: captureTimer.taskId,
      taskName: captureTimer.taskName,
      timer: captureTimer,
    });
  }

  return [...byTaskId.values()];
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

function taskDependencyRefBelongsTo(ref: string, taskIds: Set<string>) {
  if (taskIds.has(ref)) {
    return true;
  }

  if (!ref.startsWith("step:")) {
    return false;
  }

  const [, taskId] = ref.split(":");
  return taskId ? taskIds.has(taskId) : false;
}

function applyTextareaCursor(textarea: HTMLTextAreaElement, cursorPosition: number) {
  window.requestAnimationFrame(() => {
    resizeTextareaToContent(textarea);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  });
}

function resizeTextareaToContent(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function restoreTextareaFocus(textarea: HTMLTextAreaElement | null, cursorPosition?: number) {
  if (!textarea) {
    return;
  }

  window.requestAnimationFrame(() => {
    resizeTextareaToContent(textarea);
    textarea.focus({ preventScroll: true });
    const nextCursorPosition = cursorPosition ?? textarea.value.length;
    textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
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

function readablePhotoDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Captured";
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read compressed photo."));
    reader.readAsDataURL(blob);
  });
}

function openMobileDraftDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local draft storage is not available in this browser."));
      return;
    }

    const request = indexedDB.open(MOBILE_DRAFT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(MOBILE_DRAFT_STORE_NAME)) {
        database.createObjectStore(MOBILE_DRAFT_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local draft storage."));
  });
}

async function saveMobileNewStepRecoveryDraft(draft: Omit<MobileNewStepDraftRecord, "key" | "updatedAt">) {
  const database = await openMobileDraftDb();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(MOBILE_DRAFT_STORE_NAME).put({
        ...draft,
        key: MOBILE_NEW_STEP_DRAFT_KEY,
        updatedAt: new Date().toISOString(),
      } satisfies MobileNewStepDraftRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save the local recovery draft."));
    });
  } finally {
    database.close();
  }
}

async function loadMobileNewStepRecoveryDraft() {
  const database = await openMobileDraftDb();

  try {
    return await new Promise<MobileNewStepDraftRecord | null>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_DRAFT_STORE_NAME, "readonly");
      const request = transaction.objectStore(MOBILE_DRAFT_STORE_NAME).get(MOBILE_NEW_STEP_DRAFT_KEY);
      request.onsuccess = () => resolve((request.result as MobileNewStepDraftRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Unable to load the local recovery draft."));
    });
  } finally {
    database.close();
  }
}

async function clearMobileNewStepRecoveryDraft() {
  const database = await openMobileDraftDb();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(MOBILE_DRAFT_STORE_NAME).delete(MOBILE_NEW_STEP_DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to clear the local recovery draft."));
    });
  } finally {
    database.close();
  }
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

  const baseStartMs = Date.parse(tasks[0].plannedStart);
  const lineStartMs = Number.isFinite(baseStartMs) ? baseStartMs : Date.now();
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
    const startMs = Math.max(lineStartMs, manualStartMs, dependencyFinishMs);
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

export function MobilePhotoPortal({
  projectId,
  projectContext,
}: {
  projectId?: string;
  projectContext?: PlannerProjectContext;
}) {
  const [plannerState, setPlannerState] = useState<PlannerState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [activeScreen, setActiveScreen] = useState<"list" | "detail">("list");
  const [saveState, setSaveState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [photoUploadCounts, setPhotoUploadCounts] = useState<Record<string, number>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskZoneId, setNewTaskZoneId] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragTargetTaskId, setDragTargetTaskId] = useState<string | null>(null);
  const [dragTargetPlacement, setDragTargetPlacement] = useState<"before" | "after">("after");
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; width: number } | null>(null);
  const [toolLibraryItems, setToolLibraryItems] = useState<ToolLibraryItem[]>([]);
  const [toolImageBusyKey, setToolImageBusyKey] = useState<string | null>(null);
  const [revealedPhotoDeleteId, setRevealedPhotoDeleteId] = useState<string | null>(null);
  const [revealedToolDeleteKey, setRevealedToolDeleteKey] = useState<string | null>(null);
  const [showNewStepForm, setShowNewStepForm] = useState(false);
  const [newStepInstruction, setNewStepInstruction] = useState("");
  const [newStepDurationText, setNewStepDurationText] = useState("5");
  const [newStepToolName, setNewStepToolName] = useState("");
  const [newStepId, setNewStepId] = useState<string | null>(null);
  const [newStepDraftTools, setNewStepDraftTools] = useState<string[]>([]);
  const [newStepDraftPhotos, setNewStepDraftPhotos] = useState<StepPhotoAttachment[]>([]);
  const [newStepDraftChecks, setNewStepDraftChecks] = useState<Set<string>>(() => new Set());
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
  const [mobileHeaderHeight, setMobileHeaderHeight] = useState(92);
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
  const photoHoldTimerRef = useRef<number | null>(null);
  const toolHoldTimerRef = useRef<number | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);
  const dragTargetTaskIdRef = useRef<string | null>(null);
  const dragTargetPlacementRef = useRef<"before" | "after">("after");
  const draftRestoreAttemptedRef = useRef(false);
  const newStepIdRef = useRef<string | null>(null);
  const newStepTouchedRef = useRef(false);
  const plannerStateRef = useRef<PlannerState | null>(null);
  const selectedTaskIdRef = useRef("");
  const remoteRefreshTimerRef = useRef<number | null>(null);
  const pendingRemoteRefreshRef = useRef(false);
  const sessionHydratedRef = useRef(false);

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

  const timelineStartMs = useMemo(() => {
    if (!derivedState) {
      return Date.now();
    }

    return getTimelineBounds(derivedState.tasks).startMs;
  }, [derivedState]);

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
  const toolImageByName = useMemo(() => {
    const images = new Map<string, ToolLibraryItem>();
    toolLibraryItems.forEach((tool) => {
      images.set(tool.toolName.toLocaleLowerCase(), tool);
    });
    return images;
  }, [toolLibraryItems]);
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
  }, [projectId]);

  useEffect(() => {
    if (!sessionHydratedRef.current) {
      sessionHydratedRef.current = true;
      const session = readMobileCaptureSession(projectId);
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
    );
  }, [captureTimer, parkedCaptureByTaskId, activeScreen, selectedTaskId, showNewStepForm, newStepId, projectId]);

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
      );
    }

    window.addEventListener("pagehide", flushSessionSnapshot);
    return () => window.removeEventListener("pagehide", flushSessionSnapshot);
  }, [activeScreen, showNewStepForm, projectId]);

  useEffect(() => {
    if (!captureTimer.running && !hasRunningParkedTimers) {
      return undefined;
    }

    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [captureTimer.running, hasRunningParkedTimers]);

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
    body.style.overflow = "auto";
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
  }, []);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      const draft = getNewStepDraftSnapshot();

      if (saveState === "saving" || saveState === "error" || hasDraftStepContent(draft)) {
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

  function hasLocalSaveWork() {
    return saveInFlightRef.current || Boolean(newStepAutosaveTimerRef.current);
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

  useEffect(() => {
    let mounted = true;

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

          setPlannerState(initialPlannerState);
          setSelectedTaskId(
            getTopLevelTasks(initialPlannerState.tasks)
              .filter((task) => task.rowType === "task")
              .sort(compareTasksByWbs)[0]?.id ?? "",
          );
          setSaveState("idle");
          return;
        }

        const firstTask = getTopLevelTasks(savedState.tasks)
          .filter((task) => task.rowType === "task")
          .sort(compareTasksByWbs)[0];
        const session = readMobileCaptureSession(projectId);
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
              setNewStepInstruction(restoredStep.instruction ?? "");
              if ((restoredStep.durationMinutes ?? 0) > 0) {
                setNewStepDurationText(String(restoredStep.durationMinutes));
              }
              setNewStepDraftTools(getStepToolList(restoredTask, restoredStepId));
              setNewStepDraftPhotos(getStepPhotoAttachments(restoredTask, restoredStepId));
              setNewStepDraftChecks(getManufacturingStepCheckSet(restoredStep.qualityCheck));
              newStepTouchedRef.current = true;
            }
          }
        }

        setSaveState("idle");
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
  }, [projectId]);

  useEffect(() => {
    if (!plannerState || draftRestoreAttemptedRef.current) {
      return;
    }

    draftRestoreAttemptedRef.current = true;

    void loadMobileNewStepRecoveryDraft()
      .then((draft) => {
        if (!draft || !plannerState.tasks.some((task) => task.id === draft.taskId)) {
          return;
        }

        const checks = new Set(draft.checks);
        const snapshot = {
          stepId: draft.stepId,
          instruction: draft.instruction,
          durationText: draft.durationText,
          tools: draft.tools,
          photos: draft.photos,
          checks,
        };

        if (!hasDraftStepContent(snapshot)) {
          void clearMobileNewStepRecoveryDraft().catch(() => undefined);
          return;
        }

        selectedTaskIdRef.current = draft.taskId;
        setSelectedTaskId(draft.taskId);
        setActiveScreen("detail");
        setShowNewStepForm(true);
        setDraftStepId(draft.stepId);
        setNewStepInstruction(draft.instruction);
        setNewStepDurationText(draft.durationText || "5");
        setNewStepDraftTools(draft.tools);
        setNewStepDraftPhotos(draft.photos);
        setNewStepDraftChecks(checks);
        newStepTouchedRef.current = true;
        setSaveState("saving");
        setErrorMessage("Recovered an unsaved phone draft. Saving it now; do not refresh until it shows Saved.");

        window.setTimeout(() => {
          selectedTaskIdRef.current = draft.taskId;
          persistNewStepDraft(snapshot, { saveTask: true, showSaving: true });
        }, 250);
      })
      .catch(() => undefined);
  }, [plannerState]);

  useEffect(() => {
    if (!plannerState?.scenario.id) {
      return undefined;
    }

    const unsubscribe = subscribePlannerStateChanges(
      () => {
        requestRemotePlannerRefresh();
      },
      {
        productId: plannerState.product.id,
        scenarioId: plannerState.scenario.id,
        taskIds: plannerState.tasks.map((task) => task.id),
      },
    );

    return () => {
      if (remoteRefreshTimerRef.current) {
        window.clearTimeout(remoteRefreshTimerRef.current);
      }
      unsubscribe();
    };
  }, [plannerState?.product.id, plannerState?.scenario.id, plannerState?.tasks]);

  function refreshWriteLock() {
    saveInFlightRef.current =
      localWriteCountRef.current > 0 || Object.keys(photoUploadQueuesRef.current).length > 0;
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
    const nextWrite = previousWrite.catch(() => undefined).then(saveOperation);
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
      snapshot.instruction.trim().length > 0 ||
      snapshot.tools.length > 0 ||
      snapshot.photos.length > 0 ||
      snapshot.checks.size > 0
    );
  }

  function getNewStepDraftSnapshot(overrides: Partial<{
    stepId: string | null;
    instruction: string;
    durationText: string;
    tools: string[];
    photos: StepPhotoAttachment[];
    checks: Set<string>;
  }> = {}) {
    return {
      stepId: overrides.stepId ?? newStepIdRef.current ?? newStepId,
      instruction: overrides.instruction ?? newStepInstruction,
      durationText: overrides.durationText ?? newStepDurationText,
      tools: overrides.tools ?? newStepDraftTools,
      photos: overrides.photos ?? newStepDraftPhotos,
      checks: overrides.checks ?? newStepDraftChecks,
    };
  }

  function saveRecoverableNewStepDraft(
    snapshot = getNewStepDraftSnapshot(),
    options: { taskId?: string } = {},
  ) {
    const taskId = options.taskId ?? selectedTaskIdRef.current;

    if (!taskId || !hasDraftStepContent(snapshot)) {
      return;
    }

    void saveMobileNewStepRecoveryDraft({
      taskId,
      stepId: snapshot.stepId,
      instruction: snapshot.instruction,
      durationText: snapshot.durationText,
      tools: snapshot.tools,
      photos: snapshot.photos,
      checks: [...snapshot.checks],
    }).catch(() => {
      setErrorMessage("This browser could not store the local recovery draft. Copy text/photos before refreshing.");
    });
  }

  function persistNewStepDraft(
    snapshot = getNewStepDraftSnapshot(),
    options: { saveTask?: boolean; showSaving?: boolean } = {},
  ) {
    clearNewStepAutosaveTimer();
    const currentState = plannerStateRef.current;
    const taskId = selectedTaskIdRef.current;

    if (!currentState || !taskId) {
      return null;
    }

    const currentTask = currentState.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      return null;
    }

    saveRecoverableNewStepDraft(snapshot, { taskId });

    const currentSteps = sortManufacturingSteps(currentTask.manufacturingSteps ?? []);
    const stepId = snapshot.stepId ?? ensureDraftStepId(currentTask.id);
    const existingStep = currentSteps.find((step) => step.id === stepId);
    const sequence = existingStep?.sequence ?? currentSteps.reduce((highest, step) => Math.max(highest, step.sequence), 0) + 1;
    const durationMinutes = Math.max(Number.parseFloat(snapshot.durationText) || 0, 0);
    const nextStep: ManufacturingStep = {
      ...existingStep,
      id: stepId,
      sequence,
      instruction: snapshot.instruction.trim(),
      durationMinutes,
      qualityCheck: serializeManufacturingStepCheckSet(snapshot.checks),
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

    beginLocalWrite();

    void enqueueTaskScopedWrite(taskId, async () => {
      await saveManufacturingStepToSupabase(taskId, nextStep, projectId);

      const uploadedPhotos = await Promise.all(
        snapshot.photos.map((photo) => uploadStepPhotoAttachment(taskId, stepId, photo, activeProjectContext)),
      );
      let persistedTask = withStepDerivedDuration(
        nextTask,
        (nextTask.manufacturingSteps ?? []).map((step) => (step.id === stepId ? nextStep : step)),
      );
      persistedTask = upsertStepPhotoAttachments(persistedTask, stepId, uploadedPhotos);
      persistedTask = snapshot.tools.reduce((taskWithTools, tool) => addStepTool(taskWithTools, stepId, tool), persistedTask);

      if (uploadedPhotos.length) {
        updateLocalTask(taskId, (task) => upsertStepPhotoAttachments(task, stepId, uploadedPhotos));
      }

      if (options.saveTask) {
        await saveTaskToSupabase(persistedTask, projectId);
      }
    })
      .then(() => {
        void clearMobileNewStepRecoveryDraft().catch(() => undefined);
        setSaveState("saved");
      })
      .catch((error) => {
        setSaveState("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to autosave the manufacturing step.");
      })
      .finally(() => {
        endLocalWrite();
      });

    return stepId;
  }

  function scheduleNewStepAutosave(overrides: Parameters<typeof getNewStepDraftSnapshot>[0] = {}) {
    clearNewStepAutosaveTimer();
    const taskId = selectedTaskIdRef.current;
    const stepId = taskId ? ensureDraftStepId(taskId) : overrides.stepId ?? newStepIdRef.current;
    newStepTouchedRef.current = true;
    const snapshot = getNewStepDraftSnapshot({ ...overrides, stepId });
    saveRecoverableNewStepDraft(snapshot);
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
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save step photos.");
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

  function taskScheduleChanged(previousTask: Task | undefined, nextTask: Task) {
    return (
      !previousTask ||
      previousTask.plannedStart !== nextTask.plannedStart ||
      previousTask.plannedFinish !== nextTask.plannedFinish ||
      previousTask.plannedDurationMinutes !== nextTask.plannedDurationMinutes
    );
  }

  async function persistTaskWithStepRows(nextTask: Task, changedStepId: string, shouldReschedule = false) {
    if (!plannerState) {
      return;
    }

    const previousTaskById = new Map(plannerState.tasks.map((task) => [task.id, task]));
    const nextState = withUpdatedTask(plannerState, nextTask, shouldReschedule);
    const persistedTask = nextState.tasks.find((task) => task.id === nextTask.id) ?? nextTask;
    const rescheduledTasks = shouldReschedule
      ? nextState.tasks.filter((task) => task.id !== persistedTask.id && taskScheduleChanged(previousTaskById.get(task.id), task))
      : [];
    const persistedStep = persistedTask.manufacturingSteps?.find((step) => step.id === changedStepId);

    if (!persistedStep) {
      setSaveState("error");
      setErrorMessage("Unable to save the manufacturing step.");
      return;
    }

    await persistTargetedState(nextState, async () => {
      if (rescheduledTasks.length) {
        await saveTasksToSupabase(rescheduledTasks, projectId);
      }
      await saveTaskAndManufacturingStepToSupabase(persistedTask, persistedStep, projectId);
    });
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
      setErrorMessage("Add a task name before saving.");
      setSaveState("error");
      return;
    }

    const currentTasks = plannerState.tasks;
    const zoneId = newTaskZoneId || undefined;
    const zoneTasks = taskRows.filter((task) => (zoneId ? task.zoneId === zoneId : !task.zoneId));
    const contextTask = zoneTasks[zoneTasks.length - 1] ?? taskRows[taskRows.length - 1] ?? selectedTask ?? currentTasks[currentTasks.length - 1];
    const fallbackStart = currentTasks[0]?.plannedStart ?? new Date().toISOString();
    const start = contextTask?.plannedFinish ?? fallbackStart;
    const newTask: Task = {
      id: `task-${Date.now()}`,
      scenarioId: plannerState.scenario.id,
      stationId: zoneId ? stationIdForZone(zoneId) : contextTask?.stationId ?? plannerState.stations[0]?.id ?? "",
      zoneId,
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

    await persistTargetedState(nextState, () => saveTaskToSupabase(newTask, projectId));
    setSelectedTaskId(newTask.id);
    setNewTaskName("");
    setNewTaskZoneId("");
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
        setRevealedPhotoDeleteId(null);
        await removePhoto(stepId, photo.id);
      },
    });
  }

  async function updatePhotoCaption(stepId: string, photoId: string, caption: string) {
    if (!plannerState || !selectedTask) {
      return;
    }

    const taskId = selectedTask.id;
    const normalizedCaption = caption.trim();
    const currentTask = plannerState.tasks.find((task) => task.id === selectedTask.id) ?? selectedTask;
    const previousPhoto = getStepPhotoAttachments(currentTask, stepId).find((photo) => photo.id === photoId);

    if ((previousPhoto?.caption ?? "") === normalizedCaption) {
      return;
    }

    updateLocalTask(taskId, (task) => updateStepPhotoAttachment(task, stepId, photoId, { caption: normalizedCaption }));
    setErrorMessage(null);
    beginLocalWrite();
    setSaveState("saving");

    try {
      await updateStepPhotoCaptionInSupabase(photoId, normalizedCaption, selectedTask.id, projectId);
      setSaveState("saved");
    } catch (error) {
      if (previousPhoto) {
        updateLocalTask(taskId, (task) => upsertStepPhotoAttachments(task, stepId, [previousPhoto]));
      }
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save the photo note.");
    } finally {
      endLocalWrite();
    }
  }

  async function addManufacturingStepTool(stepId: string) {
    if (!plannerState || !selectedTask) {
      return;
    }

    const nextTool = (newStepToolNames[stepId] ?? "").trim();
    if (!nextTool) {
      return;
    }

    const taskId = selectedTask.id;
    updateLocalTask(taskId, (task) => addStepTool(task, stepId, nextTool));
    setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
    beginLocalWrite();

    try {
      await enqueueTaskScopedWrite(taskId, async () => {
        await addStepToolToSupabase(taskId, stepId, nextTool, getStepToolList(selectedTask, stepId).length + 1, projectId);
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to add the tool.");
    } finally {
      endLocalWrite();
    }
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
    await persistTaskWithStepRows(nextTask, stepId, false);
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
      draftInstruction: snapshot.instruction,
      draftDurationText: snapshot.durationText,
      draftTools: snapshot.tools,
      draftPhotos: snapshot.photos,
      draftChecks: [...snapshot.checks],
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
    setNewStepInstruction(parked.draftInstruction);
    setNewStepDurationText(parked.draftDurationText || "5");
    setNewStepDraftTools(parked.draftTools);
    setNewStepDraftPhotos(parked.draftPhotos);
    setNewStepDraftChecks(new Set(parked.draftChecks));
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
      setNewStepInstruction(step.instruction ?? "");
      if ((step.durationMinutes ?? 0) > 0) {
        setNewStepDurationText(String(step.durationMinutes));
      }
      setNewStepDraftTools(getStepToolList(task, stepId));
      setNewStepDraftPhotos(getStepPhotoAttachments(task, stepId));
      setNewStepDraftChecks(getManufacturingStepCheckSet(step.qualityCheck));
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
    setNewStepInstruction("");
    setNewStepDurationText(durationText);
    setNewStepToolName("");
    setNewStepDraftTools([]);
    setNewStepDraftPhotos([]);
    setNewStepDraftChecks(new Set());
    setNewStepPhotoBusyCount(0);
  }

  function getNewStepDefaultDurationText() {
    const defaultDuration = selectedTaskSteps.length === 0
      ? Math.max(Math.round(selectedTask?.plannedDurationMinutes ?? 5), 5)
      : 5;

    return String(defaultDuration);
  }

  function openNewStepForm() {
    if (!selectedTask) {
      return;
    }

    const stepId = buildNewStepId(selectedTask.id);
    resetNewStepDraft(getNewStepDefaultDurationText(), stepId);
    setShowNewStepForm(true);

    if (captureTimerRef.current.running && captureTimerRef.current.taskId === selectedTask.id) {
      bindCaptureTimerToStep(selectedTask, stepId);
    }
  }

  function closeNewStepForm() {
    if (selectedTask && hasTimedCaptureForTask(selectedTask.id)) {
      return;
    }

    clearNewStepAutosaveTimer();
    setShowNewStepForm(false);
    resetNewStepDraft("5", null);
  }

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

  function addNewStepDraftTool() {
    const nextTool = newStepToolName.trim();
    if (!nextTool) {
      return;
    }

    const alreadyExists = newStepDraftTools.some((tool) => tool.toLocaleLowerCase() === nextTool.toLocaleLowerCase());
    const nextTools = alreadyExists ? newStepDraftTools : [...newStepDraftTools, nextTool];
    setNewStepDraftTools(nextTools);
    setNewStepToolName("");
    newStepTouchedRef.current = true;
    persistNewStepDraft(getNewStepDraftSnapshot({ tools: nextTools }), { saveTask: true, showSaving: true });
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

  async function handleToolImageFile(toolName: string, file: File | undefined) {
    if (!file) {
      return;
    }

    const toolKey = toolName.toLocaleLowerCase();
    setToolImageBusyKey(toolKey);
    setSaveState("saving");
    setErrorMessage(null);

    try {
      const photo = await buildPhotoAttachment(file);
      const savedTool = await uploadToolLibraryImage(toolName, photo, activeProjectContext);
      setToolLibraryItems((current) => {
        const nextItems = current.filter((tool) => tool.toolName.toLocaleLowerCase() !== toolKey);
        return [...nextItems, savedTool].sort((left, right) => left.toolName.localeCompare(right.toolName, undefined, { sensitivity: "base" }));
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload the tool image.");
    } finally {
      setToolImageBusyKey(null);
    }
  }

  function clearPhotoHoldTimer() {
    if (photoHoldTimerRef.current) {
      window.clearTimeout(photoHoldTimerRef.current);
      photoHoldTimerRef.current = null;
    }
  }

  function startPhotoHold(photoId: string) {
    clearPhotoHoldTimer();
    photoHoldTimerRef.current = window.setTimeout(() => {
      setRevealedPhotoDeleteId(photoId);
      photoHoldTimerRef.current = null;
    }, 450);
  }

  function cancelPhotoHold() {
    clearPhotoHoldTimer();
  }

  function clearToolHoldTimer() {
    if (toolHoldTimerRef.current) {
      window.clearTimeout(toolHoldTimerRef.current);
      toolHoldTimerRef.current = null;
    }
  }

  function startToolHold(toolName: string) {
    clearToolHoldTimer();
    toolHoldTimerRef.current = window.setTimeout(() => {
      setRevealedToolDeleteKey(toolName.toLocaleLowerCase());
      toolHoldTimerRef.current = null;
    }, 450);
  }

  function cancelToolHold() {
    clearToolHoldTimer();
  }

  function renderToolVisual(toolName: string) {
    const toolImage = toolImageByName.get(toolName.toLocaleLowerCase());

    if (toolImage?.imageUrl) {
      return (
        <div className="relative aspect-[4/3] overflow-hidden rounded bg-surface">
          <img src={toolImage.imageUrl} alt={toolName} className="h-full w-full object-cover" />
        </div>
      );
    }

    const lowerToolName = toolName.toLocaleLowerCase();
    const toolType = lowerToolName.includes("socket")
      ? "socket"
      : lowerToolName.includes("impact")
        ? "impact"
        : lowerToolName.includes("torque")
          ? "torque"
          : lowerToolName.includes("loctite")
            ? "loctite"
            : lowerToolName.includes("ratchet")
              ? "ratchet"
              : lowerToolName.includes("wrench")
                ? "wrench"
                : "wrench";

    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded bg-surface">
        <img src={`/tool-images/${toolType}.png`} alt={toolName} className="h-full w-full object-cover" />
      </div>
    );
  }

  function renderToolPicker(
    selectedTools: string[],
    onAddTool: (toolName: string) => void,
    onRemoveTool: (toolName: string) => void,
  ) {
    const toolNames = [...new Set(selectedTools)]
      .filter((tool) => tool.trim())
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    const selectedToolKeys = new Set(toolNames.map((tool) => tool.toLocaleLowerCase()));
    const libraryTools = [...new Set(toolLibrary)]
      .filter((tool) => tool.trim())
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

    return (
      <div className="mt-2 space-y-3">
        {toolNames.length > 0 ? (
          <div className="grid grid-cols-5 gap-1">
            {toolNames.map((tool) => {
              const toolKey = tool.toLocaleLowerCase();

              return (
                <button
                  key={tool}
                  type="button"
                  onPointerDown={() => startToolHold(tool)}
                  onPointerUp={cancelToolHold}
                  onPointerCancel={cancelToolHold}
                  onPointerLeave={cancelToolHold}
                  onContextMenu={(event) => event.preventDefault()}
                  className="group min-w-0 rounded border border-line bg-surface p-0.5 text-left transition active:scale-[0.99]"
                  aria-pressed
                >
                  <div className="relative">
                    {renderToolVisual(tool)}
                    {toolImageBusyKey === toolKey ? (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-steel">
                        <NothingSpinner inline />
                      </span>
                    ) : null}
                    <span
                      className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-canvas transition md:opacity-0 md:group-hover:opacity-100 ${
                        revealedToolDeleteKey === toolKey ? "opacity-100" : "opacity-0"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setRevealedToolDeleteKey(null);
                        onRemoveTool(tool);
                      }}
                      role="button"
                      aria-label={`Remove ${tool}`}
                      title={`Remove ${tool}`}
                    >
                      <Trash2 size={11} />
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 min-h-[18px] text-[8px] font-medium leading-tight text-ink">
                    {tool}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-line bg-surface-raised px-3 py-2 text-xs font-bold text-steel">
            No tools added to this step yet.
          </div>
        )}
        {libraryTools.length > 0 ? (
          <div>
            <div className="mb-1 ui-mono-label">Tool library</div>
            <select
              className="h-10 w-full rounded border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-accent"
              defaultValue=""
              onChange={(event) => {
                const tool = event.currentTarget.value;
                if (tool) {
                  onAddTool(tool);
                  event.currentTarget.value = "";
                }
              }}
            >
              <option value="">Add from tool library</option>
              {libraryTools.map((tool) => {
                const alreadyAdded = selectedToolKeys.has(tool.toLocaleLowerCase());
                return (
                  <option key={tool} value={tool} disabled={alreadyAdded}>
                    {alreadyAdded ? `${tool} - already added` : tool}
                  </option>
                );
              })}
            </select>
          </div>
        ) : null}
      </div>
    );
  }

  function toggleNewStepDraftCheck(checkKey: string, checked: boolean) {
    const nextChecks = new Set(newStepDraftChecks);

    if (checked) {
      nextChecks.add(checkKey);
    } else {
      nextChecks.delete(checkKey);
    }

    setNewStepDraftChecks(nextChecks);
    newStepTouchedRef.current = true;
    persistNewStepDraft(getNewStepDraftSnapshot({ checks: nextChecks }), { showSaving: true });
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

  function updateNewStepDraftPhotoCaption(photoId: string, caption: string) {
    const nextPhotos = newStepDraftPhotos.map((photo) =>
      photo.id === photoId ? { ...photo, caption } : photo,
    );

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

    const durationMinutes = Math.max(Number.parseFloat(snapshot.durationText) || 0, 0);
    if (newStepTouchedRef.current || hasDraftStepContent(snapshot) || durationMinutes > 0) {
      persistNewStepDraft(snapshot, { saveTask: true, showSaving: true });
    }

    const completedStepId =
      currentStepId &&
      (newStepTouchedRef.current || hasDraftStepContent(snapshot) || durationMinutes > 0)
        ? currentStepId
        : null;

    beginNewStepEnterMotion(completedStepId, () => {
      const nextStepId = selectedTask ? buildNewStepId(selectedTask.id) : null;
      resetNewStepDraft("5", nextStepId);
      setShowNewStepForm(true);

      if (captureTimer.running) {
        advanceCaptureTimerLap(nextStepId);
      }
    });
  }

  function selectTask(taskId: string) {
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
      <main className="mobile-photo-portal flex min-h-[100svh] items-center justify-center bg-canvas p-6 text-ink">
        <section className="ui-panel w-full max-w-md p-8">
          <NothingLoadingBlock title="Loading" body="Reading manufacturing steps and photo drafts." />
        </section>
      </main>
    );
  }

  return (
    <main className="mobile-photo-portal min-h-[100svh] bg-canvas text-ink">
      <header
        ref={mobileHeaderRef}
        className="fixed inset-x-0 top-0 z-50 border-b border-line bg-surface px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-ink"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="ui-mono-label">Pulse Capture</div>
            <h1 className="mt-1 truncate text-lg font-medium text-ink">
              {derivedState?.product.name ?? "Manufacturing Photos"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerCaptureTimers.length > 0 ? (
              <div className="ui-photo-mobile-header-timers">
                {headerCaptureTimers.map((entry, index) => {
                  const taskName = taskRows.find((task) => task.id === entry.taskId)?.name ?? entry.taskName;
                  const elapsedMs = getCaptureTimerElapsed(entry.timer, timerNow);
                  const isViewingEntry = activeScreen === "detail" && selectedTaskId === entry.taskId;
                  const timerTitle = `${taskName || "Process"} · ${formatElapsedTimer(elapsedMs)}`;

                  return (
                    <Fragment key={entry.taskId}>
                      {index > 0 ? <span className="ui-photo-mobile-header-timer-divider" aria-hidden="true" /> : null}
                      {isViewingEntry ? (
                        <div
                          className="ui-btn-ghost ui-photo-mobile-header-timer-current h-10 gap-2 px-2"
                          title={timerTitle}
                        >
                          <span className="ui-photo-mobile-header-timer-name">{taskName || "Process"}</span>
                          <span className="ui-photo-mobile-header-timer-value">{formatElapsedTimer(elapsedMs)}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCaptureTaskFromHeader(entry.taskId)}
                          className="ui-btn-ghost h-10 gap-2 px-2"
                          title={
                            entry.timer.running
                              ? `Open ${taskName || "this process"} · timer running`
                              : `Open ${taskName || "this process"}`
                          }
                        >
                          <span className="ui-photo-mobile-header-timer-name">{taskName || "Process"}</span>
                          <span className="ui-photo-mobile-header-timer-value">{formatElapsedTimer(elapsedMs)}</span>
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
                      className="ui-btn-ghost h-10 shrink-0 text-danger hover:text-danger"
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
                className="ui-btn-ghost h-10 gap-2 px-3"
                title={`Start timer for ${selectedTask?.name ?? "this process"}`}
              >
                <Timer size={14} />
                Timer
              </button>
            ) : null}
            <a
              href={projectId ? `/projects/${projectId}/planner` : "/"}
              className="ui-btn-ghost h-10 px-3 text-xs"
            >
              Planner
            </a>
          </div>
        </div>
      </header>

      <div
        ref={contentScrollRef}
        className="min-h-0"
        style={{
          paddingTop: mobileHeaderHeight,
          scrollPaddingBottom: showNewStepForm
            ? "calc(4.5rem + env(safe-area-inset-bottom))"
            : "calc(2.5rem + env(safe-area-inset-bottom))",
        }}
      >
      <div
        className={`mx-auto max-w-xl p-3 ${
          showNewStepForm
            ? "pb-[calc(4.5rem+env(safe-area-inset-bottom))]"
            : "pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
        }`}
      >
        {restorePrompt ? (
          <div className="mb-3 rounded-md border border-accent/40 bg-accent-muted p-3">
            <div className="text-sm font-medium text-ink">{restorePrompt.title}</div>
            <div className="mt-1 text-xs font-bold leading-snug text-steel">{restorePrompt.body}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRestorePrompt(null)}
                className="h-9 rounded border border-line bg-surface text-xs font-medium text-ink active:bg-surface-sunken"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => void restorePrompt.onRestore()}
                disabled={saveState === "saving"}
                className="h-9 rounded bg-accent px-3 text-xs font-medium text-canvas active:bg-highlight-hover disabled:opacity-60"
              >
                {restorePrompt.restoreLabel}
              </button>
            </div>
          </div>
        ) : null}
        {confirmPrompt ? (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger-muted p-3">
            <div className="text-sm font-medium text-danger">{confirmPrompt.title}</div>
            <div className="mt-1 text-xs font-bold leading-snug text-steel">{confirmPrompt.body}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmPrompt(null)}
                className="h-9 rounded border border-line bg-surface text-xs font-medium text-ink active:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPrompt.onConfirm()}
                disabled={saveState === "saving"}
                className="h-9 rounded bg-danger px-3 text-xs font-medium text-canvas active:bg-danger-hover disabled:opacity-60"
              >
                {confirmPrompt.confirmLabel}
              </button>
            </div>
          </div>
        ) : null}
        {activeScreen === "list" ? (
        <section className="min-w-0 ui-panel">
          <div className="border-b border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs ui-mono-label tracking-wide text-steel">High-Level Processes</div>
                <div className="text-sm font-medium text-ink">
                  {taskRows.length} {taskRows.length === 1 ? "task" : "tasks"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewTaskName("");
                    setNewTaskZoneId(selectedTask?.zoneId ?? taskRows[taskRows.length - 1]?.zoneId ?? "");
                    setShowNewTaskForm((current) => !current);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded bg-accent px-2 text-xs font-medium text-canvas active:bg-ink"
                >
                  <Plus size={13} />
                  Task
                </button>
              </div>
            </div>
            {errorMessage ? (
              <div className="mt-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 text-xs font-bold text-danger">
                {errorMessage}
              </div>
            ) : null}
            {showNewTaskForm ? (
              <div className="mt-3 rounded border border-accent/35 bg-accent-muted p-2.5">
                <label className="block">
                  <span className="mb-1 block text-[11px] ui-mono-label tracking-wide text-accent">
                    New high-level task
                  </span>
                  <input
                    className="h-11 w-full rounded border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-accent"
                    value={newTaskName}
                    onChange={(event) => setNewTaskName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void addHighLevelTask();
                      }
                    }}
                    placeholder="Task name"
                  />
                </label>
                <label className="mt-2 block">
                  <span className="mb-1 block text-[11px] ui-mono-label tracking-wide text-accent">
                    Zone
                  </span>
                  <select
                    className="h-11 w-full rounded border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-accent"
                    value={newTaskZoneId}
                    onChange={(event) => setNewTaskZoneId(event.target.value)}
                  >
                    <option value="">No zone</option>
                    {derivedState?.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewTaskName("");
                      setNewTaskZoneId("");
                      setShowNewTaskForm(false);
                    }}
                    className="h-10 rounded border border-line bg-surface px-3 text-xs font-medium text-ink active:bg-surface-sunken"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void addHighLevelTask()}
                    disabled={saveState === "saving"}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded bg-accent px-3 text-xs font-medium text-canvas active:bg-ink disabled:opacity-60"
                  >
                    {saveState === "saving" ? <NothingSpinner inline /> : <Plus size={14} />}
                    Add Task
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div>
            {taskRows.map((task, index) => {
              const stepCount = task.manufacturingSteps?.length ?? 0;
              const selected = task.id === selectedTask?.id;
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
                    onClick={() => selectTask(task.id)}
                    className="block min-w-0 flex-1 bg-surface px-3 py-3 text-left transition active:bg-surface-active"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-canvas text-xs font-medium text-steel">
                        {task.wbs}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{task.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-steel">
                          <span>{zoneLabel}</span>
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

              const draggingZoneName = draggingTask.zoneId ? zoneById.get(draggingTask.zoneId) : undefined;
              const draggingZoneLabel = draggingZoneName ?? "No zone";
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
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent text-xs font-medium text-canvas">
                        {draggingTask.wbs}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{draggingTask.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-steel">
                          <span>{draggingZoneLabel}</span>
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
        </section>
        ) : (
        <section className="min-w-0 ui-panel">
          {selectedTask ? (
            <>
              <div className="border-b border-line p-4">
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={showProcessList}
                    className="inline-flex items-center gap-1 text-xs ui-mono-label tracking-wide text-steel"
                  >
                    <ChevronLeft size={14} />
                    Process list
                  </button>
                </div>
                <div className="ui-mono-label">
                  {selectedTask.zoneId ? zoneById.get(selectedTask.zoneId) ?? "Process" : "Process"}
                </div>
                <label className="mt-2 block">
                  <span className="mb-1 block ui-mono-label">
                    High-level task name
                  </span>
                  <div className="grid grid-cols-[52px_minmax(0,1fr)] overflow-hidden rounded border border-line bg-surface">
                    <div className="flex items-center justify-center border-r border-line bg-surface-raised text-sm font-medium text-steel">
                      {selectedTask.wbs}
                    </div>
                    <input
                      key={selectedTask.id}
                      aria-label="High-level task name"
                      className="h-11 min-w-0 px-3 text-lg font-medium leading-tight text-ink outline-none focus:bg-accent-muted"
                      defaultValue={selectedTask.name}
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
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-steel">
                  <span>{formatMinutes((Date.parse(selectedTask.plannedStart) - timelineStartMs) / 60000)} start</span>
                  <span>{formatMinutes(selectedTask.plannedDurationMinutes)} duration</span>
                  <span>
                    {selectedTask.plannedOperators} {selectedTask.plannedOperators === 1 ? "operator" : "operators"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 p-3">
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
                      <div>
                        <div className="text-[11px] ui-mono-label tracking-wide text-accent">Step {draftStepSequence}</div>
                        <div className="text-sm font-medium text-ink">
                          {draftStepSequence === 1 ? "Add manufacturing step" : `Capture step ${draftStepSequence}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={closeNewStepForm}
                        disabled={captureTimer.running}
                        className="text-xs ui-mono-label tracking-wide text-steel disabled:opacity-40"
                      >
                        {captureTimer.running ? "Timer On" : "Close"}
                      </button>
                    </div>
                    {errorMessage ? (
                      <div className="m-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 text-xs font-bold text-danger">
                        {errorMessage}
                      </div>
                    ) : null}
                    <div className="px-3 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                        {draftStepSequence}
                      </span>
                      <div>
                        <div className="ui-mono-label">Instructions</div>
                        <div className="text-[10px] ui-mono-label tracking-wide text-accent">Step {draftStepSequence}</div>
                      </div>
                    </div>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between gap-2">
                        <span className="ui-mono-label">Description</span>
                        <button
                          type="button"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            const instruction = applyInstructionBullets(newStepInstruction);
                            setNewStepInstruction(instruction);
                            scheduleNewStepAutosave({ instruction });
                            restoreTextareaFocus(newStepInstructionRef.current, instruction.length);
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded border border-line bg-surface px-2 text-[10px] ui-mono-label text-steel active:bg-surface-sunken"
                          aria-label="Format new step as bullets"
                          title="Format new step as bullets"
                        >
                          <ListChecks size={12} />
                          Bullets
                        </button>
                      </span>
                      <textarea
                        ref={(node) => {
                          newStepInstructionRef.current = node;
                          if (node) {
                            window.requestAnimationFrame(() => resizeTextareaToContent(node));
                          }
                        }}
                        className="min-h-[104px] w-full resize-none overflow-hidden rounded border border-line bg-surface px-3 py-2 text-sm font-semibold leading-snug text-ink outline-none focus:border-accent"
                        value={newStepInstruction}
                        onChange={(event) => {
                          const instruction = event.target.value;
                          resizeTextareaToContent(event.currentTarget);
                          setNewStepInstruction(instruction);
                          scheduleNewStepAutosave({ instruction });
                        }}
                        onFocus={(event) => resizeTextareaToContent(event.currentTarget)}
                        onInput={(event) => resizeTextareaToContent(event.currentTarget)}
                        onKeyDown={(event) =>
                          handleInstructionBulletKeyDown(event, (instruction) => {
                            setNewStepInstruction(instruction);
                            scheduleNewStepAutosave({ instruction });
                          })
                        }
                        placeholder="Describe the manufacturing step"
                      />
                    </label>
                    <label className="mt-3 block max-w-[150px]">
                      <span className="mb-1 block ui-mono-label">
                        Duration
                      </span>
                      {captureTimer.running && isTimerOnSelectedTask && captureTimer.activeStepId === newStepId ? (
                        <div className="mb-1 text-[10px] font-medium text-steel">
                          Step lap {formatElapsedTimer(captureTimerLapElapsedMs)}
                          <span className="text-ink-tertiary"> · process {formatElapsedTimer(captureTimerElapsedMs)}</span>
                        </div>
                      ) : captureTimer.running && isTimerOnSelectedTask ? (
                        <div className="mb-1 text-[10px] font-medium text-steel">
                          Process {formatElapsedTimer(captureTimerElapsedMs)}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-[1fr_56px] overflow-hidden rounded border border-line bg-surface">
                        <input
                          className="h-11 min-w-0 px-3 text-base font-medium text-ink outline-none"
                          type="text"
                          inputMode="numeric"
                          value={newStepDurationText}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (/^\d*\.?\d*$/.test(value)) {
                              setNewStepDurationText(value);
                              scheduleNewStepAutosave({ durationText: value });
                            }
                          }}
                        />
                        <div className="flex items-center justify-center border-l border-line bg-surface-raised text-xs ui-mono-label tracking-wide text-steel">
                          min
                        </div>
                      </div>
                    </label>
                    </div>
                    <div className="border-t border-line px-3 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                          2
                        </span>
                        <div className="ui-mono-label">
                          Checks
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {manufacturingStepCheckOptions.map((option) => {
                          const checked = newStepDraftChecks.has(option.key);

                          return (
                            <label
                              key={option.key}
                              className={`grid min-h-9 grid-cols-[18px_minmax(0,1fr)] items-center gap-1.5 rounded border px-2 text-[10px] font-medium transition ${
                                checked
                                  ? "border-accent/30 bg-accent/10 text-accent"
                                  : "border-line bg-surface-raised text-steel active:border-accent"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 shrink-0 accent-accent"
                                checked={checked}
                                onChange={(event) => toggleNewStepDraftCheck(option.key, event.target.checked)}
                              />
                              <span className="min-w-0 text-left leading-tight">{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="border-t border-line px-3 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                          3
                        </span>
                        <div className="ui-mono-label">
                          Tools & Parts · {newStepDraftTools.length}
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_68px] gap-2">
                        <input
                          className="h-10 min-w-0 rounded border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-accent"
                          value={newStepToolName}
                          onChange={(event) => setNewStepToolName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addNewStepDraftTool();
                            }
                          }}
                          placeholder="Tool"
                        />
                        <button
                          type="button"
                          onClick={addNewStepDraftTool}
                          className="h-10 rounded bg-accent px-2 text-xs font-medium text-canvas active:bg-ink"
                        >
                          Add
                        </button>
                      </div>
                      {renderToolPicker(newStepDraftTools, addNewStepDraftToolFromLibrary, removeNewStepDraftTool)}
                    </div>
                    <div className="border-t border-line px-3 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                          4
                        </span>
                        <div className="ui-mono-label">
                          Photos · {newStepDraftPhotos.length}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="inline-flex h-10 items-center justify-center gap-2 rounded bg-accent px-3 text-xs font-medium text-canvas active:bg-ink">
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
                        <label className="inline-flex h-10 items-center justify-center gap-2 rounded border border-line bg-surface px-3 text-xs font-medium text-ink active:bg-surface-sunken">
                          {newStepPhotoBusyCount > 0 ? <NothingSpinner inline /> : <ImageIcon size={15} />}
                          Library
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
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {newStepDraftPhotos.map((photo) => (
                            <div key={photo.id} className="overflow-hidden rounded border border-line bg-surface-raised">
                              <img
                                src={photo.dataUrl}
                                alt="New step photo"
                                className="aspect-[5/4] w-full object-cover"
                              />
                              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] font-medium text-ink">{photo.name}</div>
                                  <div className="text-[10px] font-bold text-steel">
                                    {readablePhotoDate(photo.capturedAt)}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeNewStepDraftPhoto(photo.id)}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-steel active:bg-danger-muted active:text-danger"
                                  aria-label="Remove photo"
                                  title="Remove photo"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                              <label className="block border-t border-line px-1.5 py-1">
                                <span className="sr-only">Photo note</span>
                                <textarea
                                  className="min-h-[34px] w-full resize-none rounded border border-line bg-surface px-1.5 py-1 text-[11px] font-semibold leading-tight text-ink outline-none placeholder:text-steel/60 focus:border-accent"
                                  value={photo.caption ?? ""}
                                  onChange={(event) => updateNewStepDraftPhotoCaption(photo.id, event.currentTarget.value)}
                                  placeholder="Caption"
                                  rows={2}
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-2 rounded border border-dashed border-line bg-surface-raised px-3 py-2 text-xs font-bold text-steel">
                          <ImageIcon size={14} />
                          Photos can be attached before this step is saved.
                        </div>
                      )}
                    </div>
                    <div className="ui-photo-mobile-next-step-bar">
                      <button
                        type="button"
                        onClick={goToNextManufacturingStep}
                        disabled={newStepPhotoBusyCount > 0}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 bg-accent px-3 text-sm font-medium text-canvas active:bg-ink disabled:opacity-60"
                      >
                        <Plus size={16} />
                        {captureTimer.running ? "Next Step (lap)" : "Next Step"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openNewStepForm}
                    className="order-last inline-flex h-11 w-full items-center justify-center gap-2 rounded border border-line bg-surface px-3 text-sm font-medium text-ink active:bg-surface-sunken"
                  >
                    <Plus size={16} />
                    Add Manufacturing Step
                  </button>
                )}
                {selectedTaskSteps.length === 0 && !showNewStepForm ? (
                  <div className="rounded-md border border-dashed border-line bg-surface-raised p-5 text-center">
                    <ClipboardList className="mx-auto mb-3 h-7 w-7 text-steel" />
                    <div className="text-sm font-medium text-ink">No manufacturing steps yet</div>
                    <div className="mt-1 text-xs font-semibold text-steel">
                      Add the first step here with its description, tools, and photos.
                    </div>
                  </div>
                ) : null}

                {visibleSelectedTaskSteps.map((step) => {
                  const photos = getStepPhotoAttachments(selectedTask, step.id);
                  const stepTools = getStepToolList(selectedTask, step.id);
                  const selectedChecks = getManufacturingStepCheckSet(step.qualityCheck);
                  const uploadCount = photoUploadCounts[step.id] ?? 0;
                  const isUploading = uploadCount > 0;
                  const confirmingDelete = confirmDeleteStepId === step.id;

                  return (
                    <article
                      key={step.id}
                      className={`overflow-hidden ui-panel ${
                        recentlyCompletedStepId === step.id ? "ui-photo-mobile-step-just-saved" : ""
                      }`}
                    >
                      <div className="min-w-0 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                              {step.sequence}
                            </span>
                            <div>
                              <div className="ui-mono-label">Instructions</div>
                              <div className="text-[10px] ui-mono-label tracking-wide text-accent">Step {step.sequence}</div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteStepId(step.id)}
                              disabled={saveState === "saving" || isUploading}
                              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-steel active:border-danger active:bg-danger-muted active:text-danger disabled:opacity-50"
                              aria-label={`Delete step ${step.sequence}`}
                              title={`Delete step ${step.sequence}`}
                            >
                              <Trash2 size={14} />
                            </button>
                            <label className="grid grid-cols-[68px_34px] overflow-hidden rounded border border-line bg-surface">
                              <input
                                aria-label={`Step ${step.sequence} duration minutes`}
                                className="h-8 min-w-0 px-2 text-right text-sm font-medium text-ink outline-none focus:bg-accent-muted"
                                type="text"
                                inputMode="decimal"
                                defaultValue={String(step.durationMinutes ?? 0)}
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
                              <span className="flex items-center justify-center border-l border-line bg-surface-raised ui-mono-label">
                                min
                              </span>
                            </label>
                          </div>
                        </div>
                        {confirmingDelete ? (
                          <div className="mt-2 rounded border border-danger/30 bg-danger-muted p-2.5">
                            <div className="text-xs font-medium text-danger">
                              Delete step {step.sequence}?
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStepId(null)}
                                className="h-9 rounded border border-line bg-surface px-3 text-xs font-medium text-ink active:bg-surface-sunken"
                              >
                                No
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteManufacturingStep(step.id)}
                                disabled={saveState === "saving" || isUploading}
                                className="h-9 rounded bg-danger px-3 text-xs font-medium text-canvas active:bg-danger-hover disabled:opacity-60"
                              >
                                Yes
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <label className="mt-3 block">
                          <span className="mb-1 flex items-center justify-between gap-2">
                            <span className="ui-mono-label">Description</span>
                            <button
                              type="button"
                              onPointerDown={(event) => event.preventDefault()}
                              onClick={() => {
                                const textarea = stepInstructionRefs.current[step.id];
                                const currentInstruction = textarea?.value ?? step.instruction;
                                const instruction = applyInstructionBullets(currentInstruction);

                                if (textarea) {
                                  textarea.value = instruction;
                                  restoreTextareaFocus(textarea, instruction.length);
                                }

                                void updateManufacturingStep(step.id, { instruction });
                              }}
                              className="inline-flex h-7 items-center gap-1 rounded border border-line bg-surface px-2 text-[10px] ui-mono-label text-steel active:bg-surface-sunken"
                              aria-label={`Format step ${step.sequence} as bullets`}
                              title={`Format step ${step.sequence} as bullets`}
                            >
                              <ListChecks size={12} />
                              Bullets
                            </button>
                          </span>
                          <textarea
                            key={step.id}
                            ref={(node) => {
                              stepInstructionRefs.current[step.id] = node;
                              if (node) {
                                window.requestAnimationFrame(() => resizeTextareaToContent(node));
                              }
                            }}
                            aria-label={`Step ${step.sequence} description`}
                            className="min-h-[84px] w-full resize-none overflow-hidden rounded border border-line bg-surface px-3 py-2 text-sm font-semibold leading-snug text-ink outline-none focus:border-accent"
                            defaultValue={step.instruction}
                            onFocus={(event) => resizeTextareaToContent(event.currentTarget)}
                            onInput={(event) => resizeTextareaToContent(event.currentTarget)}
                            onKeyDown={(event) =>
                              handleInstructionBulletKeyDown(event, (instruction) => {
                                event.currentTarget.value = instruction;
                              })
                            }
                            onBlur={(event) => {
                              const instruction = event.currentTarget.value;
                              if (instruction !== step.instruction) {
                                void updateManufacturingStep(step.id, { instruction });
                              }
                            }}
                            placeholder="Describe the manufacturing step"
                          />
                        </label>
                          {step.qualityCheck ? (
                            <div className="mt-2 rounded border border-accent/30 bg-accent-muted px-2 py-1 text-xs font-bold text-accent">
                              Checklist: {step.qualityCheck}
                            </div>
                          ) : null}
                      </div>
                      <div className="border-t border-line px-3 py-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                            2
                          </span>
                          <div className="ui-mono-label">
                            Checks
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {manufacturingStepCheckOptions.map((option) => {
                            const checked = selectedChecks.has(option.key);

                            return (
                              <label
                                key={option.key}
                                className={`grid min-h-9 grid-cols-[18px_minmax(0,1fr)] items-center gap-1.5 rounded border px-2 text-[10px] font-medium transition ${
                                  checked
                                    ? "border-accent/30 bg-accent/10 text-accent"
                                    : "border-line bg-surface-raised text-steel active:border-accent"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                                  checked={checked}
                                  onChange={(event) => {
                                    const nextChecks = new Set(selectedChecks);

                                    if (event.target.checked) {
                                      nextChecks.add(option.key);
                                    } else {
                                      nextChecks.delete(option.key);
                                    }

                                    void updateManufacturingStep(step.id, {
                                      qualityCheck: serializeManufacturingStepCheckSet(nextChecks),
                                    });
                                  }}
                                />
                                <span className="min-w-0 text-left leading-tight">{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="border-t border-line px-3 py-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                            3
                          </span>
                          <div className="ui-mono-label">
                            Tools & Parts · {stepTools.length}
                          </div>
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_68px] gap-2">
                          <input
                            className="h-10 min-w-0 rounded border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-accent"
                            value={newStepToolNames[step.id] ?? ""}
                            onChange={(event) =>
                              setNewStepToolNames((current) => ({ ...current, [step.id]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void addManufacturingStepTool(step.id);
                              }
                            }}
                            placeholder="Tool"
                          />
                          <button
                            type="button"
                            onClick={() => void addManufacturingStepTool(step.id)}
                            disabled={saveState === "saving"}
                            className="h-10 rounded bg-accent px-2 text-xs font-medium text-canvas active:bg-ink disabled:opacity-60"
                          >
                            Add
                          </button>
                        </div>
                        {renderToolPicker(
                          stepTools,
                          (toolName) => void addManufacturingStepToolFromLibrary(step.id, toolName),
                          (toolName) => void removeManufacturingStepTool(step.id, toolName),
                        )}
                      </div>
                      <div className="border-t border-line px-3 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[11px] font-medium text-accent">
                          4
                        </span>
                        <div className="ui-mono-label">
                          Photos · {photos.length}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="inline-flex h-10 items-center justify-center gap-2 rounded bg-accent px-3 text-xs font-medium text-canvas active:bg-ink">
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
                        <label className="inline-flex h-10 items-center justify-center gap-2 rounded border border-line bg-surface px-3 text-xs font-medium text-ink active:bg-surface-sunken">
                          {isUploading ? <NothingSpinner inline /> : <ImageIcon size={15} />}
                          Library
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
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {photos.map((photo) => (
                            <div key={photo.id} className="overflow-hidden rounded border border-line bg-surface">
                              <div
                                className="relative"
                                onPointerDown={() => startPhotoHold(photo.id)}
                                onPointerUp={cancelPhotoHold}
                                onPointerCancel={cancelPhotoHold}
                                onPointerLeave={cancelPhotoHold}
                                onContextMenu={(event) => event.preventDefault()}
                              >
                                <img
                                  src={photo.dataUrl}
                                  alt={`${selectedTask.name} step ${step.sequence}`}
                                  className="aspect-[5/4] w-full object-cover"
                                />
                                {revealedPhotoDeleteId === photo.id ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      requestRemovePhoto(step.id, photo);
                                    }}
                                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-danger text-canvas"
                                    aria-label="Remove photo"
                                    title="Remove photo"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                ) : null}
                              </div>
                              <label className="block border-t border-line px-1.5 py-1">
                                <span className="sr-only">Photo note</span>
                                <textarea
                                  className="min-h-[34px] w-full resize-none rounded border border-line bg-surface-raised px-1.5 py-1 text-[11px] font-semibold leading-tight text-ink outline-none placeholder:text-steel/60 focus:border-accent"
                                  defaultValue={photo.caption ?? ""}
                                  onBlur={(event) => {
                                    void updatePhotoCaption(step.id, photo.id, event.currentTarget.value);
                                  }}
                                  placeholder="Caption"
                                  rows={2}
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center gap-2 rounded border border-dashed border-line bg-surface px-3 py-2 text-xs font-bold text-steel">
                          <ImageIcon size={14} />
                          No photos attached to this step yet.
                        </div>
                      )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-5 text-sm font-bold text-steel">Select a process to capture step photos.</div>
          )}
        </section>
        )}
      </div>
      </div>
    </main>
  );
}
