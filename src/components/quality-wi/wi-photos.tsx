"use client";
import { WiImageView } from "./wi-image-view";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { buildPhotoAttachment } from "@/components/mobile-photo-portal/photo-preparation";
import { normalizePhotoAnnotationDocument } from "@/domain/photo-annotations";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import type {
  QualityWi,
  WiEdit,
  WiImage,
  WiStep,
} from "@/domain/quality-wi/schema";
const Viewer = dynamic(
  () =>
    import("@/components/step-photo-viewer").then(
      (module) => module.StepPhotoViewer,
    ),
  { ssr: false },
);
export function WiPhotos({
  document,
  step,
  sequence,
  userId,
  disabled,
  onEdit,
  onBusy,
}: {
  document: QualityWi;
  step: WiStep;
  sequence: number;
  userId: string;
  disabled: boolean;
  onEdit: (edit: WiEdit) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [message, setMessage] = useState("");
  const [view, setView] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const busyRef = useRef(false);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (busyRef.current) {
        busyRef.current = false;
        busyCallback.current(false);
      }
    };
  }, []);
  async function prepare(file: File) {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    busyCallback.current(true);
    setMessage("");
    try {
      const attachment = await buildPhotoAttachment(file);
      if (!active.current) return;
      const id = crypto.randomUUID();
      const image: WiImage = {
        id,
        name: attachment.name,
        width: attachment.width!,
        height: attachment.height!,
        storagePath: `${document.workspaceId}/${document.id}/${step.id}/${id}.jpg`,
      };
      onEdit({
        kind: "image",
        payload: { id: step.id, image, dataUrl: attachment.dataUrl },
      });
    } catch (error) {
      if (active.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to prepare the photo.",
        );
    } finally {
      if (active.current) {
        busyRef.current = false;
        setBusy(false);
        busyCallback.current(false);
      }
    }
  }
  const image = step.image;
  // Viewer recovery keys are account/document/photo-scoped. Do not supply an AWI storage path:
  // the viewer's product-specific refresh must never query step-photos for a Quality asset.
  const photo: StepPhotoAttachment | null = image?.url
    ? {
        id: `quality-wi:${userId}:${document.id}:${image.id}`,
        name: image.name,
        dataUrl: image.url,
        width: image.width,
        height: image.height,
        capturedAt: document.updatedAt,
        annotations: normalizePhotoAnnotationDocument(image.annotations),
      }
    : null;
  return (
    <div
      className="space-y-2"
      onPaste={(event) => {
        if (disabled) return;
        const file = [...event.clipboardData.files].find((item) =>
          item.type.startsWith("image/"),
        );
        if (file) {
          event.preventDefault();
          void prepare(file);
        }
      }}
      tabIndex={disabled ? -1 : 0}
      aria-label={`Step ${sequence} photo area`}
    >
      <div className="flex items-center justify-between">
        <span className="ui-field-label">Image / reference view</span>
        <button
          className="ui-btn-ghost h-8 px-2 text-xs"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={14} /> {busy ? "Preparing…" : "Upload image"}
        </button>
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept="image/*"
        aria-label={`Upload image for step ${sequence}`}
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void prepare(file);
        }}
      />
      {photo ? (
        <div className="relative">
          <button
            className="block w-full overflow-hidden rounded border border-line hover:border-accent"
            onClick={() => setView(true)}
            aria-label={`Open image for step ${sequence}`}
          >
            <WiImageView image={image!} />
          </button>
          {!disabled ? (
            <button
              className="ui-btn-ghost absolute right-2 top-2 h-8 w-8 bg-surface"
              aria-label={`Remove image for step ${sequence}`}
              onClick={() =>
                onEdit({ kind: "image", payload: { id: step.id, image: null } })
              }
            >
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-36 items-center justify-center rounded border border-dashed border-line px-4 text-center text-xs text-ink-tertiary">
          {image
            ? "Image preview is unavailable."
            : "Upload an image, or click here and paste one."}
        </div>
      )}
      {message ? (
        <p className="ui-notice ui-notice-warn text-xs" role="alert">
          {message}
        </p>
      ) : null}
      {view && photo ? (
        <Viewer
          stepSequence={sequence}
          photo={photo}
          photos={[photo]}
          onPhotoChange={() => undefined}
          onClose={() => setView(false)}
          onUpdatePhoto={
            disabled
              ? undefined
              : (_id, patch) => {
                  if (image && patch.annotations)
                    onEdit({
                      kind: "image",
                      payload: {
                        id: step.id,
                        image: { ...image, annotations: patch.annotations },
                      },
                    });
                }
          }
        />
      ) : null}
    </div>
  );
}
