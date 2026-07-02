"use client";

import { Box, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ExplodedView } from "@/domain/step-exploded-views";
import { refreshSignedMediaUrl } from "@/domain/supabase-planner";

/**
 * Display of the SolidWorks exploded views attached to a procedure task — a thumbnail grid that opens
 * a lightbox on click. Views are created by the SolidWorks plugin; when `onDelete` is provided each
 * one gets a delete control (the planner passes a handler; read-only surfaces omit it). Sits in the
 * task header next to the task metrics.
 */
export function StepExplodedViewGallery({
  views,
  onDelete,
}: {
  views: ExplodedView[];
  onDelete?: (view: ExplodedView) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Signed URLs expire after an hour, so an idle tab's <img> starts 4xx-ing. On the first load
  // error per object we re-sign once and swap in the fresh URL; a second failure (or a failed
  // re-sign, tracked as null) falls back to the placeholder tile instead of a broken image.
  const [signedUrlOverrides, setSignedUrlOverrides] = useState<Record<string, string | null>>({});
  const refreshedPathsRef = useRef(new Set<string>());

  async function handleImageError(storagePath?: string) {
    if (!storagePath) {
      return;
    }
    if (refreshedPathsRef.current.has(storagePath)) {
      setSignedUrlOverrides((current) =>
        current[storagePath] === null ? current : { ...current, [storagePath]: null },
      );
      return;
    }
    refreshedPathsRef.current.add(storagePath);
    const freshUrl = await refreshSignedMediaUrl(storagePath, "photo");
    setSignedUrlOverrides((current) => ({ ...current, [storagePath]: freshUrl ?? null }));
  }

  function resolveImageSource(storagePath: string | undefined, fallbackUrl: string) {
    if (storagePath) {
      const override = signedUrlOverrides[storagePath];
      if (override !== undefined) {
        return override ?? "";
      }
    }
    return fallbackUrl;
  }

  function confirmDelete(view: ExplodedView) {
    if (!onDelete) {
      return;
    }
    if (window.confirm(`Delete "${view.caption?.trim() || view.name}"? This can't be undone.`)) {
      if (activeId === view.id) {
        setActiveId(null);
      }
      onDelete(view);
    }
  }

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
        {views.map((view) => {
          const thumbnailPath = view.thumbnailUrl ? view.thumbnailStoragePath : view.storagePath;
          const thumbnailSrc = resolveImageSource(thumbnailPath, view.thumbnailUrl || view.dataUrl);
          return (
          <div key={view.id} className="group relative h-20 w-20">
            <button
              type="button"
              onClick={() => setActiveId(view.id)}
              className="h-full w-full overflow-hidden rounded border border-line bg-surface-sunken"
              title={explodedViewTitle(view)}
              aria-label={`Open ${view.name}`}
            >
              {thumbnailSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailSrc}
                  alt={view.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={() => void handleImageError(thumbnailPath)}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-ink-tertiary" aria-hidden="true">
                  <Box size={18} strokeWidth={1.5} />
                </span>
              )}
            </button>
            {onDelete ? (
              <button
                type="button"
                onClick={() => confirmDelete(view)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 hover:bg-danger"
                title="Delete exploded view"
                aria-label={`Delete ${view.name}`}
              >
                <Trash2 size={12} />
              </button>
            ) : null}
          </div>
          );
        })}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
          onClick={() => setActiveId(null)}
        >
          <div className="absolute right-4 top-4 flex items-center gap-2">
            {onDelete ? (
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-danger hover:bg-danger hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  confirmDelete(active);
                }}
                aria-label="Delete exploded view"
                title="Delete exploded view"
              >
                <Trash2 size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink"
              onClick={() => setActiveId(null)}
              aria-label="Close exploded view"
            >
              <X size={18} />
            </button>
          </div>
          {resolveImageSource(active.storagePath, active.dataUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveImageSource(active.storagePath, active.dataUrl)}
              alt={active.name}
              decoding="async"
              className="max-h-[80vh] max-w-[90vw] object-contain"
              onClick={(event) => event.stopPropagation()}
              onError={() => void handleImageError(active.storagePath)}
            />
          ) : (
            <div
              className="flex h-64 w-full max-w-[90vw] items-center justify-center rounded bg-surface-sunken text-ink-tertiary"
              onClick={(event) => event.stopPropagation()}
            >
              <Box size={32} strokeWidth={1.5} aria-hidden="true" />
            </div>
          )}
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
