"use client";

import "./photo-overlay.css";
import { renderAnnotatedPhotoBlob } from "@/lib/photo-annotation-export";
// Preserve existing callers while rendering implementation lives outside the viewer.
export { drawAnnotationsOnCanvas, drawTextOnCanvas } from "@/lib/photo-annotation-export";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  CopyPlus,
  ClipboardPaste,
  Download,
  Highlighter,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  PanelTopClose,
  PanelTopOpen,
  Pencil,
  Plus,
  Printer,
  Square,
  Split,
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
  cropPhotoImage,
  fontSizeToStrokeWidth,
  measureTextCalloutBox,
  movePhotoAnnotation,
  moveTextCalloutAnchor,
  moveTextCalloutBox,
  normalizePhotoAnnotationDocument,
  PHOTO_ANNOTATION_COLORS,
  PHOTO_ANNOTATION_FONT_SIZES,
  PHOTO_ANNOTATION_VERSION,
  isPhotoBoxAnnotation,
  resizePhotoBoxAnnotation,
  resizeTextCalloutBox,
  stepAnnotationFontSize,
  strokeWidthToFontSize,
  textCalloutBoxHeightPx,
  textCalloutMinHeightPx,
  textCalloutLeaderPoint,
  textCalloutAnchors,
  type PhotoAnnotation,
  type PhotoImageAnnotation,
  type PhotoAnnotationDocument,
  type PhotoAnnotationTool,
  type PhotoArrowAnnotation,
  type PhotoBoxAnnotation,
  type PhotoFreehandAnnotation,
  type PhotoFreehandPoint,
  type PhotoHighlightAnnotation,
  type PhotoTextAnnotation,
  type PhotoTextAlignment,
} from "@/domain/photo-annotations";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import { useRecoveringPhoto } from "@/lib/use-recovering-photo";
import { mergeAnnotationDocuments, readAnnotationDraft, writeAnnotationDraft } from "@/lib/photo-annotation-drafts";
import { useConfirm } from "@/components/confirm-provider";
import { ThemedSelect } from "./themed-select";
import { PhotoImageOverlay } from "./photo-image-overlay";
import { PhotoOverlayCropEditor } from "./photo-overlay-crop-editor";
import { preparePhotoOverlay } from "@/lib/prepare-photo-overlay";
import { clipboardImageFiles } from "@/domain/clipboard-images";

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

