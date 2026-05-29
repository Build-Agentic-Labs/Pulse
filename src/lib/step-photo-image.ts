import type { StepPhotoAttachment } from "@/domain/step-photos";

/**
 * Browser-only helpers for compressing a picked image file into a
 * StepPhotoAttachment (downscale -> JPEG -> data URL).
 *
 * Extracted from line-workspace.tsx. These rely on DOM/canvas APIs
 * (FileReader, Image, HTMLCanvasElement) so they run in the browser only and
 * are validated via typecheck/build rather than the node test suite.
 */

const MAX_STEP_PHOTO_EDGE = 1280;
const STEP_PHOTO_JPEG_QUALITY = 0.72;

export function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read compressed photo."));
    reader.readAsDataURL(blob);
  });
}

export function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to read ${file.name || "photo"}.`));
    };
    image.src = objectUrl;
  });
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Unable to compress photo."));
      },
      "image/jpeg",
      STEP_PHOTO_JPEG_QUALITY,
    );
  });
}

export async function buildStepPhotoAttachment(file: File): Promise<StepPhotoAttachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name || "Selected file"} is not an image.`);
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_STEP_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare photo compression.");
  }

  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToJpegBlob(canvas);
  const dataUrl = await readBlobAsDataUrl(blob);

  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "Step photo.jpg",
    dataUrl,
    capturedAt: new Date().toISOString(),
    contentType: blob.type,
    sizeBytes: blob.size,
    width,
    height,
  };
}
