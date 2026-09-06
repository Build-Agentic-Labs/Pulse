"use client";

import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Copy, Link2, Maximize2, Minimize2, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { calculatePeakManpower, formatMinutes, getTaskWindow, getTimelineBounds, round } from "@/domain/calculations";
import { generateTaskCode, nextTaskNumberForComponent, stepDisplayCode, taskDisplayCode, taskDisplayLabel } from "@/domain/nomenclature";
import { getOperatorAssignmentBlockState } from "@/domain/operator-allocation";
import { compareTasksByWbs, compareWbsValues } from "@/domain/task-planning";
import { getTaskOperatorIds, getTaskOperatorPatch } from "@/domain/operator-assignments";
import type { ManufacturingComponent, ManufacturingStep, Station, Task, Zone } from "@/domain/types";
import {
  chartPalette,
  groupTone,
  TAKT_EXCEEDED_TONE,
  TAKT_FLAG_INPUT_CLASS,
  taskTone,
  UNZONED_COLOR,
  zoneDefaultFill,
} from "@/theme/chart-tokens";
import { ClearableNumberInput } from "./clearable-number-input";
import { ThemedSelect } from "./themed-select";
import { WorkerIcon } from "./worker-icon";

interface GanttTimelineProps {
  tasks: Task[];
  stations: Station[];
  zones: Zone[];
  components: ManufacturingComponent[];
  activeZoneId?: string;
  selectedTaskId?: string;
  taktMinutes: number;
  availableOperatorLetters: string[];
  operatorCapacityMinutes: number;
  demandQuantity: number;
  currentMinute: number;
  showPlaybackMarker: boolean;
  onSelectTask: (taskId: string) => void;
  onOpenTaskDetail: (taskId: string) => void;
  onOpenProcedureStepName: (taskId: string, stepId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onUpdateZone: (zoneId: string, patch: Partial<Zone>) => void;
  onCreateZoneFromTasks: (name: string, taskIds: string[]) => void;
  onDeleteZone: (zoneId: string) => void;
  onAddTaskToZone: (zoneId?: string) => void;
  onActivateZone: (zoneId?: string) => void;
  onMoveTasksToZone: (taskIds: string[], zoneId?: string) => void;
  onReorderTaskGroups: (
    sourceTaskIds: string[],
    targetTaskIds: string[],
    targetZoneId: string | undefined,
    placement: "before" | "after",
  ) => void;
  onNotify: (message: {
    title: string;
    body?: string;
    content?: ReactNode;
    tone?: "neutral" | "success" | "warning" | "danger";
    placement?: "corner" | "center";
    persistent?: boolean;
  }) => void;
  onConfirmAction: (message: {
    title: string;
    body?: string;
    tone?: "neutral" | "success" | "warning" | "danger";
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  }) => void;
  smartAllocationPending: boolean;
  onSmartAllocate: () => void;
  onResetHeadcount: () => void;
  onSetTaskDependencies: (taskId: string, dependencyIds: string[]) => void;
  onLinkTaskStartToFinish: (targetTaskId: string, predecessorTaskId: string) => void;
  onDeleteTasks: (taskIds: string[]) => void;
}

const ROW_HEIGHT = 54;
const HEADER_HEIGHT = 44;
const TABLE_WIDTH = 980;
const COLLAPSED_TABLE_WIDTH = 52;
const PIXELS_PER_MINUTE = 0.78;
const TIMELINE_LEFT_PADDING = 28;
const TABLE_GRID_TEMPLATE = "116px 280px 54px 54px 58px 184px 44px 26px 26px 26px";
interface ProcessGroup {
  id: string;
  wbs: string;
  name: string;
  tasks: Task[];
  startMinute: number;
  finishMinute: number;
  durationMinutes: number;
  plannedOperators: number;
  plannedManHours: number;
  zoneId?: string;
}

interface ZoneGroup {
  id: string;
  name: string;
  fill: string;
  stroke: string;
  editable: boolean;
  groups: ProcessGroup[];
  startMinute: number;
  finishMinute: number;
  durationMinutes: number;
  plannedOperators: number;
  plannedManHours: number;
}

type GanttRow =
  | {
      id: string;
      kind: "zone";
      zone: ZoneGroup;
    }
  | {
      id: string;
      kind: "group";
      group: ProcessGroup;
      zoneId: string;
    }
  | {
      id: string;
      kind: "task";
      task: Task;
      groupId: string;
    }
  | {
      id: string;
      kind: "step";
      task: Task;
      step: ManufacturingStep;
      groupId: string;
      startMinute: number;
      finishMinute: number;
  };

function getTaskState(task: Task, taskMap: Map<string, Task>, timelineStartMs: number, currentMinute: number) {
  const { startMinute, finishMinute } = getTaskWindow(task, timelineStartMs);
  const predecessorFinish = task.dependencyIds.reduce((latest, dependencyId) => {
    const predecessor = taskMap.get(dependencyId);
    if (!predecessor) {
      return latest;
    }

    return Math.max(latest, getTaskWindow(predecessor, timelineStartMs).finishMinute);
  }, 0);

  if (currentMinute >= finishMinute) {
    return "complete";
  }

  if (currentMinute >= startMinute && predecessorFinish > currentMinute) {
    return "blocked";
  }

  if (currentMinute >= startMinute && currentMinute < finishMinute) {
    return "in_progress";
  }

  if (currentMinute >= predecessorFinish && currentMinute >= startMinute - 30) {
    return "ready";
  }

  return "not_started";
}

function tickInterval(durationMinutes: number) {
  return durationMinutes > 900 ? 120 : 60;
}

function tickMarks(durationMinutes: number) {
  const interval = tickInterval(durationMinutes);
  const ticks: number[] = [];

  for (let minute = 0; minute <= durationMinutes + interval; minute += interval) {
    ticks.push(minute);
  }

  return ticks;
}

function formatRelativeHours(minutes: number) {
  const hours = round(minutes / 60, 2);
  return `${hours}h`;
}

function formatExcelNumber(value: number, precision = 2) {
  return String(round(value, precision));
}

function buildZoneGanttClipboardRows(zone: ZoneGroup, boundsStartMs: number) {
  const zoneTasks = zone.groups
    .flatMap((group) => group.tasks)
    .sort((left, right) => compareWbsValues(left.wbs, right.wbs));

  if (zoneTasks.length === 0) {
    return "";
  }

  const zoneStartMinute = Math.min(...zoneTasks.map((task) => getTaskWindow(task, boundsStartMs).startMinute));

  return zoneTasks
    .map((task) => {
      const window = getTaskWindow(task, boundsStartMs);
      const startHours = (window.startMinute - zoneStartMinute) / 60;
      const durationHours = task.plannedDurationMinutes / 60;
      const finishHours = (window.finishMinute - zoneStartMinute) / 60;
      const headcount = Math.max(task.plannedOperators ?? 0, 0);
      const manHours = durationHours * headcount;

      return [
        task.name,
        formatExcelNumber(startHours),
        formatExcelNumber(durationHours),
        formatExcelNumber(finishHours),
        String(headcount),
        formatExcelNumber(manHours, 1),
      ].join("\t");
    })
    .join("\n");
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

function manufacturingStepLabel(step: ManufacturingStep) {
  return step.name?.trim() || `Unnamed step ${step.sequence}`;
}

function frontTruncateStepCode(code: string) {
  const parts = code.split("-");
  if (parts.length >= 2) {
    return `...${parts.slice(-2).join("-")}`;
  }

  return code;
}

function parseRelativeHours(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "").replace(/hours?|hrs?/g, "").replace(/h$/, "");
  if (normalized === "") {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function truncateTimelineLabel(value: string, maxLength = 48) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Blank task";
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function timelineBarWidth(startX: number, finishX: number, minimumWidth: number) {
  const actualWidth = Math.max(finishX - startX, 0);
  if (actualWidth > 0) {
    return actualWidth;
  }

  return minimumWidth;
}

function exceedsTaktLimit(durationMinutes: number, taktMinutes: number) {
  return taktMinutes > 0 && durationMinutes > taktMinutes;
}

function taktFlagLabel(durationMinutes: number, taktMinutes: number) {
  return `Over takt: ${formatMinutes(durationMinutes)} duration exceeds ${formatMinutes(taktMinutes)} required takt`;
}

function TaktConditionFlag({ label }: { label: string }) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className="group absolute -right-1 -top-1 z-30 inline-flex h-4 w-4 items-center justify-center rounded-full bg-danger text-canvas outline-none ring-offset-1 ring-offset-surface focus:ring-2 focus:ring-danger"
    >
      <AlertTriangle size={10} strokeWidth={2.5} />
      <span className="pointer-events-none absolute right-0 top-5 hidden w-56 rounded border border-danger/30 bg-accent px-2 py-1.5 text-left text-[11px] font-bold leading-snug text-canvas  group-hover:block group-focus:block">
        {label}
      </span>
    </span>
  );
}

function OperatorAssignmentPicker({
  availableOperatorLetters,
  demandQuantity,
  isAllocating,
  onConfirmAction,
  onNotify,
  onToggleOperator,
  operatorCapacityMinutes,
  taktMinutes,
  task,
  tasks,
}: {
  availableOperatorLetters: string[];
  demandQuantity: number;
  isAllocating: boolean;
  onConfirmAction: GanttTimelineProps["onConfirmAction"];
  onNotify: GanttTimelineProps["onNotify"];
  onToggleOperator: (task: Task, operatorId: string) => void;
  operatorCapacityMinutes: number;
  taktMinutes: number;
  task: Task;
  tasks: Task[];
}) {
  const selectedOperatorIds = getTaskOperatorIds(task, availableOperatorLetters);
  const selectedOperatorSet = new Set(selectedOperatorIds);

  if (availableOperatorLetters.length === 0) {
    return <span className="text-center font-semibold text-ink-secondary">-</span>;
  }

  return (
    <div
      className={`flex max-w-full items-center justify-center gap-0.5 overflow-hidden ${isAllocating ? "animate-pulse" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {availableOperatorLetters.map((letter, index) => {
        const selected = selectedOperatorSet.has(letter);
        const blockState = getOperatorAssignmentBlockState({
          availableOperatorIds: availableOperatorLetters,
          demandQuantity,
          operatorCapacityMinutes,
          operatorId: letter,
          selected,
          taktMinutes,
          task,
          tasks,
        });
        const blocked = Boolean(blockState);
        const scheduleBlocked = blockState?.kind === "schedule";

        return (
          <button
            key={letter}
            type="button"
            aria-pressed={selected}
            aria-disabled={scheduleBlocked}
            aria-label={`Assign operator ${letter} to ${task.wbs}`}
            title={blockState?.reason ?? `${selected ? "Remove" : "Assign"} operator ${letter}`}
            onClick={() => {
              if (blockState?.kind === "schedule") {
                onNotify({
                  title: "Operator unavailable",
                  body: blockState.reason,
                  tone: "danger",
                });
                return;
              }

              if (blockState?.kind === "capacity") {
                onConfirmAction({
                  title: "Are you sure?",
                  body: blockState.reason,
                  tone: "warning",
                  confirmLabel: "Assign anyway",
                  onConfirm: () => onToggleOperator(task, letter),
                });
                return;
              }

              onToggleOperator(task, letter);
            }}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm outline-none transition focus-visible:ring-2 focus-visible:ring-accent ${
              selected
                ? "opacity-100"
                : scheduleBlocked
                  ? "cursor-not-allowed opacity-15 grayscale"
                  : blocked
                    ? "cursor-help opacity-20 grayscale hover:opacity-60"
                    : "opacity-30 grayscale hover:opacity-70"
            } ${isAllocating ? "animate-pulse ring-1 ring-accent/35" : ""}`}
            style={isAllocating ? { animationDelay: `${index * 90}ms` } : undefined}
          >
            <WorkerIcon className="h-6 w-6" colorIndex={index} letter={letter} />
          </button>
        );
      })}
    </div>
  );
}

