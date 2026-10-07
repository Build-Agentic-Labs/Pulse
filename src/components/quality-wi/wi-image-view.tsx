import type { WiImage } from "@/domain/quality-wi/schema";
import { normalizePhotoAnnotationDocument } from "@/domain/photo-annotations";
import { StaticPhotoAnnotation } from "@/components/static-photo-annotation";
/** Same annotation renderer as product instructions; no task storage or save dependencies. */
export function WiImageView({ image }: { image: WiImage }) {
  const marker = `wi-${image.id}-arrow`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${image.width} ${image.height}`}
      width={image.width}
      height={image.height}
      role="img"
      aria-label={image.name}
      className="max-h-80 h-auto max-w-full"
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      <image href={image.url} width={image.width} height={image.height} />
      {normalizePhotoAnnotationDocument(image.annotations).items.map(
        (annotation) => (
          <StaticPhotoAnnotation
            key={annotation.id}
            annotation={annotation}
            width={image.width}
            height={image.height}
            markerId={marker}
          />
        ),
      )}
    </svg>
  );
}
