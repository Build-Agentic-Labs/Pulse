"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  ListChecks,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatMinutes } from "@/domain/calculations";
import { formatManHours, statusLabel } from "@/domain/formatting";
import { applyInstructionBullets } from "@/domain/instruction-bullets";
import { getManufacturingStepCheckDefinitions } from "@/domain/manufacturing-step-checks";
import { type MasterBom } from "@/domain/master-bom";
import {
  documentDisplayCode,
  generateTaskCode,
  nextTaskNumberForComponent,
  stepDisplayCode,
  taskDisplayCode,
} from "@/domain/nomenclature";
import { createAnnotationId } from "@/domain/photo-annotations";
import { getTaskExplodedViews, type ExplodedView } from "@/domain/step-exploded-views";
import {
  addStepPartReference,
  attachPartToStep,
  removePartReferenceFromSteps,
  removeStepPartReference,
} from "@/domain/step-part-references";
import { getStepPhotoAttachments, updateStepPhotoAttachment, type StepPhotoAttachment } from "@/domain/step-photos";
import { addStepTool, getStepToolList, removeStepTool } from "@/domain/step-tools";
import { listSopSummariesFromSupabase, type SopSummary } from "@/domain/supabase-planner";
import { removeStepScopedCustomFields } from "@/domain/task-mutations";
import { addMinutes } from "@/domain/task-scheduling";
import { getTaskVideos, type TaskVideo } from "@/domain/task-videos";
import type {
  ManufacturingComponent,
  ManufacturingStep,
  PartReference,
  Station,
  Task,
  Zone,
} from "@/domain/types";
import { type BomPartSelection } from "../bom-part-search";
import { ClearableNumberInput } from "../clearable-number-input";
import { StepExplodedViewGallery } from "../step-exploded-view-gallery";
import { TaskVideoGallery } from "../task-video-gallery";
import { type FeedbackConfirm } from "../themed-feedback";
import { ThemedSelect } from "../themed-select";
import { NumericField, handleInstructionBulletKeyDown, type ProcedureDraftFieldName } from "./shared";
import { ProcedureStepChecksEditor, StepPartReferenceEditor, StepPhotoAttachmentEditor } from "./step-editors";

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "green" || status === "released" || status === "complete"
      ? "border-accent/20 bg-accent/10 text-accent"
      : status === "yellow" || status === "review" || status === "ready" || status === "in_progress"
        ? "border-warn/30 bg-warn-muted/20 text-warn-strong"
        : status === "red" || status === "blocked" || status === "qc_hold" || status === "rework"
          ? "border-danger/25 bg-danger-muted/10 text-danger"
          : "border-line bg-surface-sunken text-ink-secondary";

  return (
    <span className={`ui-chip ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

// SOP summaries for the task SOP picker, cached per browser session. The sops table is read-gated
// by org-tools access, so planner users without it get an empty list back -- the picker simply
// stays hidden. Cached at module scope (like signedUrlCache in supabase-planner) so reopening the
// drawer or switching tasks never re-fetches within a session.
let sopSummariesSessionCache: SopSummary[] | undefined;

function sopSummaryLabel(sop: SopSummary): string {
  const base =
    sop.sopNumber && sop.title ? `${sop.sopNumber} — ${sop.title}` : sop.title ?? sop.sopNumber ?? sop.id;
  return sop.status && sop.status !== "draft" ? `${base} (${sop.status})` : base;
}

// Lazily loads the SOP picker options the first time a task panel renders (not on workspace
// mount), then serves the session cache. Returns [] until loaded or when the user has no SOPs.
function useSopSummaries(enabled: boolean): SopSummary[] {
  const [sopSummaries, setSopSummaries] = useState<SopSummary[]>(() => sopSummariesSessionCache ?? []);

  useEffect(() => {
    if (!enabled || sopSummariesSessionCache) {
      return;
    }

    let cancelled = false;
    void listSopSummariesFromSupabase().then((summaries) => {
      sopSummariesSessionCache = summaries;
      if (!cancelled && summaries.length > 0) {
        setSopSummaries(summaries);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return sopSummaries;
}

export function DetailDrawer({
  task,
  station,
  zones,
  components,
  tasks,
  collapsed,
  isResizing,
  onConfirmAction,
  onStepDeleted,
  onToggleCollapsed,
  onResizeStart,
  onUpdateTask,
  getProcedureFieldValue,
  onProcedureFieldFocus,
  onProcedureFieldBlur,
  onProcedureFieldChange,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onDeleteExplodedView,
  onDeleteTaskVideo,
  onAddStepTool,
  onRemoveStepTool,
  toolLibrary,
  masterBom,
}: {
  task?: Task;
  station?: Station;
  zones: Zone[];
  components: ManufacturingComponent[];
  tasks: Task[];
  collapsed: boolean;
  isResizing: boolean;
  masterBom?: MasterBom;
  onConfirmAction: (message: FeedbackConfirm) => void;
  onStepDeleted: (taskSnapshot: Task, step: ManufacturingStep) => void;
  onToggleCollapsed: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  getProcedureFieldValue: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) => string;
  onProcedureFieldFocus: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) => void;
  onProcedureFieldBlur: (taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) => void;
  onProcedureFieldChange: (
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    value: string,
  ) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onDeleteExplodedView: (taskId: string, view: ExplodedView) => void;
  onDeleteTaskVideo: (taskId: string, video: TaskVideo) => void;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
  toolLibrary: string[];
}) {
  const drawerClass = `relative hidden h-full min-h-0 overflow-hidden border-l border-line transition-colors duration-300 ease-out xl:block ${
    collapsed ? "bg-accent text-canvas" : "bg-surface-raised text-ink"
  }`;
  const railClass = `absolute inset-0 flex flex-col items-center pb-44 transition-all duration-200 ease-out ${
    collapsed ? "translate-x-0 opacity-100 delay-100" : "pointer-events-none -translate-x-2 opacity-0"
  }`;
  const contentClass = `h-full overflow-auto p-4 pb-44 transition-all duration-200 ease-out ${
    collapsed ? "pointer-events-none translate-x-3 opacity-0" : "translate-x-0 opacity-100 delay-75"
  }`;
  const [newStepToolNames, setNewStepToolNames] = useState<Record<string, string>>({});
  const [newStepPartNumbers, setNewStepPartNumbers] = useState<Record<string, string>>({});
  const [stepPhotoUploadCounts, setStepPhotoUploadCounts] = useState<Record<string, number>>({});
  const sopSummaries = useSopSummaries(Boolean(task && station));
  const stepCheckDefinitions = getManufacturingStepCheckDefinitions();
  const collapsedRail = (
    <div aria-hidden={!collapsed} className={railClass}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="mt-4 flex h-8 w-8 items-center justify-center rounded bg-surface/10 text-canvas transition hover:bg-surface/20"
        title="Expand selected task drawer"
        aria-label="Expand selected task drawer"
      >
        <ChevronsLeft size={16} />
      </button>
      <div
        className="mt-5 max-h-[220px] max-w-[20px] text-center text-[10px] ui-mono-label tracking-wide text-white/70"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Selected Task
      </div>
      <div className="mt-4 flex h-8 w-8 items-center justify-center rounded border border-line/15 bg-surface/10 text-[11px] font-medium">
        {task ? taskDisplayCode(task) : "-"}
      </div>
    </div>
  );
  const resizeHandle = collapsed ? null : (
    <button
      type="button"
      onPointerDown={onResizeStart}
      className={`absolute left-0 top-0 z-30 h-full w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none transition ${
        isResizing ? "bg-accent/10" : "hover:bg-accent/10 focus-visible:bg-accent/10"
      }`}
      aria-label="Resize selected task drawer"
      title="Drag to resize selected task drawer"
    >
      <span
        className={`absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
          isResizing ? "bg-accent" : "bg-steel/25"
        }`}
      />
    </button>
  );

  if (!task || !station) {
    return (
      <aside data-detail-drawer="true" data-drawer-state={collapsed ? "collapsed" : "expanded"} className={drawerClass}>
        {resizeHandle}
        {collapsedRail}
        <div aria-hidden={collapsed} className={contentClass}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-ink">Detail</div>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-ink-secondary transition hover:bg-surface-sunken"
              title="Collapse selected task drawer"
              aria-label="Collapse selected task drawer"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      </aside>
    );
  }

  const taskId = task.id;
  const currentTask = task;
  const manufacturingSteps = task.manufacturingSteps ?? [];
  const manufacturingStepDurationMinutes = manufacturingSteps.reduce(
    (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
    0,
  );
  const durationIsStepDerived = manufacturingSteps.length > 0;
  const partReferences = task.partReferences ?? [];
  const availableComponents = components.filter((component) => component.active || component.id === task.componentId);

  function patchManufacturingSteps(nextSteps: ManufacturingStep[]) {
    const normalizedSteps = nextSteps
      .map((step, index) => ({ step, index }))
      .sort((left, right) => left.step.sequence - right.step.sequence || left.index - right.index)
      .map(({ step }, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = normalizedSteps.length
      ? normalizedSteps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0)
      : currentTask.plannedDurationMinutes;

    onUpdateTask(taskId, {
      manufacturingSteps: normalizedSteps,
      plannedDurationMinutes,
    });
  }

  function updateManufacturingStep(stepId: string, patch: Partial<ManufacturingStep>) {
    patchManufacturingSteps(manufacturingSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
  }

  function addManufacturingStep() {
    patchManufacturingSteps([
      ...manufacturingSteps,
      {
        id: `step-${taskId}-${Date.now()}`,
        sequence: manufacturingSteps.length + 1,
        instruction: "",
        durationMinutes: manufacturingSteps.length === 0 ? currentTask.plannedDurationMinutes : 0,
        qualityCheck: "",
      },
    ]);
  }

  function removeManufacturingStep(stepId: string) {
    const stepToDelete = manufacturingSteps.find((step) => step.id === stepId);
    const nextSteps = manufacturingSteps
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = nextSteps.length
      ? nextSteps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0)
      : currentTask.plannedDurationMinutes;
    const nextTask = removeStepScopedCustomFields(currentTask, stepId);

    onUpdateTask(taskId, {
      manufacturingSteps: nextSteps,
      plannedDurationMinutes,
      customFields: nextTask.customFields,
    });

    if (stepToDelete) {
      onStepDeleted(currentTask, stepToDelete);
    }
  }

  function requestRemoveManufacturingStep(stepId: string) {
    const step = manufacturingSteps.find((candidate) => candidate.id === stepId);
    if (!step) {
      return;
    }

    onConfirmAction({
      title: `Delete step ${step.sequence}?`,
      body: "This removes the manufacturing step, its tools, part links, and attached photos from this task.",
      tone: "danger",
      confirmLabel: "Delete Step",
      onConfirm: () => removeManufacturingStep(stepId),
    });
  }

  function updatePartReference(partId: string, patch: Partial<PartReference>) {
    onUpdateTask(taskId, {
      partReferences: partReferences.map((part) => (part.id === partId ? { ...part, ...patch } : part)),
    });
  }

  function addPartReference() {
    onUpdateTask(taskId, {
      partReferences: [
        ...partReferences,
        {
          id: `part-${taskId}-${Date.now()}`,
          partNumber: "",
          description: "",
          quantity: 1,
          disposition: "",
        },
      ],
    });
  }

  function removePartReference(partId: string) {
    const taskWithoutPart = {
      ...currentTask,
      partReferences: partReferences.filter((part) => part.id !== partId),
    };
    const nextTask = removePartReferenceFromSteps(taskWithoutPart, partId);

	    onUpdateTask(taskId, {
	      manufacturingSteps: nextTask.manufacturingSteps,
	      partReferences: nextTask.partReferences,
	    });
  }

  function addManufacturingStepPartReference(stepId: string) {
    const nextTask = attachPartToStep(currentTask, stepId, { partNumber: newStepPartNumbers[stepId] ?? "" }, () =>
      createAnnotationId("part"),
    );
    if (!nextTask) {
      return;
    }

    onUpdateTask(taskId, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
    setNewStepPartNumbers((current) => ({ ...current, [stepId]: "" }));
  }

  function addStepPartFromBom(stepId: string, entry: BomPartSelection) {
    const nextTask = attachPartToStep(currentTask, stepId, entry, () => createAnnotationId("part"));
    if (!nextTask) {
      return;
    }

    onUpdateTask(taskId, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
  }

	  function linkExistingPartToManufacturingStep(stepId: string, partReferenceId: string) {
	    const nextTask = addStepPartReference(currentTask, stepId, partReferenceId);
	    onUpdateTask(taskId, { manufacturingSteps: nextTask.manufacturingSteps });
	  }

	  function removeManufacturingStepPartReference(stepId: string, partReferenceId: string) {
	    const nextTask = removeStepPartReference(currentTask, stepId, partReferenceId);
	    onUpdateTask(taskId, { manufacturingSteps: nextTask.manufacturingSteps });
	  }

  function addManufacturingStepTool(stepId: string) {
    const nextTool = (newStepToolNames[stepId] ?? "").trim();
    if (!nextTool) {
      return;
    }

    const nextTask = addStepTool(currentTask, stepId, nextTool);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
    void onAddStepTool(taskId, stepId, nextTool, getStepToolList(nextTask, stepId).length);
    setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
  }

  function addManufacturingStepToolFromLibrary(stepId: string, toolName: string) {
    if (!toolName) {
      return;
    }

    const nextTask = addStepTool(currentTask, stepId, toolName);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
    void onAddStepTool(taskId, stepId, toolName, getStepToolList(nextTask, stepId).length);
  }

  function removeManufacturingStepTool(stepId: string, toolToRemove: string) {
    const nextTask = removeStepTool(currentTask, stepId, toolToRemove);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
    void onRemoveStepTool(stepId, toolToRemove);
  }

  async function uploadManufacturingStepPhotos(stepId: string, files: File[]) {
    if (files.length === 0) {
      return;
    }

    setStepPhotoUploadCounts((current) => ({ ...current, [stepId]: (current[stepId] ?? 0) + 1 }));

    try {
      await onUploadStepPhotos(taskId, stepId, files);
    } finally {
      setStepPhotoUploadCounts((current) => {
        const nextCount = Math.max(0, (current[stepId] ?? 0) - 1);
        const nextCounts = { ...current };

        if (nextCount > 0) {
          nextCounts[stepId] = nextCount;
        } else {
          delete nextCounts[stepId];
        }

        return nextCounts;
      });
    }
  }

  function removeManufacturingStepPhoto(stepId: string, photoId: string) {
    void onRemoveStepPhoto(taskId, stepId, photoId);
  }

  function updateManufacturingStepPhoto(stepId: string, photoId: string, patch: Partial<StepPhotoAttachment>) {
    const nextTask = updateStepPhotoAttachment(currentTask, stepId, photoId, patch);
    onUpdateTask(taskId, { customFields: nextTask.customFields });
  }

  function requestRemoveManufacturingStepPhoto(stepId: string, photo: StepPhotoAttachment) {
    onConfirmAction({
      title: "Delete photo?",
      body: "This removes the photo from the shared step record.",
      tone: "danger",
      confirmLabel: "Delete Photo",
      onConfirm: () => removeManufacturingStepPhoto(stepId, photo.id),
    });
  }

  return (
    <aside data-detail-drawer="true" data-drawer-state={collapsed ? "collapsed" : "expanded"} className={drawerClass}>
      {resizeHandle}
      {collapsedRail}
      <div aria-hidden={collapsed} className={contentClass}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ui-eyebrow">Selected Task</div>
            <h2 className="ui-section-title mt-1">{task.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-ink-secondary hover:bg-surface-sunken"
              title="Collapse selected task drawer"
              aria-label="Collapse selected task drawer"
            >
              <ChevronsRight size={16} />
            </button>
            <StatusPill status={task.status} />
          </div>
        </div>

        <div className="space-y-4">
        <StepExplodedViewGallery
          views={getTaskExplodedViews(task)}
          onDelete={(view) => onDeleteExplodedView(task.id, view)}
        />
        <TaskVideoGallery videos={getTaskVideos(task)} onDelete={(video) => onDeleteTaskVideo(task.id, video)} />
        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-ink-secondary">Manufacturing Code</div>
          <div className="mb-3 font-mono text-lg font-bold text-ink">{taskDisplayCode(task)}</div>
          <div className="mb-3 rounded border border-line bg-surface-sunken px-2 py-1.5 font-mono text-xs font-semibold text-ink-secondary">
            {documentDisplayCode(task) || "Work instruction code pending"}
          </div>
          <div className="grid gap-2">
            <label className="block">
              <span className="ui-field-label">Zone</span>
              <ThemedSelect
                value={task.zoneId ?? ""}
                options={[
                  { value: "", label: "Unzoned" },
                  ...zones.map((zone) => ({ value: zone.id, label: `${zone.code || zone.name} - ${zone.name}` })),
                ]}
                onChange={(zoneId) => onUpdateTask(task.id, { zoneId: zoneId || undefined })}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Component</span>
              <ThemedSelect
                value={task.componentId ?? ""}
                options={[
                  { value: "", label: "No component" },
                  ...availableComponents.map((component) => ({
                    value: component.id,
                    label: `${component.code || "CODE"} - ${component.name || "Unnamed component"}`,
                  })),
                ]}
                onChange={(componentId) => {
                  const nextNumber = componentId ? nextTaskNumberForComponent(tasks, componentId, task.zoneId) : undefined;
                  onUpdateTask(task.id, { componentId: componentId || undefined, taskNumber: task.taskNumber ?? nextNumber });
                }}
              />
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <NumericField
                label="Task Number"
                value={task.taskNumber ?? 0}
                onChange={(value) => onUpdateTask(task.id, { taskNumber: Math.max(0, Math.round(value)) || undefined })}
              />
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(task.codeLocked)}
                  onChange={(event) => onUpdateTask(task.id, { codeLocked: event.target.checked })}
                />
                Lock
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateTask(task.id, {
                  manufacturingCode: generateTaskCode(task, zones, components) || undefined,
                  codeGeneratedAt: new Date().toISOString(),
                  codeLocked: false,
                })
              }
              className="ui-btn-ghost h-8 gap-2"
            >
              <RotateCcw size={13} />
              Regenerate
            </button>
          </div>
        </div>
        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-ink-secondary">Station</div>
          <div className="text-sm font-bold text-ink">{station.sequence}. {station.name}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-ink-secondary">
            <span>Cycle {formatMinutes(station.plannedCycleMinutes)}</span>
            <span>{formatManHours(station.plannedManHours)}</span>
            <span>Operators {station.plannedOperators}</span>
            <span>{station.bottleneckFlag ? "Bottleneck" : "Balanced"}</span>
          </div>
        </div>

        {sopSummaries.length > 0 ? (
          <label className="block">
            <span className="ui-field-label">SOP</span>
            <ThemedSelect
              ariaLabel="Linked SOP"
              value={task.sopId ?? ""}
              options={[
                { value: "", label: "None" },
                ...sopSummaries.map((sop) => ({ value: sop.id, label: sopSummaryLabel(sop) })),
              ]}
              onChange={(sopId) => onUpdateTask(task.id, { sopId: sopId || undefined })}
            />
          </label>
        ) : null}

        <label className="block">
          <span className="ui-field-label">Description</span>
          <textarea
            className="ui-field-standalone min-h-[110px] resize-none py-2"
            value={task.description ?? ""}
            onChange={(event) => onUpdateTask(task.id, { description: event.target.value })}
          />
        </label>

        <div className="ui-panel p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs ui-mono-label tracking-wide text-ink-secondary">Manufacturing Steps</div>
              <div className="text-xs font-semibold text-ink-secondary">{manufacturingSteps.length} step(s)</div>
            </div>
            <button
              type="button"
              onClick={addManufacturingStep}
              className="ui-btn-primary h-8 gap-1 px-3 text-xs"
            >
              <Plus size={14} />
              Step
            </button>
          </div>
          {manufacturingSteps.length === 0 ? (
            <div className="border-t border-dashed border-line px-1 py-2 text-xs font-semibold text-ink-secondary">
              Add operation-level steps for this task.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-2">
                {manufacturingSteps.map((step) => {
                  const stepPhotos = getStepPhotoAttachments(currentTask, step.id);
                  const stepTools = getStepToolList(currentTask, step.id);
                  const generatedStepCode = stepDisplayCode(currentTask, step);

                  return (
                    <div
                      key={step.id}
                      className="grid grid-cols-[minmax(0,1fr)_22px] gap-1.5 border-b border-line/70 px-1 pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1 ui-mono-label">
                          <span className="max-w-[150px] shrink-0 truncate" title={generatedStepCode || `Step ${step.sequence}`}>
                            {generatedStepCode || "Step"}
                          </span>
                          <ClearableNumberInput
                            aria-label={`Step ${step.sequence} sequence`}
                            className="number-input ui-field-standalone h-6 w-8 px-0.5 text-center text-xs"
                            value={step.sequence}
                            min={1}
                            fallbackValue={step.sequence}
                            precision={0}
                            normalize={Math.round}
                            onValueChange={(value) => updateManufacturingStep(step.id, { sequence: value })}
                          />
                          <span className="ml-1 shrink-0">Min</span>
                          <ClearableNumberInput
                            aria-label={`Step ${step.sequence} duration minutes`}
                            className="number-input ui-field-standalone h-6 w-12 px-0.5 text-center text-xs"
                            value={step.durationMinutes ?? 0}
                            min={0}
                            fallbackValue={step.durationMinutes ?? 0}
                            precision={1}
                            onValueChange={(value) => updateManufacturingStep(step.id, { durationMinutes: value })}
                          />
                        </div>
                        <textarea
                          aria-label={`Step ${step.sequence} instruction`}
                          className="ui-field-standalone min-h-[86px] resize-none py-2 text-sm leading-snug"
                          value={getProcedureFieldValue(taskId, step.id, "instruction", step.instruction)}
                          onFocus={() => onProcedureFieldFocus(taskId, step.id, "instruction", step.instruction)}
                          onBlur={() => onProcedureFieldBlur(taskId, step.id, "instruction")}
                          onChange={(event) =>
                            onProcedureFieldChange(taskId, step.id, "instruction", event.target.value)
                          }
                          onKeyDown={(event) =>
                            handleInstructionBulletKeyDown(event, (instruction) =>
                              onProcedureFieldChange(taskId, step.id, "instruction", instruction),
                            )
                          }
                          placeholder="Describe the manufacturing step"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onProcedureFieldChange(
                              taskId,
                              step.id,
                              "instruction",
                              applyInstructionBullets(
                                getProcedureFieldValue(taskId, step.id, "instruction", step.instruction),
                              ),
                            )
                          }
                          className="ui-btn-ghost h-8 gap-1.5 px-2"
                          aria-label={`Format step ${step.sequence} as bullets`}
                          title={`Format step ${step.sequence} as bullets`}
                        >
                          <ListChecks size={11} />
                          Bullets
                        </button>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="ui-mono-label">Tools</span>
                            {toolLibrary.length > 0 ? (
                              <ThemedSelect
                                aria-label={`Add saved tool to step ${step.sequence}`}
                                value=""
                                className="max-w-[150px]"
                                triggerClassName="h-7 px-1.5 text-[10px]"
                                options={[
                                  { value: "", label: "Library" },
                                  ...toolLibrary
                                    .filter((tool) => !stepTools.some((stepTool) => stepTool.toLocaleLowerCase() === tool.toLocaleLowerCase()))
                                    .map((tool) => ({ value: tool, label: tool })),
                                ]}
                                onChange={(value) => {
                                  if (value) {
                                    addManufacturingStepToolFromLibrary(step.id, value);
                                  }
                                }}
                              />
                            ) : null}
                          </div>
                          <div className="grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-1">
                            <span className="ui-mono-label">New</span>
                            <input
                              className="h-7 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-accent"
                              value={newStepToolNames[step.id] ?? ""}
                              onChange={(event) =>
                                setNewStepToolNames((current) => ({ ...current, [step.id]: event.target.value }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  addManufacturingStepTool(step.id);
                                }
                              }}
                              placeholder="Add tool"
                            />
                            <button
                              type="button"
                              onClick={() => addManufacturingStepTool(step.id)}
                              className="h-7 text-[10px] ui-mono-label text-ink-secondary hover:text-accent"
                            >
                              Add
                            </button>
                          </div>
                          {stepTools.length > 0 ? (
                            <div className="flex flex-wrap gap-x-2 gap-y-1 pl-[42px] text-[10px] font-bold text-ink-secondary">
                              {stepTools.map((tool) => (
                                <span
                                  key={tool}
                                  className="inline-flex min-w-0 items-center gap-1"
                                >
                                  <span className="max-w-[170px] truncate">{tool}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeManufacturingStepTool(step.id, tool)}
                                    className="text-ink-secondary/70 hover:text-danger"
                                    aria-label={`Remove ${tool}`}
                                    title={`Remove ${tool}`}
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </span>
                              ))}
                            </div>
	                          ) : null}
	                        </div>
	                        <StepPartReferenceEditor
	                          task={currentTask}
	                          step={step}
	                          partReferences={partReferences}
	                          draftValue={newStepPartNumbers[step.id] ?? ""}
	                          compact
	                          masterBom={masterBom}
	                          onDraftChange={(value) =>
	                            setNewStepPartNumbers((current) => ({ ...current, [step.id]: value }))
	                          }
	                          onAddDraft={() => addManufacturingStepPartReference(step.id)}
	                          onAddFromBom={(entry) => addStepPartFromBom(step.id, entry)}
	                          onLinkExisting={(partReferenceId) => linkExistingPartToManufacturingStep(step.id, partReferenceId)}
	                          onRemove={(partReferenceId) => removeManufacturingStepPartReference(step.id, partReferenceId)}
	                        />
                        <div className="border-t border-line pt-2">
                          <StepPhotoAttachmentEditor
                            step={step}
                            photos={stepPhotos}
                            compact
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
                          />
                        </div>
                        <div
                          className="min-w-0"
                        >
                          <ProcedureStepChecksEditor
                            ariaLabel={`Step ${step.sequence} checks`}
                            compact
                            definitions={stepCheckDefinitions}
                            qualityCheck={step.qualityCheck}
                            onChange={(qualityCheck) => updateManufacturingStep(step.id, { qualityCheck })}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => requestRemoveManufacturingStep(step.id)}
                        className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-danger-muted hover:text-danger"
                        title="Remove step"
                        aria-label={`Remove step ${step.sequence}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="ui-panel p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs ui-mono-label tracking-wide text-ink-secondary">Part References</div>
              <div className="text-xs font-semibold text-ink-secondary">{partReferences.length} part number(s)</div>
            </div>
            <button
              type="button"
              onClick={addPartReference}
              className="ui-btn-primary h-8 gap-1 px-3 text-xs"
            >
              <Plus size={14} />
              Part
            </button>
          </div>
          <div className="space-y-3">
            {partReferences.length === 0 ? (
              <div className="rounded border border-dashed border-line bg-surface-raised p-3 text-xs font-semibold text-ink-secondary">
                Add part numbers, quantities, and disposition notes used by this task.
              </div>
            ) : null}
            {partReferences.map((part) => (
              <div key={part.id} className="rounded border border-line bg-surface-raised p-2">
                <div className="mb-2 grid grid-cols-[1fr_74px_34px] items-end gap-2">
                  <label className="block">
                    <span className="ui-field-label">Part Number</span>
                    <input
                      className="ui-field-standalone h-8 px-2 text-sm"
                      value={part.partNumber}
                      onChange={(event) => updatePartReference(part.id, { partNumber: event.target.value })}
                      placeholder="PN / kit / drawing ref"
                    />
                  </label>
                  <label className="block">
                    <span className="ui-field-label">Qty</span>
                    <ClearableNumberInput
                      className="number-input ui-field-standalone h-8 px-2 text-sm"
                      value={part.quantity ?? 0}
                      min={0}
                      fallbackValue={part.quantity ?? 0}
                      precision={0}
                      normalize={Math.round}
                      onValueChange={(value) => updatePartReference(part.id, { quantity: value })}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removePartReference(part.id)}
                    className="flex h-8 items-center justify-center rounded border border-line bg-surface text-ink-secondary hover:border-danger hover:text-danger"
                    title="Remove part reference"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <label className="mb-2 block">
                  <span className="ui-field-label">Description</span>
                  <input
                    className="ui-field-standalone h-8 px-2 text-sm"
                    value={part.description ?? ""}
                    onChange={(event) => updatePartReference(part.id, { description: event.target.value })}
                    placeholder="What the reference is used for"
                  />
                </label>
                <label className="block">
                  <span className="ui-field-label">Disposition / Reference Note</span>
                  <input
                    className="ui-field-standalone h-8 px-2 text-sm"
                    value={part.disposition ?? ""}
                    onChange={(event) => updatePartReference(part.id, { disposition: event.target.value })}
                    placeholder="Reuse, rework, service part, QC hold, etc."
                  />
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumericField
            label="Duration"
            value={durationIsStepDerived ? manufacturingStepDurationMinutes : task.plannedDurationMinutes}
            suffix="min"
            readOnly={durationIsStepDerived}
            onChange={(value) => onUpdateTask(task.id, { plannedDurationMinutes: value, plannedFinish: addMinutes(task.plannedStart, value) })}
          />
          <div>
            <div className="ui-field-label">Headcount</div>
            <div className="flex h-10 items-center rounded border border-line bg-surface-sunken px-3 text-lg font-medium text-ink">
              {task.plannedOperators}
            </div>
          </div>
        </div>

        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-ink-secondary">Gates</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.qualityGate}
                onChange={(event) => onUpdateTask(task.id, { qualityGate: event.target.checked })}
              />
              QC Gate
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.travelerSignoffRequired}
                onChange={(event) => onUpdateTask(task.id, { travelerSignoffRequired: event.target.checked })}
              />
              Traveler
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.criticalPath}
                onChange={(event) => onUpdateTask(task.id, { criticalPath: event.target.checked })}
              />
              Critical
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={task.bottleneckFlag}
                onChange={(event) => onUpdateTask(task.id, { bottleneckFlag: event.target.checked })}
              />
              Flag
            </label>
          </div>
        </div>

        <label className="block">
          <span className="ui-field-label">Safety Notes</span>
          <textarea
            className="ui-field-standalone min-h-[88px] resize-none py-2"
            value={task.safetyNotes ?? ""}
            onChange={(event) => onUpdateTask(task.id, { safetyNotes: event.target.value })}
          />
        </label>
        </div>
      </div>
    </aside>
  );
}
