"use client";

import { PhonePortalQrButton } from "@/components/line-workspace/phone-portal-qr-button";
import {
  ChevronDown,
  ImageIcon,
  ListChecks,
  Package,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { calculateTaskManHours, formatMinutes } from "@/domain/calculations";
import { formatManHours } from "@/domain/formatting";
import { InstructionFormatToolbar } from "./instruction-format-toolbar";
import { getManufacturingStepCheckDefinitions } from "@/domain/manufacturing-step-checks";
import { getMasterBom } from "@/domain/master-bom";
import { taskDisplayCode } from "@/domain/nomenclature";
import { createAnnotationId } from "@/domain/photo-annotations";
import { getTaskExplodedViews, type ExplodedView } from "@/domain/step-exploded-views";
import {
  addStepPartReference,
  attachPartMentionToStep,
  attachPartToStep,
  getTaskPartAllocationSummaries,
  removeStepPartReference,
  setStepPartReferenceQuantity,
} from "@/domain/step-part-references";
import {
  getStepPartMentions,
  reconcileStepPartMentionsAfterInstructionChange,
  removeStepPartMention,
} from "@/domain/step-part-mentions";
import { getStepPhotoAttachments, updateStepPhotoAttachment, type StepPhotoAttachment } from "@/domain/step-photos";
import { addStepTool, getStepToolList, removeStepTool } from "@/domain/step-tools";
import { removeStepScopedCustomFields } from "@/domain/task-mutations";
import { getTaskVideos, type TaskVideo } from "@/domain/task-videos";
import { type ProjectToolDefinition } from "@/domain/tool-registry";
import type { ManufacturingStep, PlannerProjectContext, Product, Task, Zone } from "@/domain/types";
import { type BomPartSelection } from "../bom-part-search";
import { ClearableNumberInput } from "../clearable-number-input";
import { ProcedureStepToolTable } from "../procedure-step-tool-table";
import { ProcedureToolPicker } from "../procedure-tool-picker";
import { StepExplodedViewGallery } from "../step-exploded-view-gallery";
import { TaskVideoGallery } from "../task-video-gallery";
import { type FeedbackConfirm } from "../themed-feedback";
import { ThemedSelect } from "../themed-select";
import { StatCard, handleInstructionBulletKeyDown, type ProcedureDraftFieldName } from "./shared";
import {
  instructionTextSelectionFromTextarea,
  LinkedInstructionTextarea,
  ProcedureStepChecksEditor,
  StepPartMentionEditor,
  StepPartReferenceEditor,
  StepPhotoAttachmentEditor,
  type InstructionTextSelection,
} from "./step-editors";

function ScrollDownHint({ className = "" }: { className?: string }) {
  const hintRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollContainer = hintRef.current?.parentElement;

    if (!scrollContainer) {
      return;
    }

    const scrollElement = scrollContainer;

    function updateHintVisibility() {
      const canScrollDown = scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop > 24;
      const isNearTop = scrollElement.scrollTop < 16;

      setVisible(canScrollDown && isNearTop);
    }

    updateHintVisibility();
    scrollElement.addEventListener("scroll", updateHintVisibility, { passive: true });
    window.addEventListener("resize", updateHintVisibility);

    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateHintVisibility);
    resizeObserver?.observe(scrollElement);

    const mutationObserver = new MutationObserver(updateHintVisibility);
    mutationObserver.observe(scrollElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      scrollElement.removeEventListener("scroll", updateHintVisibility);
      window.removeEventListener("resize", updateHintVisibility);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={hintRef}
      className={`pointer-events-none sticky bottom-3 z-20 flex justify-center transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      } ${className}`}
      aria-hidden="true"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-secondary">
        <ChevronDown size={15} strokeWidth={2.4} />
      </div>
    </div>
  );
}

type ProcedureSectionKey = "photos" | "checks" | "tools" | "parts";

// Sections that can be temporarily hidden on every step to declutter the page
// while authoring instructions. The step header + instruction are never hidden.
const PROCEDURE_STEP_SECTIONS: { key: ProcedureSectionKey; label: string; Icon: typeof Wrench }[] = [
  { key: "photos", label: "Photos", Icon: ImageIcon },
  { key: "checks", label: "Checks", Icon: ListChecks },
  { key: "tools", label: "Tools", Icon: Wrench },
  { key: "parts", label: "Parts", Icon: Package },
];

// The hidden-section filter is a personal authoring preference, kept in
// localStorage so it persists across refreshes for this user on this device.
const PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY = "pulse:procedure-hidden-sections";

