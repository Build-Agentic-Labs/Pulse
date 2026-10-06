"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { PhotoImageAnnotation } from "@/domain/photo-annotations";

type Crop = PhotoImageAnnotation["crop"];
export function PhotoOverlayCropEditor({ image, onDone, onCancel }: {
  image: PhotoImageAnnotation; onDone: (crop: Crop) => void; onCancel: () => void;
}) {
  const [crop, setCrop] = useState(image.crop);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop; handle: string } | null>(null);
  function start(event: PointerEvent<HTMLElement>, handle: string) {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop, handle };
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    const bounds = frame.current?.getBoundingClientRect();
    if (!current || !bounds?.width || !bounds.height) return;
    const dx = (event.clientX - current.x) / bounds.width;
    const dy = (event.clientY - current.y) / bounds.height;
    const c = current.crop;
    const next = { ...c };
    if (current.handle === "move") {
      const x = Math.max(-c.left, Math.min(c.right, dx));
      const y = Math.max(-c.top, Math.min(c.bottom, dy));
      next.left += x; next.right -= x; next.top += y; next.bottom -= y;
    } else {
      if (current.handle.includes("w")) next.left = Math.max(0, Math.min(1 - c.right - .05, c.left + dx));
      if (current.handle.includes("e")) next.right = Math.max(0, Math.min(1 - c.left - .05, c.right - dx));
      if (current.handle.includes("n")) next.top = Math.max(0, Math.min(1 - c.bottom - .05, c.top + dy));
      if (current.handle.includes("s")) next.bottom = Math.max(0, Math.min(1 - c.top - .05, c.bottom - dy));
    }
    setCrop(next);
  }
  return <div className="ui-overlay-crop-modal" role="dialog" aria-modal="true" aria-label="Crop overlay image"
    onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}>
    <div className="ui-overlay-crop-actions">
      <span>Drag the crop area or its edges</span>
      <button type="button" onClick={() => setCrop({ left: 0, top: 0, right: 0, bottom: 0 })}>Reset</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" autoFocus onClick={() => onDone(crop)}>Done</button>
    </div>
    <div ref={frame} className="ui-overlay-crop-frame" style={{ width: `min(85vw, ${65 * image.sourceWidth / image.sourceHeight}vh)`, aspectRatio: `${image.sourceWidth} / ${image.sourceHeight}` }}>
      {/* The original embedded image stays intact; only crop coordinates are saved. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt="Overlay to crop" draggable={false} />
      <div className="ui-overlay-crop-selection" tabIndex={-1} aria-label="Crop selection" style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, right: `${crop.right * 100}%`, bottom: `${crop.bottom * 100}%` }}
        onPointerDown={e => start(e, "move")} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(handle =>
          <button type="button" key={handle} className={`ui-overlay-crop-handle crop-${handle}`} aria-label={`Resize crop ${handle}`}
            onPointerDown={e => start(e, handle)} />)}
      </div>
    </div>
  </div>;
}
