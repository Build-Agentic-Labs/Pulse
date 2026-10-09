"use client";

import { ModalSurface } from "@/components/ui/modal-surface";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PhotoImageAnnotation } from "@/domain/photo-annotations";

import { adjustPhotoCrop } from "@/domain/photo-crop-controls";

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
    setCrop(adjustPhotoCrop(current.crop, current.handle, dx, dy));
  }
  function adjustWithKeyboard(event: KeyboardEvent<HTMLElement>, handle: string) {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 0.1 : 0.01;
    setCrop(current => adjustPhotoCrop(current, handle, direction[0] * step, direction[1] * step));
  }

  return <ModalSurface label="Crop overlay image" onCancel={onCancel}><div className="ui-overlay-crop-modal"
    onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}>
    <div className="ui-overlay-crop-actions">
      <span>Drag the crop area or its edges. Use arrow keys when focused; Shift moves faster.</span>
      <button type="button" onClick={() => setCrop({ left: 0, top: 0, right: 0, bottom: 0 })}>Reset</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" data-modal-initial-focus onClick={() => onDone(crop)}>Done</button>
    </div>
    <div ref={frame} className="ui-overlay-crop-frame" style={{ width: `min(85vw, ${65 * image.sourceWidth / image.sourceHeight}vh)`, aspectRatio: `${image.sourceWidth} / ${image.sourceHeight}` }}>
      {/* The original embedded image stays intact; only crop coordinates are saved. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt="Overlay to crop" draggable={false} />
      <div className="ui-overlay-crop-selection" tabIndex={0} aria-label="Crop selection" onKeyDown={e => adjustWithKeyboard(e, "move")} style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, right: `${crop.right * 100}%`, bottom: `${crop.bottom * 100}%` }}
        onPointerDown={e => start(e, "move")} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(handle =>
          <button type="button" key={handle} className={`ui-overlay-crop-handle crop-${handle}`} aria-label={`Resize crop ${handle}`}
            onKeyDown={e => adjustWithKeyboard(e, handle)} onPointerDown={e => start(e, handle)} />)}
      </div>
    </div>
  </div></ModalSurface>;
}
