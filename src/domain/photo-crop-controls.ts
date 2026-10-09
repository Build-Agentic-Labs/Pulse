import type { PhotoImageAnnotation } from "./photo-annotations";

/** Normalized edge movement shared by pointer and keyboard crop controls. */
export function adjustPhotoCrop(c: PhotoImageAnnotation["crop"], handle: string, dx: number, dy: number): PhotoImageAnnotation["crop"] {
  const next = { ...c };
  if (handle === "move") {
    const x = Math.max(-c.left, Math.min(c.right, dx));
    const y = Math.max(-c.top, Math.min(c.bottom, dy));
    next.left += x; next.right -= x; next.top += y; next.bottom -= y;
  } else {
    if (handle.includes("w")) next.left = Math.max(0, Math.min(1 - c.right - .05, c.left + dx));
    if (handle.includes("e")) next.right = Math.max(0, Math.min(1 - c.left - .05, c.right - dx));
    if (handle.includes("n")) next.top = Math.max(0, Math.min(1 - c.bottom - .05, c.top + dy));
    if (handle.includes("s")) next.bottom = Math.max(0, Math.min(1 - c.top - .05, c.bottom - dy));
  }
  return next;
}
