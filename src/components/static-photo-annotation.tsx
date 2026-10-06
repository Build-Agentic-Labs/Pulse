import { PhotoImageOverlay } from "./photo-image-overlay";
import {
  isPhotoBoxAnnotation,
  textCalloutLeaderPoint,
  textCalloutAnchors,
  type PhotoAnnotation,
  type PhotoTextAnnotation,
} from "@/domain/photo-annotations";

function photoRenderScale(width: number, height: number, targetSize: number) {
  return Math.max(1, Math.min(width, height) / targetSize);
}

export function StaticPhotoAnnotation({
  annotation,
  width,
  height,
  markerId,
  targetSize = 700,
  calloutClassName = "wi-card-photo-callout",
}: {
  annotation: PhotoAnnotation;
  width: number;
  height: number;
  markerId: string;
  targetSize?: number;
  calloutClassName?: string;
}) {
  const scale = photoRenderScale(width, height, targetSize);

  if (annotation.type === "image") return <PhotoImageOverlay annotation={annotation} width={width} height={height} />;

  if (annotation.type === "arrow") {
    return (
      <line
        data-annotation-type="arrow"
        x1={annotation.x1 * width}
        y1={annotation.y1 * height}
        x2={annotation.x2 * width}
        y2={annotation.y2 * height}
        stroke={annotation.color}
        strokeWidth={annotation.strokeWidth * scale}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
    );
  }

  if (isPhotoBoxAnnotation(annotation)) {
    const x = annotation.x * width;
    const y = annotation.y * height;
    const boxWidth = annotation.width * width;
    const boxHeight = annotation.height * height;
    const common = {
      "data-annotation-type": annotation.type,
      fill: annotation.type === "highlight" ? annotation.color : "none",
      fillOpacity: annotation.type === "highlight" ? annotation.opacity : undefined,
      stroke: annotation.color,
      strokeOpacity:
        annotation.type === "highlight" ? Math.min(annotation.opacity + 0.35, 0.75) : undefined,
      strokeWidth: annotation.strokeWidth * scale,
    };

    return annotation.type === "ellipse" ? (
      <ellipse
        {...common}
        cx={x + boxWidth / 2}
        cy={y + boxHeight / 2}
        rx={boxWidth / 2}
        ry={boxHeight / 2}
      />
    ) : (
      <rect {...common} x={x} y={y} width={boxWidth} height={boxHeight} />
    );
  }

  if (annotation.type === "freehand") {
    return (
      <polyline
        data-annotation-type="freehand"
        points={annotation.points.map((point) => `${point.x * width},${point.y * height}`).join(" ")}
        fill="none"
        stroke={annotation.color}
        strokeWidth={annotation.strokeWidth * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <StaticTextCallout
      annotation={annotation}
      width={width}
      height={height}
      scale={scale}
      calloutClassName={calloutClassName}
    />
  );
}

function StaticTextCallout({
  annotation,
  width,
  height,
  scale,
  calloutClassName,
}: {
  annotation: PhotoTextAnnotation;
  width: number;
  height: number;
  scale: number;
  calloutClassName: string;
}) {
  const boxHeightNorm = annotation.height ?? Math.max(0.08, (annotation.fontSize * 3.4 * scale) / height);

  return (
    <g data-annotation-type="text">
      {textCalloutAnchors(annotation).map((anchor, index) => {
        const leader = textCalloutLeaderPoint(anchor.x, anchor.y, annotation.x, annotation.y, annotation.width, boxHeightNorm);
        return <g key={index} data-callout-pointer={index}>
      <line
        x1={anchor.x * width}
        y1={anchor.y * height}
        x2={leader.x * width}
        y2={leader.y * height}
        stroke={annotation.color}
        strokeWidth={2 * scale}
        strokeLinecap="round"
      />
      <circle
        cx={anchor.x * width}
        cy={anchor.y * height}
        r={3 * scale}
        fill={annotation.color}
      />
        </g>;
      })}
      <foreignObject
        x={annotation.x * width}
        y={annotation.y * height}
        width={annotation.width * width}
        height={boxHeightNorm * height}
      >
        <div
          className={calloutClassName}
          style={{
            boxSizing: "border-box",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            border: `${2 * scale}px solid ${annotation.color}`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "rgba(255,255,255,0.94)",
            color: "#1a1a1a",
            fontSize: `${annotation.fontSize * scale}px`,
            fontWeight: 500,
            textAlign: annotation.textAlign ?? "left",
            lineHeight: 1.35,
            padding: `${5 * scale}px ${7 * scale}px`,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          <div style={{ width: "100%" }}>{annotation.text}</div>
        </div>
      </foreignObject>
    </g>
  );
}
