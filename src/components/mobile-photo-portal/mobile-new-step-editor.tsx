import type { MobileStepDraftSnapshot } from "./editor-types";
import type { CaptureTimerState } from "@/components/mobile-photo-portal/capture-session";
import type { ManufacturingStepCheckDefinition } from "@/domain/manufacturing-step-checks";
import type { Task } from "@/domain/types";
import { Camera, ImageIcon, Plus, Trash2 } from "lucide-react";
import { type FocusEvent } from "react";
import NextImage from "next/image";

import {
  serializeManufacturingStepCheckState,
  type ManufacturingStepCheckValue,
} from "@/domain/manufacturing-step-checks";
import { stepDisplayCode } from "@/domain/nomenclature";
import { type StepPhotoAttachment } from "@/domain/step-photos";

import { NothingSpinner } from "@/components/nothing-ui";

import { ProcedureStepChecksEditor } from "@/components/line-workspace/step-editors";
import { formatElapsedTimer } from "@/components/mobile-photo-portal/capture-session";

export function MobileNewStepEditor({
  newStepFormRef,
  newStepId,
  newStepMotionPhase,
  mobileHeaderHeight,
  selectedTask,
  draftStepSequence,
  newStepName,
  handleMobileFieldFocus,
  setNewStepName,
  scheduleNewStepAutosave,
  closeNewStepForm,
  captureTimer,
  errorMessage,
  saveState,
  writesPending,
  persistNewStepDraft,
  getNewStepDraftSnapshot,
  newStepDraftPhotos,
  newStepPhotoBusyCount,
  handleNewStepPhotoFiles,
  removeNewStepDraftPhoto,
  bindNewStepInstructionRef,
  newStepInstruction,
  resizeTextareaToContent,
  setNewStepInstruction,
  handleStepInstructionFocus,
  isTimerOnSelectedTask,
  captureTimerLapElapsedMs,
  captureTimerElapsedMs,
  newStepDurationText,
  setNewStepDurationText,
  newStepDraftTools,
  renderToolPicker,
  addNewStepDraftToolFromLibrary,
  removeNewStepDraftTool,
  newStepToolName,
  setNewStepToolName,
  newStepDraftChecks,
  stepCheckDefinitions,
  newStepDraftCheckValues,
  updateNewStepDraftChecks,
  goToNextManufacturingStep,
}: {
  newStepFormRef: React.RefObject<HTMLDivElement | null>;
  newStepId: string | null;
  newStepMotionPhase: "idle" | "exit" | "enter";
  mobileHeaderHeight: number;
  selectedTask: Task;
  draftStepSequence: number;
  newStepName: string;
  handleMobileFieldFocus: (
    event: React.FocusEvent<HTMLElement, Element>,
  ) => void;
  setNewStepName: React.Dispatch<React.SetStateAction<string>>;
  scheduleNewStepAutosave: (
    overrides?: Partial<MobileStepDraftSnapshot> | undefined,
  ) => void;
  closeNewStepForm: () => void;
  captureTimer: CaptureTimerState;
  errorMessage: string | null;
  saveState: "loading" | "idle" | "saving" | "saved" | "error";
  writesPending: boolean;
  persistNewStepDraft: (
    snapshot?: MobileStepDraftSnapshot,
    options?: {
      saveTask?: boolean | undefined;
      showSaving?: boolean | undefined;
      onSaved?: (() => void) | undefined;
    },
  ) => string | null;
  getNewStepDraftSnapshot: (
    overrides?: Partial<MobileStepDraftSnapshot>,
  ) => MobileStepDraftSnapshot;
  newStepDraftPhotos: StepPhotoAttachment[];
  newStepPhotoBusyCount: number;
  handleNewStepPhotoFiles: (files: File[]) => Promise<void>;
  removeNewStepDraftPhoto: (photoId: string) => void;
  bindNewStepInstructionRef: (node: HTMLTextAreaElement | null) => void;
  newStepInstruction: string;
  resizeTextareaToContent: (
    textarea: HTMLTextAreaElement,
    maxHeight?: number,
  ) => void;
  setNewStepInstruction: React.Dispatch<React.SetStateAction<string>>;
  handleStepInstructionFocus: (
    event: React.FocusEvent<HTMLTextAreaElement, Element>,
  ) => void;
  isTimerOnSelectedTask: boolean;
  captureTimerLapElapsedMs: number;
  captureTimerElapsedMs: number;
  newStepDurationText: string;
  setNewStepDurationText: React.Dispatch<React.SetStateAction<string>>;
  newStepDraftTools: string[];
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
  addNewStepDraftToolFromLibrary: (toolName: string) => void;
  removeNewStepDraftTool: (toolToRemove: string) => void;
  newStepToolName: string;
  setNewStepToolName: React.Dispatch<React.SetStateAction<string>>;
  newStepDraftChecks: Set<string>;
  stepCheckDefinitions: ManufacturingStepCheckDefinition[];
  newStepDraftCheckValues: Record<string, ManufacturingStepCheckValue>;
  updateNewStepDraftChecks: (qualityCheck: string) => void;
  goToNextManufacturingStep: () => void;
}) {
  return (
    <div
      ref={newStepFormRef}
      key={newStepId ?? "new-step-draft"}
      className={`order-last overflow-hidden ui-panel ui-photo-mobile-new-step-panel ${
        newStepMotionPhase === "exit" ? "is-exiting" : ""
      } ${newStepMotionPhase === "enter" ? "is-entering" : ""}`}
      style={{ scrollMarginTop: mobileHeaderHeight + 12 }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="ui-photo-mobile-step-kicker">
            {stepDisplayCode(selectedTask, { sequence: draftStepSequence }) ||
              `Step ${draftStepSequence}`}
          </div>
          <input
            className="ui-photo-mobile-step-name-inline w-full"
            aria-label="New step name"
            placeholder={`New step ${draftStepSequence}`}
            value={newStepName}
            onFocus={handleMobileFieldFocus}
            onChange={(event) => {
              setNewStepName(event.target.value);
              scheduleNewStepAutosave({ name: event.target.value });
            }}
          />
        </div>
        <button
          type="button"
          onClick={closeNewStepForm}
          disabled={captureTimer.running}
          className="ui-btn-ghost text-steel disabled:opacity-40"
        >
          {captureTimer.running ? "Timer On" : "Close"}
        </button>
      </div>
      {errorMessage ? (
        <div className="m-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 ui-photo-mobile-caption text-danger">
          {errorMessage}
          {saveState === "error" ? (
            <button
              type="button"
              className="ui-photo-mobile-btn-secondary mt-2"
              disabled={writesPending}
              onClick={() =>
                persistNewStepDraft(getNewStepDraftSnapshot(), {
                  showSaving: true,
                })
              }
            >
              Retry save
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="ui-photo-mobile-section">
        <div className="ui-photo-mobile-section-head">
          <div className="ui-mono-label">
            Photos · {newStepDraftPhotos.length}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="ui-photo-mobile-btn-accent h-10">
            {newStepPhotoBusyCount > 0 ? (
              <NothingSpinner inline />
            ) : (
              <Camera size={15} />
            )}
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
                void handleNewStepPhotoFiles(files);
              }}
            />
          </label>
          <label className="ui-photo-mobile-btn-secondary h-10">
            {newStepPhotoBusyCount > 0 ? (
              <NothingSpinner inline />
            ) : (
              <ImageIcon size={15} />
            )}
            Upload
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void handleNewStepPhotoFiles(files);
              }}
            />
          </label>
        </div>
        {newStepDraftPhotos.length > 0 ? (
          <div className="ui-photo-mobile-step-photo-grid mt-2">
            {newStepDraftPhotos.map((photo) => (
              <div
                key={photo.id}
                className="ui-photo-mobile-step-photo-card bg-surface-raised"
              >
                <NextImage
                  src={photo.thumbnailUrl ?? photo.dataUrl}
                  alt="New step photo"
                  width={480}
                  height={640}
                  unoptimized
                  loading="lazy"
                  className="ui-photo-mobile-step-photo-image"
                />
                <div className="ui-photo-mobile-step-photo-meta">
                  <div className="min-w-0">
                    <div className="truncate ui-photo-mobile-caption text-ink">
                      {photo.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeNewStepDraftPhoto(photo.id)}
                    className="ui-photo-mobile-icon-btn ui-photo-mobile-icon-btn-danger shrink-0"
                    aria-label="Remove photo"
                    title="Remove photo"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ui-photo-mobile-empty mt-2 flex items-center gap-2">
            <ImageIcon size={14} />
            Photos can be attached before this step is saved.
          </div>
        )}
      </div>
      <div className="px-3 py-3">
        <label className="block">
          <span className="ui-field-label mb-1">Description</span>
          <textarea
            ref={bindNewStepInstructionRef}
            className="ui-photo-mobile-textarea min-h-[104px]"
            value={newStepInstruction}
            onChange={(event) => {
              const instruction = event.target.value;
              resizeTextareaToContent(event.currentTarget);
              setNewStepInstruction(instruction);
              scheduleNewStepAutosave({ instruction });
            }}
            onFocus={handleStepInstructionFocus}
            placeholder="Describe the manufacturing step"
          />
        </label>
        <label className="mt-3 block max-w-[9.5rem]">
          <span className="mb-1 block ui-mono-label">Duration</span>
          {captureTimer.running &&
          isTimerOnSelectedTask &&
          captureTimer.activeStepId === newStepId ? (
            <div className="ui-photo-mobile-caption mb-1">
              Step lap {formatElapsedTimer(captureTimerLapElapsedMs)}
              <span className="text-ink-tertiary">
                {" "}
                · process {formatElapsedTimer(captureTimerElapsedMs)}
              </span>
            </div>
          ) : captureTimer.running && isTimerOnSelectedTask ? (
            <div className="ui-photo-mobile-caption mb-1">
              Process {formatElapsedTimer(captureTimerElapsedMs)}
            </div>
          ) : null}
          <label className="ui-photo-mobile-step-duration">
            <input
              className="ui-photo-mobile-step-duration-input"
              type="text"
              inputMode="numeric"
              value={newStepDurationText}
              onFocus={handleMobileFieldFocus}
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d*\.?\d*$/.test(value)) {
                  setNewStepDurationText(value);
                  scheduleNewStepAutosave({ durationText: value });
                }
              }}
            />
            <span className="ui-photo-mobile-step-duration-suffix">min</span>
          </label>
        </label>
      </div>
      <details className="ui-photo-mobile-section">
        <summary className="ui-photo-mobile-check-summary">
          Tools <span>{newStepDraftTools.length} added</span>
        </summary>
        <div className="mt-2">
          {renderToolPicker(
            newStepDraftTools,
            addNewStepDraftToolFromLibrary,
            removeNewStepDraftTool,
            {
              value: newStepToolName,
              sequence: draftStepSequence,
              onChange: setNewStepToolName,
            },
          )}
        </div>
      </details>
      <details className="ui-photo-mobile-section ui-photo-mobile-section-compact">
        <summary className="ui-photo-mobile-check-summary">
          Checks <span>{newStepDraftChecks.size} selected</span>
        </summary>
        <div className="ui-photo-mobile-check-editor mt-2">
          <ProcedureStepChecksEditor
            ariaLabel="New step checks"
            compact
            definitions={stepCheckDefinitions}
            qualityCheck={serializeManufacturingStepCheckState(
              { selected: newStepDraftChecks, values: newStepDraftCheckValues },
              stepCheckDefinitions,
            )}
            onChange={updateNewStepDraftChecks}
          />
        </div>
      </details>
      <div className="ui-photo-mobile-next-step-bar">
        <button
          type="button"
          onClick={goToNextManufacturingStep}
          disabled={
            newStepPhotoBusyCount > 0 || writesPending || saveState === "saving"
          }
          className="ui-photo-mobile-btn-primary inline-flex h-11 w-full disabled:opacity-60"
        >
          <Plus size={16} />
          {captureTimer.running ? "Save & start next lap" : "Save & add next"}
        </button>
      </div>
    </div>
  );
}
