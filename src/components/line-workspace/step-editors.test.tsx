// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import type { ManufacturingStep, Task } from "@/domain/types";
import {
  instructionTextSelectionFromTextarea,
  LinkedInstructionTextarea,
  StepPartMentionEditor,
  StepPartReferenceEditor,
  StepPhotoAttachmentEditor,
} from "./step-editors";
import { StepPhotoClipboardProvider } from "./step-photo-clipboard-provider";

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
    <StepPhotoClipboardProvider onPaste={vi.fn()}>
      <StepPhotoAttachmentEditor
        taskId="task-1"
        step={step}
        photos={overrides.photos ?? []}
        isUploading={overrides.isUploading}
        onFilesSelected={onFilesSelected}
        onRequestRemove={vi.fn()}
      />
    </StepPhotoClipboardProvider>,
  );

  return {
    onFilesSelected,
    pasteTarget: screen.getByRole("region", {
      name: "Step 1 photos. Paste an image, press Ctrl+V to paste a copied photo, or use Upload.",
    }),
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

  it("copies a photo onto another step through the clipboard", async () => {
    const photo: StepPhotoAttachment = {
      id: "photo-1",
      name: "Panel.png",
      dataUrl: "https://example.test/panel.png",
      capturedAt: "2026-08-27T00:00:00.000Z",
    };
    const secondStep: ManufacturingStep = { id: "step-2", sequence: 2, instruction: "Fit the panel." };
    const onPaste = vi.fn().mockResolvedValue(undefined);

    render(
      <StepPhotoClipboardProvider onPaste={onPaste}>
        <StepPhotoAttachmentEditor
          taskId="task-1"
          step={step}
          photos={[photo]}
          onFilesSelected={vi.fn()}
          onRequestRemove={vi.fn()}
        />
        <StepPhotoAttachmentEditor
          taskId="task-1"
          step={secondStep}
          photos={[]}
          onFilesSelected={vi.fn()}
          onRequestRemove={vi.fn()}
        />
      </StepPhotoClipboardProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy photo from step 1" }));
    fireEvent.pointerEnter(
      screen.getByRole("region", {
        name: "Step 2 photos. Paste an image, press Ctrl+V to paste a copied photo, or use Upload.",
      }),
    );
    fireEvent.paste(document, { clipboardData: { items: [], files: [] } });

    await waitFor(() =>
      expect(onPaste).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "copy", sourceStepId: "step-1", sourceTaskId: "task-1" }),
        { taskId: "task-1", stepId: "step-2" },
      ),
    );
  });
});

