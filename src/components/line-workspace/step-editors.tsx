"use client";

import { ImageIcon, Trash2 } from "lucide-react";
import { useId, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import {
  getManufacturingStepCheckState,
  serializeManufacturingStepCheckState,
  type ManufacturingStepCheckDefinition,
  type ManufacturingStepCheckState,
} from "@/domain/manufacturing-step-checks";
import { type MasterBom } from "@/domain/master-bom";
import { getStepPartReferenceIds, getStepPartReferences } from "@/domain/step-part-references";
import { normalizePhotoAnnotationDocument } from "@/domain/photo-annotations";
import { type StepPhotoAttachment } from "@/domain/step-photos";
import type { ManufacturingStep, PartReference, Task } from "@/domain/types";
import { BomPartSearch, type BomPartSelection } from "../bom-part-search";
import { ClearableNumberInput } from "../clearable-number-input";
import { StaticPhotoAnnotation } from "../static-photo-annotation";
import { StepPhotoViewer } from "../step-photo-viewer";
import { ThemedSelect } from "../themed-select";

type StepPartReferenceEditorProps = {
  task: Task;
  step: ManufacturingStep;
  partReferences: PartReference[];
  draftValue: string;
  compact?: boolean;
  masterBom?: MasterBom;
  onDraftChange: (value: string) => void;
  onAddDraft: () => void;
  onAddFromBom: (entry: BomPartSelection) => void;
  onLinkExisting: (partReferenceId: string) => void;
  onRemove: (partReferenceId: string) => void;
};

type StepPhotoAttachmentEditorProps = {
  step: ManufacturingStep;
  photos: StepPhotoAttachment[];
  compact?: boolean;
  isUploading?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRequestRemove: (photo: StepPhotoAttachment) => void;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
};

function clipboardImageFiles(event: ReactClipboardEvent<HTMLDivElement>) {
  const itemFiles = Array.from(event.clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(event.clipboardData.files);
  return candidates.filter((file) => file.type.startsWith("image/"));
}

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
      <image
        href={photo.thumbnailUrl ?? photo.dataUrl}
        width={width}
        height={height}
        preserveAspectRatio="none"
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

export function StepPhotoAttachmentEditor({
  step,
  photos,
  compact = false,
  isUploading = false,
  onFilesSelected,
  onRequestRemove,
  onUpdatePhoto,
}: StepPhotoAttachmentEditorProps) {
  const [previewPhoto, setPreviewPhoto] = useState<StepPhotoAttachment | null>(null);

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (isUploading) {
      return;
    }

    const files = clipboardImageFiles(event);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    onFilesSelected(files);
  }

  return (
    <div
      className="space-y-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      role="region"
      aria-label={`Step ${step.sequence} photos. Paste an image or use Upload.`}
      tabIndex={isUploading ? -1 : 0}
      onPaste={handlePaste}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="ui-field-label mb-0 flex items-center gap-1">
          Photos
          {photos.length > 0 ? <span className="text-ink-secondary/70">({photos.length})</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-ink-tertiary">Paste image</span>
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
            <div key={photo.id} className="shrink-0">
              <div className="group relative">
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
                    onRequestRemove(photo);
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-surface/90 text-ink-secondary opacity-0 transition hover:text-danger focus:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={`Remove photo from step ${step.sequence}`}
                  title="Remove photo"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-dashed border-line pt-2 text-xs font-semibold text-ink-secondary">
          No photos attached yet. Click here and paste an image.
        </div>
      )}
      {previewPhoto ? (
        <StepPhotoViewer
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
  draftValue,
  compact = false,
  masterBom,
  onDraftChange,
  onAddDraft,
  onAddFromBom,
  onLinkExisting,
  onRemove,
}: StepPartReferenceEditorProps) {
  const hasMasterBom = Boolean(masterBom && masterBom.rows.length > 0);
  const linkedPartIds = new Set(getStepPartReferenceIds(task, step.id));
  const linkedParts = getStepPartReferences(task, step.id);
  const availableParts = partReferences.filter((part) => part.partNumber.trim() && !linkedPartIds.has(part.id));
  const gridClass = "grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-1";
  const compactInputClass =
    "h-7 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-accent";
  const compactAddClass = "h-7 text-[10px] ui-mono-label text-ink-secondary hover:text-accent";

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className={gridClass}>
          <span className="ui-field-label mb-0">Parts</span>
          <input
            className={compactInputClass}
            value={draftValue}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddDraft();
              }
            }}
            placeholder="Part number"
          />
          <button type="button" onClick={onAddDraft} className={compactAddClass}>
            Add
          </button>
        </div>

        {hasMasterBom && masterBom ? (
          <div className="pl-[42px]">
            <BomPartSearch masterBom={masterBom} onSelect={onAddFromBom} compact />
          </div>
        ) : null}

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
          <div className="flex flex-wrap gap-1.5 pl-[42px]">
            {linkedParts.map((part) => (
              <span key={part.id} className="ui-chip inline-flex min-w-0 items-center gap-1 normal-case tracking-normal">
                <span className="max-w-[220px] truncate" title={part.description || part.partNumber}>
                  {part.partNumber}
                  {part.quantity ? ` x${part.quantity}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(part.id)}
                  className="text-ink-secondary/70 hover:text-danger"
                  aria-label={`Remove ${part.partNumber} from step ${step.sequence}`}
                  title={`Remove ${part.partNumber}`}
                >
                  <Trash2 size={10} />
                </button>
              </span>
            ))}
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
      ) : null}
      <div className="ui-procedure-step-add-row">
        <input
          className="ui-procedure-step-inline-text"
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddDraft();
            }
          }}
          placeholder="Part number"
        />
        <button type="button" onClick={onAddDraft} className="ui-btn-ghost h-8 shrink-0 px-2 text-[10px]">
          Add
        </button>
        {availableParts.length > 0 ? (
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
        ) : null}
      </div>

      {linkedParts.length > 0 ? (
        <div className="ui-procedure-step-chip-list">
          {linkedParts.map((part) => (
            <span key={part.id} className="ui-procedure-tag group">
              <span className="min-w-0 truncate" title={part.description || part.partNumber}>
                {part.partNumber}
                {part.quantity ? ` x${part.quantity}` : ""}
              </span>
              <button
                type="button"
                onClick={() => onRemove(part.id)}
                className="ui-procedure-tag-remove"
                aria-label={`Remove ${part.partNumber} from step ${step.sequence}`}
                title={`Remove ${part.partNumber}`}
              >
                <Trash2 size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
