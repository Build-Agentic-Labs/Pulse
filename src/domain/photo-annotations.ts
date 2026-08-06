export const PHOTO_ANNOTATION_VERSION = 2 as const;

export const PHOTO_ANNOTATION_COLORS = [
  { value: "#d71921", label: "Red" },
  { value: "#007aff", label: "Blue" },
  { value: "#4a9e5c", label: "Green" },
  { value: "#ffcc00", label: "Yellow" },
  { value: "#ffffff", label: "White" },
  { value: "#1a1a1a", label: "Black" },
] as const;

export const PHOTO_ANNOTATION_FONT_SIZES = [12, 14, 16, 20] as const;

export type PhotoAnnotationTool =
  | "select"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "freehand"
  | "text"
  | "highlight";

export type PhotoArrowAnnotation = {
  id: string;
  type: "arrow";
  color: string;
  strokeWidth: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type PhotoTextAnnotation = {
  id: string;
  type: "text";
  color: string;
  fontSize: number;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  width: number;
  height?: number;
  text: string;
};

type PhotoBoxGeometry = {
  id: string;
  color: string;
  strokeWidth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhotoRectangleAnnotation = PhotoBoxGeometry & {
  type: "rectangle";
};

export type PhotoEllipseAnnotation = PhotoBoxGeometry & {
  type: "ellipse";
};

export type PhotoHighlightAnnotation = PhotoBoxGeometry & {
  type: "highlight";
  opacity: number;
};

export type PhotoFreehandPoint = {
  x: number;
  y: number;
};

export type PhotoFreehandAnnotation = {
  id: string;
  type: "freehand";
  color: string;
  strokeWidth: number;
  points: PhotoFreehandPoint[];
};

export type PhotoBoxAnnotation =
  | PhotoRectangleAnnotation
  | PhotoEllipseAnnotation
  | PhotoHighlightAnnotation;

export type PhotoAnnotation =
  | PhotoArrowAnnotation
  | PhotoTextAnnotation
  | PhotoBoxAnnotation
  | PhotoFreehandAnnotation;

export type PhotoAnnotationDocument = {
  version: typeof PHOTO_ANNOTATION_VERSION;
  items: PhotoAnnotation[];
};

export function createEmptyPhotoAnnotationDocument(): PhotoAnnotationDocument {
  return {
    version: PHOTO_ANNOTATION_VERSION,
    items: [],
  };
}

export function normalizePhotoAnnotationDocument(value: unknown): PhotoAnnotationDocument {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray((value as PhotoAnnotationDocument).items)) {
    return createEmptyPhotoAnnotationDocument();
  }

  const items = (value as PhotoAnnotationDocument).items
    .map(sanitizePhotoAnnotation)
    .filter((item): item is PhotoAnnotation => Boolean(item));

  return {
    version: PHOTO_ANNOTATION_VERSION,
    items,
  };
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function clampBetween(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function sanitizeBoxGeometry(record: Record<string, unknown>) {
  // Keep enough room for the minimum drawable box even when imported data
  // places its origin exactly on the bottom or right edge.
  const x = clampBetween(clamp01(Number(record.x)), 0, 0.99);
  const y = clampBetween(clamp01(Number(record.y)), 0, 0.99);
  const width = Math.min(Math.max(Number(record.width) || 0.1, 0.01), 1 - x);
  const height = Math.min(Math.max(Number(record.height) || 0.1, 0.01), 1 - y);

  return {
    color: typeof record.color === "string" ? record.color : PHOTO_ANNOTATION_COLORS[0].value,
    strokeWidth: typeof record.strokeWidth === "number" ? record.strokeWidth : 2.5,
    x,
    y,
    width,
    height,
  };
}

function sanitizePhotoAnnotation(value: unknown): PhotoAnnotation | null {
  if (!value || typeof value !== "object" || !("type" in value) || !("id" in value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";

  if (!id) {
    return null;
  }

  if (record.type === "arrow") {
    return {
      id,
      type: "arrow",
      color: typeof record.color === "string" ? record.color : PHOTO_ANNOTATION_COLORS[0].value,
      strokeWidth: typeof record.strokeWidth === "number" ? record.strokeWidth : 2,
      x1: clamp01(Number(record.x1)),
      y1: clamp01(Number(record.y1)),
      x2: clamp01(Number(record.x2)),
      y2: clamp01(Number(record.y2)),
    };
  }

  if (record.type === "text") {
    const x = clamp01(Number(record.x));
    const y = clamp01(Number(record.y));

    return {
      id,
      type: "text",
      color: typeof record.color === "string" ? record.color : PHOTO_ANNOTATION_COLORS[0].value,
      fontSize:
        typeof record.fontSize === "number" && PHOTO_ANNOTATION_FONT_SIZES.includes(record.fontSize as (typeof PHOTO_ANNOTATION_FONT_SIZES)[number])
          ? record.fontSize
          : 14,
      anchorX: clamp01(Number(record.anchorX ?? record.x)),
      anchorY: clamp01(Number(record.anchorY ?? record.y)),
      x,
      y,
      width: Math.min(Math.max(Number(record.width) || 0.22, 0.12), 0.6),
      height:
        typeof record.height === "number"
          ? Math.min(Math.max(Number(record.height), 0.04), 0.85)
          : undefined,
      text: typeof record.text === "string" ? record.text : "",
    };
  }

  if (record.type === "rectangle" || record.type === "ellipse") {
    return {
      id,
      type: record.type,
      ...sanitizeBoxGeometry(record),
    };
  }

  if (record.type === "highlight") {
    return {
      id,
      type: "highlight",
      ...sanitizeBoxGeometry(record),
      opacity:
        typeof record.opacity === "number"
          ? clampBetween(record.opacity, 0.1, 0.6)
          : 0.26,
    };
  }

  if (record.type === "freehand" && Array.isArray(record.points)) {
    const points = record.points
      .slice(0, 2_000)
      .filter(
        (point): point is Record<string, unknown> =>
          Boolean(point) && typeof point === "object" && !Array.isArray(point),
      )
      .filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
      .map((point) => ({ x: clamp01(Number(point.x)), y: clamp01(Number(point.y)) }));

    if (points.length < 2) {
      return null;
    }

    return {
      id,
      type: "freehand",
      color: typeof record.color === "string" ? record.color : PHOTO_ANNOTATION_COLORS[0].value,
      strokeWidth: typeof record.strokeWidth === "number" ? record.strokeWidth : 2.5,
      points,
    };
  }

  return null;
}

export function createAnnotationId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fontSizeToStrokeWidth(fontSize: number) {
  if (fontSize <= 12) {
    return 2;
  }

  if (fontSize <= 14) {
    return 2.5;
  }

  if (fontSize <= 16) {
    return 3;
  }

  return 4;
}

export function strokeWidthToFontSize(strokeWidth: number) {
  if (strokeWidth <= 2) {
    return 12;
  }

  if (strokeWidth <= 2.5) {
    return 14;
  }

  if (strokeWidth <= 3) {
    return 16;
  }

  return 20;
}

export function annotationSizeValue(annotation: PhotoAnnotation) {
  return annotation.type === "text" ? annotation.fontSize : strokeWidthToFontSize(annotation.strokeWidth);
}

export function stepAnnotationFontSize(current: number, direction: -1 | 1) {
  let currentIndex = PHOTO_ANNOTATION_FONT_SIZES.indexOf(current as (typeof PHOTO_ANNOTATION_FONT_SIZES)[number]);

  if (currentIndex < 0) {
    currentIndex = PHOTO_ANNOTATION_FONT_SIZES.findIndex((size) => size >= current);
    if (currentIndex < 0) {
      currentIndex = PHOTO_ANNOTATION_FONT_SIZES.length - 1;
    }
  }

  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), PHOTO_ANNOTATION_FONT_SIZES.length - 1);
  return PHOTO_ANNOTATION_FONT_SIZES[nextIndex];
}

export function annotationColorLabel(color: string) {
  return PHOTO_ANNOTATION_COLORS.find((option) => option.value === color)?.label ?? "Color";
}

export function textCalloutMinHeightPx(fontSize: number) {
  return Math.max(fontSize * 2.8, 48);
}

/** @deprecated Use textCalloutMinHeightPx */
export function textAnnotationHeightPx(fontSize: number) {
  return textCalloutMinHeightPx(fontSize);
}

export function textCalloutBoxHeightPx(annotation: PhotoTextAnnotation, overlayHeight: number) {
  if (annotation.height && overlayHeight > 0) {
    return annotation.height * overlayHeight;
  }

  return textCalloutMinHeightPx(annotation.fontSize);
}

export function textCalloutBoxHeightNorm(annotation: PhotoTextAnnotation, overlayHeight: number) {
  if (overlayHeight <= 0) {
    return 0;
  }

  return textCalloutBoxHeightPx(annotation, overlayHeight) / overlayHeight;
}

export function measureTextCalloutBox(
  text: string,
  fontSize: number,
  overlayWidth: number,
  overlayHeight: number,
  minWidthNorm = 0.22,
  fontFamily = "system-ui, sans-serif",
  includeHandle = true,
  fixedWidthNorm?: number,
) {
  const minWidthPx = minWidthNorm * overlayWidth;
  const maxWidthPx = Math.min(overlayWidth * 0.45, 360);
  const minHeightPx = textCalloutMinHeightPx(fontSize);
  const handlePx = includeHandle ? 10 : 0;
  const paddingX = 24;
  const paddingY = 14;
  const lineHeight = fontSize * 1.35;

  if (overlayWidth <= 0 || overlayHeight <= 0) {
    return {
      width: minWidthNorm,
      height: minHeightPx / Math.max(overlayHeight, 1),
    };
  }

  if (typeof document === "undefined") {
    return {
      width: minWidthNorm,
      height: minHeightPx / overlayHeight,
    };
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return {
      width: minWidthNorm,
      height: minHeightPx / overlayHeight,
    };
  }

  context.font = `500 ${fontSize}px ${fontFamily}`;
  const paragraphs = text.split("\n");
  let contentWidthPx = minWidthPx;

  if (fixedWidthNorm === undefined) {
    paragraphs.forEach((paragraph) => {
      if (!paragraph) {
        return;
      }

      contentWidthPx = Math.max(contentWidthPx, context.measureText(paragraph).width + paddingX);
    });
  }

  const widthPx =
    fixedWidthNorm !== undefined
      ? Math.min(Math.max(fixedWidthNorm * overlayWidth, minWidthPx), maxWidthPx)
      : Math.min(Math.max(minWidthPx, contentWidthPx), maxWidthPx);
  const wrapWidth = widthPx - paddingX;
  let lineCount = 0;

  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      lineCount += 1;
      return;
    }

    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";

    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > wrapWidth && line) {
        lineCount += 1;
        line = word;
        return;
      }

      line = candidate;
    });

    lineCount += 1;
  });

  if (lineCount === 0) {
    lineCount = 1;
  }

  const textHeightPx = Math.max(minHeightPx - handlePx, lineCount * lineHeight + paddingY);
  const heightPx = textHeightPx + handlePx;

  return {
    width:
      fixedWidthNorm !== undefined
        ? Math.min(Math.max(fixedWidthNorm, minWidthNorm), 0.6)
        : Math.min(Math.max(widthPx / overlayWidth, minWidthNorm), 0.6),
    height: Math.min(Math.max(heightPx / overlayHeight, minHeightPx / overlayHeight), 0.85),
  };
}

