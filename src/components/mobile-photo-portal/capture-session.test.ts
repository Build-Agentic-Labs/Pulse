// @vitest-environment jsdom
// Unit characterization of the hook-free capture-session utilities. Pure timer calculations are tested
// without touching storage; the localStorage functions are tested separately with a real jsdom
// localStorage, including malformed data, the legacy key and write failures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CAPTURE_TIMER,
  buildMobileCaptureSessionSnapshot,
  collectHeaderCaptureTimers,
  elapsedMinutesFromTimer,
  formatElapsedTimer,
  freezeCaptureTimer,
  getCaptureTimerElapsed,
  getCaptureTimerLapElapsed,
  isActiveHeaderCaptureTimer,
  legacyCaptureTimerStorageKey,
  mobileCaptureSessionStorageKey,
  preserveRunningCaptureTimer,
  readMobileCaptureSession,
  restoreRunningCaptureTimer,
  shouldPersistMobileCaptureSession,
  settleLinkedCaptureTimer,
  settleLinkedParkedCaptures,
  writeMobileCaptureSession,
  type CaptureTimerState,
  type MobileCaptureSessionSnapshot,
  type ParkedTaskCaptureState,
} from "./capture-session";

const timer = (overrides: Partial<CaptureTimerState> = {}): CaptureTimerState => ({
  ...EMPTY_CAPTURE_TIMER, taskId: "task-a", taskName: "Alpha", activeStepId: "step-1", ...overrides,
});
const parked = (overrides: Partial<ParkedTaskCaptureState> = {}): ParkedTaskCaptureState => ({
  timer: timer(), showNewStepForm: true, newStepId: "step-1", draftName: "", draftInstruction: "",
  draftDurationText: "5", draftTools: [], draftPhotos: [], draftChecks: [], ...overrides,
});
const sessionOf = (overrides: Partial<MobileCaptureSessionSnapshot> = {}): MobileCaptureSessionSnapshot => ({
  captureTimer: EMPTY_CAPTURE_TIMER, parkedCaptureByTaskId: {}, activeScreen: "list", selectedTaskId: "",
  showNewStepForm: false, newStepId: null, ...overrides,
});

