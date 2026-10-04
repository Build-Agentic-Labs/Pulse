// Hook-free capture-session utilities for the mobile photo portal: the capture-timer data model, timer
// arithmetic, header-chip derivation, and the localStorage session persistence (current key
// `pulse:mobile-capture-session:<projectId>`, legacy `pulse:capture-timer:<projectId>`). Moved verbatim
// out of mobile-photo-portal.tsx (edit-reliability Package B, first slice); no hooks, effects or JSX.
// Not a pure module: the read/write functions touch window.localStorage and swallow its failures.
import { getManufacturingStepCheckState, type ManufacturingStepCheckValue } from "@/domain/manufacturing-step-checks";
import type { StepPhotoAttachment } from "@/domain/step-photos";

export function formatElapsedTimer(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");

  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

export function elapsedMinutesFromTimer(milliseconds: number) {
  return milliseconds > 0 ? Math.max(1, Math.ceil(milliseconds / 60000)) : 0;
}

export type CaptureTimerState = {
  running: boolean;
  startedAt: number | null;
  storedElapsedMs: number;
  lapMarkerMs: number;
  activeStepId: string | null;
  taskId: string | null;
  taskName: string;
};

export type ParkedTaskCaptureState = {
  timer: CaptureTimerState;
  showNewStepForm: boolean;
  newStepId: string | null;
  draftName?: string;
  draftInstruction: string;
  draftDurationText: string;
  draftTools: string[];
  draftPhotos: StepPhotoAttachment[];
  draftChecks: string[];
  draftCheckValues?: Record<string, ManufacturingStepCheckValue>;
};

export type MobileCaptureSessionSnapshot = {
  captureTimer: CaptureTimerState;
  parkedCaptureByTaskId: Record<string, ParkedTaskCaptureState>;
  activeScreen: "list" | "detail";
  selectedTaskId: string;
  showNewStepForm: boolean;
  newStepId: string | null;
};

export const EMPTY_CAPTURE_TIMER: CaptureTimerState = {
  running: false,
  startedAt: null,
  storedElapsedMs: 0,
  lapMarkerMs: 0,
  activeStepId: null,
  taskId: null,
  taskName: "",
};

export function isRecord(value: unknown): value is Record<string, unknown> {
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
    draftName: typeof value.draftName === "string" ? value.draftName : "",
    draftInstruction: typeof value.draftInstruction === "string" ? value.draftInstruction : "",
    draftDurationText: typeof value.draftDurationText === "string" ? value.draftDurationText : "5",
    draftTools: Array.isArray(value.draftTools)
      ? value.draftTools.filter((tool): tool is string => typeof tool === "string")
      : [],
    draftPhotos: Array.isArray(value.draftPhotos)
      ? value.draftPhotos.filter((photo): photo is StepPhotoAttachment => isRecord(photo) && typeof photo.id === "string")
      : [],
    draftCheckValues: getManufacturingStepCheckState(JSON.stringify({ values: value.draftCheckValues })).values,
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

export function mobileCaptureSessionStorageKey(projectId?: string) {
  return projectId ? `pulse:mobile-capture-session:${projectId}` : "pulse:mobile-capture-session:default";
}

export function legacyCaptureTimerStorageKey(projectId?: string) {
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

export function readMobileCaptureSession(projectId?: string): MobileCaptureSessionSnapshot | null {
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

export function shouldPersistMobileCaptureSession(session: MobileCaptureSessionSnapshot) {
  return (
    session.captureTimer.running ||
    session.captureTimer.storedElapsedMs > 0 ||
    Object.keys(session.parkedCaptureByTaskId).length > 0 ||
    session.activeScreen === "detail" ||
    session.showNewStepForm ||
    Boolean(session.selectedTaskId)
  );
}

export function buildMobileCaptureSessionSnapshot(input: {
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

export function writeMobileCaptureSession(
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

export function restoreRunningCaptureTimer(snapshot: CaptureTimerState, now: number): CaptureTimerState {
  return {
    ...snapshot,
    running: true,
    storedElapsedMs: getCaptureTimerElapsed(snapshot, now),
    startedAt: now,
  };
}

export function getCaptureTimerElapsed(timer: CaptureTimerState, now: number) {
  if (!timer.running || !timer.startedAt) {
    return timer.storedElapsedMs;
  }

  return timer.storedElapsedMs + Math.max(0, now - timer.startedAt);
}

export function getCaptureTimerLapElapsed(timer: CaptureTimerState, now: number) {
  return Math.max(0, getCaptureTimerElapsed(timer, now) - timer.lapMarkerMs);
}

export function freezeCaptureTimer(timer: CaptureTimerState, now: number): CaptureTimerState {
  const elapsed = getCaptureTimerElapsed(timer, now);
  return {
    ...timer,
    running: false,
    startedAt: null,
    storedElapsedMs: elapsed,
  };
}

export function preserveRunningCaptureTimer(timer: CaptureTimerState, now: number): CaptureTimerState {
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

export type HeaderCaptureTimerEntry = {
  taskId: string;
  taskName: string;
  timer: CaptureTimerState;
};

export function isActiveHeaderCaptureTimer(timer: CaptureTimerState) {
  return Boolean(timer.taskId && timer.activeStepId && (timer.running || timer.storedElapsedMs > 0));
}

export function collectHeaderCaptureTimers(
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
