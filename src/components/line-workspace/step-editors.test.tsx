// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import type { ManufacturingStep } from "@/domain/types";
import { StepPhotoAttachmentEditor } from "./step-editors";

const step: ManufacturingStep = {
  id: "step-1",
  sequence: 1,
  instruction: "Drain the system.",
};

function renderEditor(overrides: {
  isUploading?: boolean;
  onFilesSelected?: (files: File[]) => void;
  photos?: StepPhotoAttachment[];
} = {}) {
  const onFilesSelected = overrides.onFilesSelected ?? vi.fn();
  render(
    <StepPhotoAttachmentEditor
      step={step}
      photos={overrides.photos ?? []}
      isUploading={overrides.isUploading}
      onFilesSelected={onFilesSelected}
      onRequestRemove={vi.fn()}
    />,
  );

  return {
    onFilesSelected,
    pasteTarget: screen.getByRole("region", { name: "Step 1 photos. Paste an image or use Upload." }),
  };
}

describe("StepPhotoAttachmentEditor clipboard paste", () => {
  it("sends pasted image files through the existing upload callback", () => {
    const { onFilesSelected, pasteTarget } = renderEditor();
    const image = new File(["image-bytes"], "clipboard-image.png", { type: "image/png" });

    fireEvent.paste(pasteTarget, {
      clipboardData: {
        files: [image],
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image,
          },
        ],
      },
    });

    expect(onFilesSelected).toHaveBeenCalledWith([image]);
  });

  it("ignores clipboard content that does not contain an image", () => {
    const { onFilesSelected, pasteTarget } = renderEditor();

    fireEvent.paste(pasteTarget, {
      clipboardData: {
        files: [],
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      },
    });

    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it("does not enqueue another paste while an upload is active", () => {
    const { onFilesSelected, pasteTarget } = renderEditor({ isUploading: true });
    const image = new File(["image-bytes"], "clipboard-image.png", { type: "image/png" });

    fireEvent.paste(pasteTarget, {
      clipboardData: {
        files: [image],
        items: [],
      },
    });

    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(pasteTarget).toHaveAttribute("tabindex", "-1");
  });

  it("shows the full photo aspect ratio and saved markups in the compact strip", () => {
    const photo: StepPhotoAttachment = {
      id: "photo-1",
      name: "Portrait.png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      capturedAt: "2026-08-06T00:00:00.000Z",
      width: 600,
      height: 1200,
      annotations: {
        version: 2,
        items: [
          {
            id: "rectangle-1",
            type: "rectangle",
            color: "#d71921",
            strokeWidth: 3,
            x: 0.2,
            y: 0.25,
            width: 0.4,
            height: 0.3,
          },
        ],
      },
    };

    renderEditor({ photos: [photo] });

    const preview = screen.getByRole("img", { name: "Step 1 photo" });
    expect(preview).toHaveClass("h-40");
    expect(preview).toHaveStyle({ width: "92px" });
    expect(preview).toHaveAttribute("viewBox", "0 0 600 1200");
    expect(preview).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(preview.querySelector("image")).toHaveAttribute("preserveAspectRatio", "none");
    expect(preview.querySelector('[data-annotation-type="rectangle"]')).not.toBeNull();
  });
});
