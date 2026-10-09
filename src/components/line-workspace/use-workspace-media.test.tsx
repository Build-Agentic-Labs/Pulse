import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { getTaskExplodedViews, upsertTaskExplodedViews, type ExplodedView } from "@/domain/step-exploded-views";
import { getStepPhotoAttachments, upsertStepPhotoAttachments, type StepPhotoAttachment } from "@/domain/step-photos";
import {
  copyStepPhotoAttachmentToStep,
  removeExplodedViewObject,
  removeTaskVideoObject,
  saveTaskCustomFieldsToSupabase,
  softDeleteExplodedViewFromSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  softDeleteTaskVideoFromSupabase,
  uploadStepPhotoAttachment,
  type SaveState,
} from "@/domain/supabase-planner";
import { getTaskVideos, upsertTaskVideos, type TaskVideo } from "@/domain/task-videos";
import type { PlannerState, Task } from "@/domain/types";
import { WorkspaceWriteTracker } from "@/domain/workspace-save-status";
import { deferredPromise as deferred, procedureTestTask } from "./procedure-test-fixtures";
import { useWorkspaceMedia, type RestoreActionNotice } from "./use-workspace-media";

vi.mock("@/lib/step-photo-image", () => ({
  buildStepPhotoAttachment: vi.fn(async (file: File) => photo(`local-${file.name}`)),
}));
vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  copyStepPhotoAttachmentToStep: vi.fn(),
  removeExplodedViewObject: vi.fn(async () => undefined),
  removeTaskVideoObject: vi.fn(async () => undefined),
  saveTaskCustomFieldsToSupabase: vi.fn(async () => undefined),
  softDeleteExplodedViewFromSupabase: vi.fn(async () => undefined),
  softDeleteStepPhotoAttachmentFromSupabase: vi.fn(async () => undefined),
  softDeleteTaskVideoFromSupabase: vi.fn(async () => undefined),
  uploadStepPhotoAttachment: vi.fn(),
}));

const PROJECT_ID = "project-media";
const notifyFeedback = vi.fn();
const notifyRestoreAction = vi.fn<(notice: RestoreActionNotice) => void>();
const flushDeferredRemoteRefresh = vi.fn();
// Records each release of the shell-save lock (useWorkspaceSaves.releaseShellLock drains a queued save).
const shellLockReleased = vi.fn();

function photo(id: string, storagePath?: string): StepPhotoAttachment {
  return { id, name: `${id}.png`, dataUrl: "data:image/png;base64,AA==", capturedAt: "2026-10-01T00:00:00.000Z", storagePath };
}
const video: TaskVideo = { id: "video-1", name: "build.mp4", videoUrl: "https://example.test/v.mp4", capturedAt: "2026-10-01T00:00:00.000Z" };
const view: ExplodedView = { id: "view-1", name: "exploded.png", dataUrl: "data:image/png;base64,AA==", capturedAt: "2026-10-01T00:00:00.000Z" };

const existingPhoto = photo("photo-existing", "photos/existing.png");
const taskWithMedia = upsertTaskExplodedViews(
  upsertTaskVideos(upsertStepPhotoAttachments(procedureTestTask("Fit the bracket"), "step-1", [existingPhoto]), [video]),
  [view],
);
const otherTask: Task = { ...procedureTestTask("Second task"), id: "task-2" };
const initialState: PlannerState = { ...emptyPlannerState, tasks: [taskWithMedia, otherTask] };

function renderMedia() {
  const tracker = new WorkspaceWriteTracker(PROJECT_ID);
  const hook = renderHook(() => {
    const [plannerState, setPlannerState] = useState<PlannerState>(initialState);
    const latestDerivedStateRef = useRef(plannerState);
    latestDerivedStateRef.current = plannerState;
    const saveInFlightRef = useRef(false);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveError, setSaveError] = useState<string>();
    const releaseShellLock = () => {
      shellLockReleased();
      saveInFlightRef.current = false;
    };
    const media = useWorkspaceMedia({
      projectId: PROJECT_ID,
      activeProjectContext: undefined,
      latestDerivedStateRef,
      setPlannerState,
      writeTracker: tracker,
      saveInFlightRef,
      releaseShellLock,
      setSaveState,
      setSaveError,
      notifyFeedback,
      notifyRestoreAction,
      flushDeferredRemoteRefresh,
    });
    return { plannerState, setPlannerState, saveInFlightRef, saveState, saveError, media };
  });
  return { ...hook, tracker };
}

