// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import {
  StepPhotoClipboardProvider,
  useStepPhotoClipboard,
  type StepPhotoTarget,
} from "./step-photo-clipboard-provider";
import type { StepPhotoClipboardEntry } from "@/domain/step-photo-clipboard";

const photo: StepPhotoAttachment = {
  id: "photo-1",
  name: "Panel.png",
  dataUrl: "https://example.test/panel.png",
  capturedAt: "2026-08-27T00:00:00.000Z",
};

function Harness() {
  const { entry, setActivePhoto, setActiveStep } = useStepPhotoClipboard();

  return (
    <div>
      <button type="button" onPointerEnter={() => setActivePhoto({ photo, taskId: "task-1", stepId: "step-1" })}>
        thumbnail
      </button>
      <div
        role="region"
        aria-label="destination"
        onPointerEnter={() => setActiveStep({ taskId: "task-1", stepId: "step-2" })}
      >
        destination
      </div>
      <textarea aria-label="instruction" defaultValue="text" />
      <span data-testid="mode">{entry?.mode ?? "empty"}</span>
    </div>
  );
}

function renderProvider(
  onPaste: (entry: StepPhotoClipboardEntry, target: StepPhotoTarget) => Promise<void> | void = vi.fn(),
) {
  const onNotify = vi.fn();
  render(
    <StepPhotoClipboardProvider onPaste={onPaste} onNotify={onNotify}>
      <Harness />
    </StepPhotoClipboardProvider>,
  );
  return { onNotify };
}

describe("StepPhotoClipboardProvider", () => {
  it("copies the active photo on Ctrl+C", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("copy");
  });

  it("cuts the active photo on Ctrl+X", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "x", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("cut");
  });

  it("ignores Ctrl+C when no photo is active", () => {
    renderProvider();
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("empty");
  });

  it("ignores Ctrl+C raised from a textarea", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(screen.getByLabelText("instruction"), { key: "c", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("empty");
  });

  it("pastes onto the active step", async () => {
    const onPaste = vi.fn().mockResolvedValue(undefined);
    renderProvider(onPaste);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(document, { clipboardData: { items: [], files: [] } });

    await waitFor(() =>
      expect(onPaste).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "copy", sourceStepId: "step-1" }),
        { taskId: "task-1", stepId: "step-2" },
      ),
    );
  });

  it("yields to a system clipboard image instead of pasting the internal entry", () => {
    const onPaste = vi.fn();
    renderProvider(onPaste);
    const image = new File(["bytes"], "shot.png", { type: "image/png" });

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(document, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }], files: [image] },
    });

    expect(onPaste).not.toHaveBeenCalled();
  });

  it("keeps a copy entry after pasting but clears a cut entry", async () => {
    const onPaste = vi.fn().mockResolvedValue(undefined);
    renderProvider(onPaste);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "x", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(document, { clipboardData: { items: [], files: [] } });

    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("empty"));
  });

  it("ignores Ctrl+C while a text selection is active", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId("mode"));
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      fireEvent.keyDown(document, { key: "c", ctrlKey: true });
      expect(screen.getByTestId("mode")).toHaveTextContent("empty");
    } finally {
      selection?.removeAllRanges();
    }
  });

  it("ignores a paste targeting a textarea", () => {
    const onPaste = vi.fn().mockResolvedValue(undefined);
    renderProvider(onPaste);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(screen.getByLabelText("instruction"), { clipboardData: { items: [], files: [] } });

    expect(onPaste).not.toHaveBeenCalled();
  });
});
