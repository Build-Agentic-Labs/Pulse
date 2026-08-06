// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ManufacturingStep } from "@/domain/types";
import { StepPhotoAttachmentEditor } from "./step-editors";

const step: ManufacturingStep = {
  id: "step-1",
  sequence: 1,
  instruction: "Drain the system.",
};

function renderEditor(overrides: { isUploading?: boolean; onFilesSelected?: (files: File[]) => void } = {}) {
  const onFilesSelected = overrides.onFilesSelected ?? vi.fn();
  render(
    <StepPhotoAttachmentEditor
      step={step}
      photos={[]}
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
});