describe("pure timer calculations", () => {
  it("formats elapsed time as m:ss below an hour and h:mm:ss above", () => {
    expect(formatElapsedTimer(0)).toBe("0:00");
    expect(formatElapsedTimer(59_999)).toBe("0:59");
    expect(formatElapsedTimer(65_000)).toBe("1:05");
    expect(formatElapsedTimer(3_600_000)).toBe("1:00:00");
    expect(formatElapsedTimer(3_661_000)).toBe("1:01:01");
    expect(formatElapsedTimer(-5_000)).toBe("0:00");
  });

  it("rounds elapsed minutes up, with zero only for no time at all", () => {
    expect(elapsedMinutesFromTimer(0)).toBe(0);
    expect(elapsedMinutesFromTimer(-1)).toBe(0);
    expect(elapsedMinutesFromTimer(1)).toBe(1);
    expect(elapsedMinutesFromTimer(59_999)).toBe(1);
    expect(elapsedMinutesFromTimer(60_000)).toBe(1);
    expect(elapsedMinutesFromTimer(60_001)).toBe(2);
    expect(elapsedMinutesFromTimer(3_600_000)).toBe(60);
  });

  it("treats a startedAt of 0 as not started (falsy check); real clocks never produce it", () => {
    expect(getCaptureTimerElapsed(timer({ running: true, startedAt: 0, storedElapsedMs: 4_000 }), 10_000)).toBe(4_000);
  });

  it("reports stored elapsed for a stopped timer and adds wall time for a running one", () => {
    expect(getCaptureTimerElapsed(timer({ running: false, storedElapsedMs: 4_000 }), 10_000)).toBe(4_000);
    expect(getCaptureTimerElapsed(timer({ running: true, startedAt: null, storedElapsedMs: 4_000 }), 10_000)).toBe(4_000);
    expect(getCaptureTimerElapsed(timer({ running: true, startedAt: 7_000, storedElapsedMs: 4_000 }), 10_000)).toBe(7_000);
    expect(getCaptureTimerElapsed(timer({ running: true, startedAt: 12_000, storedElapsedMs: 4_000 }), 10_000)).toBe(4_000);
  });

  it("measures the lap from the lap marker and never goes negative", () => {
    expect(getCaptureTimerLapElapsed(timer({ running: true, startedAt: 1_000, storedElapsedMs: 0, lapMarkerMs: 2_000 }), 6_000)).toBe(3_000);
    expect(getCaptureTimerLapElapsed(timer({ running: false, storedElapsedMs: 1_000, lapMarkerMs: 5_000 }), 99_000)).toBe(0);
  });

  it("freezes a running timer into stored elapsed with no start time", () => {
    expect(freezeCaptureTimer(timer({ running: true, startedAt: 1_000, storedElapsedMs: 500 }), 3_000))
      .toEqual(timer({ running: false, startedAt: null, storedElapsedMs: 2_500 }));
  });

  it("preserves a running timer by rebasing its start and leaves a stopped timer untouched", () => {
    const stopped = timer({ running: false, storedElapsedMs: 9 });
    expect(preserveRunningCaptureTimer(stopped, 50)).toBe(stopped);
    expect(preserveRunningCaptureTimer(timer({ running: true, startedAt: 10, storedElapsedMs: 5 }), 50))
      .toEqual(timer({ running: true, startedAt: 50, storedElapsedMs: 45 }));
  });

  it("restores a snapshot as running from its stored elapsed", () => {
    expect(restoreRunningCaptureTimer(timer({ running: false, startedAt: null, storedElapsedMs: 30_000 }), 1_000))
      .toEqual(timer({ running: true, startedAt: 1_000, storedElapsedMs: 30_000 }));
    expect(restoreRunningCaptureTimer(timer({ running: true, startedAt: 500, storedElapsedMs: 100 }), 1_000))
      .toEqual(timer({ running: true, startedAt: 1_000, storedElapsedMs: 600 }));
  });

  it("a header timer is active only when bound to a task and step and either running or elapsed", () => {
    expect(isActiveHeaderCaptureTimer(timer({ running: true }))).toBe(true);
    expect(isActiveHeaderCaptureTimer(timer({ running: false, storedElapsedMs: 1 }))).toBe(true);
    expect(isActiveHeaderCaptureTimer(timer({ running: false, storedElapsedMs: 0 }))).toBe(false);
    expect(isActiveHeaderCaptureTimer(timer({ running: true, activeStepId: null }))).toBe(false);
    expect(isActiveHeaderCaptureTimer(timer({ running: true, taskId: null }))).toBe(false);
  });

  it("collects parked chips first and lets the active timer override the same task", () => {
    const parkedA = parked({ timer: timer({ running: false, storedElapsedMs: 5, taskName: "Parked A" }) });
    const parkedB = parked({ timer: timer({ taskId: "task-b", taskName: "B", running: true }) });
    const inactive = parked({ timer: timer({ taskId: "task-c", running: false, storedElapsedMs: 0 }) });
    const active = timer({ running: true, taskName: "Active A" });
    const chips = collectHeaderCaptureTimers(active, { "task-a": parkedA, "task-b": parkedB, "task-c": inactive });
    expect(chips.map((chip) => [chip.taskId, chip.taskName])).toEqual([["task-a", "Active A"], ["task-b", "B"]]);
    expect(chips[0].timer).toBe(active);
    expect(collectHeaderCaptureTimers(EMPTY_CAPTURE_TIMER, {})).toEqual([]);
  });

  it("decides persistence from any live timer, parked entry, detail screen, open form or selection", () => {
    expect(shouldPersistMobileCaptureSession(sessionOf())).toBe(false);
    expect(shouldPersistMobileCaptureSession(sessionOf({ captureTimer: timer({ running: true }) }))).toBe(true);
    expect(shouldPersistMobileCaptureSession(sessionOf({ captureTimer: timer({ storedElapsedMs: 1 }) }))).toBe(true);
    expect(shouldPersistMobileCaptureSession(sessionOf({ parkedCaptureByTaskId: { "task-a": parked() } }))).toBe(true);
    expect(shouldPersistMobileCaptureSession(sessionOf({ activeScreen: "detail" }))).toBe(true);
    expect(shouldPersistMobileCaptureSession(sessionOf({ showNewStepForm: true }))).toBe(true);
    expect(shouldPersistMobileCaptureSession(sessionOf({ selectedTaskId: "task-a" }))).toBe(true);
  });

  it("builds a snapshot that re-opens the draft for the timed step of the selected task", () => {
    const input = { captureTimer: timer(), parkedCaptureByTaskId: {}, activeScreen: "detail" as const, selectedTaskId: "task-a", showNewStepForm: false, newStepId: null };
    expect(buildMobileCaptureSessionSnapshot(input)).toMatchObject({ showNewStepForm: true, newStepId: "step-1" });
    expect(buildMobileCaptureSessionSnapshot({ ...input, selectedTaskId: "task-b" })).toMatchObject({ showNewStepForm: false, newStepId: null });
    expect(buildMobileCaptureSessionSnapshot({ ...input, newStepId: "step-9" })).toMatchObject({ newStepId: "step-9" });
    expect(buildMobileCaptureSessionSnapshot({ ...input, captureTimer: timer({ activeStepId: null }) })).toMatchObject({ showNewStepForm: false, newStepId: null });
  });
});

