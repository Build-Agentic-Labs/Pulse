import { EXPLODED_VIEWS_FIELD } from "./step-exploded-views";
import { STEP_PHOTO_ATTACHMENTS_FIELD, getTaskStepPhotoAnnotationMap } from "./step-photos";
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

  // Signing/hydration must not replace newer markup with the older media response.
  const media = customFields[STEP_PHOTO_ATTACHMENTS_FIELD];
  const annotations = getTaskStepPhotoAnnotationMap(localTask);
  if (media && typeof media === "object" && !Array.isArray(media)) {
    customFields[STEP_PHOTO_ATTACHMENTS_FIELD] = Object.fromEntries(Object.entries(media).map(([stepId, photos]) => [
      stepId, Array.isArray(photos) ? photos.map(photo => {
        if (!photo || typeof photo !== "object") return photo;
        const next = {...photo};
        if (annotations[photo.id]) next.annotations = annotations[photo.id];
        else delete next.annotations;
        return next;
      }) : photos,
    ]));
  }
  return { ...localTask, customFields };
}
