import { describe, expect, it } from "vitest";

import {
  movePhotoAnnotation,
  normalizePhotoAnnotationDocument,
  PHOTO_ANNOTATION_VERSION,
  resizePhotoBoxAnnotation,
  type PhotoFreehandAnnotation,
  type PhotoRectangleAnnotation,
} from "./photo-annotations";

describe("photo annotations", () => {
  it("normalizes WI shapes while upgrading older annotation documents", () => {
    const normalized = normalizePhotoAnnotationDocument({
      version: 1,
      items: [
        {
          id: "rectangle-1",
          type: "rectangle",
          color: "#d71921",
          strokeWidth: 3,
          x: 0.8,
          y: 0.1,
          width: 0.4,
          height: 0.3,
        },
        {
          id: "ellipse-1",
          type: "ellipse",
          color: "#007aff",
          strokeWidth: 2.5,
          x: 0.2,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        },
        {
          id: "highlight-1",
          type: "highlight",
          color: "#ffcc00",
          strokeWidth: 2,
          x: 0.1,
          y: 0.7,
          width: 0.5,
          height: 0.2,
          opacity: 0.9,
        },
        {
          id: "freehand-1",
          type: "freehand",
          color: "#4a9e5c",
          strokeWidth: 4,
          points: [
            { x: -1, y: 0.25 },
            { x: 0.5, y: 2 },
          ],
        },
      ],
    });

    expect(normalized.version).toBe(PHOTO_ANNOTATION_VERSION);
    expect(normalized.items).toHaveLength(4);
    expect(normalized.items[0]).toEqual(expect.objectContaining({ type: "rectangle", x: 0.8 }));
    expect(normalized.items[0]?.type === "rectangle" ? normalized.items[0].width : 0).toBeCloseTo(0.2);
    expect(normalized.items[1]).toEqual(
      expect.objectContaining({ type: "ellipse", width: 0.3, height: 0.4 }),
    );
    expect(normalized.items[2]).toEqual(expect.objectContaining({ type: "highlight", opacity: 0.6 }));
    expect(normalized.items[3]).toEqual(
      expect.objectContaining({
        type: "freehand",
        points: [
          { x: 0, y: 0.25 },
          { x: 0.5, y: 1 },
        ],
      }),
    );
  });

  it("rejects freehand marks that do not contain a drawable path", () => {
    expect(
      normalizePhotoAnnotationDocument({
        items: [{ id: "freehand-1", type: "freehand", points: [{ x: 0.2, y: 0.2 }] }],
      }).items,
    ).toEqual([]);
  });

  it("moves and resizes boxed annotations without leaving the photo", () => {
    const rectangle: PhotoRectangleAnnotation = {
      id: "rectangle-1",
      type: "rectangle",
      color: "#d71921",
      strokeWidth: 3,
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.25,
    };

    const resized = resizePhotoBoxAnnotation(rectangle, 0.8, 0.75);
    expect(resized.width).toBeCloseTo(0.6);
    expect(resized.height).toBeCloseTo(0.55);
    expect(movePhotoAnnotation(rectangle, 0.8, 0.9)).toEqual(
      expect.objectContaining({ x: 0.7, y: 0.75 }),
    );
  });

  it("moves a freehand mark as one path and clamps it at the photo edge", () => {
    const freehand: PhotoFreehandAnnotation = {
      id: "freehand-1",
      type: "freehand",
      color: "#007aff",
      strokeWidth: 2.5,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.9, y: 0.8 },
      ],
    };

    const moved = movePhotoAnnotation(freehand, 0.5, 0.5);
    expect(moved.type).toBe("freehand");
    if (moved.type !== "freehand") {
      throw new Error("Expected a freehand annotation.");
    }
    expect(moved.points[0]?.x).toBeCloseTo(0.3);
    expect(moved.points[0]?.y).toBeCloseTo(0.5);
    expect(moved.points[1]).toEqual({ x: 1, y: 1 });
  });
});