describe("StepPartReferenceEditor", () => {
  it("uses the master BOM search without exposing free-text part entry", () => {
    const task = {
      id: "task-1",
      partReferences: [],
      manufacturingSteps: [step],
    } as unknown as Task;

    render(
      <StepPartReferenceEditor
        task={task}
        step={step}
        partReferences={[]}
        masterBom={{
          fileName: "bom.xlsx",
          columns: ["No.", "Description", "Qty. per Parent"],
          rows: [{ "No.": "P-100", Description: "Cooling hose", "Qty. per Parent": "2" }],
        }}
        onAddFromBom={vi.fn()}
        onLinkExisting={vi.fn()}
        onQuantityChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Search master BOM" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Part number")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("shows the part number, full description, and editable step-specific quantity", () => {
    const onQuantityChange = vi.fn();
    const task = {
      id: "task-1",
      partReferences: [
        {
          id: "part-1",
          partNumber: "2000001475",
          description: "LINING FOAM 125KVA V2 GENERATOR - RAD END ROOF, END",
          quantity: 99,
        },
      ],
      manufacturingSteps: [
        {
          ...step,
          partReferenceIds: ["part-1"],
          partReferenceQuantities: { "part-1": 3 },
        },
      ],
    } as unknown as Task;

    render(
      <StepPartReferenceEditor
        task={task}
        step={task.manufacturingSteps![0]}
        partReferences={task.partReferences!}
        onAddFromBom={vi.fn()}
        onLinkExisting={vi.fn()}
        onQuantityChange={onQuantityChange}
        onRemove={vi.fn()}
      />,
    );

    const partsTable = screen.getByRole("table", { name: "Parts allocated to step 1" });
    expect(partsTable).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Part number" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Description" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Qty" })).toHaveLength(1);
    expect(screen.getByText("2000001475")).toBeInTheDocument();
    const description = screen.getByText("LINING FOAM 125KVA V2 GENERATOR - RAD END ROOF, END");
    expect(description).toBeInTheDocument();
    expect(description).not.toHaveClass("truncate");

    const quantity = screen.getByRole("textbox", { name: "Quantity for 2000001475 on step 1" });
    expect(quantity).toHaveValue("3");
    fireEvent.change(quantity, { target: { value: "8" } });
    expect(onQuantityChange).toHaveBeenCalledWith("part-1", 8);
  });
});

describe("StepPartMentionEditor", () => {
  it("treats a click inside linked text as selecting that hyperlink for editing", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "Install cooling hose";
    textarea.setSelectionRange(10, 10);

    expect(
      instructionTextSelectionFromTextarea(textarea, [
        { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
      ]),
    ).toMatchObject({
      start: 8,
      end: 20,
      text: "cooling hose",
      mentionId: "mention-1",
      partReferenceId: "part-1",
    });

    textarea.setSelectionRange(20, 20);
    expect(
      instructionTextSelectionFromTextarea(textarea, [
        { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
      ]),
    ).toBeUndefined();
  });

  it("floats over the selection and waits for an explicit quantity and Link action", () => {
    const onLink = vi.fn();
    const onCancelSelection = vi.fn();
    const task = {
      id: "task-1",
      partReferences: [],
      manufacturingSteps: [{ ...step, instruction: "Install the cooling hose." }],
      customFields: {},
    } as unknown as Task;

    render(
      <StepPartMentionEditor
        task={task}
        step={task.manufacturingSteps![0]}
        selection={{
          start: 12,
          end: 24,
          text: "cooling hose",
          anchor: { left: 200, top: 100, bottom: 118 },
        }}
        masterBom={{
          fileName: "bom.xlsx",
          columns: ["No.", "Description", "Qty. per Parent"],
          rows: [{ "No.": "P-100", Description: "Cooling hose, reinforced", "Qty. per Parent": "2" }],
        }}
        onLink={onLink}
        onCancelSelection={onCancelSelection}
        onRemoveMention={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Link selected text on step 1" })).toBeInTheDocument();
    expect(screen.getByText("“cooling hose”")).toBeInTheDocument();
    const search = screen.getByRole("combobox", { name: "Search master BOM" });
    fireEvent.focus(search);
    fireEvent.mouseDown(screen.getByRole("button", { name: /P-100/ }));
    expect(onLink).not.toHaveBeenCalled();
    expect(onCancelSelection).not.toHaveBeenCalled();

    const quantity = screen.getByRole("textbox", { name: "Quantity for linked part on step 1" });
    expect(quantity).toHaveValue("2");
    fireEvent.change(quantity, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onLink).toHaveBeenCalledWith({
      partNumber: "P-100",
      description: "Cooling hose, reinforced",
      quantity: 5,
    });
  });

  it("renders linked instruction text like a hyperlink without changing the textarea value", () => {
    const onMentionClick = vi.fn();
    const task = {
      id: "task-1",
      partReferences: [{ id: "part-1", partNumber: "P-100", description: "Cooling hose" }],
      manufacturingSteps: [{ ...step, instruction: "Install cooling hose" }],
      customFields: {
        stepPartMentions: {
          "step-1": [
            { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
          ],
        },
      },
    } as unknown as Task;

    const { container } = render(
      <LinkedInstructionTextarea
        task={task}
        step={task.manufacturingSteps![0]}
        value="Install cooling hose"
        aria-label="Step 1 instruction"
        onChange={vi.fn()}
        onMentionClick={onMentionClick}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Step 1 instruction" })).toHaveValue("Install cooling hose");
    const link = container.querySelector('[data-part-mention-id="mention-1"]');
    expect(link).toHaveTextContent("cooling hose");
    expect(link).toHaveClass("ui-linked-instruction-mention");
    vi.spyOn(link!, "getBoundingClientRect").mockReturnValue({
      left: 120,
      right: 220,
      top: 100,
      bottom: 118,
      width: 100,
      height: 18,
      x: 120,
      y: 100,
      toJSON: () => ({}),
    });
    fireEvent.mouseEnter(link!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("P-100");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Cooling hose");
    fireEvent.click(link!);
    expect(onMentionClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mention-1", partReferenceId: "part-1" }),
      { left: 120, top: 100, bottom: 118 },
    );
  });

  it("closes the popup when the user clicks outside it", () => {
    const onCancelSelection = vi.fn();
    const task = {
      id: "task-1",
      partReferences: [],
      manufacturingSteps: [{ ...step, instruction: "Install cooling hose" }],
      customFields: {},
    } as unknown as Task;

    render(
      <>
        <textarea aria-label="Step 1 instruction" defaultValue="Install cooling hose" />
        <StepPartMentionEditor
          task={task}
          step={task.manufacturingSteps![0]}
          selection={{ start: 8, end: 20, text: "cooling hose" }}
          onLink={vi.fn()}
          onCancelSelection={onCancelSelection}
          onRemoveMention={vi.fn()}
        />
      </>,
    );

    const textarea = screen.getByRole("textbox", { name: "Step 1 instruction" }) as HTMLTextAreaElement;
    textarea.setSelectionRange(8, 20);
    fireEvent.pointerDown(document.body);
    expect(onCancelSelection).toHaveBeenCalledTimes(1);
    expect(textarea.selectionStart).toBe(20);
    expect(textarea.selectionEnd).toBe(20);
  });

  it("opens an existing hyperlink for editing and can remove only that link", () => {
    const onRemoveMention = vi.fn();
    const onCancelSelection = vi.fn();
    const task = {
      id: "task-1",
      partReferences: [{ id: "part-1", partNumber: "P-100", description: "Cooling hose" }],
      manufacturingSteps: [{ ...step, instruction: "Install cooling hose" }],
      customFields: {
        stepPartMentions: {
          "step-1": [
            { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
          ],
        },
      },
    } as unknown as Task;

    render(
      <StepPartMentionEditor
        task={task}
        step={task.manufacturingSteps![0]}
        selection={{
          start: 8,
          end: 20,
          text: "cooling hose",
          mentionId: "mention-1",
          partReferenceId: "part-1",
        }}
        onLink={vi.fn()}
        onCancelSelection={onCancelSelection}
        onRemoveMention={onRemoveMention}
      />,
    );

    expect(screen.getByText("Edit BOM link")).toBeInTheDocument();
    expect(screen.getByText("P-100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(onRemoveMention).toHaveBeenCalledWith("mention-1");
    expect(onCancelSelection).toHaveBeenCalledTimes(1);
  });
});
