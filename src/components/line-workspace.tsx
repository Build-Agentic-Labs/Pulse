"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  Download,
  Factory,
  FileText,
  FolderKanban,
  GitBranch,
  ImageIcon,
  ListChecks,
  Pause,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Timer,
  Trash2,
} from "lucide-react";
import QRCodeGenerator from "qrcode";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  applyCalculatedFields,
  calculateAvailabilityMinutesForDemandPeriod,
  calculatePeakManpower,
  calculateTaskManHours,
  calculateProductKpis,
  formatMinutes,
  getTopLevelTasks,
  getTaskWindow,
  getTimelineBounds,
  round,
} from "@/domain/calculations";
import { buildOperatorAssignmentsFromIePlan, buildSmartOperatorAssignments, isAllocatableOperatorTask, isSummaryTask } from "@/domain/operator-allocation";
import type { IeSmartAllocationPlan, IeSmartAllocationRequest } from "@/domain/ie-smart-allocation";
import { getTaskOperatorIds, getTaskOperatorResetPatch, syncTaskOperatorCount } from "@/domain/operator-assignments";
import { buildMarkdownReport, buildStationSetupDocumentHtml } from "@/domain/report";
import { initialPlannerState } from "@/domain/seed";
import {
  STEP_PHOTO_ATTACHMENTS_FIELD,
  getStepPhotoAttachments,
  removeStepPhotoAttachment,
  upsertStepPhotoAttachments,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import {
  addStepPartReference,
  getStepPartReferenceIds,
  getStepPartReferences,
  removePartReferenceFromSteps,
  removeStepPartReference,
} from "@/domain/step-part-references";
import { STEP_TOOL_LISTS_FIELD, addStepTool, buildStepToolLibrary, getStepToolList, removeStepTool } from "@/domain/step-tools";
import {
  getManufacturingStepCheckSet,
  manufacturingStepCheckOptions,
  serializeManufacturingStepCheckSet,
} from "@/domain/manufacturing-step-checks";
import { applyInstructionBullets, resolveBulletEnter } from "@/domain/instruction-bullets";
import {
  addStepToolToSupabase,
  loadPlannerStateFromSupabase,
  removeStepToolFromSupabase,
  savePlannerShellToSupabase,
  saveProcedureTaskUpdateToSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  subscribePlannerStateChanges,
  uploadStepPhotoAttachment,
  type SaveState,
} from "@/domain/supabase-planner";
import type {
  DemandPeriod,
  Dependency,
  ManufacturingStep,
  PartReference,
  PlannerProjectContext,
  PlannerState,
  Product,
  ProductStatus,
  Station,
  Task,
  Zone,
} from "@/domain/types";
import { ClearableNumberInput } from "./clearable-number-input";
import { GanttTimeline } from "./gantt-timeline";
import { ThemedFeedbackLayer, type FeedbackConfirm, type FeedbackToast } from "./themed-feedback";
import { WORKER_ICON_LETTERS, WorkerIcon } from "./worker-icon";
import { PlannerDashboardPanel } from "./planner-dashboard-panel";
import { WorkspaceSidebarDrawer } from "./workspace-sidebar-drawer";

type ProductNumberField =
  | "targetManHours"
  | "demandQuantity"
  | "grossAvailableMinutes"
  | "breakMinutes"
  | "lunchMinutes"
  | "meetingMinutes"
  | "plannedDowntimeMinutes"
  | "workDaysPerWeek"
  | "workWeeksPerMonth"
  | "manualTaktMinutes";

type ProductTextField = "name" | "sku" | "revision" | "ownerName" | "status" | "demandPeriod";

type StepPartReferenceEditorProps = {
  task: Task;
  step: ManufacturingStep;
  partReferences: PartReference[];
  draftValue: string;
  compact?: boolean;
  onDraftChange: (value: string) => void;
  onAddDraft: () => void;
  onLinkExisting: (partReferenceId: string) => void;
  onRemove: (partReferenceId: string) => void;
};

type StepPhotoAttachmentEditorProps = {
  step: ManufacturingStep;
  photos: StepPhotoAttachment[];
  compact?: boolean;
  isUploading?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRemove: (photoId: string) => void;
};

const demandPeriodOptions: Array<{ value: DemandPeriod; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

const modules = [
  { id: "dashboard", label: "Dashboard", icon: Factory },
  { id: "setup", label: "Setup", icon: ClipboardList },
  { id: "gantt", label: "Gantt", icon: GitBranch },
  { id: "procedure", label: "Procedure", icon: ListChecks },
  { id: "balance", label: "Balance", icon: BarChart3 },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

const playbackSpeeds = [
  { label: "1m/s", value: 1 },
  { label: "5m/s", value: 5 },
  { label: "15m/s", value: 15 },
  { label: "1h/s", value: 60 },
];

const MAX_STEP_PHOTO_EDGE = 1280;
const STEP_PHOTO_JPEG_QUALITY = 0.72;
const PROCEDURE_SAVE_DEBOUNCE_MS = 750;
const PROCEDURE_DRAFT_STORAGE_KEY = "buildlogic-line-planner-procedure-draft-v1";

type ProcedureDraftSnapshot = {
  taskId: string;
  task: Task;
  savedAt: string;
};

function readProcedureDraftSnapshot() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawDraft = window.localStorage.getItem(PROCEDURE_DRAFT_STORAGE_KEY);
    if (!rawDraft) {
      return undefined;
    }

    const parsed = JSON.parse(rawDraft) as Partial<ProcedureDraftSnapshot>;
    if (!parsed.taskId || !parsed.task || typeof parsed.task !== "object") {
      return undefined;
    }

    return parsed as ProcedureDraftSnapshot;
  } catch {
    return undefined;
  }
}

function writeProcedureDraftSnapshot(task: Task) {
  if (typeof window === "undefined") {
    return;
  }

  const draft: ProcedureDraftSnapshot = {
    taskId: task.id,
    task,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(PROCEDURE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The in-memory editor state remains the immediate source of truth if local storage is unavailable.
  }
}

function clearProcedureDraftSnapshot(taskId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (taskId) {
    const currentDraft = readProcedureDraftSnapshot();
    if (currentDraft && currentDraft.taskId !== taskId) {
      return;
    }
  }

  try {
    window.localStorage.removeItem(PROCEDURE_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore local storage cleanup failures.
  }
}

function applyProcedureVersionSnapshot(task: Task, versionSource: Task) {
  const sourceStepById = new Map((versionSource.manufacturingSteps ?? []).map((step) => [step.id, step]));

  return {
    ...task,
    version: versionSource.version,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
      ...step,
      version: sourceStepById.get(step.id)?.version ?? step.version,
    })),
  };
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read compressed photo."));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to read ${file.name || "photo"}.`));
    };
    image.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Unable to compress photo."));
      },
      "image/jpeg",
      STEP_PHOTO_JPEG_QUALITY,
    );
  });
}

async function buildStepPhotoAttachment(file: File): Promise<StepPhotoAttachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name || "Selected file"} is not an image.`);
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_STEP_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare photo compression.");
  }

  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToJpegBlob(canvas);
  const dataUrl = await readBlobAsDataUrl(blob);

  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "Step photo.jpg",
    dataUrl,
    capturedAt: new Date().toISOString(),
    contentType: blob.type,
    sizeBytes: blob.size,
    width,
    height,
  };
}

function isCustomFieldRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function removeStepScopedCustomFields(task: Task, stepId: string): Task {
  const nextCustomFields = { ...task.customFields };

  [STEP_PHOTO_ATTACHMENTS_FIELD, STEP_TOOL_LISTS_FIELD].forEach((field) => {
    const fieldValue = nextCustomFields[field];

    if (!isCustomFieldRecord(fieldValue)) {
      return;
    }

    const nextMap = { ...fieldValue };
    delete nextMap[stepId];

    if (Object.keys(nextMap).length > 0) {
      nextCustomFields[field] = nextMap;
    } else {
      delete nextCustomFields[field];
    }
  });

  return {
    ...task,
    customFields: nextCustomFields,
  };
}

function applyTextareaCursor(textarea: HTMLTextAreaElement, cursorPosition: number) {
  window.requestAnimationFrame(() => {
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  });
}

function handleInstructionBulletKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  onValue: (value: string) => void,
) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  const textarea = event.currentTarget;
  const nextValue = resolveBulletEnter(textarea.value, textarea.selectionStart, textarea.selectionEnd);

  if (!nextValue) {
    return;
  }

  event.preventDefault();
  onValue(nextValue.value);
  applyTextareaCursor(textarea, nextValue.selectionStart);
}

function addMinutes(iso: string, minutes: number) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function taskDependencyRefBelongsTo(ref: string, taskIds: Set<string>) {
  if (taskIds.has(ref)) {
    return true;
  }

  if (!ref.startsWith("step:")) {
    return false;
  }

  const [, taskId] = ref.split(":");
  return taskId ? taskIds.has(taskId) : false;
}

function taskDependsOn(
  taskMap: Map<string, Task>,
  taskId: string,
  dependencyId: string,
  visited = new Set<string>(),
): boolean {
  if (taskId === dependencyId) {
    return true;
  }

  if (visited.has(taskId)) {
    return false;
  }

  visited.add(taskId);
  const task = taskMap.get(taskId);

  if (!task) {
    return false;
  }

  return task.dependencyIds.some((nextDependencyId) =>
    taskDependsOn(taskMap, nextDependencyId, dependencyId, visited),
  );
}

function wouldCreateDependencyCycle(tasks: Task[], targetTaskId: string, predecessorTaskId: string): boolean {
  if (targetTaskId === predecessorTaskId) {
    return true;
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  return taskDependsOn(taskMap, predecessorTaskId, targetTaskId);
}

function sanitizeDependencyIds(tasks: Task[], taskId: string, dependencyIds: string[]) {
  const validTaskIds = new Set(tasks.map((task) => task.id));

  return [...new Set(dependencyIds)].filter(
    (dependencyId) =>
      dependencyId !== taskId &&
      validTaskIds.has(dependencyId) &&
      !wouldCreateDependencyCycle(tasks, taskId, dependencyId),
  );
}

function relinkTasksForDependency(tasks: Task[], targetTaskId: string, predecessorTaskId: string) {
  if (targetTaskId === predecessorTaskId) {
    return tasks;
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const targetTask = taskMap.get(targetTaskId);
  const predecessorTask = taskMap.get(predecessorTaskId);

  if (!targetTask || !predecessorTask || targetTask.dependencyIds.includes(predecessorTaskId)) {
    return tasks;
  }

  let nextTasks = tasks;

  if (wouldCreateDependencyCycle(tasks, targetTaskId, predecessorTaskId)) {
    const dependencyEdgesToRemove = new Set<string>();

    function collectCycleBreakingEdges(taskId: string, visited = new Set<string>()) {
      if (visited.has(taskId)) {
        return;
      }

      visited.add(taskId);
      const task = taskMap.get(taskId);

      if (!task) {
        return;
      }

      task.dependencyIds.forEach((dependencyId) => {
        if (dependencyId === targetTaskId) {
          dependencyEdgesToRemove.add(`${task.id}:${dependencyId}`);
          return;
        }

        if (taskDependsOn(taskMap, dependencyId, targetTaskId)) {
          collectCycleBreakingEdges(dependencyId, visited);
        }
      });
    }

    collectCycleBreakingEdges(predecessorTaskId);

    nextTasks = tasks.map((task) => {
      const dependencyIds = task.dependencyIds.filter(
        (dependencyId) => !dependencyEdgesToRemove.has(`${task.id}:${dependencyId}`),
      );

      return dependencyIds.length === task.dependencyIds.length ? task : { ...task, dependencyIds };
    });
  }

  return nextTasks.map((task) =>
    task.id === targetTaskId
      ? { ...task, dependencyIds: [...new Set([...task.dependencyIds, predecessorTaskId])] }
      : task,
  );
}

function rebuildDependenciesFromTasks(tasks: Task[], existingDependencies: Dependency[]) {
  const existingByKey = new Map(
    existingDependencies.map((dependency) => [
      `${dependency.predecessorTaskId}:${dependency.successorTaskId}`,
      dependency,
    ]),
  );

  return tasks.flatMap((task) =>
    task.dependencyIds.map((predecessorTaskId, index) => {
      const existing = existingByKey.get(`${predecessorTaskId}:${task.id}`);

      return {
        id: existing?.id ?? `dep-${predecessorTaskId}-${task.id}-${index}`,
        predecessorTaskId,
        successorTaskId: task.id,
        type: existing?.type ?? "finish_to_start",
        lagMinutes: existing?.lagMinutes,
        constraintType: existing?.constraintType ?? (task.qualityGate ? "quality" : undefined),
      } satisfies Dependency;
    }),
  );
}

function rescheduleTasksByDependencies(tasks: Task[]) {
  if (tasks.length === 0) {
    return tasks;
  }

  const baseStartMs = Date.parse(tasks[0].plannedStart);
  const lineStartMs = Number.isFinite(baseStartMs) ? baseStartMs : Date.now();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const scheduledById = new Map<string, { startMs: number; finishMs: number }>();
  const visiting = new Set<string>();

  function resolveSchedule(taskId: string): { startMs: number; finishMs: number } {
    const existing = scheduledById.get(taskId);
    if (existing) {
      return existing;
    }

    const task = taskById.get(taskId);
    if (!task) {
      return { startMs: lineStartMs, finishMs: lineStartMs };
    }

    if (visiting.has(taskId)) {
      const fallbackFinish = Date.parse(task.plannedFinish);
      const finishMs = Number.isFinite(fallbackFinish) ? fallbackFinish : lineStartMs;
      const durationMs = Math.max(task.plannedDurationMinutes, 0) * 60_000;
      return { startMs: Math.max(lineStartMs, finishMs - durationMs), finishMs: Math.max(lineStartMs, finishMs) };
    }

    visiting.add(taskId);

    const plannedStartMs = Date.parse(task.plannedStart);
    const manualStartMs = Number.isFinite(plannedStartMs) ? Math.max(lineStartMs, plannedStartMs) : lineStartMs;
    const dependencyFinishMs = task.dependencyIds.reduce((latestFinish, dependencyId) => {
      const predecessor = taskById.get(dependencyId);
      if (!predecessor) {
        return latestFinish;
      }

      return Math.max(latestFinish, resolveSchedule(predecessor.id).finishMs);
    }, lineStartMs);
    const startMs = Math.max(lineStartMs, manualStartMs, dependencyFinishMs);
    const finishMs = startMs + Math.max(task.plannedDurationMinutes, 0) * 60_000;
    const schedule = { startMs, finishMs };
    scheduledById.set(taskId, schedule);
    visiting.delete(taskId);

    return schedule;
  }

  return tasks.map((task) => {
    const { startMs, finishMs } = resolveSchedule(task.id);

    return {
      ...task,
      plannedStart: new Date(startMs).toISOString(),
      plannedFinish: new Date(finishMs).toISOString(),
    };
  });
}

function getTaskProcessNumber(task: Task) {
  return task.wbs.split(".")[0] || task.wbs;
}

function getTaskWbsSuffix(task: Task) {
  const parts = task.wbs.split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : "";
}

function normalizeTaskGroupZones(tasks: Task[]) {
  const tasksByProcess = tasks.reduce((groups, task) => {
    const processNumber = getTaskProcessNumber(task);
    const group = groups.get(processNumber);
    if (group) {
      group.push(task);
    } else {
      groups.set(processNumber, [task]);
    }

    return groups;
  }, new Map<string, Task[]>());

  const zoneIdByProcess = new Map<string, string | undefined>();

  tasksByProcess.forEach((groupTasks, processNumber) => {
    const topLevelTask = groupTasks.find((task) => task.wbs === processNumber);
    zoneIdByProcess.set(processNumber, topLevelTask ? topLevelTask.zoneId : groupTasks.find((task) => task.zoneId)?.zoneId);
  });

  return tasks.map((task) => {
    const zoneId = zoneIdByProcess.get(getTaskProcessNumber(task));
    return task.zoneId === zoneId ? task : { ...task, zoneId };
  });
}

function stationIdForZone(zoneId: string) {
  return `station-${zoneId}`;
}

function stationIdForUnzoned(scenarioId: string) {
  return `station-${scenarioId}-unzoned`;
}

function normalizeTaskPlanningContext(tasks: Task[], zones: Zone[], stations: Station[], scenarioId: string) {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const zoneNormalizedTasks = normalizeTaskGroupZones(tasks);
  const stationNormalizedTasks = zoneNormalizedTasks.map((task) => {
    if (task.zoneId && zoneById.has(task.zoneId)) {
      const stationId = stationIdForZone(task.zoneId);
      return task.stationId === stationId ? task : { ...task, stationId };
    }

    if (zones.length === 0 && stationById.has(task.stationId)) {
      return task;
    }

    const stationId = stationIdForUnzoned(task.scenarioId || scenarioId);
    return task.stationId === stationId ? task : { ...task, stationId };
  });
  const stationIdsInUse = new Set(stationNormalizedTasks.map((task) => task.stationId).filter(Boolean));
  const generatedStations = zones.reduce<Station[]>((stationsDraft, zone) => {
      const stationId = stationIdForZone(zone.id);
      const zoneTasks = stationNormalizedTasks.filter((task) => task.stationId === stationId);
      if (zoneTasks.length === 0) {
        return stationsDraft;
      }

      const existing = stationById.get(stationId);
      stationsDraft.push({
        id: stationId,
        scenarioId: zone.scenarioId,
        sequence: zone.sequence,
        name: zone.name || "Untitled zone",
        description: existing?.description,
        ownerName: existing?.ownerName ?? "",
        plannedCycleMinutes: 0,
        plannedOperators: calculatePeakManpower(zoneTasks),
        plannedManHours: 0,
        taktStatus: "missing",
        bottleneckFlag: false,
        area: zone.name || "Untitled zone",
        toolsRequired: existing?.toolsRequired,
        equipmentRequired: existing?.equipmentRequired,
        safetyNotes: existing?.safetyNotes,
        qcNotes: existing?.qcNotes,
      });
      return stationsDraft;
    }, []);

  const unzonedTasks = stationNormalizedTasks.filter((task) => task.stationId === stationIdForUnzoned(task.scenarioId || scenarioId));
  if (unzonedTasks.length > 0) {
    const stationId = stationIdForUnzoned(scenarioId);
    const existing = stationById.get(stationId);
    generatedStations.push({
      id: stationId,
      scenarioId,
      sequence: zones.length + 1,
      name: "Unzoned",
      description: existing?.description,
      ownerName: existing?.ownerName ?? "",
      plannedCycleMinutes: 0,
      plannedOperators: calculatePeakManpower(unzonedTasks),
      plannedManHours: 0,
      taktStatus: "missing",
      bottleneckFlag: false,
      area: "Unzoned",
    });
  }

  const passthroughStations = zones.length === 0
    ? stations.filter((station) => stationIdsInUse.has(station.id))
    : [];

  return {
    stations: [...generatedStations, ...passthroughStations],
    tasks: stationNormalizedTasks,
  };
}

function buildProcessStationForTask(task: Task, tasks: Task[], bottleneckStationId?: string): Station {
  const processNumber = getTaskProcessNumber(task);
  const groupTasks = tasks.filter((candidate) => getTaskProcessNumber(candidate) === processNumber);
  const topLevelTask = groupTasks.find((candidate) => candidate.wbs === processNumber) ?? task;
  const plannedCycleMinutes = groupTasks.reduce((total, candidate) => total + candidate.plannedDurationMinutes, 0);
  const plannedManHours = groupTasks.reduce((total, candidate) => total + calculateTaskManHours(candidate), 0);

  return {
    id: topLevelTask.id,
    scenarioId: topLevelTask.scenarioId,
    sequence: Number.parseFloat(processNumber) || 0,
    name: topLevelTask.name || `Process ${processNumber}`,
    description: topLevelTask.description,
    ownerName: topLevelTask.ownerName ?? "",
    plannedCycleMinutes,
    plannedOperators: topLevelTask.plannedOperators,
    plannedManHours,
    taktStatus: "missing",
    bottleneckFlag: topLevelTask.id === bottleneckStationId,
  };
}

function safeNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatManHours(value: number) {
  return `${round(value, 1)} MH`;
}

function periodLabel(period: DemandPeriod) {
  return period === "week"
    ? "week"
    : period === "month"
      ? "month"
      : period === "year"
        ? "year"
        : period === "day"
          ? "day"
          : period === "shift"
            ? "shift"
            : "period";
}

type SmartAllocationResult = ReturnType<typeof buildSmartOperatorAssignments>;

async function requestIeSmartAllocationPlan(request: IeSmartAllocationRequest): Promise<IeSmartAllocationPlan> {
  const response = await fetch("/api/smart-allocation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Smart allocation agent failed.");
  }

  if (!payload.plan) {
    throw new Error("Smart allocation agent did not return a plan.");
  }

  return payload.plan as IeSmartAllocationPlan;
}

function markdownCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function formatSignedMinutes(minutes: number) {
  if (Math.abs(minutes) < 1) {
    return "0m";
  }

  const prefix = minutes > 0 ? "+" : "-";
  return `${prefix}${formatMinutes(Math.abs(minutes))}`;
}

function formatRelativeFromBounds(iso: string, startMs: number) {
  const valueMs = Date.parse(iso);
  if (!Number.isFinite(valueMs)) {
    return "n/a";
  }

  return formatMinutes((valueMs - startMs) / 60000);
}

function issueReviewLabel(issue: SmartAllocationResult["issues"][number]) {
  if (issue.kind === "unassigned_task") {
    if (issue.reason === "single_operator_period_capacity") {
      return "exceeds one-operator period capacity";
    }

    if (issue.reason === "all_operators_occupied") {
      return "all operators occupied during window";
    }

    if (issue.reason === "all_operators_over_capacity") {
      return "no operator has remaining capacity";
    }

    if (issue.reason === "no_operators") {
      return "no budgeted operators";
    }

    return "schedule/capacity blocked";
  }

  if (issue.kind === "takt_overage") {
    return "exceeds takt";
  }

  if (issue.kind === "budget_overage") {
    return "over budgeted allocation";
  }

  if (issue.kind === "capacity_overage") {
    return "over physical capacity";
  }

  return "schedule conflict";
}

interface UnallocatedWorkReview {
  taskId: string;
  taskLabel: string;
  classification: "Physically infeasible" | "Window blocked" | "Capacity blocked" | "Policy blocked";
  condition: string;
  impact: string;
  recommendation: string;
  action: string;
}

function buildUnallocatedWorkReviews({
  allocation,
  kpis,
  operatorCapacityMinutes,
  product,
}: {
  allocation: SmartAllocationResult;
  kpis: ReturnType<typeof calculateProductKpis>;
  operatorCapacityMinutes: number;
  product: Product;
}): UnallocatedWorkReview[] {
  const bounds = getTimelineBounds(allocation.tasks);
  const taskById = new Map(allocation.tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();

  return allocation.issues
    .filter((issue) => issue.kind === "unassigned_task" && issue.taskId)
    .map((issue) => {
      const task = issue.taskId ? taskById.get(issue.taskId) : undefined;
      if (!task || seen.has(task.id)) {
        return undefined;
      }

      seen.add(task.id);
      const taskLabel = `${task.wbs} ${task.name}`;
      const taskPeriodLoadMinutes = task.plannedDurationMinutes * Math.max(product.demandQuantity, 0);
      const taskWindow = `${formatRelativeFromBounds(task.plannedStart, bounds.startMs)}-${formatRelativeFromBounds(task.plannedFinish, bounds.startMs)}`;
      const overTaktText = kpis.taktMinutes > 0 && task.plannedDurationMinutes > kpis.taktMinutes
        ? ` Duration ${formatMinutes(task.plannedDurationMinutes)} is over takt ${formatMinutes(kpis.taktMinutes)}.`
        : "";

      if (issue.reason === "single_operator_period_capacity") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Physically infeasible" as const,
          condition: "Exceeds one-operator period capacity",
          impact: `${formatMinutes(taskPeriodLoadMinutes)} required per ${periodLabel(product.demandPeriod)} vs ${formatMinutes(operatorCapacityMinutes)} available.${overTaktText}`,
          recommendation: "Split the task, reduce duration, add capacity/overtime, or model this as dedicated resource work.",
          action: "Split task / add capacity",
        };
      }

      if (issue.reason === "all_operators_occupied") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Window blocked" as const,
          condition: "All operators occupied during scheduled window",
          impact: `No budgeted operator is free from ${taskWindow}.`,
          recommendation: "Move the task window, move competing work, add an operator, or split/sequence the task.",
          action: "Move work / add operator",
        };
      }

      if (issue.reason === "all_operators_over_capacity" || issue.reason === "no_operators") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Capacity blocked" as const,
          condition: issue.reason === "no_operators" ? "No budgeted operators available" : "No operator has remaining period capacity",
          impact: `${formatMinutes(taskPeriodLoadMinutes)} more period load is required for this task.`,
          recommendation: "Increase the budgeted labor pool, reduce assigned load, or move this work outside the constrained period.",
          action: "Add capacity",
        };
      }

      if (issue.reason === "mixed_constraints") {
        return {
          taskId: task.id,
          taskLabel,
          classification: "Window blocked" as const,
          condition: "Schedule and capacity constraints both block assignment",
          impact: `Every operator is blocked by overlap or remaining capacity during ${taskWindow}.`,
          recommendation: "Review the competing work in the same time window, then move or split one of the tasks.",
          action: "Review conflicts",
        };
      }

      return {
        taskId: task.id,
        taskLabel,
        classification: "Policy blocked" as const,
        condition: issueReviewLabel(issue),
        impact: issue.message,
        recommendation: "Review priority, then manually override or adjust the task plan if this work must be staffed.",
        action: "Review priority",
      };
    })
    .filter((review): review is UnallocatedWorkReview => Boolean(review));
}

function buildMarkdownTable(headers: string[], rows: Array<Array<unknown>>) {
  if (rows.length === 0) {
    return "_No rows._";
  }

  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

function buildSmartAllocationReviewText({
  agentPlan,
  allocation,
  applicationStatus,
  availableOperatorLetters,
  kpis,
  operatorCapacityMinutes,
  product,
  zones,
}: {
  agentPlan?: IeSmartAllocationPlan;
  allocation: SmartAllocationResult;
  applicationStatus?: {
    applied: boolean;
    appliedTaskCount: number;
    proposedTaskCount: number;
    rejectionReason?: string;
  };
  availableOperatorLetters: string[];
  kpis: ReturnType<typeof calculateProductKpis>;
  operatorCapacityMinutes: number;
  product: Product;
  zones: Zone[];
}) {
  const bounds = getTimelineBounds(allocation.tasks);
  const zoneNameById = new Map(zones.map((zone) => [zone.id, zone.name || "Untitled zone"]));
  const taskById = new Map(allocation.tasks.map((task) => [task.id, task]));
  const sortedTasks = [...allocation.tasks].sort((left, right) => Number.parseFloat(left.wbs) - Number.parseFloat(right.wbs));
  const unallocatedWorkReviews = buildUnallocatedWorkReviews({
    allocation,
    kpis,
    operatorCapacityMinutes,
    product,
  });
  const issueRows = allocation.issues.map((issue) => {
    const task = issue.taskId ? taskById.get(issue.taskId) : undefined;
    const conflictingTask = issue.conflictingTaskId ? taskById.get(issue.conflictingTaskId) : undefined;
    return [
      issue.severity ?? "warning",
      issue.kind,
      task ? `${task.wbs} ${task.name}` : "",
      issue.operatorId ?? "",
      conflictingTask ? `${conflictingTask.wbs} ${conflictingTask.name}` : "",
      issueReviewLabel(issue),
      issue.message,
    ];
  });
  const operatorRows = allocation.audit.operators.map((operator) => [
    operator.operatorId,
    operator.assignedTaskCount,
    formatMinutes(operator.assignedMinutes),
    `${round(operator.utilizationPercent, 1)}%`,
    formatSignedMinutes(operator.budgetVarianceMinutes),
    operator.idleGapCount,
    formatMinutes(operator.idleMinutes),
    operator.sameZoneHandoffCount,
    operator.zoneSwitchCount,
    operator.assignedTaskLabels.join("; "),
  ]);
  const taskRows = sortedTasks.map((task) => {
    const operatorIds = getTaskOperatorIds(task, availableOperatorLetters);
    const summary = isSummaryTask(task, allocation.tasks);
    const allocatable = isAllocatableOperatorTask(task, allocation.tasks);
    return [
      task.wbs,
      task.rowType,
      summary ? "yes" : "no",
      allocatable ? "yes" : "no",
      task.zoneId ? zoneNameById.get(task.zoneId) ?? task.zoneId : "Unzoned",
      task.stationId,
      task.name,
      formatRelativeFromBounds(task.plannedStart, bounds.startMs),
      formatRelativeFromBounds(task.plannedFinish, bounds.startMs),
      formatMinutes(task.plannedDurationMinutes),
      task.plannedOperators,
      operatorIds.join(", ") || "-",
      formatManHours(calculateTaskManHours(task)),
      task.dependencyIds.map((dependencyId) => taskById.get(dependencyId)?.wbs ?? dependencyId).join(", ") || "-",
      kpis.taktMinutes > 0 && task.plannedDurationMinutes > kpis.taktMinutes ? "yes" : "no",
      task.criticalPath ? "critical" : task.bottleneckFlag ? "bottleneck" : "",
    ];
  });
  const agentReviewRows = (agentPlan?.reviewItems ?? []).map((item) => {
    const task = item.taskId ? taskById.get(item.taskId) : undefined;
    return [
      item.severity,
      task ? `${task.wbs} ${task.name}` : "",
      item.message,
      item.recommendation,
    ];
  });
  const agentScheduleRows = (agentPlan?.operatorSchedules ?? []).map((schedule) => [
    schedule.operatorId,
    schedule.sequence
      .map((item) => {
        const task = taskById.get(item.taskId);
        return `${formatMinutes(item.startMinute)}-${formatMinutes(item.finishMinute)} ${task ? `${task.wbs} ${task.name}` : item.taskId}`;
      })
      .join("; "),
  ]);
  const unallocatedWorkRows = unallocatedWorkReviews.map((review) => [
    review.taskLabel,
    review.classification,
    review.condition,
    review.impact,
    review.recommendation,
    review.action,
  ]);

  return [
    "# Smart Allocation Review Packet",
    "",
    "## Allocation Inputs",
    `- Product: ${product.name}`,
    `- Demand: ${product.demandQuantity} unit(s) per ${periodLabel(product.demandPeriod)}`,
    `- Net available time per ${periodLabel(product.demandPeriod)}: ${formatMinutes(operatorCapacityMinutes)}`,
    `- Required takt: ${formatMinutes(kpis.taktMinutes)}`,
    `- Target labor content: ${formatManHours(product.targetManHours)} per unit`,
    `- Budgeted crew equivalent: ${round(kpis.budgetedCrewEquivalent, 2)} FTE`,
    `- Whole-person staffing requirement: ${kpis.wholePersonStaffingRequirement}`,
    `- Required average allocation: ${round(kpis.requiredAverageAllocationPercent, 1)}%`,
    `- Full planned MH/unit after allocation: ${formatManHours(kpis.plannedManHours)}`,
    `- Assigned planned MH/unit: ${formatManHours(kpis.assignedPlannedManHours)}`,
    `- Unassigned planned MH/unit: ${formatManHours(kpis.unassignedPlannedManHours)} across ${kpis.unassignedTaskCount} task(s)`,
    `- Planned FTE after allocation: ${round(kpis.plannedLaborLoadFte, 2)} FTE`,
    `- Assigned FTE after allocation: ${round(kpis.assignedLaborLoadFte, 2)} FTE`,
    `- Available operators: ${availableOperatorLetters.join(", ") || "none"}`,
    `- Operator capacity basis: ${formatMinutes(operatorCapacityMinutes)} per operator per ${periodLabel(product.demandPeriod)}`,
    ...(applicationStatus
      ? [
          `- Proposed task changes: ${applicationStatus.proposedTaskCount}`,
          `- Applied to Gantt: ${applicationStatus.applied ? `yes, ${applicationStatus.appliedTaskCount} task(s)` : "no"}`,
          ...(applicationStatus.rejectionReason ? [`- Application blocker: ${applicationStatus.rejectionReason}`] : []),
        ]
      : []),
    ...(agentPlan
      ? [
          "",
          "## IE Agent Summary",
          agentPlan.summary,
          "",
          "## IE Agent Review",
          buildMarkdownTable(["Severity", "Task", "Message", "Recommendation"], agentReviewRows),
          "",
          "## IE Agent Claimed Operator Schedule",
          buildMarkdownTable(["Operator", "Sequence"], agentScheduleRows),
        ]
      : []),
    "",
    "## Allocation Rules Used",
    ...allocation.audit.strategyNotes.map((note) => `- ${note}`),
    "",
    "## Audit Summary",
    `- Eligible task rows: ${allocation.audit.eligibleTaskCount}`,
    `- Assigned task rows: ${allocation.audit.assignedTaskCount}`,
    `- Unassigned task rows: ${allocation.audit.unassignedTaskCount}`,
    `- Coverage: ${round(allocation.audit.assignmentCoveragePercent, 1)}%`,
    `- Summary rows checked: ${allocation.audit.summaryTaskCount}`,
    `- Summary rows with assignments: ${allocation.audit.summaryTaskAssignmentCount}`,
    `- Peak manpower: ${allocation.audit.peakManpower}`,
    `- Blockers: ${allocation.audit.blockerCount}`,
    `- Warnings: ${allocation.audit.warningCount}`,
    `- Schedule conflicts: ${allocation.audit.scheduleConflictCount}`,
    `- Physical capacity overages: ${allocation.audit.physicalCapacityOverageCount}`,
    `- Budget overages: ${allocation.audit.budgetOverageCount}`,
    `- Takt overages: ${allocation.audit.taktOverageCount}`,
    `- Load spread: ${formatMinutes(allocation.audit.loadSpreadMinutes)} (${round(allocation.audit.loadSpreadPercent, 1)}%)`,
    ...(unallocatedWorkReviews.length
      ? [
          `- Plan status: Feasible with ${unallocatedWorkReviews.length} required work exception(s)`,
        ]
      : ["- Plan status: Feasible"]),
    "",
    "## Unallocated Required Work",
    buildMarkdownTable(
      ["Task", "Classification", "Condition", "Impact", "Recommended Fix", "Action"],
      unallocatedWorkRows,
    ),
    "",
    "## Operator Load Audit",
    buildMarkdownTable(
      ["Operator", "Tasks", "Assigned Time", "Utilization", "Budget Variance", "Idle Gaps", "Idle Time", "Same-Zone Handoffs", "Zone Switches", "Assigned Tasks"],
      operatorRows,
    ),
    "",
    "## Review Issues",
    buildMarkdownTable(["Severity", "Kind", "Task", "Operator", "Conflict", "Review Label", "Message"], issueRows),
    "",
    "## Gantt Allocation Data",
    buildMarkdownTable(
      ["WBS", "Row Type", "Summary", "Allocatable", "Zone", "Station ID", "Task", "Start", "Finish", "Duration", "Headcount", "Operators", "MH", "Dependencies", "Over Takt", "Flag"],
      taskRows,
    ),
  ].join("\n");
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "green" || status === "released" || status === "complete"
      ? "border-teal/20 bg-teal/10 text-teal"
      : status === "yellow" || status === "review" || status === "ready" || status === "in_progress"
        ? "border-amber/30 bg-amber/20 text-[#7a4e09]"
        : status === "red" || status === "blocked" || status === "qc_hold" || status === "rework"
          ? "border-signal/25 bg-signal/10 text-signal"
          : "border-line bg-[#f4f0e7] text-steel";

  return (
    <span className={`inline-flex h-6 items-center rounded border px-2 text-[11px] font-bold uppercase ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