describe("localStorage session persistence", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("builds project-scoped keys with a default fallback", () => {
    expect(mobileCaptureSessionStorageKey("p1")).toBe("pulse:mobile-capture-session:p1");
    expect(mobileCaptureSessionStorageKey(undefined)).toBe("pulse:mobile-capture-session:default");
    expect(legacyCaptureTimerStorageKey("p1")).toBe("pulse:capture-timer:p1");
    expect(legacyCaptureTimerStorageKey()).toBe("pulse:capture-timer:default");
  });

  it("writes a persistable session with running timers frozen into storedElapsedMs and removes the legacy key", () => {
    localStorage.setItem("pulse:capture-timer:p1", "{}");
    const session = sessionOf({
      captureTimer: timer({ running: true, startedAt: 1_000, storedElapsedMs: 500 }),
      parkedCaptureByTaskId: { "task-b": parked({ timer: timer({ taskId: "task-b", running: true, startedAt: 2_000, storedElapsedMs: 0 }) }) },
      activeScreen: "detail", selectedTaskId: "task-a",
    });
    writeMobileCaptureSession("p1", session, 4_000);
    const stored = JSON.parse(localStorage.getItem("pulse:mobile-capture-session:p1")!);
    expect(stored.captureTimer).toMatchObject({ running: true, startedAt: null, storedElapsedMs: 3_500 });
    expect(stored.parkedCaptureByTaskId["task-b"].timer).toMatchObject({ running: true, startedAt: null, storedElapsedMs: 2_000 });
    expect(stored).toMatchObject({ activeScreen: "detail", selectedTaskId: "task-a" });
    expect(localStorage.getItem("pulse:capture-timer:p1")).toBeNull();
  });

  it("removes both keys when the session has nothing worth persisting", () => {
    localStorage.setItem("pulse:mobile-capture-session:p1", "x");
    localStorage.setItem("pulse:capture-timer:p1", "y");
    writeMobileCaptureSession("p1", sessionOf(), 0);
    expect(localStorage.getItem("pulse:mobile-capture-session:p1")).toBeNull();
    expect(localStorage.getItem("pulse:capture-timer:p1")).toBeNull();
  });

  it("swallows storage write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    expect(() => writeMobileCaptureSession("p1", sessionOf({ activeScreen: "detail" }), 0)).not.toThrow();
  });

  it("round-trips what it wrote, with startedAt cleared", () => {
    const session = sessionOf({
      captureTimer: timer({ running: true, startedAt: 100, storedElapsedMs: 50, lapMarkerMs: 20 }),
      parkedCaptureByTaskId: { "task-b": parked({ timer: timer({ taskId: "task-b", taskName: "B" }), draftName: "n", draftInstruction: "i", draftDurationText: "7", draftTools: ["T"], draftChecks: ["c"] }) },
      activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true, newStepId: "step-1",
    });
    writeMobileCaptureSession("p1", session, 300);
    const read = readMobileCaptureSession("p1")!;
    expect(read.captureTimer).toEqual(timer({ running: true, startedAt: null, storedElapsedMs: 250, lapMarkerMs: 20 }));
    expect(read.parkedCaptureByTaskId["task-b"]).toMatchObject({ draftName: "n", draftInstruction: "i", draftDurationText: "7", draftTools: ["T"], draftChecks: ["c"], draftPhotos: [], newStepId: "step-1", showNewStepForm: true });
    expect(read.parkedCaptureByTaskId["task-b"].draftCheckValues).toEqual({});
    expect(read).toMatchObject({ activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true, newStepId: "step-1" });
  });

  it("returns null for a missing key, malformed JSON, or a timer without a boolean running flag", () => {
    expect(readMobileCaptureSession("p1")).toBeNull();
    localStorage.setItem("pulse:mobile-capture-session:p1", "{nope");
    expect(readMobileCaptureSession("p1")).toBeNull();
    localStorage.setItem("pulse:mobile-capture-session:p1", JSON.stringify({ captureTimer: { storedElapsedMs: 5 }, activeScreen: "detail" }));
    expect(readMobileCaptureSession("p1")).toBeNull();
    localStorage.setItem("pulse:mobile-capture-session:p1", JSON.stringify({ activeScreen: "detail" }));
    expect(readMobileCaptureSession("p1")).toBeNull();
  });

  it("normalizes loosely typed stored values and drops parked entries without a task and step", () => {
    localStorage.setItem("pulse:mobile-capture-session:p1", JSON.stringify({
      captureTimer: { running: "yes" === "yes", startedAt: 123, storedElapsedMs: "9", lapMarkerMs: 4, activeStepId: 7, taskId: "task-a", taskName: 3 },
      parkedCaptureByTaskId: {
        "task-a": { timer: { running: false, storedElapsedMs: 5 } },
        "task-b": { timer: { running: false, storedElapsedMs: 5, taskId: "task-b", activeStepId: "step-b" }, draftTools: ["T", 7], draftPhotos: [{ id: "ph" }, { nope: 1 }, "x"], draftChecks: "no", draftDurationText: 5, showNewStepForm: 1 },
        "task-c": "garbage",
      },
      activeScreen: "weird", selectedTaskId: 42, showNewStepForm: "x", newStepId: 5,
    }));
    const read = readMobileCaptureSession("p1")!;
    expect(read.captureTimer).toEqual({ running: true, startedAt: null, storedElapsedMs: 0, lapMarkerMs: 4, activeStepId: null, taskId: "task-a", taskName: "" });
    expect(Object.keys(read.parkedCaptureByTaskId)).toEqual(["task-b"]);
    expect(read.parkedCaptureByTaskId["task-b"]).toMatchObject({ newStepId: "step-b", draftDurationText: "5", draftTools: ["T"], draftPhotos: [{ id: "ph" }], draftChecks: [], draftName: "", draftInstruction: "", showNewStepForm: true });
    expect(read).toMatchObject({ activeScreen: "list", selectedTaskId: "", showNewStepForm: true, newStepId: null });
  });

  it("falls back to the legacy capture-timer key and derives the screen and draft from it", () => {
    localStorage.setItem("pulse:capture-timer:p1", JSON.stringify({ running: true, storedElapsedMs: 45_000, taskId: "task-a", activeStepId: "step-l", taskName: "Alpha" }));
    expect(readMobileCaptureSession("p1")).toEqual({
      captureTimer: { running: true, startedAt: null, storedElapsedMs: 45_000, lapMarkerMs: 0, activeStepId: "step-l", taskId: "task-a", taskName: "Alpha" },
      parkedCaptureByTaskId: {}, activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true, newStepId: "step-l",
    });
    localStorage.setItem("pulse:capture-timer:p1", JSON.stringify({ running: false, storedElapsedMs: 10, taskId: null, activeStepId: null }));
    expect(readMobileCaptureSession("p1")).toMatchObject({ activeScreen: "list", selectedTaskId: "", showNewStepForm: false, newStepId: null });
    localStorage.setItem("pulse:capture-timer:p1", "{}");
    expect(readMobileCaptureSession("p1")).toBeNull();
    localStorage.setItem("pulse:capture-timer:p1", "{bad");
    expect(readMobileCaptureSession("p1")).toBeNull();
  });

  it("prefers the session key over the legacy key when both exist", () => {
    localStorage.setItem("pulse:capture-timer:p1", JSON.stringify({ running: true, taskId: "legacy", activeStepId: "s" }));
    localStorage.setItem("pulse:mobile-capture-session:p1", JSON.stringify({ captureTimer: { running: false }, activeScreen: "list", selectedTaskId: "current" }));
    expect(readMobileCaptureSession("p1")!.selectedTaskId).toBe("current");
  });

  it("returns null when storage access itself throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readMobileCaptureSession("p1")).toBeNull();
  });
});


