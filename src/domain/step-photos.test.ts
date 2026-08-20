import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import {
  STEP_PHOTO_ANNOTATIONS_FIELD,
  addStepPhotoAttachments,
  duplicateStepPhotoAttachment,
  getTaskStepPhotoAnnotationMap,
  getStepPhotoAttachments,
  removeStepPhotoAttachment,
  updateStepPhotoAttachment,
} from "./step-photos";

const photo = {
  id: "photo-1",
  name: "Bracket",
  dataUrl: "https://example.test/bracket.jpg",
  capturedAt: "2026-08-06T12:00:00.000Z",
};

const task = {
  id: "task-1",
  customFields: {
    stepPhotoAttachments: {
      "step-1": [photo],
    },
  },
} as unknown as Task;

describe("step photo annotations", () => {
  it("duplicates a photo into another step with a new identity and the same markup", () => {
    const annotated = updateStepPhotoAttachment(task, "step-1", photo.id, {
      caption: "Mounting face",
      annotations: {
        version: 2,
        items: [
          {
            id: "rectangle-1",
            type: "rectangle",
            color: "#d71921",
            strokeWidth: 3,
            x: 0.2,
            y: 0.2,
            width: 0.4,
            height: 0.3,
          },
        ],
      },
    });
    const source = getStepPhotoAttachments(annotated, "step-1")[0];
    const duplicate = duplicateStepPhotoAttachment(source);
    const copied = addStepPhotoAttachments(annotated, "step-2", [duplicate]);

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.dataUrl).toBe(source.dataUrl);
    expect(duplicate.caption).toBe("Mounting face");
    expect(getStepPhotoAttachments(copied, "step-1")).toHaveLength(1);
    expect(getStepPhotoAttachments(copied, "step-2")).toEqual([duplicate]);
    expect(getTaskStepPhotoAnnotationMap(copied)[duplicate.id]?.items).toHaveLength(1);
  });

  it("keeps markup in a lightweight map that survives normalized media persistence", () => {
    const updated = updateStepPhotoAttachment(task, "step-1", photo.id, {
      annotations: {
        version: 2,
        items: [
          {
            id: "rectangle-1",
            type: "rectangle",
            color: "#d71921",
            strokeWidth: 3,
            x: 0.2,
            y: 0.2,
            width: 0.4,
            height: 0.3,
          },
        ],
      },
    });

    expect(getTaskStepPhotoAnnotationMap(updated)[photo.id]?.items).toHaveLength(1);
    expect(updated.customFields?.[STEP_PHOTO_ANNOTATIONS_FIELD]).toBeTruthy();
  });

  it("removes persisted markup when its photo is removed", () => {
    const annotated = updateStepPhotoAttachment(task, "step-1", photo.id, {
      annotations: {
        version: 2,
        items: [
          {
            id: "ellipse-1",
            type: "ellipse",
            color: "#007aff",
            strokeWidth: 2,
            x: 0.1,
            y: 0.1,
            width: 0.25,
            height: 0.25,
          },
        ],
      },
    });

    const removed = removeStepPhotoAttachment(annotated, "step-1", photo.id);
    expect(getTaskStepPhotoAnnotationMap(removed)).toEqual({});
    expect(removed.customFields?.[STEP_PHOTO_ANNOTATIONS_FIELD]).toBeUndefined();
  });
});
