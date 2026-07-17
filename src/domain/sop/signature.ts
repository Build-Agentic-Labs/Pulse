export interface SignaturePoint {
  x: number;
  y: number;
}

export type SignatureStrokes = SignaturePoint[][];

export const SIGNATURE_VIEWBOX_WIDTH = 600;
export const SIGNATURE_VIEWBOX_HEIGHT = 180;

export function parseSignatureStrokes(value: unknown): SignatureStrokes {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Array.isArray)
    .map((stroke) => stroke
      .filter((point): point is Record<string, unknown> => Boolean(point) && typeof point === "object")
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    )
    .filter((stroke) => stroke.length > 0);
}

export function signatureStrokePath(stroke: SignaturePoint[]): string {
  if (!stroke.length) return "";
  if (stroke.length === 1) {
    const point = stroke[0];
    return `M ${point.x} ${point.y} l 0.1 0`;
  }
  return stroke.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}
