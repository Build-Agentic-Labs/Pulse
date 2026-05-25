"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardList,
  Copy,
  Download,
  Factory,
  FileText,
  GitBranch,
  ImageIcon,
  ListChecks,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Sun,
  Moon,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  updateStepPhotoAttachment,
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
import { STEP_TOOL_LISTS_FIELD, addStepTool, buildStepToolLibrary, getStepToolList, removeStepTool, removeToolFromAllTasks, renameToolInTasks } from "@/domain/step-tools";
import { removeTaskPartReference, updateTaskPartReference, type ProjectPartCatalogEntry, type ProjectToolCatalogEntry } from "@/domain/project-catalog";
import { buildProjectToolRegistry, type ProjectToolDefinition } from "@/domain/tool-registry";
import type { ToolTypeValue } from "@/domain/tool-types";
import {
  getManufacturingStepCheckSet,
  manufacturingStepCheckOptions,
  serializeManufacturingStepCheckSet,
} from "@/domain/manufacturing-step-checks";
import { applyInstructionBullets, resolveBulletEnter } from "@/domain/instruction-bullets";
import {
  addStepToolToSupabase,
  deleteToolLibraryFromSupabase,
  loadPlannerStateFromSupabase,
  loadTaskFromSupabase,
  loadToolLibraryFromSupabase,
  removeStepToolFromSupabase,
  upsertToolLibraryMetadata,
  savePlannerShellToSupabase,
  saveProcedureTaskUpdateToSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  subscribePlannerStateChanges,
  uploadStepPhotoAttachment,
  type SaveState,
  type ToolLibraryItem,
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
import { AppLoadingShell } from "./app-flow-panels";
import { NothingStatus } from "./nothing-ui";
import { PlannerDashboardPanel, buildPlannerChromeContext } from "./planner-dashboard-panel";
import { SidebarWorkspacePanel } from "./sidebar-workspace-panel";
import { SidebarUserPanel } from "./sidebar-user-panel";
import { ProcedureStepToolTable } from "./procedure-step-tool-table";
import { StepPhotoViewer } from "./step-photo-viewer";
import { ProjectCatalogSetupPanel } from "./project-catalog-setup-panel";
import { AppSettingsPanel, settingsSections, type SettingsSection } from "./app-settings-panel";
import { ThemedSelect } from "./themed-select";
import { useTheme } from "./theme-provider";
import {
  projectContextLabel,
  shouldShowProductName,
} from "@/lib/display-names";

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
  onRequestRemove: (photo: StepPhotoAttachment) => void;
  onRemove: (photoId: string) => void;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
};

const demandPeriodOptions: Array<{ value: DemandPeriod; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

const productStatusOptions: Array<{ value: ProductStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "approved", label: "Approved" },
  { value: "released", label: "Released" },
  { value: "obsolete", label: "Obsolete" },
];

const SIDEBAR_WIDTH = 200;
const WORKSPACE_DRAWER_WIDTH = 260;

const plannerModules = [
  { id: "dashboard", label: "Dashboard", icon: Factory },
  { id: "setup", label: "Setup", icon: ClipboardList },
  { id: "gantt", label: "Gantt", icon: GitBranch },
  { id: "procedure", label: "Procedure", icon: ListChecks },
  { id: "balance", label: "Balance", icon: BarChart3 },
  { id: "reports", label: "Reports", icon: FileText },
];

const comingSoonModuleIds = new Set(["balance", "reports"]);

const SIMULATION_ENABLED = false;

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
const WORKSPACE_SNAPSHOT_STORAGE_PREFIX = "buildlogic-line-planner-workspace-v1";

type WorkspaceSnapshot = {
  activeModule: string;
  selectedTaskId?: string;
  selectedStationId?: string;
  activeZoneId?: string;
  detailDrawerCollapsed: boolean;
  sidebarCollapsed?: boolean;
  savedAt: string;
};

type ProcedureDraftSnapshot = {
  taskId: string;
  task: Task;
  savedAt: string;
};

function workspaceSnapshotStorageKey(projectId?: string) {
  return `${WORKSPACE_SNAPSHOT_STORAGE_PREFIX}:${projectId || "default"}`;
}

function isKnownModule(moduleId: unknown): moduleId is string {
  return typeof moduleId === "string" && [...plannerModules, { id: "settings" }].some((module) => module.id === moduleId);
}

function readWorkspaceSnapshot(projectId?: string): WorkspaceSnapshot | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawSnapshot = window.localStorage.getItem(workspaceSnapshotStorageKey(projectId));
    if (!rawSnapshot) {
      return undefined;
    }

    const parsed = JSON.parse(rawSnapshot) as Partial<WorkspaceSnapshot>;
    if (!isKnownModule(parsed.activeModule)) {
      return undefined;
    }

    return {
      activeModule: parsed.activeModule,
      selectedTaskId: typeof parsed.selectedTaskId === "string" ? parsed.selectedTaskId : undefined,
      selectedStationId: typeof parsed.selectedStationId === "string" ? parsed.selectedStationId : undefined,
      activeZoneId: typeof parsed.activeZoneId === "string" ? parsed.activeZoneId : undefined,
      detailDrawerCollapsed:
        typeof parsed.detailDrawerCollapsed === "boolean" ? parsed.detailDrawerCollapsed : true,
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function writeWorkspaceSnapshot(projectId: string | undefined, snapshot: WorkspaceSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(workspaceSnapshotStorageKey(projectId), JSON.stringify(snapshot));
  } catch {
    // Losing the view snapshot should not block planner editing.
  }
}

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