const task = (state: PlannerState, id = "task-1") => state.tasks.find((entry) => entry.id === id)!;
const stepPhotoIds = (state: PlannerState, id = "task-1") => getStepPhotoAttachments(task(state, id), "step-1").map((entry) => entry.id);
// A procedure edit made by the user while a media write is running.
const editDescription = (setPlannerState: (update: (current: PlannerState) => PlannerState) => void) =>
  act(() => setPlannerState((current) => ({
    ...current,
    tasks: current.tasks.map((entry) => (entry.id === "task-1" ? { ...entry, description: "Typed during the write" } : entry)),
  })));

beforeEach(() => {
  vi.clearAllMocks();
  // Drop one-shot implementations a previous test may have queued but not consumed.
  vi.mocked(softDeleteStepPhotoAttachmentFromSupabase).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(saveTaskCustomFieldsToSupabase).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(uploadStepPhotoAttachment).mockReset();
});

it("holds the shell-save lock for an upload and rolls back only its photos on failure", async () => {
  const upload = deferred<StepPhotoAttachment>();
  vi.mocked(uploadStepPhotoAttachment).mockReturnValueOnce(upload.promise);
  const { result, tracker } = renderMedia();

  let done!: Promise<void>;
  await act(async () => {
    done = result.current.media.uploadStepPhotos("task-1", "step-1", [new File(["x"], "new.png")]);
    await Promise.resolve();
  });
  expect(result.current.saveInFlightRef.current).toBe(true);
  expect(stepPhotoIds(result.current.plannerState)).toEqual(["photo-existing", "local-new.png"]);
  editDescription(result.current.setPlannerState);

  await act(async () => {
    upload.reject(new Error("Upload failed"));
    await done;
  });
  expect(result.current.saveInFlightRef.current).toBe(false);
  expect(stepPhotoIds(result.current.plannerState)).toEqual(["photo-existing"]);
  expect(task(result.current.plannerState).description).toBe("Typed during the write");
  expect(result.current.saveState).toBe("error");
  expect(tracker.getSnapshot().failures).toEqual([{ key: "photo-upload:task-1:step-1", message: "Upload failed" }]);
});

it("replaces the optimistic photo with the uploaded one and releases the lock", async () => {
  vi.mocked(uploadStepPhotoAttachment).mockResolvedValueOnce(photo("local-new.png", "photos/new.png"));
  const { result } = renderMedia();

  await act(async () => { await result.current.media.uploadStepPhotos("task-1", "step-1", [new File(["x"], "new.png")]); });

  expect(getStepPhotoAttachments(task(result.current.plannerState), "step-1").find((entry) => entry.id === "local-new.png")?.storagePath)
    .toBe("photos/new.png");
  expect(result.current.saveInFlightRef.current).toBe(false);
  expect(result.current.saveState).toBe("saved");
});

it("holds the lock for a photo delete, restores only that photo on failure, and offers Restore after success", async () => {
  const failingDelete = deferred<void>();
  vi.mocked(softDeleteStepPhotoAttachmentFromSupabase).mockReturnValueOnce(failingDelete.promise);
  const { result } = renderMedia();

  let done!: Promise<void>;
  await act(async () => {
    done = result.current.media.removeStepPhoto("task-1", "step-1", "photo-existing");
    await Promise.resolve();
  });
  expect(result.current.saveInFlightRef.current).toBe(true);
  expect(stepPhotoIds(result.current.plannerState)).toEqual([]);
  editDescription(result.current.setPlannerState);
  await act(async () => {
    failingDelete.reject(new Error("Delete failed"));
    await done;
  });
  expect(stepPhotoIds(result.current.plannerState)).toEqual(["photo-existing"]);
  expect(task(result.current.plannerState).description).toBe("Typed during the write");
  expect(result.current.saveInFlightRef.current).toBe(false);
  expect(result.current.saveState).toBe("error");
  expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete failed" }));

  // A successful delete offers Restore, which re-uploads the photo.
  const succeedingDelete = deferred<void>();
  vi.mocked(softDeleteStepPhotoAttachmentFromSupabase).mockReturnValueOnce(succeedingDelete.promise);
  await act(async () => {
    done = result.current.media.removeStepPhoto("task-1", "step-1", "photo-existing");
    await Promise.resolve();
  });
  await act(async () => { succeedingDelete.resolve(); await done; });
  expect(stepPhotoIds(result.current.plannerState)).toEqual([]);
  expect(result.current.saveInFlightRef.current).toBe(false);
  const notice = notifyRestoreAction.mock.calls[0]?.[0];
  expect(notice?.title).toBe("Deleted photo");
  vi.mocked(uploadStepPhotoAttachment).mockResolvedValueOnce(existingPhoto);
  await act(async () => { notice?.onRestore(); await Promise.resolve(); });
  expect(uploadStepPhotoAttachment).toHaveBeenCalledWith("task-1", "step-1", existingPhoto, undefined);
  expect(stepPhotoIds(result.current.plannerState)).toEqual(["photo-existing"]);
});