export function resizeTextCalloutBox(
  annotation: PhotoTextAnnotation,
  pointerX: number,
  pointerY: number,
  overlayWidth: number,
  overlayHeight: number,
): PhotoTextAnnotation {
  const minWidth = 0.12;
  const maxWidth = 0.6;
  const minHeightNorm = overlayHeight > 0 ? textCalloutMinHeightPx(annotation.fontSize) / overlayHeight : 0.04;
  const maxHeight = 0.85;

  return {
    ...annotation,
    width: Math.min(Math.max(pointerX - annotation.x, minWidth), maxWidth),
    height: Math.min(Math.max(pointerY - annotation.y, minHeightNorm), maxHeight),
  };
}

export function textCalloutLeaderPoint(
  anchorX: number,
  anchorY: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
) {
  const centerX = boxX + boxWidth / 2;
  const centerY = boxY + boxHeight / 2;
  const deltaX = centerX - anchorX;
  const deltaY = centerY - anchorY;

  if (Math.abs(deltaX) < 0.0001 && Math.abs(deltaY) < 0.0001) {
    return { x: boxX, y: centerY };
  }

  const halfWidth = boxWidth / 2;
  const halfHeight = boxHeight / 2;
  const scale = Math.min(
    deltaX !== 0 ? halfWidth / Math.abs(deltaX) : Number.POSITIVE_INFINITY,
    deltaY !== 0 ? halfHeight / Math.abs(deltaY) : Number.POSITIVE_INFINITY,
  );

  return {
    x: centerX - deltaX * scale,
    y: centerY - deltaY * scale,
  };
}

