import { describe, expect, it } from "vitest";
import { cropPhotoImage, normalizePhotoAnnotationDocument, resizePhotoBoxAnnotation, type PhotoImageAnnotation } from "./photo-annotations";

const image: PhotoImageAnnotation = { id: "overlay", type: "image", color: "#ffcc00", strokeWidth: 2,
  x: .1, y: .1, width: .4, height: .3, dataUrl: "data:image/png;base64,AAAA", sourceWidth: 800, sourceHeight: 600,
  crop: { left: 0, top: 0, right: 0, bottom: 0 } };

describe("photo overlays", () => {
  it("round trips embedded images and their crop through saved annotation JSON", () => {
    const cropped = cropPhotoImage(image, { left: .25, top: .2, right: .1, bottom: .1 });
    expect(normalizePhotoAnnotationDocument(JSON.parse(JSON.stringify({ items: [cropped] }))).items).toEqual([cropped]);
    expect(cropped.width).toBeCloseTo(.26);
    expect(cropped.height).toBeCloseTo(.21);
    expect(cropped.x).toBeCloseTo(.2);
    expect(cropPhotoImage(cropped, image.crop)).toMatchObject({ width: .4, height: .3 });
  });
  it("rejects external URLs and SVG and clamps empty or invalid crops", () => {
    for (const dataUrl of ["https://example.com/image.png", "data:image/svg+xml;base64,AAAA"])
      expect(normalizePhotoAnnotationDocument({ items: [{ ...image, dataUrl }] }).items).toEqual([]);
    const [result] = normalizePhotoAnnotationDocument({ items: [{ ...image, crop: { left: 1, right: 1, top: -1, bottom: "bad" } }] }).items;
    expect(result).toMatchObject({ crop: { left: .9, top: 0, bottom: 0 } });
    expect((result as PhotoImageAnnotation).crop.right).toBeCloseTo(.05);
  });
  it("preserves the photo's proportions when resizing at the image boundary", () => {
    const resized = resizePhotoBoxAnnotation(image, 2, 2);
    expect(resized.width / resized.height).toBeCloseTo(image.width / image.height);
    expect(resized.x + resized.width).toBeLessThanOrEqual(1);
    expect(resized.y + resized.height).toBeLessThanOrEqual(1);
  });
});
