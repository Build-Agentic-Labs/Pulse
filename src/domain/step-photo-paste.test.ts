import { describe, expect, it } from "vitest";

import { createStepPhotoClipboardEntry, type StepPhotoClipboardMode } from "./step-photo-clipboard";
import { applyPastedPhoto, revertPastedPhoto } from "./step-photo-paste";
import { getStepPhotoAttachments } from "./step-photos";
import type { StepPhotoAttachment } from "./step-photos";
import type { Task } from "./types";

const sourcePhoto: StepPhotoAttachment = {
  id: "photo-1",
  name: "Bracket.png",
  dataUrl: "https://example.test/bracket.png",
  capturedAt: "2026-08-06T12:00:00.000Z",
};

const pastedPhoto: StepPhotoAttachment = {
  id: "photo-2",
  name: "Bracket.png",
  dataUrl: "https://example.test/bracket.png",
  capturedAt: "2026-08-06T12:00:05.000Z",
};

/**
 * task-1/step-1 holds the source photo. task-1/step-1b is a second step on the SAME task,
 * used for the same-task paste cases. task-2/step-2 is a step on a DIFFERENT task, used for
 * the cross-task cases.
 */
function buildTasks(): Task[] {
  return [
    {
      id: "task-1",
      customFields: {
        stepPhotoAttachments: {
          "step-1": [sourcePhoto],
        },
      },
    } as unknown as Task,
    {
      id: "task-2",
      customFields: {},
    } as unknown as Task,
  ];
}

describe("applyPastedPhoto", () => {
  it("adds a copy to another step in the same task, leaving the source untouched", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "copy");

    const result = applyPastedPhoto(tasks, entry, "task-1", "step-1b", pastedPhoto);

    expect(getStepPhotoAttachments(result[0], "step-1")).toEqual([sourcePhoto]);
    expect(getStepPhotoAttachments(result[0], "step-1b")).toEqual([pastedPhoto]);
    expect(result[1]).toBe(tasks[1]);
  });

  it("adds a copy to a step in a different task, leaving the source task untouched", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "copy");

    const result = applyPastedPhoto(tasks, entry, "task-2", "step-2", pastedPhoto);

    expect(getStepPhotoAttachments(result[0], "step-1")).toEqual([sourcePhoto]);
    expect(getStepPhotoAttachments(result[1], "step-2")).toEqual([pastedPhoto]);
  });

  it("folds a same-task cut into a single task object: pasted photo added, source removed", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "cut");

    const result = applyPastedPhoto(tasks, entry, "task-1", "step-1b", pastedPhoto);

    expect(result).toHaveLength(2);
    expect(getStepPhotoAttachments(result[0], "step-1")).toEqual([]);
    expect(getStepPhotoAttachments(result[0], "step-1b")).toEqual([pastedPhoto]);
    expect(result[1]).toBe(tasks[1]);
  });

  it("moves a cross-task cut: pasted photo lands on the destination, source is stripped from its own task", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "cut");

    const result = applyPastedPhoto(tasks, entry, "task-2", "step-2", pastedPhoto);

    expect(getStepPhotoAttachments(result[0], "step-1")).toEqual([]);
    expect(getStepPhotoAttachments(result[1], "step-2")).toEqual([pastedPhoto]);
  });

  it("does not mutate the input array or any task object in it", () => {
    const tasks = buildTasks();
    const originalTask1 = tasks[0];
    const originalTask2 = tasks[1];
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "cut");

    applyPastedPhoto(tasks, entry, "task-2", "step-2", pastedPhoto);

    expect(tasks[0]).toBe(originalTask1);
    expect(tasks[1]).toBe(originalTask2);
    expect(getStepPhotoAttachments(tasks[0], "step-1")).toEqual([sourcePhoto]);
    expect(getStepPhotoAttachments(tasks[1], "step-2")).toEqual([]);
  });
});

describe("revertPastedPhoto", () => {
  it("removes a copied photo from the destination step in the same task", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "copy");
    const pasted = applyPastedPhoto(tasks, entry, "task-1", "step-1b", pastedPhoto);

    const reverted = revertPastedPhoto(pasted, entry, "task-1", "step-1b", pastedPhoto.id);

    expect(getStepPhotoAttachments(reverted[0], "step-1b")).toEqual([]);
    expect(getStepPhotoAttachments(reverted[0], "step-1")).toEqual([sourcePhoto]);
  });

  it("removes a copied photo from the destination step in a different task", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "copy");
    const pasted = applyPastedPhoto(tasks, entry, "task-2", "step-2", pastedPhoto);

    const reverted = revertPastedPhoto(pasted, entry, "task-2", "step-2", pastedPhoto.id);

    expect(getStepPhotoAttachments(reverted[1], "step-2")).toEqual([]);
    expect(getStepPhotoAttachments(reverted[0], "step-1")).toEqual([sourcePhoto]);
  });

  it("folds a same-task cut revert into one task object: pasted photo removed, source restored", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "cut");
    const pasted = applyPastedPhoto(tasks, entry, "task-1", "step-1b", pastedPhoto);

    const reverted = revertPastedPhoto(pasted, entry, "task-1", "step-1b", pastedPhoto.id);

    expect(reverted).toHaveLength(2);
    expect(getStepPhotoAttachments(reverted[0], "step-1b")).toEqual([]);
    expect(getStepPhotoAttachments(reverted[0], "step-1")).toEqual([sourcePhoto]);
  });

  it("undoes a cross-task cut: pasted photo removed from the destination, source restored on its own task", () => {
    const tasks = buildTasks();
    const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", "cut");
    const pasted = applyPastedPhoto(tasks, entry, "task-2", "step-2", pastedPhoto);

    const reverted = revertPastedPhoto(pasted, entry, "task-2", "step-2", pastedPhoto.id);

    expect(getStepPhotoAttachments(reverted[1], "step-2")).toEqual([]);
    expect(getStepPhotoAttachments(reverted[0], "step-1")).toEqual([sourcePhoto]);
  });
});

describe("applyPastedPhoto / revertPastedPhoto round trip", () => {
  const modes: StepPhotoClipboardMode[] = ["copy", "cut"];
  const targets: Array<{ label: string; taskId: string; stepId: string }> = [
    { label: "same task", taskId: "task-1", stepId: "step-1b" },
    { label: "cross task", taskId: "task-2", stepId: "step-2" },
  ];

  modes.forEach((mode) => {
    targets.forEach(({ label, taskId, stepId }) => {
      it(`returns the task list to its original photo attachments for a ${mode} paste (${label})`, () => {
        const tasks = buildTasks();
        const entry = createStepPhotoClipboardEntry(sourcePhoto, "task-1", "step-1", mode);

        const pasted = applyPastedPhoto(tasks, entry, taskId, stepId, pastedPhoto);
        const reverted = revertPastedPhoto(pasted, entry, taskId, stepId, pastedPhoto.id);

        expect(getStepPhotoAttachments(reverted[0], "step-1")).toEqual(
          getStepPhotoAttachments(tasks[0], "step-1"),
        );
        expect(getStepPhotoAttachments(reverted[0], "step-1b")).toEqual(
          getStepPhotoAttachments(tasks[0], "step-1b"),
        );
        expect(getStepPhotoAttachments(reverted[1], "step-2")).toEqual(
          getStepPhotoAttachments(tasks[1], "step-2"),
        );
      });
    });
  });
});
