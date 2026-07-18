"use client";

import {
  ArrowRight,
  ChevronLeft,
  Download,
  MousePointer2,
  Printer,
  Trash2,
  Type,
  X,
} from "lucide-react";
import NextImage from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  createAnnotationId,
  fontSizeToStrokeWidth,
  measureTextCalloutBox,
  movePhotoAnnotation,
  moveTextCalloutAnchor,
  moveTextCalloutBox,
  normalizePhotoAnnotationDocument,
  PHOTO_ANNOTATION_COLORS,
  PHOTO_ANNOTATION_FONT_SIZES,
  PHOTO_ANNOTATION_VERSION,
  resizeTextCalloutBox,
  stepAnnotationFontSize,
  strokeWidthToFontSize,
  textCalloutBoxHeightPx,
  textCalloutMinHeightPx,
  textCalloutLeaderPoint,
  type PhotoAnnotation,
  type PhotoAnnotationDocument,
  type PhotoAnnotationTool,
  type PhotoArrowAnnotation,
  type PhotoTextAnnotation,
} from "@/domain/photo-annotations";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import { refreshSignedMediaUrl } from "@/domain/supabase-planner";
import { useConfirm } from "@/components/confirm-provider";
import { ThemedSelect } from "./themed-select";

type AnnotationContextMenu = {
  x: number;
  y: number;
  annotationId: string;
};

function isAnnotationTextInputFocused() {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement && active.classList.contains("ui-photo-annotation-text");
}

type DraftArrow = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type DraftCallout = {
  anchorX: number;
  anchorY: number;
  boxX: number;
  boxY: number;
};

type DragState = {
  annotationId: string;
  pointerId: number;
  originX: number;
  originY: number;
  startClientX: number;
  startClientY: number;
  snapshot: PhotoAnnotation;
  active: boolean;
  mode: "default" | "callout-box" | "callout-anchor" | "callout-resize";
};

type DragMode = DragState["mode"];

type TextBoxDragPending = {
  annotationId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  snapshot: PhotoTextAnnotation;
};

const DRAG_THRESHOLD_PX = 4;

type ToolbarVisibility = "expanded" | "minimized";

const DEFAULT_CALLOUT_WIDTH = 0.22;

function getAnnotationFontFamily() {
  return getComputedStyle(document.documentElement).getPropertyValue("--type-sans").trim() || "system-ui, sans-serif";
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function defaultCalloutBox(anchorX: number, anchorY: number, boxWidth: number, boxHeightNorm: number) {
  return {
    x: clamp01(anchorX + 0.08),
    y: clamp01(anchorY - boxHeightNorm - 0.02),
    width: boxWidth,
  };
}

function selectAnnotation(
  annotation: PhotoAnnotation,
  setSelectedId: (id: string) => void,
  setActiveTool: (tool: PhotoAnnotationTool) => void,
  setActiveColor: (color: string) => void,
  setActiveFontSize: (size: number) => void,
) {
  setSelectedId(annotation.id);
  setActiveTool("select");
  setActiveColor(annotation.color);
  setActiveFontSize(
    annotation.type === "text" ? annotation.fontSize : strokeWidthToFontSize(annotation.strokeWidth),
  );
}

function annotationDocumentFromPhoto(photo: StepPhotoAttachment) {
  return normalizePhotoAnnotationDocument(photo.annotations);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function renderAnnotatedPhotoBlob(photo: StepPhotoAttachment, document: PhotoAnnotationDocument) {
  const image = await loadImage(photo.dataUrl);
  const canvas = window.document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to render the annotated photo.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawAnnotationsOnCanvas(context, canvas.width, canvas.height, document.items);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to export the annotated photo."));
          return;
        }

        resolve(blob);
      },
      photo.contentType?.startsWith("image/png") ? "image/png" : "image/jpeg",
      0.92,
    );
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load photo for export."));
    image.src = src;
  });
}

function drawAnnotationsOnCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  items: PhotoAnnotation[],
) {
  const appFont = getComputedStyle(document.documentElement).getPropertyValue("--type-sans").trim() || "system-ui, sans-serif";

  items.forEach((item) => {
    if (item.type === "arrow") {
      drawArrowOnCanvas(context, item, width, height);
      return;
    }

    drawTextOnCanvas(context, item, width, height, appFont);
  });
}

function drawArrowOnCanvas(
  context: CanvasRenderingContext2D,
  arrow: PhotoArrowAnnotation,
  width: number,
  height: number,
) {
  const x1 = arrow.x1 * width;
  const y1 = arrow.y1 * height;
  const x2 = arrow.x2 * width;
  const y2 = arrow.y2 * height;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLength = Math.max(10, arrow.strokeWidth * 5);

  context.strokeStyle = arrow.color;
  context.fillStyle = arrow.color;
  context.lineWidth = arrow.strokeWidth;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();

  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 7), y2 - headLength * Math.sin(angle - Math.PI / 7));
  context.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 7), y2 - headLength * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