describe("settling linked AWI capture timers", () => {
  it("freezes a linked running timer with elapsed time and preserves its step binding", () => {
    const linked = timer({ running: true, startedAt: 1_000, storedElapsedMs: 30_000 });
    expect(settleLinkedCaptureTimer(linked, (id) => id === "task-a", 11_000)).toEqual({ ...linked, running: false, startedAt: null, storedElapsedMs: 40_000 });
    expect(settleLinkedCaptureTimer(linked, () => false, 11_000)).toBe(linked);
    const stopped = timer({ storedElapsedMs: 30_000 });
    expect(settleLinkedCaptureTimer(stopped, () => true, 11_000)).toBe(stopped);
    const unbound = timer({ running: true, taskId: null });
    expect(settleLinkedCaptureTimer(unbound, () => true, 11_000)).toBe(unbound);
  });
  it("keeps parked drafts and ordinary timer references while freezing linked entries", () => {
    const linked = parked({ timer: timer({ running: true, startedAt: 1_000, storedElapsedMs: 120_000 }), draftName: "Parked draft", draftInstruction: "Keep me" });
    const ordinary = parked({ timer: timer({ taskId: "task-b", running: true, startedAt: 1_000 }) });
    const entries = { "task-a": linked, "task-b": ordinary };
    const result = settleLinkedParkedCaptures(entries, (id) => id === "task-a", 11_000);
    expect(result["task-a"]).toEqual({ ...linked, timer: { ...linked.timer, running: false, startedAt: null, storedElapsedMs: 130_000 } });
    expect(result["task-b"]).toBe(ordinary);
    expect(settleLinkedParkedCaptures(result, (id) => id === "task-a", 21_000)).toBe(result);
    expect(settleLinkedParkedCaptures(entries, () => false, 11_000)).toBe(entries);
  });
});
