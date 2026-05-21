export const PHOTO_ANNOTATION_VERSION = 1 as const;

export const PHOTO_ANNOTATION_COLORS = [
  { value: "#d71921", label: "Red" },
  { value: "#007aff", label: "Blue" },
  { value: "#4a9e5c", label: "Green" },
  { value: "#ffffff", label: "White" },
  { value: "#1a1a1a", label: "Black" },
] as const;

export const PHOTO_ANNOTATION_FONT_SIZES = [12, 14, 16, 20] as const;

export type PhotoAnnotationTool = "select" | "arrow" | "text";

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

export type PhotoAnnotation = PhotoArrowAnnotation | PhotoTextAnnotation;

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
  return Math.min(Math.max(value, 0), 1);
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

  return moveTextCalloutBox(annotation, deltaX, deltaY);
}