function drawTextOnCanvas(
  context: CanvasRenderingContext2D,
  text: PhotoTextAnnotation,
  width: number,
  height: number,
  appFont: string,
) {
  const boxWidth = text.width * width;
  const boxHeight = textCalloutBoxHeightPx(text, height);
  const x = text.x * width;
  const y = text.y * height;
  const padding = 8;
  const accentWidth = 3;
  const anchorX = text.anchorX * width;
  const anchorY = text.anchorY * height;
  const leader = textCalloutLeaderPoint(
    text.anchorX,
    text.anchorY,
    text.x,
    text.y,
    text.width,
    boxHeight / height,
  );

  context.strokeStyle = text.color;
  context.lineWidth = fontSizeToStrokeWidth(text.fontSize);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(anchorX, anchorY);
  context.lineTo(leader.x * width, leader.y * height);
  context.stroke();

  context.fillStyle = text.color;
  context.beginPath();
  context.arc(anchorX, anchorY, Math.max(3, text.fontSize * 0.22), 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffffff";
  context.fillRect(x, y, boxWidth, boxHeight);

  context.fillStyle = text.color;
  context.fillRect(x, y, accentWidth, boxHeight);

  context.fillStyle = "#1a1a1a";
  context.font = `500 ${text.fontSize}px ${appFont}`;
  context.textBaseline = "top";
  wrapCanvasText(
    context,
    text.text,
    x + padding + accentWidth,
    y + padding,
    boxWidth - padding * 2 - accentWidth,
    text.fontSize * 1.35,
  );
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = value.split(/\s+/).filter(Boolean);
  let line = "";
  let cursorY = y;

  words.forEach((word, index) => {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
      return;
    }

    line = testLine;

    if (index === words.length - 1) {
      context.fillText(line, x, cursorY);
    }
  });

  if (words.length === 0 && value) {
    context.fillText(value, x, cursorY);
  }
}

