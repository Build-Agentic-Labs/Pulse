import type { HeaderCaptureTimerEntry } from "@/components/mobile-photo-portal/capture-session";
import type { PlannerState } from "@/domain/types";
import { Menu, Plus, Trash2 } from "lucide-react";
import { Fragment, type FocusEvent } from "react";

import { taskDisplayCode } from "@/domain/nomenclature";
import { getStepPhotoAttachments } from "@/domain/step-photos";

import { countTaskStepTools } from "@/domain/step-tools";

import type { Task } from "@/domain/types";

import { NothingSpinner } from "@/components/nothing-ui";

import { ThemedSelect } from "@/components/themed-select";

export function MobileProcessList({
  errorMessage,
  showNewTaskForm,
  taskRows,
  zoneById,
  draggingTaskId,
  dragTargetTaskId,
  dragTargetPlacement,
  suppressProcessClickRef,
  processSwipeRef,
  setSwipedTaskId,
  swipedTaskId,
  selectTask,
  startTaskDrag,
  moveTaskDrag,
  finishTaskDrag,
  cancelTaskDrag,
  saveState,
  writesPending,
  headerCaptureTimers,
  requestDeleteProcess,
  dragPreview,
  revealNewProcessForm,
  mobileHeaderHeight,
  newTaskName,
  handleMobileFieldFocus,
  setNewTaskName,
  addHighLevelTask,
  newTaskZoneId,
  derivedState,
  setNewTaskZoneId,
  newTaskComponentId,
  setNewTaskComponentId,
  setShowNewTaskForm,
}: {
  errorMessage: string | null;
  showNewTaskForm: boolean;
  taskRows: Task[];
  zoneById: Map<string, string>;
  draggingTaskId: string | null;
  dragTargetTaskId: string | null;
  dragTargetPlacement: "before" | "after";
  suppressProcessClickRef: React.RefObject<boolean>;
  processSwipeRef: React.RefObject<{
    x: number;
    y: number;
    horizontal: boolean;
  } | null>;
  setSwipedTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  swipedTaskId: string | null;
  selectTask: (taskId: string) => void;
  startTaskDrag: (
    event: React.PointerEvent<HTMLButtonElement>,
    taskId: string,
  ) => void;
  moveTaskDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  finishTaskDrag: () => void;
  cancelTaskDrag: () => void;
  saveState: "loading" | "idle" | "saving" | "saved" | "error";
  writesPending: boolean;
  headerCaptureTimers: HeaderCaptureTimerEntry[];
  requestDeleteProcess: (task: Task) => void;
  dragPreview: { x: number; y: number; width: number } | null;
  revealNewProcessForm: (node: HTMLDivElement | null) => void;
  mobileHeaderHeight: number;
  newTaskName: string;
  handleMobileFieldFocus: (
    event: React.FocusEvent<HTMLElement, Element>,
  ) => void;
  setNewTaskName: React.Dispatch<React.SetStateAction<string>>;
  addHighLevelTask: () => Promise<void>;
  newTaskZoneId: string;
  derivedState: PlannerState | null;
  setNewTaskZoneId: React.Dispatch<React.SetStateAction<string>>;
  newTaskComponentId: string;
  setNewTaskComponentId: React.Dispatch<React.SetStateAction<string>>;
  setShowNewTaskForm: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <section className="min-w-0 ui-panel">
      {errorMessage && !showNewTaskForm ? (
        <div className="m-3 rounded border border-danger/30 bg-danger-muted px-3 py-2 ui-photo-mobile-caption text-danger">
          {errorMessage}
        </div>
      ) : null}

      <div>
        {taskRows.map((task, index) => {
          const stepCount = task.manufacturingSteps?.length ?? 0;
          const zoneName = task.zoneId ? zoneById.get(task.zoneId) : undefined;
          const zoneLabel = zoneName ?? "No zone";
          const previousTask = taskRows[index - 1];
          const previousZoneName = previousTask?.zoneId
            ? zoneById.get(previousTask.zoneId)
            : undefined;
          const previousZoneLabel = previousTask
            ? (previousZoneName ?? "No zone")
            : "";
          const showZoneDivider =
            index === 0 || previousZoneLabel !== zoneLabel;
          const photoCount = (task.manufacturingSteps ?? []).reduce(
            (total, step) =>
              total + getStepPhotoAttachments(task, step.id).length,
            0,
          );
          const toolCount = countTaskStepTools(task);
          const showDropBefore =
            Boolean(draggingTaskId) &&
            dragTargetTaskId === task.id &&
            dragTargetPlacement === "before";
          const showDropAfter =
            Boolean(draggingTaskId) &&
            dragTargetTaskId === task.id &&
            dragTargetPlacement === "after";

          return (
            <Fragment key={task.id}>
              {showZoneDivider ? (
                <div
                  className={`flex items-center gap-2 bg-surface-raised px-3 py-2 ${
                    index === 0 ? "" : "border-t-2 border-accent/35"
                  }`}
                >
                  <div className="h-px flex-1 bg-line" />
                  <div className="shrink-0 ui-mono-label">{zoneLabel}</div>
                  <div className="h-px flex-1 bg-line" />
                </div>
              ) : null}
              {showDropBefore ? (
                <div
                  data-mobile-task-id={task.id}
                  data-drop-placement="before"
                  className="mx-3 my-1 h-14 ui-panel-sunken transition-all duration-200"
                />
              ) : null}
              <div
                data-mobile-task-id={task.id}
                className={`relative flex border-b border-line bg-surface transition-all duration-200 ease-out last:border-b-0 ${
                  draggingTaskId === task.id ? "opacity-35" : ""
                }`}
              >
                <button
                  type="button"
                  onPointerDown={(event) => {
                    suppressProcessClickRef.current = false;
                    processSwipeRef.current = {
                      x: event.clientX,
                      y: event.clientY,
                      horizontal: false,
                    };
                  }}
                  onPointerMove={(event) => {
                    const swipe = processSwipeRef.current;
                    if (!swipe) return;
                    const dx = event.clientX - swipe.x;
                    const dy = event.clientY - swipe.y;
                    if (
                      Math.abs(dx) > 40 &&
                      Math.abs(dx) > Math.abs(dy) * 1.5
                    ) {
                      swipe.horizontal = true;
                      suppressProcessClickRef.current = true;
                      setSwipedTaskId(dx < 0 ? task.id : null);
                    }
                  }}
                  onPointerUp={() => {
                    processSwipeRef.current = null;
                  }}
                  onPointerCancel={() => {
                    processSwipeRef.current = null;
                  }}
                  style={{ touchAction: "pan-y" }}
                  onClick={() => {
                    if (suppressProcessClickRef.current) {
                      suppressProcessClickRef.current = false;
                      return;
                    }
                    if (swipedTaskId === task.id) {
                      setSwipedTaskId(null);
                      return;
                    }
                    selectTask(task.id);
                  }}
                  className="block min-w-0 flex-1 bg-surface px-3 py-3 text-left transition active:bg-surface-active"
                >
                  <div className="flex items-start gap-3">
                    <div className="ui-photo-mobile-wbs-chip mt-0.5">
                      {taskDisplayCode(task)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="ui-photo-mobile-body">{task.name}</div>
                      <div className="ui-photo-mobile-meta mt-1 flex flex-wrap items-center gap-2">
                        <span>
                          {stepCount} {stepCount === 1 ? "step" : "steps"}
                        </span>
                        <span>
                          {photoCount} {photoCount === 1 ? "photo" : "photos"}
                        </span>
                        <span>
                          {toolCount} {toolCount === 1 ? "tool" : "tools"}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => startTaskDrag(event, task.id)}
                  onPointerMove={moveTaskDrag}
                  onPointerUp={finishTaskDrag}
                  onPointerCancel={cancelTaskDrag}
                  disabled={saveState === "saving"}
                  className="flex w-11 shrink-0 touch-none items-center justify-center bg-surface text-steel active:bg-surface-active disabled:opacity-35"
                  aria-label={`Drag ${task.name} to reorder`}
                  title={`Drag ${task.name} to reorder`}
                >
                  <Menu size={18} strokeWidth={2.4} />
                </button>
                {swipedTaskId === task.id ? (
                  <button
                    type="button"
                    className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 bg-danger text-canvas"
                    aria-label={`Delete ${task.name}`}
                    disabled={
                      writesPending ||
                      headerCaptureTimers.some(
                        (entry) => entry.taskId === task.id,
                      )
                    }
                    onClick={() => requestDeleteProcess(task)}
                  >
                    <Trash2 size={18} />
                    <span className="text-sm">Delete</span>
                  </button>
                ) : null}
              </div>
              {showDropAfter ? (
                <div
                  data-mobile-task-id={task.id}
                  data-drop-placement="after"
                  className="mx-3 my-1 h-14 ui-panel-sunken transition-all duration-200"
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
      {draggingTaskId && dragPreview
        ? (() => {
            const draggingTask = taskRows.find(
              (task) => task.id === draggingTaskId,
            );
            if (!draggingTask) {
              return null;
            }

            const draggingStepCount =
              draggingTask.manufacturingSteps?.length ?? 0;
            const draggingPhotoCount = (
              draggingTask.manufacturingSteps ?? []
            ).reduce(
              (total, step) =>
                total + getStepPhotoAttachments(draggingTask, step.id).length,
              0,
            );
            const draggingToolCount = countTaskStepTools(draggingTask);

            return (
              <div
                className="pointer-events-none fixed z-50 flex ui-panel ring-1 ring-black/5"
                style={{
                  left: dragPreview.x,
                  top: dragPreview.y,
                  width: Math.min(dragPreview.width, 520),
                  transform: "translate(-88%, -50%)",
                }}
              >
                <div className="block min-w-0 flex-1 px-3 py-3 text-left">
                  <div className="flex items-start gap-3">
                    <div className="ui-photo-mobile-wbs-chip ui-photo-mobile-wbs-chip-accent mt-0.5">
                      {taskDisplayCode(draggingTask)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate ui-photo-mobile-body">
                        {draggingTask.name}
                      </div>
                      <div className="ui-photo-mobile-meta mt-1 flex flex-wrap items-center gap-2">
                        <span>
                          {draggingStepCount}{" "}
                          {draggingStepCount === 1 ? "step" : "steps"}
                        </span>
                        <span>
                          {draggingPhotoCount}{" "}
                          {draggingPhotoCount === 1 ? "photo" : "photos"}
                        </span>
                        <span>
                          {draggingToolCount}{" "}
                          {draggingToolCount === 1 ? "tool" : "tools"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex w-11 shrink-0 items-center justify-center border-l border-line bg-surface-raised text-steel">
                  <Menu size={18} strokeWidth={2.4} />
                </div>
              </div>
            );
          })()
        : null}
      {showNewTaskForm ? (
        <div
          className="m-3 rounded border border-accent/35 bg-accent-muted p-3"
          ref={revealNewProcessForm}
          style={{ scrollMarginTop: mobileHeaderHeight + 12 }}
        >
          {errorMessage ? (
            <div
              role="alert"
              className="mb-3 ui-photo-mobile-caption text-danger"
            >
              {errorMessage}
            </div>
          ) : null}
          <label className="block">
            <span className="ui-field-label text-accent">New process</span>
            <input
              className="ui-photo-mobile-field h-11"
              value={newTaskName}
              onFocus={handleMobileFieldFocus}
              onChange={(event) => setNewTaskName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addHighLevelTask();
                }
              }}
              placeholder="Process name"
            />
          </label>
          <label className="mt-2 block">
            <span className="ui-field-label text-accent">Zone</span>
            <ThemedSelect
              className="w-full"
              triggerClassName="ui-photo-mobile-field h-11"
              value={newTaskZoneId}
              options={[
                { value: "", label: "No zone" },
                ...(derivedState?.zones.map((zone) => ({
                  value: zone.id,
                  label: zone.name,
                })) ?? []),
              ]}
              onChange={setNewTaskZoneId}
            />
          </label>
          <label className="mt-2 block">
            <span className="ui-field-label text-accent">Component</span>
            <ThemedSelect
              className="w-full"
              triggerClassName="ui-photo-mobile-field h-11"
              value={newTaskComponentId}
              options={[
                { value: "", label: "No component" },
                ...(derivedState?.components
                  .filter((component) => component.active)
                  .map((component) => ({
                    value: component.id,
                    label: `${component.code || "CODE"} - ${component.name || "Unnamed component"}`,
                  })) ?? []),
              ]}
              onChange={setNewTaskComponentId}
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setNewTaskName("");
                setNewTaskZoneId("");
                setNewTaskComponentId("");
                setShowNewTaskForm(false);
              }}
              className="ui-photo-mobile-btn-secondary h-10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void addHighLevelTask()}
              disabled={saveState === "saving"}
              className="ui-photo-mobile-btn-accent h-10 disabled:opacity-60"
            >
              {saveState === "saving" ? (
                <NothingSpinner inline />
              ) : (
                <Plus size={14} />
              )}
              Add process
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
