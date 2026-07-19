"use client";

import { Film, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TaskVideo } from "@/domain/task-videos";
import { refreshSignedMediaUrl } from "@/domain/supabase-planner";
import { useConfirm } from "@/components/confirm-provider";

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
  // Signed URLs expire after an hour, so an idle tab's <video>/<img> starts 4xx-ing. On the first
  // load error per object we re-sign once and swap in the fresh URL; a second failure (or a failed
  // re-sign, tracked as null) falls back to the placeholder instead of a broken player.
  const [signedUrlOverrides, setSignedUrlOverrides] = useState<Record<string, string | null>>({});
  const refreshedPathsRef = useRef(new Set<string>());
  const confirm = useConfirm();

  async function handleMediaError(storagePath?: string) {
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
    const freshUrl = await refreshSignedMediaUrl(storagePath, "video");
    setSignedUrlOverrides((current) => ({ ...current, [storagePath]: freshUrl ?? null }));
  }

  function resolveMediaSource(storagePath: string | undefined, fallbackUrl: string) {
    if (storagePath) {
      const override = signedUrlOverrides[storagePath];
      if (override !== undefined) {
        return override ?? "";
      }
    }
    return fallbackUrl;
  }

  // Escape closes the lightbox; Left/Right arrows step between videos — matching the
  // step-photo viewer's dialog navigation.
  useEffect(() => {
    if (!activeId) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveId(null);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const index = videos.findIndex((video) => video.id === activeId);
        if (index === -1) {
          return;
        }
        const nextIndex = event.key === "ArrowLeft" ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= videos.length) {
          return;
        }
        event.preventDefault();
        setActiveId(videos[nextIndex]?.id ?? null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, videos]);

  async function confirmDelete(video: TaskVideo) {
    if (!onDelete) {
      return;
    }
    const ok = await confirm({
      title: "Delete this build animation?",
      body: video.caption?.trim() || video.name,
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (ok) {
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
              className="flex h-full w-full items-center justify-center overflow-hidden rounded-sm border border-line bg-black/80"
              title={video.caption?.trim() || video.name}
              aria-label={`Play ${video.name}`}
            >
              {video.thumbnailUrl && resolveMediaSource(video.thumbnailStoragePath, video.thumbnailUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveMediaSource(video.thumbnailStoragePath, video.thumbnailUrl)}
                  alt={video.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={() => void handleMediaError(video.thumbnailStoragePath)}
                />
              ) : null}
              <span className="absolute flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-black">
                <Film size={15} />
              </span>
            </button>
            {onDelete ? (
              <button
                type="button"
                onClick={() => void confirmDelete(video)}
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
                  void confirmDelete(active);
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
          {resolveMediaSource(active.storagePath, active.videoUrl) ? (
             
            <video
              src={resolveMediaSource(active.storagePath, active.videoUrl)}
              poster={active.thumbnailUrl}
              controls
              autoPlay
              loop
              className="max-h-[80vh] max-w-[90vw] rounded-sm bg-black"
              onClick={(event) => event.stopPropagation()}
              onError={() => void handleMediaError(active.storagePath)}
            />
          ) : (
            <div
              className="flex h-64 w-full max-w-[90vw] items-center justify-center rounded-sm bg-black text-white/70"
              onClick={(event) => event.stopPropagation()}
            >
              <Film size={32} strokeWidth={1.5} aria-hidden="true" />
            </div>
          )}
          <div
            className="mt-3 max-w-[90vw] text-center text-sm text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="font-medium">{active.caption || active.name}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
