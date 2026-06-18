"use client";

import { Box, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ExplodedView } from "@/domain/step-exploded-views";

/**
 * Read-only display of the SolidWorks exploded views attached to a procedure task. Views are created
 * by the SolidWorks plugin (via the ingest API), so this gallery only shows them — a thumbnail grid
 * that opens a lightbox on click. Sits in the task header next to the task metrics.
 */
export function StepExplodedViewGallery({ views }: { views: ExplodedView[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Escape closes the lightbox, matching the step-photo viewer's dialog behavior.
  useEffect(() => {
    if (!activeId) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId]);

  if (views.length === 0) {
    return null;
  }

  const active = views.find((view) => view.id === activeId) ?? null;

  return (
    <div className="ui-procedure-step-divider">
      <div className="mb-2 flex items-center gap-1.5">
        <Box size={13} strokeWidth={1.75} className="text-ink-tertiary" />
        <span className="ui-field-label mb-0 block">Exploded views · {views.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setActiveId(view.id)}
            className="group relative h-20 w-20 overflow-hidden rounded border border-line bg-surface-sunken"
            title={explodedViewTitle(view)}
            aria-label={`Open ${view.name}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={view.thumbnailUrl || view.dataUrl}
              alt={view.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
          onClick={() => setActiveId(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink"
            onClick={() => setActiveId(null)}
            aria-label="Close exploded view"
          >
            <X size={18} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.dataUrl}
            alt={active.name}
            decoding="async"
            className="max-h-[80vh] max-w-[90vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <div
            className="mt-3 max-w-[90vw] text-center text-sm text-canvas"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="font-medium">{active.caption || active.name}</div>
            {explodedViewMeta(active) ? (
              <div className="ui-mono-label mt-1 text-canvas/70">{explodedViewMeta(active)}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function explodedViewTitle(view: ExplodedView) {
  return view.caption?.trim() || view.name;
}

// Compact provenance line: config name, frame index, and source SolidWorks file when present.
function explodedViewMeta(view: ExplodedView): string {
  const parts: string[] = [];
  if (view.explodeConfigName) {
    parts.push(view.explodeConfigName);
  }
  if (typeof view.frameNumber === "number") {
    parts.push(`frame ${view.frameNumber}`);
  }
  if (view.solidworksFilePath) {
    parts.push(view.solidworksFilePath.split(/[\\/]/).pop() ?? view.solidworksFilePath);
  }
  return parts.join(" · ");
}
