import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import { drawTextOnCanvas, StepPhotoViewer } from "./step-photo-viewer";
import { StaticPhotoAnnotation } from "./static-photo-annotation";
import type { PhotoTextAnnotation } from "@/domain/photo-annotations";

const photos: StepPhotoAttachment[] = [1, 2, 3].map((number) => ({
  id: `photo-${number}`,
  name: `Photo ${number}.png`,
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  capturedAt: "2026-08-05T00:00:00.000Z",
  contentType: "image/png",
  width: 800,
  height: 600,
}));

let notifyResizeObserver: (() => void) | undefined;

beforeAll(() => {
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      notifyResizeObserver = () => callback([], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

function prepareOverlay(container: HTMLElement) {
  const overlay = container.querySelector<HTMLElement>(".ui-photo-viewer-annotation-layer");
  expect(overlay).not.toBeNull();

  Object.defineProperties(overlay!, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
    getBoundingClientRect: {
      value: () => ({
        bottom: 600,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    },
  });

  act(() => notifyResizeObserver?.());

  return overlay!;
}

describe("StepPhotoViewer toolbar", () => {
  const label: PhotoTextAnnotation = {
    id: "alignment-label", type: "text", color: "#d71921", fontSize: 14,
    anchorX: 0.1, anchorY: 0.1, x: 0.2, y: 0.2, width: 0.3, height: 0.2,
    text: "D1\nRemove panel", textAlign: "right",
  };

  it("loads a text box's alignment, changes only that box, and persists it on close", () => {
    const photo = { ...photos[0], annotations: { version: 2 as const, items: [label, { ...label, id: "other-label", textAlign: "left" as const }] } };
    const onUpdatePhoto = vi.fn();
    const { container, unmount } = render(
      <StepPhotoViewer photo={photo} photos={[photo]} stepSequence={2}
        onClose={vi.fn()} onPhotoChange={vi.fn()} onUpdatePhoto={onUpdatePhoto} />,
    );
    prepareOverlay(container);
    expect(screen.getByRole("button", { name: "Align text center" })).toBeDisabled();
    const textBox = container.querySelector<HTMLTextAreaElement>('[data-annotation-id="alignment-label"]')!;
    fireEvent.focus(textBox);
    expect(screen.getByRole("button", { name: "Align text right" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Align text center" }));
    expect(textBox).toHaveStyle({ textAlign: "center" });
    expect(screen.getByRole("button", { name: "Align text center" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    expect(onUpdatePhoto.mock.calls.at(-1)?.[1].annotations.items).toEqual([
      expect.objectContaining({ id: label.id, textAlign: "center" }),
      expect.objectContaining({ id: "other-label", textAlign: "left" }),
    ]);
  });

  it("uses the chosen alignment for a new text box", () => {
    const onUpdatePhoto = vi.fn();
    const { container, unmount } = render(
      <StepPhotoViewer photo={photos[0]} photos={photos} stepSequence={2}
        onClose={vi.fn()} onPhotoChange={vi.fn()} onUpdatePhoto={onUpdatePhoto} />,
    );
    const overlay = prepareOverlay(container);
    fireEvent.click(screen.getByRole("button", { name: "Add text callout" }));
    fireEvent.click(screen.getByRole("button", { name: "Align text right" }));
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 200, pointerId: 1 });
    expect(container.querySelector("textarea")).toHaveStyle({ textAlign: "right" });
    unmount();
    expect(onUpdatePhoto.mock.calls.at(-1)?.[1].annotations.items).toEqual([
      expect.objectContaining({ type: "text", textAlign: "right" }),
    ]);
  });

  it.each(["left", "center", "right"] as const)("preserves %s alignment in static previews and exported multiline text", (textAlign) => {
    const annotation = { ...label, textAlign, additionalAnchors: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.6 }] };
    const { container } = render(<svg><StaticPhotoAnnotation annotation={annotation} width={800} height={600} markerId="arrow" /></svg>);
    expect(container.querySelector("foreignObject div")).toHaveStyle({ textAlign });
    const context = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      measureText: (value: string) => ({ width: value.length * 7 }), textAlign: "left",
    };
    drawTextOnCanvas(context as unknown as CanvasRenderingContext2D, annotation, 800, 600, "Arial");
    expect(context.textAlign).toBe(textAlign);
    const expectedX = textAlign === "left" ? 170 : textAlign === "center" ? 280 : 390;
    expect(context.fillText.mock.calls).toEqual([
      ["D1", expectedX, 161.1], ["Remove panel", expectedX, 180],
    ]);
    expect(context.strokeRect).toHaveBeenCalledWith(161, 121, 238, 118);
    expect(context.moveTo).toHaveBeenCalledTimes(3);
    expect(context.arc).toHaveBeenCalledTimes(3);
    expect(container.querySelectorAll("[data-callout-pointer]")).toHaveLength(3);
    expect(container.querySelector("foreignObject div")).toHaveStyle({ justifyContent: "center", border: "2px solid #d71921" });
  });

  it("adds multiple pointers and drags each endpoint independently", () => {
    const photo = { ...photos[0], annotations: { version: 2 as const, items: [label] } };
    const onUpdatePhoto = vi.fn();
    const { container, unmount } = render(
      <StepPhotoViewer photo={photo} photos={[photo]} stepSequence={2}
        onClose={vi.fn()} onPhotoChange={vi.fn()} onUpdatePhoto={onUpdatePhoto} />,
    );
    const overlay = prepareOverlay(container);
    fireEvent.focus(container.querySelector("textarea")!);
    const addPointer = screen.getByRole("button", { name: "Add pointer to selected callout" });
    fireEvent.click(addPointer);
    fireEvent.pointerDown(overlay, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.click(addPointer);
    fireEvent.pointerDown(overlay, { clientX: 600, clientY: 300, pointerId: 2 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 300, pointerId: 2 });
    expect(container.querySelectorAll("[data-callout-pointer]")).toHaveLength(3);
    const secondEndpoint = container.querySelector('[data-callout-pointer="1"] circle')!;
    fireEvent.pointerDown(secondEndpoint, { clientX: 400, clientY: 300, pointerId: 3 });
    fireEvent.pointerMove(overlay, { clientX: 480, clientY: 360, pointerId: 3 });
    fireEvent.pointerUp(overlay, { clientX: 480, clientY: 360, pointerId: 3 });
    unmount();
    const saved = onUpdatePhoto.mock.calls.at(-1)?.[1].annotations.items[0];
    expect(saved).toMatchObject({ anchorX: label.anchorX, anchorY: label.anchorY, x: label.x, y: label.y });
    expect(saved.additionalAnchors).toEqual([{ x: 0.6, y: 0.6 }, { x: 0.75, y: 0.5 }]);
  });

  it("opens with an expanded toolbar and visible photo navigation", () => {
    const onPhotoChange = vi.fn();
    const { container } = render(
      <StepPhotoViewer
        stepSequence={2}
        photo={photos[0]}
        photos={photos}
        onClose={vi.fn()}
        onPhotoChange={onPhotoChange}
      />,
    );

    const toggleButton = screen.getByRole("button", { name: "Collapse photo toolbar" });
    expect(screen.getByRole("dialog", { name: "Step 2 photo preview" })).toHaveClass("!m-0");
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(toggleButton).toHaveFocus();
    expect(container.querySelector(".ui-photo-viewer-toolbar")).not.toHaveClass(
      "ui-photo-viewer-toolbar-minimized",
    );
    expect(screen.queryByRole("button", { name: "Select annotation" })).toBeInTheDocument();
    expect(container.querySelector(".ui-photo-viewer-annotation-layer")).toHaveClass(
      "ui-photo-viewer-annotation-layer-select",
    );
    expect(screen.queryByRole("button", { name: "Draw arrow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close photo preview" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onPhotoChange).toHaveBeenLastCalledWith(photos[1]);

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(onPhotoChange).toHaveBeenLastCalledWith(photos[2]);
  });

  it("keeps the minimized toolbar compact and restores the full toolset when expanded", () => {
    render(
      <StepPhotoViewer
        stepSequence={2}
        photo={photos[0]}
        photos={photos}
        onClose={vi.fn()}
        onPhotoChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse photo toolbar" }));
    expect(screen.getByRole("button", { name: "Expand photo toolbar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.querySelector(".ui-photo-viewer-toolbar")).toHaveClass(
      "ui-photo-viewer-toolbar-minimized",
    );
    expect(document.querySelector(".ui-photo-viewer-toolbar-tools-wrap")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Draw arrow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close photo preview" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand photo toolbar" }));
    expect(screen.getByRole("button", { name: "Draw arrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print photo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse photo toolbar" }));
    expect(screen.getByRole("button", { name: "Expand photo toolbar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("flushes a pending annotation update when the viewer closes", () => {
    const onUpdatePhoto = vi.fn();
    const { container, unmount } = render(
      <StepPhotoViewer
        stepSequence={2}
        photo={photos[0]}
        photos={photos}
        onClose={vi.fn()}
        onPhotoChange={vi.fn()}
        onUpdatePhoto={onUpdatePhoto}
      />,
    );
    const overlay = prepareOverlay(container);

    fireEvent.click(screen.getByRole("button", { name: "Draw arrow" }));
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 250, pointerId: 1 });

    expect(overlay).toHaveClass("ui-photo-viewer-annotation-layer-draw");
    expect(screen.queryByText(/^(Saving|Saved)$/)).not.toBeInTheDocument();
    unmount();

    expect(onUpdatePhoto).toHaveBeenCalledTimes(1);
    expect(onUpdatePhoto).toHaveBeenCalledWith(
      "photo-1",
      expect.objectContaining({
        annotations: expect.objectContaining({
          items: [expect.objectContaining({ type: "arrow" })],
        }),
      }),
    );
  });

  it.each([
    ["Draw rectangle", "rectangle"],
    ["Draw circle or ellipse", "ellipse"],
    ["Draw freehand", "freehand"],
    ["Highlight area", "highlight"],
  ])("keeps %s active for repeated placement until Select is chosen", (buttonName, annotationType) => {
    const onUpdatePhoto = vi.fn();
    const { container, unmount } = render(
      <StepPhotoViewer
        stepSequence={2}
        photo={photos[0]}
        photos={photos}
        onClose={vi.fn()}
        onPhotoChange={vi.fn()}
        onUpdatePhoto={onUpdatePhoto}
      />,
    );
    const overlay = prepareOverlay(container);

    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    fireEvent.pointerDown(overlay, { clientX: 120, clientY: 140, pointerId: 2 });
    fireEvent.pointerMove(overlay, { clientX: 360, clientY: 320, pointerId: 2 });
    fireEvent.pointerUp(overlay, { clientX: 360, clientY: 320, pointerId: 2 });
    expect(screen.getByRole("button", { name: buttonName })).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerDown(overlay, { clientX: 400, clientY: 140, pointerId: 3 });
    fireEvent.pointerMove(overlay, { clientX: 600, clientY: 320, pointerId: 3 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 320, pointerId: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Select annotation" }));
    expect(overlay).toHaveClass("ui-photo-viewer-annotation-layer-select");
    unmount();

    expect(onUpdatePhoto).toHaveBeenCalledWith(
      "photo-1",
      expect.objectContaining({
        annotations: expect.objectContaining({
          items: [expect.objectContaining({ type: annotationType }), expect.objectContaining({ type: annotationType })],
        }),
      }),
    );
  });

  it("pivots a selected arrow from either endpoint while keeping the opposite endpoint fixed", () => {
    const onUpdatePhoto = vi.fn();
    const arrowPhoto: StepPhotoAttachment = {
      ...photos[0],
      annotations: {
        version: 2,
        items: [
          {
            id: "arrow-1",
            type: "arrow",
            color: "#d71921",
            strokeWidth: 3,
            x1: 0.1,
            y1: 0.1,
            x2: 0.5,
            y2: 0.5,
          },
        ],
      },
    };
    const { container, unmount } = render(
      <StepPhotoViewer
        stepSequence={2}
        photo={arrowPhoto}
        photos={[arrowPhoto]}
        onClose={vi.fn()}
        onPhotoChange={vi.fn()}
        onUpdatePhoto={onUpdatePhoto}
      />,
    );
    const overlay = prepareOverlay(container);
    const arrowHitTarget = container.querySelector<SVGLineElement>(
      ".ui-photo-annotation-item line[stroke='transparent']",
    );
    expect(arrowHitTarget).not.toBeNull();

    fireEvent.pointerDown(arrowHitTarget!, { clientX: 80, clientY: 60, pointerId: 3 });
    fireEvent.pointerUp(overlay, { clientX: 80, clientY: 60, pointerId: 3 });

    const headHandle = container.querySelector<SVGCircleElement>("[data-arrow-pivot='end']");
    expect(headHandle).not.toBeNull();
    fireEvent.pointerDown(headHandle!, { clientX: 400, clientY: 300, pointerId: 4 });
    fireEvent.pointerMove(overlay, { clientX: 600, clientY: 450, pointerId: 4 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 450, pointerId: 4 });

    const tailHandle = container.querySelector<SVGCircleElement>("[data-arrow-pivot='start']");
    expect(tailHandle).not.toBeNull();
    fireEvent.pointerDown(tailHandle!, { clientX: 80, clientY: 60, pointerId: 5 });
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 120, pointerId: 5 });
    fireEvent.pointerUp(overlay, { clientX: 200, clientY: 120, pointerId: 5 });
    unmount();

    const savedArrow = onUpdatePhoto.mock.calls.at(-1)?.[1]?.annotations?.items?.[0];
    expect(savedArrow).toEqual(
      expect.objectContaining({
        type: "arrow",
        x1: 0.25,
        y1: 0.2,
        x2: 0.75,
        y2: 0.75,
      }),
    );
  });

  it("supports direct keyboard shortcuts for WI annotation tools", () => {
    render(
      <StepPhotoViewer
        stepSequence={2}
        photo={photos[0]}
        photos={photos}
        onClose={vi.fn()}
        onPhotoChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByRole("button", { name: "Draw rectangle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByRole("button", { name: "Draw circle or ellipse" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("duplicates and copies annotations without leaving the active drawing tool", () => {
    const onUpdatePhoto = vi.fn();
    const { container, unmount } = render(
      <StepPhotoViewer photo={photos[0]} photos={photos} stepSequence={2}
        onClose={vi.fn()} onPhotoChange={vi.fn()} onUpdatePhoto={onUpdatePhoto} />,
    );
    const overlay = prepareOverlay(container);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Draw rectangle" }));
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.keyDown(dialog, { key: "d", ctrlKey: true });
    fireEvent.keyDown(dialog, { key: "c", metaKey: true });
    fireEvent.keyDown(dialog, { key: "v", metaKey: true });
    expect(screen.getByRole("button", { name: "Draw rectangle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "v" });
    expect(overlay).toHaveClass("ui-photo-viewer-annotation-layer-select");
    unmount();
    const saved = onUpdatePhoto.mock.calls.at(-1)?.[1].annotations.items;
    expect(saved).toHaveLength(3);
    expect(new Set(saved.map((item: { id: string }) => item.id)).size).toBe(3);
    expect(saved[1].x).toBeCloseTo(saved[0].x + 0.025);
    expect(saved[2].x).toBeCloseTo(saved[1].x + 0.025);
    expect(saved[2].width).toBe(saved[0].width);
  });
});
