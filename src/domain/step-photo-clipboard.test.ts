import { describe, expect, it } from "vitest";

import type { StepPhotoAttachment } from "./step-photos";
import { canPasteInto, createStepPhotoClipboardEntry } from "./step-photo-clipboard";

const photo: StepPhotoAttachment = {
  id: "photo-1",
  name: "Panel.png",
  dataUrl: "https://example.test/panel.png",
  capturedAt: "2026-08-27T00:00:00.000Z",
};

const entry = createStepPhotoClipboardEntry(photo, "task-1", "step-1", "copy");

describe("createStepPhotoClipboardEntry", () => {
  it("snapshots the photo with its source location and mode", () => {
    expect(entry).toEqual({
      photo,
      sourceTaskId: "task-1",
      sourceStepId: "step-1",
      mode: "copy",
    });
  });
});

describe("canPasteInto", () => {
  it("rejects an empty clipboard", () => {
    expect(canPasteInto(null, "task-1", "step-2")).toBe(false);
  });

  it("rejects the step the photo came from", () => {
    expect(canPasteInto(entry, "task-1", "step-1")).toBe(false);
  });

  it("allows another step in the same task", () => {
    expect(canPasteInto(entry, "task-1", "step-2")).toBe(true);
  });

  it("allows a step in a different task", () => {
    expect(canPasteInto(entry, "task-2", "step-1")).toBe(true);
  });
});
