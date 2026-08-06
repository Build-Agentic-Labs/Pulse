import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import { StepPhotoViewer } from "./step-photo-viewer";

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
  it("opens with discoverable annotation tools and visible photo navigation", () => {
    const onPhotoChange = vi.fn();
    render(
      <StepPhotoViewer
        stepSequence={2}
        photo={photos[0]}
        photos={photos}
        onClose={vi.fn()}
        onPhotoChange={onPhotoChange}
      />,
    );

    const collapseButton = screen.getByRole("button", { name: "Collapse photo toolbar" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    expect(collapseButton).toHaveFocus();
    expect(screen.getByRole("button", { name: "Select annotation" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onPhotoChange).toHaveBeenLastCalledWith(photos[1]);

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(onPhotoChange).toHaveBeenLastCalledWith(photos[2]);
  });

  it("fully removes annotation controls when the toolbar is collapsed", () => {
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
    expect(screen.queryByRole("button", { name: "Draw arrow" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print photo" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
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
  ])("creates and persists the %s WI annotation tool", (buttonName, annotationType) => {
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
    unmount();

    expect(onUpdatePhoto).toHaveBeenCalledWith(
      "photo-1",
      expect.objectContaining({
        annotations: expect.objectContaining({
          items: [expect.objectContaining({ type: annotationType })],
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
});