function readHiddenStepSections(): Set<ProcedureSectionKey> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw) as unknown;
    const validKeys = new Set(PROCEDURE_STEP_SECTIONS.map((section) => section.key));
    const keys = Array.isArray(parsed)
      ? parsed.filter(
          (value): value is ProcedureSectionKey =>
            typeof value === "string" && validKeys.has(value as ProcedureSectionKey),
        )
      : [];
    return new Set(keys);
  } catch {
    return new Set();
  }
}

function writeHiddenStepSections(sections: Set<ProcedureSectionKey>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY, JSON.stringify([...sections]));
  } catch {
    // Ignore storage failures (private browsing, quota).
  }
}

export function ProcedureWorkspace({
  product,
  tasks,
  zones,
  selectedTask,
  isTaskHydrating = false,
  focusedStepId,
  onSelectTask,
  onConfirmAction,
  onStepDeleted,
  onUpdateTask,
  getProcedureFieldValue,
  onProcedureFieldFocus,
  onProcedureFieldBlur,
  onProcedureFieldChange,
  onMoveStepToTask,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onDeleteExplodedView,
  onDeleteTaskVideo,
  onAddStepTool,
  onRemoveStepTool,
  toolLibrary,
  projectToolRegistry,
  project,
}: {
  product: Product;
  tasks: Task[];
  zones: Zone[];
  selectedTask?: Task;
  isTaskHydrating?: boolean;
  focusedStepId?: string;
  onSelectTask: (taskId: string) => void;
  onConfirmAction: (message: FeedbackConfirm) => void;
  onStepDeleted: (taskSnapshot: Task, step: ManufacturingStep) => void;
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
  onMoveStepToTask: (sourceTaskId: string, targetTaskId: string, stepId: string) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onDeleteExplodedView: (taskId: string, view: ExplodedView) => void;
  onDeleteTaskVideo: (taskId: string, video: TaskVideo) => void;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
  toolLibrary: string[];
  projectToolRegistry: Map<string, ProjectToolDefinition>;
  /** Needed only to resolve the phone capture portal's URL for the QR popover. */
  project?: PlannerProjectContext;
}) {
  const [newStepToolNames, setNewStepToolNames] = useState<Record<string, string>>({});
  const [instructionSelections, setInstructionSelections] = useState<Record<string, InstructionTextSelection>>({});
  const [stepPhotoUploadCounts, setStepPhotoUploadCounts] = useState<Record<string, number>>({});
  const [navigatorWidth, setNavigatorWidth] = useState(320);
  const [isResizingNavigator, setIsResizingNavigator] = useState(false);
  const navigatorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Which step sections are hidden. View-only filter; persisted per user via
  // localStorage and never touches saved project data.
  const [hiddenStepSections, setHiddenStepSections] = useState<Set<ProcedureSectionKey>>(() =>
    readHiddenStepSections(),
  );
  const [isSectionFilterOpen, setIsSectionFilterOpen] = useState(false);
  const sectionFilterRef = useRef<HTMLDivElement | null>(null);
  const showPhotos = !hiddenStepSections.has("photos");
  const showChecks = !hiddenStepSections.has("checks");
  const showTools = !hiddenStepSections.has("tools");
  const showParts = !hiddenStepSections.has("parts");
  const showStepDetails = showChecks || showTools || showParts;
  function toggleStepSection(key: ProcedureSectionKey) {
    setHiddenStepSections((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeHiddenStepSections(next);
      return next;
    });
  }

  useEffect(() => {
    if (!isSectionFilterOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (sectionFilterRef.current && !sectionFilterRef.current.contains(event.target as Node)) {
        setIsSectionFilterOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSectionFilterOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSectionFilterOpen]);
  const stepCheckDefinitions = getManufacturingStepCheckDefinitions(product.customFields);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; color: string; sequence: number; tasks: Task[] }>();

    [...tasks]
      .sort((left, right) => Number.parseFloat(left.wbs) - Number.parseFloat(right.wbs))
      .forEach((task) => {
        const zone = task.zoneId ? zoneById.get(task.zoneId) : undefined;
        const groupId = zone?.id ?? "zone-unzoned";
        const group = groups.get(groupId) ?? {
          id: groupId,
          name: zone?.name || "Unzoned",
          color: zone?.color ?? "#52606d",
          sequence: zone?.sequence ?? Number.MAX_SAFE_INTEGER,
          tasks: [],
        };

        group.tasks.push(task);
        groups.set(groupId, group);
      });

    return [...groups.values()].sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));
  }, [tasks, zoneById]);

  const task = selectedTask;
  const manufacturingSteps = useMemo(
    () => [...(task?.manufacturingSteps ?? [])].sort((left, right) => left.sequence - right.sequence),
    [task?.manufacturingSteps],
  );
  const moveTargetTasks = useMemo(
    () => tasks.filter((candidate) => candidate.rowType === "task" && candidate.id !== task?.id),
    [task?.id, tasks],
  );
  const partReferences = task?.partReferences ?? [];
  const allocatedPartSummaries = useMemo(
    () => (task ? getTaskPartAllocationSummaries(task) : []),
    [task],
  );
  const masterBom = useMemo(() => getMasterBom(product.customFields), [product.customFields]);
  const manufacturingStepDurationMinutes = manufacturingSteps.reduce(
    (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
    0,
  );
  const currentManHours = task ? calculateTaskManHours({ ...task, plannedDurationMinutes: task.plannedDurationMinutes }) : 0;
  const stepDerivedManHours = task
    ? calculateTaskManHours({ ...task, plannedDurationMinutes: manufacturingStepDurationMinutes })
    : 0;
  const procedureGridStyle = {
    width: navigatorWidth,
  } as CSSProperties;

  useEffect(() => {
    if (!focusedStepId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-step-name-id="${focusedStepId}"]`);
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
      input?.focus();
      input?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [focusedStepId, task?.id]);

  useEffect(() => {
    if (!isResizingNavigator) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function clampNavigatorWidth(width: number) {
      return Math.min(Math.max(width, 260), Math.min(560, window.innerWidth - 760));
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = navigatorResizeRef.current;
      if (!resizeStart) {
        return;
      }

      setNavigatorWidth(clampNavigatorWidth(resizeStart.startWidth + event.clientX - resizeStart.startX));
    }

    function stopResize() {
      navigatorResizeRef.current = null;
      setIsResizingNavigator(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [isResizingNavigator]);

  function startNavigatorResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    navigatorResizeRef.current = {
      startX: event.clientX,
      startWidth: navigatorWidth,
    };
    setIsResizingNavigator(true);
  }

  function patchManufacturingSteps(nextSteps: ManufacturingStep[]) {
    if (!task) {
      return;
    }

    const normalizedSteps = nextSteps.map((step, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = normalizedSteps.reduce(
      (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
      0,
    );

    onUpdateTask(task.id, {
      manufacturingSteps: normalizedSteps,
      plannedDurationMinutes,
    });
  }

  function updateManufacturingStep(stepId: string, patch: Partial<ManufacturingStep>) {
    patchManufacturingSteps(manufacturingSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
  }

  function moveManufacturingStep(stepId: string, sequence: number) {
    const targetIndex = Math.min(Math.max(Math.round(sequence) - 1, 0), Math.max(manufacturingSteps.length - 1, 0));
    const currentIndex = manufacturingSteps.findIndex((step) => step.id === stepId);

    if (currentIndex < 0) {
      return;
    }

    const nextSteps = [...manufacturingSteps];
    const [step] = nextSteps.splice(currentIndex, 1);
    nextSteps.splice(targetIndex, 0, step);
    patchManufacturingSteps(nextSteps);
  }

  function addManufacturingStep() {
    if (!task) {
      return;
    }

    patchManufacturingSteps([
      ...manufacturingSteps,
      {
        id: `step-${task.id}-${Date.now()}`,
        sequence: manufacturingSteps.length + 1,
        instruction: "",
        durationMinutes: 0,
        qualityCheck: "",
      },
    ]);
  }

  function removeManufacturingStep(stepId: string) {
    if (!task) {
      return;
    }

    const stepToDelete = manufacturingSteps.find((step) => step.id === stepId);
    const nextSteps = manufacturingSteps
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, sequence: index + 1 }));
    const plannedDurationMinutes = nextSteps.reduce(
      (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
      0,
    );
    const nextTask = removeStepScopedCustomFields(task, stepId);

    onUpdateTask(task.id, {
      manufacturingSteps: nextSteps,
      plannedDurationMinutes,
      customFields: nextTask.customFields,
    });

    if (stepToDelete) {
      onStepDeleted(task, stepToDelete);
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

  function addStepPartFromBom(stepId: string, entry: BomPartSelection) {
    if (!task) {
      return;
    }

    const nextTask = attachPartToStep(task, stepId, entry, () => createAnnotationId("part"));
    if (!nextTask) {
      return;
    }

    onUpdateTask(task.id, {
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
  }

  function linkExistingPartToManufacturingStep(stepId: string, partReferenceId: string) {
    if (!task) {
      return;
    }

    const nextTask = addStepPartReference(task, stepId, partReferenceId);
    onUpdateTask(task.id, { manufacturingSteps: nextTask.manufacturingSteps });
  }

  function removeManufacturingStepPartReference(stepId: string, partReferenceId: string) {
    if (!task) {
      return;
    }

    const nextTask = removeStepPartReference(task, stepId, partReferenceId);
    onUpdateTask(task.id, {
      customFields: nextTask.customFields,
      manufacturingSteps: nextTask.manufacturingSteps,
    });
  }

  function updateManufacturingStepPartQuantity(stepId: string, partReferenceId: string, quantity: number) {
    if (!task) {
      return;
    }

    const nextTask = setStepPartReferenceQuantity(task, stepId, partReferenceId, quantity);
    onUpdateTask(task.id, { manufacturingSteps: nextTask.manufacturingSteps });
  }

  function updateManufacturingStepInstruction(stepId: string, instruction: string) {
    if (!task) {
      return;
    }

    const step = manufacturingSteps.find((candidate) => candidate.id === stepId);
    if (!step) {
      return;
    }

    const previousInstruction = getProcedureFieldValue(task.id, stepId, "instruction", step.instruction);
    const reconciledTask = reconcileStepPartMentionsAfterInstructionChange(
      task,
      stepId,
      previousInstruction,
      instruction,
    );
    if (reconciledTask.customFields !== task.customFields) {
      onUpdateTask(task.id, {
        customFields: reconciledTask.customFields,
        manufacturingSteps: task.manufacturingSteps,
      });
    }
    setInstructionSelections((current) => {
      if (!current[stepId]) {
        return current;
      }
      const next = { ...current };
      delete next[stepId];
      return next;
    });
    onProcedureFieldChange(task.id, stepId, "instruction", instruction);
  }

  function captureInstructionSelection(stepId: string, textarea: HTMLTextAreaElement) {
    const selection = instructionTextSelectionFromTextarea(textarea, task ? getStepPartMentions(task, stepId) : []);
    if (!selection) {
      clearInstructionSelection(stepId);
      return;
    }
    setInstructionSelections((current) => ({ ...current, [stepId]: selection }));
  }

  function clearInstructionSelection(stepId: string) {
    setInstructionSelections((current) => {
      if (!current[stepId]) {
        return current;
      }
      const next = { ...current };
      delete next[stepId];
      return next;
    });
  }

  function linkInstructionSelectionToPart(stepId: string, entry: BomPartSelection) {
    if (!task) {
      return;
    }
    const step = manufacturingSteps.find((candidate) => candidate.id === stepId);
    const selection = instructionSelections[stepId];
    if (!step || !selection) {
      return;
    }
    const instruction = getProcedureFieldValue(task.id, stepId, "instruction", step.instruction);
    const nextTask = attachPartMentionToStep(
      task,
      stepId,
      instruction,
      selection,
      entry,
      () => createAnnotationId("part"),
      () => createAnnotationId("part-mention"),
    );
    if (!nextTask) {
      clearInstructionSelection(stepId);
      return;
    }

    onUpdateTask(task.id, {
      customFields: nextTask.customFields,
      manufacturingSteps: nextTask.manufacturingSteps,
      partReferences: nextTask.partReferences,
    });
    clearInstructionSelection(stepId);
  }

  function removeInstructionPartMention(stepId: string, mentionId: string) {
    if (!task) {
      return;
    }
    const nextTask = removeStepPartMention(task, stepId, mentionId);
    onUpdateTask(task.id, {
      customFields: nextTask.customFields,
      manufacturingSteps: task.manufacturingSteps,
    });
  }

  function addManufacturingStepTool(stepId: string, toolName?: string) {
    if (!task) {
      return;
    }

    const nextTool = (toolName ?? newStepToolNames[stepId] ?? "").trim();
    if (!nextTool) {
      return;
    }

    const nextTask = addStepTool(task, stepId, nextTool);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onAddStepTool(task.id, stepId, nextTool, getStepToolList(nextTask, stepId).length);
    setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
  }

  function removeManufacturingStepTool(stepId: string, toolToRemove: string) {
    if (!task) {
      return;
    }

    const nextTask = removeStepTool(task, stepId, toolToRemove);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onRemoveStepTool(stepId, toolToRemove);
  }

  async function uploadManufacturingStepPhotos(stepId: string, files: File[]) {
    if (!task || files.length === 0) {
      return;
    }

    setStepPhotoUploadCounts((current) => ({ ...current, [stepId]: (current[stepId] ?? 0) + 1 }));

    try {
      await onUploadStepPhotos(task.id, stepId, files);
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
    if (!task) {
      return;
    }

    void onRemoveStepPhoto(task.id, stepId, photoId);
  }

  function updateManufacturingStepPhoto(stepId: string, photoId: string, patch: Partial<StepPhotoAttachment>) {
    if (!task) {
      return;
    }

    const nextTask = updateStepPhotoAttachment(task, stepId, photoId, patch);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
  }

  function requestRemoveManufacturingStepPhoto(stepId: string, photo: StepPhotoAttachment) {
    if (!task) {
      return;
    }

    onConfirmAction({
      title: "Delete photo?",
      body: "This removes the photo from the shared step record.",
      tone: "danger",
      confirmLabel: "Delete Photo",
      onConfirm: () => removeManufacturingStepPhoto(stepId, photo.id),
    });
  }

  if (!task) {
    return (
      <section className="ui-workspace-content h-full min-h-0 overflow-hidden p-4">
        <div className="ui-panel p-5 text-sm font-bold text-ink-secondary">
          No task is available for procedure authoring.
        </div>
      </section>
    );
  }

  return (
    <section className="ui-workspace-content ui-procedure-workspace flex h-full min-h-0 overflow-hidden">
      <aside
        style={procedureGridStyle}
        className="ui-procedure-sidebar relative shrink-0 overflow-x-hidden overflow-y-auto"
      >
        <div className="sticky top-0 z-10 rounded-tl-xl bg-canvas px-2 pb-2 pt-3">
          <div className="ui-nav-section mb-0 px-0">Procedure tasks</div>
          <div className="mt-1 text-[11px] text-ink-tertiary">{tasks.length} task rows</div>
        </div>

        <div className="px-2 pb-2">
          {groupedTasks.map((group) => (
            <div key={group.id} className="mb-3 last:mb-0">
              <div className="ui-nav-section ui-procedure-zone-heading mb-1 flex items-center gap-1.5 px-0 normal-case tracking-[0.08em]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="min-w-0 truncate">{group.name}</span>
                <span className="ml-auto tabular-nums">{group.tasks.length}</span>
              </div>
              <div className="space-y-0.5">
                {group.tasks.map((item) => {
                  const active = item.id === task.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectTask(item.id)}
                      title={item.name || "Untitled task"}
                      className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                    >
                      <span className="w-[82px] shrink-0 truncate font-mono text-[10px] tabular-nums text-ink-tertiary">
                        {taskDisplayCode(item)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.name || "Untitled task"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <ScrollDownHint className="pb-1" />
        <button
          type="button"
          onPointerDown={startNavigatorResize}
          className={`absolute right-0 top-0 z-20 hidden h-full w-3 translate-x-1/2 cursor-col-resize touch-none outline-none transition lg:block ${
            isResizingNavigator ? "bg-accent/10" : "hover:bg-accent/10 focus-visible:bg-accent/10"
          }`}
          aria-label="Resize procedure task navigator"
          title="Drag to resize procedure task navigator"
        >
          <span
            className={`absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
              isResizingNavigator ? "bg-accent" : "bg-steel/25"
            }`}
          />
        </button>
      </aside>

      <main
        className="ui-procedure-main min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6"
        aria-busy={isTaskHydrating || undefined}
      >
        <div className="mx-auto max-w-[1500px] space-y-5">
          <section>
            <div className="flex items-start justify-between gap-3">
              <h1 className="ui-section-title ui-procedure-title">{task.name || "Untitled task"}</h1>
              <div className="flex shrink-0 items-center gap-3">
                {isTaskHydrating ? (
                  <span className="ui-transition-status" role="status" aria-live="polite">
                    Loading media
                  </span>
                ) : null}
                <PhonePortalQrButton project={project} />
                <div className="relative" ref={sectionFilterRef}>
                  <button
                    type="button"
                    onClick={() => setIsSectionFilterOpen((open) => !open)}
                    aria-haspopup="true"
                    aria-expanded={isSectionFilterOpen}
                    title="Show or hide step sections"
                    className="ui-btn-ghost h-9 gap-2 px-3"
                  >
                    <SlidersHorizontal size={14} strokeWidth={1.75} />
                    Filter
                    {hiddenStepSections.size > 0 ? (
                      <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                        {hiddenStepSections.size}
                      </span>
                    ) : null}
                  </button>
                  {isSectionFilterOpen ? (
                    <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-line bg-surface-raised p-3 shadow-lg">
                      <div className="ui-field-label mb-2">Show on every step</div>
                      <div className="flex flex-wrap gap-1.5">
                        {PROCEDURE_STEP_SECTIONS.map(({ key, label, Icon }) => {
                          const shown = !hiddenStepSections.has(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => toggleStepSection(key)}
                              aria-pressed={shown}
                              title={shown ? `Hide ${label} on every step` : `Show ${label} on every step`}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
                                shown
                                  ? "border-accent/40 bg-accent/10 text-ink"
                                  : "border-line bg-surface-raised text-ink-secondary opacity-70"
                              }`}
                            >
                              <Icon size={12} strokeWidth={1.75} />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="ui-metric-strip mt-4">
              {[
                ["Zone", zoneById.get(task.zoneId ?? "")?.name ?? "Unzoned"],
                ["Duration", formatMinutes(task.plannedDurationMinutes)],
                ["Man-Hours", formatManHours(currentManHours)],
                ["Operators", `${task.plannedOperators}`],
              ].map(([label, value]) => (
                <StatCard key={label} label={label} value={value} />
              ))}
            </div>
            <StepExplodedViewGallery
              views={getTaskExplodedViews(task)}
              onDelete={(view) => onDeleteExplodedView(task.id, view)}
            />
            <TaskVideoGallery videos={getTaskVideos(task)} onDelete={(video) => onDeleteTaskVideo(task.id, video)} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <label className="block">
              <span className="ui-field-label">Task Description</span>
              <textarea
                className="ui-field-standalone min-h-[96px] h-auto resize-y py-2 leading-relaxed"
                value={task.description ?? ""}
                onChange={(event) => onUpdateTask(task.id, { description: event.target.value })}
                placeholder="Describe the task scope, boundaries, and expected output."
              />
            </label>

            <label className="block">
              <span className="ui-field-label">Safety Notes</span>
              <textarea
                className="ui-field-standalone min-h-[96px] h-auto resize-y py-2 leading-relaxed"
                value={task.safetyNotes ?? ""}
                onChange={(event) => onUpdateTask(task.id, { safetyNotes: event.target.value })}
                placeholder="Safety, lockout, PPE, lifting, or handling notes."
              />
            </label>
          </section>

          <section className="ui-procedure-manufacturing-section">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="ui-setup-section-title">Manufacturing Steps</h2>
                <p className="ui-setup-section-desc">
                  {manufacturingSteps.length} step(s) · step total {formatMinutes(manufacturingStepDurationMinutes)} · {formatManHours(stepDerivedManHours)}
                </p>
              </div>
              <button type="button" onClick={addManufacturingStep} className="ui-btn-ghost h-9 gap-2">
                <Plus size={14} strokeWidth={1.75} />
                Add Step
              </button>
            </div>

            <div className="ui-procedure-steps">
              {manufacturingSteps.length === 0 ? (
                <div className="ui-procedure-empty">
                  Add a blank step to start authoring the procedure for this task.
                </div>
              ) : (
                manufacturingSteps.map((step) => {
                  const stepPhotos = getStepPhotoAttachments(task, step.id);
                  const stepTools = getStepToolList(task, step.id);

                  return (
                    <div key={step.id} data-instruction-step={step.id}
                        className="ui-procedure-step space-y-3">
                      <div>
                        <div className="ui-procedure-step-header mb-1">
                          <div className="ui-procedure-step-header-fields">
                            <label className="ui-procedure-step-title-field">
                              <span className="ui-procedure-step-title">Step {step.sequence}</span>
                              <input
                                aria-label={`Step ${step.sequence} name`}
                                data-step-name-id={step.id}
                                className="ui-procedure-step-inline-text ui-procedure-step-name-input"
                                value={getProcedureFieldValue(task.id, step.id, "name", step.name ?? "")}
                                onFocus={() => onProcedureFieldFocus(task.id, step.id, "name", step.name ?? "")}
                                onBlur={() => onProcedureFieldBlur(task.id, step.id, "name")}
                                onChange={(event) =>
                                  onProcedureFieldChange(task.id, step.id, "name", event.target.value)
                                }
                                placeholder={`Step ${step.sequence} name`}
                              />
                            </label>

                          </div>
                          <div className="ui-procedure-step-toolbar">
                            <div className="ui-procedure-step-metrics">
                              <label className="ui-procedure-step-inline-field">
                                <span className="ui-field-label mb-0">Seq</span>
                                <ClearableNumberInput
                                  aria-label={`Step ${step.sequence} sequence`}
                                  className="number-input ui-procedure-step-inline-value"
                                  value={step.sequence}
                                  min={1}
                                  fallbackValue={step.sequence}
                                  precision={0}
                                  normalize={Math.round}
                                  onValueChange={(value) => moveManufacturingStep(step.id, value)}
                                />
                              </label>
                              <label className="ui-procedure-step-inline-field">
                                <span className="ui-field-label mb-0">Min</span>
                                <ClearableNumberInput
                                  aria-label={`Step ${step.sequence} duration minutes`}
                                  className="number-input ui-procedure-step-inline-value ui-procedure-step-inline-value-wide"
                                  value={step.durationMinutes ?? 0}
                                  min={0}
                                  fallbackValue={step.durationMinutes ?? 0}
                                  precision={1}
                                  onValueChange={(value) => updateManufacturingStep(step.id, { durationMinutes: value })}
                                />
                              </label>
                            </div>
                            {moveTargetTasks.length > 0 ? (
                              <ThemedSelect
                                ariaLabel={`Move step ${step.sequence} to another task`}
                                value=""
                                className="ui-procedure-step-move"
                                triggerClassName="ui-procedure-step-move-trigger"
                                menuAlign="right"
                                menuMinWidth={320}
                                placeholder="Move"
                                options={[
                                  { value: "", label: "Move" },
                                  ...moveTargetTasks.map((targetTask) => ({
                                    value: targetTask.id,
                                    label: taskDisplayCode(targetTask),
                                    description: targetTask.name || "Untitled task",
                                  })),
                                ]}
                                onChange={(targetTaskId) => {
                                  if (!targetTaskId || !task) {
                                    return;
                                  }

                                  const targetTask = moveTargetTasks.find((candidate) => candidate.id === targetTaskId);
                                  onConfirmAction({
                                    title: `Move step ${step.sequence}?`,
                                    body: `Move this step from ${taskDisplayCode(task)} ${task.name || "Untitled task"} to ${
                                      targetTask ? `${taskDisplayCode(targetTask)} ${targetTask.name || "Untitled task"}` : "the selected task"
                                    }. Tools, part links, and photos move with it.`,
                                    tone: "warning",
                                    confirmLabel: "Move Step",
                                    onConfirm: () => onMoveStepToTask(task.id, targetTaskId, step.id),
                                  });
                                }}
                              />
                            ) : null}

                            <button
                              type="button"
                              onClick={() => requestRemoveManufacturingStep(step.id)}
                              className="ui-btn-ghost h-7 gap-1 px-2 text-[10px] text-danger hover:text-danger"
                              title={`Delete step ${step.sequence}`}
                              aria-label={`Delete step ${step.sequence}`}
                            >
                              <Trash2 size={12} strokeWidth={1.75} />
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className={`ui-procedure-card-body ${showPhotos ? "ui-procedure-card-body-with-photos" : ""}`}>
                      {showPhotos ? (
                        <div className="ui-procedure-card-photos">
                          <StepPhotoAttachmentEditor
                            carousel
                            taskId={task.id}
                            step={step}
                            photos={stepPhotos}
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
                          />
                        </div>
                      ) : null}
                        <div className="ui-procedure-step-instruction-field block">
                          <span className="ui-field-label mb-0 block">Instruction</span>
                          <div className="ui-instruction-composer">
                            <div className="ui-instruction-composer-toolbar">
                              <InstructionFormatToolbar sequence={step.sequence}
                              value={getProcedureFieldValue(task.id, step.id, "instruction", step.instruction)}
                              onChange={instruction => updateManufacturingStepInstruction(step.id, instruction)} />
                            </div>
                            <LinkedInstructionTextarea
                              task={task}
                              step={step}
                              aria-label={`Step ${step.sequence} instruction`}
                              className="ui-field-standalone ui-procedure-step-instruction h-auto w-full resize-y"
                              value={getProcedureFieldValue(task.id, step.id, "instruction", step.instruction)}
                              onFocus={() => onProcedureFieldFocus(task.id, step.id, "instruction", step.instruction)}
                              onBlur={() => onProcedureFieldBlur(task.id, step.id, "instruction")}
                              onSelect={(event) => captureInstructionSelection(step.id, event.currentTarget)}
                              onChange={(event) => updateManufacturingStepInstruction(step.id, event.target.value)}
                              onKeyDown={(event) =>
                                handleInstructionBulletKeyDown(event, (instruction) =>
                                  updateManufacturingStepInstruction(step.id, instruction),
                                )
                              }
                              onMentionClick={(mention, anchor) =>
                                setInstructionSelections((current) => ({
                                  ...current,
                                  [step.id]: {
                                    start: mention.start,
                                    end: mention.end,
                                    text: mention.text,
                                    anchor,
                                    mentionId: mention.id,
                                    partReferenceId: mention.partReferenceId,
                                  },
                                }))
                              }
                              placeholder="Write the manufacturing instruction for this operation."
                            />
                          </div>
                        </div>
                        </div>
                        <StepPartMentionEditor
                          task={task}
                          step={step}
                          selection={instructionSelections[step.id]}
                          masterBom={masterBom}
                          onLink={(entry) => linkInstructionSelectionToPart(step.id, entry)}
                          onCancelSelection={() => clearInstructionSelection(step.id)}
                          onRemoveMention={(mentionId) => removeInstructionPartMention(step.id, mentionId)}
                        />
                      </div>



                      {showStepDetails ? (
                      <div className="ui-procedure-step-details">
                        {showChecks ? (
                        <div className="ui-procedure-step-detail">
                          <span className="ui-field-label mb-0 block">Checks</span>
                          <ProcedureStepChecksEditor
                            ariaLabel={`Step ${step.sequence} checks`}
                            definitions={stepCheckDefinitions}
                            qualityCheck={step.qualityCheck}
                            onChange={(qualityCheck) => updateManufacturingStep(step.id, { qualityCheck })}
                          />
                        </div>
                        ) : null}

                        {showTools ? (
                        <div className="ui-procedure-step-detail">
                          <span className="ui-field-label mb-0 block">Tools</span>
                          <div className="ui-procedure-step-add-row">
                            <ProcedureToolPicker
                              value={newStepToolNames[step.id] ?? ""}
                              toolLibrary={toolLibrary}
                              assignedTools={stepTools}
                              stepSequence={step.sequence}
                              onValueChange={(value) =>
                                setNewStepToolNames((current) => ({ ...current, [step.id]: value }))
                              }
                              onAdd={(toolName) => addManufacturingStepTool(step.id, toolName)}
                            />
                          </div>
                          <ProcedureStepToolTable
                            tools={stepTools}
                            registry={projectToolRegistry}
                            onRemove={(toolName) =>
                              onConfirmAction({
                                title: `Remove ${toolName}?`,
                                body: `Remove ${toolName} from step ${step.sequence}.`,
                                tone: "danger",
                                confirmLabel: "Remove Tool",
                                onConfirm: () => removeManufacturingStepTool(step.id, toolName),
                              })
                            }
                            removeAriaLabel={(toolName) => `Remove ${toolName} from step ${step.sequence}`}
                          />
                        </div>
                        ) : null}

                        {showParts ? (
                        <StepPartReferenceEditor
                          task={task}
                          step={step}
                          partReferences={partReferences}
                          masterBom={masterBom}
                          onAddFromBom={(entry) => addStepPartFromBom(step.id, entry)}
                          onLinkExisting={(partReferenceId) => linkExistingPartToManufacturingStep(step.id, partReferenceId)}
                          onQuantityChange={(partReferenceId, quantity) =>
                            updateManufacturingStepPartQuantity(step.id, partReferenceId, quantity)
                          }
                          onRemove={(partReferenceId) => removeManufacturingStepPartReference(step.id, partReferenceId)}
                        />
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            {manufacturingSteps.length > 0 ? (
              <div className="mt-4 flex justify-end border-t border-line pt-3">
                <button
                  type="button"
                  onClick={addManufacturingStep}
                  className="ui-btn-ghost h-9 gap-2"
                  aria-label="Add step after final step"
                >
                  <Plus size={14} strokeWidth={1.75} />
                  Add Step
                </button>
              </div>
            ) : null}
          </section>

          {showParts ? (
          <section>
            <div className="mb-3">
              <h2 className="ui-setup-section-title">Parts Summary</h2>
              <p className="ui-setup-section-desc">
                {allocatedPartSummaries.length} allocated part{allocatedPartSummaries.length === 1 ? "" : "s"} on this task
              </p>
            </div>
            {allocatedPartSummaries.length === 0 ? (
              <div className="ui-procedure-empty">
                Parts added to manufacturing steps will appear here.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-line">
                <table className="w-full min-w-[42rem] border-collapse text-xs" aria-label="Parts allocated across this task">
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
                        className="ui-mono-label w-28 whitespace-nowrap border-b border-line px-3 py-2 text-right text-ink-secondary"
                      >
                        BOM qty
                      </th>
                      <th
                        scope="col"
                        className="ui-mono-label w-32 whitespace-nowrap border-b border-line px-3 py-2 text-right text-ink-secondary"
                      >
                        Allocated qty
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocatedPartSummaries.map(({ part, allocatedQuantity }) => (
                      <tr key={part.id} className="border-b border-line/60 last:border-b-0 hover:bg-surface-raised/50">
                        <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono font-semibold text-ink">
                          {part.partNumber}
                        </td>
                        <td className="whitespace-normal break-words px-3 py-1.5 align-middle leading-4 text-ink-secondary">
                          {part.description || "No description"}
                        </td>
                        <td className="px-3 py-1.5 text-right align-middle font-semibold tabular-nums text-ink-secondary">
                          {part.quantity ?? 1}
                        </td>
                        <td className="px-3 py-1.5 text-right align-middle font-semibold tabular-nums text-ink">
                          {allocatedQuantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          ) : null}
        </div>
        <ScrollDownHint />
      </main>
    </section>
  );
}