function getProcessNumber(task: Task) {
  return task.wbs.split(".")[0] || task.wbs;
}

function orderedManufacturingSteps(task: Task) {
  return [...(task.manufacturingSteps ?? [])].sort((a, b) => a.sequence - b.sequence);
}

const STEP_REF_PREFIX = "step:";

function makeStepRef(taskId: string, stepId: string) {
  return `${STEP_REF_PREFIX}${taskId}:${stepId}`;
}

function parseStepRef(ref: string) {
  if (!ref.startsWith(STEP_REF_PREFIX)) {
    return undefined;
  }

  const [, taskId, stepId] = ref.split(":");
  return taskId && stepId ? { taskId, stepId } : undefined;
}

function groupManufacturingStepCount(group: ProcessGroup) {
  return group.tasks.reduce((total, task) => total + (task.manufacturingSteps?.length ?? 0), 0);
}

function getGroupState(group: ProcessGroup, currentMinute: number) {
  if (currentMinute >= group.finishMinute) {
    return "complete";
  }

  if (currentMinute >= group.startMinute && currentMinute < group.finishMinute) {
    return "in_progress";
  }

  if (currentMinute >= group.startMinute - 30) {
    return "ready";
  }

  return "not_started";
}

function hasDependencyPath(
  taskMap: Map<string, Task>,
  fromTaskId: string,
  targetTaskId: string,
  visited = new Set<string>(),
): boolean {
  if (fromTaskId === targetTaskId) {
    return true;
  }

  if (visited.has(fromTaskId)) {
    return false;
  }

  visited.add(fromTaskId);
  const task = taskMap.get(fromTaskId);

  if (!task) {
    return false;
  }

  return task.dependencyIds.some((dependencyId) => hasDependencyPath(taskMap, dependencyId, targetTaskId, visited));
}

function wouldCreateDependencyCycle(
  taskMap: Map<string, Task>,
  successorTaskId: string,
  predecessorTaskId: string,
): boolean {
  return successorTaskId === predecessorTaskId || hasDependencyPath(taskMap, predecessorTaskId, successorTaskId);
}

