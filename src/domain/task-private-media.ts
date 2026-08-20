import { EXPLODED_VIEWS_FIELD } from "./step-exploded-views";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "./step-photos";
import { TASK_VIDEOS_FIELD } from "./task-videos";
import type { Task } from "./types";

const TASK_PRIVATE_MEDIA_FIELDS = [
  STEP_PHOTO_ATTACHMENTS_FIELD,
  EXPLODED_VIEWS_FIELD,
  TASK_VIDEOS_FIELD,
] as const;

/**
 * Applies a task-detail response's private media without replacing procedure
 * text, steps, or other local fields that may have changed while media loaded.
 */
export function mergeTaskPrivateMedia(localTask: Task, hydratedTask: Task): Task {
  const customFields = { ...localTask.customFields };

  for (const field of TASK_PRIVATE_MEDIA_FIELDS) {
    if (field in hydratedTask.customFields) {
      customFields[field] = hydratedTask.customFields[field];
    } else {
      delete customFields[field];
    }
  }

  return { ...localTask, customFields };
}
