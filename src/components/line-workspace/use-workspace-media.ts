"use client";

import type { RefObject } from "react";
import { applyPastedPhoto, revertPastedPhoto } from "@/domain/step-photo-paste";
import type { StepPhotoClipboardEntry } from "@/domain/step-photo-clipboard";
import { removeTaskExplodedView, upsertTaskExplodedViews, type ExplodedView } from "@/domain/step-exploded-views";
import {
  duplicateStepPhotoAttachment,
  getStepPhotoAttachments,
  removeStepPhotoAttachment,
  upsertStepPhotoAttachments,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import {
  copyStepPhotoAttachmentToStep,
  removeExplodedViewObject,
  removeTaskVideoObject,
  saveTaskCustomFieldsToSupabase,
  softDeleteExplodedViewFromSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  softDeleteTaskVideoFromSupabase,
  uploadStepPhotoAttachment,
} from "@/domain/supabase-planner";
import { removeTaskVideo, upsertTaskVideos, type TaskVideo } from "@/domain/task-videos";
import type { PlannerProjectContext } from "@/domain/types";
import { settleWriteBatch, type WorkspaceWriteTracker } from "@/domain/workspace-save-status";
import { buildStepPhotoAttachment } from "@/lib/step-photo-image";
import type { StepPhotoTarget } from "./step-photo-clipboard-provider";
import type { PlannerStateAccess, ReportedSaveStatusSetters, WorkspaceFeedback } from "./workspace-controller-types";

// Step photos, build animations and exploded views: uploads, clipboard paste/cut, deletes and their
// rollbacks. Optimistic changes and rollbacks touch only the affected item on the current task, so
// procedure edits made while a write runs survive. Photo uploads, pastes and photo deletes hold the
// shell-save lock (saveInFlightRef from useWorkspaceSaves): a shell save requested meanwhile queues
// behind them and is sent when they release it (releaseShellLock).

export type RestoreActionNotice = {
  body: string;
  onRestore: () => void;
  restoreLabel?: string;
  title: string;
};

export type UseWorkspaceMediaOptions = PlannerStateAccess &
  ReportedSaveStatusSetters &
  Pick<WorkspaceFeedback, "notifyFeedback"> & {
    projectId?: string;
    /** The workspace's active project context; new uploads are stored under it. */
    activeProjectContext?: PlannerProjectContext;
    writeTracker: WorkspaceWriteTracker;
    /** The shared shell-save lock. Held while uploads, pastes and photo deletes run. */
    saveInFlightRef: RefObject<boolean>;
    /** Releases the lock and drains a shell save that queued behind it (useWorkspaceSaves). */
    releaseShellLock: () => void;
    /** Shows the existing "Restore" notice after a delete. */
    notifyRestoreAction: (notice: RestoreActionNotice) => void;
    /** Runs a realtime refresh that was deferred while local saves were pending. */
    flushDeferredRemoteRefresh: () => void;
  };

// Re-declared every render like the component code it came from: async continuations keep the values
// of the render that started them.
export function useWorkspaceMedia({
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
}: UseWorkspaceMediaOptions) {
  async function uploadStepPhotos(taskId: string, stepId: string, files: File[]) {
    if (files.length === 0) {
      return;
    }

    let localPhotos: StepPhotoAttachment[] = [];
    const finishWrite = writeTracker.begin(`photo-upload:${taskId}:${stepId}`);
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

      const uploadedPhotos = await settleWriteBatch(
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

      finishWrite(error);
      setSaveError(error instanceof Error ? error.message : "Unable to attach the selected photo.");
      setSaveState("error");
    } finally {
      releaseShellLock();
      finishWrite();
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
    const finishWrite = writeTracker.begin(`photo-paste:${target.taskId}:${target.stepId}`);

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

      finishWrite(error);
      const message = error instanceof Error ? error.message : "Unable to paste this photo.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Photo paste failed", body: message, tone: "danger" });
      throw error;
    } finally {
      releaseShellLock();
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function deleteTaskVideo(taskId: string, video: TaskVideo) {
    const finishWrite = writeTracker.begin(`video:${video.id}`);
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? removeTaskVideo(task, video.id) : task)),
    }));
    try {
      await softDeleteTaskVideoFromSupabase(video.id, taskId, projectId);
      setSaveState("saved");
      void removeTaskVideoObject(video);
    } catch (error) {
      // Restore only this item; preserve edits made to the task while deletion ran.
      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => task.id === taskId ? upsertTaskVideos(task, [video]) : task),
      }));
      finishWrite(error);
      notifyFeedback({
        title: "Couldn't delete build animation",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "danger",
      });
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function deleteExplodedView(taskId: string, view: ExplodedView) {
    const finishWrite = writeTracker.begin(`exploded-view:${view.id}`);
    // Exploded views live in customFields (not persisted on task save), so the soft-delete on the
    // step_exploded_views row is the source of truth; update local state immediately for responsiveness.
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? removeTaskExplodedView(task, view.id) : task)),
    }));
    try {
      await softDeleteExplodedViewFromSupabase(view.id, taskId, projectId);
      setSaveState("saved");
      void removeExplodedViewObject(view);
    } catch (error) {
      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => task.id === taskId ? upsertTaskExplodedViews(task, [view]) : task),
      }));
      finishWrite(error);
      notifyFeedback({
        title: "Couldn't delete exploded view",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "danger",
      });
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function removeStepPhoto(taskId: string, stepId: string, photoId: string) {
    const finishWrite = writeTracker.begin(`photo:${photoId}`);
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
            const finishRestore = writeTracker.begin(`photo:${photoId}`);
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
                finishRestore(error);
                const message = error instanceof Error ? error.message : "Unable to restore the selected photo.";
                setSaveError(message);
                setSaveState("error");
                notifyFeedback({ title: "Restore failed", body: message, tone: "danger" });
              })
              .finally(() => { finishRestore(); flushDeferredRemoteRefresh(); });
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

      finishWrite(error);
      const message = error instanceof Error ? error.message : "Unable to remove the selected photo.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Delete failed", body: message, tone: "danger" });
    } finally {
      releaseShellLock();
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  return {
    uploadStepPhotos,
    pasteStepPhoto,
    deleteTaskVideo,
    deleteExplodedView,
    removeStepPhoto,
  };
}