export function GanttTimeline({
  tasks,
  stations,
  zones,
  components,
  activeZoneId,
  selectedTaskId,
  taktMinutes,
  availableOperatorLetters,
  operatorCapacityMinutes,
  demandQuantity,
  currentMinute,
  showPlaybackMarker,
  onSelectTask,
  onOpenTaskDetail,
  onOpenProcedureStepName,
  onUpdateTask,
  onUpdateZone,
  onCreateZoneFromTasks,
  onDeleteZone,
  onAddTaskToZone,
  onActivateZone,
  onMoveTasksToZone,
  onReorderTaskGroups,
  onNotify,
  onConfirmAction,
  smartAllocationPending,
  onSmartAllocate,
  onResetHeadcount,
  onSetTaskDependencies,
  onLinkTaskStartToFinish,
  onDeleteTasks,
}: GanttTimelineProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [linkingRowId, setLinkingRowId] = useState<string | null>(null);
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<string>>(new Set());
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<{ id: string; placement: "before" | "after" } | null>(null);
  const [editingTaskNameId, setEditingTaskNameId] = useState<string | null>(null);
  const [canvasMaximized, setCanvasMaximized] = useState(false);
  const [tableCollapsed, setTableCollapsed] = useState(false);
  const [taktLabelVisible, setTaktLabelVisible] = useState(false);
  const [maximizedLabelWidth, setMaximizedLabelWidth] = useState(320);
  const [startDrafts, setStartDrafts] = useState<Record<string, string>>({});
  const [predecessorPickerTaskId, setPredecessorPickerTaskId] = useState<string | null>(null);
  const [predecessorDraftIds, setPredecessorDraftIds] = useState<Set<string>>(new Set());
  const [mappingTaskId, setMappingTaskId] = useState<string | null>(null);
  const [mappingDraft, setMappingDraft] = useState({
    zoneId: "",
    componentId: "",
    taskNumber: "",
    codeLocked: false,
  });
  const [unzonedNameDraft, setUnzonedNameDraft] = useState("Unzoned");
  const lastAutoFocusedTaskId = useRef<string | null>(null);
  const bounds = getTimelineBounds(tasks);
  const interval = tickInterval(bounds.durationMinutes);
  const timelineOriginX = TIMELINE_LEFT_PADDING;
  const taktLimitMinutes = Number.isFinite(taktMinutes) && taktMinutes > 0 ? taktMinutes : 0;
  const hasTaktLimit = taktLimitMinutes > 0;
  const taktLineX = timelineOriginX + taktLimitMinutes * PIXELS_PER_MINUTE;
  const chartWidth = Math.max(
    bounds.durationMinutes * PIXELS_PER_MINUTE + timelineOriginX + 180,
    hasTaktLimit ? taktLineX + 180 : 0,
    canvasMaximized ? 1500 : 980,
  );
  const taktFlagWidth = 156;
  const taktFlagX = Math.min(Math.max(taktLineX - taktFlagWidth / 2, timelineOriginX + 4), chartWidth - taktFlagWidth - 8);
  const taktFlagY = HEADER_HEIGHT + 8;
  const taktFlagTextX = taktFlagX + taktFlagWidth / 2;
  const taktFlagTextY = taktFlagY + 15;
  const playbackMarkerX = Math.min(
    Math.max(timelineOriginX + currentMinute * PIXELS_PER_MINUTE, timelineOriginX),
    chartWidth,
  );
  const playbackFlagWidth = 88;
  const playbackFlagX = Math.min(Math.max(playbackMarkerX - playbackFlagWidth / 2, 0), chartWidth - playbackFlagWidth);
  const playbackFlagTextX = playbackFlagX + playbackFlagWidth / 2;
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const predecessorCandidates = [...tasks].sort(compareTasksByWbs);
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const predecessorPickerTask = predecessorPickerTaskId ? taskMap.get(predecessorPickerTaskId) : undefined;
  const mappingTask = mappingTaskId ? taskMap.get(mappingTaskId) : undefined;
  const mappingTaskNumber = Number.parseInt(mappingDraft.taskNumber, 10);
  const mappingPreviewCode = mappingTask
    ? generateTaskCode(
        {
          zoneId: mappingDraft.zoneId || undefined,
          componentId: mappingDraft.componentId || undefined,
          taskNumber: Number.isFinite(mappingTaskNumber) && mappingTaskNumber > 0 ? mappingTaskNumber : undefined,
        },
        zones,
        components,
      )
    : "";
  const mappingDuplicateTask = mappingPreviewCode
    ? tasks.find((task) => task.id !== mappingTask?.id && task.manufacturingCode?.trim() === mappingPreviewCode)
    : undefined;
  const mappingComponentOptions = components.filter((component) => component.active || component.id === mappingDraft.componentId);
  const processGroups = Array.from(
    tasks
      .reduce((groups, task) => {
        const processNumber = getProcessNumber(task);
        const existing = groups.get(processNumber);
        if (existing) {
          existing.push(task);
        } else {
          groups.set(processNumber, [task]);
        }

        return groups;
      }, new Map<string, Task[]>())
      .entries(),
  ).map(([processNumber, groupTasks]) => {
    const startMinute = Math.min(...groupTasks.map((task) => getTaskWindow(task, bounds.startMs).startMinute));
    const finishMinute = Math.max(...groupTasks.map((task) => getTaskWindow(task, bounds.startMs).finishMinute));
    const primaryStation = stationById.get(groupTasks[0]?.stationId);
    const topLevelTask = groupTasks.find((task) => task.wbs === processNumber);

    return {
      id: `process-${processNumber}`,
      wbs: processNumber,
      name: topLevelTask ? topLevelTask.name : primaryStation?.name ?? `Process ${processNumber}`,
      tasks: groupTasks,
      startMinute,
      finishMinute,
      durationMinutes: groupTasks.reduce((total, task) => total + task.plannedDurationMinutes, 0),
      plannedOperators: topLevelTask?.plannedOperators ?? groupTasks.reduce((total, task) => total + task.plannedOperators, 0),
      plannedManHours: groupTasks.reduce((total, task) => total + task.plannedManHours, 0),
      zoneId: topLevelTask?.zoneId,
    };
  }).sort((a, b) => Number.parseFloat(a.wbs) - Number.parseFloat(b.wbs));
  const sortedZones = [...zones].sort((a, b) => a.sequence - b.sequence);
  const zoneGroups: ZoneGroup[] = sortedZones.map((zone) => {
    const groups = processGroups.filter((group) => group.zoneId === zone.id);
    const zoneTasks = groups.flatMap((group) => group.tasks);
    const startMinute = groups.length ? Math.min(...groups.map((group) => group.startMinute)) : 0;
    const finishMinute = groups.length ? Math.max(...groups.map((group) => group.finishMinute)) : startMinute;

    return {
      id: zone.id,
      name: zone.name,
      fill: `${zone.color}1f`,
      stroke: zone.color,
      editable: true,
      groups,
      startMinute,
      finishMinute,
      durationMinutes: groups.reduce((total, group) => total + group.durationMinutes, 0),
      plannedOperators: calculatePeakManpower(zoneTasks),
      plannedManHours: groups.reduce((total, group) => total + group.plannedManHours, 0),
    };
  });
  const unzonedGroups = processGroups.filter((group) => !group.zoneId || !sortedZones.some((zone) => zone.id === group.zoneId));
  if (unzonedGroups.length) {
    const unzonedTasks = unzonedGroups.flatMap((group) => group.tasks);
    const startMinute = Math.min(...unzonedGroups.map((group) => group.startMinute));
    const finishMinute = Math.max(...unzonedGroups.map((group) => group.finishMinute));
    zoneGroups.push({
      id: "zone-unzoned",
      name: "Unzoned",
      fill: chartPalette.chartBg,
      stroke: UNZONED_COLOR,
      editable: false,
      groups: unzonedGroups,
      startMinute,
      finishMinute,
      durationMinutes: unzonedGroups.reduce((total, group) => total + group.durationMinutes, 0),
      plannedOperators: calculatePeakManpower(unzonedTasks),
      plannedManHours: unzonedGroups.reduce((total, group) => total + group.plannedManHours, 0),
    });
  }
  const groupByTaskId = new Map(processGroups.flatMap((group) => group.tasks.map((task) => [task.id, group])));
  const zoneByGroupId = new Map(zoneGroups.flatMap((zone) => zone.groups.map((group) => [group.id, zone])));
  const tableGridStyle = { gridTemplateColumns: TABLE_GRID_TEMPLATE };
  const tableColumnWidth = tableCollapsed ? COLLAPSED_TABLE_WIDTH : TABLE_WIDTH;
  const stepWindowByRef = new Map<string, { startMinute: number; finishMinute: number }>();

  useEffect(() => {
    if (!selectedTaskId || lastAutoFocusedTaskId.current === selectedTaskId) {
      return;
    }

    const selectedTask = tasks.find((task) => task.id === selectedTaskId);
    if (!selectedTask || selectedTask.name.trim() !== "") {
      return;
    }

    lastAutoFocusedTaskId.current = selectedTaskId;
    setEditingTaskNameId(selectedTaskId);
    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-task-name-id="${selectedTaskId}"]`);
      input?.focus();
      input?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!predecessorPickerTaskId) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setPredecessorPickerTaskId(null);
        setPredecessorDraftIds(new Set());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [predecessorPickerTaskId]);

  const resolvingStepRefs = new Set<string>();

  function getRefFinishMinute(ref: string): number {
    const stepRef = parseStepRef(ref);
    if (stepRef) {
      const stepTask = taskMap.get(stepRef.taskId);
      const step = stepTask?.manufacturingSteps?.find((candidate) => candidate.id === stepRef.stepId);

      if (stepTask && step) {
        return resolveStepWindow(stepTask, step).finishMinute;
      }

      return 0;
    }

    const dependencyTask = taskMap.get(ref);
    return dependencyTask ? getTaskWindow(dependencyTask, bounds.startMs).finishMinute : 0;
  }

  function resolveStepWindow(task: Task, step: ManufacturingStep): { startMinute: number; finishMinute: number } {
    const ref = makeStepRef(task.id, step.id);
    const cached = stepWindowByRef.get(ref);

    if (cached) {
      return cached;
    }

    const taskWindow = getTaskWindow(task, bounds.startMs);
    const orderedSteps = orderedManufacturingSteps(task);
    const stepIndex = orderedSteps.findIndex((candidate) => candidate.id === step.id);
    const durationMinutes = Math.max(step.durationMinutes ?? 0, 0);

    if (resolvingStepRefs.has(ref)) {
      return {
        startMinute: taskWindow.startMinute,
        finishMinute: taskWindow.startMinute + durationMinutes,
      };
    }

    resolvingStepRefs.add(ref);

    const previousStep = stepIndex > 0 ? orderedSteps[stepIndex - 1] : undefined;
    const sequentialStart = previousStep ? resolveStepWindow(task, previousStep).finishMinute : taskWindow.startMinute;
    const dependencyStart = (step.dependencyIds ?? []).reduce(
      (latestFinish, dependencyId) => Math.max(latestFinish, getRefFinishMinute(dependencyId)),
      0,
    );
    const startMinute = Math.max(taskWindow.startMinute, sequentialStart, dependencyStart);
    const window = {
      startMinute,
      finishMinute: startMinute + durationMinutes,
    };

    stepWindowByRef.set(ref, window);
    resolvingStepRefs.delete(ref);

    return window;
  }

  const visibleRows: GanttRow[] = zoneGroups.flatMap((zone) => {
    const rows: GanttRow[] = [{ id: zone.id, kind: "zone", zone }];

    zone.groups.forEach((group) => {
      rows.push({ id: group.id, kind: "group", group, zoneId: zone.id });

      if (!expandedGroups.has(group.id)) {
        return;
      }

      group.tasks.forEach((task) => {
        orderedManufacturingSteps(task).forEach((step) => {
          const stepWindow = resolveStepWindow(task, step);
          rows.push({
            id: makeStepRef(task.id, step.id),
            kind: "step",
            task,
            step,
            groupId: group.id,
            startMinute: stepWindow.startMinute,
            finishMinute: stepWindow.finishMinute,
          });
        });
      });
    });

    return rows;
  });
  const barCanvasTop = HEADER_HEIGHT;
  const barCanvasBottom = HEADER_HEIGHT + visibleRows.length * ROW_HEIGHT;
  const chartHeight = HEADER_HEIGHT + visibleRows.length * ROW_HEIGHT + 28;
  const rowMap = new Map(
    visibleRows.map((row, index) => {
      const startMinute =
        row.kind === "zone"
          ? row.zone.startMinute
          : row.kind === "group"
          ? row.group.startMinute
          : row.kind === "step"
            ? row.startMinute
            : getTaskWindow(row.task, bounds.startMs).startMinute;
      const finishMinute =
        row.kind === "zone"
          ? row.zone.finishMinute
          : row.kind === "group"
          ? row.group.finishMinute
          : row.kind === "step"
            ? row.finishMinute
            : getTaskWindow(row.task, bounds.startMs).finishMinute;
      return [
        row.id,
        {
          y: HEADER_HEIGHT + index * ROW_HEIGHT + 10,
          centerY: HEADER_HEIGHT + index * ROW_HEIGHT + 23,
          startX: timelineOriginX + startMinute * PIXELS_PER_MINUTE,
          finishX: timelineOriginX + finishMinute * PIXELS_PER_MINUTE,
        },
      ];
    }),
  );
  function getVisibleRowIdForRef(ref: string) {
    if (rowMap.has(ref)) {
      return ref;
    }

    const stepRef = parseStepRef(ref);
    if (stepRef) {
      return groupByTaskId.get(stepRef.taskId)?.id;
    }

    return groupByTaskId.get(ref)?.id;
  }

  const dependencyHighlightRowIds = new Set(highlightedRowIds);
  const selectedTask = selectedTaskId ? taskMap.get(selectedTaskId) : undefined;

  selectedTask?.dependencyIds.forEach((dependencyId) => {
    const rowId = getVisibleRowIdForRef(dependencyId);
    if (rowId) {
      dependencyHighlightRowIds.add(rowId);
    }
  });

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  }

  function beginEditingTaskName(taskId: string) {
    setEditingTaskNameId(taskId);
    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-task-name-id="${taskId}"]`);
      input?.focus();
      input?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }

  function finishEditingTaskName(taskId: string, value: string) {
    if (value.trim() !== "") {
      setEditingTaskNameId((current) => (current === taskId ? null : current));
    }
  }

  function handleTaskNameKeyDown(event: KeyboardEvent<HTMLInputElement>, taskId: string) {
    if (event.key === "Enter") {
      const value = event.currentTarget.value;
      event.currentTarget.blur();
      finishEditingTaskName(taskId, value);
    }

    if (event.key === "Escape") {
      const value = event.currentTarget.value;
      event.currentTarget.blur();
      finishEditingTaskName(taskId, value);
    }
  }

  function moveGroupToZone(group: ProcessGroup, zoneId?: string) {
    onMoveTasksToZone(group.tasks.map((task) => task.id), zoneId);
    onActivateZone(zoneId);
  }

  function getDraggedGroupId(event: DragEvent) {
    return event.dataTransfer.getData("text/plain") || draggingGroupId;
  }

  function dropGroupOnZone(event: DragEvent, zone: ZoneGroup) {
    event.preventDefault();
    const groupId = getDraggedGroupId(event);
    const group = processGroups.find((candidate) => candidate.id === groupId);
    if (!group) {
      return;
    }

    moveGroupToZone(group, zone.editable ? zone.id : undefined);
    setDraggingGroupId(null);
    setDragOverZoneId(null);
    setDragOverGroup(null);
  }

  function updateGroupDropTarget(event: DragEvent<HTMLDivElement>, groupId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDragOverZoneId(null);
    setDragOverGroup({ id: groupId, placement });
  }

  function dropGroupOnGroup(event: DragEvent<HTMLDivElement>, targetGroup: ProcessGroup) {
    event.preventDefault();
    const sourceGroupId = getDraggedGroupId(event);
    const sourceGroup = processGroups.find((candidate) => candidate.id === sourceGroupId);

    if (sourceGroup && sourceGroup.id !== targetGroup.id) {
      const targetZone = zoneByGroupId.get(targetGroup.id);
      const bounds = event.currentTarget.getBoundingClientRect();
      const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      onReorderTaskGroups(
        sourceGroup.tasks.map((task) => task.id),
        targetGroup.tasks.map((task) => task.id),
        targetZone?.editable ? targetZone.id : undefined,
        placement,
      );
    }

    setDraggingGroupId(null);
    setDragOverZoneId(null);
    setDragOverGroup(null);
  }

  function getRowStartTask(row: GanttRow) {
    if (row.kind === "zone") {
      return row.zone.groups[0]?.tasks[0];
    }

    return row.kind === "group" ? row.group.tasks[0] : row.task;
  }

  function getRowFinishTask(row: GanttRow) {
    if (row.kind === "zone") {
      const lastGroup = row.zone.groups[row.zone.groups.length - 1];
      return lastGroup?.tasks[lastGroup.tasks.length - 1];
    }

    return row.kind === "group" ? row.group.tasks[row.group.tasks.length - 1] : row.task;
  }

  function getRowFinishRef(row: GanttRow) {
    return row.kind === "step" ? row.id : getRowFinishTask(row)?.id;
  }

  function canUseFinishAsLinkSource(targetRowId: string | null, sourceRow: GanttRow) {
    if (!targetRowId || targetRowId === sourceRow.id) {
      return false;
    }

    const targetRow = visibleRows.find((row) => row.id === targetRowId);
    const sourceRef = getRowFinishRef(sourceRow);

    if (!targetRow || !sourceRef) {
      return false;
    }

    if (targetRow.kind === "step") {
      return sourceRef !== targetRow.id && sourceRef !== targetRow.task.id;
    }

    const targetTask = getRowStartTask(targetRow);
    const sourceTask = getRowFinishTask(sourceRow);

    if (!targetTask || !sourceTask) {
      return false;
    }

    return targetTask.id !== sourceTask.id;
  }

  function isLinkedFinishSourceForActiveStart(sourceRow: GanttRow) {
    const activeStartRowId = linkingRowId ?? Object.keys(startDrafts)[0];
    const targetRow = activeStartRowId ? visibleRows.find((row) => row.id === activeStartRowId) : undefined;
    const sourceRef = getRowFinishRef(sourceRow);

    if (!targetRow || !sourceRef) {
      return false;
    }

    if (targetRow.kind === "step") {
      return (targetRow.step.dependencyIds ?? []).includes(sourceRef);
    }

    const targetTask = getRowStartTask(targetRow);
    const sourceTask = getRowFinishTask(sourceRow);

    return Boolean(targetTask && sourceTask && targetTask.dependencyIds.includes(sourceTask.id));
  }

  function finishLinkClass(row: GanttRow) {
    if (isLinkedFinishSourceForActiveStart(row)) {
      return "border-accent/70 bg-accent-muted text-accent ring-2 ring-border-strong";
    }

    return canUseFinishAsLinkSource(linkingRowId, row)
      ? "border-accent bg-accent-muted text-accent hover:bg-accent-subtle"
      : "border-line bg-surface-sunken text-ink-secondary disabled:opacity-50";
  }

  function getStartInputValue(rowId: string, minutes: number) {
    if (linkingRowId === rowId) {
      return "=";
    }

    return startDrafts[rowId] ?? formatRelativeHours(minutes);
  }

  function beginStartEdit(rowId: string, minutes: number) {
    setStartDrafts((current) => ({ ...current, [rowId]: formatRelativeHours(minutes) }));
  }

  function finishStartEdit(rowId: string) {
    setStartDrafts((current) => {
      if (!(rowId in current)) {
        return current;
      }

      const { [rowId]: _removed, ...rest } = current;
      return rest;
    });
  }

  function clearStartEdit(rowId: string) {
    setLinkingRowId((current) => (current === rowId ? null : current));
    finishStartEdit(rowId);
  }

  function updateStartLinkDraft(rowId: string, value: string) {
    const nextValue = value.trim();
    if (nextValue.includes("=")) {
      const targetRow = visibleRows.find((row) => row.id === rowId);
      const targetTask = targetRow ? getRowStartTask(targetRow) : undefined;
      if (targetTask) {
        onSelectTask(targetTask.id);
      }
      setHighlightedRowIds(new Set());
      setLinkingRowId(rowId);
      setStartDrafts((current) => ({ ...current, [rowId]: "=" }));
      return;
    }

    setStartDrafts((current) => ({ ...current, [rowId]: nextValue }));

    if (nextValue === "") {
      setLinkingRowId(null);
      return;
    }

    const nextHours = parseRelativeHours(nextValue);
    if (nextHours === undefined) {
      return;
    }

    const row = visibleRows.find((candidate) => candidate.id === rowId);
    const nextStart = new Date(bounds.startMs + nextHours * 60 * 60_000).toISOString();

    if (row?.kind === "group") {
      row.group.tasks.forEach((task) => {
        const currentWindow = getTaskWindow(task, bounds.startMs);
        const groupOffsetMinutes = currentWindow.startMinute - row.group.startMinute;
        const taskStart = new Date(bounds.startMs + (nextHours * 60 + groupOffsetMinutes) * 60_000).toISOString();
        onUpdateTask(task.id, {
          plannedStart: taskStart,
          plannedFinish: new Date(Date.parse(taskStart) + Math.max(task.plannedDurationMinutes, 0) * 60_000).toISOString(),
        });
      });
      setLinkingRowId(null);
      return;
    }

    if (row?.kind === "task") {
      onUpdateTask(row.task.id, {
        plannedStart: nextStart,
        plannedFinish: new Date(Date.parse(nextStart) + Math.max(row.task.plannedDurationMinutes, 0) * 60_000).toISOString(),
      });
      setLinkingRowId(null);
    }
  }

  function selectFinishLinkTarget(sourceRow: GanttRow) {
    if (!canUseFinishAsLinkSource(linkingRowId, sourceRow)) {
      return;
    }

    const targetRow = visibleRows.find((row) => row.id === linkingRowId);

    if (!targetRow) {
      return;
    }

    if (targetRow.kind === "step") {
      const sourceRef = getRowFinishRef(sourceRow);
      if (!sourceRef) {
        return;
      }

      onUpdateTask(targetRow.task.id, {
        manufacturingSteps: (targetRow.task.manufacturingSteps ?? []).map((step) =>
          step.id === targetRow.step.id
            ? { ...step, dependencyIds: [...new Set([...(step.dependencyIds ?? []), sourceRef])] }
            : step,
        ),
      });
      finishStartEdit(targetRow.id);
      setLinkingRowId(null);
      return;
    }

    const targetTask = getRowStartTask(targetRow);
    const predecessorTask = getRowFinishTask(sourceRow);

    if (!targetTask || !predecessorTask) {
      return;
    }

    onLinkTaskStartToFinish(targetTask.id, predecessorTask.id);
    finishStartEdit(targetRow.id);
    setLinkingRowId(null);
  }

  function selectTaskForEditing(taskId: string) {
    setLinkingRowId(null);
    setHighlightedRowIds(new Set());
    onSelectTask(taskId);
  }

  async function copyZoneGanttRows(zone: ZoneGroup) {
    const text = buildZoneGanttClipboardRows(zone, bounds.startMs);

    if (!text) {
      onNotify({
        title: "Nothing to copy",
        body: `${zone.name || "This zone"} does not have any task rows.`,
        tone: "warning",
      });
      return;
    }

    let copied = false;
    const errors: string[] = [];

    try {
      copied = copyTextWithSelection(text);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Legacy clipboard copy failed.");
      copied = false;
    }

    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Clipboard API copy failed.");
        copied = false;
      }
    }

    onNotify(
      copied
        ? {
            title: "Zone copied",
            body: `${zone.name || "Zone"} rows are ready to paste into Excel.`,
            tone: "success",
          }
        : {
            title: "Manual copy needed",
            content: (
              <div className="space-y-3">
                <p className="ui-workspace-notice-body">
                  The browser blocked clipboard access. Select the rows below and copy them manually.
                </p>
                <textarea
                  readOnly
                  value={text}
                  onFocus={(event) => event.currentTarget.select()}
                  className="ui-field-standalone h-[280px] resize-none p-3 font-mono text-xs leading-relaxed"
                />
                {errors.length ? (
                  <p className="ui-workspace-notice-body text-danger">{errors.join(" ")}</p>
                ) : null}
              </div>
            ),
            tone: "warning",
            placement: "center",
            persistent: true,
          },
    );
  }

  function activateRow(row: GanttRow) {
    setLinkingRowId(null);
    setHighlightedRowIds(new Set());
    const task = getRowStartTask(row);
    if (task) {
      onSelectTask(task.id);
    }
  }

  function openRowDetail(row: GanttRow) {
    const task = getRowStartTask(row);
    if (task) {
      onOpenTaskDetail(task.id);
    }
  }

  function updateTaskDuration(task: Task, value: number) {
    const plannedDurationMinutes = Math.max(value * 60, 0);
    onUpdateTask(task.id, { plannedDurationMinutes });
  }

  function toggleTaskOperator(task: Task, operatorId: string) {
    const currentOperatorIds = getTaskOperatorIds(task, availableOperatorLetters);
    const nextOperatorIds = currentOperatorIds.includes(operatorId)
      ? currentOperatorIds.filter((candidate) => candidate !== operatorId)
      : [...currentOperatorIds, operatorId];

    onUpdateTask(task.id, getTaskOperatorPatch(task, nextOperatorIds, availableOperatorLetters));
  }

  function openPredecessorPicker(task: Task) {
    selectTaskForEditing(task.id);
    setPredecessorPickerTaskId(task.id);
    setPredecessorDraftIds(new Set(task.dependencyIds));
  }

  function closePredecessorPicker() {
    setPredecessorPickerTaskId(null);
    setPredecessorDraftIds(new Set());
  }

  function openCodeMapping(task: Task) {
    setMappingTaskId(task.id);
    setMappingDraft({
      zoneId: task.zoneId ?? "",
      componentId: task.componentId ?? "",
      taskNumber: task.taskNumber ? String(task.taskNumber) : "",
      codeLocked: Boolean(task.codeLocked),
    });
  }

  function closeCodeMapping() {
    setMappingTaskId(null);
  }

  function saveCodeMapping() {
    if (!mappingTask) {
      return;
    }

    const taskNumber = Number.parseInt(mappingDraft.taskNumber, 10);
    const nextTaskNumber = Number.isFinite(taskNumber) && taskNumber > 0 ? taskNumber : undefined;
    const patchBase = {
      zoneId: mappingDraft.zoneId || undefined,
      componentId: mappingDraft.componentId || undefined,
      taskNumber: nextTaskNumber,
      codeLocked: mappingDraft.codeLocked,
    };
    const manufacturingCode = generateTaskCode(patchBase, zones, components);

    onUpdateTask(mappingTask.id, {
      ...patchBase,
      manufacturingCode: manufacturingCode || undefined,
      codeGeneratedAt: manufacturingCode ? new Date().toISOString() : undefined,
    });
    closeCodeMapping();
  }

  function convertUnzonedToZone(name: string, zone: ZoneGroup) {
    const nextName = name.trim();
    setUnzonedNameDraft(name);

    if (!nextName || nextName.toLowerCase() === "unzoned") {
      return;
    }

    const taskIds = zone.groups.flatMap((group) => group.tasks.map((task) => task.id));
    if (taskIds.length === 0) {
      return;
    }

    onCreateZoneFromTasks(nextName, taskIds);
    setUnzonedNameDraft("Unzoned");
  }

  function togglePredecessorDraft(taskId: string) {
    setPredecessorDraftIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }

      return next;
    });
  }

  function savePredecessors() {
    if (!predecessorPickerTask) {
      return;
    }

    const validDependencyIds = predecessorCandidates
      .filter((candidate) => predecessorDraftIds.has(candidate.id))
      .filter((candidate) => candidate.id !== predecessorPickerTask.id)
      .filter(
        (candidate) =>
          predecessorPickerTask.dependencyIds.includes(candidate.id) ||
          !wouldCreateDependencyCycle(taskMap, predecessorPickerTask.id, candidate.id),
      )
      .map((candidate) => candidate.id);

    onSetTaskDependencies(predecessorPickerTask.id, validDependencyIds);
    closePredecessorPicker();
  }

  function getTimelineRowLabel(visibleRow: GanttRow) {
    if (visibleRow.kind === "zone") {
      return visibleRow.zone.name || "Untitled zone";
    }

    if (visibleRow.kind === "group") {
      const primaryTask = visibleRow.group.tasks[0];
      return primaryTask ? taskDisplayLabel(primaryTask) : visibleRow.group.name;
    }

    if (visibleRow.kind === "step") {
      return `${stepDisplayCode(visibleRow.task, visibleRow.step) || `Step ${visibleRow.step.sequence}`} ${manufacturingStepLabel(visibleRow.step)}`;
    }

    return taskDisplayLabel(visibleRow.task);
  }

  function getPredecessorCandidateState(candidate: Task) {
    if (!predecessorPickerTask) {
      return "available";
    }

    if (predecessorDraftIds.has(candidate.id)) {
      return "selected";
    }

    if (candidate.id === predecessorPickerTask.id || wouldCreateDependencyCycle(taskMap, predecessorPickerTask.id, candidate.id)) {
      return "invalid";
    }

    return "available";
  }

  function getTaskZone(task: Task) {
    const group = groupByTaskId.get(task.id);
    return group ? zoneByGroupId.get(group.id) : undefined;
  }

  function startMaximizedLabelResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = maximizedLabelWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.min(Math.max(startWidth + moveEvent.clientX - startX, 220), 520);
      setMaximizedLabelWidth(nextWidth);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <>
    {/* Reordering is native HTML5 drag-and-drop and renaming is onDoubleClick-only;
        neither fires on touch. Say so rather than let both fail silently on a phone. */}
    <p className="border-b border-line bg-surface-sunken px-3 py-2 text-[11px] leading-snug text-ink-secondary lg:hidden">
      Reordering and renaming tasks require a larger screen.
    </p>
    <section className="ui-gantt-timeline">
      <div className="ui-gantt-timeline-grid" style={{ gridTemplateColumns: `${tableColumnWidth}px minmax(0,1fr)` }}>
        <div className="ui-gantt-table-pane">
          {tableCollapsed ? (
            <div className="flex h-full min-h-[560px] flex-col items-center gap-3 py-3">
              <button
                type="button"
                onClick={() => setTableCollapsed(false)}
                className="inline-flex h-8 w-8 items-center justify-center ui-panel text-ink transition hover:bg-surface-sunken"
                aria-label="Expand task table"
                title="Expand task table"
              >
                <ChevronRight size={15} strokeWidth={1.75} />
              </button>
              <div className="mt-2 flex flex-1 items-center">
                <span className="rotate-180 ui-mono-label [writing-mode:vertical-rl]">
                  Task table
                </span>
              </div>
              <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded border border-line bg-surface text-[11px] font-medium text-ink">
                {visibleRows.length}
              </span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTableCollapsed(true)}
                className="absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface/95 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink"
                aria-label="Collapse task table"
                title="Collapse task table"
              >
                <ChevronLeft size={14} strokeWidth={1.75} />
              </button>
              <div
                className="grid h-11 items-center gap-2 border-b border-line pl-3 pr-4 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-secondary"
                style={tableGridStyle}
              >
                <span className="whitespace-nowrap text-center">Code</span>
                <span className="text-left">Task</span>
                <span>Start</span>
                <span>Hrs</span>
                <span>Finish</span>
                <span
                  className="flex items-center justify-center gap-1"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onResetHeadcount();
                  }}
                >
                  <span>Headcount</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSmartAllocate();
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    disabled={smartAllocationPending}
                    aria-label="Optimize line"
                    title={smartAllocationPending ? "Optimizing line…" : "Optimize line — schedule & staff into a new scenario"}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-transparent text-ink-tertiary transition hover:border-line hover:bg-surface-muted hover:text-ink-secondary disabled:cursor-wait disabled:opacity-60"
                  >
                    <Sparkles size={12} strokeWidth={2} />
                  </button>
                </span>
                <span>MH</span>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
              <div>
                {visibleRows.map((row) => {
              if (row.kind === "zone") {
                return (
                  <div
                    key={row.id}
                    onClick={() => onActivateZone(row.zone.editable ? row.zone.id : undefined)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverZoneId(row.zone.id);
                    }}
                    onDragLeave={() => setDragOverZoneId(null)}
                    onDrop={(event) => dropGroupOnZone(event, row.zone)}
                    className={`grid h-[54px] w-full items-center gap-2 border-b pl-3 pr-4 text-left text-xs transition ${
                      dragOverZoneId === row.zone.id
                        ? "border-accent bg-accent-muted"
                        : activeZoneId === row.zone.id
                          ? "border-accent bg-warn-muted"
                          : "border-line"
                    }`}
                    style={tableGridStyle}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-full items-center justify-center rounded"
                      style={{ backgroundColor: row.zone.stroke }}
                    />
                    <div className="min-w-0 px-2">
                      {row.zone.editable ? (
                        <input
                          aria-label={`${row.zone.name || "Untitled zone"} zone name`}
                          className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-xs ui-mono-label tracking-wide text-ink outline-none focus:border-line focus:bg-surface"
                          value={row.zone.name}
                          placeholder="Zone name"
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onUpdateZone(row.zone.id, { name: event.target.value })}
                        />
                      ) : row.zone.groups.length > 0 ? (
                        <input
                          aria-label="Create zone from unzoned tasks"
                          className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-xs ui-mono-label tracking-wide text-ink outline-none focus:border-line focus:bg-surface"
                          value={unzonedNameDraft}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => convertUnzonedToZone(event.target.value, row.zone)}
                        />
                      ) : (
                        <div className="truncate text-xs ui-mono-label tracking-wide text-ink">
                          {row.zone.name || "Untitled zone"}
                        </div>
                      )}
                    </div>
                    <span className="text-center font-mono font-bold text-ink-secondary">{formatRelativeHours(row.zone.startMinute)}</span>
                    <span className="text-center font-bold text-ink-secondary">{round(row.zone.durationMinutes / 60, 2)}</span>
                    <span className="text-center font-mono font-bold text-ink-secondary">{formatRelativeHours(row.zone.finishMinute)}</span>
                    <span className="text-center font-semibold text-ink-secondary">{row.zone.plannedOperators}</span>
                    <span className="text-center font-semibold text-ink-secondary">{round(row.zone.plannedManHours, 1)}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyZoneGanttRows(row.zone);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
                      aria-label={`Copy ${row.zone.name || "zone"} rows for Excel`}
                      title={`Copy ${row.zone.name || "zone"} rows for Excel`}
                    >
                      <Copy size={14} strokeWidth={1.75} />
                    </button>
                    {row.zone.editable ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteZone(row.zone.id);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-danger/40 hover:bg-danger-muted hover:text-danger"
                        aria-label={`Delete zone ${row.zone.name || "Untitled zone"}`}
                        title="Delete zone"
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddTaskToZone(row.zone.editable ? row.zone.id : undefined);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
                      aria-label={`Add task to ${row.zone.name || "Untitled zone"}`}
                      title={`Add task to ${row.zone.name || "Untitled zone"}`}
                    >
                      <Plus size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                );
              }

              if (row.kind === "group") {
                const expanded = expandedGroups.has(row.group.id);
                const selected = row.group.tasks.some((task) => task.id === selectedTaskId);
                const primaryTask = row.group.tasks[0];
                const editableTask = row.group.tasks.find((task) => task.wbs === row.group.wbs);
                const stepCount = groupManufacturingStepCount(row.group);
                const highlighted = dependencyHighlightRowIds.has(row.id);
                const groupDurationOverTakt = exceedsTaktLimit(row.group.durationMinutes, taktLimitMinutes);
                const groupDurationFlag = groupDurationOverTakt
                  ? taktFlagLabel(row.group.durationMinutes, taktLimitMinutes)
                  : undefined;
                return (
                  <div
                    key={row.id}
                    data-task-select="true"
                    draggable
                    onDoubleClick={() => openRowDetail(row)}
                    onDragStart={(event) => {
                      setDraggingGroupId(row.group.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", row.group.id);
                    }}
                    onDragOver={(event) => updateGroupDropTarget(event, row.group.id)}
                    onDragLeave={() => setDragOverGroup((current) => (current?.id === row.group.id ? null : current))}
                    onDrop={(event) => dropGroupOnGroup(event, row.group)}
                    onDragEnd={() => {
                      setDraggingGroupId(null);
                      setDragOverZoneId(null);
                      setDragOverGroup(null);
                    }}
                    className={`grid h-[54px] w-full items-center gap-2 border-b border-line pl-3 pr-4 text-left text-xs transition ${
                      highlighted
                        ? "bg-accent-muted shadow-inset-accent-start"
                        : draggingGroupId === row.group.id
                          ? "bg-accent-muted opacity-70"
                        : selected
                          ? "bg-accent-muted"
                          : "bg-canvas hover:bg-surface-hover"
                    } ${
                      dragOverGroup?.id === row.group.id
                        ? dragOverGroup.placement === "before"
                          ? "shadow-inset-accent-top"
                          : "shadow-inset-accent-bottom"
                        : ""
                    }`}
                    style={tableGridStyle}
                  >
                    {primaryTask ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openCodeMapping(primaryTask);
                        }}
                        className={`flex h-8 w-full items-center justify-center justify-self-center truncate rounded border px-1 text-center font-mono text-[11px] font-medium transition ${
                          primaryTask.manufacturingCode?.trim()
                            ? "border-transparent text-ink hover:border-line hover:bg-surface"
                            : "border-danger/25 bg-danger-muted text-danger hover:border-danger/45"
                        }`}
                        title="Map task code"
                        aria-label={`Map code for ${primaryTask.name || "task"}`}
                      >
                        <span className="truncate">{taskDisplayCode(primaryTask)}</span>
                      </button>
                    ) : (
                      <span className="flex h-8 w-full items-center justify-center justify-self-center truncate text-center font-mono text-[11px] font-medium text-ink-secondary">
                        Uncoded
                      </span>
                    )}
                    {editableTask ? (
                      editingTaskNameId === editableTask.id || editableTask.name.trim() === "" ? (
                        <div className="min-w-0">
                          <input
                      aria-label={`${taskDisplayCode(editableTask)} task name`}
                            data-task-name-id={editableTask.id}
                            className="h-9 w-full min-w-0 rounded border border-line bg-surface px-2 font-medium text-ink outline-none transition placeholder:text-ink-secondary/70"
                            value={editableTask.name}
                            placeholder="Blank task"
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onFocus={() => selectTaskForEditing(editableTask.id)}
                            onBlur={(event) => finishEditingTaskName(editableTask.id, event.currentTarget.value)}
                            onKeyDown={(event) => handleTaskNameKeyDown(event, editableTask.id)}
                            onChange={(event) => onUpdateTask(editableTask.id, { name: event.target.value })}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => activateRow(row)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            beginEditingTaskName(editableTask.id);
                          }}
                          className="w-full min-w-0 cursor-text truncate rounded border border-transparent bg-transparent px-2 py-2 text-left font-medium text-ink"
                          title="Double-click to rename"
                        >
                          {editableTask.name || taskDisplayCode(editableTask)}
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          activateRow(row);
                        }}
                        className="w-full min-w-0 truncate rounded border border-transparent bg-transparent px-2 py-2 text-left font-medium text-ink"
                        title={stepCount ? `${stepCount} manufacturing step${stepCount === 1 ? "" : "s"}` : undefined}
                      >
                        {row.group.name}
                      </button>
                    )}
                    <input
                      aria-label={`${row.group.wbs} start link`}
                      className={`h-9 rounded border px-1 text-center font-mono font-bold outline-none ${
                        linkingRowId === row.id
                          ? "border-accent bg-accent-muted text-accent"
                          : "border-line bg-surface text-ink-secondary"
                      }`}
                      value={getStartInputValue(row.id, row.group.startMinute)}
                      onFocus={(event) => {
                        if (primaryTask) {
                          selectTaskForEditing(primaryTask.id);
                        }
                        beginStartEdit(row.id, row.group.startMinute);
                        event.currentTarget.select();
                      }}
                      onBlur={() => finishStartEdit(row.id)}
                      onChange={(event) => updateStartLinkDraft(row.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          clearStartEdit(row.id);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    {primaryTask ? (
                      <div className="relative min-w-0" title={groupDurationFlag}>
                        <ClearableNumberInput
                          aria-label={`${row.group.wbs} duration hours${groupDurationOverTakt ? " over takt" : ""}`}
                          min={0}
                          step={0.05}
                          readOnly={stepCount > 0}
                          className={`number-input h-9 w-full min-w-0 rounded border px-1 text-center font-bold outline-none ${
                            groupDurationOverTakt
                              ? TAKT_FLAG_INPUT_CLASS
                              : stepCount > 0
                                ? "border-line bg-surface-sunken text-ink-secondary"
                                : "border-line bg-surface text-ink"
                          }`}
                          value={round(row.group.durationMinutes / 60, 2)}
                          fallbackValue={row.group.durationMinutes / 60}
                          precision={2}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => selectTaskForEditing(primaryTask.id)}
                          onValueChange={(value) => {
                            if (stepCount === 0) {
                              updateTaskDuration(primaryTask, value);
                            }
                          }}
                        />
                        {groupDurationFlag ? <TaktConditionFlag label={groupDurationFlag} /> : null}
                      </div>
                    ) : (
                      <span
                        className={`relative rounded border px-2 py-2 text-right font-bold ${
                          groupDurationOverTakt ? TAKT_FLAG_INPUT_CLASS : "border-line bg-surface text-ink"
                        }`}
                        title={groupDurationFlag}
                      >
                        {round(row.group.durationMinutes / 60, 2)}
                        {groupDurationFlag ? <TaktConditionFlag label={groupDurationFlag} /> : null}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        selectFinishLinkTarget(row);
                      }}
                      disabled={linkingRowId !== null && !canUseFinishAsLinkSource(linkingRowId, row)}
                      className={`rounded border px-1 py-2 text-center font-mono font-bold outline-none transition ${finishLinkClass(row)}`}
                      aria-label={`${row.group.wbs} finish ${formatRelativeHours(row.group.finishMinute)}`}
                    >
                      {formatRelativeHours(row.group.finishMinute)}
                    </button>
                    {primaryTask ? (
                      <OperatorAssignmentPicker
                        task={primaryTask}
                        availableOperatorLetters={availableOperatorLetters}
                        operatorCapacityMinutes={operatorCapacityMinutes}
                        demandQuantity={demandQuantity}
                        isAllocating={smartAllocationPending}
                        taktMinutes={taktLimitMinutes}
                        onNotify={onNotify}
                        onConfirmAction={onConfirmAction}
                        tasks={tasks}
                        onToggleOperator={(task, operatorId) => {
                          selectTaskForEditing(task.id);
                          toggleTaskOperator(task, operatorId);
                        }}
                      />
                    ) : (
                      <span className="text-center font-semibold text-ink-secondary">{row.group.plannedOperators}</span>
                    )}
                    <span className="text-center font-semibold text-ink-secondary">{round(row.group.plannedManHours, 1)}</span>
                    {primaryTask ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openPredecessorPicker(primaryTask);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
                        aria-label="Add predecessor"
                        title="Add predecessor"
                      >
                        <Link2 size={14} strokeWidth={1.75} />
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteTasks(row.group.tasks.map((task) => task.id));
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-danger/40 hover:bg-danger-muted hover:text-danger"
                      aria-label={`Delete task ${row.group.wbs}`}
                      title="Delete task"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (primaryTask) {
                          selectTaskForEditing(primaryTask.id);
                        }
                        toggleGroup(row.group.id);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface text-ink-secondary outline-none hover:bg-surface-sunken hover:text-ink"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Collapse" : "Expand"} process ${row.group.wbs}`}
                      title={expanded ? "Collapse task" : "Expand task"}
                    >
                      {expanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
                    </button>
                  </div>
                );
              }

              if (row.kind === "step") {
                const durationMinutes = Math.max(row.step.durationMinutes ?? 0, 0);
                const highlighted = dependencyHighlightRowIds.has(row.id);
                const stepDurationOverTakt = exceedsTaktLimit(durationMinutes, taktLimitMinutes);
                const stepDurationFlag = stepDurationOverTakt ? taktFlagLabel(durationMinutes, taktLimitMinutes) : undefined;
                const rowStepCode = stepDisplayCode(row.task, row.step) || `Step ${row.step.sequence}`;
                const visibleRowStepCode = frontTruncateStepCode(rowStepCode);
                const rowStepLabel = manufacturingStepLabel(row.step);
                const hasStepName = Boolean(row.step.name?.trim());
                return (
                  <div
                    key={row.id}
                    data-task-select="true"
                    onClick={() => activateRow(row)}
                    onDoubleClick={() => openRowDetail(row)}
                    className={`grid h-[54px] w-full items-center gap-2 border-b border-line pl-3 pr-4 text-left text-xs transition ${
                      highlighted ? "bg-accent-muted shadow-inset-accent-start" : "bg-canvas hover:bg-surface-hover"
                    }`}
                    style={tableGridStyle}
                  >
                    <span className="truncate text-center font-mono text-[11px] text-ink-secondary" title={rowStepCode}>
                      {visibleRowStepCode}
                    </span>
                    {hasStepName ? (
                      <span className="min-w-0 truncate px-2 font-semibold text-ink" title={rowStepLabel}>
                        {rowStepLabel}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenProcedureStepName(row.task.id, row.step.id);
                        }}
                        className="justify-self-start rounded border border-dashed border-accent/40 bg-accent-muted px-2 py-1 text-[11px] font-semibold text-accent hover:border-accent hover:bg-accent-subtle"
                        aria-label={`Add name for ${rowStepCode}`}
                        title="Open procedure step name field"
                      >
                        Add name
                      </button>
                    )}
                    <input
                      aria-label={`${rowStepCode} start link`}
                      className={`h-9 rounded border px-1 text-center font-mono font-bold outline-none ${
                        linkingRowId === row.id
                          ? "border-accent bg-accent-muted text-accent"
                          : "border-line bg-surface-sunken text-ink-secondary"
                      }`}
                      value={getStartInputValue(row.id, row.startMinute)}
                      onClick={(event) => event.stopPropagation()}
                      onFocus={(event) => {
                        selectTaskForEditing(row.task.id);
                        beginStartEdit(row.id, row.startMinute);
                        event.currentTarget.select();
                      }}
                      onBlur={() => finishStartEdit(row.id)}
                      onChange={(event) => updateStartLinkDraft(row.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          clearStartEdit(row.id);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span
                      className={`relative rounded border px-1 py-2 text-center font-bold ${
                        stepDurationOverTakt ? TAKT_FLAG_INPUT_CLASS : "border-line bg-surface text-ink"
                      }`}
                      title={stepDurationFlag}
                    >
                      {round(durationMinutes / 60, 2)}
                      {stepDurationFlag ? <TaktConditionFlag label={stepDurationFlag} /> : null}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        selectFinishLinkTarget(row);
                      }}
                      disabled={linkingRowId !== null && !canUseFinishAsLinkSource(linkingRowId, row)}
                      className={`rounded border px-1 py-2 text-center font-mono font-bold outline-none transition ${finishLinkClass(row)}`}
                      aria-label={`${rowStepCode} finish ${formatRelativeHours(row.finishMinute)}`}
                    >
                      {formatRelativeHours(row.finishMinute)}
                    </button>
                    <OperatorAssignmentPicker
                      task={row.task}
                      availableOperatorLetters={availableOperatorLetters}
                      operatorCapacityMinutes={operatorCapacityMinutes}
                      demandQuantity={demandQuantity}
                      isAllocating={smartAllocationPending}
                      taktMinutes={taktLimitMinutes}
                      onNotify={onNotify}
                      onConfirmAction={onConfirmAction}
                      tasks={tasks}
                      onToggleOperator={(task, operatorId) => {
                        selectTaskForEditing(task.id);
                        toggleTaskOperator(task, operatorId);
                      }}
                    />
                    <span className="text-center font-semibold text-ink-secondary">-</span>
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                  </div>
                );
              }

              const task = row.task;
              const selected = selectedTaskId === task.id;
              const highlighted = dependencyHighlightRowIds.has(row.id);
              const window = getTaskWindow(task, bounds.startMs);
              const taskDurationOverTakt = exceedsTaktLimit(task.plannedDurationMinutes, taktLimitMinutes);
              const taskDurationFlag = taskDurationOverTakt ? taktFlagLabel(task.plannedDurationMinutes, taktLimitMinutes) : undefined;
              return (
                <div
                  key={task.id}
                  data-task-select="true"
                  onClick={() => activateRow(row)}
                  onDoubleClick={() => openRowDetail(row)}
                  className={`grid h-[54px] w-full items-center gap-2 border-b border-line pl-3 pr-4 text-left text-xs transition ${
                    highlighted
                      ? "bg-accent-muted shadow-inset-accent-start"
                      : selected
                        ? "bg-accent-muted"
                        : "hover:bg-surface-hover"
                  }`}
                  style={tableGridStyle}
                >
                  <span className="text-center font-mono text-[11px] text-ink-secondary">{taskDisplayCode(task)}</span>
                  {editingTaskNameId === task.id || task.name.trim() === "" ? (
                    <input
                      aria-label={`${task.wbs} task name`}
                      data-task-name-id={task.id}
                      className="h-9 w-full min-w-0 rounded border border-line bg-surface px-2 font-semibold text-ink outline-none transition"
                      value={task.name}
                      placeholder="Blank task"
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onFocus={() => selectTaskForEditing(task.id)}
                      onBlur={(event) => finishEditingTaskName(task.id, event.currentTarget.value)}
                      onKeyDown={(event) => handleTaskNameKeyDown(event, task.id)}
                      onChange={(event) => onUpdateTask(task.id, { name: event.target.value })}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => activateRow(row)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        beginEditingTaskName(task.id);
                      }}
                      className="w-full min-w-0 cursor-text truncate rounded border border-transparent bg-transparent px-2 py-2 text-left font-semibold text-ink"
                      title="Double-click to rename"
                    >
                      {task.name}
                    </button>
                  )}
                  <input
                    aria-label={`${task.wbs} start link`}
                    className={`h-9 rounded border px-1 text-center font-mono font-bold outline-none ${
                      linkingRowId === row.id ? "border-accent bg-accent-muted text-accent" : "border-line bg-surface-sunken text-ink-secondary"
                    }`}
                    value={getStartInputValue(row.id, window.startMinute)}
                    onFocus={(event) => {
                      selectTaskForEditing(task.id);
                      beginStartEdit(row.id, window.startMinute);
                      event.currentTarget.select();
                    }}
                    onBlur={() => finishStartEdit(row.id)}
                    onChange={(event) => updateStartLinkDraft(row.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        clearStartEdit(row.id);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <div className="relative min-w-0" title={taskDurationFlag}>
                    <ClearableNumberInput
                      aria-label={`${task.wbs} duration hours${taskDurationOverTakt ? " over takt" : ""}`}
                      min={0}
                      step={0.05}
                      className={`number-input h-9 w-full min-w-0 rounded border px-1 text-center font-bold outline-none ${
                        taskDurationOverTakt ? TAKT_FLAG_INPUT_CLASS : "border-line bg-surface text-ink"
                      }`}
                      value={round(task.plannedDurationMinutes / 60, 2)}
                      fallbackValue={task.plannedDurationMinutes / 60}
                      precision={2}
                      onClick={(event) => event.stopPropagation()}
                      onFocus={() => selectTaskForEditing(task.id)}
                      onValueChange={(value) => updateTaskDuration(task, value)}
                    />
                    {taskDurationFlag ? <TaktConditionFlag label={taskDurationFlag} /> : null}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectFinishLinkTarget(row);
                    }}
                    disabled={linkingRowId !== null && !canUseFinishAsLinkSource(linkingRowId, row)}
                    className={`rounded border px-1 py-2 text-center font-mono font-bold outline-none transition ${finishLinkClass(row)}`}
                    aria-label={`${task.wbs} finish ${formatRelativeHours(window.finishMinute)}`}
                  >
                    {formatRelativeHours(window.finishMinute)}
                  </button>
                  <OperatorAssignmentPicker
                    task={task}
                    availableOperatorLetters={availableOperatorLetters}
                    operatorCapacityMinutes={operatorCapacityMinutes}
                    demandQuantity={demandQuantity}
                    isAllocating={smartAllocationPending}
                    taktMinutes={taktLimitMinutes}
                    onNotify={onNotify}
                    onConfirmAction={onConfirmAction}
                    tasks={tasks}
                    onToggleOperator={(task, operatorId) => {
                      selectTaskForEditing(task.id);
                      toggleTaskOperator(task, operatorId);
                    }}
                  />
                  <span className="text-center font-semibold text-ink-secondary">{round(task.plannedManHours, 1)}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openPredecessorPicker(task);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
                    aria-label="Add predecessor"
                    title="Add predecessor"
                  >
                    <Link2 size={14} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteTasks([task.id]);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-ink-secondary outline-none hover:border-danger/40 hover:bg-danger-muted hover:text-danger"
                    aria-label={`Delete task ${task.wbs}`}
                    title="Delete task"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                  <span aria-hidden="true" />
                </div>
              );
            })}
          </div>
            </>
          )}
        </div>

        {canvasMaximized ? (
          <div
            className="fixed inset-0 z-40 bg-ink/45"
            onClick={() => setCanvasMaximized(false)}
            aria-hidden="true"
          />
        ) : null}
        <div
          className={
            canvasMaximized
              ? "fixed inset-4 z-50 overflow-hidden ui-panel-muted"
              : "relative overflow-hidden ui-gantt-canvas-pane"
          }
        >
          <div className="absolute right-3 top-3 z-[60]">
            <button
              type="button"
              onClick={() => setCanvasMaximized((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface/95 text-ink transition hover:bg-surface-sunken"
              aria-label={canvasMaximized ? "Restore Gantt canvas" : "Maximize Gantt canvas"}
              title={canvasMaximized ? "Restore Gantt canvas" : "Maximize Gantt canvas"}
            >
              {canvasMaximized ? <Minimize2 size={16} strokeWidth={1.75} /> : <Maximize2 size={16} strokeWidth={1.75} />}
            </button>
          </div>
          <div className="h-full overflow-auto">
            {canvasMaximized ? (
              <div className="sticky top-0 z-40 h-0">
                <div className="flex w-max min-w-full">
                  <div
                    className="sticky left-0 z-50 flex h-11 shrink-0 items-center border-r border-line bg-surface-sunken px-4 ui-mono-label"
                    style={{ width: maximizedLabelWidth }}
                  >
                    Task Name
                  </div>
                  <div
                    className="relative h-11 shrink-0 border-b border-line bg-surface-muted"
                    style={{ width: chartWidth }}
                  >
                    <div
                      className="absolute inset-y-0 bg-accent-muted"
                      style={{
                        left: timelineOriginX,
                        width: interval * PIXELS_PER_MINUTE,
                        opacity: 0.85,
                      }}
                    />
                    {tickMarks(bounds.durationMinutes).map((minute) => {
                      const x = timelineOriginX + minute * PIXELS_PER_MINUTE;
                      return (
                        <div key={`max-tick-${minute}`}>
                          <div
                            className="absolute top-0 h-11 w-px bg-border"
                            style={{ left: x }}
                          />
                          <div
                            className="absolute top-[15px] whitespace-nowrap text-[11px] font-bold text-ink-secondary"
                            style={{ left: x + 6 }}
                          >
                            {formatMinutes(minute)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
            <div className={canvasMaximized ? "flex w-max min-w-full" : undefined}>
            {canvasMaximized ? (
              <div
                className="sticky left-0 z-20 shrink-0 border-r border-line bg-canvas"
                style={{ width: maximizedLabelWidth, height: chartHeight }}
              >
                <div className="flex h-11 items-center bg-surface-sunken px-4 ui-mono-label">
                  Task Name
                </div>
                {visibleRows.map((visibleRow) => {
                  const isZone = visibleRow.kind === "zone";
                  const zoneColor = isZone ? visibleRow.zone.stroke : undefined;
                  return (
                    <button
                      key={`max-label-${visibleRow.id}`}
                      type="button"
                      onClick={() => activateRow(visibleRow)}
                      onDoubleClick={() => openRowDetail(visibleRow)}
                      className={`flex w-full items-center gap-3 border-b border-line px-4 text-left text-[12px] font-extrabold text-ink ${
                        isZone ? "bg-surface-sunken" : "bg-canvas"
                      }`}
                      style={{ height: ROW_HEIGHT }}
                      title={getTimelineRowLabel(visibleRow)}
                    >
                      {isZone ? (
                        <span className="h-7 w-7 shrink-0 rounded" style={{ backgroundColor: zoneColor }} />
                      ) : null}
                      <span className="min-w-0 truncate">{getTimelineRowLabel(visibleRow)}</span>
                    </button>
                  );
                })}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize task name column"
                  className="absolute inset-y-0 right-0 w-2 translate-x-1 cursor-col-resize bg-transparent hover:bg-accent/20"
                  onPointerDown={startMaximizedLabelResize}
                />
              </div>
            ) : null}
          <svg width={chartWidth} height={chartHeight} role="img" aria-label="Manufacturing Gantt timeline" className="ui-gantt-chart">
            <rect width={chartWidth} height={chartHeight} fill={chartPalette.canvas} />
            <rect
              x={timelineOriginX}
              y={0}
              width={interval * PIXELS_PER_MINUTE}
              height={HEADER_HEIGHT}
              fill={chartPalette.band}
              opacity={0.85}
            />
            {tickMarks(bounds.durationMinutes).map((minute) => {
              const x = timelineOriginX + minute * PIXELS_PER_MINUTE;
              return (
                <g key={minute}>
                  <line x1={x} x2={x} y1={0} y2={chartHeight} stroke={chartPalette.grid} strokeWidth={1} />
                  <text x={x + 6} y={25} fill={chartPalette.steel} className="ui-gantt-chart-axis-label">
                    {formatMinutes(minute)}
                  </text>
                </g>
              );
            })}

            {visibleRows.map((row, index) => (
              <rect
                key={`row-${row.id}`}
                x={0}
                y={HEADER_HEIGHT + index * ROW_HEIGHT}
                width={chartWidth}
                height={ROW_HEIGHT}
                fill={
                  row.kind === "zone"
                    ? row.zone.fill
                    : row.kind === "group"
                      ? zoneByGroupId.get(row.group.id)?.fill ?? zoneDefaultFill
                      : zoneByGroupId.get(row.groupId)?.fill ?? chartPalette.canvasRaised
                }
                opacity={row.kind === "zone" ? 1 : row.kind === "group" ? 0.58 : 1}
              />
            ))}

            {visibleRows.map((visibleRow) => {
              const row = rowMap.get(visibleRow.id);
              if (!row) {
                return null;
              }

              if (visibleRow.kind === "zone") {
                const zoneStartX = canvasMaximized ? timelineOriginX : 0;
                const zoneWidth = chartWidth - zoneStartX;
                const zoneLineY = row.y + 3;
                return (
                  <g key={visibleRow.id}>
                    <line
                      x1={zoneStartX}
                      x2={zoneStartX + zoneWidth}
                      y1={zoneLineY}
                      y2={zoneLineY}
                      stroke={visibleRow.zone.stroke}
                      strokeWidth={3}
                      opacity={0.8}
                    />
                    <circle cx={zoneStartX + 8} cy={zoneLineY} r={4} fill={visibleRow.zone.stroke} />
                    <text
                      x={zoneStartX + 18}
                      y={row.y + 20}
                      fill={visibleRow.zone.stroke}
                      className="ui-gantt-chart-zone-label"
                    >
                      {visibleRow.zone.name || "Untitled zone"}
                    </text>
                  </g>
                );
              }

              if (visibleRow.kind === "group") {
                const state = showPlaybackMarker ? getGroupState(visibleRow.group, currentMinute) : "not_started";
                const taktExceeded = exceedsTaktLimit(visibleRow.group.durationMinutes, taktLimitMinutes);
                const tone = taktExceeded ? TAKT_EXCEEDED_TONE : groupTone(state);
                const width = timelineBarWidth(row.startX, row.finishX, 18);
                const highlighted = dependencyHighlightRowIds.has(visibleRow.id);
                const primaryTask = visibleRow.group.tasks[0];
                const expandedLabel = primaryTask ? taskDisplayLabel(primaryTask) : truncateTimelineLabel(visibleRow.group.name);

                return (
                  <g
                    key={visibleRow.id}
                    data-task-select="true"
                    role="button"
                    tabIndex={0}
                    onClick={() => activateRow(visibleRow)}
                    onDoubleClick={() => openRowDetail(visibleRow)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        activateRow(visibleRow);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={row.startX}
                      y={row.y}
                      rx={5}
                      ry={5}
                      width={width}
                      height={26}
                      fill={tone.fill}
                      stroke={highlighted ? chartPalette.highlight : tone.stroke}
                      strokeWidth={highlighted ? 2.4 : 1.4}
                    />
                    {showPlaybackMarker && state === "in_progress" && !taktExceeded ? (
                      <rect
                        x={row.startX}
                        y={row.y}
                        rx={5}
                        ry={5}
                        width={Math.max((currentMinute - visibleRow.group.startMinute) * PIXELS_PER_MINUTE, 6)}
                        height={26}
                        fill={chartPalette.accent}
                        opacity={0.9}
                      />
                    ) : null}
                    <title>
                      {expandedLabel}
                      {taktExceeded
                        ? ` - over takt (${formatMinutes(visibleRow.group.durationMinutes)} > ${formatMinutes(taktLimitMinutes)})`
                        : ""}
                    </title>
                  </g>
                );
              }

              if (visibleRow.kind === "step") {
                const durationMinutes = Math.max(visibleRow.step.durationMinutes ?? 0, 0);
                const width = timelineBarWidth(row.startX, row.finishX, 14);
                const highlighted = dependencyHighlightRowIds.has(visibleRow.id);
                const taktExceeded = exceedsTaktLimit(durationMinutes, taktLimitMinutes);
                return (
                  <g
                    key={visibleRow.id}
                    data-task-select="true"
                    role="button"
                    tabIndex={0}
                    onClick={() => activateRow(visibleRow)}
                    onDoubleClick={() => openRowDetail(visibleRow)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        activateRow(visibleRow);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={row.startX}
                      y={row.y}
                      rx={4}
                      ry={4}
                      width={width}
                      height={22}
                      fill={taktExceeded ? TAKT_EXCEEDED_TONE.fill : chartPalette.neutral}
                      stroke={highlighted ? chartPalette.highlight : taktExceeded ? TAKT_EXCEEDED_TONE.stroke : chartPalette.neutralStroke}
                      strokeWidth={highlighted ? 3 : 1}
                    />
                    <title>
                      {stepDisplayCode(visibleRow.task, visibleRow.step) || `Step ${visibleRow.step.sequence}`} - {manufacturingStepLabel(visibleRow.step)} - {formatMinutes(durationMinutes)}
                      {taktExceeded ? ` - over takt (${formatMinutes(taktLimitMinutes)})` : ""}
                    </title>
                  </g>
                );
              }

              const task = visibleRow.task;

              const state = showPlaybackMarker ? getTaskState(task, taskMap, bounds.startMs, currentMinute) : "not_started";
              const taktExceeded = exceedsTaktLimit(task.plannedDurationMinutes, taktLimitMinutes);
              const tone = taktExceeded ? TAKT_EXCEEDED_TONE : taskTone(state, task);
              const width = timelineBarWidth(row.startX, row.finishX, task.rowType === "milestone" ? 18 : 14);
              const highlighted = dependencyHighlightRowIds.has(visibleRow.id);
              const expandedLabel = taskDisplayLabel(task);

              if (task.rowType === "milestone") {
                const centerX = row.startX + 12;
                const centerY = row.y + 13;
                return (
                  <g
                    key={task.id}
                    data-task-select="true"
                    role="button"
                    tabIndex={0}
                    onClick={() => activateRow(visibleRow)}
                    onDoubleClick={() => openRowDetail(visibleRow)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        activateRow(visibleRow);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <polygon
                      points={`${centerX},${centerY - 12} ${centerX + 12},${centerY} ${centerX},${centerY + 12} ${
                        centerX - 12
                      },${centerY}`}
                      fill={tone.fill}
                      stroke={highlighted ? chartPalette.highlight : tone.stroke}
                      strokeWidth={highlighted ? 2.4 : 1.8}
                    />
                    <title>{expandedLabel}</title>
                  </g>
                );
              }

              return (
                <g
                  key={task.id}
                  data-task-select="true"
                  role="button"
                  tabIndex={0}
                  onClick={() => activateRow(visibleRow)}
                  onDoubleClick={() => openRowDetail(visibleRow)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      activateRow(visibleRow);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={row.startX}
                    y={row.y}
                    rx={4}
                    ry={4}
                    width={width}
                    height={26}
                    fill={tone.fill}
                    stroke={highlighted ? chartPalette.highlight : tone.stroke}
                    strokeWidth={highlighted ? 2.4 : task.criticalPath ? 2 : 1}
                  />
                  {showPlaybackMarker && state === "in_progress" && !taktExceeded ? (
                    <rect
                      x={row.startX}
                      y={row.y}
                      rx={4}
                      ry={4}
                      width={Math.max((currentMinute - getTaskWindow(task, bounds.startMs).startMinute) * PIXELS_PER_MINUTE, 6)}
                      height={26}
                      fill={chartPalette.accent}
                      opacity={0.85}
                    />
                  ) : null}
                  <title>
                    {expandedLabel}
                    {taktExceeded
                      ? ` - over takt (${formatMinutes(task.plannedDurationMinutes)} > ${formatMinutes(taktLimitMinutes)})`
                      : ""}
                  </title>
                </g>
              );
            })}

            {hasTaktLimit ? (
              <g
                tabIndex={0}
                aria-label={`Required takt ${formatMinutes(taktLimitMinutes)}`}
                onMouseEnter={() => setTaktLabelVisible(true)}
                onMouseLeave={() => setTaktLabelVisible(false)}
                onFocus={() => setTaktLabelVisible(true)}
                onBlur={() => setTaktLabelVisible(false)}
              >
                <line
                  x1={taktLineX}
                  x2={taktLineX}
                  y1={barCanvasTop}
                  y2={barCanvasBottom}
                  stroke={chartPalette.danger}
                  strokeWidth={2}
                  strokeDasharray="6 5"
                />
                <line
                  x1={taktLineX}
                  x2={taktLineX}
                  y1={barCanvasTop}
                  y2={barCanvasBottom}
                  stroke="transparent"
                  strokeWidth={14}
                  pointerEvents="stroke"
                />
                {taktLabelVisible ? (
                  <>
                    <rect
                      x={taktFlagX}
                      y={taktFlagY}
                      width={taktFlagWidth}
                      height={22}
                      rx={4}
                      fill={chartPalette.danger}
                    />
                    <text
                      x={taktFlagTextX}
                      y={taktFlagTextY}
                      fill={chartPalette.white}
                      className="ui-gantt-chart-flag-label"
                      textAnchor="middle"
                    >
                      Required takt {formatMinutes(taktLimitMinutes)}
                    </text>
                  </>
                ) : null}
              </g>
            ) : null}

            {showPlaybackMarker ? (
              <>
                <line
                  x1={playbackMarkerX}
                  x2={playbackMarkerX}
                  y1={0}
                  y2={chartHeight}
                  stroke={chartPalette.danger}
                  strokeWidth={2}
                />
                <rect
                  x={playbackFlagX}
                  y={6}
                  width={playbackFlagWidth}
                  height={22}
                  rx={4}
                  fill={chartPalette.danger}
                />
                <text
                  x={playbackFlagTextX}
                  y={21}
                  fill={chartPalette.white}
                  className="ui-gantt-chart-flag-label"
                  textAnchor="middle"
                >
                  {formatMinutes(currentMinute)}
                </text>
              </>
            ) : null}
          </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
    {mappingTask ? (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/55 px-4 py-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-code-mapping-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeCodeMapping();
          }
        }}
      >
        <div className="flex w-full max-w-lg flex-col overflow-hidden ui-panel-raised">
          <div className="border-b border-line px-5 py-4">
            <div className="text-[11px] ui-mono-label tracking-wide text-accent">Task Code</div>
            <h2 id="task-code-mapping-title" className="mt-1 truncate text-xl font-medium text-ink">
              {mappingTask.name || "Blank task"}
            </h2>
            <div className="mt-2 rounded border border-line bg-surface-sunken px-3 py-2 font-mono text-sm font-semibold text-ink">
              {mappingPreviewCode || "Uncoded"}
            </div>
            {mappingDuplicateTask ? (
              <div className="mt-2 rounded border border-danger/25 bg-danger-muted px-3 py-2 text-xs font-semibold text-danger">
                Duplicate code already used by {mappingDuplicateTask.name || "another task"}.
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 p-5">
            <label className="block">
              <span className="ui-field-label">Zone</span>
              <ThemedSelect
                className="w-full"
                value={mappingDraft.zoneId}
                ariaLabel="Zone"
                onChange={(zoneId) => {
                  const taskNumber = mappingDraft.componentId
                    ? nextTaskNumberForComponent(tasks, mappingDraft.componentId, zoneId || undefined)
                    : undefined;
                  setMappingDraft((current) => ({
                    ...current,
                    zoneId,
                    taskNumber: current.taskNumber || (taskNumber ? String(taskNumber) : ""),
                  }));
                }}
                options={[
                  { value: "", label: "Unzoned" },
                  ...zones.map((zone) => ({
                    value: zone.id,
                    label: `${zone.code || zone.name} - ${zone.name}`,
                  })),
                ]}
              />
            </label>

            <label className="block">
              <span className="ui-field-label">Component</span>
              <ThemedSelect
                className="w-full"
                value={mappingDraft.componentId}
                ariaLabel="Component"
                onChange={(componentId) => {
                  const taskNumber = componentId
                    ? nextTaskNumberForComponent(tasks, componentId, mappingDraft.zoneId || undefined)
                    : undefined;
                  setMappingDraft((current) => ({
                    ...current,
                    componentId,
                    taskNumber: componentId ? String(taskNumber ?? current.taskNumber) : "",
                  }));
                }}
                options={[
                  { value: "", label: "No component" },
                  ...mappingComponentOptions.map((component) => ({
                    value: component.id,
                    label: `${component.code || "CODE"} - ${component.name || "Unnamed component"}`,
                  })),
                ]}
              />
            </label>

            <label className="block">
              <span className="ui-field-label">Task Number</span>
              <input
                className="h-10 w-full rounded border border-line bg-surface px-3 font-mono text-sm font-semibold text-ink outline-none"
                type="number"
                min={0}
                step={1}
                value={mappingDraft.taskNumber}
                onChange={(event) => setMappingDraft((current) => ({ ...current, taskNumber: event.target.value }))}
                placeholder="10"
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={mappingDraft.codeLocked}
                onChange={(event) => setMappingDraft((current) => ({ ...current, codeLocked: event.target.checked }))}
              />
              Lock code after save
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface-muted px-5 py-4">
            <button
              type="button"
              onClick={closeCodeMapping}
              className="inline-flex h-10 min-w-28 items-center justify-center ui-panel px-4 text-sm font-medium text-ink transition hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveCodeMapping}
              disabled={Boolean(mappingDuplicateTask)}
              className="ui-btn-primary h-9 min-w-32 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save Code
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {predecessorPickerTask ? (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/55 px-4 py-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="predecessor-picker-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closePredecessorPicker();
          }
        }}
      >
        <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden ui-panel-raised">
          <div className="border-b border-line px-5 py-4">
            <div className="text-[11px] ui-mono-label tracking-wide text-accent">Predecessor Picker</div>
            <h2 id="predecessor-picker-title" className="mt-1 text-xl font-medium text-ink">
              Predecessors for {taskDisplayCode(predecessorPickerTask)} {predecessorPickerTask.name || "Blank task"}
            </h2>
            <p className="mt-1 text-sm font-semibold text-ink-secondary">
              This task will start after all selected predecessor tasks are complete.
            </p>
          </div>

          <div className="min-h-0 overflow-auto p-4">
            <div className="min-w-[900px] overflow-hidden ui-panel">
              <div className="grid grid-cols-[48px_128px_minmax(260px,1fr)_150px_104px_104px] items-center gap-3 border-b border-line bg-surface-sunken px-3 py-3 ui-mono-label">
                <span aria-hidden="true" />
                <span>Code</span>
                <span>Task name</span>
                <span>Zone</span>
                <span>Finish</span>
                <span>State</span>
              </div>
              {predecessorCandidates.length > 0 ? (
                predecessorCandidates.map((candidate) => {
                  const state = getPredecessorCandidateState(candidate);
                  const selected = predecessorDraftIds.has(candidate.id);
                  const invalid = state === "invalid";
                  const candidateWindow = getTaskWindow(candidate, bounds.startMs);
                  const candidateZone = getTaskZone(candidate);

                  return (
                    <label
                      key={candidate.id}
                      className={`grid grid-cols-[48px_128px_minmax(260px,1fr)_150px_104px_104px] items-center gap-3 border-b border-line px-3 py-3 text-sm last:border-b-0 ${
                        invalid ? "cursor-not-allowed bg-danger-muted/45 text-ink-secondary" : "cursor-pointer bg-surface hover:bg-accent-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 justify-self-center accent-accent"
                        checked={selected}
                        disabled={invalid}
                        onChange={() => togglePredecessorDraft(candidate.id)}
                        aria-label={`Select ${taskDisplayCode(candidate)} as predecessor`}
                      />
                      <span className="font-mono text-xs font-medium text-ink">{taskDisplayCode(candidate)}</span>
                      <span className="min-w-0 truncate font-bold text-ink" title={candidate.name}>
                        {candidate.name || "Blank task"}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: candidateZone?.stroke ?? UNZONED_COLOR }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate text-xs ui-mono-label tracking-wide text-ink-secondary" title={candidateZone?.name ?? "Unzoned"}>
                          {candidateZone?.name ?? "Unzoned"}
                        </span>
                      </span>
                      <span className="font-mono text-xs font-medium text-ink-secondary">
                        {formatRelativeHours(candidateWindow.finishMinute)}
                      </span>
                      <span
                        className={`inline-flex w-fit rounded px-2 py-1 text-[10px] ui-mono-label tracking-wide ${
                          state === "selected"
                            ? "bg-accent-muted text-accent"
                            : state === "invalid"
                              ? "bg-danger-muted text-danger"
                              : "bg-surface-sunken text-ink-secondary"
                        }`}
                      >
                        {state}
                      </span>
                    </label>
                  );
                })
              ) : (
                <div className="px-4 py-10 text-center ui-section-subtitle text-ink-tertiary">No tasks are available yet.</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface-muted px-5 py-4">
            <button
              type="button"
              onClick={closePredecessorPicker}
              className="inline-flex h-10 min-w-32 items-center justify-center ui-panel px-4 text-sm font-medium text-ink transition hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={savePredecessors}
              className="ui-btn-primary h-9 min-w-44"
            >
              Save predecessors
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
