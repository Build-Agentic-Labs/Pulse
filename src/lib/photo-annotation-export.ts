import {
  fontSizeToStrokeWidth,
  isPhotoBoxAnnotation,
  textCalloutMinHeightPx,
  textCalloutLeaderPoint,
  textCalloutAnchors,
  type PhotoAnnotation,
  type PhotoAnnotationDocument,
  type PhotoArrowAnnotation,
  type PhotoBoxAnnotation,
  type PhotoFreehandAnnotation,
  type PhotoTextAnnotation,
} from "@/domain/photo-annotations";
import type { StepPhotoAttachment } from "@/domain/step-photos";

export async function renderAnnotatedPhotoBlob(
  photo: StepPhotoAttachment,
  document: PhotoAnnotationDocument,
  source = photo.dataUrl,
) {
  const image = await loadImage(source);
  const canvas = window.document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to render the annotated photo.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  await drawAnnotationsOnCanvas(context, canvas.width, canvas.height, document.items);

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

export async function drawAnnotationsOnCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  items: PhotoAnnotation[],
) {
  const appFont = getComputedStyle(document.documentElement).getPropertyValue("--type-sans").trim() || "system-ui, sans-serif";

  for (const item of items) {
    if (item.type === "image") {
      const overlay = await loadImage(item.dataUrl);
      const { left, top, right, bottom } = item.crop;
      context.drawImage(overlay, left * overlay.naturalWidth, top * overlay.naturalHeight,
        (1 - left - right) * overlay.naturalWidth, (1 - top - bottom) * overlay.naturalHeight,
        item.x * width, item.y * height, item.width * width, item.height * height);
      continue;
    }
    if (item.type === "arrow") {
      drawArrowOnCanvas(context, item, width, height);
      continue;
    }

    if (item.type === "text") {
      drawTextOnCanvas(context, item, width, height, appFont);
      continue;
    }

    if (isPhotoBoxAnnotation(item)) {
      drawBoxAnnotationOnCanvas(context, item, width, height);
      continue;
    }

    drawFreehandOnCanvas(context, item, width, height);
  }
}

function canvasAnnotationScale(width: number, height: number) {
  // Annotations are authored in a roughly 700px viewer, while downloads use
  // the photo's full resolution. Convert UI pixels into image pixels so a 3px
  // shape stays visually 3px-ish when the exported photo is viewed to fit.
  return Math.max(1, Math.min(width, height) / 700);
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
  const scale = canvasAnnotationScale(width, height);
  const headLength = Math.max(10 * scale, arrow.strokeWidth * scale * 5);

  context.strokeStyle = arrow.color;
  context.fillStyle = arrow.color;
  context.lineWidth = arrow.strokeWidth * scale;
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

function drawBoxAnnotationOnCanvas(
  context: CanvasRenderingContext2D,
  annotation: PhotoBoxAnnotation,
  width: number,
  height: number,
) {
  const x = annotation.x * width;
  const y = annotation.y * height;
  const boxWidth = annotation.width * width;
  const boxHeight = annotation.height * height;

  context.save();
  context.strokeStyle = annotation.color;
  context.lineWidth = annotation.strokeWidth * canvasAnnotationScale(width, height);
  context.lineJoin = "round";

  if (annotation.type === "highlight") {
    context.globalAlpha = annotation.opacity;
    context.fillStyle = annotation.color;
    context.fillRect(x, y, boxWidth, boxHeight);
    context.globalAlpha = Math.min(annotation.opacity + 0.35, 0.75);
    context.strokeRect(x, y, boxWidth, boxHeight);
    context.restore();
    return;
  }

  if (annotation.type === "ellipse") {
    context.beginPath();
    context.ellipse(
      x + boxWidth / 2,
      y + boxHeight / 2,
      boxWidth / 2,
      boxHeight / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
    context.restore();
    return;
  }

  context.strokeRect(x, y, boxWidth, boxHeight);
  context.restore();
}

function drawFreehandOnCanvas(
  context: CanvasRenderingContext2D,
  annotation: PhotoFreehandAnnotation,
  width: number,
  height: number,
) {
  const [firstPoint, ...remainingPoints] = annotation.points;
  if (!firstPoint) {
    return;
  }

  context.save();
  context.strokeStyle = annotation.color;
  context.lineWidth = annotation.strokeWidth * canvasAnnotationScale(width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(firstPoint.x * width, firstPoint.y * height);
  remainingPoints.forEach((point) => context.lineTo(point.x * width, point.y * height));
  context.stroke();
  context.restore();
}

export function drawTextOnCanvas(
  context: CanvasRenderingContext2D,
  text: PhotoTextAnnotation,
  width: number,
  height: number,
  appFont: string,
) {
  const scale = canvasAnnotationScale(width, height);
  const boxWidth = text.width * width;
  const boxHeight = text.height
    ? text.height * height
    : textCalloutMinHeightPx(text.fontSize) * scale;
  const x = text.x * width;
  const y = text.y * height;
  const padding = 8 * scale;
  const borderWidth = 2 * scale;
  for (const anchor of textCalloutAnchors(text)) {
  const anchorX = anchor.x * width;
  const anchorY = anchor.y * height;
  const leader = textCalloutLeaderPoint(
    anchor.x,
    anchor.y,
    text.x,
    text.y,
    text.width,
    boxHeight / height,
  );

  context.strokeStyle = text.color;
  context.lineWidth = fontSizeToStrokeWidth(text.fontSize) * scale;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(anchorX, anchorY);
  context.lineTo(leader.x * width, leader.y * height);
  context.stroke();

  context.fillStyle = text.color;
  context.beginPath();
  context.arc(anchorX, anchorY, Math.max(3, text.fontSize * 0.22) * scale, 0, Math.PI * 2);
  context.fill();
  }

  context.fillStyle = "#ffffff";
  context.fillRect(x, y, boxWidth, boxHeight);

  context.strokeStyle = text.color;
  context.lineWidth = borderWidth;
  context.strokeRect(x + borderWidth / 2, y + borderWidth / 2, boxWidth - borderWidth, boxHeight - borderWidth);

  context.fillStyle = "#1a1a1a";
  context.font = `500 ${text.fontSize * scale}px ${appFont}`;
  context.textBaseline = "top";
  context.textAlign = text.textAlign ?? "left";
  const contentWidth = boxWidth - (padding + borderWidth) * 2;
  const alignmentOffset = text.textAlign === "center" ? contentWidth / 2 : text.textAlign === "right" ? contentWidth : 0;
  wrapCanvasText(
    context,
    text.text,
    x + padding + borderWidth + alignmentOffset,
    y + padding + borderWidth,
    contentWidth,
    text.fontSize * scale * 1.35,
    boxHeight - (padding + borderWidth) * 2,
  );
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  availableHeight: number,
) {
  const lines: string[] = [];
  // Preserve intentional line breaks, including blank lines, when exporting.
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const testLine = line ? `${line} ${word}` : word;
      if (context.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = "";
      }
      // Match the editor's wrapping for long part numbers and unbroken text.
      for (const character of (line ? ` ${word}` : word)) {
        if (line && context.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  const startY = y + Math.max(0, (availableHeight - lines.length * lineHeight) / 2);
  lines.forEach((line, index) => context.fillText(line, x, startY + index * lineHeight));
}
