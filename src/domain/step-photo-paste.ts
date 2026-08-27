import type { StepPhotoClipboardEntry } from "./step-photo-clipboard";
import { removeStepPhotoAttachment, upsertStepPhotoAttachments, type StepPhotoAttachment } from "./step-photos";
import type { Task } from "./types";

/**
 * Fold a clipboard paste into the task list: upsert `pastedPhoto` onto the destination step,
 * and — for a cut — remove the source photo from its source step.
 *
 * When source and destination are the SAME task, both edits are folded into that one task
 * object. Two separate updates to the same task id inside a single `tasks.map` pass would
 * otherwise clobber each other (the second write would start from the pre-paste task, not
 * the one the first write just produced).
 */
export function applyPastedPhoto(
  tasks: Task[],
  entry: StepPhotoClipboardEntry,
  targetTaskId: string,
  targetStepId: string,
  pastedPhoto: StepPhotoAttachment,
): Task[] {
  const isCut = entry.mode === "cut";
  const sameTask = entry.sourceTaskId === targetTaskId;

  return tasks.map((task) => {
    if (task.id === targetTaskId) {
      const withPhoto = upsertStepPhotoAttachments(task, targetStepId, [pastedPhoto]);
      return isCut && sameTask
        ? removeStepPhotoAttachment(withPhoto, entry.sourceStepId, entry.photo.id)
        : withPhoto;
    }

    if (isCut && task.id === entry.sourceTaskId) {
      return removeStepPhotoAttachment(task, entry.sourceStepId, entry.photo.id);
    }

    return task;
  });
}

/**
 * The exact inverse of {@link applyPastedPhoto}: removes the pasted photo from the destination
 * step and, for a cut, restores `entry.photo` to its source step — folded into one task object
 * when source and destination coincide, for the same reason as above.
 */
export function revertPastedPhoto(
  tasks: Task[],
  entry: StepPhotoClipboardEntry,
  targetTaskId: string,
  targetStepId: string,
  pastedPhotoId: string,
): Task[] {
  const isCut = entry.mode === "cut";
  const sameTask = entry.sourceTaskId === targetTaskId;

  return tasks.map((task) => {
    if (task.id === targetTaskId) {
      const withoutPaste = removeStepPhotoAttachment(task, targetStepId, pastedPhotoId);
      return isCut && sameTask
        ? upsertStepPhotoAttachments(withoutPaste, entry.sourceStepId, [entry.photo])
        : withoutPaste;
    }

    if (isCut && task.id === entry.sourceTaskId) {
      return upsertStepPhotoAttachments(task, entry.sourceStepId, [entry.photo]);
    }

    return task;
  });
}
