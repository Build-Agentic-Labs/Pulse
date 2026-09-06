"use client";

import { Check, ClipboardPaste, Copy, ImageIcon, Link2, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import {
  getManufacturingStepCheckState,
  serializeManufacturingStepCheckState,
  type ManufacturingStepCheckDefinition,
  type ManufacturingStepCheckState,
} from "@/domain/manufacturing-step-checks";
import { type MasterBom } from "@/domain/master-bom";
import {
  getStepPartMentions,
  numberedStepPartMentions,
  type StepPartMention,
} from "@/domain/step-part-mentions";
import {
  getStepPartReferenceIds,
  getStepPartReferenceQuantity,
  getStepPartReferences,
} from "@/domain/step-part-references";
import { canPasteInto } from "@/domain/step-photo-clipboard";
import { clipboardImageFiles } from "@/domain/clipboard-images";
import { normalizePhotoAnnotationDocument } from "@/domain/photo-annotations";
import { type StepPhotoAttachment } from "@/domain/step-photos";
import type { ManufacturingStep, PartReference, Task } from "@/domain/types";
import { BomPartSearch, type BomPartSelection } from "../bom-part-search";
import { ClearableNumberInput } from "../clearable-number-input";
import { StaticPhotoAnnotation } from "../static-photo-annotation";
import { RecoveringPhoto } from "../recovering-photo";
import { StepPhotoViewer } from "../step-photo-viewer";
import { ThemedSelect } from "../themed-select";
import { useStepPhotoClipboard } from "./step-photo-clipboard-provider";

type StepPartReferenceEditorProps = {
  task: Task;
  step: ManufacturingStep;
  partReferences: PartReference[];
  compact?: boolean;
  masterBom?: MasterBom;
  onAddFromBom: (entry: BomPartSelection) => void;
  onLinkExisting: (partReferenceId: string) => void;
  onQuantityChange: (partReferenceId: string, quantity: number) => void;
  onRemove: (partReferenceId: string) => void;
};

export type InstructionSelectionAnchor = {
  left: number;
  top: number;
  bottom: number;
};

export type InstructionTextSelection = {
  start: number;
  end: number;
  text: string;
  anchor?: InstructionSelectionAnchor;
  mentionId?: string;
  partReferenceId?: string;
};

function instructionSelectionAnchor(textarea: HTMLTextAreaElement, start: number) {
  const textareaRect = textarea.getBoundingClientRect();
  const fallback = {
    left: textareaRect.left + 12,
    top: textareaRect.top + 12,
    bottom: textareaRect.top + 30,
  };

  if (typeof document === "undefined") {
    return fallback;
  }

  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const copiedProperties = [
    "boxSizing",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "textAlign",
    "textIndent",
    "textTransform",
    "wordSpacing",
  ] as const;

  copiedProperties.forEach((property) => {
    mirror.style[property] = computed[property];
  });
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    left: `${textareaRect.left}px`,
    top: `${textareaRect.top - textarea.scrollTop}px`,
    width: `${textareaRect.width}px`,
    minHeight: `${textareaRect.height}px`,
  });
  mirror.textContent = textarea.value.slice(0, start);
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();

  if (!markerRect.width && !markerRect.height) {
    return fallback;
  }
  return {
    left: markerRect.left - textarea.scrollLeft,
    top: markerRect.top,
    bottom: markerRect.bottom,
  };
}

export function instructionTextSelectionFromTextarea(
  textarea: HTMLTextAreaElement,
  mentions: StepPartMention[] = [],
): InstructionTextSelection | undefined {
  const rawStart = textarea.selectionStart;
  const rawEnd = textarea.selectionEnd;
  const selectedMention = rawStart === rawEnd
    ? mentions.find((mention) => rawStart >= mention.start && rawStart < mention.end)
    : undefined;
  if (selectedMention) {
    return {
      start: selectedMention.start,
      end: selectedMention.end,
      text: selectedMention.text,
      anchor: instructionSelectionAnchor(textarea, selectedMention.start),
      mentionId: selectedMention.id,
      partReferenceId: selectedMention.partReferenceId,
    };
  }
  const rawText = textarea.value.slice(rawStart, rawEnd);
  const leadingWhitespace = rawText.length - rawText.trimStart().length;
  const trailingWhitespace = rawText.length - rawText.trimEnd().length;
  const start = rawStart + leadingWhitespace;
  const end = rawEnd - trailingWhitespace;
  const text = textarea.value.slice(start, end);

  return text
    ? { start, end, text, anchor: instructionSelectionAnchor(textarea, start) }
    : undefined;
}