it("restores a video or exploded view whose delete fails, keeps concurrent edits, and never takes the lock", async () => {
  const { result } = renderMedia();

  const videoDelete = deferred<void>();
  vi.mocked(softDeleteTaskVideoFromSupabase).mockReset().mockReturnValueOnce(videoDelete.promise.then(() => {
    throw new Error("Video delete failed");
  }));
  let done!: Promise<void>;
  await act(async () => {
    done = result.current.media.deleteTaskVideo("task-1", video);
    await Promise.resolve();
  });
  expect(getTaskVideos(task(result.current.plannerState))).toEqual([]);
  expect(result.current.saveInFlightRef.current).toBe(false);
  editDescription(result.current.setPlannerState);
  await act(async () => { videoDelete.resolve(); await done; });
  expect(getTaskVideos(task(result.current.plannerState)).map((entry) => entry.id)).toEqual(["video-1"]);
  expect(task(result.current.plannerState).description).toBe("Typed during the write");
  expect(removeTaskVideoObject).not.toHaveBeenCalled();

  const viewDelete = deferred<void>();
  vi.mocked(softDeleteExplodedViewFromSupabase).mockReset().mockReturnValueOnce(viewDelete.promise);
  await act(async () => {
    done = result.current.media.deleteExplodedView("task-1", view);
    await Promise.resolve();
  });
  expect(getTaskExplodedViews(task(result.current.plannerState))).toEqual([]);
  await act(async () => { viewDelete.reject(new Error("View delete failed")); await done; });
  expect(getTaskExplodedViews(task(result.current.plannerState)).map((entry) => entry.id)).toEqual(["view-1"]);
  expect(removeExplodedViewObject).not.toHaveBeenCalled();
  vi.mocked(softDeleteExplodedViewFromSupabase).mockResolvedValue(undefined as never);

  await act(async () => { await result.current.media.deleteExplodedView("task-1", view); });
  expect(getTaskExplodedViews(task(result.current.plannerState))).toEqual([]);
  expect(removeExplodedViewObject).toHaveBeenCalledWith(view);
});

