"use client";

import { Film, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { TaskVideo } from "@/domain/task-videos";

/**
 * Build-animation videos attached to a task. A row of poster tiles that open a lightbox video player;
 * when `onDelete` is provided each tile gets a delete control (planner only — operators are read-only).
 * Sits in the task header alongside the exploded-view gallery.
 */
export function TaskVideoGallery({
  videos,
  onDelete,
}: {
  videos: TaskVideo[];
  onDelete?: (video: TaskVideo) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

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

  function confirmDelete(video: TaskVideo) {
    if (!onDelete) {
      return;
    }
    if (window.confirm(`Delete "${video.caption?.trim() || video.name}"? This can't be undone.`)) {
      if (activeId === video.id) {
        setActiveId(null);
      }
      onDelete(video);
    }
  }

  if (videos.length === 0) {
    return null;
  }

  const active = videos.find((video) => video.id === activeId) ?? null;

  return (
    <div className="ui-procedure-step-divider">
      <div className="mb-2 flex items-center gap-1.5">
        <Film size={13} strokeWidth={1.75} className="text-ink-tertiary" />
        <span className="ui-field-label mb-0 block">Build animations · {videos.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {videos.map((video) => (
          <div key={video.id} className="group relative h-20 w-28">
            <button
              type="button"
              onClick={() => setActiveId(video.id)}
              className="flex h-full w-full items-center justify-center overflow-hidden rounded border border-line bg-black/80"
              title={video.caption?.trim() || video.name}
              aria-label={`Play ${video.name}`}
            >
              {video.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.thumbnailUrl} alt={video.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : null}
              <span className="absolute flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-black">
                <Film size={15} />
              </span>
            </button>
            {onDelete ? (
              <button
                type="button"
                onClick={() => confirmDelete(video)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 hover:bg-danger"
                title="Delete build animation"
                aria-label={`Delete ${video.name}`}
              >
                <Trash2 size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
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
                aria-label="Delete build animation"
                title="Delete build animation"
              >
                <Trash2 size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink"
              onClick={() => setActiveId(null)}
              aria-label="Close video"
            >
              <X size={18} />
            </button>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={active.videoUrl}
            poster={active.thumbnailUrl}
            controls
            autoPlay
            loop
            className="max-h-[80vh] max-w-[90vw] rounded bg-black"
            onClick={(event) => event.stopPropagation()}
          />
          <div
            className="mt-3 max-w-[90vw] text-center text-sm text-canvas"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="font-medium">{active.caption || active.name}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
