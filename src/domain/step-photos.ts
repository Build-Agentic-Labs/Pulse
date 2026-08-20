import type { Task } from "./types";

export const STEP_PHOTO_ATTACHMENTS_FIELD = "stepPhotoAttachments";
export const STEP_PHOTO_ANNOTATIONS_FIELD = "stepPhotoAnnotations";

import type { PhotoAnnotationDocument } from "./photo-annotations";
import { normalizePhotoAnnotationDocument } from "./photo-annotations";

export interface StepPhotoAttachment {
  id: string;
  name: string;
  dataUrl: string;
  capturedAt: string;
  contentType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  storagePath?: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  caption?: string;
  annotations?: PhotoAnnotationDocument;
}

export type StepPhotoAttachmentMap = Record<string, StepPhotoAttachment[]>;
export type StepPhotoAnnotationMap = Record<string, PhotoAnnotationDocument>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizePhotoAttachment(value: unknown): StepPhotoAttachment | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : "";

  if (!id || (!dataUrl.startsWith("data:image/") && !/^https?:\/\//.test(dataUrl))) {
    return null;
  }

  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Step photo",
    dataUrl,
    capturedAt:
      typeof value.capturedAt === "string" && value.capturedAt.trim()
        ? value.capturedAt
        : new Date().toISOString(),
    contentType: typeof value.contentType === "string" ? value.contentType : undefined,
    sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    storagePath: typeof value.storagePath === "string" ? value.storagePath : undefined,
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : undefined,
    thumbnailStoragePath: typeof value.thumbnailStoragePath === "string" ? value.thumbnailStoragePath : undefined,
    caption: typeof value.caption === "string" ? value.caption : undefined,
    annotations: value.annotations ? normalizePhotoAnnotationDocument(value.annotations) : undefined,
  };
}

export function getTaskStepPhotoAttachmentMap(task: Pick<Task, "customFields">): StepPhotoAttachmentMap {
  const rawMap = task.customFields?.[STEP_PHOTO_ATTACHMENTS_FIELD];

  if (!isRecord(rawMap)) {
    return {};
  }

  return Object.entries(rawMap).reduce<StepPhotoAttachmentMap>((accumulator, [stepId, rawPhotos]) => {
    if (!Array.isArray(rawPhotos)) {
      return accumulator;
    }

    const photos = rawPhotos
      .map(sanitizePhotoAttachment)
      .filter((photo): photo is StepPhotoAttachment => Boolean(photo));

    if (photos.length > 0) {
      accumulator[stepId] = photos;
    }

    return accumulator;
  }, {});
}

/**
 * Photo rows are normalized into `step_photos`, while their lightweight SVG
 * markup stays in task custom fields. Keeping the two maps separate prevents a
 * task save from duplicating signed URLs or stale photo metadata.
 */
export function getTaskStepPhotoAnnotationMap(task: Pick<Task, "customFields">): StepPhotoAnnotationMap {
  const rawMap = task.customFields?.[STEP_PHOTO_ANNOTATIONS_FIELD];

  if (!isRecord(rawMap)) {
    return {};
  }

  return Object.entries(rawMap).reduce<StepPhotoAnnotationMap>((accumulator, [photoId, rawDocument]) => {
    const document = normalizePhotoAnnotationDocument(rawDocument);
    if (photoId && document.items.length > 0) {
      accumulator[photoId] = document;
    }
    return accumulator;
  }, {});
}

export function getStepPhotoAttachments(task: Pick<Task, "customFields">, stepId: string) {
  return getTaskStepPhotoAttachmentMap(task)[stepId] ?? [];
}

export function countTaskStepPhotoAttachments(task: Pick<Task, "customFields">) {
  return Object.values(getTaskStepPhotoAttachmentMap(task)).reduce((total, photos) => total + photos.length, 0);
}

export function duplicateStepPhotoAttachment(photo: StepPhotoAttachment): StepPhotoAttachment {
  return {
    ...photo,
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    annotations: photo.annotations ? normalizePhotoAnnotationDocument(photo.annotations) : undefined,
  };
}

function writePhotoAttachmentMap(task: Task, map: StepPhotoAttachmentMap): Task {
  const cleanedMap = Object.entries(map).reduce<StepPhotoAttachmentMap>((accumulator, [stepId, photos]) => {
    if (photos.length > 0) {
      accumulator[stepId] = photos;
    }

    return accumulator;
  }, {});

  const nextCustomFields = { ...task.customFields };

  if (Object.keys(cleanedMap).length > 0) {
    nextCustomFields[STEP_PHOTO_ATTACHMENTS_FIELD] = cleanedMap;
  } else {
    delete nextCustomFields[STEP_PHOTO_ATTACHMENTS_FIELD];
  }

  const annotationMap = Object.values(cleanedMap)
    .flat()
    .reduce<StepPhotoAnnotationMap>((accumulator, photo) => {
      const document = normalizePhotoAnnotationDocument(photo.annotations);
      if (document.items.length > 0) {
        accumulator[photo.id] = document;
      }
      return accumulator;
    }, {});

  if (Object.keys(annotationMap).length > 0) {
    nextCustomFields[STEP_PHOTO_ANNOTATIONS_FIELD] = annotationMap;
  } else {
    delete nextCustomFields[STEP_PHOTO_ANNOTATIONS_FIELD];
  }

  return {
    ...task,
    customFields: nextCustomFields,
  };
}

export function addStepPhotoAttachments(task: Task, stepId: string, photos: StepPhotoAttachment[]): Task {
  if (photos.length === 0) {
    return task;
  }

  const map = getTaskStepPhotoAttachmentMap(task);
  return writePhotoAttachmentMap(task, {
    ...map,
    [stepId]: [...(map[stepId] ?? []), ...photos],
  });
}

export function upsertStepPhotoAttachments(task: Task, stepId: string, photos: StepPhotoAttachment[]): Task {
  if (photos.length === 0) {
    return task;
  }

  const map = getTaskStepPhotoAttachmentMap(task);
  const photosById = new Map((map[stepId] ?? []).map((photo) => [photo.id, photo]));

  photos.forEach((photo) => {
    photosById.set(photo.id, photo);
  });

  return writePhotoAttachmentMap(task, {
    ...map,
    [stepId]: [...photosById.values()],
  });
}

export function removeStepPhotoAttachment(task: Task, stepId: string, photoId: string): Task {
  const map = getTaskStepPhotoAttachmentMap(task);
  return writePhotoAttachmentMap(task, {
    ...map,
    [stepId]: (map[stepId] ?? []).filter((photo) => photo.id !== photoId),
  });
}

export function updateStepPhotoAttachment(
  task: Task,
  stepId: string,
  photoId: string,
  patch: Partial<StepPhotoAttachment>,
): Task {
  const map = getTaskStepPhotoAttachmentMap(task);
  const photos = map[stepId] ?? [];

  if (!photos.some((photo) => photo.id === photoId)) {
    return task;
  }

  return writePhotoAttachmentMap(task, {
    ...map,
    [stepId]: photos.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo)),
  });
}