it("cuts a photo to another task destination-first, and compensates if a later write fails", async () => {
  vi.mocked(copyStepPhotoAttachmentToStep).mockImplementation(async (_taskId, _stepId, pasted) => ({ ...pasted, storagePath: "photos/copy.png" }));
  const entry = { mode: "cut" as const, photo: existingPhoto, sourceTaskId: "task-1", sourceStepId: "step-1" };
  const target = { taskId: "task-2", stepId: "step-1" };

  // Success: destination saved before the source, then the source photo row is soft-deleted.
  const { result } = renderMedia();
  await act(async () => { await result.current.media.pasteStepPhoto(entry as never, target); });
  const saves = vi.mocked(saveTaskCustomFieldsToSupabase).mock.calls.map((call) => call[0]);
  expect(saves).toEqual(["task-2", "task-1"]);
  expect(softDeleteStepPhotoAttachmentFromSupabase).toHaveBeenCalledWith("photo-existing", "task-1", PROJECT_ID);
  expect(stepPhotoIds(result.current.plannerState, "task-2")).toHaveLength(1);
  expect(stepPhotoIds(result.current.plannerState, "task-1")).toEqual([]);
  expect(result.current.saveInFlightRef.current).toBe(false);

  // Failure on the source write: the destination is reverted in state and in the database.
  vi.clearAllMocks();
  vi.mocked(copyStepPhotoAttachmentToStep).mockImplementation(async (_taskId, _stepId, pasted) => ({ ...pasted, storagePath: "photos/copy.png" }));
  vi.mocked(saveTaskCustomFieldsToSupabase)
    .mockResolvedValueOnce(undefined as never)
    .mockRejectedValueOnce(new Error("Source write failed"));
  const second = renderMedia();
  await act(async () => {
    await expect(second.result.current.media.pasteStepPhoto(entry as never, target)).rejects.toThrow("Source write failed");
  });
  expect(stepPhotoIds(second.result.current.plannerState, "task-1")).toEqual(["photo-existing"]);
  expect(stepPhotoIds(second.result.current.plannerState, "task-2")).toEqual([]);
  const pastedId = vi.mocked(copyStepPhotoAttachmentToStep).mock.calls[0]?.[2].id;
  expect(softDeleteStepPhotoAttachmentFromSupabase).toHaveBeenCalledWith(pastedId, "task-2", PROJECT_ID);
  // Compensating saves restore both touched tasks' customFields.
  expect(vi.mocked(saveTaskCustomFieldsToSupabase).mock.calls.map((call) => call[0])).toEqual(["task-2", "task-1", "task-2", "task-1"]);
  expect(second.result.current.saveInFlightRef.current).toBe(false);
  expect(second.result.current.saveState).toBe("error");
});

it("releases the shell lock through releaseShellLock exactly once per locking write, on success and on failure", async () => {
  vi.mocked(copyStepPhotoAttachmentToStep).mockImplementation(async (_taskId, _stepId, pasted) => ({ ...pasted, storagePath: "photos/copy.png" }));
  const { result } = renderMedia();

  vi.mocked(uploadStepPhotoAttachment).mockResolvedValueOnce(photo("local-ok.png", "photos/ok.png"));
  await act(async () => { await result.current.media.uploadStepPhotos("task-1", "step-1", [new File(["x"], "ok.png")]); });
  expect(shellLockReleased).toHaveBeenCalledTimes(1);

  vi.mocked(uploadStepPhotoAttachment).mockRejectedValueOnce(new Error("Upload failed"));
  await act(async () => { await result.current.media.uploadStepPhotos("task-1", "step-1", [new File(["x"], "bad.png")]); });
  expect(shellLockReleased).toHaveBeenCalledTimes(2);

  const copyEntry = { mode: "copy" as const, photo: existingPhoto, sourceTaskId: "task-1", sourceStepId: "step-1" };
  await act(async () => { await result.current.media.pasteStepPhoto(copyEntry as never, { taskId: "task-2", stepId: "step-1" }); });
  expect(shellLockReleased).toHaveBeenCalledTimes(3);

  vi.mocked(saveTaskCustomFieldsToSupabase).mockRejectedValueOnce(new Error("Destination write failed"));
  await act(async () => {
    await expect(result.current.media.pasteStepPhoto(copyEntry as never, { taskId: "task-2", stepId: "step-1" }))
      .rejects.toThrow("Destination write failed");
  });
  expect(shellLockReleased).toHaveBeenCalledTimes(4);

  await act(async () => { await result.current.media.removeStepPhoto("task-1", "step-1", "photo-existing"); });
  expect(shellLockReleased).toHaveBeenCalledTimes(5);

  vi.mocked(softDeleteStepPhotoAttachmentFromSupabase).mockRejectedValueOnce(new Error("Delete failed"));
  await act(async () => { await result.current.media.removeStepPhoto("task-1", "step-1", "local-ok.png"); });
  expect(shellLockReleased).toHaveBeenCalledTimes(6);
  expect(result.current.saveInFlightRef.current).toBe(false);

  // Video and exploded-view deletes never take the lock, so they never release it.
  await act(async () => {
    await result.current.media.deleteTaskVideo("task-1", video);
    await result.current.media.deleteExplodedView("task-1", view);
  });
  expect(shellLockReleased).toHaveBeenCalledTimes(6);
});