type StepPartMentionEditorProps = {
  task: Task;
  step: ManufacturingStep;
  selection?: InstructionTextSelection;
  masterBom?: MasterBom;
  compact?: boolean;
  onLink: (entry: BomPartSelection) => void;
  onCancelSelection: () => void;
  onRemoveMention: (mentionId: string) => void;
};

type LinkedInstructionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  task: Task;
  step: ManufacturingStep;
  value: string;
  onMentionClick?: (mention: StepPartMention, anchor: InstructionSelectionAnchor) => void;
};

type StepPhotoAttachmentEditorProps = {
  taskId: string;
  step: ManufacturingStep;
  photos: StepPhotoAttachment[];
  compact?: boolean;
  isUploading?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRequestRemove: (photo: StepPhotoAttachment) => void;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
};

function StepPhotoThumbnail({
  photo,
  stepSequence,
  compact,
}: {
  photo: StepPhotoAttachment;
  stepSequence: number;
  compact: boolean;
}) {
  const markerId = `step-photo-thumbnail-arrow-${useId().replace(/:/g, "")}`;
  const annotations = normalizePhotoAnnotationDocument(photo.annotations).items;
  const width = photo.width ?? 1280;
  const height = photo.height ?? 960;
  const frameHeight = compact ? 112 : 160;
  const frameWidth = Math.round(
    Math.min(compact ? 128 : 216, Math.max(compact ? 72 : 92, (frameHeight * width) / height)),
  );

  return (
    <svg
      className={`${compact ? "h-28" : "h-40"} block rounded border border-line bg-surface-muted transition group-hover:border-accent`}
      style={{ width: frameWidth }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Step ${stepSequence} photo`}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
        </marker>
      </defs>
      <RecoveringPhoto svg
        url={photo.thumbnailUrl ?? photo.dataUrl}
        storagePath={photo.thumbnailUrl ? (photo.thumbnailStoragePath ?? photo.storagePath) : photo.storagePath}
        alt={`Step ${stepSequence} photo`}
        width={width} height={height}
      />
      {annotations.map((annotation) => (
        <StaticPhotoAnnotation
          key={annotation.id}
          annotation={annotation}
          width={width}
          height={height}
          markerId={markerId}
          targetSize={compact ? 150 : 220}
          calloutClassName="step-photo-thumbnail-callout"
        />
      ))}
    </svg>
  );
}

/**
 * Wraps one thumbnail's hover/focus registration and, critically, clears it on unmount --
 * pointerleave/blur never fire when the thumbnail disappears out from under the pointer
 * (photo removed, list re-rendered, drawer closed), which otherwise leaves a stale active
 * photo that a later Ctrl+C would copy from the wrong (or a gone) photo.
 */
function StepPhotoThumbnailSlot({
  photo,
  taskId,
  stepId,
  children,
}: {
  photo: StepPhotoAttachment;
  taskId: string;
  stepId: string;
  children: ReactNode;
}) {
  const { setActivePhoto, clearActivePhoto } = useStepPhotoClipboard();

  useEffect(() => () => clearActivePhoto(photo.id), [photo.id, clearActivePhoto]);

  return (
    <div
      className="shrink-0"
      onPointerEnter={() => setActivePhoto({ photo, taskId, stepId })}
      onPointerLeave={() => clearActivePhoto(photo.id)}
      onFocus={() => setActivePhoto({ photo, taskId, stepId })}
      onBlur={() => clearActivePhoto(photo.id)}
    >
      {children}
    </div>
  );
}

export function StepPhotoAttachmentEditor({
  taskId,
  step,
  photos,
  compact = false,
  isUploading = false,
  onFilesSelected,
  onRequestRemove,
  onUpdatePhoto,
}: StepPhotoAttachmentEditorProps) {
  const [previewPhoto, setPreviewPhoto] = useState<StepPhotoAttachment | null>(null);
  const { entry, putOnClipboard, pasteInto, isPasting, setActiveStep, clearActiveStep } = useStepPhotoClipboard();
  const photoAreaRef = useRef<HTMLDivElement>(null);
  const [pasteHint, setPasteHint] = useState("");
  const [readingClipboard, setReadingClipboard] = useState(false);
  const clipboardReadRef = useRef(0);
  useEffect(() => () => { clipboardReadRef.current++; }, [taskId, step.id]);
  const canPasteCopied = Boolean(entry && canPasteInto(entry, taskId, step.id));
  const pasteBusy = isUploading || isPasting || readingClipboard;

  async function pasteCopiedPhoto() {
    if (pasteBusy) return;
    setPasteHint("");
    try {
      if (await pasteInto({taskId, stepId:step.id})) setPasteHint(`Photo pasted into Step ${step.sequence}.`);
    } catch {
      setPasteHint("Photo could not be pasted. Try again.");
    }
  }

  async function pasteSystemImage() {
    if (pasteBusy) return;
    setPasteHint("");
    const request = ++clipboardReadRef.current;
    setReadingClipboard(true);
    photoAreaRef.current?.focus();
    try {
      if (!navigator.clipboard?.read) throw new Error("Clipboard read unavailable");
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find(type => type.startsWith("image/"));
        if (type) files.push(new File([await item.getType(type)], `Pasted image.${type.split("/")[1]}`, {type}));
      }
      if (request !== clipboardReadRef.current) return;
      if (!files.length) {
        setPasteHint("No image found. Copy an image or screenshot first, or use Upload.");
        return;
      }
      onFilesSelected(files);
    } catch {
      if (request !== clipboardReadRef.current) return;
      setPasteHint("Press Cmd/Ctrl+V in this photo area to paste, or use Upload.");
    } finally {
      if (request === clipboardReadRef.current) setReadingClipboard(false);
    }
  }
  const [copyFeedback, setCopyFeedback] = useState<{ photoId: string; sequence: number } | null>(null);
  const copySequence = useRef(0);

  useEffect(() => {
    if (entry?.mode !== "copy" || entry.sourceTaskId !== taskId || entry.sourceStepId !== step.id) {
      setCopyFeedback(null);
      return;
    }
    setCopyFeedback({ photoId: entry.photo.id, sequence: ++copySequence.current });
    const timer = window.setTimeout(() => setCopyFeedback(null), 1600);
    return () => window.clearTimeout(timer);
  }, [entry, taskId, step.id]);


  // pointerleave/blur don't fire when this editor unmounts while it is the active paste
  // target (closing the drawer with Esc, switching task, collapsing the section) -- without
  // this, a later Ctrl+V with nothing hovered would land on a step no longer on screen.
  useEffect(() => () => clearActiveStep(step.id), [step.id, clearActiveStep]);

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, [contenteditable='true']")) return;
    // Claim this event even while busy so it cannot paste into a different hovered step.
    event.preventDefault();
    if (pasteBusy) return;
    const files = clipboardImageFiles(event.clipboardData);
    if (files.length) {
      setPasteHint("");
      onFilesSelected(files);
    } else if (canPasteCopied) {
      void pasteCopiedPhoto();
    } else {
      setPasteHint("Copy an image or a photo from another step first, then paste here.");
    }
  }

  return (
    <div
      ref={photoAreaRef}
      className="space-y-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      role="region"
      aria-label={`Step ${step.sequence} photos. Paste an image, press Ctrl/Cmd+V to paste a copied photo, or use Upload.`}
      tabIndex={isUploading ? -1 : 0}
      onPaste={handlePaste}
      onPointerEnter={() => setActiveStep({ taskId, stepId: step.id })}
      onPointerLeave={() => clearActiveStep(step.id)}
      onFocus={() => setActiveStep({ taskId, stepId: step.id })}
      onBlur={() => clearActiveStep(step.id)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="ui-field-label mb-0 flex items-center gap-1">
          Photos
          {photos.length > 0 ? <span className="text-ink-secondary/70">({photos.length})</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2" disabled={pasteBusy}
            aria-label={`Paste photo into step ${step.sequence}`}
            onClick={() => void (canPasteCopied ? pasteCopiedPhoto() : pasteSystemImage())}>
            <ClipboardPaste size={14} />{isPasting || readingClipboard ? "Pasting…" : "Paste photo"}
          </button>
          <label
            className={`ui-btn-ghost cursor-pointer ${compact ? "h-8 gap-1.5 px-2" : "h-10 gap-2"} ${
              isUploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <ImageIcon size={compact ? 14 : 16} />
            {isUploading ? "Uploading" : "Upload"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (files.length > 0) {
                  onFilesSelected(files);
                }
              }}
            />
          </label>
        </div>
      </div>

      {photos.length > 0 ? (
        <div className="step-photo-strip flex max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-2">
          {photos.map((photo) => (
            <StepPhotoThumbnailSlot key={photo.id} photo={photo} taskId={taskId} stepId={step.id}>
              <div
                className={`group relative transition ${
                  entry?.mode === "cut" && entry.photo.id === photo.id ? "opacity-40" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(photo)}
                  className="block rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label={`Open step ${step.sequence} photo ${photo.name}`}
                  title="Open photo"
                >
                  <StepPhotoThumbnail photo={photo} stepSequence={step.sequence} compact={compact} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    putOnClipboard(photo, taskId, step.id, "copy");
                  }}
                  className={`absolute left-1.5 top-1.5 flex h-6 items-center justify-center rounded text-white transition focus:opacity-100 focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100 group-focus-within:opacity-100 ${
                    copyFeedback?.photoId === photo.id
                      ? "step-photo-copy-confirmed px-2 opacity-100"
                      : "w-6 bg-black/55 opacity-0 hover:bg-black/75"
                  }` }
                  aria-label={`Copy photo from step ${step.sequence}`}
                  title="Copy photo (Ctrl/Cmd+C) — then Ctrl/Cmd+V on another step"
                >
                  {copyFeedback?.photoId === photo.id ? (
                    <span key={copyFeedback.sequence} className="step-photo-copy-pop flex items-center gap-1" role="status">
                      <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                      <span className="text-[10px] font-semibold">Copied</span>
                    </span>
                  ) : <Copy size={11} />}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestRemove(photo);
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-black/55 text-white opacity-0 transition hover:bg-black/75 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={`Remove photo from step ${step.sequence}`}
                  title="Remove photo"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </StepPhotoThumbnailSlot>
          ))}
        </div>
      ) : (
        <button type="button" disabled={pasteBusy}
          className="w-full rounded border border-dashed border-line px-3 py-4 text-left text-xs text-ink-secondary transition hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => {
            photoAreaRef.current?.focus();
            setPasteHint(`Ready to paste into Step ${step.sequence}. Press Cmd/Ctrl+V, or click Paste photo above.`);
          }}>
          No photos yet. Click here, then press Cmd/Ctrl+V to paste an image.
        </button>
      )}
      <p className={pasteHint ? "text-[11px] text-ink-secondary" : "sr-only"} role="status" aria-live="polite">{pasteHint}</p>
      {previewPhoto ? (
        <StepPhotoViewer
          taskId={taskId}
          stepSequence={step.sequence}
          photo={photos.find((candidate) => candidate.id === previewPhoto.id) ?? previewPhoto}
          photos={photos}
          onClose={() => setPreviewPhoto(null)}
          onPhotoChange={setPreviewPhoto}
          onUpdatePhoto={onUpdatePhoto}
        />
      ) : null}
    </div>
  );
}

export function StepPartReferenceEditor({
  task,
  step,
  partReferences,
  compact = false,
  masterBom,
  onAddFromBom,
  onLinkExisting,
  onQuantityChange,
  onRemove,
}: StepPartReferenceEditorProps) {
  const hasMasterBom = Boolean(masterBom && masterBom.rows.length > 0);
  const linkedPartIds = new Set(getStepPartReferenceIds(task, step.id));
  const linkedParts = getStepPartReferences(task, step.id);
  const availableParts = partReferences.filter((part) => part.partNumber.trim() && !linkedPartIds.has(part.id));

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-1">
          <span className="ui-field-label mb-0">Parts</span>
          {hasMasterBom && masterBom ? (
            <BomPartSearch masterBom={masterBom} onSelect={onAddFromBom} compact />
          ) : (
            <span className="text-[10px] font-semibold text-ink-tertiary">Upload a master BOM in Setup to add parts.</span>
          )}
        </div>

        {availableParts.length > 0 ? (
          <div className="pl-[42px]">
            <ThemedSelect
              aria-label={`Link existing part to step ${step.sequence}`}
              value=""
              className="w-full"
              triggerClassName="h-9 px-2 text-xs"
              options={[
                { value: "", label: "Link existing part" },
                ...availableParts.map((part) => ({
                  value: part.id,
                  label: `${part.partNumber}${part.description ? ` - ${part.description}` : ""}`,
                })),
              ]}
              onChange={(value) => {
                if (value) {
                  onLinkExisting(value);
                }
              }}
            />
          </div>
        ) : null}

        {linkedParts.length > 0 ? (
          <div className="space-y-1.5 pl-[42px]">
            {linkedParts.map((part) => {
              const quantity = getStepPartReferenceQuantity(task, step.id, part.id);
              return (
                <div
                  key={part.id}
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem_1.5rem] items-start gap-2 rounded border border-line px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] font-bold text-ink">{part.partNumber}</div>
                    <div className="whitespace-normal break-words text-[10px] leading-4 text-ink-secondary">
                      {part.description || "No description"}
                    </div>
                  </div>
                  <label className="min-w-0">
                    <span className="ui-field-label mb-0 block text-[9px]">Qty</span>
                    <ClearableNumberInput
                      aria-label={`Quantity for ${part.partNumber} on step ${step.sequence}`}
                      className="h-6 w-full border-b border-line bg-transparent text-right text-xs font-semibold tabular-nums text-ink outline-none focus:border-accent"
                      value={quantity}
                      fallbackValue={quantity}
                      min={0.000001}
                      precision={6}
                      onValueChange={(value) => onQuantityChange(part.id, value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onRemove(part.id)}
                    className="mt-1 flex h-5 w-5 items-center justify-center text-ink-secondary/70 hover:text-danger"
                    aria-label={`Remove ${part.partNumber} from step ${step.sequence}`}
                    title={`Remove ${part.partNumber}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-procedure-step-detail">
      <span className="ui-field-label mb-0 block">Parts</span>
      {hasMasterBom && masterBom ? (
        <div className="mb-2">
          <BomPartSearch masterBom={masterBom} onSelect={onAddFromBom} />
        </div>
      ) : (
        <div className="mb-2 text-xs font-semibold text-ink-tertiary">Upload a master BOM in Setup to add parts.</div>
      )}
      {availableParts.length > 0 ? (
        <div className="flex justify-end">
          <ThemedSelect
            aria-label={`Link existing part to step ${step.sequence}`}
            value=""
            className="min-w-36"
            triggerClassName="h-8 rounded-none border-0 border-b bg-transparent px-0 text-xs"
            options={[
              { value: "", label: "Link existing part" },
              ...availableParts.map((part) => ({
                value: part.id,
                label: `${part.partNumber}${part.description ? ` - ${part.description}` : ""}`,
              })),
            ]}
            onChange={(value) => {
              if (value) {
                onLinkExisting(value);
              }
            }}
          />
        </div>
      ) : null}

      {linkedParts.length > 0 ? (
        <div className="mt-2 overflow-x-auto rounded border border-line">
          <table
            className="w-full min-w-[34rem] border-collapse text-xs"
            aria-label={`Parts allocated to step ${step.sequence}`}
          >
            <thead className="bg-surface-raised">
              <tr>
                <th
                  scope="col"
                  className="ui-mono-label w-[12rem] whitespace-nowrap border-b border-line px-3 py-2 text-left text-ink-secondary"
                >
                  Part number
                </th>
                <th
                  scope="col"
                  className="ui-mono-label border-b border-line px-3 py-2 text-left text-ink-secondary"
                >
                  Description
                </th>
                <th
                  scope="col"
                  className="ui-mono-label w-20 whitespace-nowrap border-b border-line px-3 py-2 text-right text-ink-secondary"
                >
                  Qty
                </th>
                <th scope="col" className="w-8 border-b border-line px-1 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linkedParts.map((part) => {
                const quantity = getStepPartReferenceQuantity(task, step.id, part.id);
                return (
                  <tr key={part.id} className="border-b border-line/60 last:border-b-0 hover:bg-surface-raised/50">
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono font-semibold text-ink">
                      {part.partNumber}
                    </td>
                    <td className="whitespace-normal break-words px-3 py-1.5 align-middle leading-4 text-ink-secondary">
                      {part.description || "No description"}
                    </td>
                    <td className="px-3 py-1 align-middle">
                      <ClearableNumberInput
                        aria-label={`Quantity for ${part.partNumber} on step ${step.sequence}`}
                        className="h-6 w-full border-b border-line bg-transparent text-right text-xs font-semibold tabular-nums text-ink outline-none focus:border-accent"
                        value={quantity}
                        fallbackValue={quantity}
                        min={0.000001}
                        precision={6}
                        onValueChange={(value) => onQuantityChange(part.id, value)}
                      />
                    </td>
                    <td className="px-1 py-1 align-middle">
                      <button
                        type="button"
                        onClick={() => onRemove(part.id)}
                        className="flex h-6 w-6 items-center justify-center text-ink-tertiary hover:text-danger"
                        aria-label={`Remove ${part.partNumber} from step ${step.sequence}`}
                        title={`Remove ${part.partNumber}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function LinkedInstructionTextarea({
  task,
  step,
  value,
  className = "",
  onScroll,
  onMentionClick,
  ...textareaProps
}: LinkedInstructionTextareaProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [hoveredPart, setHoveredPart] = useState<{
    partNumber: string;
    description: string;
    rect: DOMRect;
  }>();
  const mentions = numberedStepPartMentions(task, step.id).filter(
    (mention) => value.slice(mention.start, mention.end) === mention.text,
  );
  if (mentions.length === 0) {
    return <textarea {...textareaProps} className={className} value={value} onScroll={onScroll} />;
  }

  const partById = new Map((task.partReferences ?? []).map((part) => [part.id, part]));
  const content: ReactNode[] = [];
  let cursor = 0;
  mentions.forEach((mention) => {
    content.push(value.slice(cursor, mention.start));
    const part = partById.get(mention.partReferenceId);
    content.push(
      <span
        key={mention.id}
        className="ui-linked-instruction-mention"
        data-part-mention-id={mention.id}
        onMouseEnter={(event) => {
          if (!part) {
            return;
          }
          setHoveredPart({
            partNumber: part.partNumber,
            description: part.description ?? "",
            rect: event.currentTarget.getBoundingClientRect(),
          });
        }}
        onMouseLeave={() => setHoveredPart(undefined)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHoveredPart(undefined);
          onMentionClick?.(mention, { left: rect.left, top: rect.top, bottom: rect.bottom });
        }}
      >
        {mention.text}
      </span>,
    );
    cursor = mention.end;
  });
  content.push(value.slice(cursor));

  const hoverTooltip = hoveredPart && typeof document !== "undefined"
    ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[70] w-64 rounded border border-line bg-surface px-2 py-1.5 shadow-lg"
          style={{
            left: Math.max(8, Math.min(hoveredPart.rect.left, window.innerWidth - 264)),
            ...(hoveredPart.rect.top > 72
              ? { bottom: window.innerHeight - hoveredPart.rect.top + 6 }
              : { top: hoveredPart.rect.bottom + 6 }),
          }}
        >
          <div className="font-mono text-[10px] font-bold text-ink">{hoveredPart.partNumber}</div>
          <div className="mt-0.5 whitespace-normal break-words text-[10px] leading-4 text-ink-secondary">
            {hoveredPart.description || "No description"}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="ui-linked-instruction-editor">
        <div ref={backdropRef} aria-hidden="true" className={`${className} ui-linked-instruction-backdrop`}>
          {content}
        </div>
        <textarea
          {...textareaProps}
          className={`${className} ui-linked-instruction-input`}
          value={value}
          onScroll={(event) => {
            if (backdropRef.current) {
              backdropRef.current.scrollTop = event.currentTarget.scrollTop;
              backdropRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
            onScroll?.(event);
          }}
        />
      </div>
      {hoverTooltip}
    </>
  );
}

export function StepPartMentionEditor({
  task,
  step,
  selection,
  masterBom,
  compact = false,
  onLink,
  onCancelSelection,
  onRemoveMention,
}: StepPartMentionEditorProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [selectedPart, setSelectedPart] = useState<BomPartSelection>();
  const [quantity, setQuantity] = useState(1);
  const selectedMention = selection?.mentionId
    ? getStepPartMentions(task, step.id).find((mention) => mention.id === selection.mentionId)
    : undefined;

  const dismissSelection = useCallback(() => {
    if (selection) {
      document.querySelectorAll<HTMLTextAreaElement>(`textarea[aria-label="Step ${step.sequence} instruction"]`)
        .forEach((textarea) => {
          if (textarea.value.slice(selection.start, selection.end) === selection.text) {
            textarea.setSelectionRange(selection.end, selection.end);
          }
        });
    }
    onCancelSelection();
  }, [onCancelSelection, selection, step.sequence]);

  useEffect(() => {
    const existingPart = selection?.partReferenceId
      ? (task.partReferences ?? []).find((part) => part.id === selection.partReferenceId)
      : undefined;
    if (existingPart) {
      const existingQuantity = getStepPartReferenceQuantity(task, step.id, existingPart.id);
      setSelectedPart({
        partNumber: existingPart.partNumber,
        description: existingPart.description ?? "",
        quantity: existingQuantity,
      });
      setQuantity(existingQuantity);
    } else {
      setSelectedPart(undefined);
      setQuantity(1);
    }
  }, [selection?.end, selection?.partReferenceId, selection?.start, step.id, task]);

  useEffect(() => {
    if (!selection) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        dismissSelection();
        return;
      }
      if (
        popupRef.current?.contains(target) ||
        target.closest('[data-bom-part-search-dropdown="true"]')
      ) {
        return;
      }
      dismissSelection();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismissSelection();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dismissSelection, selection]);

  if (!selection || typeof document === "undefined") {
    return null;
  }

  const desiredPopupWidth = compact ? 286 : 320;
  const viewportWidth = typeof window === "undefined" ? desiredPopupWidth + 16 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const popupWidth = Math.min(desiredPopupWidth, Math.max(240, viewportWidth - 16));
  const anchor = selection.anchor ?? { left: 16, top: 16, bottom: 34 };
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - popupWidth - 8));
  const openAbove = viewportHeight - anchor.bottom < 300 && anchor.top > 300;

  return createPortal(
    <div
      ref={popupRef}
      role="dialog"
      aria-label={`Link selected text on step ${step.sequence}`}
      className="fixed z-50 rounded-md border border-line bg-surface p-2 shadow-xl"
      style={{
        left,
        width: popupWidth,
        ...(openAbove
          ? { bottom: Math.max(8, viewportHeight - anchor.top + 8) }
          : { top: Math.max(8, anchor.bottom + 8) }),
      }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-accent">
            <Link2 size={11} strokeWidth={2} />
            {selectedMention ? "Edit BOM link" : "Link text to BOM part"}
          </div>
          <div className="mt-0.5 truncate text-[11px] font-semibold text-ink" title={selection.text}>
            “{selection.text}”
          </div>
        </div>
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-secondary hover:text-ink"
          onClick={dismissSelection}
          aria-label={`Close part link popup for step ${step.sequence}`}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      {masterBom && masterBom.rows.length > 0 ? (
        <BomPartSearch
          masterBom={masterBom}
          compact
          onSelect={(entry) => {
            setSelectedPart(entry);
            setQuantity(entry.quantity);
          }}
        />
      ) : (
        <div className="text-[10px] font-semibold text-ink-tertiary">
          Upload a master BOM in Setup before linking text.
        </div>
      )}

      {selectedPart ? (
        <div className="mt-1.5 rounded border border-line bg-surface-raised/60 p-1.5">
          <div className="font-mono text-[10px] font-bold text-ink">{selectedPart.partNumber}</div>
          <div className="mt-0.5 line-clamp-2 whitespace-normal break-words text-[9px] leading-3.5 text-ink-secondary">
            {selectedPart.description || "No description"}
          </div>
          <label className="mt-1.5 grid grid-cols-[1fr_4.5rem] items-center gap-2">
            <span className="text-[9px] font-semibold text-ink-secondary">Step quantity</span>
            <ClearableNumberInput
              aria-label={`Quantity for linked part on step ${step.sequence}`}
              className="h-6 w-full border-b border-line bg-transparent text-right text-[11px] font-semibold tabular-nums text-ink outline-none focus:border-accent"
              value={quantity}
              fallbackValue={quantity}
              min={0.000001}
              precision={6}
              onValueChange={setQuantity}
            />
          </label>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div>
          {selectedMention ? (
            <button
              type="button"
              className="ui-btn-ghost h-6 px-1.5 text-[9px] text-danger hover:text-danger"
              onClick={() => {
                onRemoveMention(selectedMention.id);
                dismissSelection();
              }}
            >
              Remove link
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="ui-btn-ghost h-6 px-1.5 text-[9px]" onClick={dismissSelection}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn-primary h-6 px-2 text-[9px]"
            disabled={!selectedPart}
            onClick={() => selectedPart && onLink({ ...selectedPart, quantity })}
          >
            {selectedMention ? "Update link" : "Link"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ProcedureStepChecksEditor({
  ariaLabel,
  definitions,
  qualityCheck,
  compact = false,
  onChange,
}: {
  ariaLabel: string;
  definitions: ManufacturingStepCheckDefinition[];
  qualityCheck?: string;
  compact?: boolean;
  onChange: (qualityCheck: string) => void;
}) {
  const checkState = getManufacturingStepCheckState(qualityCheck, definitions);
  const enabledDefinitions = definitions.filter((definition) => definition.enabled);

  function commit(nextState: ManufacturingStepCheckState) {
    onChange(serializeManufacturingStepCheckState(nextState, definitions));
  }

  function toggleCheck(key: string, checked: boolean) {
    const selected = new Set(checkState.selected);
    const values = { ...checkState.values };

    if (checked) {
      selected.add(key);
    } else {
      selected.delete(key);
    }

    commit({ selected, values });
  }

  function updateCheckValue(definition: ManufacturingStepCheckDefinition, patch: Partial<{ value: number; unit: string }>) {
    const selected = new Set(checkState.selected);
    selected.add(definition.key);
    const currentValue = checkState.values[definition.key] ?? {};
    commit({
      selected,
      values: {
        ...checkState.values,
        [definition.key]: {
          ...currentValue,
          ...patch,
        },
      },
    });
  }

  if (enabledDefinitions.length === 0) {
    return <div className="text-xs text-ink-secondary">No checks configured for this workspace.</div>;
  }

  return (
    <div
      className={compact ? "grid grid-cols-2 gap-1" : "ui-procedure-step-checks"}
      role="group"
      aria-label={ariaLabel}
    >
      {enabledDefinitions.map((definition) => {
        const checked = checkState.selected.has(definition.key);
        const checkValue = checkState.values[definition.key] ?? {};

        if (definition.inputType === "number") {
          const unitOptions = definition.unitOptions?.length ? definition.unitOptions : ["Nm", "ft-lb"];
          const activeUnit = checkValue.unit ?? definition.defaultUnit ?? unitOptions[0];

          return (
            <div
              key={definition.key}
              className={`ui-procedure-step-check ${checked ? "ui-procedure-step-check-active" : ""} ${
                compact ? "min-h-8 flex-wrap justify-start gap-1 px-1.5 py-1" : "gap-2"
              }`}
            >
              <label className="inline-flex min-w-0 items-center gap-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleCheck(definition.key, event.target.checked)}
                />
                <span className="truncate">{definition.label}</span>
              </label>
              {checked ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <ClearableNumberInput
                    aria-label={`${definition.label} value`}
                    className="number-input h-7 w-16 rounded border border-line bg-surface px-1.5 text-right text-xs outline-none"
                    value={checkValue.value ?? 0}
                    min={0}
                    fallbackValue={checkValue.value ?? 0}
                    precision={2}
                    onValueChange={(value) => updateCheckValue(definition, { value })}
                  />
                  <ThemedSelect
                    aria-label={`${definition.label} unit`}
                    className="w-20"
                    triggerClassName="h-7 px-1.5 text-[10px]"
                    value={activeUnit}
                    options={unitOptions.map((unit) => ({ value: unit, label: unit }))}
                    onChange={(unit) => updateCheckValue(definition, { unit })}
                  />
                </span>
              ) : null}
            </div>
          );
        }

        return (
          <label
            key={definition.key}
            className={`ui-procedure-step-check ${checked ? "ui-procedure-step-check-active" : ""}`}
            title={definition.label}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => toggleCheck(definition.key, event.target.checked)}
            />
            <span className="truncate">{definition.label}</span>
          </label>
        );
      })}
    </div>
  );
}