function NumericField({
  label,
  value,
  suffix,
  onChange,
  precision,
  normalize,
  readOnly = false,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  onChange: (value: number) => void;
  precision?: number;
  normalize?: (value: number) => number;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">{label}</span>
      <div className={`flex h-10 items-center overflow-hidden rounded border border-line ${readOnly ? "bg-[#f4f0e7]" : "bg-white"}`}>
        <ClearableNumberInput
          className={`number-input h-full min-w-0 flex-1 px-3 text-sm font-semibold outline-none ${
            readOnly ? "cursor-default bg-[#f4f0e7] text-steel" : "text-ink"
          }`}
          value={value}
          min={0}
          fallbackValue={value ?? 0}
          precision={precision}
          normalize={normalize}
          readOnly={readOnly}
          aria-readonly={readOnly}
          onValueChange={(nextValue) => {
            if (!readOnly) {
              onChange(nextValue);
            }
          }}
        />
        {suffix ? <span className="border-l border-line px-2 text-xs font-semibold text-steel">{suffix}</span> : null}
      </div>
    </label>
  );
}

function StepPhotoAttachmentEditor({
  step,
  photos,
  compact = false,
  isUploading = false,
  onFilesSelected,
  onRemove,
}: StepPhotoAttachmentEditorProps) {
  const thumbnailClass = compact ? "h-14 w-16" : "h-20 w-24";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-steel">
          <ImageIcon size={compact ? 12 : 13} />
          Photos
          {photos.length > 0 ? <span className="text-steel/70">({photos.length})</span> : null}
        </div>
        <label
          className={`inline-flex cursor-pointer items-center gap-1 rounded border border-line bg-white font-black uppercase text-graphite hover:border-copper hover:text-copper ${
            compact ? "h-7 px-2 text-[10px]" : "h-8 px-2.5 text-[10px]"
          } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
        >
          <ImageIcon size={compact ? 12 : 13} />
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

      {photos.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo) => (
            <div key={photo.id} className={compact ? "w-16 shrink-0" : "w-24 shrink-0"}>
              <div className="relative">
                <img
                  src={photo.dataUrl}
                  alt={`Step ${step.sequence} photo`}
                  className={`${thumbnailClass} rounded border border-line object-cover`}
                />
                <button
                  type="button"
                  onClick={() => onRemove(photo.id)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-white/90 text-steel shadow-sm hover:text-signal"
                  aria-label={`Remove photo from step ${step.sequence}`}
                  title="Remove photo"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="mt-1 truncate text-[10px] font-bold text-steel" title={photo.name}>
                {photo.name}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-dashed border-line pt-2 text-xs font-semibold text-steel">
          No photos attached to this step yet.
        </div>
      )}
    </div>
  );
}

function StepPartReferenceEditor({
  task,
  step,
  partReferences,
  draftValue,
  compact = false,
  onDraftChange,
  onAddDraft,
  onLinkExisting,
  onRemove,
}: StepPartReferenceEditorProps) {
  const linkedPartIds = new Set(getStepPartReferenceIds(task, step.id));
  const linkedParts = getStepPartReferences(task, step.id);
  const availableParts = partReferences.filter((part) => part.partNumber.trim() && !linkedPartIds.has(part.id));
  const gridClass = compact
    ? "grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-1"
    : "grid grid-cols-[74px_minmax(0,1fr)_52px] items-center gap-2";
  const inputClass = compact
    ? "h-7 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-copper"
    : "h-8 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-copper";
  const addClass = compact
    ? "h-7 text-[10px] font-black uppercase text-graphite hover:text-copper"
    : "h-8 rounded border border-line bg-white text-[10px] font-black uppercase text-graphite hover:border-copper hover:text-copper";

  return (
    <div className="space-y-1.5">
      <div className={gridClass}>
        <span className="text-[10px] font-black uppercase tracking-wide text-steel">Parts</span>
        <input
          className={inputClass}
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
        <button type="button" onClick={onAddDraft} className={addClass}>
          Add
        </button>
      </div>

      {availableParts.length > 0 ? (
        <div className={compact ? "pl-[42px]" : "pl-[74px]"}>
          <select
            aria-label={`Link existing part to step ${step.sequence}`}
            className="h-8 w-full rounded border border-line bg-white px-2 text-xs font-bold text-ink outline-none focus:border-copper"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                onLinkExisting(event.target.value);
              }
            }}
          >
            <option value="">Link existing part</option>
            {availableParts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.partNumber}{part.description ? ` - ${part.description}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {linkedParts.length > 0 ? (
        <div className={`flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-bold text-steel ${compact ? "pl-[42px]" : "pl-[74px]"}`}>
          {linkedParts.map((part) => (
            <span key={part.id} className="inline-flex min-w-0 items-center gap-1">
              <span className="max-w-[220px] truncate" title={part.description || part.partNumber}>
                {part.partNumber}
                {part.quantity ? ` x${part.quantity}` : ""}
              </span>
              <button
                type="button"
                onClick={() => onRemove(part.id)}
                className="text-steel/70 hover:text-signal"
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

function StatCard({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "border-teal/30 bg-[#ecf5f1]"
      : tone === "warn"
        ? "border-amber/40 bg-[#fbf1d9]"
        : tone === "bad"
          ? "border-signal/30 bg-[#f9e7e3]"
          : "border-line bg-white";

  return (
    <div className={`rounded-md border p-3 shadow-sm ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-steel">{label}</div>
      <div className="mt-2 text-xl font-black tracking-normal text-ink">{value}</div>
      {meta ? <div className="mt-1 truncate text-xs font-medium text-steel">{meta}</div> : null}
    </div>
  );
}

function TopNav({
  state,
  project,
  saveState,
  saveError,
  onSave,
  onExport,
}: {
  state: PlannerState;
  project?: PlannerProjectContext;
  saveState: SaveState;
  saveError?: string;
  onSave: () => void;
  onExport: () => void;
}) {
  const [showPhotoPortalQr, setShowPhotoPortalQr] = useState(false);
  const [phonePortalUrl, setPhonePortalUrl] = useState("");
  const [phonePortalCandidates, setPhonePortalCandidates] = useState<Array<{ label: string; url: string }>>([]);
  const [phonePortalQrDataUrl, setPhonePortalQrDataUrl] = useState("");
  const saveLabel =
    saveState === "loading"
      ? "Loading"
      : saveState === "saving"
        ? "Saving"
        : saveState === "saved"
          ? "Saved"
          : saveState === "draft"
            ? "Draft saved locally"
            : saveState === "retrying"
              ? "Save failed - retrying"
              : saveState === "conflict"
                ? "Conflict"
          : saveState === "error"
            ? "Save failed"
            : "Save";

  useEffect(() => {
    let mounted = true;

    function fallbackPortalUrl() {
      if (typeof window === "undefined") {
        return project?.projectId ? `/projects/${project.projectId}/mobile-photos` : "/mobile-photos";
      }

      return `${window.location.origin}${project?.projectId ? `/projects/${project.projectId}/mobile-photos` : "/mobile-photos"}`;
    }

    const phonePortalApiUrl = project?.projectId
      ? `/api/phone-portal-url?projectId=${encodeURIComponent(project.projectId)}`
      : "/api/phone-portal-url";

    fetch(phonePortalApiUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to resolve phone portal URL.");
        }

        return response.json() as Promise<{ candidates?: Array<{ label: string; url: string }>; url?: string }>;
      })
      .then((payload) => {
        if (!mounted) {
          return;
        }

        setPhonePortalUrl(payload.url ?? fallbackPortalUrl());
        setPhonePortalCandidates(payload.candidates ?? []);
      })
      .catch(() => {
        if (mounted) {
          setPhonePortalUrl(fallbackPortalUrl());
          setPhonePortalCandidates([]);
        }
      });

    return () => {
      mounted = false;
    };
  }, [project?.projectId]);

  useEffect(() => {
    let mounted = true;

    if (!showPhotoPortalQr || !phonePortalUrl) {
      return () => {
        mounted = false;
      };
    }

    QRCodeGenerator.toDataURL(phonePortalUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
      color: {
        dark: "#18251f",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (mounted) {
          setPhonePortalQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (mounted) {
          setPhonePortalQrDataUrl("");
        }
      });

    return () => {
      mounted = false;
    };
  }, [phonePortalUrl, showPhotoPortalQr]);

  return (
    <header className="flex h-16 items-center justify-between border-b border-line bg-graphite px-4 text-white">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-copper text-white">
          <Factory size={22} strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-black uppercase tracking-wide">BuildLogic Line Planner</div>
          <div className="truncate text-xs text-white/70">{state.product.name}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saveState === "loading" || saveState === "saving"}
          title={saveState === "error" || saveState === "retrying" ? saveError : saveLabel}
          aria-label={
            (saveState === "error" || saveState === "retrying") && saveError ? `${saveLabel}: ${saveError}` : saveLabel
          }
          className="inline-flex h-9 items-center gap-2 rounded border border-white/15 bg-white/10 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CheckCircle2 size={16} />
          {saveLabel}
        </button>
        <a
          href={phonePortalUrl || "https://pulse.agenticlabs.studio/mobile-photos"}
          className="hidden h-9 items-center gap-2 rounded border border-white/15 bg-white/10 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-white/20 sm:inline-flex"
        >
          <ImageIcon size={16} />
          Photo Portal
        </a>
        <button
          type="button"
          onClick={() => setShowPhotoPortalQr(true)}
          className="inline-flex h-9 items-center gap-2 rounded border border-white/15 bg-white/10 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-white/20"
        >
          <QrCode size={16} />
          QR
        </button>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-9 items-center gap-2 rounded bg-white px-3 text-sm font-bold text-graphite shadow-sm hover:bg-[#f4f0e7]"
        >
          <Download size={16} />
          Export
        </button>
      </div>
      {showPhotoPortalQr ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/70 px-4 text-ink"
          role="dialog"
          aria-modal="true"
          aria-label="Phone photo portal QR code"
          onClick={() => setShowPhotoPortalQr(false)}
        >
          <div
            className="w-full max-w-sm rounded-md border border-line bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line p-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wide text-steel">Phone Portal</div>
                <div className="mt-1 text-lg font-black leading-tight text-ink">Scan to capture step photos</div>
              </div>
              <button
                type="button"
                onClick={() => setShowPhotoPortalQr(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-white text-steel hover:bg-[#f4f0e7]"
                aria-label="Close QR code"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="flex justify-center rounded border border-line bg-white p-4">
                {phonePortalQrDataUrl ? (
                  <img src={phonePortalQrDataUrl} alt="Phone photo portal QR code" className="h-60 w-60" />
                ) : (
                  <div className="flex h-60 w-60 items-center justify-center rounded bg-[#fbfaf6] text-sm font-bold text-steel">
                    Building QR code...
                  </div>
                )}
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-steel">Portal URL</span>
                <input
                  className="h-10 w-full rounded border border-line bg-[#fbfaf6] px-3 text-sm font-bold text-ink outline-none focus:border-copper"
                  value={phonePortalUrl}
                  onChange={(event) => setPhonePortalUrl(event.target.value)}
                />
              </label>
              {phonePortalCandidates.length > 1 ? (
                <div>
                  <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-steel">Try URL</div>
                  <div className="grid gap-2">
                    {phonePortalCandidates.map((candidate) => (
                      <button
                        key={candidate.url}
                        type="button"
                        onClick={() => setPhonePortalUrl(candidate.url)}
                        className={`min-w-0 rounded border px-3 py-2 text-left text-xs font-bold transition ${
                          candidate.url === phonePortalUrl
                            ? "border-teal bg-[#e8f4ef] text-ink"
                            : "border-line bg-white text-steel hover:bg-[#f4f0e7]"
                        }`}
                      >
                        <span className="mr-2 font-black text-ink">{candidate.label}</span>
                        <span className="break-all">{candidate.url}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={phonePortalUrl || "/mobile-photos"}
                  className="inline-flex h-10 items-center justify-center rounded border border-line bg-white text-sm font-black text-ink hover:bg-[#f4f0e7]"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => setShowPhotoPortalQr(false)}
                  className="inline-flex h-10 items-center justify-center rounded bg-graphite text-sm font-black text-white hover:bg-ink"
                >
                  Done
                </button>
              </div>
              <div className="text-xs font-semibold leading-snug text-steel">
                Your phone needs to be on the same network as this dev server.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function Sidebar({
  activeModule,
  onChange,
  project,
  workspaceDrawerOpen,
  onToggleWorkspaceDrawer,
}: {
  activeModule: string;
  onChange: (moduleId: string) => void;
  project?: PlannerProjectContext;
  workspaceDrawerOpen: boolean;
  onToggleWorkspaceDrawer: () => void;
}) {
  return (
    <aside className="hidden h-full border-r border-line bg-ink text-white lg:block">
      <nav className="flex h-full flex-col items-center gap-1 py-3">
        <button
          type="button"
          title={project ? `${project.workspaceName} / ${project.projectName}` : "Workspace"}
          onClick={onToggleWorkspaceDrawer}
          aria-expanded={workspaceDrawerOpen}
          aria-controls="workspace-sidebar-drawer"
          className={`mb-2 flex h-[58px] w-full flex-col items-center justify-center gap-1 border-l-4 border-b border-white/10 text-[10px] font-bold uppercase transition ${
            workspaceDrawerOpen
              ? "border-copper bg-white/15 text-white"
              : "border-transparent text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <FolderKanban size={19} />
          <span>Workspace</span>
        </button>
        {modules.map((module) => {
          const Icon = module.icon;
          const active = activeModule === module.id;
          return (
            <button
              key={module.id}
              type="button"
              title={module.label}
              onClick={() => onChange(module.id)}
              className={`flex h-[54px] w-full flex-col items-center justify-center gap-1 border-l-4 text-[10px] font-bold uppercase transition ${
                active
                  ? "border-copper bg-white/10 text-white"
                  : "border-transparent text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={18} />
              <span>{module.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

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
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-copper/20 bg-[#fbfaf6]/90 text-copper/75 shadow-[0_8px_20px_rgba(23,33,27,0.12)] backdrop-blur">
        <ChevronDown size={15} strokeWidth={2.4} />
      </div>
    </div>
  );
}

function ProcedureWorkspace({
  tasks,
  zones,
  selectedTask,
  onSelectTask,
  onUpdateTask,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onAddStepTool,
  onRemoveStepTool,
}: {
  tasks: Task[];
  zones: Zone[];
  selectedTask?: Task;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
}) {
  const [newStepToolNames, setNewStepToolNames] = useState<Record<string, string>>({});
  const [newStepPartNumbers, setNewStepPartNumbers] = useState<Record<string, string>>({});
  const [stepPhotoUploadCounts, setStepPhotoUploadCounts] = useState<Record<string, number>>({});
  const [navigatorWidth, setNavigatorWidth] = useState(320);
  const [isResizingNavigator, setIsResizingNavigator] = useState(false);
  const navigatorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
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
  const toolLibrary = useMemo(() => buildStepToolLibrary(tasks), [tasks]);
  const partReferences = task?.partReferences ?? [];
  const manufacturingStepDurationMinutes = manufacturingSteps.reduce(
    (total, step) => total + Math.max(step.durationMinutes ?? 0, 0),
    0,
  );
  const currentManHours = task ? calculateTaskManHours({ ...task, plannedDurationMinutes: task.plannedDurationMinutes }) : 0;
  const stepDerivedManHours = task
    ? calculateTaskManHours({ ...task, plannedDurationMinutes: manufacturingStepDurationMinutes })
    : 0;
  const procedureGridStyle = {
    "--procedure-nav-width": `${navigatorWidth}px`,
  } as CSSProperties;

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
  }

  function updatePartReference(partId: string, patch: Partial<PartReference>) {
    if (!task) {
      return;
    }

    onUpdateTask(task.id, {
      partReferences: partReferences.map((part) => (part.id === partId ? { ...part, ...patch } : part)),
    });
  }

  function addPartReference() {
    if (!task) {
      return;
    }

    onUpdateTask(task.id, {
      partReferences: [
        ...partReferences,
        {
          id: `part-${task.id}-${Date.now()}`,
          partNumber: "",
          description: "",
          quantity: 1,
          disposition: "",
        },
      ],
    });
  }

  function addManufacturingStepPartReference(stepId: string) {
    if (!task) {
      return;
    }

    const partNumber = (newStepPartNumbers[stepId] ?? "").trim();
    if (!partNumber) {
      return;
    }

    const existingPart = partReferences.find((part) => part.partNumber.trim().toLowerCase() === partNumber.toLowerCase());
    const partReference = existingPart ?? {
      id: `part-${task.id}-${Date.now()}`,
      partNumber,
      description: "",
      quantity: 1,
      disposition: "",
    };
    const taskWithPart = existingPart
      ? task
      : {
          ...task,
          partReferences: [...partReferences, partReference],
        };
    const nextTask = addStepPartReference(taskWithPart, stepId, partReference.id);

	    onUpdateTask(task.id, {
	      manufacturingSteps: nextTask.manufacturingSteps,
	      partReferences: nextTask.partReferences,
	    });
    setNewStepPartNumbers((current) => ({ ...current, [stepId]: "" }));
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
	    onUpdateTask(task.id, { manufacturingSteps: nextTask.manufacturingSteps });
  }

  function addManufacturingStepTool(stepId: string) {
    if (!task) {
      return;
    }

    const nextTool = (newStepToolNames[stepId] ?? "").trim();
    if (!nextTool) {
      return;
    }

    const nextTask = addStepTool(task, stepId, nextTool);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onAddStepTool(task.id, stepId, nextTool, getStepToolList(nextTask, stepId).length);
    setNewStepToolNames((current) => ({ ...current, [stepId]: "" }));
  }

  function addManufacturingStepToolFromLibrary(stepId: string, toolName: string) {
    if (!task || !toolName) {
      return;
    }

    const nextTask = addStepTool(task, stepId, toolName);
    onUpdateTask(task.id, { customFields: nextTask.customFields });
    void onAddStepTool(task.id, stepId, toolName, getStepToolList(nextTask, stepId).length);
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

  if (!task) {
    return (
      <section className="h-full min-h-0 overflow-hidden bg-[#fbfaf6] p-4">
        <div className="rounded-md border border-line bg-white p-5 text-sm font-bold text-steel">
          No task is available for procedure authoring.
        </div>
      </section>
    );
  }

  return (
    <section
      className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-[#f7f5ef] lg:grid-cols-[var(--procedure-nav-width)_minmax(0,1fr)]"
      style={procedureGridStyle}
    >
      <aside className="relative min-h-0 overflow-x-hidden overflow-y-auto border-b border-line bg-[#f4f0e7] lg:border-b-0 lg:border-r">
        <div className="sticky top-0 z-10 border-b border-line bg-[#f4f0e7] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-steel">Procedure Tasks</div>
              <div className="mt-0.5 text-xs font-bold text-ink">{tasks.length} task rows</div>
            </div>
          </div>
        </div>

        <div className="min-w-0 divide-y divide-line">
          {groupedTasks.map((group) => (
            <div key={group.id}>
              <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-steel">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="min-w-0 truncate">{group.name}</span>
                <span className="ml-auto text-steel/70">{group.tasks.length}</span>
              </div>
              <div className="divide-y divide-line/70">
                {group.tasks.map((item) => {
                  const active = item.id === task.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectTask(item.id)}
                      className={`grid w-full grid-cols-[46px_minmax(0,1fr)] gap-2 px-3 py-2 text-left text-xs transition ${
                        active ? "bg-white text-ink" : "text-steel hover:bg-white/60 hover:text-ink"
                      }`}
                    >
                      <span className="font-mono text-[11px] font-black">{item.wbs}</span>
                      <span className="min-w-0 truncate font-bold">{item.name || "Untitled task"}</span>
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
            isResizingNavigator ? "bg-copper/10" : "hover:bg-copper/10 focus-visible:bg-copper/10"
          }`}
          aria-label="Resize procedure task navigator"
          title="Drag to resize procedure task navigator"
        >
          <span
            className={`absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
              isResizingNavigator ? "bg-copper" : "bg-steel/25"
            }`}
          />
        </button>
      </aside>

      <main className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 py-4 xl:px-5">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <section className="border-b border-line bg-[#fbfaf6] px-1 pb-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
              <div className="min-w-0 pt-1">
                <div className="text-[11px] font-black uppercase tracking-wide text-steel">Selected Procedure</div>
                <h1 className="mt-1 text-2xl font-black leading-tight tracking-normal text-ink">
                  <span className="font-mono text-copper">{task.wbs}</span> {task.name || "Untitled task"}
                </h1>
              </div>
              <div className="grid gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))] xl:grid-cols-2">
                {[
                  ["Zone", zoneById.get(task.zoneId ?? "")?.name ?? "Unzoned"],
                  ["Duration", formatMinutes(task.plannedDurationMinutes)],
                  ["Man-Hours", formatManHours(currentManHours)],
                  ["Operators", `${task.plannedOperators}`],
                ].map(([label, value]) => (
                  <div key={label} className="border border-line bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-wide text-steel">{label}</div>
                    <div className="mt-1 truncate text-sm font-black text-ink" title={value}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-steel">Task Description</span>
              <textarea
                className="min-h-[170px] w-full resize-y rounded border border-line bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-ink outline-none focus:border-copper"
                value={task.description ?? ""}
                onChange={(event) => onUpdateTask(task.id, { description: event.target.value })}
                placeholder="Describe the task scope, boundaries, and expected output."
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-steel">Safety Notes</span>
              <textarea
                className="min-h-[170px] w-full resize-y rounded border border-line bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-ink outline-none focus:border-copper"
                value={task.safetyNotes ?? ""}
                onChange={(event) => onUpdateTask(task.id, { safetyNotes: event.target.value })}
                placeholder="Safety, lockout, PPE, lifting, or handling notes."
              />
            </label>
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wide text-ink">Manufacturing Steps</h2>
                <div className="text-xs font-bold text-steel">
                  {manufacturingSteps.length} step(s) · step total {formatMinutes(manufacturingStepDurationMinutes)} · {formatManHours(stepDerivedManHours)}
                </div>
              </div>
              <button
                type="button"
                onClick={addManufacturingStep}
                className="inline-flex h-9 items-center gap-2 rounded bg-graphite px-3 text-xs font-black text-white hover:bg-ink"
              >
                <Plus size={15} />
                Add Step
              </button>
            </div>

            <div className="border-y border-line">
              {manufacturingSteps.length === 0 ? (
                <div className="bg-white px-3 py-5 text-sm font-bold text-steel">
                  Add a blank step to start authoring the procedure for this task.
                </div>
              ) : (
                manufacturingSteps.map((step) => {
                  const stepPhotos = getStepPhotoAttachments(task, step.id);
                  const stepTools = getStepToolList(task, step.id);
                  const selectedChecks = getManufacturingStepCheckSet(step.qualityCheck);

                  return (
                    <div
                      key={step.id}
                      className="grid gap-3 border-b border-line bg-white px-3 py-3 last:border-b-0 xl:grid-cols-[54px_76px_minmax(0,1fr)]"
                    >
                      <label className="block">
                        <span className="mb-1 block whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-steel">Seq</span>
                        <ClearableNumberInput
                          aria-label={`Step ${step.sequence} sequence`}
                          className="number-input h-9 w-full rounded border border-line bg-[#fbfaf6] px-1 text-center text-sm font-black text-ink outline-none focus:border-copper"
                          value={step.sequence}
                          min={1}
                          fallbackValue={step.sequence}
                          precision={0}
                          normalize={Math.round}
                          onValueChange={(value) => moveManufacturingStep(step.id, value)}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-steel">Minutes</span>
                        <ClearableNumberInput
                          aria-label={`Step ${step.sequence} duration minutes`}
                          className="number-input h-9 w-full rounded border border-line bg-[#fbfaf6] px-1 text-center text-sm font-black text-ink outline-none focus:border-copper"
                          value={step.durationMinutes ?? 0}
                          min={0}
                          fallbackValue={step.durationMinutes ?? 0}
                          precision={1}
                          onValueChange={(value) => updateManufacturingStep(step.id, { durationMinutes: value })}
                        />
                      </label>

                      <div className="min-w-0 space-y-3">
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="block text-[10px] font-black uppercase tracking-wide text-steel">Instruction</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  updateManufacturingStep(step.id, { instruction: applyInstructionBullets(step.instruction) })
                                }
                                className="inline-flex h-7 items-center gap-1 rounded border border-line bg-white px-2 text-[10px] font-black uppercase text-steel hover:border-copper hover:text-copper"
                                title={`Format step ${step.sequence} as bullets`}
                                aria-label={`Format step ${step.sequence} as bullets`}
                              >
                                <ListChecks size={12} />
                                Bullets
                              </button>
                              <button
                                type="button"
                                onClick={() => removeManufacturingStep(step.id)}
                                className="inline-flex h-7 items-center gap-1 rounded border border-line bg-white px-2 text-[10px] font-black uppercase text-steel hover:border-signal hover:bg-[#f5e7df] hover:text-signal"
                                title={`Delete step ${step.sequence}`}
                                aria-label={`Delete step ${step.sequence}`}
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            </div>
                          </div>
                          <textarea
                            aria-label={`Step ${step.sequence} instruction`}
                            className="min-h-[132px] w-full resize-y rounded border border-line bg-[#fbfaf6] px-3 py-2 text-sm font-semibold leading-relaxed text-ink outline-none focus:border-copper"
                            value={step.instruction}
                            onChange={(event) => updateManufacturingStep(step.id, { instruction: event.target.value })}
                            onKeyDown={(event) =>
                              handleInstructionBulletKeyDown(event, (instruction) =>
                                updateManufacturingStep(step.id, { instruction }),
                              )
                            }
                            placeholder="Write the manufacturing instruction for this operation."
                          />
                        </div>

                        <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
	                          <div className="min-w-0">
	                            <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wide text-steel">Tools</span>
                                {toolLibrary.length > 0 ? (
                                  <select
                                    aria-label={`Add saved tool to step ${step.sequence}`}
                                    className="h-7 max-w-[220px] rounded border border-line bg-white px-2 text-[11px] font-bold text-steel outline-none hover:border-copper focus:border-copper"
                                    value=""
                                    onChange={(event) => {
                                      if (event.target.value) {
                                        addManufacturingStepToolFromLibrary(step.id, event.target.value);
                                      }
                                    }}
                                  >
                                    <option value="">Tool library</option>
                                    {toolLibrary
                                      .filter((tool) => !stepTools.some((stepTool) => stepTool.toLocaleLowerCase() === tool.toLocaleLowerCase()))
                                      .map((tool) => (
                                        <option key={tool} value={tool}>
                                          {tool}
                                        </option>
                                      ))}
                                  </select>
                                ) : null}
                              </div>
	                            <div className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-2">
                              <input
                                className="h-8 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-copper"
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
                                className="h-8 rounded border border-line bg-white text-[10px] font-black uppercase text-graphite hover:border-copper hover:text-copper"
                              >
                                Add
                              </button>
                            </div>
                            {stepTools.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-steel">
                                {stepTools.map((tool) => (
                                  <span key={tool} className="inline-flex min-w-0 items-center gap-1">
                                    <span className="max-w-[240px] truncate">{tool}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeManufacturingStepTool(step.id, tool)}
                                      className="text-steel/70 hover:text-signal"
                                      aria-label={`Remove ${tool}`}
                                      title={`Remove ${tool}`}
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </span>
                                ))}
	                              </div>
	                            ) : null}
	                          </div>

	                          <div>
	                            <StepPartReferenceEditor
	                              task={task}
	                              step={step}
	                              partReferences={partReferences}
	                              draftValue={newStepPartNumbers[step.id] ?? ""}
	                              onDraftChange={(value) =>
	                                setNewStepPartNumbers((current) => ({ ...current, [step.id]: value }))
	                              }
	                              onAddDraft={() => addManufacturingStepPartReference(step.id)}
	                              onLinkExisting={(partReferenceId) => linkExistingPartToManufacturingStep(step.id, partReferenceId)}
	                              onRemove={(partReferenceId) => removeManufacturingStepPartReference(step.id, partReferenceId)}
	                            />
	                          </div>

                          <div>
                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-steel">Checks</div>
                            <div className="flex flex-wrap gap-2" role="group" aria-label={`Step ${step.sequence} checks`}>
                              {manufacturingStepCheckOptions.map((option) => {
                                const checked = selectedChecks.has(option.key);

                                return (
                                  <label
                                    key={option.key}
                                    className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded border px-2 text-[11px] font-black transition ${
                                      checked
                                        ? "border-teal/30 bg-teal/10 text-teal"
                                        : "border-line bg-white text-steel hover:border-copper"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5 shrink-0 accent-teal"
                                      checked={checked}
                                      onChange={(event) => {
                                        const nextChecks = new Set(selectedChecks);

                                        if (event.target.checked) {
                                          nextChecks.add(option.key);
                                        } else {
                                          nextChecks.delete(option.key);
                                        }

                                        updateManufacturingStep(step.id, {
                                          qualityCheck: serializeManufacturingStepCheckSet(nextChecks),
                                        });
                                      }}
                                    />
                                    {option.label}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-line pt-3">
                          <StepPhotoAttachmentEditor
                            step={step}
                            photos={stepPhotos}
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRemove={(photoId) => removeManufacturingStepPhoto(step.id, photoId)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wide text-ink">Part References</h2>
                  <div className="text-xs font-bold text-steel">{partReferences.length} part reference(s)</div>
                </div>
                <button
                  type="button"
                  onClick={addPartReference}
                  className="inline-flex h-8 items-center gap-1 rounded border border-line bg-white px-2 text-xs font-black text-ink hover:border-copper"
                >
                  <Plus size={14} />
                  Part
                </button>
              </div>
              <div className="border-y border-line bg-white">
                {partReferences.length === 0 ? (
                  <div className="px-3 py-4 text-sm font-bold text-steel">
                    No part references on this task yet.
                  </div>
                ) : (
                  partReferences.map((part) => (
                    <div
                      key={part.id}
                      className="grid gap-2 border-b border-line px-3 py-3 last:border-b-0 md:grid-cols-[minmax(150px,0.55fr)_80px_minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <label className="block">
                        <span className="mb-1 block whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-steel">Part Number</span>
                        <input
                          className="h-9 w-full rounded border border-line bg-[#fbfaf6] px-2 text-sm font-bold text-ink outline-none focus:border-copper"
                          value={part.partNumber}
                          onChange={(event) => updatePartReference(part.id, { partNumber: event.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-steel">Qty</span>
                        <ClearableNumberInput
                          className="number-input h-9 w-full rounded border border-line bg-[#fbfaf6] px-2 text-sm font-bold text-ink outline-none focus:border-copper"
                          value={part.quantity ?? 0}
                          min={0}
                          fallbackValue={part.quantity ?? 0}
                          precision={0}
                          normalize={Math.round}
                          onValueChange={(value) => updatePartReference(part.id, { quantity: value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-steel">Description</span>
                        <input
                          className="h-9 w-full rounded border border-line bg-[#fbfaf6] px-2 text-sm font-semibold text-ink outline-none focus:border-copper"
                          value={part.description ?? ""}
                          onChange={(event) => updatePartReference(part.id, { description: event.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-steel">Disposition / Note</span>
                        <input
                          className="h-9 w-full rounded border border-line bg-[#fbfaf6] px-2 text-sm font-semibold text-ink outline-none focus:border-copper"
                          value={part.disposition ?? ""}
                          onChange={(event) => updatePartReference(part.id, { disposition: event.target.value })}
                        />
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
        <ScrollDownHint />
      </main>
    </section>
  );
}

function SetupFieldGroup({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-line bg-white/75 p-3 ${className}`}>
      <div className="mb-3">
        <div className="text-[11px] font-black uppercase tracking-wide text-ink">{title}</div>
        {description ? <div className="mt-0.5 text-[11px] font-semibold text-steel">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ProductSetupPanel({
  product,
  onProductNumber,
  onProductText,
}: {
  product: Product;
  onProductNumber: (field: ProductNumberField, value: number) => void;
  onProductText: (field: ProductTextField, value: string) => void;
}) {
  return (
    <section className="rounded-md border border-line bg-[#fbfaf6] p-4 shadow-soft">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-ink">Product Setup</h2>
          <div className="text-xs font-semibold text-steel">Demand, available time, takt, and target labor</div>
        </div>
        <StatusPill status={product.status} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <SetupFieldGroup title="Product Identity" description="What is being planned" className="xl:col-span-2">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(150px,0.7fr)_minmax(130px,0.6fr)_minmax(150px,0.7fr)]">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">Product</span>
              <input
                className="h-10 w-full rounded border border-line bg-white px-3 text-sm font-semibold text-ink outline-none"
                value={product.name}
                onChange={(event) => onProductText("name", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">SKU</span>
              <input
                className="h-10 w-full rounded border border-line bg-white px-3 text-sm font-semibold text-ink outline-none"
                value={product.sku ?? ""}
                onChange={(event) => onProductText("sku", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">Revision</span>
              <input
                className="h-10 w-full rounded border border-line bg-white px-3 text-sm font-semibold text-ink outline-none"
                value={product.revision}
                onChange={(event) => onProductText("revision", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">Status</span>
              <select
                className="h-10 w-full rounded border border-line bg-white px-3 text-sm font-semibold text-ink outline-none"
                value={product.status}
                onChange={(event) => onProductText("status", event.target.value as ProductStatus)}
              >
                <option value="draft">Draft</option>
                <option value="review">Review</option>
                <option value="approved">Approved</option>
                <option value="released">Released</option>
                <option value="obsolete">Obsolete</option>
              </select>
            </label>
          </div>
        </SetupFieldGroup>

        <SetupFieldGroup title="Demand & Labor" description="Volume, takt override, and labor target">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">Demand</span>
              <div className="flex h-10 overflow-hidden rounded border border-line bg-white">
                <ClearableNumberInput
                  className="number-input h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-ink outline-none"
                  value={product.demandQuantity}
                  min={0}
                  step={1}
                  precision={0}
                  normalize={Math.round}
                  onValueChange={(value) => onProductNumber("demandQuantity", value)}
                />
                <select
                  className="h-full w-28 border-l border-line bg-[#f4f0e8] px-2 text-xs font-black uppercase text-steel outline-none"
                  value={product.demandPeriod}
                  onChange={(event) => onProductText("demandPeriod", event.target.value as DemandPeriod)}
                >
                  {demandPeriodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <NumericField
              label="Manual Takt"
              value={product.manualTaktMinutes ?? 0}
              suffix="min"
              onChange={(value) => onProductNumber("manualTaktMinutes", value)}
            />
            <NumericField
              label="Target MH"
              value={product.targetManHours}
              suffix="MH"
              onChange={(value) => onProductNumber("targetManHours", value)}
            />
          </div>
        </SetupFieldGroup>

        <SetupFieldGroup title="Available Workday" description="Shift time minus planned non-production time">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <NumericField
              label="Workday"
              value={product.grossAvailableMinutes}
              suffix="min"
              onChange={(value) => onProductNumber("grossAvailableMinutes", value)}
            />
            <NumericField
              label="Breaks"
              value={product.breakMinutes}
              suffix="min"
              onChange={(value) => onProductNumber("breakMinutes", value)}
            />
            <NumericField
              label="Lunch"
              value={product.lunchMinutes}
              suffix="min"
              onChange={(value) => onProductNumber("lunchMinutes", value)}
            />
            <NumericField
              label="Meetings"
              value={product.meetingMinutes}
              suffix="min"
              onChange={(value) => onProductNumber("meetingMinutes", value)}
            />
            <NumericField
              label="Planned Downtime"
              value={product.plannedDowntimeMinutes}
              suffix="min"
              onChange={(value) => onProductNumber("plannedDowntimeMinutes", value)}
            />
          </div>
        </SetupFieldGroup>

        <SetupFieldGroup title="Calendar" description="Working pattern used for weekly and monthly capacity" className="xl:col-span-2">
          <div className="grid gap-3 md:grid-cols-3">
            <NumericField
              label="Days / Week"
              value={product.workDaysPerWeek}
              suffix="days"
              precision={2}
              onChange={(value) => onProductNumber("workDaysPerWeek", value)}
            />
            <NumericField
              label="Weeks / Month"
              value={product.workWeeksPerMonth}
              suffix="wk"
              precision={2}
              onChange={(value) => onProductNumber("workWeeksPerMonth", value)}
            />
            <NumericField
              label="Days / Month"
              value={product.availableWorkDaysPerMonth}
              suffix="days"
              precision={1}
              readOnly
              onChange={() => undefined}
            />
          </div>
        </SetupFieldGroup>
      </div>
    </section>
  );
}

function KpiStrip({ kpis, product }: { kpis: ReturnType<typeof calculateProductKpis>; product: Product }) {
  const varianceTone = kpis.targetVariance <= 0 ? "good" : kpis.targetVariancePercent <= 10 ? "warn" : "bad";
  const taktTone = kpis.plannedCycleMinutes <= kpis.taktMinutes ? "good" : "bad";
  const plannedMhMeta = kpis.unassignedTaskCount > 0
    ? `${formatManHours(kpis.assignedPlannedManHours)} assigned · ${formatManHours(kpis.unassignedPlannedManHours)} unassigned`
    : `Target ${formatManHours(product.targetManHours)}`;
  const availabilityMeta = `${formatMinutes(kpis.weeklyAvailableMinutes)}/week · ${round(
    kpis.availableWorkDaysPerMonth,
    1,
  )} days/mo`;

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Net Available Time" value={formatMinutes(kpis.availableMinutes)} meta={availabilityMeta} />
      <StatCard label="Required Takt" value={formatMinutes(kpis.taktMinutes)} meta="Active takt" tone={taktTone} />
      <StatCard label="Unit Lead Time" value={formatMinutes(kpis.plannedCycleMinutes)} meta="First task start to final finish" />
      <StatCard label="Planned MH" value={formatManHours(kpis.plannedManHours)} meta={plannedMhMeta} tone={varianceTone} />
      <StatCard
        label="Balance"
        value={`${round(kpis.lineBalanceScore, 1)}%`}
        meta={kpis.bottleneckStation?.name ?? "No scheduled work"}
      />
      <StatCard
        label="Capacity Gap"
        value={formatManHours(kpis.capacityGapManHours)}
        meta={kpis.capacityGapManHours >= 0 ? "Available labor ahead" : "Labor short"}
        tone={kpis.capacityGapManHours >= 0 ? "good" : "bad"}
      />
    </section>
  );
}

interface ZoneMetric {
  id: string;
  name: string;
  color: string;
  taskCount: number;
  headcount: number;
  manHours: number;
  cycleMinutes: number;
}

function buildZoneMetrics(zones: Zone[], tasks: Task[]): ZoneMetric[] {
  const topLevelTasks = getTopLevelTasks(tasks);
  const sortedZones = [...zones].sort((a, b) => a.sequence - b.sequence);
  const metrics = sortedZones.map((zone) => {
    const zoneTasks = topLevelTasks.filter((task) => task.zoneId === zone.id);
    return {
      id: zone.id,
      name: zone.name || "Untitled zone",
      color: zone.color,
      taskCount: zoneTasks.length,
      headcount: calculatePeakManpower(zoneTasks),
      manHours: zoneTasks.reduce((total, task) => total + calculateTaskManHours(task), 0),
      cycleMinutes: Math.max(0, ...zoneTasks.map((task) => task.plannedDurationMinutes)),
    };
  });

  const assignedZoneIds = new Set(sortedZones.map((zone) => zone.id));
  const unzonedTasks = topLevelTasks.filter((task) => !task.zoneId || !assignedZoneIds.has(task.zoneId));
  if (unzonedTasks.length) {
    metrics.push({
      id: "zone-unzoned",
      name: "Unzoned",
      color: "#52606d",
      taskCount: unzonedTasks.length,
      headcount: calculatePeakManpower(unzonedTasks),
      manHours: unzonedTasks.reduce((total, task) => total + calculateTaskManHours(task), 0),
      cycleMinutes: Math.max(0, ...unzonedTasks.map((task) => task.plannedDurationMinutes)),
    });
  }

  return metrics;
}

function ZoneMetricsPanel({ zones, tasks, compact = false }: { zones: Zone[]; tasks: Task[]; compact?: boolean }) {
  const metrics = buildZoneMetrics(zones, tasks);

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line bg-[#fbfaf6] p-3 text-xs font-semibold text-steel">
        Create a zone in the Gantt to see headcount, man-hours, and cycle time by area.
      </div>
    );
  }

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3"}`}>
      {metrics.map((metric) => (
        <div key={metric.id} className="rounded-md border border-line bg-[#fbfaf6] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-black uppercase tracking-wide text-ink">{metric.name}</div>
              <div className="text-[11px] font-semibold text-steel">{metric.taskCount} high-level task(s)</div>
            </div>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: metric.color }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-steel">{compact ? "HC" : "Headcount"}</div>
              <div className="mt-1 text-lg font-black text-ink">{round(metric.headcount, 1)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-steel">MHs</div>
              <div className="mt-1 text-lg font-black text-ink">{formatManHours(metric.manHours)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-steel">Cycle</div>
              <div className="mt-1 text-lg font-black text-ink">{formatMinutes(metric.cycleMinutes)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CrewReadinessCard({
  kpis,
  onClearPlanningRecommendations,
  onOpenTaskDetail,
  planningRecommendations = [],
  product,
  tasks,
  compact = false,
}: {
  kpis: ReturnType<typeof calculateProductKpis>;
  onClearPlanningRecommendations?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  planningRecommendations?: UnallocatedWorkReview[];
  product: Product;
  tasks: Task[];
  compact?: boolean;
}) {
  const period = periodLabel(product.demandPeriod);
  const plannedLaborFits = kpis.plannedManHours <= product.targetManHours;
  const plannedFteFits = kpis.plannedLaborLoadFte <= kpis.budgetedCrewEquivalent;
  const peakFits = kpis.peakManpower <= kpis.wholePersonStaffingRequirement;
  const feasible = plannedLaborFits && plannedFteFits && peakFits;
  const visibleWorkerCount = Math.min(Math.max(kpis.wholePersonStaffingRequirement, 0), WORKER_ICON_LETTERS.length);
  const visibleWorkers = WORKER_ICON_LETTERS.slice(0, visibleWorkerCount);
  const operatorAllocations = useMemo(() => {
    const periodMinutes = calculateAvailabilityMinutesForDemandPeriod(product);
    const demandQuantity = Math.max(product.demandQuantity, 0);
    const allocationMinutes = Object.fromEntries(visibleWorkers.map((letter) => [letter, 0]));

    getTopLevelTasks(tasks).forEach((task) => {
      const assignedOperators = getTaskOperatorIds(task, visibleWorkers);
      const taskPeriodMinutes = Math.max(task.plannedDurationMinutes, 0) * demandQuantity;

      assignedOperators.forEach((operatorId) => {
        allocationMinutes[operatorId] = (allocationMinutes[operatorId] ?? 0) + taskPeriodMinutes;
      });
    });

    return Object.fromEntries(
      visibleWorkers.map((letter) => [
        letter,
        periodMinutes > 0 ? Math.min((allocationMinutes[letter] / periodMinutes) * 100, 999) : 0,
      ]),
    );
  }, [product, tasks, visibleWorkers]);
  const roundingCreatesUnusedCapacity =
    feasible && kpis.wholePersonStaffingRequirement > 0 && kpis.wholePersonStaffingRequirement > kpis.budgetedCrewEquivalent;
  const toneClass = !feasible
    ? "border-line border-l-signal"
    : roundingCreatesUnusedCapacity
      ? "border-line border-l-amber"
      : "border-line border-l-teal";
  const statusClass = !feasible
    ? "border-signal/25 bg-signal/10 text-signal"
    : roundingCreatesUnusedCapacity
      ? "border-amber/30 bg-amber/20 text-[#7a4e09]"
      : "border-teal/20 bg-teal/10 text-teal";
  const statusLabel = feasible ? "Feasible" : "Needs Review";
  const planChecks = [
    {
      label: "Planned MH/unit",
      value: `${formatManHours(kpis.plannedManHours)} / ${formatManHours(product.targetManHours)}`,
      fits: plannedLaborFits,
    },
    {
      label: "Planned Load",
      value: `${round(kpis.plannedLaborLoadFte, 2)} / ${round(kpis.budgetedCrewEquivalent, 2)} FTE`,
      fits: plannedFteFits,
    },
    {
      label: "Peak Manpower",
      value: `${round(kpis.peakManpower, 1)} / ${kpis.wholePersonStaffingRequirement}`,
      fits: peakFits,
    },
    ...(kpis.unassignedTaskCount > 0
      ? [
          {
            label: "Unassigned Labor",
            value: `${formatManHours(kpis.unassignedPlannedManHours)} · ${kpis.unassignedTaskCount} task(s)`,
            fits: false,
          },
        ]
      : []),
  ];

  return (
    <div className={`rounded-md border border-l-4 bg-white p-4 shadow-sm ${toneClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-steel">Budgeted Crew</div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black leading-none tracking-normal text-ink">
              {round(kpis.budgetedCrewEquivalent, 2)}
            </span>
            <span className="pb-0.5 text-sm font-black uppercase text-ink">FTE</span>
          </div>
        </div>
        <span className={`inline-flex h-7 items-center rounded border px-2 text-[11px] font-black uppercase ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <div className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "xl:grid-cols-[250px_minmax(0,1fr)_220px]"}`}>
        <div className={`space-y-2 ${compact ? "" : "xl:border-r xl:border-line xl:pr-4"}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-wide text-steel">Rounded Staffing</span>
            <span className="text-sm font-black text-ink">{kpis.wholePersonStaffingRequirement} people</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-wide text-steel">Avg Allocation</span>
            <span className="text-sm font-black text-ink">{round(kpis.requiredAverageAllocationPercent, 1)}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-wide text-steel">Labor Budget</span>
            <span className="text-sm font-black text-ink">{formatManHours(kpis.targetLaborBudgetManHours)}/{period}</span>
          </div>
        </div>

        <div className={`min-w-0 ${compact ? "border-t border-line pt-3" : "xl:border-r xl:border-line xl:px-4"}`}>
          <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-steel">Plan Fit</div>
          <div className={`grid gap-x-5 gap-y-2 ${compact ? "grid-cols-1" : "sm:grid-cols-4"}`}>
            {planChecks.map((check) => (
              <div key={check.label} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-steel">
                  <span className={`h-1.5 w-1.5 rounded-full ${check.fits ? "bg-teal" : "bg-signal"}`} />
                  {check.label}
                </div>
                <div className={`mt-1 text-sm font-black ${check.fits ? "text-ink" : "text-signal"}`}>{check.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`min-w-0 bg-white ${compact ? "border-t border-line pt-3" : "xl:pl-1"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-wide text-steel">Operators</div>
            <div className="text-[10px] font-black text-steel">
              {visibleWorkerCount}/{kpis.wholePersonStaffingRequirement}
            </div>
          </div>
          {visibleWorkers.length ? (
            <div className="grid grid-cols-4 gap-x-2 gap-y-2">
              {visibleWorkers.map((letter, index) => {
                const allocation = operatorAllocations[letter] ?? 0;
                return (
                  <div
                    key={letter}
                    className="flex min-w-0 flex-col items-center gap-0.5 bg-white"
                    title={`Operator ${letter}: ${allocation}% allocated`}
                  >
                    <WorkerIcon colorIndex={index} letter={letter} />
                    <span className="text-[9px] font-black leading-none text-steel">{round(allocation, 0)}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] font-semibold text-steel">No staffing requirement yet.</div>
          )}
          {kpis.wholePersonStaffingRequirement > WORKER_ICON_LETTERS.length ? (
            <div className="mt-2 text-[10px] font-semibold text-steel">First {WORKER_ICON_LETTERS.length} icons shown.</div>
          ) : null}
        </div>
      </div>

      <PlanningRecommendationsPanel
        compact={compact}
        onClear={onClearPlanningRecommendations}
        recommendations={planningRecommendations}
        onOpenTaskDetail={onOpenTaskDetail}
      />
    </div>
  );
}

function PlanningRecommendationsPanel({
  compact = false,
  onClear,
  onOpenTaskDetail,
  recommendations,
}: {
  compact?: boolean;
  onClear?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  recommendations: UnallocatedWorkReview[];
}) {
  if (recommendations.length === 0) {
    return null;
  }

  const visibleRecommendations = recommendations.slice(0, compact ? 2 : 4);
  const hiddenCount = recommendations.length - visibleRecommendations.length;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-[#7a4e09]">
            <AlertTriangle size={14} />
            Planning Recommendations
          </div>
          <div className="mt-1 text-xs font-bold leading-snug text-steel">
            Required work that is still unallocated by the current headcount plan.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center rounded border border-amber/35 bg-[#fff7e8] px-2 text-[10px] font-black uppercase tracking-wide text-[#7a4e09]">
            {recommendations.length} item(s)
          </span>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-6 items-center rounded border border-line bg-white px-2 text-[10px] font-black uppercase tracking-wide text-steel outline-none transition hover:border-graphite hover:text-ink focus-visible:ring-2 focus-visible:ring-copper"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 divide-y divide-line border-y border-line">
        {visibleRecommendations.map((recommendation) => (
          <div
            key={recommendation.taskId}
            className="grid gap-3 bg-[#fbfaf6] px-2 py-3 text-xs lg:grid-cols-[minmax(160px,0.75fr)_minmax(0,1.4fr)_minmax(150px,0.45fr)] lg:items-center"
          >
            <div className="min-w-0">
              <div className="truncate font-black text-ink" title={recommendation.taskLabel}>
                {recommendation.taskLabel}
              </div>
              <div className="mt-1 inline-flex rounded border border-amber/35 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#7a4e09]">
                {recommendation.classification}
              </div>
            </div>

            <div className="min-w-0">
              <div className="font-black leading-snug text-steel">{recommendation.condition}</div>
              <div className="mt-1 font-semibold leading-snug text-steel">{recommendation.impact}</div>
              <div className="mt-1 font-bold leading-snug text-ink">{recommendation.recommendation}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className="inline-flex h-7 items-center rounded border border-line bg-white px-2 text-[10px] font-black uppercase tracking-wide text-graphite">
                {recommendation.action}
              </span>
              {onOpenTaskDetail ? (
                <button
                  type="button"
                  onClick={() => onOpenTaskDetail(recommendation.taskId)}
                  className="inline-flex h-8 items-center justify-center rounded border border-graphite bg-graphite px-3 text-[11px] font-black text-white outline-none transition hover:bg-ink focus-visible:ring-2 focus-visible:ring-copper"
                >
                  Review task
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {hiddenCount > 0 ? (
        <div className="mt-2 text-[11px] font-bold text-steel">
          {hiddenCount} more recommendation(s) are included in the Smart Allocation audit packet.
        </div>
      ) : null}
    </div>
  );
}

function LineReadinessPanel({
  allocationRecommendations,
  onClearPlanningRecommendations,
  scenarioName,
  stationCount,
  taskCount,
  zones,
  tasks,
  bottleneckStation,
  targetVariance,
  targetVariancePercent,
  kpis,
  onOpenTaskDetail,
  product,
  compact = false,
}: {
  allocationRecommendations?: UnallocatedWorkReview[];
  onClearPlanningRecommendations?: () => void;
  scenarioName: string;
  stationCount: number;
  taskCount: number;
  zones: Zone[];
  tasks: Task[];
  bottleneckStation?: Station;
  targetVariance: number;
  targetVariancePercent: number;
  kpis: ReturnType<typeof calculateProductKpis>;
  onOpenTaskDetail?: (taskId: string) => void;
  product: Product;
  compact?: boolean;
}) {
  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-ink">Line Readiness</h2>
          <div className="text-xs font-semibold text-steel">{scenarioName}</div>
        </div>
        <Timer className="text-copper" size={22} />
      </div>
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-steel">Line Summary</div>
          <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
            <StatCard label="Stations" value={`${stationCount}`} meta="High-level tasks" />
            <StatCard label="Tasks" value={`${taskCount}`} meta="Schedulable rows" />
            <StatCard
              label="Bottleneck"
              value={bottleneckStation ? `${bottleneckStation.sequence}` : "-"}
              meta={bottleneckStation?.name ?? "No scheduled work"}
              tone={bottleneckStation ? (bottleneckStation.taktStatus === "red" ? "bad" : "warn") : "neutral"}
            />
            <StatCard
              label="Variance"
              value={formatManHours(targetVariance)}
              meta={`${round(targetVariancePercent, 1)}% vs target`}
              tone={targetVariance <= 0 ? "good" : "bad"}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-steel">Crew Plan</div>
          <CrewReadinessCard
            kpis={kpis}
            onClearPlanningRecommendations={onClearPlanningRecommendations}
            onOpenTaskDetail={onOpenTaskDetail}
            planningRecommendations={allocationRecommendations}
            product={product}
            tasks={tasks}
            compact={compact}
          />
        </div>

        <div>
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-steel">Zone Metrics</div>
          <ZoneMetricsPanel zones={zones} tasks={tasks} compact={compact} />
        </div>
      </div>
    </section>
  );
}

function StationBalance({
  stations,
  taktMinutes,
  selectedStationId,
  onSelectStation,
  onUpdateOperators,
}: {
  stations: Station[];
  taktMinutes: number;
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
  onUpdateOperators: (stationId: string, operators: number) => void;
}) {
  const maxCycle = Math.max(...stations.map((station) => station.plannedCycleMinutes), taktMinutes, 1);

  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-ink">Station Balance</h2>
          <div className="text-xs font-semibold text-steel">Takt line: {formatMinutes(taktMinutes)}</div>
        </div>
        <BarChart3 className="text-copper" size={22} />
      </div>
      <div className="space-y-3">
        {stations.map((station) => {
          const width = Math.max((station.plannedCycleMinutes / maxCycle) * 100, 3);
          const taktPosition = Math.min((taktMinutes / maxCycle) * 100, 100);
          return (
            <button
              key={station.id}
              type="button"
              onClick={() => onSelectStation(station.id)}
              className={`w-full rounded border p-3 text-left transition ${
                selectedStationId === station.id ? "border-teal bg-[#edf7f4]" : "border-line bg-[#fbfaf6] hover:bg-[#f4f0e7]"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-ink">
                    {station.sequence}. {station.name}
                  </div>
                  <div className="text-xs font-semibold text-steel">
                    {formatMinutes(station.plannedCycleMinutes)} / {formatManHours(station.plannedManHours)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {station.bottleneckFlag ? <AlertTriangle size={17} className="text-signal" /> : null}
                  <StatusPill status={station.taktStatus} />
                </div>
              </div>
              <div className="relative h-5 overflow-hidden rounded bg-[#e9e2d6]">
                <div className="absolute inset-y-0 w-[2px] bg-signal" style={{ left: `${taktPosition}%` }} />
                <div
                  className={`h-full rounded ${station.bottleneckFlag ? "bg-signal" : "bg-teal"}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-steel">
                <span>Operators</span>
                <ClearableNumberInput
                  aria-label={`${station.name} operators`}
                  className="number-input h-8 w-16 rounded border border-line bg-white px-2 text-right font-bold text-ink outline-none"
                  value={station.plannedOperators}
                  min={0}
                  fallbackValue={station.plannedOperators}
                  precision={0}
                  normalize={Math.round}
                  onClick={(event) => event.stopPropagation()}
                  onValueChange={(value) => onUpdateOperators(station.id, value)}
                />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DetailDrawer({
  task,
  station,
  collapsed,
  isResizing,
  onToggleCollapsed,
  onResizeStart,
  onUpdateTask,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onAddStepTool,
  onRemoveStepTool,
  toolLibrary,
}: {
  task?: Task;
  station?: Station;
  collapsed: boolean;
  isResizing: boolean;
  onToggleCollapsed: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
  toolLibrary: string[];
}) {
  const drawerClass = `relative hidden h-full min-h-0 overflow-hidden border-l border-line transition-colors duration-300 ease-out xl:block ${
    collapsed ? "bg-graphite text-white" : "bg-[#fbfaf6] text-ink"
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
  const collapsedRail = (
    <div aria-hidden={!collapsed} className={railClass}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="mt-4 flex h-8 w-8 items-center justify-center rounded bg-white/10 text-white transition hover:bg-white/20"
        title="Expand selected task drawer"
        aria-label="Expand selected task drawer"
      >
        <ChevronsLeft size={16} />
      </button>
      <div
        className="mt-5 max-h-[220px] max-w-[20px] text-center text-[10px] font-black uppercase tracking-wide text-white/70"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Selected Task
      </div>
      <div className="mt-4 flex h-8 w-8 items-center justify-center rounded border border-white/15 bg-white/10 text-[11px] font-black">
        {task?.wbs ?? "-"}
      </div>
    </div>
  );
  const resizeHandle = collapsed ? null : (
    <button
      type="button"
      onPointerDown={onResizeStart}
      className={`absolute left-0 top-0 z-30 h-full w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none transition ${
        isResizing ? "bg-copper/10" : "hover:bg-copper/10 focus-visible:bg-copper/10"
      }`}
      aria-label="Resize selected task drawer"
      title="Drag to resize selected task drawer"
    >
      <span
        className={`absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
          isResizing ? "bg-copper" : "bg-steel/25"
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
            <div className="text-sm font-black text-ink">Detail</div>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-white text-steel transition hover:bg-[#f4f0e7]"
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

  function patchManufacturingSteps(nextSteps: ManufacturingStep[]) {
    const plannedDurationMinutes = nextSteps.length
      ? nextSteps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0)
      : currentTask.plannedDurationMinutes;

    onUpdateTask(taskId, {
      manufacturingSteps: nextSteps,
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
    const partNumber = (newStepPartNumbers[stepId] ?? "").trim();
    if (!partNumber) {
      return;
    }

    const existingPart = partReferences.find((part) => part.partNumber.trim().toLowerCase() === partNumber.toLowerCase());
    const partReference = existingPart ?? {
      id: `part-${taskId}-${Date.now()}`,
      partNumber,
      description: "",
      quantity: 1,
      disposition: "",
    };
    const taskWithPart = existingPart
      ? currentTask
      : {
          ...currentTask,
          partReferences: [...partReferences, partReference],
        };
    const nextTask = addStepPartReference(taskWithPart, stepId, partReference.id);

	    onUpdateTask(taskId, {
	      manufacturingSteps: nextTask.manufacturingSteps,
	      partReferences: nextTask.partReferences,
	    });
    setNewStepPartNumbers((current) => ({ ...current, [stepId]: "" }));
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

  return (
    <aside data-detail-drawer="true" data-drawer-state={collapsed ? "collapsed" : "expanded"} className={drawerClass}>
      {resizeHandle}
      {collapsedRail}
      <div aria-hidden={collapsed} className={contentClass}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-steel">Selected Task</div>
            <h2 className="mt-1 text-lg font-black leading-tight text-ink">{task.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-white text-steel hover:bg-[#f4f0e7]"
              title="Collapse selected task drawer"
              aria-label="Collapse selected task drawer"
            >
              <ChevronsRight size={16} />
            </button>
            <StatusPill status={task.status} />
          </div>
        </div>

        <div className="space-y-4">
        <div className="rounded-md border border-line bg-white p-3">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-steel">Station</div>
          <div className="text-sm font-bold text-ink">{station.sequence}. {station.name}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-steel">
            <span>Cycle {formatMinutes(station.plannedCycleMinutes)}</span>
            <span>{formatManHours(station.plannedManHours)}</span>
            <span>Operators {station.plannedOperators}</span>
            <span>{station.bottleneckFlag ? "Bottleneck" : "Balanced"}</span>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">Description</span>
          <textarea
            className="min-h-[110px] w-full resize-none rounded border border-line bg-white px-3 py-2 text-sm text-ink outline-none"
            value={task.description ?? ""}
            onChange={(event) => onUpdateTask(task.id, { description: event.target.value })}
          />
        </label>

        <div className="rounded-md border border-line bg-white p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-steel">Manufacturing Steps</div>
              <div className="text-xs font-semibold text-steel">{manufacturingSteps.length} step(s)</div>
            </div>
            <button
              type="button"
              onClick={addManufacturingStep}
              className="inline-flex h-8 items-center gap-1 rounded bg-graphite px-2 text-xs font-bold text-white hover:bg-ink"
            >
              <Plus size={14} />
              Step
            </button>
          </div>
          {manufacturingSteps.length === 0 ? (
            <div className="border-t border-dashed border-line px-1 py-2 text-xs font-semibold text-steel">
              Add operation-level steps for this task.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-2">
                {manufacturingSteps.map((step) => {
                  const stepPhotos = getStepPhotoAttachments(currentTask, step.id);
                  const stepTools = getStepToolList(currentTask, step.id);
                  const selectedChecks = getManufacturingStepCheckSet(step.qualityCheck);

                  return (
                    <div
                      key={step.id}
                      className="grid grid-cols-[minmax(0,1fr)_22px] gap-1.5 border-b border-line/70 px-1 pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-steel">
                          <span className="shrink-0">Step</span>
                          <ClearableNumberInput
                            aria-label={`Step ${step.sequence} sequence`}
                            className="number-input h-6 w-8 rounded border border-line bg-white px-0.5 text-center text-[11px] font-black text-ink outline-none focus:border-copper"
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
                            className="number-input h-6 w-12 rounded border border-line bg-white px-0.5 text-center text-[11px] font-black text-ink outline-none focus:border-copper"
                            value={step.durationMinutes ?? 0}
                            min={0}
                            fallbackValue={step.durationMinutes ?? 0}
                            precision={1}
                            onValueChange={(value) => updateManufacturingStep(step.id, { durationMinutes: value })}
                          />
                        </div>
                        <textarea
                          aria-label={`Step ${step.sequence} instruction`}
                          className="min-h-[86px] w-full resize-none rounded border border-line bg-white px-2 py-2 text-sm font-semibold leading-snug text-ink outline-none focus:border-copper"
                          value={step.instruction}
                          onChange={(event) => updateManufacturingStep(step.id, { instruction: event.target.value })}
                          onKeyDown={(event) =>
                            handleInstructionBulletKeyDown(event, (instruction) =>
                              updateManufacturingStep(step.id, { instruction }),
                            )
                          }
                          placeholder="Describe the manufacturing step"
                        />
                        <button
                          type="button"
                          onClick={() => updateManufacturingStep(step.id, { instruction: applyInstructionBullets(step.instruction) })}
                          className="inline-flex h-7 items-center gap-1 rounded border border-line bg-white px-2 text-[10px] font-black uppercase text-steel hover:border-copper hover:text-copper"
                          aria-label={`Format step ${step.sequence} as bullets`}
                          title={`Format step ${step.sequence} as bullets`}
                        >
                          <ListChecks size={11} />
                          Bullets
                        </button>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black uppercase tracking-wide text-steel">Tools</span>
                            {toolLibrary.length > 0 ? (
                              <select
                                aria-label={`Add saved tool to step ${step.sequence}`}
                                className="h-7 max-w-[150px] rounded border border-line bg-white px-1.5 text-[10px] font-bold text-steel outline-none focus:border-copper"
                                value=""
                                onChange={(event) => {
                                  if (event.target.value) {
                                    addManufacturingStepToolFromLibrary(step.id, event.target.value);
                                  }
                                }}
                              >
                                <option value="">Library</option>
                                {toolLibrary
                                  .filter((tool) => !stepTools.some((stepTool) => stepTool.toLocaleLowerCase() === tool.toLocaleLowerCase()))
                                  .map((tool) => (
                                    <option key={tool} value={tool}>
                                      {tool}
                                    </option>
                                  ))}
                              </select>
                            ) : null}
                          </div>
                          <div className="grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-1">
                            <span className="text-[10px] font-black uppercase tracking-wide text-steel">New</span>
                            <input
                              className="h-7 min-w-0 border-b border-line bg-transparent px-1 text-xs font-semibold text-ink outline-none focus:border-copper"
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
                              className="h-7 text-[10px] font-black uppercase text-graphite hover:text-copper"
                            >
                              Add
                            </button>
                          </div>
                          {stepTools.length > 0 ? (
                            <div className="flex flex-wrap gap-x-2 gap-y-1 pl-[42px] text-[10px] font-bold text-steel">
                              {stepTools.map((tool) => (
                                <span
                                  key={tool}
                                  className="inline-flex min-w-0 items-center gap-1"
                                >
                                  <span className="max-w-[170px] truncate">{tool}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeManufacturingStepTool(step.id, tool)}
                                    className="text-steel/70 hover:text-signal"
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
	                          onDraftChange={(value) =>
	                            setNewStepPartNumbers((current) => ({ ...current, [step.id]: value }))
	                          }
	                          onAddDraft={() => addManufacturingStepPartReference(step.id)}
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
                            onRemove={(photoId) => removeManufacturingStepPhoto(step.id, photoId)}
                          />
                        </div>
                        <div
                          className="grid grid-cols-[minmax(130px,1fr)_82px_48px] gap-1"
                          role="group"
                          aria-label={`Step ${step.sequence} checks`}
                        >
                          {manufacturingStepCheckOptions.map((option) => {
                            const checked = selectedChecks.has(option.key);

                            return (
                              <label
                                key={option.key}
                                title={option.label}
                                className={`flex h-7 min-w-0 items-center justify-center gap-1 rounded border px-1.5 text-[10px] font-black transition ${
                                  checked
                                    ? "border-teal/30 bg-teal/10 text-teal"
                                    : "border-line bg-white text-steel hover:border-copper"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3 shrink-0 accent-teal"
                                  checked={checked}
                                  onChange={(event) => {
                                    const nextChecks = new Set(selectedChecks);

                                    if (event.target.checked) {
                                      nextChecks.add(option.key);
                                    } else {
                                      nextChecks.delete(option.key);
                                    }

                                    updateManufacturingStep(step.id, {
                                      qualityCheck: serializeManufacturingStepCheckSet(nextChecks),
                                    });
                                  }}
                                />
                                <span className="whitespace-nowrap">{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeManufacturingStep(step.id)}
                        className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-steel hover:bg-[#f5e7df] hover:text-signal"
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

        <div className="rounded-md border border-line bg-white p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-steel">Part References</div>
              <div className="text-xs font-semibold text-steel">{partReferences.length} part number(s)</div>
            </div>
            <button
              type="button"
              onClick={addPartReference}
              className="inline-flex h-8 items-center gap-1 rounded bg-graphite px-2 text-xs font-bold text-white hover:bg-ink"
            >
              <Plus size={14} />
              Part
            </button>
          </div>
          <div className="space-y-3">
            {partReferences.length === 0 ? (
              <div className="rounded border border-dashed border-line bg-[#fbfaf6] p-3 text-xs font-semibold text-steel">
                Add part numbers, quantities, and disposition notes used by this task.
              </div>
            ) : null}
            {partReferences.map((part) => (
              <div key={part.id} className="rounded border border-line bg-[#fbfaf6] p-2">
                <div className="mb-2 grid grid-cols-[1fr_74px_34px] items-end gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-steel">Part Number</span>
                    <input
                      className="h-8 w-full rounded border border-line bg-white px-2 text-sm font-bold text-ink outline-none"
                      value={part.partNumber}
                      onChange={(event) => updatePartReference(part.id, { partNumber: event.target.value })}
                      placeholder="PN / kit / drawing ref"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-steel">Qty</span>
                    <ClearableNumberInput
                      className="number-input h-8 w-full rounded border border-line bg-white px-2 text-sm font-bold text-ink outline-none"
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
                    className="flex h-8 items-center justify-center rounded border border-line bg-white text-steel hover:border-signal hover:text-signal"
                    title="Remove part reference"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <label className="mb-2 block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-steel">Description</span>
                  <input
                    className="h-8 w-full rounded border border-line bg-white px-2 text-sm font-semibold text-ink outline-none"
                    value={part.description ?? ""}
                    onChange={(event) => updatePartReference(part.id, { description: event.target.value })}
                    placeholder="What the reference is used for"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-steel">Disposition / Reference Note</span>
                  <input
                    className="h-8 w-full rounded border border-line bg-white px-2 text-sm font-semibold text-ink outline-none"
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
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-steel">Headcount</div>
            <div className="flex h-10 items-center rounded border border-line bg-[#f4f0e7] px-3 text-lg font-black text-ink">
              {task.plannedOperators}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-line bg-white p-3">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-steel">Gates</div>
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
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">Safety Notes</span>
          <textarea
            className="min-h-[88px] w-full resize-none rounded border border-line bg-white px-3 py-2 text-sm text-ink outline-none"
            value={task.safetyNotes ?? ""}
            onChange={(event) => onUpdateTask(task.id, { safetyNotes: event.target.value })}
          />
        </label>
        </div>
      </div>
    </aside>
  );
}

function buildPlaybackEvents(tasks: Task[], timelineStartMs: number, currentMinute: number) {
  const events = [
    { time: 0, label: "Product build started" },
    ...tasks.flatMap((task) => {
      const window = getTaskWindow(task, timelineStartMs);
      return [
        { time: window.startMinute, label: `${task.name} started`, taskId: task.id },
        { time: window.finishMinute, label: `${task.name} complete`, taskId: task.id },
      ];
    }),
  ];

  return events
    .filter((event) => event.time <= currentMinute + 0.25)
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);
}

function PlaybackPanel({
  tasks,
  stations,
  currentMinute,
  speed,
  isPlaying,
  collapsed,
  onPlayPause,
  onReset,
  onStep,
  onSpeed,
  onToggleCollapsed,
}: {
  tasks: Task[];
  stations: Station[];
  currentMinute: number;
  speed: number;
  isPlaying: boolean;
  collapsed: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onStep: (delta: number) => void;
  onSpeed: (speed: number) => void;
  onToggleCollapsed: () => void;
}) {
  const bounds = getTimelineBounds(tasks);
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const activeTasks = tasks.filter((task) => {
    const window = getTaskWindow(task, bounds.startMs);
    return currentMinute >= window.startMinute && currentMinute < window.finishMinute;
  });
  const operatorsActive = activeTasks.reduce((total, task) => total + task.plannedOperators, 0);
  const consumedManHours = tasks.reduce((total, task) => {
    const window = getTaskWindow(task, bounds.startMs);
    if (currentMinute >= window.finishMinute) {
      return total + task.plannedManHours;
    }

    if (currentMinute > window.startMinute) {
      const progress = Math.min((currentMinute - window.startMinute) / Math.max(task.plannedDurationMinutes, 1), 1);
      return total + task.plannedManHours * progress;
    }

    return total;
  }, 0);
  const events = buildPlaybackEvents(tasks, bounds.startMs, currentMinute);
  const nextMilestone = tasks
    .filter((task) => task.rowType === "milestone")
    .find((task) => getTaskWindow(task, bounds.startMs).finishMinute > currentMinute);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-graphite text-white shadow-[0_-16px_42px_rgba(23,33,27,0.2)]">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="absolute left-1/2 top-0 flex h-7 w-10 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-md border border-b-0 border-line bg-graphite text-white hover:bg-ink"
        title={collapsed ? "Expand playback footer" : "Collapse playback footer"}
        aria-label={collapsed ? "Expand playback footer" : "Collapse playback footer"}
      >
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {collapsed ? (
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex h-8 w-8 items-center justify-center rounded bg-copper text-white hover:bg-[#995122]"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <div className="text-[11px] font-black uppercase tracking-wide text-white/60">Simulation Time</div>
            <div className="font-mono text-sm font-black text-white">{formatMinutes(currentMinute)}</div>
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <div className="h-2 flex-1 overflow-hidden rounded bg-white/10">
              <div
                className="h-full rounded bg-copper"
                style={{ width: `${Math.min((currentMinute / bounds.durationMinutes) * 100, 100)}%` }}
              />
            </div>
            <div className="truncate text-xs font-semibold text-white/70">{activeTasks[0]?.name ?? "Idle"}</div>
          </div>
        </div>
      ) : (
      <div className="grid min-h-36 gap-3 px-4 py-3 lg:grid-cols-[360px_minmax(0,1fr)_420px]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex h-10 w-10 items-center justify-center rounded bg-copper text-white hover:bg-[#995122]"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              type="button"
              onClick={() => onStep(-15)}
              className="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-white hover:bg-white/20"
              title="Step back"
            >
              <SkipBack size={17} />
            </button>
            <button
              type="button"
              onClick={() => onStep(15)}
              className="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-white hover:bg-white/20"
              title="Step forward"
            >
              <SkipForward size={17} />
            </button>
            <button
              type="button"
              onClick={onReset}
              className="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-white hover:bg-white/20"
              title="Restart"
            >
              <RotateCcw size={17} />
            </button>
            <select
              className="h-10 rounded border border-white/20 bg-white/10 px-2 text-sm font-bold text-white outline-none"
              value={speed}
              onChange={(event) => onSpeed(safeNumber(event.target.value, speed))}
            >
              {playbackSpeeds.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-white/60">Simulation Time</div>
          <div className="mt-1 text-2xl font-black">{formatMinutes(currentMinute)}</div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-white/10">
            <div
              className="h-full rounded bg-copper"
              style={{ width: `${Math.min((currentMinute / bounds.durationMinutes) * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <StatCard label="Active Tasks" value={`${activeTasks.length}`} meta={activeTasks[0]?.name ?? "Idle"} />
          <StatCard label="Operators" value={`${operatorsActive}`} meta="Active now" />
          <StatCard label="MH Burned" value={formatManHours(consumedManHours)} meta="Planned playback" />
          <StatCard label="Station" value={activeTasks[0] ? `${stationById.get(activeTasks[0].stationId)?.sequence}` : "-"} meta={activeTasks[0] ? stationById.get(activeTasks[0].stationId)?.name : "Idle"} />
          <StatCard label="Next Gate" value={nextMilestone ? nextMilestone.wbs : "-"} meta={nextMilestone?.name ?? "Complete"} />
        </div>

        <div className="overflow-hidden rounded border border-white/10 bg-white/10">
          <div className="flex h-8 items-center gap-2 border-b border-white/10 px-3 text-xs font-black uppercase tracking-wide text-white/70">
            <Activity size={14} />
            Event Log
          </div>
          <div className="max-h-[104px] overflow-auto px-3 py-2">
            {events.map((event) => (
              <div key={`${event.time}-${event.label}`} className="grid grid-cols-[62px_1fr] gap-2 py-1 text-xs">
                <span className="font-mono font-bold text-white/60">{formatMinutes(event.time)}</span>
                <span className="truncate font-semibold text-white">{event.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </footer>
  );
}

export function LineWorkspace({
  projectId,
  projectContext,
}: {
  projectId?: string;
  projectContext?: PlannerProjectContext;
}) {
  const [plannerState, setPlannerState] = useState<PlannerState>(initialPlannerState);
  const [activeModule, setActiveModule] = useState("dashboard");
  const [selectedTaskId, setSelectedTaskId] = useState(initialPlannerState.tasks[0]?.id);
  const [selectedStationId, setSelectedStationId] = useState(initialPlannerState.stations[0]?.id);
  const [activeZoneId, setActiveZoneId] = useState<string>();
  const [currentMinute, setCurrentMinute] = useState(0);
  const [speed, setSpeed] = useState(5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackCollapsed, setPlaybackCollapsed] = useState(true);
  const [detailDrawerCollapsed, setDetailDrawerCollapsed] = useState(true);
  const [detailDrawerWidth, setDetailDrawerWidth] = useState(360);
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false);
  const [isResizingDetailDrawer, setIsResizingDetailDrawer] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveError, setSaveError] = useState<string>();
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const [smartAllocationPending, setSmartAllocationPending] = useState(false);
  const [dismissedPlanningRecommendationKey, setDismissedPlanningRecommendationKey] = useState("");
  const saveInFlightRef = useRef(false);
  const queuedSaveStateRef = useRef<PlannerState | null>(null);
  const plannerDirtyRef = useRef(false);
  const plannerSaveTimerRef = useRef<number | null>(null);
  const procedureSaveInFlightRef = useRef(false);
  const queuedProcedureSaveRef = useRef<{ task: Task; tasks: Task[] } | null>(null);
  const pendingProcedureSaveRef = useRef<{ task: Task; tasks: Task[] } | null>(null);
  const procedureSaveTimerRef = useRef<number | null>(null);
  const procedureRetryTimerRef = useRef<number | null>(null);
  const remoteRefreshTimerRef = useRef<number | null>(null);
  const remoteRefreshAppliedRef = useRef(false);
  const pendingRemoteRefreshRef = useRef(false);
  const [feedbackToasts, setFeedbackToasts] = useState<FeedbackToast[]>([]);
  const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();
  const feedbackToastIdRef = useRef(1);
  const feedbackToastTimersRef = useRef<Map<number, number>>(new Map());
  const detailDrawerResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const derivedState = useMemo<PlannerState>(() => {
    const planningContext = normalizeTaskPlanningContext(
      plannerState.tasks,
      plannerState.zones,
      plannerState.stations,
      plannerState.scenario.id,
    );
    const normalizedTasks = planningContext.tasks.map(syncTaskOperatorCount);
    const calculated = applyCalculatedFields(plannerState.product, planningContext.stations, normalizedTasks);
    return {
      ...plannerState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };
  }, [plannerState]);

  const kpis = useMemo(
    () => calculateProductKpis(derivedState.product, derivedState.stations, derivedState.tasks),
    [derivedState.product, derivedState.stations, derivedState.tasks],
  );

  const timelineBounds = useMemo(() => getTimelineBounds(derivedState.tasks), [derivedState.tasks]);
  const totalHeadcount = kpis.peakManpower;
  const availableOperatorLetters = useMemo(
    () => WORKER_ICON_LETTERS.slice(0, Math.min(Math.max(kpis.wholePersonStaffingRequirement, 0), WORKER_ICON_LETTERS.length)),
    [kpis.wholePersonStaffingRequirement],
  );
  const operatorCapacityMinutes = useMemo(
    () => calculateAvailabilityMinutesForDemandPeriod(derivedState.product),
    [derivedState.product],
  );
  const toolLibrary = useMemo(() => buildStepToolLibrary(derivedState.tasks), [derivedState.tasks]);
  const currentOperatorAllocation = useMemo(() => buildOperatorAssignmentsFromIePlan({
    assignments: derivedState.tasks.map((task) => ({
      taskId: task.id,
      operatorIds: getTaskOperatorIds(task, availableOperatorLetters),
      rationale: "Current Gantt assignment",
    })),
    availableOperatorIds: availableOperatorLetters,
    budgetedAllocationPercent: kpis.requiredAverageAllocationPercent,
    demandQuantity: derivedState.product.demandQuantity,
    operatorCapacityMinutes,
    strategyNotes: ["Current Gantt assignments were audited for planning recommendations."],
    taktMinutes: kpis.taktMinutes,
    tasks: derivedState.tasks,
  }), [
    availableOperatorLetters,
    derivedState.product.demandQuantity,
    derivedState.tasks,
    kpis.requiredAverageAllocationPercent,
    kpis.taktMinutes,
    operatorCapacityMinutes,
  ]);
  const currentAllocationRecommendations = useMemo(() => buildUnallocatedWorkReviews({
    allocation: currentOperatorAllocation,
    kpis,
    operatorCapacityMinutes,
    product: derivedState.product,
  }), [currentOperatorAllocation, derivedState.product, kpis, operatorCapacityMinutes]);
  const currentAllocationRecommendationKey = useMemo(
    () => currentAllocationRecommendations
      .map((recommendation) => [
        recommendation.taskId,
        recommendation.classification,
        recommendation.condition,
        recommendation.action,
      ].join(":"))
      .join("|"),
    [currentAllocationRecommendations],
  );
  const visibleAllocationRecommendations =
    currentAllocationRecommendationKey && dismissedPlanningRecommendationKey === currentAllocationRecommendationKey
      ? []
      : currentAllocationRecommendations;
  const activeProjectContext = derivedState.project ?? projectContext;

  function hasLocalSaveWork() {
    return (
      saveInFlightRef.current ||
      plannerDirtyRef.current ||
      Boolean(plannerSaveTimerRef.current) ||
      procedureSaveInFlightRef.current ||
      Boolean(procedureSaveTimerRef.current) ||
      Boolean(pendingProcedureSaveRef.current)
    );
  }

  function refreshPlannerFromSupabase() {
    if (hasLocalSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    void loadPlannerStateFromSupabase(projectId)
      .then((savedState) => {
        if (!savedState || hasLocalSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        pendingRemoteRefreshRef.current = false;
        remoteRefreshAppliedRef.current = true;
        setPlannerState(savedState);
        setSelectedTaskId((currentTaskId) =>
          savedState.tasks.some((task) => task.id === currentTaskId)
            ? currentTaskId
            : savedState.tasks[0]?.id ?? "",
        );
        setSelectedStationId((currentStationId) =>
          savedState.stations.some((station) => station.id === currentStationId)
            ? currentStationId
            : savedState.stations[0]?.id ?? savedState.tasks[0]?.stationId ?? "",
        );
        setSaveError(undefined);
        setSaveState("saved");
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : "Unable to refresh database changes.");
        setSaveState("error");
      });
  }

  function requestRemotePlannerRefresh() {
    if (hasLocalSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    if (remoteRefreshTimerRef.current) {
      window.clearTimeout(remoteRefreshTimerRef.current);
    }

    remoteRefreshTimerRef.current = window.setTimeout(() => {
      remoteRefreshTimerRef.current = null;
      refreshPlannerFromSupabase();
    }, 350);
  }

  function flushDeferredRemoteRefresh() {
    if (!pendingRemoteRefreshRef.current || hasLocalSaveWork()) {
      return;
    }

    pendingRemoteRefreshRef.current = false;
    requestRemotePlannerRefresh();
  }

  useEffect(() => {
    let mounted = true;

    loadPlannerStateFromSupabase(projectId)
      .then((savedState) => {
        if (!mounted) {
          return;
        }

        if (savedState) {
          const procedureDraft = readProcedureDraftSnapshot();
          const draftTask = procedureDraft
            ? savedState.tasks.find((task) => task.id === procedureDraft.taskId)
            : undefined;
          const hydratedState = draftTask
            ? {
                ...savedState,
                tasks: savedState.tasks.map((task) =>
                  task.id === procedureDraft?.taskId ? { ...task, ...procedureDraft.task } : task,
                ),
              }
            : savedState;
          const selectedTask = draftTask ? procedureDraft?.task : hydratedState.tasks[0];

          setPlannerState(hydratedState);
          setSelectedTaskId(selectedTask?.id ?? "");
          setSelectedStationId(selectedTask?.stationId ?? hydratedState.tasks[0]?.stationId ?? "");
          setActiveZoneId(undefined);
          setHasLoadedRemoteState(true);
          if (draftTask && procedureDraft) {
            setSaveState("draft");
            window.setTimeout(() => {
              scheduleProcedureTaskSave(procedureDraft.task, hydratedState.tasks);
              setSaveState("retrying");
            }, 250);
            return;
          }

          clearProcedureDraftSnapshot();
          setSaveState("saved");
          return;
        }

        setHasLoadedRemoteState(true);
        setSaveState("idle");
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }

        setSaveError(error instanceof Error ? error.message : "Unable to load database state.");
        setHasLoadedRemoteState(true);
        setSaveState("error");
      });

    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return undefined;
    }

    const unsubscribe = subscribePlannerStateChanges(
      () => {
        requestRemotePlannerRefresh();
      },
      {
        productId: derivedState.product.id,
        scenarioId: derivedState.scenario.id,
        taskIds: derivedState.tasks.map((task) => task.id),
      },
    );

    return () => {
      if (remoteRefreshTimerRef.current) {
        window.clearTimeout(remoteRefreshTimerRef.current);
      }
      if (procedureSaveTimerRef.current) {
        window.clearTimeout(procedureSaveTimerRef.current);
        procedureSaveTimerRef.current = null;
      }
      if (procedureRetryTimerRef.current) {
        window.clearTimeout(procedureRetryTimerRef.current);
        procedureRetryTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [derivedState.product.id, derivedState.scenario.id, derivedState.tasks, hasLoadedRemoteState]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = window.setInterval(() => {
      setCurrentMinute((minute) => {
        const nextMinute = minute + speed / 4;
        if (nextMinute >= timelineBounds.durationMinutes) {
          setIsPlaying(false);
          return timelineBounds.durationMinutes;
        }

        return nextMinute;
      });
    }, 250);

    return () => window.clearInterval(interval);
  }, [isPlaying, speed, timelineBounds.durationMinutes]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickedTask = target.closest("[data-task-select]");
      const clickedDrawer = target.closest("[data-detail-drawer]");

      if (!clickedTask && !clickedDrawer) {
        setDetailDrawerCollapsed(true);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    if (!hasLoadedRemoteState || dirtyVersion === 0) {
      return;
    }

    if (remoteRefreshAppliedRef.current) {
      remoteRefreshAppliedRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      if (plannerSaveTimerRef.current === timeout) {
        plannerSaveTimerRef.current = null;
      }
      void persistPlannerState(derivedState);
    }, 900);
    plannerSaveTimerRef.current = timeout;

    return () => {
      window.clearTimeout(timeout);
      if (plannerSaveTimerRef.current === timeout) {
        plannerSaveTimerRef.current = null;
      }
    };
  }, [dirtyVersion, derivedState, hasLoadedRemoteState]);

  useEffect(() => {
    return () => {
      feedbackToastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      feedbackToastTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!isResizingDetailDrawer) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function clampDrawerWidth(width: number) {
      const viewportMax = Math.max(360, window.innerWidth - 520);
      return Math.min(Math.max(width, 320), Math.min(760, viewportMax));
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = detailDrawerResizeRef.current;
      if (!resizeStart) return;

      setDetailDrawerWidth(clampDrawerWidth(resizeStart.startWidth + resizeStart.startX - event.clientX));
    }

    function stopResize() {
      detailDrawerResizeRef.current = null;
      setIsResizingDetailDrawer(false);
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
  }, [isResizingDetailDrawer]);

  function dismissFeedbackToast(id: number) {
    const timer = feedbackToastTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      feedbackToastTimersRef.current.delete(id);
    }

    setFeedbackToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function notifyFeedback(message: Omit<FeedbackToast, "id">) {
    const id = feedbackToastIdRef.current;
    feedbackToastIdRef.current += 1;
    setFeedbackToasts((current) => [...current.slice(-2), { ...message, id }]);
    if (!message.persistent) {
      const timer = window.setTimeout(() => dismissFeedbackToast(id), message.tone === "danger" || message.tone === "warning" ? 9000 : 5200);
      feedbackToastTimersRef.current.set(id, timer);
    }
  }

  function requestFeedbackConfirm(message: FeedbackConfirm) {
    setFeedbackConfirm(message);
  }

  function confirmFeedbackAction() {
    const action = feedbackConfirm?.onConfirm;
    setFeedbackConfirm(undefined);
    action?.();
  }

  function startDetailDrawerResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (detailDrawerCollapsed) return;

    event.preventDefault();
    event.stopPropagation();
    detailDrawerResizeRef.current = {
      startX: event.clientX,
      startWidth: detailDrawerWidth,
    };
    setIsResizingDetailDrawer(true);
  }

  const isProcedureModule = activeModule === "procedure";
  const isDashboardModule = activeModule === "dashboard";
  const showsSchedulingWorkspace = !isProcedureModule && !isDashboardModule && activeModule !== "setup";
  const selectedTask = derivedState.tasks.find((task) => task.id === selectedTaskId) ?? derivedState.tasks[0];
  const selectedStation = selectedTask
    ? buildProcessStationForTask(selectedTask, derivedState.tasks, kpis.bottleneckStation?.id)
    : undefined;
  const workspaceGridClass = isProcedureModule
    ? workspaceDrawerOpen
      ? "grid h-[calc(100dvh-64px)] min-h-0 grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-out lg:grid-cols-[76px_348px_minmax(0,1fr)]"
      : "grid h-[calc(100dvh-64px)] min-h-0 grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-out lg:grid-cols-[76px_minmax(0,1fr)]"
    : workspaceDrawerOpen
      ? "grid h-[calc(100dvh-64px)] min-h-0 grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-out lg:grid-cols-[76px_348px_minmax(0,1fr)] xl:grid-cols-[76px_348px_minmax(0,1fr)_var(--detail-drawer-width)]"
      : "grid h-[calc(100dvh-64px)] min-h-0 grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-out lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[76px_minmax(0,1fr)_var(--detail-drawer-width)]";
  const workspaceGridStyle = {
    "--detail-drawer-width": detailDrawerCollapsed ? "44px" : `${detailDrawerWidth}px`,
  } as CSSProperties;

  if (!hasLoadedRemoteState) {
    return (
      <div className="fixed inset-0 h-[100dvh] overflow-hidden bg-[#f2efe6] text-ink">
        <TopNav
          state={derivedState}
          project={activeProjectContext}
          saveState={saveState}
          saveError={saveError}
          onSave={() => undefined}
          onExport={() => undefined}
        />
        <div className="grid h-[calc(100dvh-64px)] min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[76px_minmax(0,1fr)]">
          <Sidebar
            activeModule={activeModule}
            onChange={setActiveModule}
            project={activeProjectContext}
            workspaceDrawerOpen={false}
            onToggleWorkspaceDrawer={() => undefined}
          />
          <main className="min-h-0 min-w-0 overflow-auto p-4">
            <section className="rounded-md border border-line bg-white p-5 shadow-sm">
              <div className="text-sm font-black text-ink">Loading planner data</div>
              <div className="mt-1 text-xs font-semibold text-steel">
                Reading the saved line plan from Supabase before rendering the workspace.
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  function markDirty() {
    plannerDirtyRef.current = true;
    setSaveError(undefined);
    setDirtyVersion((version) => version + 1);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "idle"));
  }

  async function persistPlannerState(stateToSave: PlannerState) {
    if (stateToSave.tasks.length === 0) {
      setSaveError("Refusing to save an empty Gantt. Add at least one task before saving.");
      setSaveState("error");
      return;
    }

    if (saveInFlightRef.current) {
      queuedSaveStateRef.current = stateToSave;
      setSaveState("saving");
      return;
    }

    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    let nextState: PlannerState | null = stateToSave;

    while (nextState) {
      queuedSaveStateRef.current = null;

      try {
        await savePlannerShellToSupabase(nextState);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Unable to save planner state.");
        setSaveState("error");
        saveInFlightRef.current = false;
        return;
      }

      nextState = queuedSaveStateRef.current;
    }

    saveInFlightRef.current = false;
    plannerDirtyRef.current = false;
    setSaveState("saved");
    flushDeferredRemoteRefresh();
  }

  async function persistProcedureTaskUpdate(taskToSave: Task, tasksToSave: Task[]) {
    if (procedureSaveInFlightRef.current) {
      queuedProcedureSaveRef.current = { task: taskToSave, tasks: tasksToSave };
      setSaveState("saving");
      return;
    }

    procedureSaveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    let nextSave: { task: Task; tasks: Task[] } | null = { task: taskToSave, tasks: tasksToSave };
    let lastSavedTaskId = taskToSave.id;
    let lastSavedTask: Task | null = null;

    while (nextSave) {
      queuedProcedureSaveRef.current = null;

      try {
        lastSavedTask = await saveProcedureTaskUpdateToSupabase(nextSave.task, nextSave.tasks, projectId);
        lastSavedTaskId = nextSave.task.id;
      } catch (error) {
        const failedSave = nextSave;
        writeProcedureDraftSnapshot(failedSave.task);
        setSaveError(error instanceof Error ? error.message : "Unable to save procedure task.");
        setSaveState("retrying");
        procedureSaveInFlightRef.current = false;
        queuedProcedureSaveRef.current = null;
        flushDeferredRemoteRefresh();

        if (!procedureRetryTimerRef.current) {
          procedureRetryTimerRef.current = window.setTimeout(() => {
            procedureRetryTimerRef.current = null;
            const latestPendingSave = pendingProcedureSaveRef.current ?? failedSave;
            pendingProcedureSaveRef.current = null;
            void persistProcedureTaskUpdate(latestPendingSave.task, latestPendingSave.tasks);
          }, 2500);
        }
        return;
      }

      const queuedNextSave = queuedProcedureSaveRef.current as unknown as { task: Task; tasks: Task[] } | null;
      nextSave = queuedNextSave;
      if (queuedNextSave && lastSavedTask) {
        const versionedTask = applyProcedureVersionSnapshot(queuedNextSave.task, lastSavedTask);
        nextSave = {
          task: versionedTask,
          tasks: queuedNextSave.tasks.map((task) => (task.id === versionedTask.id ? versionedTask : task)),
        };
      }
    }

    procedureSaveInFlightRef.current = false;
    clearProcedureDraftSnapshot(lastSavedTaskId);
    if (lastSavedTask) {
      remoteRefreshAppliedRef.current = true;
      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => (task.id === lastSavedTask?.id ? { ...task, ...lastSavedTask } : task)),
      }));
    }
    setSaveState("saved");
    flushDeferredRemoteRefresh();
  }

  function scheduleProcedureTaskSave(taskToSave: Task, tasksToSave: Task[]) {
    writeProcedureDraftSnapshot(taskToSave);
    pendingProcedureSaveRef.current = { task: taskToSave, tasks: tasksToSave };

    if (procedureSaveTimerRef.current) {
      window.clearTimeout(procedureSaveTimerRef.current);
    }

    if (procedureRetryTimerRef.current) {
      window.clearTimeout(procedureRetryTimerRef.current);
      procedureRetryTimerRef.current = null;
    }

    procedureSaveTimerRef.current = window.setTimeout(() => {
      procedureSaveTimerRef.current = null;
      const nextSave = pendingProcedureSaveRef.current;
      pendingProcedureSaveRef.current = null;

      if (nextSave) {
        void persistProcedureTaskUpdate(nextSave.task, nextSave.tasks);
      }
    }, PROCEDURE_SAVE_DEBOUNCE_MS);
  }

  async function savePlannerState() {
    if (activeModule === "procedure" && selectedTask) {
      await persistProcedureTaskUpdate(selectedTask, derivedState.tasks);
      return;
    }

    await persistPlannerState(derivedState);
  }

  function updateProductNumber(field: ProductNumberField, value: number) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      product: {
        ...current.product,
        [field]: Math.max(value, 0),
      },
    }));
  }

  function updateProductText(field: ProductTextField, value: string) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      product: {
        ...current.product,
        [field]: value,
      },
    }));
  }

  function updateTask(taskId: string, patch: Partial<Task>) {
    markDirty();
    if (patch.stationId && taskId === selectedTaskId) {
      setSelectedStationId(patch.stationId);
    }

    setPlannerState((current) => {
      const tasks = current.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));

      return {
        ...current,
        tasks: patch.plannedDurationMinutes === undefined ? tasks : rescheduleTasksByDependencies(tasks),
      };
    });
  }

  function updateProcedureTask(taskId: string, patch: Partial<Task>) {
    setSaveError(undefined);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "draft"));
    if (patch.stationId && taskId === selectedTaskId) {
      setSelectedStationId(patch.stationId);
    }

    const patchKeys = Object.keys(patch) as Array<keyof Task>;
    const isNormalizedAssetPatch = patchKeys.length === 1 && patchKeys[0] === "customFields";

    setPlannerState((current) => {
      const patchedTasks = current.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
      const scheduledTasks = patch.plannedDurationMinutes === undefined
        ? patchedTasks
        : rescheduleTasksByDependencies(patchedTasks);
      const taskToSave = scheduledTasks.find((task) => task.id === taskId);

      if (taskToSave && !isNormalizedAssetPatch) {
        scheduleProcedureTaskSave(taskToSave, scheduledTasks);
      }

      return {
        ...current,
        tasks: scheduledTasks,
      };
    });
  }

  async function persistAddStepTool(taskId: string, stepId: string, toolName: string, sequence = 1) {
    setSaveError(undefined);
    setSaveState("saving");

    try {
      await addStepToolToSupabase(taskId, stepId, toolName, sequence, projectId);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to add the tool.");
      setSaveState("error");
    }
  }

  async function persistRemoveStepTool(stepId: string, toolName: string) {
    setSaveError(undefined);
    setSaveState("saving");

    try {
      const taskId = derivedState.tasks.find((task) =>
        (task.manufacturingSteps ?? []).some((step) => step.id === stepId),
      )?.id;
      await removeStepToolFromSupabase(stepId, toolName, taskId, projectId);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to remove the tool.");
      setSaveState("error");
    }
  }

  async function uploadStepPhotos(taskId: string, stepId: string, files: File[]) {
    if (files.length === 0) {
      return;
    }

    let localPhotos: StepPhotoAttachment[] = [];
    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    try {
      localPhotos = await Promise.all(files.map(buildStepPhotoAttachment));

      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? upsertStepPhotoAttachments(task, stepId, localPhotos) : task,
        ),
      }));

      const uploadedPhotos = await Promise.all(
        localPhotos.map((photo) => uploadStepPhotoAttachment(taskId, stepId, photo, activeProjectContext)),
      );

      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? upsertStepPhotoAttachments(task, stepId, uploadedPhotos) : task,
        ),
      }));

      setSaveState("saved");
    } catch (error) {
      if (localPhotos.length > 0) {
        setPlannerState((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? localPhotos.reduce(
                  (taskWithoutFailedPhoto, photo) => removeStepPhotoAttachment(taskWithoutFailedPhoto, stepId, photo.id),
                  task,
                )
              : task,
          ),
        }));
      }

      setSaveError(error instanceof Error ? error.message : "Unable to attach the selected photo.");
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      flushDeferredRemoteRefresh();
    }
  }

  async function removeStepPhoto(taskId: string, stepId: string, photoId: string) {
    let removedPhoto: StepPhotoAttachment | undefined;
    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");

    setPlannerState((current) => {
      const currentTask = current.tasks.find((task) => task.id === taskId);
      removedPhoto = currentTask ? getStepPhotoAttachments(currentTask, stepId).find((photo) => photo.id === photoId) : undefined;

      return {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? removeStepPhotoAttachment(task, stepId, photoId) : task,
        ),
      };
    });

    try {
      await softDeleteStepPhotoAttachmentFromSupabase(photoId, taskId, projectId);

      setSaveState("saved");
    } catch (error) {
      if (removedPhoto) {
        setPlannerState((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId ? upsertStepPhotoAttachments(task, stepId, [removedPhoto as StepPhotoAttachment]) : task,
          ),
        }));
      }

      setSaveError(error instanceof Error ? error.message : "Unable to remove the selected photo.");
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      flushDeferredRemoteRefresh();
    }
  }

  function resetTaskHeadcount() {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => ({ ...task, ...getTaskOperatorResetPatch(task) })),
    }));
  }

  function copyTextWithSelection(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);

    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function copySmartAllocationReview(text: string) {
    let copied = false;
    const errors: string[] = [];

    try {
      copied = copyTextWithSelection(text);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Legacy clipboard copy failed.");
    }

    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Clipboard API copy failed.");
      }
    }

    if (copied) {
      notifyFeedback({
        title: "Allocation audit copied",
        body: "Paste it here and I can review the allocation inputs, audit, issues, and Gantt rows.",
        tone: "success",
      });
      return;
    }

    notifyFeedback({
      title: "Manual copy needed",
      content: (
        <div className="space-y-3">
          <div className="text-sm font-semibold leading-relaxed text-steel">
            The browser blocked clipboard access. Select the text below and copy it manually.
          </div>
          <textarea
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="h-[320px] w-full resize-none rounded border border-line bg-white p-3 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper/20"
          />
          {errors.length ? (
            <div className="rounded border border-line bg-[#fbfaf6] px-3 py-2 text-[11px] font-semibold leading-snug text-steel">
              {errors.join(" ")}
            </div>
          ) : null}
        </div>
      ),
      tone: "warning",
      placement: "center",
      persistent: true,
    });
  }

  async function smartAllocateHeadcount() {
    if (smartAllocationPending) {
      return;
    }

    const operatorCapacityMinutes = calculateAvailabilityMinutesForDemandPeriod(derivedState.product);
    const clearedTasks = derivedState.tasks.map((task) => ({
      ...task,
      ...getTaskOperatorResetPatch(task),
    }));
    const clearedPlanningContext = normalizeTaskPlanningContext(
      clearedTasks,
      derivedState.zones,
      derivedState.stations,
      derivedState.scenario.id,
    );
    const clearedCalculatedState = applyCalculatedFields(
      derivedState.product,
      clearedPlanningContext.stations,
      clearedPlanningContext.tasks.map(syncTaskOperatorCount),
    );
    const clearedKpis = calculateProductKpis(
      clearedCalculatedState.product,
      clearedCalculatedState.stations,
      clearedCalculatedState.tasks,
    );
    const request: IeSmartAllocationRequest = {
      plannerState: {
        ...derivedState,
        product: clearedCalculatedState.product,
        stations: clearedCalculatedState.stations,
        tasks: clearedCalculatedState.tasks,
      },
      availableOperatorIds: availableOperatorLetters,
      constraints: {
        demandPeriod: derivedState.product.demandPeriod,
        demandQuantity: derivedState.product.demandQuantity,
        targetManHours: derivedState.product.targetManHours,
        taktMinutes: clearedKpis.taktMinutes,
        budgetedCrewEquivalent: clearedKpis.budgetedCrewEquivalent,
        wholePersonStaffingRequirement: clearedKpis.wholePersonStaffingRequirement,
        requiredAverageAllocationPercent: clearedKpis.requiredAverageAllocationPercent,
        operatorCapacityMinutes,
        plannedManHours: clearedKpis.plannedManHours,
        assignedPlannedManHours: clearedKpis.assignedPlannedManHours,
        unassignedPlannedManHours: clearedKpis.unassignedPlannedManHours,
        plannedLaborLoadFte: clearedKpis.plannedLaborLoadFte,
        assignedLaborLoadFte: clearedKpis.assignedLaborLoadFte,
        peakManpower: clearedKpis.peakManpower,
      },
    };

    let agentPlan: IeSmartAllocationPlan;
    try {
      setSmartAllocationPending(true);
      agentPlan = await requestIeSmartAllocationPlan(request);
    } catch (error) {
      notifyFeedback({
        title: "Smart allocation unavailable",
        body: error instanceof Error ? error.message : "The IE allocation agent could not return a plan.",
        tone: "danger",
        placement: "center",
        persistent: true,
      });
      setSmartAllocationPending(false);
      return;
    }

    const allocation = buildOperatorAssignmentsFromIePlan({
      assignments: agentPlan.assignments,
      availableOperatorIds: availableOperatorLetters,
      budgetedAllocationPercent: clearedKpis.requiredAverageAllocationPercent,
      demandQuantity: derivedState.product.demandQuantity,
      operatorCapacityMinutes,
      strategyNotes: agentPlan.strategyNotes,
      taktMinutes: clearedKpis.taktMinutes,
      tasks: clearedCalculatedState.tasks,
    });
    const reviewPlanningContext = normalizeTaskPlanningContext(
      allocation.tasks,
      derivedState.zones,
      derivedState.stations,
      derivedState.scenario.id,
    );
    const reviewCalculatedState = applyCalculatedFields(
      derivedState.product,
      reviewPlanningContext.stations,
      reviewPlanningContext.tasks.map(syncTaskOperatorCount),
    );
    const reviewKpis = calculateProductKpis(
      reviewCalculatedState.product,
      reviewCalculatedState.stations,
      reviewCalculatedState.tasks,
    );
    const allocatedTaskById = new Map(allocation.tasks.map((task) => [task.id, task]));
    const proposedChangedTaskIds = derivedState.tasks
      .filter((task) => {
        const allocatedTask = allocatedTaskById.get(task.id);
        if (!allocatedTask) {
          return false;
        }

        return (
          getTaskOperatorIds(task, availableOperatorLetters).join("|") !==
            getTaskOperatorIds(allocatedTask, availableOperatorLetters).join("|") ||
          task.plannedOperators !== allocatedTask.plannedOperators
        );
      })
      .map((task) => task.id);
    const hardValidationFailure =
      allocation.audit.scheduleConflictCount > 0 ||
      allocation.audit.physicalCapacityOverageCount > 0 ||
      allocation.audit.summaryTaskAssignmentCount > 0;
    const validationRejectionReason = hardValidationFailure
      ? [
          allocation.audit.scheduleConflictCount > 0 ? `${allocation.audit.scheduleConflictCount} schedule conflict(s)` : "",
          allocation.audit.physicalCapacityOverageCount > 0 ? `${allocation.audit.physicalCapacityOverageCount} physical capacity overage(s)` : "",
          allocation.audit.summaryTaskAssignmentCount > 0 ? `${allocation.audit.summaryTaskAssignmentCount} summary row assignment(s)` : "",
        ].filter(Boolean).join(", ")
      : undefined;
    const changedTaskIds = hardValidationFailure ? [] : proposedChangedTaskIds;
    const reviewText = buildSmartAllocationReviewText({
      agentPlan,
      allocation: {
        ...allocation,
        tasks: reviewCalculatedState.tasks,
      },
      applicationStatus: {
        applied: !hardValidationFailure,
        appliedTaskCount: changedTaskIds.length,
        proposedTaskCount: proposedChangedTaskIds.length,
        rejectionReason: validationRejectionReason,
      },
      availableOperatorLetters,
      kpis: reviewKpis,
      operatorCapacityMinutes,
      product: derivedState.product,
      zones: derivedState.zones,
    });

    if (changedTaskIds.length > 0) {
      markDirty();
      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => {
          const allocatedTask = allocatedTaskById.get(task.id);
          if (!allocatedTask) {
            return task;
          }

          return {
            ...task,
            customFields: allocatedTask.customFields,
            plannedOperators: allocatedTask.plannedOperators,
          };
        }),
      }));
    }

    const issueGroups = allocation.issues.reduce((groups, issue) => {
      const key = issue.taskId ?? issue.operatorId ?? issue.message;
      const current = groups.get(key) ?? {
        label: issue.taskId
          ? allocation.tasks.find((task) => task.id === issue.taskId)?.name ?? issue.message
          : issue.operatorId
            ? `Operator ${issue.operatorId}`
            : issue.message,
        blockers: new Set<string>(),
        warnings: new Set<string>(),
      };
      const severity =
        issue.severity ??
        (issue.kind === "unassigned_task" || issue.kind === "capacity_overage" || issue.kind === "schedule_conflict"
          ? "blocker"
          : "warning");
      const reason =
        issue.kind === "unassigned_task"
          ? issueReviewLabel(issue)
          : issue.kind === "takt_overage"
            ? "exceeds takt"
            : issue.kind === "budget_overage"
              ? "over budgeted allocation"
              : issue.kind === "capacity_overage"
                ? "over physical capacity"
                : "schedule conflict";

      if (severity === "blocker") {
        current.blockers.add(reason);
      } else {
        current.warnings.add(reason);
      }
      groups.set(key, current);
      return groups;
    }, new Map<string, { label: string; blockers: Set<string>; warnings: Set<string> }>());
    const issueEntries = [...issueGroups.values()].map((issue) => ({
      label: issue.label,
      blockers: [...issue.blockers],
      warnings: [...issue.warnings],
    }));
    const unallocatedWorkReviews = buildUnallocatedWorkReviews({
      allocation,
      kpis: reviewKpis,
      operatorCapacityMinutes,
      product: derivedState.product,
    });
    const nonUnallocatedBlockerCount = allocation.issues.filter((issue) => {
      const severity =
        issue.severity ??
        (issue.kind === "unassigned_task" || issue.kind === "capacity_overage" || issue.kind === "schedule_conflict"
          ? "blocker"
          : "warning");
      return severity === "blocker" && issue.kind !== "unassigned_task";
    }).length;
    const audit = allocation.audit;
    const visibleIssueEntries = issueEntries.slice(0, 6);
    const issueRemainder = issueEntries.length - visibleIssueEntries.length;
    notifyFeedback({
      title: hardValidationFailure
        ? "IE allocation rejected"
        : unallocatedWorkReviews.length
          ? "Feasible with exceptions"
          : "IE smart allocation complete",
      content: (
        <div className="space-y-3">
          <div className="rounded-md border border-line bg-[#fbfaf6] p-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-steel">IE Agent Summary</div>
            <div className="mt-1 text-sm font-bold leading-snug text-ink">{agentPlan.summary}</div>
          </div>

          {hardValidationFailure ? (
            <div className="rounded-md border border-signal/30 bg-[#f9e7e3] p-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-signal">Not Applied</div>
              <div className="mt-1 text-sm font-bold leading-snug text-ink">
                The IE agent returned an invalid headcount plan. No Gantt assignments were changed because validation found {validationRejectionReason}.
              </div>
            </div>
          ) : null}

          {unallocatedWorkReviews.length ? (
            <div className="rounded-md border border-amber/35 bg-[#fffaf0]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/25 px-3 py-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#7a4e09]">Unallocated Required Work</div>
                  <div className="mt-0.5 text-xs font-bold text-steel">
                    The plan is feasible only after these staffing exceptions are resolved.
                  </div>
                </div>
                <div className="text-[10px] font-black text-[#7a4e09]">{unallocatedWorkReviews.length} exception(s)</div>
              </div>
              <div className="max-h-[190px] overflow-auto">
                {unallocatedWorkReviews.map((review) => (
                  <div
                    key={review.taskId}
                    className="grid gap-2 border-b border-amber/20 bg-white px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(150px,0.8fr)_1.3fr_minmax(120px,0.55fr)]"
                  >
                    <div>
                      <div className="font-black leading-snug text-ink">{review.taskLabel}</div>
                      <div className="mt-1 inline-flex rounded border border-amber/35 bg-[#fff7e8] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#7a4e09]">
                        {review.classification}
                      </div>
                    </div>
                    <div>
                      <div className="font-black text-steel">{review.condition}</div>
                      <div className="mt-1 font-semibold leading-snug text-steel">{review.impact}</div>
                      <div className="mt-1 font-bold leading-snug text-ink">{review.recommendation}</div>
                    </div>
                    <div className="flex items-start sm:justify-end">
                      <span className="inline-flex rounded border border-graphite/20 bg-[#f4f0e7] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-graphite">
                        {review.action}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-[#fbfaf6] px-3 py-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-steel">Review Packet</div>
              <div className="mt-0.5 text-xs font-bold text-steel">
                Copies audit text plus the Gantt data used by Smart Allocation.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void copySmartAllocationReview(reviewText)}
              className="inline-flex h-9 items-center gap-2 rounded border border-graphite bg-graphite px-3 text-xs font-black text-white outline-none transition hover:bg-ink focus-visible:ring-2 focus-visible:ring-copper"
            >
              <Copy size={14} />
              Copy Audit
            </button>
          </div>

          <div className="rounded-md border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-steel">Allocation Audit</div>
                <div className="mt-0.5 text-xs font-bold text-steel">
                  {round(audit.assignmentCoveragePercent, 0)}% coverage · peak {audit.peakManpower} · spread {formatMinutes(audit.loadSpreadMinutes)}
                </div>
              </div>
              <div className="text-[10px] font-black uppercase tracking-wide text-steel">
                {audit.assignedTaskCount}/{audit.eligibleTaskCount} eligible task(s)
              </div>
            </div>

            <div className="p-2">
              <div className="overflow-hidden rounded border border-line">
                <div className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-[#f4f0e7] px-2 py-1.5 text-[9px] font-black uppercase tracking-wide text-steel">
                  <div>Op</div>
                  <div>Load</div>
                  <div>Work</div>
                  <div>Budget</div>
                </div>
                {audit.operators.map((operator, index) => {
                  const budgetTone =
                    operator.budgetVarianceMinutes > 1
                      ? "text-[#7a4e09]"
                      : operator.budgetVarianceMinutes < -1
                        ? "text-steel"
                        : "text-teal";
                  return (
                    <div
                      key={operator.operatorId}
                      className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-[#fbfaf6] px-2 py-1.5 text-xs last:border-b-0"
                      title={operator.assignedTaskLabels.join("\n")}
                    >
                      <div className="flex items-center gap-2">
                        <WorkerIcon className="h-6 w-6 shrink-0" colorIndex={index} letter={operator.operatorId} />
                      </div>
                      <div className="whitespace-nowrap">
                        <span className="font-black text-ink">{formatMinutes(operator.assignedMinutes)}</span>
                        <span className="ml-1 font-bold text-steel">· {round(operator.utilizationPercent, 0)}%</span>
                      </div>
                      <div className="truncate font-bold text-steel">
                        {operator.assignedTaskCount} task(s) · {operator.idleGapCount > 0 ? `${formatMinutes(operator.idleMinutes)} idle` : "continuous"}
                      </div>
                      <div className={`truncate font-black ${budgetTone}`}>
                        {operator.budgetVarianceMinutes > 1
                          ? `+${formatMinutes(operator.budgetVarianceMinutes)} vs budget`
                          : operator.budgetVarianceMinutes < -1
                            ? `${formatMinutes(Math.abs(operator.budgetVarianceMinutes))} under budget`
                            : "on budget"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-line px-3 py-2 text-[11px] font-semibold leading-snug text-steel">
              {audit.strategyNotes[audit.strategyNotes.length - 1]}
            </div>
          </div>

          {issueEntries.length ? (
            <div className="rounded-md border border-line bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-wide text-steel">Needs Review</div>
                <div className="text-[10px] font-black text-steel">{issueEntries.length} item(s)</div>
              </div>
              <div className="max-h-[170px] overflow-auto">
                {visibleIssueEntries.map((issue) => (
                  <div key={issue.label} className="grid gap-2 border-b border-line bg-[#fbfaf6] px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(180px,1fr)_1.35fr] sm:items-center">
                    <div className="truncate text-sm font-black leading-snug text-ink" title={issue.label}>
                      {issue.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {issue.blockers.map((reason) => (
                        <span
                          key={reason}
                          className="inline-flex h-6 items-center rounded border border-signal/30 bg-[#f9e7e3] px-2 text-[9px] font-black uppercase tracking-wide text-signal"
                        >
                          {reason}
                        </span>
                      ))}
                      {issue.warnings.map((reason) => (
                        <span
                          key={reason}
                          className="inline-flex h-6 items-center rounded border border-amber/35 bg-[#fff7e8] px-2 text-[9px] font-black uppercase tracking-wide text-[#7a4e09]"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {issueRemainder > 0 ? (
                  <div className="bg-white px-3 py-2 text-xs font-bold text-steel">
                    {issueRemainder} more item(s)
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-teal/25 bg-[#ecf5f1] p-3 text-sm font-bold text-teal">
              All eligible tasks were assigned without review items.
            </div>
          )}
        </div>
      ),
      tone: hardValidationFailure || nonUnallocatedBlockerCount ? "danger" : issueEntries.length ? "warning" : "success",
      placement: "center",
      persistent: true,
    });
    setSmartAllocationPending(false);
  }

  function setTaskDependencies(taskId: string, dependencyIds: string[]) {
    markDirty();
    setPlannerState((current) => {
      const sanitizedDependencyIds = sanitizeDependencyIds(current.tasks, taskId, dependencyIds);
      const existingDependencies = new Map(
        current.dependencies
          .filter((dependency) => dependency.successorTaskId === taskId)
          .map((dependency) => [dependency.predecessorTaskId, dependency]),
      );
      const successorTask = current.tasks.find((task) => task.id === taskId);

      const tasks = current.tasks.map((task) =>
        task.id === taskId ? { ...task, dependencyIds: sanitizedDependencyIds } : task,
      );

      return {
        ...current,
        tasks: rescheduleTasksByDependencies(tasks),
        dependencies: [
          ...current.dependencies.filter((dependency) => dependency.successorTaskId !== taskId),
          ...sanitizedDependencyIds.map((predecessorTaskId, index) => {
            const existing = existingDependencies.get(predecessorTaskId);
            return {
              id: existing?.id ?? `dep-${predecessorTaskId}-${taskId}-${index}`,
              predecessorTaskId,
              successorTaskId: taskId,
              type: existing?.type ?? "finish_to_start",
              lagMinutes: existing?.lagMinutes,
              constraintType: existing?.constraintType ?? (successorTask?.qualityGate ? "quality" : undefined),
            };
          }),
        ],
      };
    });
  }

  function linkTaskStartToFinish(targetTaskId: string, predecessorTaskId: string) {
    markDirty();
    setPlannerState((current) => {
      const targetTask = current.tasks.find((task) => task.id === targetTaskId);
      const predecessorTask = current.tasks.find((task) => task.id === predecessorTaskId);

      if (!targetTask || !predecessorTask) {
        return current;
      }

      const relinkedTasks = relinkTasksForDependency(current.tasks, targetTaskId, predecessorTaskId);
      const predecessorScheduledTasks = rescheduleTasksByDependencies(relinkedTasks);
      const scheduledPredecessor = predecessorScheduledTasks.find((task) => task.id === predecessorTaskId);
      const predecessorFinishMs = Date.parse(scheduledPredecessor?.plannedFinish ?? predecessorTask.plannedFinish);
      const anchoredTasks = predecessorScheduledTasks.map((task) => {
        if (task.id !== targetTaskId || !Number.isFinite(predecessorFinishMs)) {
          return task;
        }

        const plannedStart = new Date(predecessorFinishMs).toISOString();

        return {
          ...task,
          plannedStart,
          plannedFinish: new Date(predecessorFinishMs + Math.max(task.plannedDurationMinutes, 0) * 60_000).toISOString(),
        };
      });
      const scheduledTasks = rescheduleTasksByDependencies(anchoredTasks);

      return {
        ...current,
        tasks: scheduledTasks,
        dependencies: rebuildDependenciesFromTasks(scheduledTasks, current.dependencies),
      };
    });

    setSelectedTaskId(targetTaskId);
    const targetTask = derivedState.tasks.find((task) => task.id === targetTaskId);
    if (targetTask) {
      setSelectedStationId(targetTask.stationId);
    }
  }

  function updateStationOperators(stationId: string, operators: number) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      stations: current.stations.map((station) =>
        station.id === stationId ? { ...station, plannedOperators: Math.max(operators, 0) } : station,
      ),
    }));
  }

  function addZone() {
    markDirty();
    const now = new Date().toISOString();
    const colors = ["#15756d", "#b7642c", "#52606d", "#c88a18", "#7d5a9e", "#3d6f8f"];
    const zoneId = `zone-${Date.now()}`;
    setPlannerState((current) => {
      const nextSequence = Math.max(0, ...current.zones.map((zone) => zone.sequence)) + 1;
      const zone: Zone = {
        id: zoneId,
        scenarioId: current.scenario.id,
        sequence: nextSequence,
        name: "",
        color: colors[(nextSequence - 1) % colors.length],
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...current,
        zones: [...current.zones, zone],
      };
    });
    setActiveZoneId(zoneId);
  }

  function createZoneFromTasks(name: string, taskIds: string[]) {
    const trimmedName = name.trim();
    if (!trimmedName || taskIds.length === 0) {
      return;
    }

    markDirty();
    const now = new Date().toISOString();
    const colors = ["#15756d", "#b7642c", "#52606d", "#c88a18", "#7d5a9e", "#3d6f8f"];
    const zoneId = `zone-${Date.now()}`;
    const taskIdSet = new Set(taskIds);

    setPlannerState((current) => {
      const nextSequence = Math.max(0, ...current.zones.map((zone) => zone.sequence)) + 1;
      const zone: Zone = {
        id: zoneId,
        scenarioId: current.scenario.id,
        sequence: nextSequence,
        name: trimmedName,
        color: colors[(nextSequence - 1) % colors.length],
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...current,
        zones: [...current.zones, zone],
        tasks: current.tasks.map((task) => (taskIdSet.has(task.id) ? { ...task, zoneId, stationId: stationIdForZone(zoneId) } : task)),
      };
    });
    setActiveZoneId(zoneId);
  }

  function updateZone(zoneId: string, patch: Partial<Zone>) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      zones: current.zones.map((zone) =>
        zone.id === zoneId ? { ...zone, ...patch, updatedAt: new Date().toISOString() } : zone,
      ),
    }));
  }

  function deleteZone(zoneId: string) {
    markDirty();
    setPlannerState((current) => ({
      ...current,
      zones: current.zones
        .filter((zone) => zone.id !== zoneId)
        .map((zone, index) => ({ ...zone, sequence: index + 1 })),
      tasks: current.tasks.map((task) =>
        task.zoneId === zoneId
          ? { ...task, zoneId: undefined, stationId: stationIdForUnzoned(task.scenarioId || current.scenario.id) }
          : task,
      ),
    }));
    setActiveZoneId((current) => (current === zoneId ? undefined : current));
  }

  function moveTasksToZone(taskIds: string[], zoneId?: string) {
    markDirty();
    const taskIdSet = new Set(taskIds);
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        taskIdSet.has(task.id)
          ? {
              ...task,
              zoneId,
              stationId: zoneId ? stationIdForZone(zoneId) : stationIdForUnzoned(task.scenarioId || current.scenario.id),
            }
          : task,
      ),
    }));
    setActiveZoneId(zoneId);
  }

  function reorderTaskGroups(
    sourceTaskIds: string[],
    targetTaskIds: string[],
    targetZoneId: string | undefined,
    placement: "before" | "after",
  ) {
    markDirty();
    const sourceTaskIdSet = new Set(sourceTaskIds);
    const targetTaskIdSet = new Set(targetTaskIds);

    setPlannerState((current) => {
      const grouped = new Map<string, Task[]>();
      current.tasks.forEach((task) => {
        const processNumber = getTaskProcessNumber(task);
        const group = grouped.get(processNumber);
        if (group) {
          group.push(task);
        } else {
          grouped.set(processNumber, [task]);
        }
      });

      const groups = Array.from(grouped.entries())
        .map(([processNumber, groupTasks]) => ({
          processNumber,
          tasks: groupTasks,
          isSource: groupTasks.some((task) => sourceTaskIdSet.has(task.id)),
          isTarget: groupTasks.some((task) => targetTaskIdSet.has(task.id)),
        }))
        .sort((a, b) => Number.parseFloat(a.processNumber) - Number.parseFloat(b.processNumber));

      const sourceGroup = groups.find((group) => group.isSource);
      const targetGroup = groups.find((group) => group.isTarget);

      if (!sourceGroup || !targetGroup || sourceGroup.processNumber === targetGroup.processNumber) {
        return current;
      }

      const remainingGroups = groups.filter((group) => group !== sourceGroup);
      const targetIndex = remainingGroups.findIndex((group) => group === targetGroup);
      const insertIndex = targetIndex < 0 ? remainingGroups.length : targetIndex + (placement === "after" ? 1 : 0);
      const orderedGroups = [
        ...remainingGroups.slice(0, insertIndex),
        sourceGroup,
        ...remainingGroups.slice(insertIndex),
      ];

      const tasks = orderedGroups.flatMap((group, groupIndex) => {
        const nextProcessNumber = String(groupIndex + 1);
        const movedIntoZone = group === sourceGroup;

        return group.tasks.map((task) => {
          const suffix = getTaskWbsSuffix(task);
          const nextZoneId = movedIntoZone ? targetZoneId : task.zoneId;
          return {
            ...task,
            zoneId: nextZoneId,
            stationId: nextZoneId ? stationIdForZone(nextZoneId) : stationIdForUnzoned(task.scenarioId || current.scenario.id),
            wbs: suffix ? `${nextProcessNumber}.${suffix}` : nextProcessNumber,
          };
        });
      });

      return {
        ...current,
        tasks,
      };
    });

    setActiveZoneId(targetZoneId);
  }

  function addTaskToZone(zoneId?: string) {
    markDirty();
    const currentTasks = plannerState.tasks;
    const zoneTasks = currentTasks.filter((task) => (zoneId ? task.zoneId === zoneId : !task.zoneId));
    const lastZoneTask = zoneTasks[zoneTasks.length - 1];
    const lastTask = lastZoneTask ?? currentTasks[currentTasks.length - 1];
    const stationId = zoneId ? stationIdForZone(zoneId) : lastTask?.stationId ?? plannerState.stations[0]?.id ?? "";
    const nextWbs = String(
      Math.max(0, ...currentTasks.map((task) => Number.parseInt(task.wbs.split(".")[0] ?? "0", 10)).filter(Number.isFinite)) + 1,
    );
    const start = lastTask?.plannedFinish ?? plannerState.tasks[0]?.plannedStart ?? new Date().toISOString();
    const newTask: Task = {
      id: `task-${Date.now()}`,
      scenarioId: plannerState.scenario.id,
      stationId,
      zoneId,
      rowType: "task",
      wbs: nextWbs,
      name: "",
      description: "",
      plannedStart: start,
      plannedFinish: start,
      plannedDurationMinutes: 0,
      plannedOperators: 0,
      plannedManHours: 0,
      status: "not_started",
      percentComplete: 0,
      dependencyIds: [],
      criticalPath: false,
      bottleneckFlag: false,
      qualityGate: false,
      travelerSignoffRequired: false,
      manufacturingSteps: [],
      partReferences: [],
      customFields: {},
    };

    setPlannerState((current) => {
      return {
        ...current,
        tasks: [...current.tasks, newTask],
      };
    });
    setSelectedTaskId(newTask.id);
    setSelectedStationId(stationId);
    setActiveZoneId(zoneId);
  }

  function addTaskAtBottom() {
    addTaskToZone(activeZoneId ?? plannerState.tasks[plannerState.tasks.length - 1]?.zoneId);
  }

  function deleteTasks(taskIds: string[]) {
    markDirty();
    const taskIdsToDelete = new Set(taskIds);
    const nextSelectedTask =
      selectedTaskId && !taskIdsToDelete.has(selectedTaskId)
        ? derivedState.tasks.find((task) => task.id === selectedTaskId)
        : derivedState.tasks.find((task) => !taskIdsToDelete.has(task.id));

    setPlannerState((current) => {
      const remainingTasks = current.tasks
        .filter((task) => !taskIdsToDelete.has(task.id))
        .map((task) => ({
          ...task,
          dependencyIds: task.dependencyIds.filter((dependencyId) => !taskIdsToDelete.has(dependencyId)),
          manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
            ...step,
            dependencyIds: (step.dependencyIds ?? []).filter(
              (dependencyId) => !taskDependencyRefBelongsTo(dependencyId, taskIdsToDelete),
            ),
          })),
        }));
      return {
        ...current,
        tasks: remainingTasks,
        dependencies: rebuildDependenciesFromTasks(remainingTasks, current.dependencies),
      };
    });

    setSelectedTaskId(nextSelectedTask?.id ?? "");
    setSelectedStationId(nextSelectedTask?.stationId ?? "");
  }

  function downloadTextFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);

    return { filename, url };
  }

  function exportMarkdown() {
    const markdown = buildMarkdownReport(derivedState);
    const exportFile = downloadTextFile(
      markdown,
      `${derivedState.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-line-plan.md`,
      "text/markdown;charset=utf-8",
    );
    notifyFeedback({
      title: "Line plan export ready",
      content: (
        <div className="space-y-2 text-sm font-semibold leading-relaxed text-steel">
          <div>The download should start automatically.</div>
          <a
            href={exportFile.url}
            download={exportFile.filename}
            className="inline-flex h-8 items-center rounded border border-graphite bg-graphite px-3 text-xs font-black text-white hover:bg-ink"
          >
            Download manually
          </a>
        </div>
      ),
      tone: "success",
    });
  }

  function exportGanttDocument() {
    try {
      const documentHtml = buildStationSetupDocumentHtml(derivedState);
      const exportFile = downloadTextFile(
        documentHtml,
        `${derivedState.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-station-setup.html`,
        "text/html;charset=utf-8",
      );
      notifyFeedback({
        title: "Station setup document ready",
        content: (
          <div className="space-y-2 text-sm font-semibold leading-relaxed text-steel">
            <div>The HTML document should download automatically and can be opened in any browser.</div>
            <div className="flex flex-wrap gap-2">
              <a
                href={exportFile.url}
                download={exportFile.filename}
                className="inline-flex h-8 items-center rounded border border-graphite bg-graphite px-3 text-xs font-black text-white hover:bg-ink"
              >
                Download manually
              </a>
              <a
                href={exportFile.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded border border-line bg-white px-3 text-xs font-black text-ink hover:bg-[#f4f0e7]"
              >
                Open preview
              </a>
            </div>
          </div>
        ),
        tone: "success",
      });
    } catch (error) {
      notifyFeedback({
        title: "Station setup export failed",
        body: error instanceof Error ? error.message : "The station setup document could not be generated.",
        tone: "danger",
        placement: "center",
        persistent: true,
      });
    }
  }

  function selectTask(taskId: string) {
    const task = derivedState.tasks.find((item) => item.id === taskId);
    setSelectedTaskId(taskId);
    if (task) {
      setSelectedStationId(task.stationId);
    }
  }

  function openTaskDetail(taskId: string) {
    selectTask(taskId);
    setDetailDrawerCollapsed(false);
  }

  function selectStation(stationId: string) {
    setSelectedStationId(stationId);
    const firstStationTask = derivedState.tasks.find((task) => task.stationId === stationId);
    if (firstStationTask) {
      setSelectedTaskId(firstStationTask.id);
    }
  }

  const lineReadinessPanel = (
    <LineReadinessPanel
      allocationRecommendations={visibleAllocationRecommendations}
      onClearPlanningRecommendations={
        currentAllocationRecommendationKey
          ? () => setDismissedPlanningRecommendationKey(currentAllocationRecommendationKey)
          : undefined
      }
      scenarioName={derivedState.scenario.name}
      stationCount={getTopLevelTasks(derivedState.tasks).length}
      taskCount={derivedState.tasks.length}
      zones={derivedState.zones}
      tasks={derivedState.tasks}
      bottleneckStation={kpis.bottleneckStation}
      targetVariance={kpis.targetVariance}
      targetVariancePercent={kpis.targetVariancePercent}
      kpis={kpis}
      onOpenTaskDetail={openTaskDetail}
      product={derivedState.product}
      compact={activeModule === "setup"}
    />
  );

  const ganttActionClass =
    "inline-flex h-10 min-w-[116px] items-center justify-center gap-2 rounded-md px-3 text-sm font-bold transition";

  return (
    <div className="fixed inset-0 h-[100dvh] overflow-hidden bg-[#f2efe6] text-ink">
      <TopNav
        state={derivedState}
        project={activeProjectContext}
        saveState={saveState}
        saveError={saveError}
        onSave={savePlannerState}
        onExport={exportMarkdown}
      />

      <div className={workspaceGridClass} style={workspaceGridStyle}>
        <Sidebar
          activeModule={activeModule}
          onChange={setActiveModule}
          project={activeProjectContext}
          workspaceDrawerOpen={workspaceDrawerOpen}
          onToggleWorkspaceDrawer={() => setWorkspaceDrawerOpen((open) => !open)}
        />

        {workspaceDrawerOpen ? (
          <WorkspaceSidebarDrawer
            activeProject={activeProjectContext}
            onClose={() => setWorkspaceDrawerOpen(false)}
          />
        ) : null}

        {isProcedureModule ? (
          <ProcedureWorkspace
            tasks={derivedState.tasks}
            zones={derivedState.zones}
            selectedTask={selectedTask}
            onSelectTask={selectTask}
            onUpdateTask={updateProcedureTask}
            onUploadStepPhotos={uploadStepPhotos}
            onRemoveStepPhoto={removeStepPhoto}
            onAddStepTool={persistAddStepTool}
            onRemoveStepTool={persistRemoveStepTool}
          />
        ) : (
          <main
            className={`min-h-0 min-w-0 space-y-4 overflow-auto px-4 pt-4 ${
              isDashboardModule ? "pb-4" : playbackCollapsed ? "pb-20" : "pb-44"
            }`}
          >
            {isDashboardModule ? (
              <PlannerDashboardPanel
                product={derivedState.product}
                scenarioName={derivedState.scenario.name}
                project={activeProjectContext}
                saveState={saveState}
                saveError={saveError}
                kpis={kpis}
                flowDurationMinutes={timelineBounds.durationMinutes}
                zoneCount={derivedState.zones.length}
                taskCount={derivedState.tasks.length}
                stationCount={getTopLevelTasks(derivedState.tasks).length}
                planningRecommendationCount={visibleAllocationRecommendations.length}
                onNavigateModule={setActiveModule}
              >
                {lineReadinessPanel}
              </PlannerDashboardPanel>
            ) : (
              <>
                <KpiStrip kpis={kpis} product={derivedState.product} />

                {activeModule === "setup" ? (
                  <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
                    <ProductSetupPanel
                      product={derivedState.product}
                      onProductNumber={updateProductNumber}
                      onProductText={updateProductText}
                    />
                    {lineReadinessPanel}
                  </div>
                ) : (
                  lineReadinessPanel
                )}

                {showsSchedulingWorkspace ? (
              <>
                <section className="overflow-hidden rounded-md border border-line bg-white shadow-soft">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[#fbfaf6] p-4">
                    <div>
                      <h2 className="text-base font-black text-ink">Manufacturing Gantt</h2>
                      <div className="text-xs font-semibold text-steel">
                        {formatMinutes(timelineBounds.durationMinutes)} planned flow / {totalHeadcount} headcount
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={exportGanttDocument}
                        className={`${ganttActionClass} border border-line bg-white text-ink hover:bg-[#f4f0e7]`}
                      >
                        <Download size={16} />
                        Export Setup
                      </button>
                      <button
                        type="button"
                        onClick={addZone}
                        className={`${ganttActionClass} border border-line bg-white text-ink hover:bg-[#f4f0e7]`}
                      >
                        <Plus size={16} />
                        Zone
                      </button>
                      <button
                        type="button"
                        onClick={addTaskAtBottom}
                        className={`${ganttActionClass} bg-graphite text-white hover:bg-ink`}
                      >
                        <Plus size={16} />
                        Task
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlaybackCollapsed(false);
                          setIsPlaying(true);
                        }}
                        className={`${ganttActionClass} bg-copper text-white hover:bg-[#995122]`}
                      >
                        <Play size={16} />
                        Playback
                      </button>
                    </div>
                  </div>
                  <GanttTimeline
                    tasks={derivedState.tasks}
                    stations={derivedState.stations}
                    zones={derivedState.zones}
                    activeZoneId={activeZoneId}
                    selectedTaskId={selectedTaskId}
                    taktMinutes={kpis.taktMinutes}
                    availableOperatorLetters={availableOperatorLetters}
                    operatorCapacityMinutes={operatorCapacityMinutes}
                    demandQuantity={derivedState.product.demandQuantity}
                    currentMinute={currentMinute}
                    showPlaybackMarker={isPlaying || currentMinute > 0}
                    onSelectTask={selectTask}
                    onOpenTaskDetail={openTaskDetail}
                    onUpdateTask={updateTask}
                    onUpdateZone={updateZone}
                    onCreateZoneFromTasks={createZoneFromTasks}
                    onDeleteZone={deleteZone}
                    onAddTaskToZone={addTaskToZone}
                    onActivateZone={setActiveZoneId}
                    onMoveTasksToZone={moveTasksToZone}
                    onReorderTaskGroups={reorderTaskGroups}
                    onNotify={notifyFeedback}
                    onConfirmAction={requestFeedbackConfirm}
                    smartAllocationPending={smartAllocationPending}
                    onSmartAllocate={() => void smartAllocateHeadcount()}
                    onResetHeadcount={resetTaskHeadcount}
                    onSetTaskDependencies={setTaskDependencies}
                    onLinkTaskStartToFinish={linkTaskStartToFinish}
                    onDeleteTasks={deleteTasks}
                  />
                </section>

                {activeModule === "balance" ? (
                  <StationBalance
                    stations={derivedState.stations}
                    taktMinutes={kpis.taktMinutes}
                    selectedStationId={selectedStationId}
                    onSelectStation={selectStation}
                    onUpdateOperators={updateStationOperators}
                  />
                ) : null}
              </>
            ) : null}
              </>
            )}
          </main>
        )}

        {!isProcedureModule ? (
          <DetailDrawer
            task={selectedTask}
            station={selectedStation}
            collapsed={detailDrawerCollapsed}
            isResizing={isResizingDetailDrawer}
            onToggleCollapsed={() => setDetailDrawerCollapsed((collapsed) => !collapsed)}
            onResizeStart={startDetailDrawerResize}
            onUpdateTask={updateTask}
            onUploadStepPhotos={uploadStepPhotos}
            onRemoveStepPhoto={removeStepPhoto}
            onAddStepTool={persistAddStepTool}
            onRemoveStepTool={persistRemoveStepTool}
            toolLibrary={toolLibrary}
          />
        ) : null}
      </div>

      {!isProcedureModule && !isDashboardModule ? (
        <PlaybackPanel
          tasks={derivedState.tasks}
          stations={derivedState.stations}
          currentMinute={currentMinute}
          speed={speed}
          isPlaying={isPlaying}
          collapsed={playbackCollapsed}
          onPlayPause={() => setIsPlaying((value) => !value)}
          onReset={() => {
            setCurrentMinute(0);
            setIsPlaying(false);
          }}
          onStep={(delta) => setCurrentMinute((minute) => Math.min(Math.max(minute + delta, 0), timelineBounds.durationMinutes))}
          onSpeed={setSpeed}
          onToggleCollapsed={() => setPlaybackCollapsed((value) => !value)}
        />
      ) : null}
      <ThemedFeedbackLayer
        confirm={feedbackConfirm}
        toasts={feedbackToasts}
        onCancelConfirm={() => setFeedbackConfirm(undefined)}
        onConfirm={confirmFeedbackAction}
        onDismissToast={dismissFeedbackToast}
      />
    </div>
  );
}