function mergeProcedureDraftWithServer(serverTask: Task, draftTask: Task) {
  const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
  const draftStepIds = new Set((draftTask.manufacturingSteps ?? []).map((step) => step.id));
  const mergedSteps = [
    ...(draftTask.manufacturingSteps ?? []).map((draftStep) => {
      const serverStep = serverStepById.get(draftStep.id);
      return serverStep ? { ...serverStep, ...draftStep } : draftStep;
    }),
    ...(serverTask.manufacturingSteps ?? []).filter((step) => !draftStepIds.has(step.id)),
  ];

  return applyProcedureVersionSnapshot(
    {
      ...serverTask,
      ...draftTask,
      manufacturingSteps: mergedSteps.length > 0 ? mergedSteps : serverTask.manufacturingSteps,
    },
    serverTask,
  );
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
      ? "border-accent/20 bg-accent/10 text-accent"
      : status === "yellow" || status === "review" || status === "ready" || status === "in_progress"
        ? "border-warn/30 bg-warn-muted/20 text-warn-strong"
        : status === "red" || status === "blocked" || status === "qc_hold" || status === "rework"
          ? "border-danger/25 bg-danger-muted/10 text-danger"
          : "border-line bg-surface-sunken text-steel";

  return (
    <span className={`ui-chip ${tone}`}>
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
      <span className="ui-field-label">{label}</span>
      <div className={`ui-field-shell ${readOnly ? "ui-field-shell-readonly" : ""}`}>
        <ClearableNumberInput
          className={`number-input ui-field-control ${readOnly ? "ui-field-control-readonly" : ""}`}
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
        {suffix ? <span className="ui-field-suffix">{suffix}</span> : null}
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
  onRequestRemove,
  onRemove,
  onUpdatePhoto,
}: StepPhotoAttachmentEditorProps) {
  const thumbnailClass = compact ? "h-24 w-28" : "h-36 w-48";
  const [previewPhoto, setPreviewPhoto] = useState<StepPhotoAttachment | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 ui-mono-label">
          <ImageIcon size={compact ? 12 : 13} />
          Photos
          {photos.length > 0 ? <span className="text-steel/70">({photos.length})</span> : null}
        </div>
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

      {photos.length > 0 ? (
        <div className="step-photo-strip flex max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-2">
          {photos.map((photo) => (
            <div key={photo.id} className={compact ? "w-28 shrink-0" : "w-48 shrink-0"}>
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(photo)}
                  className="block rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label={`Open step ${step.sequence} photo ${photo.name}`}
                  title="Open photo"
                >
                  <img
                    src={photo.dataUrl}
                    alt={`Step ${step.sequence} photo`}
                    className={`${thumbnailClass} rounded border border-line object-cover transition group-hover:border-accent`}
                  />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestRemove(photo);
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-surface/90 text-steel opacity-0 transition hover:text-danger focus:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
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
        <div className="border-t border-dashed border-line pt-2 text-xs font-semibold text-steel">
          No photos attached to this step yet.
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
                  className="text-steel/70 hover:text-danger"
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
      ? "ui-metric-card-good"
      : tone === "warn"
        ? "ui-metric-card-warn"
        : tone === "bad"
          ? "ui-metric-card-bad"
          : "";

  return (
    <div className={`ui-metric-card ${toneClass}`}>
      <div className="ui-metric-card-label">{label}</div>
      <div className="ui-metric-card-value">{value}</div>
      {meta ? <div className="ui-metric-card-meta">{meta}</div> : null}
    </div>
  );
}

function TopNav({
  onExport,
  sidebarCollapsed,
  onToggleSidebar,
  context,
  chromeStatus,
}: {
  onExport: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  context?: ReturnType<typeof buildPlannerChromeContext>;
  chromeStatus?: { message: string; error?: boolean } | null;
}) {
  const { theme, toggleTheme } = useTheme();

  if (context) {
    return (
      <header className="ui-chrome ui-chrome-planner z-40 h-12 shrink-0">
        <div className="ui-chrome-planner-brand">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="ui-btn-ghost hidden h-8 w-8 shrink-0 items-center justify-center px-0 lg:inline-flex"
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!sidebarCollapsed}
          >
            <ChevronLeft
              size={14}
              strokeWidth={1.75}
              className={`transition-transform duration-300 ease-ui ${sidebarCollapsed ? "rotate-180" : ""}`}
            />
          </button>
          <div className="ui-brand-compact shrink-0">Pulse</div>
        </div>

        <div className="ui-chrome-planner-context min-w-0">
          <span className="ui-chrome-context-title truncate">{context.title}</span>
          <span className="ui-chrome-context-meta hidden min-w-0 truncate sm:inline">
            <span className={context.statusClass}>{context.status}</span>
            {context.detail ? (
              <>
                <span aria-hidden> · </span>
                <span>{context.detail}</span>
              </>
            ) : null}
          </span>
        </div>

        <div className="ui-chrome-planner-actions">
          {chromeStatus ? (
            <div className="ui-chrome-status max-w-[min(28rem,42vw)]">
              <NothingStatus error={chromeStatus.error}>{chromeStatus.message}</NothingStatus>
            </div>
          ) : null}
          <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button type="button" onClick={onExport} className="ui-btn-ghost h-10 gap-2">
            <Download size={16} />
            Export
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between gap-3 px-3 sm:px-4 lg:px-0">
      <div className="ui-chrome-brand flex min-w-0 items-center gap-1 sm:gap-2 lg:gap-0.5 lg:px-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="ui-btn-ghost hidden h-8 w-8 shrink-0 items-center justify-center px-0 lg:inline-flex"
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-expanded={!sidebarCollapsed}
        >
          <ChevronLeft
            size={14}
            strokeWidth={1.75}
            className={`transition-transform duration-300 ease-ui ${sidebarCollapsed ? "rotate-180" : ""}`}
          />
        </button>
        <div className="ui-brand-compact shrink-0">Pulse</div>
      </div>

      <div className="flex min-w-0 flex-1 lg:hidden" />

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 lg:pr-4">
        {chromeStatus ? (
          <div className="ui-chrome-status max-w-[min(24rem,38vw)]">
            <NothingStatus error={chromeStatus.error}>{chromeStatus.message}</NothingStatus>
          </div>
        ) : null}
        <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" onClick={onExport} className="ui-btn-ghost h-10 gap-2">
          <Download size={16} />
          Export
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  activeModule,
  settingsSection,
  onChange,
  onOpenSettings,
  project,
}: {
  activeModule: string;
  settingsSection: SettingsSection;
  onChange: (moduleId: string) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  project?: PlannerProjectContext;
}) {
  const isSettingsModule = activeModule === "settings";

  return (
    <aside className="ui-nav-sidebar">
      <SidebarWorkspacePanel activeProject={project} />

      <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-2">
        {isSettingsModule ? (
          <>
            <button
              type="button"
              onClick={() => onChange("dashboard")}
              className="ui-settings-back"
              title="Back to planner"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
              Back to planner
            </button>
            <div className="space-y-0.5">
              {settingsSections.map((item) => {
                const Icon = item.icon;
                const active = settingsSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => onOpenSettings(item.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="ui-nav-section">Planner</div>
            <div className="space-y-0.5">
              {plannerModules.map((module) => {
                const Icon = module.icon;
                const active = activeModule === module.id;
                return (
                  <button
                    key={module.id}
                    type="button"
                    title={module.label}
                    onClick={() => onChange(module.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{module.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="mt-auto px-2 py-2">
        {!isSettingsModule ? (
          <button
            type="button"
            onClick={() => onOpenSettings("general")}
            className="ui-nav-footer-item"
          >
            <Settings size={15} strokeWidth={1.75} />
            Settings
          </button>
        ) : (
          <SidebarUserPanel />
        )}
      </div>
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
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-secondary">
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
  onConfirmAction,
  onStepDeleted,
  onUpdateTask,
  onUploadStepPhotos,
  onRemoveStepPhoto,
  onAddStepTool,
  onRemoveStepTool,
  projectToolRegistry,
}: {
  tasks: Task[];
  zones: Zone[];
  selectedTask?: Task;
  onSelectTask: (taskId: string) => void;
  onConfirmAction: (message: FeedbackConfirm) => void;
  onStepDeleted: (taskSnapshot: Task, step: ManufacturingStep) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onUploadStepPhotos: (taskId: string, stepId: string, files: File[]) => Promise<void>;
  onRemoveStepPhoto: (taskId: string, stepId: string, photoId: string) => Promise<void>;
  onAddStepTool: (taskId: string, stepId: string, toolName: string, sequence?: number) => Promise<void>;
  onRemoveStepTool: (stepId: string, toolName: string) => Promise<void>;
  projectToolRegistry: Map<string, ProjectToolDefinition>;
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
    width: navigatorWidth,
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
        <div className="ui-panel p-5 text-sm font-bold text-steel">
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
        <div className="sticky top-0 z-10 bg-surface-raised px-2 pb-2 pt-3">
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
                      <span className="w-[38px] shrink-0 font-mono text-[10px] tabular-nums text-ink-tertiary">{item.wbs}</span>
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

      <main className="ui-procedure-main min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <section>
            <h1 className="ui-section-title ui-procedure-title">{task.name || "Untitled task"}</h1>
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

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="ui-setup-section-title">Manufacturing Steps</h2>
                <p className="ui-setup-section-desc">
                  {manufacturingSteps.length} step(s) · step total {formatMinutes(manufacturingStepDurationMinutes)} · {formatManHours(stepDerivedManHours)}
                </p>
              </div>
              <button type="button" onClick={addManufacturingStep} className="ui-btn-ghost h-10 gap-2">
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
                  const selectedChecks = getManufacturingStepCheckSet(step.qualityCheck);

                  return (
                    <div key={step.id} className="ui-procedure-step space-y-3">
                      <div>
                        <div className="ui-procedure-step-header mb-1">
                          <div className="ui-procedure-step-header-fields">
                            <span className="ui-field-label mb-0">Instruction</span>
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
                          <div className="ui-procedure-step-toolbar">
                            <button
                              type="button"
                              onClick={() =>
                                updateManufacturingStep(step.id, { instruction: applyInstructionBullets(step.instruction) })
                              }
                              className="ui-btn-ghost h-7 gap-1 px-2 text-[10px]"
                              title={`Format step ${step.sequence} as bullets`}
                              aria-label={`Format step ${step.sequence} as bullets`}
                            >
                              <ListChecks size={12} strokeWidth={1.75} />
                              Bullets
                            </button>
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
                        <textarea
                          aria-label={`Step ${step.sequence} instruction`}
                          className="ui-field-standalone ui-procedure-step-instruction h-auto w-full resize-y"
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

                      <div className="ui-procedure-step-details">
                        <div className="ui-procedure-step-detail">
                          <span className="ui-field-label mb-0 block">Tools</span>
                          <div className="ui-procedure-step-add-row">
                            <input
                              className="ui-procedure-step-inline-text"
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
                              className="ui-btn-ghost h-8 shrink-0 px-2 text-[10px]"
                            >
                              Add
                            </button>
                            {toolLibrary.length > 0 ? (
                              <ThemedSelect
                                aria-label={`Add saved tool to step ${step.sequence}`}
                                value=""
                                className="min-w-36"
                                triggerClassName="h-8 rounded-none border-0 border-b bg-transparent px-0 text-xs"
                                options={[
                                  { value: "", label: "Tool library" },
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
                          <ProcedureStepToolTable
                            tools={stepTools}
                            registry={projectToolRegistry}
                            onRemove={(toolName) => removeManufacturingStepTool(step.id, toolName)}
                            removeAriaLabel={(toolName) => `Remove ${toolName} from step ${step.sequence}`}
                          />
                        </div>

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

                        <div className="ui-procedure-step-detail">
                          <span className="ui-field-label mb-0 block">Checks</span>
                          <div className="ui-procedure-step-checks" role="group" aria-label={`Step ${step.sequence} checks`}>
                            {manufacturingStepCheckOptions.map((option) => {
                              const checked = selectedChecks.has(option.key);

                              return (
                                <label
                                  key={option.key}
                                  className={`ui-procedure-step-check ${checked ? "ui-procedure-step-check-active" : ""}`}
                                >
                                  <input
                                    type="checkbox"
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

                        <div className="ui-procedure-step-divider">
                          <StepPhotoAttachmentEditor
                            step={step}
                            photos={stepPhotos}
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onRemove={(photoId) => removeManufacturingStepPhoto(step.id, photoId)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
                          />
                        </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="ui-setup-section-title">Part References</h2>
                <p className="ui-setup-section-desc">{partReferences.length} part reference(s)</p>
              </div>
              <button type="button" onClick={addPartReference} className="ui-btn-ghost h-10 gap-2">
                <Plus size={14} strokeWidth={1.75} />
                Part
              </button>
            </div>
            {partReferences.length === 0 ? (
              <div className="ui-procedure-empty">
                No part references on this task yet.
              </div>
            ) : (
              <div className="ui-procedure-part-editor">
                {partReferences.map((part) => (
                  <div key={part.id} className="ui-procedure-part-row">
                    <label className="block min-w-0">
                      <span className="ui-field-label">Part Number</span>
                      <input
                        className="ui-procedure-step-inline-text w-full min-w-0"
                        value={part.partNumber}
                        onChange={(event) => updatePartReference(part.id, { partNumber: event.target.value })}
                        placeholder="Part number"
                      />
                    </label>
                    <label className="block">
                      <span className="ui-field-label">Qty</span>
                      <ClearableNumberInput
                        className="number-input ui-procedure-step-inline-value"
                        value={part.quantity ?? 0}
                        min={0}
                        fallbackValue={part.quantity ?? 0}
                        precision={0}
                        normalize={Math.round}
                        onValueChange={(value) => updatePartReference(part.id, { quantity: value })}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="ui-field-label">Description</span>
                      <input
                        className="ui-procedure-step-inline-text w-full min-w-0"
                        value={part.description ?? ""}
                        onChange={(event) => updatePartReference(part.id, { description: event.target.value })}
                        placeholder="Description"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="ui-field-label">Disposition / Note</span>
                      <input
                        className="ui-procedure-step-inline-text w-full min-w-0"
                        value={part.disposition ?? ""}
                        onChange={(event) => updatePartReference(part.id, { disposition: event.target.value })}
                        placeholder="Note"
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
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
    <div className={`ui-setup-section ${className}`}>
      <div className="ui-setup-section-head">
        <div className="ui-setup-section-title">{title}</div>
        {description ? <div className="ui-setup-section-desc">{description}</div> : null}
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
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Product Setup</h2>
          <div className="ui-section-subtitle">Demand, available time, takt, and target labor</div>
        </div>
      </div>

      <div className="ui-product-setup-body">
        <SetupFieldGroup title="Product Identity" description="What is being planned">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(150px,0.7fr)_minmax(130px,0.6fr)_minmax(150px,0.7fr)]">
            <label className="block">
              <span className="ui-field-label">Product</span>
              <input
                className="ui-field-standalone"
                value={product.name}
                onChange={(event) => onProductText("name", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">SKU</span>
              <input
                className="ui-field-standalone"
                value={product.sku ?? ""}
                onChange={(event) => onProductText("sku", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Revision</span>
              <input
                className="ui-field-standalone"
                value={product.revision}
                onChange={(event) => onProductText("revision", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Status</span>
              <ThemedSelect
                className="w-full"
                value={product.status}
                options={productStatusOptions}
                onChange={(value) => onProductText("status", value as ProductStatus)}
              />
            </label>
          </div>
        </SetupFieldGroup>

        <div className="ui-product-setup-split">
          <SetupFieldGroup title="Demand & Labor" description="Volume, takt override, and labor target">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <label className="block">
                <span className="ui-field-label">Demand</span>
                <div className="ui-field-shell ui-field-shell-select-combo">
                  <ClearableNumberInput
                    className="number-input ui-field-control"
                    value={product.demandQuantity}
                    min={0}
                    step={1}
                    precision={0}
                    normalize={Math.round}
                    onValueChange={(value) => onProductNumber("demandQuantity", value)}
                  />
                  <ThemedSelect
                    className="w-28 shrink-0"
                    triggerClassName="h-10 rounded-none rounded-r-lg border-0 border-l px-2 ui-mono-label"
                    value={product.demandPeriod}
                    options={demandPeriodOptions}
                    onChange={(value) => onProductText("demandPeriod", value as DemandPeriod)}
                  />
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
        </div>

        <SetupFieldGroup title="Calendar" description="Working pattern used for weekly and monthly capacity">
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
    <section className="ui-kpi-strip">
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

function ComingSoonModuleView({
  children,
  moduleLabel,
}: {
  children: ReactNode;
  moduleLabel: string;
}) {
  return (
    <section className="ui-coming-soon-module" aria-label={`${moduleLabel} coming soon`}>
      <div className="ui-coming-soon-module-preview" aria-hidden="true">
        {children}
      </div>
      <div className="ui-coming-soon-module-overlay">
        <div className="ui-coming-soon-module-panel">
          <div className="ui-mono-label">Coming soon</div>
          <h2 className="ui-section-title">{moduleLabel}</h2>
          <p className="ui-section-subtitle">
            This workspace is not ready yet. The current planner data is preserved.
          </p>
        </div>
      </div>
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

function ZoneMetricsPanel({
  zones,
  tasks,
  compact = false,
  embedded = false,
}: {
  zones: Zone[];
  tasks: Task[];
  compact?: boolean;
  embedded?: boolean;
}) {
  const metrics = buildZoneMetrics(zones, tasks);

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line bg-surface-raised p-3 text-xs font-semibold text-steel">
        Create a zone in the Gantt to see headcount, man-hours, and cycle time by area.
      </div>
    );
  }

  if (embedded) {
    return (
      <div className="ui-planner-zone-list">
        {metrics.map((metric) => (
          <div key={metric.id} className="ui-planner-zone-row">
            <div className="ui-planner-zone-name">
              <span className="ui-planner-zone-dot" style={{ backgroundColor: metric.color }} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{metric.name}</div>
                <div className="text-[11px] text-ink-tertiary">{metric.taskCount} tasks</div>
              </div>
            </div>
            <div className="ui-planner-zone-metrics">
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">HC</div>
                <div className="ui-row-value mt-0.5">{round(metric.headcount, 1)}</div>
              </div>
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">MH</div>
                <div className="ui-row-value mt-0.5">{formatManHours(metric.manHours)}</div>
              </div>
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">Cycle</div>
                <div className="ui-row-value mt-0.5">{formatMinutes(metric.cycleMinutes)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3"}`}>
      {metrics.map((metric) => (
        <div key={metric.id} className="ui-panel-raised p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs ui-mono-label tracking-wide text-ink">{metric.name}</div>
              <div className="text-[11px] font-semibold text-steel">{metric.taskCount} high-level task(s)</div>
            </div>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: metric.color }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="ui-mono-label">{compact ? "HC" : "Headcount"}</div>
              <div className="mt-1 text-lg font-medium text-ink">{round(metric.headcount, 1)}</div>
            </div>
            <div>
              <div className="ui-mono-label">MHs</div>
              <div className="mt-1 text-lg font-medium text-ink">{formatManHours(metric.manHours)}</div>
            </div>
            <div>
              <div className="ui-mono-label">Cycle</div>
              <div className="mt-1 text-lg font-medium text-ink">{formatMinutes(metric.cycleMinutes)}</div>
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
  embedded = false,
}: {
  kpis: ReturnType<typeof calculateProductKpis>;
  onClearPlanningRecommendations?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  planningRecommendations?: UnallocatedWorkReview[];
  product: Product;
  tasks: Task[];
  compact?: boolean;
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
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
    ? "border-line border-l-danger"
    : roundingCreatesUnusedCapacity
      ? "border-line border-l-warn"
      : "border-line border-l-accent";
  const statusClass = !feasible
    ? "border-danger/25 bg-danger-muted/10 text-danger"
    : roundingCreatesUnusedCapacity
      ? "border-warn/30 bg-warn-muted/20 text-warn-strong"
      : "border-accent/20 bg-accent/10 text-accent";
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

  const expandedBody = expanded ? (
    <>
      <div className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "xl:grid-cols-[250px_minmax(0,1fr)_220px]"}`}>
        <div className={`space-y-2 ${compact ? "" : "xl:border-r xl:border-line xl:pr-4"}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Rounded Staffing</span>
            <span className="text-sm font-medium text-ink">{kpis.wholePersonStaffingRequirement} people</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Avg Allocation</span>
            <span className="text-sm font-medium text-ink">{round(kpis.requiredAverageAllocationPercent, 1)}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Labor Budget</span>
            <span className="text-sm font-medium text-ink">{formatManHours(kpis.targetLaborBudgetManHours)}/{period}</span>
          </div>
        </div>

        <div className={`min-w-0 ${compact ? "border-t border-line pt-3" : "xl:border-r xl:border-line xl:px-4"}`}>
          <div className="mb-2 ui-mono-label">Plan Fit</div>
          <div className={`grid gap-x-5 gap-y-2 ${compact ? "grid-cols-1" : "sm:grid-cols-4"}`}>
            {planChecks.map((check) => (
              <div key={check.label} className="min-w-0">
                <div className="flex items-center gap-1.5 ui-mono-label">
                  <span className={`h-1.5 w-1.5 rounded-full ${check.fits ? "bg-accent" : "bg-danger"}`} />
                  {check.label}
                </div>
                <div className={`mt-1 text-sm font-medium ${check.fits ? "text-ink" : "text-danger"}`}>{check.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`min-w-0 bg-surface ${compact ? "border-t border-line pt-3" : "xl:pl-1"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="ui-mono-label">Operators</div>
            <div className="text-[10px] font-medium text-steel">
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
                    className="flex min-w-0 flex-col items-center gap-0.5 bg-surface"
                    title={`Operator ${letter}: ${allocation}% allocated`}
                  >
                    <WorkerIcon colorIndex={index} letter={letter} />
                    <span className="text-[9px] font-medium leading-none text-steel">{round(allocation, 0)}%</span>
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

      {!embedded ? (
        <PlanningRecommendationsPanel
          compact={compact}
          onClear={onClearPlanningRecommendations}
          recommendations={planningRecommendations}
          onOpenTaskDetail={onOpenTaskDetail}
        />
      ) : null}
    </>
  ) : null;

  if (embedded) {
    return (
      <div className="ui-planner-crew">
        <div className="ui-metric-strip ui-planner-crew-metrics">
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Budgeted crew</div>
            <div className="ui-metric-card-value">{round(kpis.budgetedCrewEquivalent, 2)} FTE</div>
            <div className="ui-metric-card-meta">
              {kpis.wholePersonStaffingRequirement} people · {round(kpis.requiredAverageAllocationPercent, 1)}% avg
            </div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Peak manpower</div>
            <div className="ui-metric-card-value">{round(kpis.peakManpower, 1)}</div>
            <div className="ui-metric-card-meta">Rounded {kpis.wholePersonStaffingRequirement}</div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Planned load</div>
            <div className="ui-metric-card-value">{round(kpis.plannedLaborLoadFte, 2)} FTE</div>
            <div className="ui-metric-card-meta">Budget {round(kpis.budgetedCrewEquivalent, 2)} FTE</div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Status</div>
            <div className={`ui-metric-card-value ${feasible ? "" : "text-danger"}`}>{statusLabel}</div>
            {planningRecommendations.length > 0 ? (
              <div className="ui-metric-card-meta text-warn-strong">{planningRecommendations.length} open</div>
            ) : null}
          </div>
        </div>
        {planningRecommendations.length > 0 ? (
          <PlanningRecommendationsPanel
            compact
            embedded
            onClear={onClearPlanningRecommendations}
            recommendations={planningRecommendations}
            onOpenTaskDetail={onOpenTaskDetail}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`ui-crew-card rounded-md border border-l-4 bg-surface ${expanded ? "p-3" : "p-3"} ${toneClass}`}>
      <div
        className={`flex flex-wrap items-start justify-between gap-3 ${expanded ? "border-b border-line pb-3" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="ui-eyebrow">Budgeted Crew</div>
          <div className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-1">
            <span className="text-xl font-medium leading-none tracking-normal text-ink">
              {round(kpis.budgetedCrewEquivalent, 2)}
            </span>
            <span className="pb-0.5 text-xs ui-mono-label text-ink">FTE</span>
            {!expanded ? (
              <span className="pb-0.5 text-[11px] font-medium text-ink-secondary">
                · {kpis.wholePersonStaffingRequirement} people · {round(kpis.requiredAverageAllocationPercent, 1)}% avg
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {planningRecommendations.length > 0 ? (
            <span className="inline-flex h-6 items-center rounded border border-warn/35 bg-accent-muted px-2 text-[10px] ui-mono-label tracking-wide text-warn-strong">
              {planningRecommendations.length} open
            </span>
          ) : null}
          <span className={`inline-flex h-7 items-center rounded border px-2 text-[11px] ui-mono-label ${statusClass}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-ink-secondary transition hover:border-line hover:bg-surface-muted hover:text-ink"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse crew plan" : "Expand crew plan"}
            title={expanded ? "Collapse crew plan" : "Expand crew plan"}
          >
            {expanded ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {expandedBody}
    </div>
  );
}

function PlanningRecommendationsPanel({
  compact = false,
  embedded = false,
  onClear,
  onOpenTaskDetail,
  recommendations,
}: {
  compact?: boolean;
  embedded?: boolean;
  onClear?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  recommendations: UnallocatedWorkReview[];
}) {
  const [showAll, setShowAll] = useState(false);

  if (recommendations.length === 0) {
    return null;
  }

  const visibleRecommendations = embedded
    ? recommendations.slice(0, 3)
    : showAll
      ? recommendations
      : recommendations.slice(0, 4);
  const hiddenCount = recommendations.length - visibleRecommendations.length;

  if (embedded) {
    return (
      <div className="ui-planner-recommendations">
        <div className="ui-planner-readiness-section-head">
          <div>
            <div className="ui-planner-recommendations-title">Open allocations</div>
            <p className="ui-planner-recommendations-subtitle">
              {recommendations.length} required task{recommendations.length === 1 ? "" : "s"} still unallocated
            </p>
          </div>
          {onClear ? (
            <button type="button" onClick={onClear} className="ui-btn-ghost h-8 px-2 text-xs">
              Clear
            </button>
          ) : null}
        </div>

        <div>
          {visibleRecommendations.map((recommendation) => (
            <div key={recommendation.taskId} className="ui-planner-recommendation-row">
              <div className="min-w-0 flex-1">
                <div className="ui-planner-recommendation-title truncate" title={recommendation.taskLabel}>
                  {recommendation.taskLabel}
                </div>
                <div className="ui-planner-recommendation-condition">{recommendation.condition}</div>
                <div className="ui-planner-recommendation-copy">{recommendation.recommendation}</div>
              </div>
              {onOpenTaskDetail ? (
                <button
                  type="button"
                  onClick={() => onOpenTaskDetail(recommendation.taskId)}
                  className="ui-btn-ghost h-8 shrink-0 px-2 text-xs"
                >
                  Review
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {hiddenCount > 0 ? (
          <p className="ui-planner-recommendations-more">
            {hiddenCount} more in the Smart Allocation audit packet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-planner-recommendations-compact mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] ui-mono-label tracking-wide text-warn-strong">
            <AlertTriangle size={13} />
            Planning Recommendations
          </div>
          <div className="mt-1 text-[11px] leading-snug text-steel">
            {recommendations.length} allocation issue{recommendations.length === 1 ? "" : "s"} need review.
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hiddenCount > 0 || showAll ? (
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              className="ui-btn-ghost h-7 px-2 text-[10px]"
            >
              {showAll ? "Show less" : `Show all ${recommendations.length}`}
            </button>
          ) : null}
          {onClear ? (
            <button type="button" onClick={onClear} className="ui-btn-ghost h-7 px-2 text-[10px]">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 divide-y divide-line border-y border-line">
        {visibleRecommendations.map((recommendation) => (
          <div key={recommendation.taskId} className="grid gap-2 py-2.5 text-xs lg:grid-cols-[minmax(150px,0.7fr)_minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium text-ink" title={recommendation.taskLabel}>
                {recommendation.taskLabel}
              </div>
              <div className="mt-0.5 text-[10px] ui-mono-label text-warn-strong">{recommendation.classification}</div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] leading-snug text-steel" title={recommendation.condition}>
                {recommendation.condition}
              </div>
              <div className="truncate text-[11px] leading-snug text-ink" title={recommendation.recommendation}>
                {recommendation.recommendation}
              </div>
            </div>
            {onOpenTaskDetail ? (
              <button
                type="button"
                onClick={() => onOpenTaskDetail(recommendation.taskId)}
                className="ui-btn-ghost h-7 justify-self-start px-2 text-[10px] lg:justify-self-end"
              >
                Review
              </button>
            ) : null}
          </div>
        ))}
      </div>
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
  embedded = false,
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
  embedded?: boolean;
}) {
  const content = (
    <div className={embedded ? "ui-planner-readiness" : "space-y-5"}>
      {!embedded ? (
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="ui-section-title text-base">Line readiness</h2>
            <div className="ui-section-subtitle">{scenarioName}</div>
          </div>
          <Timer className="text-accent" size={20} />
        </div>
      ) : (
        <div className="ui-planner-readiness-head">
          <h2 className="ui-section-title">Line readiness</h2>
          <p className="ui-section-subtitle">{scenarioName}</p>
        </div>
      )}

      {!embedded ? (
        <div>
          <div className="mb-3 ui-mono-label">Line summary</div>
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
      ) : null}

      <section className={embedded ? "ui-planner-readiness-section" : undefined}>
        {embedded ? (
          <div className="ui-planner-readiness-section-head">
            <div>
              <h3 className="ui-planner-readiness-section-title">Crew plan</h3>
              <p className="ui-section-subtitle">Budget, load, and staffing fit</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 ui-mono-label">Crew plan</div>
        )}
        <CrewReadinessCard
          kpis={kpis}
          onClearPlanningRecommendations={onClearPlanningRecommendations}
          onOpenTaskDetail={onOpenTaskDetail}
          planningRecommendations={allocationRecommendations}
          product={product}
          tasks={tasks}
          compact={compact || embedded}
          embedded={embedded}
        />
      </section>

      <section className={embedded ? "ui-planner-readiness-section" : undefined}>
        {embedded ? (
          <div className="ui-planner-readiness-section-head">
            <div>
              <h3 className="ui-planner-readiness-section-title">Zones</h3>
              <p className="ui-section-subtitle">Headcount, man-hours, and cycle by area</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 ui-mono-label">Zone metrics</div>
        )}
        <ZoneMetricsPanel zones={zones} tasks={tasks} compact={compact || embedded} embedded={embedded} />
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <section className="ui-readiness-workspace">{content}</section>;
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
    <section className="ui-panel p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-ink">Station Balance</h2>
          <div className="text-xs font-semibold text-steel">Takt line: {formatMinutes(taktMinutes)}</div>
        </div>
        <BarChart3 className="text-accent" size={22} />
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
                selectedStationId === station.id ? "border-accent bg-accent-muted" : "border-line bg-surface-raised hover:bg-surface-sunken"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    {station.sequence}. {station.name}
                  </div>
                  <div className="text-xs font-semibold text-steel">
                    {formatMinutes(station.plannedCycleMinutes)} / {formatManHours(station.plannedManHours)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {station.bottleneckFlag ? <AlertTriangle size={17} className="text-danger" /> : null}
                  <StatusPill status={station.taktStatus} />
                </div>
              </div>
              <div className="relative h-5 overflow-hidden rounded bg-surface-sunken">
                <div className="absolute inset-y-0 w-[2px] bg-danger" style={{ left: `${taktPosition}%` }} />
                <div
                  className={`h-full rounded ${station.bottleneckFlag ? "bg-danger" : "bg-accent"}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-steel">
                <span>Operators</span>
                <ClearableNumberInput
                  aria-label={`${station.name} operators`}
                  className="number-input h-8 w-16 rounded border border-line bg-surface px-2 text-right font-bold text-ink outline-none"
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
  onConfirmAction,
  onStepDeleted,
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
  onConfirmAction: (message: FeedbackConfirm) => void;
  onStepDeleted: (taskSnapshot: Task, step: ManufacturingStep) => void;
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
        {task?.wbs ?? "-"}
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
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-steel transition hover:bg-surface-sunken"
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
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-steel hover:bg-surface-sunken"
              title="Collapse selected task drawer"
              aria-label="Collapse selected task drawer"
            >
              <ChevronsRight size={16} />
            </button>
            <StatusPill status={task.status} />
          </div>
        </div>

        <div className="space-y-4">
        <div className="ui-panel p-3">
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-steel">Station</div>
          <div className="text-sm font-bold text-ink">{station.sequence}. {station.name}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-steel">
            <span>Cycle {formatMinutes(station.plannedCycleMinutes)}</span>
            <span>{formatManHours(station.plannedManHours)}</span>
            <span>Operators {station.plannedOperators}</span>
            <span>{station.bottleneckFlag ? "Bottleneck" : "Balanced"}</span>
          </div>
        </div>

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
              <div className="text-xs ui-mono-label tracking-wide text-steel">Manufacturing Steps</div>
              <div className="text-xs font-semibold text-steel">{manufacturingSteps.length} step(s)</div>
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
                        <div className="flex items-center gap-1 ui-mono-label">
                          <span className="shrink-0">Step</span>
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
                                    className="text-steel/70 hover:text-danger"
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
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onRemove={(photoId) => removeManufacturingStepPhoto(step.id, photoId)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
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
                                className={`flex h-7 min-w-0 items-center justify-center gap-1 rounded border px-1.5 text-[10px] font-medium transition ${
                                  checked
                                    ? "border-accent/30 bg-accent/10 text-accent"
                                    : "border-line bg-surface text-steel hover:border-accent"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3 shrink-0 accent-accent"
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
                        onClick={() => requestRemoveManufacturingStep(step.id)}
                        className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-steel hover:bg-danger-muted hover:text-danger"
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
              <div className="text-xs ui-mono-label tracking-wide text-steel">Part References</div>
              <div className="text-xs font-semibold text-steel">{partReferences.length} part number(s)</div>
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
              <div className="rounded border border-dashed border-line bg-surface-raised p-3 text-xs font-semibold text-steel">
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
                    className="flex h-8 items-center justify-center rounded border border-line bg-surface text-steel hover:border-danger hover:text-danger"
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
          <div className="mb-3 text-xs ui-mono-label tracking-wide text-steel">Gates</div>
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
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface text-ink">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="absolute left-1/2 top-0 flex h-7 w-10 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-xl border border-b-0 border-line bg-surface text-ink-secondary hover:text-ink"
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
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-canvas hover:opacity-90"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <div className="text-[11px] font-semibold text-ink-secondary">Simulation time</div>
            <div className="font-mono text-sm font-semibold text-ink">{formatMinutes(currentMinute)}</div>
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min((currentMinute / bounds.durationMinutes) * 100, 100)}%` }}
              />
            </div>
            <div className="truncate text-xs font-medium text-ink-secondary">{activeTasks[0]?.name ?? "Idle"}</div>
          </div>
        </div>
      ) : (
      <div className="grid min-h-36 gap-3 px-4 py-3 lg:grid-cols-[360px_minmax(0,1fr)_420px]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-canvas hover:opacity-90"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              type="button"
              onClick={() => onStep(-15)}
              className="flex h-10 w-10 items-center justify-center ui-panel text-ink-secondary hover:bg-surface-muted hover:text-ink"
              title="Step back"
            >
              <SkipBack size={17} />
            </button>
            <button
              type="button"
              onClick={() => onStep(15)}
              className="flex h-10 w-10 items-center justify-center ui-panel text-ink-secondary hover:bg-surface-muted hover:text-ink"
              title="Step forward"
            >
              <SkipForward size={17} />
            </button>
            <button
              type="button"
              onClick={onReset}
              className="flex h-10 w-10 items-center justify-center ui-panel text-ink-secondary hover:bg-surface-muted hover:text-ink"
              title="Restart"
            >
              <RotateCcw size={17} />
            </button>
            <ThemedSelect
              className="w-24"
              triggerClassName="h-10 ui-panel px-2 text-sm font-semibold"
              value={String(speed)}
              options={playbackSpeeds.map((option) => ({ value: String(option.value), label: option.label }))}
              onChange={(value) => onSpeed(safeNumber(value, speed))}
            />
          </div>
          <div className="text-[11px] font-semibold text-ink-secondary">Simulation time</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{formatMinutes(currentMinute)}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-accent"
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

        <div className="overflow-hidden rounded-lg border border-line bg-surface-muted">
          <div className="flex h-8 items-center gap-2 border-b border-line px-3 text-xs font-semibold text-ink-secondary">
            <Activity size={14} />
            Event log
          </div>
          <div className="max-h-[104px] overflow-auto px-3 py-2">
            {events.map((event) => (
              <div key={`${event.time}-${event.label}`} className="grid grid-cols-[62px_1fr] gap-2 py-1 text-xs">
                <span className="font-mono font-medium text-ink-tertiary">{formatMinutes(event.time)}</span>
                <span className="truncate font-medium text-ink">{event.label}</span>
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
  onReady,
}: {
  projectId?: string;
  projectContext?: PlannerProjectContext;
  onReady?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const plannerQueryString = searchParams.toString();
  const urlWorkspaceSnapshot = useMemo<Partial<WorkspaceSnapshot>>(() => {
    const params = new URLSearchParams(plannerQueryString);
    const requestedModule = params.get("view");
    return {
      activeModule: isKnownModule(requestedModule) ? requestedModule : undefined,
      selectedTaskId: params.get("task") ?? undefined,
      selectedStationId: params.get("station") ?? undefined,
      activeZoneId: params.get("zone") ?? undefined,
    };
  }, [plannerQueryString]);
  const initialUrlWorkspaceSnapshotRef = useRef(urlWorkspaceSnapshot);
  const [plannerState, setPlannerState] = useState<PlannerState>(initialPlannerState);
  const [activeModule, setActiveModule] = useState("dashboard");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [selectedTaskId, setSelectedTaskId] = useState(initialPlannerState.tasks[0]?.id);
  const [selectedStationId, setSelectedStationId] = useState(initialPlannerState.stations[0]?.id);
  const [activeZoneId, setActiveZoneId] = useState<string>();
  const [currentMinute, setCurrentMinute] = useState(0);
  const [speed, setSpeed] = useState(5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackCollapsed, setPlaybackCollapsed] = useState(true);
  const [detailDrawerCollapsed, setDetailDrawerCollapsed] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailDrawerWidth, setDetailDrawerWidth] = useState(360);
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
  const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();
  const [chromeStatus, setChromeStatus] = useState<{ message: string; error?: boolean } | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<Omit<FeedbackToast, "id"> | null>(null);
  const [toolLibraryItems, setToolLibraryItems] = useState<ToolLibraryItem[]>([]);
  const chromeStatusTimerRef = useRef<number | null>(null);
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
  const projectToolRegistry = useMemo(
    () => buildProjectToolRegistry(derivedState.tasks, toolLibraryItems),
    [derivedState.tasks, toolLibraryItems],
  );

  useEffect(() => {
    let active = true;

    loadToolLibraryFromSupabase(activeProjectContext?.projectId)
      .then((tools) => {
        if (active) {
          setToolLibraryItems(tools);
        }
      })
      .catch(() => {
        if (active) {
          setToolLibraryItems([]);
        }
      });

    return () => {
      active = false;
    };
  }, [activeProjectContext?.projectId]);

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return;
    }

    writeWorkspaceSnapshot(projectId, {
      activeModule,
      selectedTaskId,
      selectedStationId,
      activeZoneId,
      detailDrawerCollapsed,
      sidebarCollapsed,
      savedAt: new Date().toISOString(),
    });
  }, [
    activeModule,
    activeZoneId,
    detailDrawerCollapsed,
    sidebarCollapsed,
    hasLoadedRemoteState,
    projectId,
    selectedStationId,
    selectedTaskId,
  ]);

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return;
    }

    const params = new URLSearchParams(plannerQueryString);
    params.set("view", activeModule);
    if (selectedTaskId) {
      params.set("task", selectedTaskId);
    } else {
      params.delete("task");
    }
    if (selectedStationId) {
      params.set("station", selectedStationId);
    } else {
      params.delete("station");
    }
    if (activeZoneId) {
      params.set("zone", activeZoneId);
    } else {
      params.delete("zone");
    }

    const nextQueryString = params.toString();
    if (nextQueryString === plannerQueryString) {
      return;
    }

    router.replace(nextQueryString ? `${pathname}?${nextQueryString}` : pathname, { scroll: false });
  }, [
    activeModule,
    activeZoneId,
    hasLoadedRemoteState,
    pathname,
    plannerQueryString,
    router,
    selectedStationId,
    selectedTaskId,
  ]);

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
          const workspaceSnapshot = readWorkspaceSnapshot(projectId);
          const draftTask = procedureDraft
            ? savedState.tasks.find((task) => task.id === procedureDraft.taskId)
            : undefined;
          const mergedDraftTask =
            draftTask && procedureDraft ? mergeProcedureDraftWithServer(draftTask, procedureDraft.task) : undefined;
          const hydratedState = mergedDraftTask
            ? {
                ...savedState,
                tasks: savedState.tasks.map((task) => (task.id === mergedDraftTask.id ? mergedDraftTask : task)),
              }
            : savedState;
          const snapshotTask = workspaceSnapshot?.selectedTaskId
            ? hydratedState.tasks.find((task) => task.id === workspaceSnapshot.selectedTaskId)
            : undefined;
          const initialUrlWorkspaceSnapshot = initialUrlWorkspaceSnapshotRef.current;
          const urlTask = initialUrlWorkspaceSnapshot.selectedTaskId
            ? hydratedState.tasks.find((task) => task.id === initialUrlWorkspaceSnapshot.selectedTaskId)
            : undefined;
          const selectedTask = mergedDraftTask ?? urlTask ?? snapshotTask ?? hydratedState.tasks[0];
          const snapshotStation = workspaceSnapshot?.selectedStationId
            ? hydratedState.stations.find((station) => station.id === workspaceSnapshot.selectedStationId)
            : undefined;
          const urlStation = initialUrlWorkspaceSnapshot.selectedStationId
            ? hydratedState.stations.find((station) => station.id === initialUrlWorkspaceSnapshot.selectedStationId)
            : undefined;
          const snapshotZone = workspaceSnapshot?.activeZoneId
            ? hydratedState.zones.find((zone) => zone.id === workspaceSnapshot.activeZoneId)
            : undefined;
          const urlZone = initialUrlWorkspaceSnapshot.activeZoneId
            ? hydratedState.zones.find((zone) => zone.id === initialUrlWorkspaceSnapshot.activeZoneId)
            : undefined;

          setPlannerState(hydratedState);
          if (initialUrlWorkspaceSnapshot.activeModule || workspaceSnapshot?.activeModule) {
            setActiveModule(initialUrlWorkspaceSnapshot.activeModule ?? workspaceSnapshot?.activeModule ?? "dashboard");
          }
          setSelectedTaskId(selectedTask?.id ?? "");
          setSelectedStationId(urlStation?.id ?? snapshotStation?.id ?? selectedTask?.stationId ?? hydratedState.tasks[0]?.stationId ?? "");
          setActiveZoneId(urlZone?.id ?? snapshotZone?.id);
          setDetailDrawerCollapsed(workspaceSnapshot?.detailDrawerCollapsed ?? true);
          setSidebarCollapsed(workspaceSnapshot?.sidebarCollapsed ?? false);
          setHasLoadedRemoteState(true);
          if (mergedDraftTask && procedureDraft) {
            setSaveState("draft");
            window.setTimeout(() => {
              scheduleProcedureTaskSave(mergedDraftTask, hydratedState.tasks);
            }, 250);
            return;
          }

          clearProcedureDraftSnapshot();
          setSaveState("saved");
          return;
        }

        const initialUrlWorkspaceSnapshot = initialUrlWorkspaceSnapshotRef.current;
        if (initialUrlWorkspaceSnapshot.activeModule) {
          setActiveModule(initialUrlWorkspaceSnapshot.activeModule);
        }
        const urlTask = initialUrlWorkspaceSnapshot.selectedTaskId
          ? initialPlannerState.tasks.find((task) => task.id === initialUrlWorkspaceSnapshot.selectedTaskId)
          : undefined;
        const urlStation = initialUrlWorkspaceSnapshot.selectedStationId
          ? initialPlannerState.stations.find((station) => station.id === initialUrlWorkspaceSnapshot.selectedStationId)
          : undefined;
        if (urlTask) {
          setSelectedTaskId(urlTask.id);
        }
        if (urlStation || urlTask) {
          setSelectedStationId(urlStation?.id ?? urlTask?.stationId ?? "");
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
    if (hasLoadedRemoteState) {
      onReady?.();
    }
  }, [hasLoadedRemoteState, onReady]);

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
    if (!SIMULATION_ENABLED || !isPlaying) {
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

  useEffect(() => () => clearChromeStatusTimer(), []);

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

  function clearChromeStatusTimer() {
    if (chromeStatusTimerRef.current) {
      window.clearTimeout(chromeStatusTimerRef.current);
      chromeStatusTimerRef.current = null;
    }
  }

  function dismissWorkspaceNotice() {
    setWorkspaceNotice(null);
  }

  function notifyFeedback(message: Omit<FeedbackToast, "id">) {
    if (message.content || message.placement === "center") {
      setWorkspaceNotice(message);
      return;
    }

    const statusText = [message.title, message.body].filter(Boolean).join(": ");
    const error = message.tone === "danger" || message.tone === "warning";

    clearChromeStatusTimer();
    setChromeStatus({ message: statusText, error });

    if (!message.persistent) {
      chromeStatusTimerRef.current = window.setTimeout(() => {
        setChromeStatus(null);
        chromeStatusTimerRef.current = null;
      }, error ? 9000 : 5200);
    }
  }

  function notifyRestoreAction({
    body,
    onRestore,
    restoreLabel = "Restore",
    title,
  }: {
    body: string;
    onRestore: () => void;
    restoreLabel?: string;
    title: string;
  }) {
    setWorkspaceNotice({
      title,
      tone: "warning",
      persistent: true,
      content: (
        <div className="space-y-3">
          <p className="ui-workspace-notice-body">{body}</p>
          <button type="button" onClick={onRestore} className="ui-btn-secondary h-8 px-3">
            {restoreLabel}
          </button>
        </div>
      ),
    });
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
  const isSettingsModule = activeModule === "settings";
  const isComingSoonModule = comingSoonModuleIds.has(activeModule);
  const comingSoonModuleLabel = plannerModules.find((module) => module.id === activeModule)?.label ?? "Workspace";
  const plannerChromeContext = isDashboardModule ? buildPlannerChromeContext(derivedState.product) : undefined;
  const showDetailDrawer = false;
  const showsSchedulingWorkspace = activeModule === "gantt";
  const selectedTask = derivedState.tasks.find((task) => task.id === selectedTaskId) ?? derivedState.tasks[0];
  const selectedStation = selectedTask
    ? buildProcessStationForTask(selectedTask, derivedState.tasks, kpis.bottleneckStation?.id)
    : undefined;
  const workspaceGridClass = "ui-workspace-shell";
  const workspaceGridStyle = {
    "--workspace-sidebar-width": sidebarCollapsed ? "0px" : "var(--shell-sidebar)",
    "--detail-drawer-width": detailDrawerCollapsed ? "44px" : `${detailDrawerWidth}px`,
  } as CSSProperties;

  if (!hasLoadedRemoteState) {
    return (
      <AppLoadingShell title="Loading workspace" />
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
      const message = "Refusing to save an empty Gantt. Add at least one task before saving.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({
        title: "Save blocked",
        body: message,
        tone: "warning",
      });
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
        const message = error instanceof Error ? error.message : "Unable to save planner state.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Save failed",
          body: message,
          tone: "danger",
        });
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
        const message = error instanceof Error ? error.message : "Unable to save procedure task.";
        writeProcedureDraftSnapshot(failedSave.task);
        setSaveError(message);
        setSaveState("retrying");
        notifyFeedback({
          title: "Save failed — retrying",
          body: message,
          tone: "warning",
        });
        procedureSaveInFlightRef.current = false;
        queuedProcedureSaveRef.current = null;
        flushDeferredRemoteRefresh();

        if (!procedureRetryTimerRef.current) {
          procedureRetryTimerRef.current = window.setTimeout(() => {
            procedureRetryTimerRef.current = null;
            const latestPendingSave = pendingProcedureSaveRef.current ?? failedSave;
            pendingProcedureSaveRef.current = null;
            void loadTaskFromSupabase(latestPendingSave.task.id, projectId)
              .then((latestTask) => {
                const taskToRetry = latestTask
                  ? mergeProcedureDraftWithServer(latestTask, latestPendingSave.task)
                  : latestPendingSave.task;
                return persistProcedureTaskUpdate(taskToRetry, latestPendingSave.tasks);
              })
              .catch(() => persistProcedureTaskUpdate(latestPendingSave.task, latestPendingSave.tasks));
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

  async function applyProjectTasksUpdate(nextTasks: Task[]) {
    setSaveError(undefined);
    setSaveState("saving");

    const calculated = applyCalculatedFields(derivedState.product, derivedState.stations, nextTasks);
    const nextState = {
      ...derivedState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };

    setPlannerState(nextState);

    try {
      await savePlannerShellToSupabase(nextState);
      setSaveState("saved");
      notifyFeedback({
        title: "Build catalog updated",
        body: "Tool assignments were saved across the project.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save build catalog changes.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({
        title: "Save failed",
        body: message,
        tone: "danger",
      });
      throw error;
    }
  }

  async function saveCatalogTool(
    entry: ProjectToolCatalogEntry,
    draft: { name: string; category: ToolTypeValue },
  ) {
    const nameChanged = draft.name.trim().toLocaleLowerCase() !== entry.name.toLocaleLowerCase();

    if (nameChanged) {
      const nextTasks = renameToolInTasks(derivedState.tasks, entry.name, draft.name);
      await applyProjectTasksUpdate(nextTasks);
    }

    await upsertToolLibraryMetadata({
      toolName: draft.name,
      category: draft.category,
      projectId,
      previousToolName: nameChanged ? entry.name : undefined,
    });

    const tools = await loadToolLibraryFromSupabase(projectId);
    setToolLibraryItems(tools);

    if (!nameChanged) {
      notifyFeedback({
        title: "Tool updated",
        body: `${draft.name} type saved.`,
        tone: "success",
      });
    }
  }

  async function deleteCatalogTool(entry: ProjectToolCatalogEntry) {
    const nextTasks = removeToolFromAllTasks(derivedState.tasks, entry.name);
    await applyProjectTasksUpdate(nextTasks);

    if (entry.libraryId) {
      await deleteToolLibraryFromSupabase(entry.libraryId, projectId);
      const tools = await loadToolLibraryFromSupabase(projectId);
      setToolLibraryItems(tools);
    }
  }

  async function saveCatalogPart(
    entry: ProjectPartCatalogEntry,
    draft: { partNumber: string; description: string; quantity: number; disposition: string },
  ) {
    const nextTasks = updateTaskPartReference(derivedState.tasks, entry.taskId, entry.part.id, {
      partNumber: draft.partNumber,
      description: draft.description,
      quantity: draft.quantity,
      disposition: draft.disposition,
    });
    const task = nextTasks.find((candidate) => candidate.id === entry.taskId);

    if (task) {
      updateProcedureTask(entry.taskId, { partReferences: task.partReferences });
    }
  }

  async function deleteCatalogPart(entry: ProjectPartCatalogEntry) {
    const nextTasks = removeTaskPartReference(derivedState.tasks, entry.taskId, entry.part.id);
    const task = nextTasks.find((candidate) => candidate.id === entry.taskId);

    if (task) {
      updateProcedureTask(entry.taskId, {
        partReferences: task.partReferences,
        manufacturingSteps: task.manufacturingSteps,
      });
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
      if (removedPhoto) {
        notifyRestoreAction({
          title: "Deleted photo",
          body: "Restore will attach this photo back to the same manufacturing step.",
          restoreLabel: "Restore Photo",
          onRestore: () => {
            setSaveError(undefined);
            setSaveState("saving");
            setPlannerState((current) => ({
              ...current,
              tasks: current.tasks.map((task) =>
                task.id === taskId ? upsertStepPhotoAttachments(task, stepId, [removedPhoto as StepPhotoAttachment]) : task,
              ),
            }));
            void uploadStepPhotoAttachment(taskId, stepId, removedPhoto as StepPhotoAttachment, activeProjectContext)
              .then(() => setSaveState("saved"))
              .catch((error: unknown) => {
                setSaveError(error instanceof Error ? error.message : "Unable to restore the selected photo.");
                setSaveState("error");
              });
          },
        });
      }
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
          <p className="ui-workspace-notice-body">
            The browser blocked clipboard access. Select the text below and copy it manually.
          </p>
          <textarea
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="ui-field-standalone h-[320px] resize-none p-3 font-mono text-xs leading-relaxed"
          />
          {errors.length ? (
            <p className="ui-workspace-notice-body text-danger">{errors.join(" ")}</p>
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
          <div className="ui-panel-raised p-3">
            <div className="ui-mono-label">IE Agent Summary</div>
            <div className="mt-1 text-sm font-bold leading-snug text-ink">{agentPlan.summary}</div>
          </div>

          {hardValidationFailure ? (
            <div className="rounded-md border border-danger/30 bg-danger-muted p-3">
              <div className="text-[10px] ui-mono-label tracking-wide text-danger">Not Applied</div>
              <div className="mt-1 text-sm font-bold leading-snug text-ink">
                The IE agent returned an invalid headcount plan. No Gantt assignments were changed because validation found {validationRejectionReason}.
              </div>
            </div>
          ) : null}

          {unallocatedWorkReviews.length ? (
            <div className="rounded-md border border-warn/35 bg-accent-muted">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warn/25 px-3 py-2">
                <div>
                  <div className="text-[10px] ui-mono-label tracking-wide text-warn-strong">Unallocated Required Work</div>
                  <div className="mt-0.5 text-xs font-bold text-steel">
                    The plan is feasible only after these staffing exceptions are resolved.
                  </div>
                </div>
                <div className="text-[10px] font-medium text-warn-strong">{unallocatedWorkReviews.length} exception(s)</div>
              </div>
              <div className="max-h-[190px] overflow-auto">
                {unallocatedWorkReviews.map((review) => (
                  <div
                    key={review.taskId}
                    className="grid gap-2 border-b border-warn/20 bg-surface px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(150px,0.8fr)_1.3fr_minmax(120px,0.55fr)]"
                  >
                    <div>
                      <div className="font-medium leading-snug text-ink">{review.taskLabel}</div>
                      <div className="mt-1 inline-flex rounded border border-warn/35 bg-accent-muted px-2 py-0.5 text-[9px] ui-mono-label tracking-wide text-warn-strong">
                        {review.classification}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-steel">{review.condition}</div>
                      <div className="mt-1 font-semibold leading-snug text-steel">{review.impact}</div>
                      <div className="mt-1 font-bold leading-snug text-ink">{review.recommendation}</div>
                    </div>
                    <div className="flex items-start sm:justify-end">
                      <span className="inline-flex rounded border border-graphite/20 bg-surface-sunken px-2 py-1 text-[10px] ui-mono-label tracking-wide text-ink-secondary">
                        {review.action}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 ui-panel-raised px-3 py-2">
            <div>
              <div className="ui-mono-label">Review Packet</div>
              <div className="mt-0.5 text-xs font-bold text-steel">
                Copies audit text plus the Gantt data used by Smart Allocation.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void copySmartAllocationReview(reviewText)}
              className="ui-btn-primary h-9 gap-2 px-3 text-xs"
            >
              <Copy size={14} />
              Copy Audit
            </button>
          </div>

          <div className="ui-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div>
                <div className="ui-mono-label">Allocation Audit</div>
                <div className="mt-0.5 text-xs font-bold text-steel">
                  {round(audit.assignmentCoveragePercent, 0)}% coverage · peak {audit.peakManpower} · spread {formatMinutes(audit.loadSpreadMinutes)}
                </div>
              </div>
              <div className="ui-mono-label">
                {audit.assignedTaskCount}/{audit.eligibleTaskCount} eligible task(s)
              </div>
            </div>

            <div className="p-2">
              <div className="overflow-hidden rounded border border-line">
                <div className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-surface-sunken px-2 py-1.5 text-[9px] ui-mono-label tracking-wide text-steel">
                  <div>Op</div>
                  <div>Load</div>
                  <div>Work</div>
                  <div>Budget</div>
                </div>
                {audit.operators.map((operator, index) => {
                  const budgetTone =
                    operator.budgetVarianceMinutes > 1
                      ? "text-warn-strong"
                      : operator.budgetVarianceMinutes < -1
                        ? "text-steel"
                        : "text-accent";
                  return (
                    <div
                      key={operator.operatorId}
                      className="grid grid-cols-[54px_0.8fr_1fr_1fr] items-center gap-2 border-b border-line bg-surface-raised px-2 py-1.5 text-xs last:border-b-0"
                      title={operator.assignedTaskLabels.join("\n")}
                    >
                      <div className="flex items-center gap-2">
                        <WorkerIcon className="h-6 w-6 shrink-0" colorIndex={index} letter={operator.operatorId} />
                      </div>
                      <div className="whitespace-nowrap">
                        <span className="font-medium text-ink">{formatMinutes(operator.assignedMinutes)}</span>
                        <span className="ml-1 font-bold text-steel">· {round(operator.utilizationPercent, 0)}%</span>
                      </div>
                      <div className="truncate font-bold text-steel">
                        {operator.assignedTaskCount} task(s) · {operator.idleGapCount > 0 ? `${formatMinutes(operator.idleMinutes)} idle` : "continuous"}
                      </div>
                      <div className={`truncate font-medium ${budgetTone}`}>
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
            <div className="ui-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <div className="ui-mono-label">Needs Review</div>
                <div className="text-[10px] font-medium text-steel">{issueEntries.length} item(s)</div>
              </div>
              <div className="max-h-[170px] overflow-auto">
                {visibleIssueEntries.map((issue) => (
                  <div key={issue.label} className="grid gap-2 border-b border-line bg-surface-raised px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(180px,1fr)_1.35fr] sm:items-center">
                    <div className="truncate text-sm font-medium leading-snug text-ink" title={issue.label}>
                      {issue.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {issue.blockers.map((reason) => (
                        <span
                          key={reason}
                          className="inline-flex h-6 items-center rounded border border-danger/30 bg-danger-muted px-2 text-[9px] ui-mono-label tracking-wide text-danger"
                        >
                          {reason}
                        </span>
                      ))}
                      {issue.warnings.map((reason) => (
                        <span
                          key={reason}
                          className="inline-flex h-6 items-center rounded border border-warn/35 bg-accent-muted px-2 text-[9px] ui-mono-label tracking-wide text-warn-strong"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {issueRemainder > 0 ? (
                  <div className="bg-surface px-3 py-2 text-xs font-bold text-steel">
                    {issueRemainder} more item(s)
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-accent/25 bg-accent-muted p-3 text-sm font-bold text-accent">
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

  function restorePlannerSnapshot(snapshot: PlannerState, restoreSelection?: { taskId?: string; stationId?: string; zoneId?: string }) {
    markDirty();
    remoteRefreshAppliedRef.current = true;
    setPlannerState(snapshot);
    setSelectedTaskId(restoreSelection?.taskId ?? snapshot.tasks[0]?.id ?? "");
    setSelectedStationId(restoreSelection?.stationId ?? snapshot.tasks[0]?.stationId ?? "");
    setActiveZoneId(restoreSelection?.zoneId);
  }

  async function restoreTaskProcedureSnapshot(taskSnapshot: Task, step: ManufacturingStep) {
    updateProcedureTask(taskSnapshot.id, {
      manufacturingSteps: taskSnapshot.manufacturingSteps,
      plannedDurationMinutes: taskSnapshot.plannedDurationMinutes,
      customFields: taskSnapshot.customFields,
      partReferences: taskSnapshot.partReferences,
    });

    const stepPhotos = getStepPhotoAttachments(taskSnapshot, step.id);
    if (stepPhotos.length > 0) {
      try {
        await Promise.all(
          stepPhotos.map((photo) => uploadStepPhotoAttachment(taskSnapshot.id, step.id, photo, activeProjectContext)),
        );
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Step restored, but one or more photos could not be restored.");
        setSaveState("error");
      }
    }
  }

  function notifyDeletedStepRestore(taskSnapshot: Task, step: ManufacturingStep) {
    notifyRestoreAction({
      title: `Deleted step ${step.sequence}`,
      body: "Restore will put the step, tools, part links, and available photo records back on this task.",
      restoreLabel: "Restore Step",
      onRestore: () => void restoreTaskProcedureSnapshot(taskSnapshot, step),
    });
  }

  function executeDeleteZone(zoneId: string) {
    const snapshot = plannerState;
    const deletedZone = derivedState.zones.find((zone) => zone.id === zoneId);
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
    notifyRestoreAction({
      title: `Deleted ${deletedZone?.name || "zone"}`,
      body: "Tasks were moved out of the deleted zone. Restore will bring the previous zone layout back.",
      restoreLabel: "Restore Zone",
      onRestore: () =>
        restorePlannerSnapshot(snapshot, {
          taskId: selectedTaskId,
          stationId: selectedStationId,
          zoneId,
        }),
    });
  }

  function deleteZone(zoneId: string) {
    const zone = derivedState.zones.find((candidate) => candidate.id === zoneId);
    requestFeedbackConfirm({
      title: `Delete ${zone?.name || "zone"}?`,
      body: "This removes the zone and moves its tasks into the unzoned section.",
      tone: "danger",
      confirmLabel: "Delete Zone",
      onConfirm: () => executeDeleteZone(zoneId),
    });
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

  function executeDeleteTasks(taskIds: string[]) {
    if (taskIds.length === 0) {
      return;
    }

    const snapshot = plannerState;
    const deletedTasks = derivedState.tasks.filter((task) => taskIds.includes(task.id));
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
    notifyRestoreAction({
      title: deletedTasks.length === 1 ? `Deleted task ${deletedTasks[0].wbs}` : `Deleted ${deletedTasks.length} tasks`,
      body: "Restore will bring back the deleted task data and the previous Gantt dependencies.",
      restoreLabel: deletedTasks.length === 1 ? "Restore Task" : "Restore Tasks",
      onRestore: () =>
        restorePlannerSnapshot(snapshot, {
          taskId: selectedTaskId,
          stationId: selectedStationId,
          zoneId: activeZoneId,
        }),
    });
  }

  function deleteTasks(taskIds: string[]) {
    const tasksToDelete = derivedState.tasks.filter((task) => taskIds.includes(task.id));
    if (tasksToDelete.length === 0) {
      return;
    }

    requestFeedbackConfirm({
      title: tasksToDelete.length === 1 ? `Delete task ${tasksToDelete[0].wbs}?` : `Delete ${tasksToDelete.length} tasks?`,
      body: "This removes the selected task data, manufacturing steps, and related Gantt dependencies.",
      tone: "danger",
      confirmLabel: tasksToDelete.length === 1 ? "Delete Task" : "Delete Tasks",
      onConfirm: () => executeDeleteTasks(taskIds),
    });
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
        <div className="space-y-2">
          <p className="ui-workspace-notice-body">The download should start automatically.</p>
          <a
            href={exportFile.url}
            download={exportFile.filename}
            className="ui-btn-secondary inline-flex h-8 items-center px-3 text-xs"
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
          <div className="space-y-2">
            <p className="ui-workspace-notice-body">
              The HTML document should download automatically and can be opened in any browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={exportFile.url}
                download={exportFile.filename}
                className="ui-btn-secondary inline-flex h-8 items-center px-3 text-xs"
              >
                Download manually
              </a>
              <a
                href={exportFile.url}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-ghost inline-flex h-8 items-center px-3 text-xs"
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
    if (showDetailDrawer) {
      setDetailDrawerCollapsed(false);
    }
  }

  function selectStation(stationId: string) {
    setSelectedStationId(stationId);
    const firstStationTask = derivedState.tasks.find((task) => task.stationId === stationId);
    if (firstStationTask) {
      setSelectedTaskId(firstStationTask.id);
    }
  }

  function navigateModule(moduleId: string) {
    setActiveModule(moduleId);
  }

  function openSettings(section: SettingsSection = "general") {
    setSettingsSection(section);
    setActiveModule("settings");
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
    />
  );

  const dashboardLineReadinessPanel = (
    <LineReadinessPanel
      embedded
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
    />
  );

  return (
    <div
      className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
      style={workspaceGridStyle}
    >
      <TopNav
        onExport={exportMarkdown}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        context={plannerChromeContext}
        chromeStatus={chromeStatus}
      />

      {workspaceNotice ? (
        <section className="ui-workspace-notice">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <NothingStatus error={workspaceNotice.tone === "danger" || workspaceNotice.tone === "warning"}>
                {workspaceNotice.title}
              </NothingStatus>
              {workspaceNotice.content ?? (
                workspaceNotice.body ? <p className="ui-workspace-notice-body">{workspaceNotice.body}</p> : null
              )}
            </div>
            <button type="button" onClick={dismissWorkspaceNotice} className="ui-btn-ghost h-8 shrink-0 px-2">
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <div className={workspaceGridClass}>
        <div className={`ui-workspace-sidebar-slot ${sidebarCollapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
          <Sidebar
            activeModule={activeModule}
            settingsSection={settingsSection}
            onChange={navigateModule}
            onOpenSettings={openSettings}
            project={activeProjectContext}
          />
        </div>

        {isProcedureModule ? (
          <ProcedureWorkspace
            tasks={derivedState.tasks}
            zones={derivedState.zones}
            selectedTask={selectedTask}
            onSelectTask={selectTask}
            onConfirmAction={requestFeedbackConfirm}
            onStepDeleted={notifyDeletedStepRestore}
            onUpdateTask={updateProcedureTask}
            onUploadStepPhotos={uploadStepPhotos}
            onRemoveStepPhoto={removeStepPhoto}
            onAddStepTool={persistAddStepTool}
            onRemoveStepTool={persistRemoveStepTool}
            projectToolRegistry={projectToolRegistry}
          />
        ) : isSettingsModule ? (
          <main className="min-h-0 min-w-0 overflow-hidden">
            <AppSettingsPanel
              showSubnav={false}
              section={settingsSection}
              onSectionChange={setSettingsSection}
              project={activeProjectContext}
            />
          </main>
        ) : (
          <main
            className={`ui-workspace-content ${activeModule === "gantt" ? "ui-gantt-page" : ""} ${
              isDashboardModule
                ? "p-0 pb-6"
                : `space-y-4 p-3 sm:p-4 ${SIMULATION_ENABLED ? (playbackCollapsed ? "pb-20" : "pb-44") : "pb-6"}`
            }`}
          >
            {isDashboardModule ? (
              <PlannerDashboardPanel
                product={derivedState.product}
                saveError={saveError}
                kpis={kpis}
                flowDurationMinutes={timelineBounds.durationMinutes}
                zoneCount={derivedState.zones.length}
                taskCount={derivedState.tasks.length}
                stationCount={getTopLevelTasks(derivedState.tasks).length}
                planningRecommendationCount={visibleAllocationRecommendations.length}
              >
                {dashboardLineReadinessPanel}
              </PlannerDashboardPanel>
            ) : (
              <>
                {activeModule === "setup" ? (
                  <div className="ui-setup-page space-y-4">
                    <ProductSetupPanel
                      product={derivedState.product}
                      onProductNumber={updateProductNumber}
                      onProductText={updateProductText}
                    />
                    <ProjectCatalogSetupPanel
                      tasks={derivedState.tasks}
                      projectToolRegistry={projectToolRegistry}
                      onSaveTool={saveCatalogTool}
                      onDeleteTool={deleteCatalogTool}
                      onSavePart={saveCatalogPart}
                      onDeletePart={deleteCatalogPart}
                      onConfirmAction={requestFeedbackConfirm}
                    />
                  </div>
                ) : isComingSoonModule ? (
                  <ComingSoonModuleView moduleLabel={comingSoonModuleLabel}>
                    <KpiStrip kpis={kpis} product={derivedState.product} />
                    {lineReadinessPanel}
                  </ComingSoonModuleView>
                ) : (
                  <>
                    <KpiStrip kpis={kpis} product={derivedState.product} />
                    {lineReadinessPanel}
                  </>
                )}

                {showsSchedulingWorkspace ? (
              <>
                <section className="ui-gantt-workspace">
                  <div className="ui-gantt-workspace-head">
                    <div>
                      <h2 className="ui-section-title">Manufacturing Gantt</h2>
                      <p className="ui-section-subtitle">
                        {formatMinutes(timelineBounds.durationMinutes)} planned flow / {totalHeadcount} headcount
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
                      <button type="button" onClick={exportGanttDocument} className="ui-btn-ghost h-10 gap-2">
                        <Download size={16} />
                        Export Setup
                      </button>
                      <button type="button" onClick={addZone} className="ui-btn-ghost h-10 gap-2">
                        <Plus size={16} />
                        Zone
                      </button>
                      <button type="button" onClick={addTaskAtBottom} className="ui-btn-ghost h-10 gap-2">
                        <Plus size={16} />
                        Task
                      </button>
                      {SIMULATION_ENABLED ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPlaybackCollapsed(false);
                          setIsPlaying(true);
                        }}
                        className="ui-btn-ghost h-10 gap-2"
                      >
                        <Play size={16} />
                        Playback
                      </button>
                      ) : null}
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
                    showPlaybackMarker={SIMULATION_ENABLED && (isPlaying || currentMinute > 0)}
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

              </>
            ) : null}
              </>
            )}
          </main>
        )}

        {showDetailDrawer ? (
          <DetailDrawer
            task={selectedTask}
            station={selectedStation}
            collapsed={detailDrawerCollapsed}
            isResizing={isResizingDetailDrawer}
            onConfirmAction={requestFeedbackConfirm}
            onStepDeleted={notifyDeletedStepRestore}
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

      {SIMULATION_ENABLED && !isProcedureModule && !isDashboardModule ? (
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
        toasts={[]}
        onCancelConfirm={() => setFeedbackConfirm(undefined)}
        onConfirm={confirmFeedbackAction}
        onDismissToast={() => {}}
      />
    </div>
  );
}