type DraftShape = {
  tool: "rectangle" | "ellipse" | "highlight";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type DraftFreehand = {
  points: PhotoFreehandPoint[];
};

type DragState = {
  anchorIndex?: number;
  annotationId: string;
  pointerId: number;
  originX: number;
  originY: number;
  startClientX: number;
  startClientY: number;
  snapshot: PhotoAnnotation;
  active: boolean;
  mode:
    | "default"
    | "arrow-start"
    | "arrow-end"
    | "callout-box"
    | "callout-anchor"
    | "callout-resize"
    | "shape-resize";
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
type PhotoExportAction = "download" | "print" | null;

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

function draftShapeBounds(draft: DraftShape) {
  return {
    x: Math.min(draft.x1, draft.x2),
    y: Math.min(draft.y1, draft.y2),
    width: Math.abs(draft.x2 - draft.x1),
    height: Math.abs(draft.y2 - draft.y1),
  };
}

function annotationPoints(points: PhotoFreehandPoint[], width: number, height: number) {
  return points.map((point) => `${point.x * width},${point.y * height}`).join(" ");
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

type PendingAnnotationSave = {
  photoId: string;
  items: PhotoAnnotation[];
  /** Present when the save should also be recorded as a local recovery draft for this task. */
  draftTaskId?: string;
};

/** Size legacy text callouts saved without a height; null when nothing needs measuring. */
function measureLegacyTextItems(
  items: PhotoAnnotation[],
  overlayWidth: number,
  overlayHeight: number,
): PhotoAnnotation[] | null {
  if (overlayWidth <= 0 || overlayHeight <= 0) {
    return null;
  }

  if (!items.some((item) => item.type === "text" && !item.height)) {
    return null;
  }

  return items.map((item) => {
    if (item.type !== "text" || item.height) {
      return item;
    }

    const measured = measureTextCalloutBox(
      item.text,
      item.fontSize,
      overlayWidth,
      overlayHeight,
      item.width,
      getAnnotationFontFamily(),
      true,
    );
    return { ...item, width: measured.width, height: measured.height };
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StepPhotoViewer({
  taskId = "",
  stepSequence,
  photo,
  photos,
  copiedPhoto,
  onClose,
  onPhotoChange,
  onUpdatePhoto,
}: {
  stepSequence: number;
  photo: StepPhotoAttachment;
  photos: StepPhotoAttachment[];
  copiedPhoto?: StepPhotoAttachment;
  onClose: () => void;
  onPhotoChange: (photo: StepPhotoAttachment) => void;
  taskId?: string;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
}) {
  const markerId = useId().replace(/:/g, "");
  const viewerRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<PendingAnnotationSave | null>(null);
  const onUpdatePhotoRef = useRef(onUpdatePhoto);
  onUpdatePhotoRef.current = onUpdatePhoto;
  const pendingFocusIdRef = useRef<string | null>(null);
  const copiedAnnotationRef = useRef<PhotoAnnotation | null>(null);
  const selectedPhotoRef = useRef(photo);
  selectedPhotoRef.current = photo;
  const [activeTool, setActiveTool] = useState<PhotoAnnotationTool>("select");
  const [activeColor, setActiveColor] = useState<string>("#ffcc00");
  const [activeFontSize, setActiveFontSize] = useState<number>(20);
  const [activeTextAlign, setActiveTextAlign] = useState<PhotoTextAlignment>("center");
  const [annotations, setAnnotations] = useState<PhotoAnnotation[]>(() => annotationDocumentFromPhoto(photo).items);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftArrow, setDraftArrow] = useState<DraftArrow | null>(null);
  const [draftShape, setDraftShape] = useState<DraftShape | null>(null);
  const [draftFreehand, setDraftFreehand] = useState<DraftFreehand | null>(null);
  const [draftCallout, setDraftCallout] = useState<DraftCallout | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [textBoxDragPending, setTextBoxDragPending] = useState<TextBoxDragPending | null>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const overlaySizeRef = useRef(overlaySize);
  overlaySizeRef.current = overlaySize;
  const [contextMenu, setContextMenu] = useState<AnnotationContextMenu | null>(null);
  const [toolbarVisibility, setToolbarVisibility] = useState<ToolbarVisibility>("expanded");
  const [exportAction, setExportAction] = useState<PhotoExportAction>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [croppingImage, setCroppingImage] = useState<PhotoImageAnnotation | null>(null);
  const copiedMedia = useRecoveringPhoto(copiedPhoto?.dataUrl ?? "", copiedPhoto?.storagePath);
  const overlayMounted = useRef(true);
  useEffect(() => {
    overlayMounted.current = true;
    viewerRef.current?.focus({ preventScroll: true });
    return () => { overlayMounted.current = false; };
  }, []);

  async function pasteImageOverlay() {
    const targetPhotoId = photo.id;
    try {
      if (copiedPhoto) {
        setOverlayLoading(true);
        setExportError(null);
        const source = await copiedMedia.recover();
        let blob: Blob;
        try {
          blob = await renderAnnotatedPhotoBlob(copiedPhoto, annotationDocumentFromPhoto(copiedPhoto), source);
        } catch (error) {
          if (!copiedPhoto.storagePath) throw error;
          blob = await renderAnnotatedPhotoBlob(copiedPhoto, annotationDocumentFromPhoto(copiedPhoto), await copiedMedia.retry());
        }
        if (!overlayMounted.current || selectedPhotoRef.current.id !== targetPhotoId) return;
        await addImageOverlay(new File([blob], copiedPhoto.name, { type: blob.type }));
        return;
      }
      if (!navigator.clipboard?.read) throw new Error("Use Ctrl+V or Cmd+V to paste an image onto the photo.");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((type) => /^image\/(png|jpeg|webp)$/.test(type));
        if (!type) continue;
        const blob = await item.getType(type);
        if (!overlayMounted.current || selectedPhotoRef.current.id !== targetPhotoId) return;
        await addImageOverlay(new File([blob], "Pasted overlay", { type }));
        return;
      }
      throw new Error("Copy an image first, then paste it here.");
    } catch (error) {
      if (overlayMounted.current && selectedPhotoRef.current.id === targetPhotoId)
        setExportError(error instanceof DOMException && error.name === "NotAllowedError"
          ? "Clipboard access was blocked. Use Ctrl+V or Cmd+V on the photo instead."
          : error instanceof Error ? error.message : "Unable to paste this image.");
    } finally { if (overlayMounted.current) setOverlayLoading(false); }
  }

  async function addImageOverlay(file: File) {
    const targetPhotoId = photo.id;
    setOverlayLoading(true);
    setExportError(null);
    try {
      const source = await preparePhotoOverlay(file);
      if (!overlayMounted.current || selectedPhotoRef.current.id !== targetPhotoId) return;
      const id = createAnnotationId("image");
      const aspect = (overlaySize.width || photo.width || 800) / (overlaySize.height || photo.height || 600);
      const height = Math.min(0.5, 0.3 * aspect * source.sourceHeight / source.sourceWidth);
      const width = height / aspect * source.sourceWidth / source.sourceHeight;
      updateAnnotations((current) => [...current, {
        id, type: "image", ...source, color: "#ffcc00", strokeWidth: 2,
        x: 0.1, y: 0.1, width, height, crop: { left: 0, top: 0, right: 0, bottom: 0 },
      }]);
      setSelectedId(id);
      setActiveTool("select");
    } catch (error) {
      if (overlayMounted.current) setExportError(error instanceof Error ? error.message : "Unable to add overlay.");
    } finally { if (overlayMounted.current) setOverlayLoading(false); }
  }
  const media = useRecoveringPhoto(photo.dataUrl, photo.storagePath);
  const confirm = useConfirm();
  const incomingRef = useRef({ id: photo.id, document: annotationDocumentFromPhoto(photo) });
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const selectedAnnotation = useMemo(
    () => annotations.find((item) => item.id === selectedId) ?? null,
    [annotations, selectedId],
  );
  const currentPhotoIndex = useMemo(
    () => photos.findIndex((candidate) => candidate.id === photo.id),
    [photo.id, photos],
  );
  const canAlignText = activeTool === "text" || (activeTool === "select" && selectedAnnotation?.type === "text");

  const flushPendingAnnotations = useCallback(
    () => {
      const pending = pendingSaveRef.current;
      const updatePhoto = onUpdatePhotoRef.current;
      if (!pending || !updatePhoto) {
        return;
      }

      pendingSaveRef.current = null;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // The recovery draft is written once per save (debounce, unload, unmount, photo switch)
      // rather than per pointermove, and always before the parent hears about the change.
      // The base is the latest incoming document, exactly what the old per-move write used.
      if (pending.draftTaskId !== undefined && pending.photoId === incomingRef.current.id) {
        writeAnnotationDraft(pending.draftTaskId, pending.photoId, incomingRef.current.document, {
          version: PHOTO_ANNOTATION_VERSION, items: pending.items,
        });
      }
      updatePhoto(pending.photoId, {
        annotations: {
          version: PHOTO_ANNOTATION_VERSION,
          items: pending.items,
        } satisfies PhotoAnnotationDocument,
      });
    },
    [],
  );

  const persistAnnotations = useCallback(
    (nextItems: PhotoAnnotation[]) => {
      if (!onUpdatePhotoRef.current) {
        return;
      }

      // Mid-switch (the restore effect has not adopted photo.id yet), `nextItems` still belong
      // to the previous photo; persisting them here would save them under the new photo's id.
      if (incomingRef.current.id !== photo.id) {
        return;
      }

      pendingSaveRef.current = { photoId: photo.id, items: nextItems, draftTaskId: taskId };
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        flushPendingAnnotations();
      }, 350);
    },
    [flushPendingAnnotations, photo.id, taskId],
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
    setToolbarVisibility("expanded");
    if (annotation.type === "text") setActiveTextAlign(annotation.textAlign ?? "left");
    setContextMenu(null);
  }, []);

  function applyTextAlignment(textAlign: PhotoTextAlignment) {
    setActiveTextAlign(textAlign);
    if (activeTool === "select" && selectedAnnotation?.type === "text") {
      updateAnnotations((current) => current.map((item) =>
        item.id === selectedId && item.type === "text" ? { ...item, textAlign } : item,
      ));
    }
  }

  function duplicateAnnotation(annotation: PhotoAnnotation) {
    const duplicate = {
      ...movePhotoAnnotation(annotation, 0.025, 0.025),
      id: createAnnotationId(annotation.type),
    };
    updateAnnotations((current) => [...current, duplicate]);
    if (activeTool === "select") handleSelectAnnotation(duplicate);
    else setSelectedId(duplicate.id);
    return duplicate;
  }

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

  const changePhoto = useCallback(
    (direction: -1 | 1) => {
      if (photos.length <= 1 || currentPhotoIndex < 0) {
        return;
      }

      const nextIndex = (currentPhotoIndex + direction + photos.length) % photos.length;
      onPhotoChange(photos[nextIndex]);
    },
    [currentPhotoIndex, onPhotoChange, photos],
  );

  useEffect(() => {
    flushPendingAnnotations();
    const incoming = annotationDocumentFromPhoto(selectedPhotoRef.current);
    const draft = readAnnotationDraft(taskId, photo.id);
    const restored = draft ? mergeAnnotationDocuments(draft.base, draft.local, incoming) : incoming;
    incomingRef.current = {id: photo.id, document: incoming};
    const measured = measureLegacyTextItems(
      restored.items, overlaySizeRef.current.width, overlaySizeRef.current.height,
    );
    annotationsRef.current = measured ?? restored.items;
    setAnnotations(measured ?? restored.items);
    if (draft && JSON.stringify(restored.items) !== JSON.stringify(incoming.items)) {
      pendingSaveRef.current = {photoId: photo.id, items: restored.items};
      flushPendingAnnotations();
    }
    setExportError(null);
    setSelectedId(null);
    setDraftArrow(null);
    setDraftShape(null);
    setDraftFreehand(null);
    setDraftCallout(null);
    setDragState(null);
    setTextBoxDragPending(null);
    setContextMenu(null);
    if (measured) {
      persistAnnotations(measured);
    }
  }, [flushPendingAnnotations, persistAnnotations, photo.id, taskId]);

  const incomingAnnotations = JSON.stringify(annotationDocumentFromPhoto(photo));
  useEffect(() => {
    const incoming = JSON.parse(incomingAnnotations) as PhotoAnnotationDocument;
    if (incomingRef.current.id !== photo.id) return;
    const draft = readAnnotationDraft(taskId, photo.id);
    const merged = mergeAnnotationDocuments(draft?.base ?? incomingRef.current.document,
      {version: PHOTO_ANNOTATION_VERSION, items: annotationsRef.current}, incoming);
    incomingRef.current = {id: photo.id, document: incoming};
    if (JSON.stringify(merged.items) !== JSON.stringify(annotationsRef.current)) {
      setAnnotations(merged.items);
      const pending = pendingSaveRef.current;
      if (pending?.photoId === photo.id) {
        pendingSaveRef.current = { ...pending, items: merged.items };
        writeAnnotationDraft(taskId, photo.id, incoming, merged);
      }
    }
  }, [incomingAnnotations, photo.id, taskId]);

  useEffect(() => {
    const flush = () => flushPendingAnnotations();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingSaveRef.current) return;
      flush();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", beforeUnload); };
  }, [flushPendingAnnotations]);

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
    // A photo switch re-creates persistAnnotations before the restore effect swaps the items in;
    // the restore path measures the incoming photo itself, so skip the outgoing photo's items.
    if (incomingRef.current.id !== selectedPhotoRef.current.id) {
      return;
    }

    const measured = measureLegacyTextItems(annotationsRef.current, overlaySize.width, overlaySize.height);
    if (!measured) {
      return;
    }

    annotationsRef.current = measured;
    setAnnotations(measured);
    persistAnnotations(measured);
  }, [overlaySize.height, overlaySize.width, persistAnnotations]);

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
      flushPendingAnnotations();
    };
  }, [flushPendingAnnotations]);

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
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const focusable = Array.from(
          viewerRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.closest('[inert], [aria-hidden="true"]'));
        if (focusable.length === 0) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || !viewerRef.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !viewerRef.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === "Escape") {
        if (activeTool === "pointer") {
          setActiveTool("select");
          return;
        }
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

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const shortcutTools: Partial<Record<string, PhotoAnnotationTool>> = {
          v: "select",
          a: "arrow",
          r: "rectangle",
          c: "ellipse",
          p: "freehand",
          t: "text",
          h: "highlight",
        };
        const shortcutTool = shortcutTools[event.key.toLowerCase()];
        if (shortcutTool) {
          event.preventDefault();
          setActiveTool(shortcutTool);
          setToolbarVisibility("expanded");
          return;
        }
      }

      if (photos.length <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        changePhoto(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        changePhoto(1);
      }
    }

    window.addEventListener("keydown", handlePreviewKeyDown);
    return () => window.removeEventListener("keydown", handlePreviewKeyDown);
  }, [activeTool, changePhoto, contextMenu, deleteAnnotation, onClose, photos.length, selectedId]);

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

  function applyDragDelta(snapshot: PhotoAnnotation, deltaX: number, deltaY: number, mode: DragMode, anchorIndex = 0) {
    if (snapshot.type === "text") {
      if (mode === "callout-anchor") {
        return moveTextCalloutAnchor(snapshot, deltaX, deltaY, anchorIndex);
      }

      if (mode === "callout-box") {
        return moveTextCalloutBox(snapshot, deltaX, deltaY);
      }

      return snapshot;
    }

    return movePhotoAnnotation(snapshot, deltaX, deltaY);
  }

  function beginAnnotationDrag(event: ReactPointerEvent, annotation: PhotoAnnotation, mode: DragMode = "default", anchorIndex = 0) {
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
      anchorIndex,
      active:
        mode === "arrow-start" ||
        mode === "arrow-end" ||
        mode === "callout-resize" ||
        mode === "shape-resize",
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
      textAlign: activeTextAlign,
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
    if (activeTool === "pointer" && selectedAnnotation?.type === "text") {
      event.preventDefault();
      updateAnnotations((current) => current.map((item) => item.id === selectedId && item.type === "text"
        ? { ...item, additionalAnchors: [...(item.additionalAnchors ?? []), point] } : item));
      setActiveTool("select");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);

    if (activeTool === "arrow") {
      setDraftArrow({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      return;
    }

    if (activeTool === "rectangle" || activeTool === "ellipse" || activeTool === "highlight") {
      setDraftShape({ tool: activeTool, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      return;
    }

    if (activeTool === "freehand") {
      setDraftFreehand({ points: [point] });
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

  /** A drag belongs to the pointer that started it; other pointers must not steer or end it. */
  function isForeignPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const activePointerId = dragState?.pointerId ?? textBoxDragPending?.pointerId;
    return activePointerId !== undefined && event.pointerId !== activePointerId;
  }

  function handleOverlayPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (isForeignPointer(event)) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDragState(null);
    setTextBoxDragPending(null);
    setDraftArrow(null);
    setDraftShape(null);
    setDraftFreehand(null);
    setDraftCallout(null);
  }

  function handleOverlayLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    // lostpointercapture bubbles: a child losing its implicit touch capture to the overlay
    // (beginAnnotationDrag) is the start of a drag, not its end.
    if (event.target !== event.currentTarget) {
      return;
    }

    handleOverlayPointerCancel(event);
  }

  function handleOverlayPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (isForeignPointer(event)) {
      return;
    }

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

      if ((currentDrag.mode === "arrow-start" || currentDrag.mode === "arrow-end") && snapshot.type === "arrow") {
        updateAnnotations((current) =>
          current.map((item) =>
            item.id === currentDrag.annotationId
              ? currentDrag.mode === "arrow-start"
                ? { ...snapshot, x1: point.x, y1: point.y }
                : { ...snapshot, x2: point.x, y2: point.y }
              : item,
          ),
        );
        return;
      }

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

      if (currentDrag.mode === "shape-resize" && isPhotoBoxAnnotation(snapshot)) {
        updateAnnotations((current) =>
          current.map((item) =>
            item.id === currentDrag.annotationId
              ? resizePhotoBoxAnnotation(snapshot, point.x, point.y)
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
            ? applyDragDelta(currentDrag.snapshot, deltaX, deltaY, currentDrag.mode, currentDrag.anchorIndex)
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

    if (draftShape) {
      const point = pointFromEvent(event);
      setDraftShape((current) => (current ? { ...current, x2: point.x, y2: point.y } : current));
      return;
    }

    if (draftFreehand) {
      const point = pointFromEvent(event);
      setDraftFreehand((current) => {
        if (!current || current.points.length >= 1_200) {
          return current;
        }

        const previous = current.points[current.points.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) {
          return current;
        }

        return { points: [...current.points, point] };
      });
      return;
    }

    if (draftCallout) {
      const point = pointFromEvent(event);
      setDraftCallout((current) => (current ? { ...current, boxX: point.x, boxY: point.y } : current));
    }
  }

  function handleOverlayPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (isForeignPointer(event)) {
      return;
    }

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
        setSelectedId(id);
      }

      setDraftArrow(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (draftShape) {
      const bounds = draftShapeBounds(draftShape);
      if (bounds.width > 0.006 && bounds.height > 0.006) {
        const base = {
          id: createAnnotationId(draftShape.tool),
          color: activeColor,
          strokeWidth: fontSizeToStrokeWidth(activeFontSize),
          ...bounds,
        };
        const nextShape: PhotoBoxAnnotation =
          draftShape.tool === "highlight"
            ? ({ ...base, type: "highlight", opacity: 0.26 } satisfies PhotoHighlightAnnotation)
            : { ...base, type: draftShape.tool };
        updateAnnotations((current) => [...current, nextShape]);
        setSelectedId(nextShape.id);
      }

      setDraftShape(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (draftFreehand) {
      if (draftFreehand.points.length > 1) {
        const nextFreehand: PhotoFreehandAnnotation = {
          id: createAnnotationId("freehand"),
          type: "freehand",
          color: activeColor,
          strokeWidth: fontSizeToStrokeWidth(activeFontSize),
          points: draftFreehand.points,
        };
        updateAnnotations((current) => [...current, nextFreehand]);
        setSelectedId(nextFreehand.id);
      }

      setDraftFreehand(null);
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
    setExportAction("download");
    setExportError(null);
    try {
      const document = {
        version: PHOTO_ANNOTATION_VERSION,
        items: annotations,
      } satisfies PhotoAnnotationDocument;
      const extension = photo.contentType?.includes("png") ? "png" : "jpg";
      const baseName = photo.name.replace(/\.[^.]+$/, "") || `step-${stepSequence}-photo`;
      let source = await media.recover();

      if (!source) {
        throw new Error("Photo is unavailable for download.");
      }

      if (annotations.length === 0) {
        let response = await fetch(source);
        if (!response.ok && photo.storagePath) {
          source = await media.retry();
          if (source) response = await fetch(source);
        }
        if (!response.ok) {
          throw new Error("Photo could not be downloaded.");
        }
        const blob = await response.blob();
        downloadBlob(blob, `${baseName}.${extension}`);
        return;
      }

      const blob = await renderAnnotatedPhotoBlob(photo, document, source).catch(async (error) => {
        const fresh = photo.storagePath ? await media.retry() : undefined;
        if (!fresh) throw error;
        return renderAnnotatedPhotoBlob(photo, document, fresh);
      });
      downloadBlob(blob, `${baseName}-annotated.${extension}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Photo could not be downloaded.");
    } finally {
      setExportAction(null);
    }
  }

  async function printCurrentPhoto() {
    setExportAction("print");
    setExportError(null);

    let annotatedUrl: string | null = null;
    try {
      const source = await media.recover();
      if (!source) {
        throw new Error("Photo is unavailable for printing.");
      }

      if (annotations.length > 0) {
        const blob = await renderAnnotatedPhotoBlob(
          photo,
          { version: PHOTO_ANNOTATION_VERSION, items: annotations },
          source,
        ).catch(async (error) => {
          const fresh = photo.storagePath ? await media.retry() : undefined;
          if (!fresh) throw error;
          return renderAnnotatedPhotoBlob(photo, {version: PHOTO_ANNOTATION_VERSION, items: annotations}, fresh);
        });
        annotatedUrl = URL.createObjectURL(blob);
      }

      const printFrame = document.createElement("iframe");
      printFrame.title = `Print ${photo.name}`;
      printFrame.className = "fixed bottom-0 right-0 h-0 w-0 border-0";
      document.body.appendChild(printFrame);

      const printWindow = printFrame.contentWindow;
      const printDocument = printWindow?.document;
      if (!printWindow || !printDocument) {
        printFrame.remove();
        throw new Error("The print preview could not be opened.");
      }

      printDocument.open();
      printDocument.write("<!doctype html><html><head><title></title></head><body></body></html>");
      printDocument.close();
      printDocument.title = photo.name;

      const appFont = getComputedStyle(document.documentElement).getPropertyValue("--type-sans").trim() || "system-ui, sans-serif";
      const style = printDocument.createElement("style");
      style.textContent = `@page{margin:0.5in;}html,body{margin:0;min-height:100%;background:white;font-family:${appFont};}body{display:flex;align-items:center;justify-content:center;}img{display:block;max-width:100%;max-height:calc(100vh - 1in);object-fit:contain;}`;
      printDocument.head.appendChild(style);

      const image = printDocument.createElement("img");
      image.src = annotatedUrl ?? source;
      image.alt = `Step ${stepSequence} photo ${photo.name}`;
      printDocument.body.appendChild(image);

      await new Promise<void>((resolve, reject) => {
        let cleanupTimer: number | undefined;
        const cleanup = () => {
          if (cleanupTimer) {
            window.clearTimeout(cleanupTimer);
          }
          printFrame.remove();
          if (annotatedUrl) {
            URL.revokeObjectURL(annotatedUrl);
            annotatedUrl = null;
          }
        };

        const printImage = () => {
          try {
            printWindow.focus();
            printWindow.addEventListener("afterprint", cleanup, { once: true });
            cleanupTimer = window.setTimeout(cleanup, 30_000);
            printWindow.print();
            resolve();
          } catch (error) {
            cleanup();
            reject(error);
          }
        };

        if (image.complete && image.naturalWidth > 0) {
          printImage();
        } else {
          image.onload = printImage;
          image.onerror = () => {
            cleanup();
            reject(new Error("Photo could not be loaded for printing."));
          };
        }
      });
    } catch (error) {
      if (annotatedUrl) {
        URL.revokeObjectURL(annotatedUrl);
      }
      setExportError(error instanceof Error ? error.message : "Photo could not be printed.");
    } finally {
      setExportAction(null);
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
          {selected ? (
            <>
              <circle
                className="ui-photo-arrow-pivot-handle"
                data-arrow-pivot="start"
                cx={item.x1 * overlaySize.width}
                cy={item.y1 * overlaySize.height}
                r={14}
                fill="transparent"
                onPointerDown={(event) => beginAnnotationDrag(event, item, "arrow-start")}
              >
                <title>Pivot arrow tail</title>
              </circle>
              <circle
                className="ui-photo-arrow-pivot-dot"
                cx={item.x1 * overlaySize.width}
                cy={item.y1 * overlaySize.height}
                r={6}
                fill="#ffffff"
                stroke={item.color}
                strokeWidth={2}
              />
              <circle
                className="ui-photo-arrow-pivot-handle"
                data-arrow-pivot="end"
                cx={item.x2 * overlaySize.width}
                cy={item.y2 * overlaySize.height}
                r={14}
                fill="transparent"
                onPointerDown={(event) => beginAnnotationDrag(event, item, "arrow-end")}
              >
                <title>Pivot arrow head</title>
              </circle>
              <circle
                className="ui-photo-arrow-pivot-dot"
                cx={item.x2 * overlaySize.width}
                cy={item.y2 * overlaySize.height}
                r={6}
                fill="#ffffff"
                stroke={item.color}
                strokeWidth={2}
              />
            </>
          ) : null}
        </g>
      );
    }

    if (isPhotoBoxAnnotation(item)) {
      const x = item.x * overlaySize.width;
      const y = item.y * overlaySize.height;
      const width = item.width * overlaySize.width;
      const height = item.height * overlaySize.height;
      const shapeProps = {
        x,
        y,
        width,
        height,
      };

      return (
        <g
          key={item.id}
          className={`ui-photo-annotation-item ui-photo-annotation-item-shape ${selected ? "ui-photo-annotation-item-selected" : ""}`}
          onPointerDown={(event) => beginAnnotationDrag(event, item)}
          onContextMenu={(event) => handleAnnotationContextMenu(event, item)}
        >
          {item.type === "image" ? <>
            <PhotoImageOverlay annotation={item} width={overlaySize.width} height={overlaySize.height} />
            <rect {...shapeProps} fill="transparent" stroke={selected ? item.color : "none"} strokeWidth={2} />
          </> : item.type === "ellipse" ? (
            <>
              <ellipse
                cx={x + width / 2}
                cy={y + height / 2}
                rx={width / 2}
                ry={height / 2}
                fill="transparent"
                stroke="transparent"
                strokeWidth={Math.max(item.strokeWidth * 4, 14)}
              />
              <ellipse
                className={selected ? "ui-photo-annotation-stroke-selected" : undefined}
                cx={x + width / 2}
                cy={y + height / 2}
                rx={width / 2}
                ry={height / 2}
                fill="none"
                stroke={item.color}
                strokeWidth={item.strokeWidth}
              />
            </>
          ) : (
            <>
              <rect
                {...shapeProps}
                fill="transparent"
                stroke="transparent"
                strokeWidth={Math.max(item.strokeWidth * 4, 14)}
              />
              <rect
                {...shapeProps}
                className={selected ? "ui-photo-annotation-stroke-selected" : undefined}
                fill={item.type === "highlight" ? item.color : "none"}
                fillOpacity={item.type === "highlight" ? item.opacity : undefined}
                stroke={item.color}
                strokeOpacity={item.type === "highlight" ? Math.min(item.opacity + 0.35, 0.75) : undefined}
                strokeWidth={item.strokeWidth}
              />
            </>
          )}
          {selected ? (
            <rect
              className="ui-photo-shape-resize"
              x={x + width - 6}
              y={y + height - 6}
              width={12}
              height={12}
              rx={2}
              fill="#ffffff"
              stroke={item.color}
              strokeWidth={2}
              onPointerDown={(event) => beginAnnotationDrag(event, item, "shape-resize")}
            />
          ) : null}
        </g>
      );
    }

    if (item.type === "freehand") {
      const points = annotationPoints(item.points, overlaySize.width, overlaySize.height);
      return (
        <g
          key={item.id}
          className={`ui-photo-annotation-item ui-photo-annotation-item-freehand ${selected ? "ui-photo-annotation-item-selected" : ""}`}
          onPointerDown={(event) => beginAnnotationDrag(event, item)}
          onContextMenu={(event) => handleAnnotationContextMenu(event, item)}
        >
          <polyline
            points={points}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(item.strokeWidth * 4, 14)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            className={selected ? "ui-photo-annotation-stroke-selected" : undefined}
            points={points}
            fill="none"
            stroke={item.color}
            strokeWidth={item.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }

    const boxHeightPx = textCalloutBoxHeightPx(item, overlaySize.height);
    const boxHeightNorm = overlaySize.height > 0 ? boxHeightPx / overlaySize.height : 0;

    return (
      <g
        key={item.id}
        className={`ui-photo-annotation-item ui-photo-annotation-item-text ${selected ? "ui-photo-annotation-item-selected" : ""}`}
        onContextMenu={(event) => handleAnnotationContextMenu(event, item)}
      >
        {textCalloutAnchors(item).map((anchor, anchorIndex) => {
          const leader = textCalloutLeaderPoint(anchor.x, anchor.y, item.x, item.y, item.width, boxHeightNorm);
          return <g key={anchorIndex} data-callout-pointer={anchorIndex}>
        <line
          className="ui-photo-callout-leader-hit"
          x1={anchor.x * overlaySize.width}
          y1={anchor.y * overlaySize.height}
          x2={leader.x * overlaySize.width}
          y2={leader.y * overlaySize.height}
          stroke="transparent"
          strokeWidth={14}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => {
            if (activeTool !== "select") {
              return;
            }

            beginAnnotationDrag(event, item, "callout-anchor", anchorIndex);
          }}
        />
        <line
          className={selected ? "ui-photo-annotation-stroke-selected" : undefined}
          x1={anchor.x * overlaySize.width}
          y1={anchor.y * overlaySize.height}
          x2={leader.x * overlaySize.width}
          y2={leader.y * overlaySize.height}
          stroke={item.color}
          strokeWidth={fontSizeToStrokeWidth(item.fontSize)}
          strokeLinecap="round"
        />
        <circle
          className="ui-photo-callout-anchor"
          cx={anchor.x * overlaySize.width}
          cy={anchor.y * overlaySize.height}
          r={Math.max(3, item.fontSize * 0.22)}
          fill={item.color}
          onPointerDown={(event) => {
            if (activeTool !== "select") {
              return;
            }

            beginAnnotationDrag(event, item, "callout-anchor", anchorIndex);
          }}
        />
          </g>;
        })}
        <foreignObject
          x={item.x * overlaySize.width}
          y={item.y * overlaySize.height}
          width={item.width * overlaySize.width}
          height={boxHeightPx}
        >
          <div
            className={`ui-photo-callout ui-photo-callout-move ${selected ? "ui-photo-callout-selected" : ""}`}
            style={{ borderColor: item.color }}
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
            ) : null}
            <div className="ui-photo-callout-text-body" style={{ fontSize: `${item.fontSize}px`, textAlign: item.textAlign ?? "left" }}>
            <div className="ui-photo-callout-text-measure" aria-hidden="true">{item.text + " "}</div>
            <textarea
              data-annotation-id={item.id}
              className={`ui-photo-annotation-text ${selected ? "ui-photo-annotation-text-selected" : ""}`}
              style={{
                fontSize: `${item.fontSize}px`,
                textAlign: item.textAlign ?? "left",
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
            </div>
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

  function renderDraftShapePreview() {
    if (!draftShape || overlaySize.width <= 0 || overlaySize.height <= 0) {
      return null;
    }

    const bounds = draftShapeBounds(draftShape);
    const x = bounds.x * overlaySize.width;
    const y = bounds.y * overlaySize.height;
    const width = bounds.width * overlaySize.width;
    const height = bounds.height * overlaySize.height;

    if (draftShape.tool === "ellipse") {
      return (
        <ellipse
          className="ui-photo-annotation-draft"
          cx={x + width / 2}
          cy={y + height / 2}
          rx={width / 2}
          ry={height / 2}
          fill="none"
          stroke={activeColor}
          strokeWidth={fontSizeToStrokeWidth(activeFontSize)}
        />
      );
    }

    return (
      <rect
        className="ui-photo-annotation-draft"
        x={x}
        y={y}
        width={width}
        height={height}
        fill={draftShape.tool === "highlight" ? activeColor : "none"}
        fillOpacity={draftShape.tool === "highlight" ? 0.26 : undefined}
        stroke={activeColor}
        strokeOpacity={draftShape.tool === "highlight" ? 0.6 : undefined}
        strokeWidth={fontSizeToStrokeWidth(activeFontSize)}
      />
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
      ref={viewerRef}
      className="ui-photo-viewer fixed inset-0 z-[95] !m-0 flex flex-col items-center gap-3 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Step ${stepSequence} photo preview`}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        if (croppingImage) return;
        if (!(event.target instanceof Element) || event.target.closest("button, input, textarea, select, [contenteditable]")) return;
        viewerRef.current?.focus({ preventScroll: true });
      }}
      onCopyCapture={(event) => {
        if (croppingImage) { event.stopPropagation(); return; }
        if (isAnnotationTextInputFocused() || !selectedAnnotation) return;
        event.preventDefault();
        event.stopPropagation();
        copiedAnnotationRef.current = selectedAnnotation;
        event.clipboardData.setData("application/x-pulse-annotation", selectedAnnotation.id);
      }}
      onPasteCapture={(event) => {
        if (croppingImage) { event.stopPropagation(); event.preventDefault(); return; }
        if (isAnnotationTextInputFocused()) return;
        event.stopPropagation();
        const files = clipboardImageFiles(event.clipboardData);
        if (files.length) {
          event.preventDefault();
          void addImageOverlay(files[0]);
        } else if (copiedAnnotationRef.current && event.clipboardData.getData("application/x-pulse-annotation") === copiedAnnotationRef.current.id) {
          event.preventDefault();
          duplicateAnnotation(copiedAnnotationRef.current);
        } else if (copiedPhoto) {
          event.preventDefault();
          void pasteImageOverlay();
        }
      }}
      onKeyDownCapture={(event) => {
        if (croppingImage) return;
        if (!(event.ctrlKey || event.metaKey) || event.altKey || isAnnotationTextInputFocused()) return;
        const key = event.key.toLowerCase();
        if (key === "c" && selectedAnnotation) {
          event.stopPropagation();
          copiedAnnotationRef.current = selectedAnnotation;
        } else if (key === "v") {
          event.stopPropagation();
          if (copiedPhoto && !copiedAnnotationRef.current) {
            event.preventDefault();
            if (!overlayLoading) void pasteImageOverlay();
          }
        } else if (key === "d" && selectedAnnotation) {
          event.preventDefault();
          event.stopPropagation();
          duplicateAnnotation(selectedAnnotation);
        }
      }}
      onClick={onClose}
    >
      <div className="ui-photo-viewer-stage">
      <div className="ui-photo-viewer-frame" onClick={(event) => event.stopPropagation()}>
        {!media.failed && media.source ? (
          <NextImage
            src={media.source}
            alt={`Step ${stepSequence} photo ${photo.name}`}
            width={photo.width ?? 1280}
            height={photo.height ?? 960}
            unoptimized
            fetchPriority="high"
            className="ui-photo-viewer-image"
            onError={media.onError}
          />
        ) : (
          <div className="ui-photo-viewer-image flex min-h-64 items-center justify-center text-sm text-ink-tertiary">
            <span>Photo unavailable</span>
            <button type="button" className="ml-3 underline" disabled={media.loading} onClick={() => void media.retry()}>Retry photo</button>
          </div>
        )}
        <div
          ref={overlayRef}
          style={{pointerEvents: media.failed ? "none" : undefined}}
          className={`ui-photo-viewer-annotation-layer ${activeTool === "select" ? "ui-photo-viewer-annotation-layer-select" : "ui-photo-viewer-annotation-layer-draw"}${dragState?.active ? " ui-photo-viewer-annotation-dragging" : ""}`}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          onPointerCancel={handleOverlayPointerCancel}
          onLostPointerCapture={handleOverlayLostPointerCapture}
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
              {renderDraftShapePreview()}
              {draftFreehand ? (
                <polyline
                  className="ui-photo-annotation-draft"
                  points={annotationPoints(draftFreehand.points, overlaySize.width, overlaySize.height)}
                  fill="none"
                  stroke={activeColor}
                  strokeWidth={fontSizeToStrokeWidth(activeFontSize)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
              ) : null}
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
      </div>
      </div>
      <div className="ui-photo-viewer-toolbar-dock">
        <div
          className={`ui-photo-viewer-toolbar ${toolbarVisibility === "minimized" ? "ui-photo-viewer-toolbar-minimized" : ""}`}
          onClick={(event) => event.stopPropagation()}
          role="region"
          aria-label="Photo annotation tools"
        >
          <button
            ref={initialFocusRef}
            type="button"
            className="ui-photo-viewer-toolbar-toggle ui-photo-viewer-tool"
            onClick={() =>
              setToolbarVisibility((current) => (current === "minimized" ? "expanded" : "minimized"))
            }
            aria-label={toolbarVisibility === "minimized" ? "Expand photo toolbar" : "Collapse photo toolbar"}
            title={toolbarVisibility === "minimized" ? "Expand toolbar" : "Collapse toolbar"}
            aria-expanded={toolbarVisibility === "expanded"}
          >
            {toolbarVisibility === "minimized" ? (
              <PanelTopOpen size={15} strokeWidth={1.75} />
            ) : (
              <PanelTopClose size={15} strokeWidth={1.75} />
            )}
          </button>
          <div className="ui-photo-viewer-navigation" role="group" aria-label="Photo navigation">
            <button
              type="button"
              className="ui-photo-viewer-tool"
              onClick={() => changePhoto(-1)}
              disabled={photos.length <= 1}
              aria-label="Previous photo"
              title="Previous photo (Left arrow)"
            >
              <ChevronLeft size={15} strokeWidth={1.75} />
            </button>
            <span className="ui-photo-viewer-photo-count" aria-live="polite">
              {currentPhotoIndex >= 0 ? currentPhotoIndex + 1 : 1} of {Math.max(photos.length, 1)}
            </span>
            <button
              type="button"
              className="ui-photo-viewer-tool"
              onClick={() => changePhoto(1)}
              disabled={photos.length <= 1}
              aria-label="Next photo"
              title="Next photo (Right arrow)"
            >
              <ChevronRight size={15} strokeWidth={1.75} />
            </button>
          </div>
          <div
            className="ui-photo-viewer-toolbar-tools-wrap"
            aria-hidden={toolbarVisibility === "minimized"}
            inert={toolbarVisibility === "minimized"}
          >
            <div className="ui-photo-viewer-toolbar-tools" role="group" aria-label="Drawing tools">
                <input ref={overlayInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Overlay image file"
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addImageOverlay(file); }} />
                <button type="button" className="ui-photo-viewer-tool" disabled={overlayLoading}
                  onClick={() => overlayInputRef.current?.click()} aria-label="Add photo overlay" title="Add photo overlay">
                  {overlayLoading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                </button>
                <button type="button" className="ui-photo-viewer-tool" disabled={overlayLoading}
                  onClick={() => void pasteImageOverlay()} aria-label="Paste photo overlay" title={copiedPhoto ? `Paste copied photo: ${copiedPhoto.name} (Ctrl/Cmd+V)` : "Paste photo overlay (Ctrl/Cmd+V)"}>
                  <ClipboardPaste size={15} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "select" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("select")}
                  aria-label="Select annotation"
                  aria-pressed={activeTool === "select"}
                  aria-keyshortcuts="V"
                  title="Select or move an annotation (V)"
                >
                  <MousePointer2 size={17} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "arrow" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("arrow")}
                  aria-label="Draw arrow"
                  aria-pressed={activeTool === "arrow"}
                  aria-keyshortcuts="A"
                  title="Arrow (A)"
                >
                  <ArrowRight size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "rectangle" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("rectangle")}
                  aria-label="Draw rectangle"
                  aria-pressed={activeTool === "rectangle"}
                  aria-keyshortcuts="R"
                  title="Rectangle (R)"
                >
                  <Square size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "ellipse" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("ellipse")}
                  aria-label="Draw circle or ellipse"
                  aria-pressed={activeTool === "ellipse"}
                  aria-keyshortcuts="C"
                  title="Circle / ellipse (C)"
                >
                  <Circle size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "freehand" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("freehand")}
                  aria-label="Draw freehand"
                  aria-pressed={activeTool === "freehand"}
                  aria-keyshortcuts="P"
                  title="Freehand pen (P)"
                >
                  <Pencil size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "text" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("text")}
                  aria-label="Add text callout"
                  aria-pressed={activeTool === "text"}
                  aria-keyshortcuts="T"
                  title="Text callout (T)"
                >
                  <Type size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "highlight" ? "ui-photo-viewer-tool-active" : ""}`}
                  onClick={() => setActiveTool("highlight")}
                  aria-label="Highlight area"
                  aria-pressed={activeTool === "highlight"}
                  aria-keyshortcuts="H"
                  title="Highlight area (H)"
                >
                  <Highlighter size={15} strokeWidth={1.75} />
                </button>
            </div>
          </div>
          <div
            className="ui-photo-viewer-formatting"
            aria-hidden={toolbarVisibility === "minimized"}
            inert={toolbarVisibility === "minimized"}
          >
              <div className="ui-photo-viewer-format-group">
                <label className="ui-photo-viewer-color-select-wrap">
                  <span className="sr-only">Annotation color</span>
                  <span
                    className="ui-photo-viewer-color-select-swatch"
                    style={{ backgroundColor: activeColor }}
                    aria-hidden="true"
                  />
                  <ThemedSelect
                    className="ui-photo-viewer-color-select"
                    value={activeColor}
                    selectedLabel=""
                    onChange={applyColor}
                    options={PHOTO_ANNOTATION_COLORS}
                    ariaLabel="Annotation color"
                  />
                </label>
              </div>
              <div className="ui-photo-viewer-format-group">
                <div className="ui-photo-viewer-size-stepper" role="group" aria-label="Annotation size">
                  <button
                    type="button"
                    className="ui-photo-viewer-size-step"
                    onClick={() => stepSize(-1)}
                    disabled={activeFontSize <= PHOTO_ANNOTATION_FONT_SIZES[0]}
                    aria-label="Decrease annotation size"
                    title="Decrease size"
                  >
                    <Minus size={14} aria-hidden="true" />
                  </button>
                  <span className="ui-photo-viewer-size-value">{activeFontSize}</span>
                  <button
                    type="button"
                    className="ui-photo-viewer-size-step"
                    onClick={() => stepSize(1)}
                    disabled={activeFontSize >= PHOTO_ANNOTATION_FONT_SIZES[PHOTO_ANNOTATION_FONT_SIZES.length - 1]}
                    aria-label="Increase annotation size"
                    title="Increase size"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="ui-photo-viewer-format-group">
                <div className="ui-photo-viewer-alignment" role="group" aria-label="Text alignment"
                  title={canAlignText ? "Text alignment" : "Select a text box or choose the text tool to align text"}>
                  {([
                    ["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight],
                  ] as const).map(([alignment, Icon]) => (
                    <button
                      key={alignment}
                      type="button"
                      className={`ui-photo-viewer-tool ${canAlignText && activeTextAlign === alignment ? "ui-photo-viewer-tool-active" : ""}`}
                      disabled={!canAlignText}
                      onClick={() => applyTextAlignment(alignment)}
                      aria-label={`Align text ${alignment}`}
                      aria-pressed={canAlignText && activeTextAlign === alignment}
                      title={`Align text ${alignment}`}
                    >
                      <Icon size={17} strokeWidth={1.75} />
                    </button>
                  ))}
                </div>
              </div>
                <button
                  type="button"
                  className="ui-photo-viewer-tool"
                  disabled={!selectedAnnotation}
                  onClick={() => { if (selectedAnnotation) duplicateAnnotation(selectedAnnotation); }}
                  aria-label="Duplicate selected annotation"
                  aria-keyshortcuts="Control+d Meta+d"
                  title="Duplicate annotation (Ctrl/Cmd+D)"
                >
                  <CopyPlus size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ${activeTool === "pointer" ? "ui-photo-viewer-tool-active" : ""}`}
                  disabled={selectedAnnotation?.type !== "text"}
                  onClick={() => setActiveTool(activeTool === "pointer" ? "select" : "pointer")}
                  aria-label="Add pointer to selected callout"
                  aria-pressed={activeTool === "pointer"}
                  title="Add pointer: select a callout, then click another item in the photo"
                >
                  <Split size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`ui-photo-viewer-tool ui-photo-viewer-delete ${selectedAnnotation ? "" : "ui-photo-viewer-tool-disabled"}`}
                  onClick={() => {
                    if (selectedAnnotation) {
                      deleteAnnotation(selectedAnnotation.id);
                    }
                  }}
                  disabled={!selectedAnnotation}
                  aria-label="Delete selected annotation"
                  title="Delete selected"
                >
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
          </div>
          <div className="ui-photo-viewer-toolbar-actions">
            <button
              type="button"
              onClick={() => void downloadCurrentPhoto()}
              className="ui-btn-ghost-overlay ui-photo-viewer-toolbar-action ui-photo-viewer-toolbar-secondary-action"
              disabled={exportAction !== null}
              aria-label="Download photo"
              aria-hidden={toolbarVisibility === "minimized"}
              tabIndex={toolbarVisibility === "minimized" ? -1 : undefined}
              title="Download photo"
              aria-busy={exportAction === "download"}
            >
              {exportAction === "download" ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={15} strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              onClick={() => void printCurrentPhoto()}
              className="ui-btn-ghost-overlay ui-photo-viewer-toolbar-action ui-photo-viewer-toolbar-secondary-action"
              disabled={exportAction !== null}
              aria-label="Print photo"
              aria-hidden={toolbarVisibility === "minimized"}
              tabIndex={toolbarVisibility === "minimized" ? -1 : undefined}
              title="Print photo"
              aria-busy={exportAction === "print"}
            >
              {exportAction === "print" ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Printer size={15} strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ui-btn-ghost-overlay ui-photo-viewer-toolbar-action ui-photo-viewer-toolbar-action-close"
              aria-label="Close photo preview"
              title="Close"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        {selectedAnnotation?.type === "image" && (
          <div className="ui-photo-overlay-crop" role="group" aria-label="Crop photo overlay" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setCroppingImage(selectedAnnotation)}>Crop</button>
          </div>
        )}
      </div>
        {exportError ? (
          <p className="ui-photo-viewer-export-error" role="alert">
            {exportError}
          </p>
        ) : null}
      {croppingImage && <PhotoOverlayCropEditor image={croppingImage} onCancel={() => setCroppingImage(null)}
        onDone={(crop) => {
          updateAnnotations(items => items.map(item => item.id === croppingImage.id && item.type === "image" ? cropPhotoImage(item, crop) : item));
          setCroppingImage(null);
        }} />}
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