export function moveTextCalloutBox(annotation: PhotoTextAnnotation, deltaX: number, deltaY: number): PhotoTextAnnotation {
  return {
    ...annotation,
    x: clamp01(annotation.x + deltaX),
    y: clamp01(annotation.y + deltaY),
  };
}

export function moveTextCalloutAnchor(annotation: PhotoTextAnnotation, deltaX: number, deltaY: number): PhotoTextAnnotation {
  return {
    ...annotation,
    anchorX: clamp01(annotation.anchorX + deltaX),
    anchorY: clamp01(annotation.anchorY + deltaY),
  };
}

export function isPhotoBoxAnnotation(annotation: PhotoAnnotation): annotation is PhotoBoxAnnotation {
  return annotation.type === "rectangle" || annotation.type === "ellipse" || annotation.type === "highlight";
}

export function resizePhotoBoxAnnotation(
  annotation: PhotoBoxAnnotation,
  pointerX: number,
  pointerY: number,
): PhotoBoxAnnotation {
  return {
    ...annotation,
    width: clampBetween(pointerX - annotation.x, 0.015, 1 - annotation.x),
    height: clampBetween(pointerY - annotation.y, 0.015, 1 - annotation.y),
  };
}

export function movePhotoAnnotation(annotation: PhotoAnnotation, deltaX: number, deltaY: number): PhotoAnnotation {
  if (annotation.type === "arrow") {
    return {
      ...annotation,
      x1: clamp01(annotation.x1 + deltaX),
      y1: clamp01(annotation.y1 + deltaY),
      x2: clamp01(annotation.x2 + deltaX),
      y2: clamp01(annotation.y2 + deltaY),
    };
  }

  if (annotation.type === "text") {
    return moveTextCalloutBox(annotation, deltaX, deltaY);
  }

  if (isPhotoBoxAnnotation(annotation)) {
    return {
      ...annotation,
      x: clampBetween(annotation.x + deltaX, 0, 1 - annotation.width),
      y: clampBetween(annotation.y + deltaY, 0, 1 - annotation.height),
    };
  }

  const xs = annotation.points.map((point) => point.x);
  const ys = annotation.points.map((point) => point.y);
  const safeDeltaX = clampBetween(deltaX, -Math.min(...xs), 1 - Math.max(...xs));
  const safeDeltaY = clampBetween(deltaY, -Math.min(...ys), 1 - Math.max(...ys));

  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: point.x + safeDeltaX,
      y: point.y + safeDeltaY,
    })),
  };
}
