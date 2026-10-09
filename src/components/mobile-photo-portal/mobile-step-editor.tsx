import { manufacturingStepDisplayName, parseManufacturingStepNameInput } from "./step-labels";
import type { ManufacturingStepCheckDefinition } from "@/domain/manufacturing-step-checks";
import type { Task } from "@/domain/types";
import { Camera, ChevronUp, ImageIcon, Trash2 } from "lucide-react";
import { type FocusEvent, type FormEvent } from "react";
import NextImage from "next/image";

import { type StepPhotoAttachment } from "@/domain/step-photos";

import type { ManufacturingStep } from "@/domain/types";

import { NothingSpinner } from "@/components/nothing-ui";

import { ProcedureStepChecksEditor } from "@/components/line-workspace/step-editors";

export function MobileStepEditor({
  step,
  recentlyCompletedStepId,
  stepCode,
  handleMobileFieldFocus,
  updateManufacturingStep,
  toggleStepExpanded,
  setConfirmDeleteStepId,
  saveState,
  isUploading,
  confirmingDelete,
  deleteManufacturingStep,
  photos,
  handlePhotoFiles,
  selectedTask,
  requestRemovePhoto,
  getStepInstructionRef,
  handleStepInstructionFocus,
  handleStepInstructionInput,
  stepTools,
  renderToolPicker,
  addManufacturingStepToolFromLibrary,
  removeManufacturingStepTool,
  newStepToolNames,
  setNewStepToolNames,
  selectedChecks,
  stepCheckDefinitions,
}: {
  step: ManufacturingStep;
  recentlyCompletedStepId: string | null;
  stepCode: string;
  handleMobileFieldFocus: (
    event: React.FocusEvent<HTMLElement, Element>,
  ) => void;
  updateManufacturingStep: (
    stepId: string,
    patch: Partial<ManufacturingStep>,
  ) => Promise<void>;
  toggleStepExpanded: (stepId: string) => void;
  setConfirmDeleteStepId: React.Dispatch<React.SetStateAction<string | null>>;
  saveState: "loading" | "idle" | "saving" | "saved" | "error";
  isUploading: boolean;
  confirmingDelete: boolean;
  deleteManufacturingStep: (stepId: string) => Promise<void>;
  photos: StepPhotoAttachment[];
  handlePhotoFiles: (stepId: string, files: File[]) => Promise<void>;
  selectedTask: Task;
  requestRemovePhoto: (stepId: string, photo: StepPhotoAttachment) => void;
  getStepInstructionRef: (
    stepId: string,
  ) => (node: HTMLTextAreaElement | null) => void;
  handleStepInstructionFocus: (
    event: React.FocusEvent<HTMLTextAreaElement, Element>,
  ) => void;
  handleStepInstructionInput: (
    event: React.FormEvent<HTMLTextAreaElement>,
  ) => void;
  stepTools: string[];
  renderToolPicker: (
    selectedTools: string[],
    onAddTool: (toolName: string) => void,
    onRemoveTool: (toolName: string) => void,
    manualAdd?:
      | {
          value: string;
          sequence: number;
          onChange: (value: string) => void;
          disabled?: boolean | undefined;
        }
      | undefined,
  ) => React.JSX.Element;
  addManufacturingStepToolFromLibrary: (
    stepId: string,
    toolName: string,
  ) => Promise<void>;
  removeManufacturingStepTool: (
    stepId: string,
    toolToRemove: string,
  ) => Promise<void>;
  newStepToolNames: Record<string, string>;
  setNewStepToolNames: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  selectedChecks: Set<string>;
  stepCheckDefinitions: ManufacturingStepCheckDefinition[];
}) {
  return (
    <article
      key={step.id}
      className={`overflow-hidden ui-panel ${
        recentlyCompletedStepId === step.id
          ? "ui-photo-mobile-step-just-saved"
          : ""
      }`}
    >
      <div className="ui-photo-mobile-step-editor min-w-0 px-3 py-3">
        <div className="ui-photo-mobile-step-header">
          <div className="min-w-0 flex-1">
            <div
              className="ui-photo-mobile-step-code"
              title={stepCode || `Step ${step.sequence}`}
            >
              {stepCode || `Step ${step.sequence}`}
            </div>
            <div className="ui-photo-mobile-step-header-title">
              <input
                key={`${step.id}:${step.name ?? ""}`}
                aria-label={`Step ${step.sequence} name`}
                className="ui-photo-mobile-step-name-inline"
                defaultValue={manufacturingStepDisplayName(step)}
                onFocus={handleMobileFieldFocus}
                onBlur={(event) => {
                  const name = parseManufacturingStepNameInput(
                    event.currentTarget.value,
                    step.sequence,
                  );
                  event.currentTarget.value = manufacturingStepDisplayName({
                    ...step,
                    name,
                  });

                  if (name !== (step.name ?? "")) {
                    void updateManufacturingStep(step.id, { name });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleStepExpanded(step.id)}
            className="ui-photo-mobile-icon-btn ui-photo-mobile-step-toggle"
            aria-expanded
            aria-label={`Collapse step ${step.sequence}`}
            title={`Collapse step ${step.sequence}`}
          >
            <ChevronUp size={16} />
          </button>
          <div className="ui-photo-mobile-step-header-actions">
            <label className="ui-photo-mobile-step-duration">
              <span className="sr-only">
                Step {step.sequence} duration minutes
              </span>
              <input
                aria-label={`Step ${step.sequence} duration minutes`}
                className="ui-photo-mobile-step-duration-input"
                type="text"
                inputMode="decimal"
                defaultValue={String(step.durationMinutes ?? 0)}
                onFocus={handleMobileFieldFocus}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (!/^\d*\.?\d*$/.test(value)) {
                    event.currentTarget.value = value.replace(/[^\d.]/g, "");
                  }
                }}
                onBlur={(event) => {
                  const durationMinutes = Math.max(
                    Number.parseFloat(event.currentTarget.value) || 0,
                    0,
                  );
                  event.currentTarget.value = String(durationMinutes);
                  if (durationMinutes !== (step.durationMinutes ?? 0)) {
                    void updateManufacturingStep(step.id, { durationMinutes });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
              <span className="ui-photo-mobile-step-duration-suffix">min</span>
            </label>
            <button
              type="button"
              onClick={() => setConfirmDeleteStepId(step.id)}
              disabled={saveState === "saving" || isUploading}
              className="ui-photo-mobile-icon-btn ui-photo-mobile-icon-btn-danger disabled:opacity-40"
              aria-label={`Delete step ${step.sequence}`}
              title={`Delete step ${step.sequence}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {confirmingDelete ? (
          <div className="mt-2 rounded border border-danger/30 bg-danger-muted p-2.5">
            <div className="ui-photo-mobile-caption text-danger">
              Delete step {step.sequence}?
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteStepId(null)}
                className="ui-photo-mobile-btn-secondary h-9"
              >
                Keep step
              </button>
              <button
                type="button"
                onClick={() => void deleteManufacturingStep(step.id)}
                disabled={saveState === "saving" || isUploading}
                className="ui-photo-mobile-btn-danger h-9 disabled:opacity-60"
              >
                Delete step
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="ui-photo-mobile-section">
        <div className="ui-photo-mobile-section-head">
          <div className="ui-mono-label">Photos · {photos.length}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="ui-photo-mobile-btn-accent h-10">
            {isUploading ? <NothingSpinner inline /> : <Camera size={15} />}
            Camera
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void handlePhotoFiles(step.id, files);
              }}
            />
          </label>
          <label className="ui-photo-mobile-btn-secondary h-10">
            {isUploading ? <NothingSpinner inline /> : <ImageIcon size={15} />}
            Upload
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void handlePhotoFiles(step.id, files);
              }}
            />
          </label>
        </div>

        {photos.length > 0 ? (
          <div className="ui-photo-mobile-step-photo-grid">
            {photos.map((photo) => (
              <div key={photo.id} className="ui-photo-mobile-step-photo-card">
                <div
                  className="ui-photo-mobile-step-photo-frame"
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <NextImage
                    src={photo.thumbnailUrl ?? photo.dataUrl}
                    alt={`${selectedTask.name} step ${step.sequence}`}
                    width={480}
                    height={640}
                    unoptimized
                    loading="lazy"
                    className="ui-photo-mobile-step-photo-image"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      requestRemovePhoto(step.id, photo);
                    }}
                    className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center bg-transparent text-danger"
                    aria-label="Remove photo"
                    title="Remove photo"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ui-photo-mobile-empty mt-3 flex items-center gap-2">
            <ImageIcon size={14} />
            No photos attached to this step yet.
          </div>
        )}
      </div>
      <div className="px-3 py-3">
        <label className="block">
          <span className="ui-field-label mb-1">Description</span>
          <textarea
            key={step.id}
            ref={getStepInstructionRef(step.id)}
            aria-label={`Step ${step.sequence} description`}
            className="ui-photo-mobile-textarea min-h-[84px]"
            defaultValue={step.instruction}
            onFocus={handleStepInstructionFocus}
            onInput={handleStepInstructionInput}
            onBlur={(event) => {
              const instruction = event.currentTarget.value;
              if (instruction !== step.instruction) {
                void updateManufacturingStep(step.id, { instruction });
              }
            }}
            placeholder="Describe the manufacturing step"
          />
        </label>
      </div>
      <details className="ui-photo-mobile-section">
        <summary className="ui-photo-mobile-check-summary">
          Tools <span>{stepTools.length} added</span>
        </summary>
        <div className="mt-2">
          {renderToolPicker(
            stepTools,
            (toolName) =>
              void addManufacturingStepToolFromLibrary(step.id, toolName),
            (toolName) => void removeManufacturingStepTool(step.id, toolName),
            {
              value: newStepToolNames[step.id] ?? "",
              sequence: step.sequence,
              onChange: (value) =>
                setNewStepToolNames((current) => ({
                  ...current,
                  [step.id]: value,
                })),
              disabled: saveState === "saving",
            },
          )}
        </div>
      </details>
      <details className="ui-photo-mobile-section ui-photo-mobile-section-compact">
        <summary className="ui-photo-mobile-check-summary">
          Checks <span>{selectedChecks.size} selected</span>
        </summary>
        <div className="ui-photo-mobile-check-editor mt-2">
          <ProcedureStepChecksEditor
            ariaLabel={`Step ${step.sequence} checks`}
            compact
            definitions={stepCheckDefinitions}
            qualityCheck={step.qualityCheck}
            onChange={(qualityCheck) =>
              void updateManufacturingStep(step.id, { qualityCheck })
            }
          />
        </div>
      </details>
    </article>
  );
}
