"use client";

import { RotateCcw } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  SIGNATURE_VIEWBOX_HEIGHT,
  SIGNATURE_VIEWBOX_WIDTH,
  signatureStrokePath,
  type SignaturePoint,
  type SignatureStrokes,
} from "@/domain/sop/signature";

export function SignaturePad({
  value,
  onChange,
  disabled = false,
}: {
  value: SignatureStrokes;
  onChange: (strokes: SignatureStrokes) => void;
  disabled?: boolean;
}) {
  const drawingRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  // The in-progress stroke stays local so each accepted pointer sample re-renders only the pad,
  // not the parent workspace. The parent is published to once, on pointer-up. While drawing,
  // `draft` is the source of truth; when idle it is null and the controlled `value` renders.
  const [draft, setDraft] = useState<SignatureStrokes | null>(null);
  const draftRef = useRef<SignatureStrokes | null>(null);
  const strokes = draft ?? value;

  function setDraftStrokes(next: SignatureStrokes | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): SignaturePoint {
    const svg = event.currentTarget;
    const screenMatrix = svg.getScreenCTM();
    if (screenMatrix) {
      const cursor = svg.createSVGPoint();
      cursor.x = event.clientX;
      cursor.y = event.clientY;
      const point = cursor.matrixTransform(screenMatrix.inverse());
      return {
        x: Math.max(0, Math.min(SIGNATURE_VIEWBOX_WIDTH, point.x)),
        y: Math.max(0, Math.min(SIGNATURE_VIEWBOX_HEIGHT, point.y)),
      };
    }

    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(SIGNATURE_VIEWBOX_WIDTH, ((event.clientX - rect.left) / rect.width) * SIGNATURE_VIEWBOX_WIDTH)),
      y: Math.max(0, Math.min(SIGNATURE_VIEWBOX_HEIGHT, ((event.clientY - rect.top) / rect.height) * SIGNATURE_VIEWBOX_HEIGHT)),
    };
  }

  function startDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    activePointerRef.current = event.pointerId;
    setDraftStrokes([...value, [pointFromEvent(event)]]);
  }

  function continueDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || !drawingRef.current || activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const current = draftRef.current;
    if (!current) return;
    const currentStroke = current[current.length - 1];
    const previous = currentStroke?.[currentStroke.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.4) return;
    setDraftStrokes(current.map((stroke, index) => index === current.length - 1 ? [...stroke, point] : stroke));
  }

  function finishDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    drawingRef.current = false;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // Publish the finished stroke to the parent once. Clearing the draft in the same handler
    // batches with the parent update, so the pad re-renders straight onto the controlled value.
    const finished = draftRef.current;
    setDraftStrokes(null);
    if (finished) onChange(finished);
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-md border border-line bg-white">
        <svg
          className={`block h-36 w-full touch-none ${disabled ? "cursor-not-allowed opacity-70" : "cursor-crosshair"}`}
          viewBox={`0 0 ${SIGNATURE_VIEWBOX_WIDTH} ${SIGNATURE_VIEWBOX_HEIGHT}`}
          role="img"
          aria-label="Signature drawing pad"
          onPointerDown={startDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={finishDrawing}
          onPointerCancel={finishDrawing}
        >
          <line x1="24" y1="145" x2="576" y2="145" stroke="#d4d4d4" strokeWidth="1.5" />
          {strokes.map((stroke, index) => (
            <path
              key={index}
              d={signatureStrokePath(stroke)}
              fill="none"
              stroke="#111827"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        {!strokes.length ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
            Draw your signature here
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-ink-tertiary">Use your mouse, trackpad, or finger.</p>
        <button
          type="button"
          className="ui-btn-ghost h-8 gap-1.5 px-2.5 text-ink-secondary disabled:opacity-40"
          disabled={disabled || strokes.length === 0}
          onClick={() => onChange([])}
        >
          <RotateCcw size={13} />
          Clear
        </button>
      </div>
    </div>
  );
}
