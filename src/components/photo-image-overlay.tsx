import type { PhotoImageAnnotation } from "@/domain/photo-annotations";

/** The same source crop is used in the editor, thumbnails and printed instructions. */
export function PhotoImageOverlay({ annotation, width, height }: { annotation: PhotoImageAnnotation; width: number; height: number }) {
  const { crop, sourceWidth: sw, sourceHeight: sh } = annotation;
  return <svg x={annotation.x * width} y={annotation.y * height}
    width={annotation.width * width} height={annotation.height * height}
    viewBox={`${crop.left * sw} ${crop.top * sh} ${(1 - crop.left - crop.right) * sw} ${(1 - crop.top - crop.bottom) * sh}`}
    preserveAspectRatio="none" overflow="hidden" data-annotation-type="image">
    <image href={annotation.dataUrl} width={sw} height={sh} />
  </svg>;
}