export function StepPhotoViewer({
  stepSequence,
  photo,
  photos,
  onClose,
  onPhotoChange,
  onUpdatePhoto,
}: {
  stepSequence: number;
  photo: StepPhotoAttachment;
  photos: StepPhotoAttachment[];
  onClose: () => void;
  onPhotoChange: (photo: StepPhotoAttachment) => void;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
}) {
  const markerId = useId().replace(/:/g, "");
  const overlayRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const selectedPhotoRef = useRef(photo);
  selectedPhotoRef.current = photo;
  const [activeTool, setActiveTool] = useState<PhotoAnnotationTool>("select");
  const [activeColor, setActiveColor] = useState<string>(PHOTO_ANNOTATION_COLORS[0].value);
  const [activeFontSize, setActiveFontSize] = useState<number>(14);
  const [annotations, setAnnotations] = useState<PhotoAnnotation[]>(() => annotationDocumentFromPhoto(photo).items);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftArrow, setDraftArrow] = useState<DraftArrow | null>(null);
  const [draftCallout, setDraftCallout] = useState<DraftCallout | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [textBoxDragPending, setTextBoxDragPending] = useState<TextBoxDragPending | null>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [contextMenu, setContextMenu] = useState<AnnotationContextMenu | null>(null);
  const [toolbarVisibility, setToolbarVisibility] = useState<ToolbarVisibility>("minimized");
  // Signed URLs expire after an hour, so an idle tab's <img> starts 4xx-ing. On the first load
  // error per object we re-sign once and swap in the fresh URL; a second failure (or a failed
  // re-sign, tracked as null) falls back to a placeholder instead of a broken image.
  const [signedUrlOverrides, setSignedUrlOverrides] = useState<Record<string, string | null>>({});
  const refreshedPathsRef = useRef(new Set<string>());
  const confirm = useConfirm();

  async function handlePhotoError(storagePath?: string) {
    if (!storagePath) {
      return;
    }
    if (refreshedPathsRef.current.has(storagePath)) {
      setSignedUrlOverrides((current) =>
        current[storagePath] === null ? current : { ...current, [storagePath]: null },
      );
      return;
    }
    refreshedPathsRef.current.add(storagePath);
    const freshUrl = await refreshSignedMediaUrl(storagePath, "photo");
    setSignedUrlOverrides((current) => ({ ...current, [storagePath]: freshUrl ?? null }));
  }

  function resolvePhotoSource(storagePath: string | undefined, fallbackUrl: string) {
    if (storagePath) {
      const override = signedUrlOverrides[storagePath];
      if (override !== undefined) {
        return override ?? "";
      }
    }
    return fallbackUrl;
  }

  const selectedAnnotation = useMemo(
    () => annotations.find((item) => item.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  const persistAnnotations = useCallback(
    (nextItems: PhotoAnnotation[]) => {
      if (!onUpdatePhoto) {
        return;
      }

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        onUpdatePhoto(photo.id, {
          annotations: {
            version: PHOTO_ANNOTATION_VERSION,
            items: nextItems,
          } satisfies PhotoAnnotationDocument,
        });
      }, 350);
    },
    [onUpdatePhoto, photo.id],
  );

  const updateAnnotations = useCallback(
    (updater: (current: PhotoAnnotation[]) => PhotoAnnotation[]) => {
      setAnnotations((current) => {
        const next = updater(current);
        persistAnnotations(next);
        return next;
      });
    },
    [persistAnnotations],
  );

  const deleteAnnotation = useCallback(
    (annotationId: string) => {
      updateAnnotations((current) => current.filter((item) => item.id !== annotationId));
      setSelectedId((current) => (current === annotationId ? null : current));
      setContextMenu(null);
    },
    [updateAnnotations],
  );

  // The right-click menu is the discoverable delete affordance, so it gets a themed confirm.
  // Keyboard Delete (below) stays immediate: it already requires a deliberate selection and is
  // guarded against text-input focus, and routing it through the async dialog would collide with
  // this viewer's window-level Escape/Delete key handling (Escape would both cancel the confirm
  // and close the viewer).
  const confirmDeleteAnnotation = useCallback(
    async (annotationId: string) => {
      const ok = await confirm({
        title: "Delete annotation?",
        tone: "danger",
        confirmLabel: "Delete annotation",
      });
      if (ok) {
        deleteAnnotation(annotationId);
      } else {
        setContextMenu(null);
      }
    },
    [confirm, deleteAnnotation],
  );

  const applyColor = useCallback(
    (color: string) => {
      setActiveColor(color);

      if (!selectedId) {
        return;
      }

      updateAnnotations((current) =>
        current.map((item) => (item.id === selectedId ? { ...item, color } : item)),
      );
    },
    [selectedId, updateAnnotations],
  );

  const applySize = useCallback(
    (size: number) => {
      setActiveFontSize(size);

      if (!selectedId) {
        return;
      }

      updateAnnotations((current) =>
        current.map((item) => {
          if (item.id !== selectedId) {
            return item;
          }

          if (item.type === "text") {
            const nextItem = { ...item, fontSize: size };
            if (overlaySize.width > 0 && overlaySize.height > 0) {
              const measured = measureTextCalloutBox(
                nextItem.text,
                size,
                overlaySize.width,
                overlaySize.height,
                nextItem.width,
                getAnnotationFontFamily(),
                true,
                nextItem.width,
              );
              return {
                ...nextItem,
                width: Math.max(nextItem.width, measured.width),
                height: Math.max(nextItem.height ?? measured.height, measured.height),
              };
            }

            return nextItem;
          }

          return { ...item, strokeWidth: fontSizeToStrokeWidth(size) };
        }),
      );
    },
    [overlaySize.height, overlaySize.width, selectedId, updateAnnotations],
  );

  const handleSelectAnnotation = useCallback((annotation: PhotoAnnotation) => {
    selectAnnotation(annotation, setSelectedId, setActiveTool, setActiveColor, setActiveFontSize);
    setContextMenu(null);
  }, []);

  const handleAnnotationContextMenu = useCallback(
    (event: ReactMouseEvent, annotation: PhotoAnnotation) => {
      event.preventDefault();
      event.stopPropagation();
      handleSelectAnnotation(annotation);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        annotationId: annotation.id,
      });
    },
    [handleSelectAnnotation],
  );

  function stepSize(direction: -1 | 1) {
    applySize(stepAnnotationFontSize(activeFontSize, direction));
  }

  useEffect(() => {
    setAnnotations(annotationDocumentFromPhoto(selectedPhotoRef.current).items);
    setSelectedId(null);
    setDraftArrow(null);
    setDraftCallout(null);
    setDragState(null);
    setTextBoxDragPending(null);
    setContextMenu(null);
  }, [photo.id]);

  useEffect(() => {
    if (photos.length <= 1) {
      return;
    }

    const currentIndex = photos.findIndex((candidate) => candidate.id === photo.id);
    if (currentIndex < 0) {
      return;
    }

    const adjacentPhotos = [
      photos[(currentIndex - 1 + photos.length) % photos.length],
      photos[(currentIndex + 1) % photos.length],
    ];

    adjacentPhotos.forEach((adjacentPhoto) => {
      if (!adjacentPhoto?.dataUrl) {
        return;
      }
      const image = new Image();
      image.decoding = "async";
      image.src = adjacentPhoto.dataUrl;
    });
  }, [photo.id, photos]);

  useLayoutEffect(() => {
    if (overlaySize.width <= 0 || overlaySize.height <= 0) {
      return;
    }

    setAnnotations((current) => {
      let changed = false;
      const nextItems = current.map((item) => {
        if (item.type !== "text" || item.height) {
          return item;
        }

        const measured = measureTextCalloutBox(
          item.text,
          item.fontSize,
          overlaySize.width,
          overlaySize.height,
          item.width,
          getAnnotationFontFamily(),
          true,
        );
        changed = true;
        return { ...item, width: measured.width, height: measured.height };
      });

      if (changed) {
        persistAnnotations(nextItems);
        return nextItems;
      }

      return current;
    });
  }, [overlaySize.height, overlaySize.width, persistAnnotations, photo.id]);

  useEffect(() => {
    const focusId = pendingFocusIdRef.current;
    if (!focusId) {
      return;
    }

    pendingFocusIdRef.current = null;
    requestAnimationFrame(() => {
      overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-annotation-id="${focusId}"]`)?.focus();
    });
  }, [annotations, selectedId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function measureOverlay() {
      const node = overlayRef.current;
      if (!node) {
        return;
      }

      setOverlaySize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    }

    measureOverlay();
    const observer = new ResizeObserver(measureOverlay);
    if (overlayRef.current) {
      observer.observe(overlayRef.current);
    }

    return () => observer.disconnect();
  }, [photo.id]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeContextMenu() {
      setContextMenu(null);
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }

        onClose();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        if (isAnnotationTextInputFocused()) {
          return;
        }

        event.preventDefault();
        deleteAnnotation(selectedId);
        return;
      }

      if (isAnnotationTextInputFocused()) {
        return;
      }

      if (photos.length <= 1) {
        return;
      }

      const currentIndex = photos.findIndex((candidate) => candidate.id === photo.id);
      if (currentIndex < 0) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPhotoChange(photos[(currentIndex - 1 + photos.length) % photos.length]);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        onPhotoChange(photos[(currentIndex + 1) % photos.length]);
      }
    }

    window.addEventListener("keydown", handlePreviewKeyDown);
    return () => window.removeEventListener("keydown", handlePreviewKeyDown);
  }, [contextMenu, deleteAnnotation, onClose, onPhotoChange, photo.id, photos, selectedId]);

  function pointFromClient(event: { clientX: number; clientY: number }) {
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { x: 0, y: 0 };
    }

    return {
      x: clamp01((event.clientX - bounds.left) / bounds.width),
      y: clamp01((event.clientY - bounds.top) / bounds.height),
    };
  }

  function pointFromOverlay(event: ReactPointerEvent<HTMLDivElement>) {
    return pointFromClient(event);
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    return pointFromOverlay(event);
  }

  function blurAnnotationTextarea(annotationId: string) {
    overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-annotation-id="${annotationId}"]`)?.blur();
  }

  function applyDragDelta(snapshot: PhotoAnnotation, deltaX: number, deltaY: number, mode: DragMode) {
    if (snapshot.type === "text") {
      if (mode === "callout-anchor") {
        return moveTextCalloutAnchor(snapshot, deltaX, deltaY);
      }

      if (mode === "callout-box") {
        return moveTextCalloutBox(snapshot, deltaX, deltaY);
      }

      return snapshot;
    }

    return movePhotoAnnotation(snapshot, deltaX, deltaY);
  }

  function beginAnnotationDrag(event: ReactPointerEvent, annotation: PhotoAnnotation, mode: DragMode = "default") {
    if (activeTool !== "select") {
      return;
    }

    if (mode === "callout-box" || mode === "callout-resize") {
      blurAnnotationTextarea(annotation.id);
    } else if (isAnnotationTextInputFocused()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleSelectAnnotation(annotation);
    overlayRef.current?.setPointerCapture(event.pointerId);
    const point = pointFromClient(event);
    setDragState({
      annotationId: annotation.id,
      pointerId: event.pointerId,
      originX: point.x,
      originY: point.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      snapshot: annotation,
      active: mode === "callout-resize",
      mode,
    });
  }

  function beginTextBoxDragPending(event: ReactPointerEvent, annotation: PhotoTextAnnotation) {
    if (activeTool !== "select") {
      return;
    }

    event.stopPropagation();
    handleSelectAnnotation(annotation);
    overlayRef.current?.setPointerCapture(event.pointerId);
    const point = pointFromClient(event);
    setTextBoxDragPending({
      annotationId: annotation.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: point.x,
      originY: point.y,
      snapshot: annotation,
    });
  }

  function createTextCallout(anchorX: number, anchorY: number, boxX: number, boxY: number) {
    const minHeightNorm =
      overlaySize.height > 0 ? textCalloutMinHeightPx(activeFontSize) / overlaySize.height : 0.08;
    const distance = Math.hypot(boxX - anchorX, boxY - anchorY);
    const placement =
      distance > 0.02
        ? {
            x: clamp01(boxX),
            y: clamp01(boxY),
            width: DEFAULT_CALLOUT_WIDTH,
          }
        : defaultCalloutBox(anchorX, anchorY, DEFAULT_CALLOUT_WIDTH, minHeightNorm);
    const measured =
      overlaySize.width > 0 && overlaySize.height > 0
        ? measureTextCalloutBox(
            "",
            activeFontSize,
            overlaySize.width,
            overlaySize.height,
            placement.width,
            getAnnotationFontFamily(),
            true,
          )
        : { width: placement.width, height: minHeightNorm };

    const id = createAnnotationId("text");
    const nextText: PhotoTextAnnotation = {
      id,
      type: "text",
      color: activeColor,
      fontSize: activeFontSize,
      anchorX,
      anchorY,
      x: placement.x,
      y: placement.y,
      width: measured.width,
      height: measured.height,
      text: "",
    };

    updateAnnotations((current) => [...current, nextText]);
    setSelectedId(id);
    setActiveColor(nextText.color);
    setActiveFontSize(nextText.fontSize);
    pendingFocusIdRef.current = id;
    setActiveTool("select");
  }

  function handleOverlayPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragState || textBoxDragPending) {
      return;
    }

    setContextMenu(null);

    if (activeTool === "select") {
      if (event.target === event.currentTarget) {
        setSelectedId(null);
      }
      return;
    }

    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (activeTool === "arrow") {
      setDraftArrow({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      return;
    }

    if (activeTool === "text") {
      setDraftCallout({
        anchorX: point.x,
        anchorY: point.y,
        boxX: point.x,
        boxY: point.y,
      });
    }
  }

  function handleOverlayPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (textBoxDragPending) {
      const moved = Math.hypot(
        event.clientX - textBoxDragPending.startClientX,
        event.clientY - textBoxDragPending.startClientY,
      );

      if (moved < DRAG_THRESHOLD_PX) {
        return;
      }

      const pending = textBoxDragPending;
      blurAnnotationTextarea(pending.annotationId);
      setTextBoxDragPending(null);

      const point = pointFromClient(event);
      const deltaX = point.x - pending.originX;
      const deltaY = point.y - pending.originY;

      setDragState({
        annotationId: pending.annotationId,
        pointerId: pending.pointerId,
        originX: pending.originX,
        originY: pending.originY,
        startClientX: pending.startClientX,
        startClientY: pending.startClientY,
        snapshot: pending.snapshot,
        active: true,
        mode: "callout-box",
      });

      updateAnnotations((current) =>
        current.map((item) =>
          item.id === pending.annotationId
            ? applyDragDelta(pending.snapshot, deltaX, deltaY, "callout-box")
            : item,
        ),
      );
      return;
    }

    if (dragState) {
      let currentDrag = dragState;

      if (!currentDrag.active) {
        const moved = Math.hypot(event.clientX - currentDrag.startClientX, event.clientY - currentDrag.startClientY);
        if (moved < DRAG_THRESHOLD_PX) {
          return;
        }

        currentDrag = { ...currentDrag, active: true };
        setDragState(currentDrag);
      }

      const point = pointFromClient(event);
      const snapshot = currentDrag.snapshot;

      if (currentDrag.mode === "callout-resize" && snapshot.type === "text") {
        updateAnnotations((current) =>
          current.map((item) =>
            item.id === currentDrag.annotationId
              ? resizeTextCalloutBox(snapshot, point.x, point.y, overlaySize.width, overlaySize.height)
              : item,
          ),
        );
        return;
      }

      const deltaX = point.x - currentDrag.originX;
      const deltaY = point.y - currentDrag.originY;

      updateAnnotations((current) =>
        current.map((item) =>
          item.id === currentDrag.annotationId
            ? applyDragDelta(currentDrag.snapshot, deltaX, deltaY, currentDrag.mode)
            : item,
        ),
      );
      return;
    }

    if (draftArrow) {
      const point = pointFromEvent(event);
      setDraftArrow((current) => (current ? { ...current, x2: point.x, y2: point.y } : current));
      return;
    }

    if (draftCallout) {
      const point = pointFromEvent(event);
      setDraftCallout((current) => (current ? { ...current, boxX: point.x, boxY: point.y } : current));
    }
  }

  function handleOverlayPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (textBoxDragPending) {
      const pendingId = textBoxDragPending.annotationId;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      setTextBoxDragPending(null);
      requestAnimationFrame(() => {
        overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-annotation-id="${pendingId}"]`)?.focus();
      });
      return;
    }

    if (dragState) {
      const wasActive = dragState.active;
      const draggedId = dragState.annotationId;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      setDragState(null);

      if (wasActive) {
        overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-annotation-id="${draggedId}"]`)?.blur();
      }

      return;
    }

    if (draftArrow) {
      const distance = Math.hypot(draftArrow.x2 - draftArrow.x1, draftArrow.y2 - draftArrow.y1);
      if (distance > 0.01) {
        const id = createAnnotationId("arrow");
        const nextArrow: PhotoArrowAnnotation = {
          id,
          type: "arrow",
          color: activeColor,
          strokeWidth: fontSizeToStrokeWidth(activeFontSize),
          x1: draftArrow.x1,
          y1: draftArrow.y1,
          x2: draftArrow.x2,
          y2: draftArrow.y2,
        };
        updateAnnotations((current) => [...current, nextArrow]);
        handleSelectAnnotation(nextArrow);
      }

      setDraftArrow(null);
      setActiveTool("select");
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (draftCallout) {
      createTextCallout(draftCallout.anchorX, draftCallout.anchorY, draftCallout.boxX, draftCallout.boxY);
      setDraftCallout(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  async function downloadCurrentPhoto() {
    const document = {
      version: 1 as const,
      items: annotations,
    };
    const extension = photo.contentType?.includes("png") ? "png" : "jpg";
    const baseName = photo.name.replace(/\.[^.]+$/, "") || `step-${stepSequence}-photo`;

    if (annotations.length === 0) {
      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();
      downloadBlob(blob, `${baseName}.${extension}`);
      return;
    }

    const blob = await renderAnnotatedPhotoBlob(photo, document);
    downloadBlob(blob, `${baseName}-annotated.${extension}`);
  }

  function printCurrentPhoto() {
    const printFrame = document.createElement("iframe");
    printFrame.title = `Print ${photo.name}`;
    printFrame.className = "fixed bottom-0 right-0 h-0 w-0 border-0";
    document.body.appendChild(printFrame);

    const printWindow = printFrame.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      printFrame.remove();
      return;
    }

    printDocument.open();
    printDocument.write("<!doctype html><html><head><title></title></head><body></body></html>");
    printDocument.close();
    printDocument.title = photo.name;

    const appFont = getComputedStyle(document.documentElement).getPropertyValue("--type-sans").trim() || "system-ui, sans-serif";
    const style = printDocument.createElement("style");
    style.textContent = `html,body{margin:0;min-height:100%;background:white;font-family:${appFont};}body{display:flex;align-items:center;justify-content:center;padding:24px;}img{max-width:100%;max-height:calc(100vh - 48px);object-fit:contain;}`;
    printDocument.head.appendChild(style);

    const image = printDocument.createElement("img");
    image.src = photo.dataUrl;
    image.alt = `Step ${stepSequence} photo ${photo.name}`;
    printDocument.body.appendChild(image);

    let cleanupTimer: number | undefined;
    const cleanup = () => {
      if (cleanupTimer) {
        window.clearTimeout(cleanupTimer);
      }
      printFrame.remove();
    };

    const printImage = () => {
      printWindow.focus();
      printWindow.addEventListener("afterprint", cleanup, { once: true });
      cleanupTimer = window.setTimeout(cleanup, 30_000);
      printWindow.print();
    };

    if (image.complete) {
      printImage();
    } else {
      image.onload = printImage;
      image.onerror = cleanup;
    }
  }

  function renderAnnotation(item: PhotoAnnotation) {
    const selected = item.id === selectedId;

    if (item.type === "arrow") {
      return (
        <g
          key={item.id}
          className={`ui-photo-annotation-item ${selected ? "ui-photo-annotation-item-selected" : ""}`}
          onPointerDown={(event) => {
            if (activeTool !== "select") {
              return;
            }

            beginAnnotationDrag(event, item);
          }}
          onContextMenu={(event) => handleAnnotationContextMenu(event, item)}
        >
          <line
            x1={item.x1 * overlaySize.width}
            y1={item.y1 * overlaySize.height}
            x2={item.x2 * overlaySize.width}
            y2={item.y2 * overlaySize.height}
            stroke="transparent"
            strokeWidth={Math.max(item.strokeWidth * 4, 14)}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className={selected ? "ui-photo-annotation-stroke-selected" : undefined}
            x1={item.x1 * overlaySize.width}
            y1={item.y1 * overlaySize.height}
            x2={item.x2 * overlaySize.width}
            y2={item.y2 * overlaySize.height}
            stroke={item.color}
            strokeWidth={item.strokeWidth}
            markerEnd={`url(#${markerId})`}
          />
        </g>
      );
    }

    const boxHeightPx = textCalloutBoxHeightPx(item, overlaySize.height);
    const boxHeightNorm = overlaySize.height > 0 ? boxHeightPx / overlaySize.height : 0;
    const leader = textCalloutLeaderPoint(
      item.anchorX,
      item.anchorY,
      item.x,
      item.y,
      item.width,
      boxHeightNorm,
    );

    return (
      <g
        key={item.id}
        className={`ui-photo-annotation-item ui-photo-annotation-item-text ${selected ? "ui-photo-annotation-item-selected" : ""}`}
        onContextMenu={(event) => handleAnnotationContextMenu(event, item)}
      >
        <line
          className="ui-photo-callout-leader-hit"
          x1={item.anchorX * overlaySize.width}
          y1={item.anchorY * overlaySize.height}
          x2={leader.x * overlaySize.width}
          y2={leader.y * overlaySize.height}
          stroke="transparent"
          strokeWidth={14}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => {
            if (activeTool !== "select") {
              return;
            }

            beginAnnotationDrag(event, item, "callout-anchor");
          }}
        />
        <line
          className={selected ? "ui-photo-annotation-stroke-selected" : undefined}
          x1={item.anchorX * overlaySize.width}
          y1={item.anchorY * overlaySize.height}
          x2={leader.x * overlaySize.width}
          y2={leader.y * overlaySize.height}
          stroke={item.color}
          strokeWidth={fontSizeToStrokeWidth(item.fontSize)}
          strokeLinecap="round"
        />
        <circle
          className="ui-photo-callout-anchor"
          cx={item.anchorX * overlaySize.width}
          cy={item.anchorY * overlaySize.height}
          r={Math.max(3, item.fontSize * 0.22)}
          fill={item.color}
          onPointerDown={(event) => {
            if (activeTool !== "select") {
              return;
            }

            beginAnnotationDrag(event, item, "callout-anchor");
          }}
        />
        <foreignObject
          x={item.x * overlaySize.width}
          y={item.y * overlaySize.height}
          width={item.width * overlaySize.width}
          height={boxHeightPx}
        >
          <div
            className={`ui-photo-callout ui-photo-callout-move ${selected ? "ui-photo-callout-selected" : ""}`}
            onPointerDown={(event) => {
              if (activeTool !== "select") {
                return;
              }

              if ((event.target as HTMLElement).closest("textarea, .ui-photo-callout-resize")) {
                return;
              }

              beginAnnotationDrag(event, item, "callout-box");
            }}
          >
            {selected ? (
              <div
                className="ui-photo-callout-handle"
                aria-hidden="true"
                title="Drag to move callout"
                onPointerDown={(event) => beginAnnotationDrag(event, item, "callout-box")}
              />
            ) : (
              <div className="ui-photo-callout-handle ui-photo-callout-handle-spacer" aria-hidden="true" />
            )}
            <textarea
              data-annotation-id={item.id}
              className={`ui-photo-annotation-text ${selected ? "ui-photo-annotation-text-selected" : ""}`}
              style={{
                fontSize: `${item.fontSize}px`,
                borderLeftColor: item.color,
              }}
              value={item.text}
              placeholder=""
              onPointerDown={(event) => beginTextBoxDragPending(event, item)}
              onFocus={() => handleSelectAnnotation(item)}
              onChange={(event) => {
                const nextText = event.target.value;
                const measured = measureTextCalloutBox(
                  nextText,
                  item.fontSize,
                  overlaySize.width,
                  overlaySize.height,
                  item.width,
                  getAnnotationFontFamily(),
                  true,
                  item.width,
                );

                updateAnnotations((current) =>
                  current.map((candidate) =>
                    candidate.id === item.id && candidate.type === "text"
                      ? {
                          ...candidate,
                          text: nextText,
                          width: Math.max(candidate.width, measured.width),
                          height: Math.max(candidate.height ?? measured.height, measured.height),
                        }
                      : candidate,
                  ),
                );
              }}
              rows={1}
            />
            {selected ? (
              <div
                className="ui-photo-callout-resize"
                aria-hidden="true"
                title="Drag to resize callout"
                onPointerDown={(event) => beginAnnotationDrag(event, item, "callout-resize")}
              />
            ) : null}
          </div>
        </foreignObject>
      </g>
    );
  }

  function renderDraftCalloutPreview() {
    if (!draftCallout || overlaySize.width <= 0 || overlaySize.height <= 0) {
      return null;
    }

    const boxHeightPx = textCalloutMinHeightPx(activeFontSize);
    const boxHeightNorm = boxHeightPx / overlaySize.height;
    const distance = Math.hypot(draftCallout.boxX - draftCallout.anchorX, draftCallout.boxY - draftCallout.anchorY);
    const placement =
      distance > 0.02
        ? { x: draftCallout.boxX, y: draftCallout.boxY, width: DEFAULT_CALLOUT_WIDTH }
        : defaultCalloutBox(
            draftCallout.anchorX,
            draftCallout.anchorY,
            DEFAULT_CALLOUT_WIDTH,
            boxHeightNorm,
          );
    const leader = textCalloutLeaderPoint(
      draftCallout.anchorX,
      draftCallout.anchorY,
      placement.x,
      placement.y,
      placement.width,
      boxHeightNorm,
    );

    return (
      <g className="ui-photo-annotation-draft">
        <line
          x1={draftCallout.anchorX * overlaySize.width}
          y1={draftCallout.anchorY * overlaySize.height}
          x2={leader.x * overlaySize.width}
          y2={leader.y * overlaySize.height}
          stroke={activeColor}
          strokeWidth={fontSizeToStrokeWidth(activeFontSize)}
          strokeLinecap="round"
          opacity={0.85}
        />
        <circle
          cx={draftCallout.anchorX * overlaySize.width}
          cy={draftCallout.anchorY * overlaySize.height}
          r={Math.max(3, activeFontSize * 0.22)}
          fill={activeColor}
          opacity={0.85}
        />
        <rect
          x={placement.x * overlaySize.width}
          y={placement.y * overlaySize.height}
          width={placement.width * overlaySize.width}
          height={boxHeightPx}
          rx={4}
          fill="#ffffff"
          stroke={activeColor}
          strokeWidth={1}
          opacity={0.92}
        />
      </g>
    );
  }

  return (
    <div
      className="ui-photo-viewer fixed inset-0 z-[95] flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Step ${stepSequence} photo preview`}
      onClick={onClose}
    >
      <div className="ui-photo-viewer-frame" onClick={(event) => event.stopPropagation()}>
        {resolvePhotoSource(photo.storagePath, photo.dataUrl) ? (
          <NextImage
            src={resolvePhotoSource(photo.storagePath, photo.dataUrl)}
            alt={`Step ${stepSequence} photo ${photo.name}`}
            width={photo.width ?? 1280}
            height={photo.height ?? 960}
            unoptimized
            fetchPriority="high"
            className="ui-photo-viewer-image"
            onError={() => void handlePhotoError(photo.storagePath)}
          />
        ) : (
          <div className="ui-photo-viewer-image flex min-h-64 items-center justify-center text-sm text-ink-tertiary">
            Photo unavailable
          </div>
        )}
        <div
          ref={overlayRef}
          className={`ui-photo-viewer-annotation-layer ${activeTool === "select" ? "ui-photo-viewer-annotation-layer-select" : "ui-photo-viewer-annotation-layer-draw"}${dragState?.active ? " ui-photo-viewer-annotation-dragging" : ""}`}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
        >
          {overlaySize.width > 0 && overlaySize.height > 0 ? (
            <svg
              className="ui-photo-viewer-annotation-svg"
              width={overlaySize.width}
              height={overlaySize.height}
              viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
            >
              <defs>
                <marker
                  id={markerId}
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
                </marker>
              </defs>
              {annotations.map(renderAnnotation)}
              {renderDraftCalloutPreview()}
              {draftArrow ? (
                <line
                  x1={draftArrow.x1 * overlaySize.width}
                  y1={draftArrow.y1 * overlaySize.height}
                  x2={draftArrow.x2 * overlaySize.width}
                  y2={draftArrow.y2 * overlaySize.height}
                  stroke={activeColor}
                  strokeWidth={fontSizeToStrokeWidth(activeFontSize)}
                  markerEnd={`url(#${markerId})`}
                  opacity={0.85}
                />
              ) : null}
            </svg>
          ) : null}
        </div>
        <div
          className={`ui-photo-viewer-toolbar ${toolbarVisibility === "minimized" ? "ui-photo-viewer-toolbar-minimized" : ""}`}
        >
          <button
            type="button"
            className="ui-photo-viewer-toolbar-toggle ui-photo-viewer-tool"
            onClick={() =>
              setToolbarVisibility((current) => (current === "minimized" ? "expanded" : "minimized"))
            }
            aria-label={toolbarVisibility === "minimized" ? "Expand photo toolbar" : "Collapse photo toolbar"}
            title={toolbarVisibility === "minimized" ? "Expand toolbar" : "Collapse toolbar"}
            aria-expanded={toolbarVisibility === "expanded"}
          >
            <ChevronLeft size={12} strokeWidth={1.75} />
          </button>
          <div className="ui-photo-viewer-toolbar-tools-wrap">
            <div
              className="ui-photo-viewer-toolbar-tools"
              aria-hidden={toolbarVisibility === "minimized"}
            >
              <button
                type="button"
                className={`ui-photo-viewer-tool ${activeTool === "select" ? "ui-photo-viewer-tool-active" : ""}`}
                onClick={() => setActiveTool("select")}
                aria-label="Select annotation"
                title="Select"
                tabIndex={toolbarVisibility === "minimized" ? -1 : 0}
              >
                <MousePointer2 size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={`ui-photo-viewer-tool ${activeTool === "arrow" ? "ui-photo-viewer-tool-active" : ""}`}
                onClick={() => setActiveTool("arrow")}
                aria-label="Draw arrow"
                title="Arrow"
                tabIndex={toolbarVisibility === "minimized" ? -1 : 0}
              >
                <ArrowRight size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={`ui-photo-viewer-tool ${activeTool === "text" ? "ui-photo-viewer-tool-active" : ""}`}
                onClick={() => setActiveTool("text")}
                aria-label="Add text callout"
                title="Text callout"
                tabIndex={toolbarVisibility === "minimized" ? -1 : 0}
              >
                <Type size={13} strokeWidth={1.75} />
              </button>
              <div className="ui-photo-viewer-toolbar-divider" aria-hidden="true" />
              <label className="ui-photo-viewer-color-select-wrap">
                <span className="sr-only">Annotation color</span>
                <span
                  className="ui-photo-viewer-color-select-swatch"
                  style={{ backgroundColor: activeColor }}
                  aria-hidden="true"
                />
                <ThemedSelect
                  className="ui-photo-viewer-color-select"
                  triggerClassName="h-8 px-2 text-xs"
                  value={activeColor}
                  onChange={applyColor}
                  options={PHOTO_ANNOTATION_COLORS}
                  aria-label="Annotation color"
                  disabled={toolbarVisibility === "minimized"}
                />
              </label>
              <div className="ui-photo-viewer-size-stepper" aria-label="Annotation size">
                <button
                  type="button"
                  className="ui-photo-viewer-size-step"
                  onClick={() => stepSize(-1)}
                  disabled={activeFontSize <= PHOTO_ANNOTATION_FONT_SIZES[0]}
                  aria-label="Decrease annotation size"
                  title="Decrease size"
                  tabIndex={toolbarVisibility === "minimized" ? -1 : 0}
                >
                  A-
                </button>
                <span className="ui-photo-viewer-size-value">{activeFontSize}</span>
                <button
                  type="button"
                  className="ui-photo-viewer-size-step"
                  onClick={() => stepSize(1)}
                  disabled={activeFontSize >= PHOTO_ANNOTATION_FONT_SIZES[PHOTO_ANNOTATION_FONT_SIZES.length - 1]}
                  aria-label="Increase annotation size"
                  title="Increase size"
                  tabIndex={toolbarVisibility === "minimized" ? -1 : 0}
                >
                  A+
                </button>
              </div>
              <div className="ui-photo-viewer-toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className={`ui-photo-viewer-tool ${selectedAnnotation ? "" : "ui-photo-viewer-tool-disabled"}`}
                onClick={() => {
                  if (selectedAnnotation) {
                    deleteAnnotation(selectedAnnotation.id);
                  }
                }}
                disabled={!selectedAnnotation}
                aria-label="Delete selected annotation"
                title="Delete selected"
                tabIndex={toolbarVisibility === "minimized" ? -1 : 0}
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </div>
          </div>
            <div className="ui-photo-viewer-toolbar-actions">
              <button
                type="button"
                onClick={() => void downloadCurrentPhoto()}
                className="ui-btn-ghost-overlay ui-photo-viewer-toolbar-action"
                aria-label="Download photo"
                title="Download photo"
              >
                <Download size={12} strokeWidth={1.75} />
                <span className="ui-photo-viewer-toolbar-action-text">Download</span>
              </button>
              <button
                type="button"
                onClick={printCurrentPhoto}
                className="ui-btn-ghost-overlay ui-photo-viewer-toolbar-action"
                aria-label="Print photo"
                title="Print photo"
              >
                <Printer size={12} strokeWidth={1.75} />
                <span className="ui-photo-viewer-toolbar-action-text">Print</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="ui-btn-ghost-overlay ui-photo-viewer-toolbar-action ui-photo-viewer-toolbar-action-close"
                aria-label="Close photo preview"
                title="Close"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            </div>
        </div>
      </div>
      {contextMenu ? (
        <div
          className="ui-photo-annotation-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="ui-photo-annotation-context-menu-item ui-photo-annotation-context-menu-item-danger"
            onClick={() => void confirmDeleteAnnotation(contextMenu.annotationId)}
          >
            Delete annotation
          </button>
        </div>
      ) : null}
    </div>
  );
}
