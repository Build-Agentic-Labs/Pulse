import { sumStepDurationMinutes } from "./step-duration";
import type { Task } from "./types";

export const AWI_TASK_LINK_FIELD = "awiMasterLink";
/** Raised by every write path that would give a linked task its own procedure. The database guard uses the same text. */
export const LINKED_AWI_EDIT_MESSAGE = "Edit these instructions in the linked master AWI.";

export type AwiTaskLink = { masterId: string; projectId: string; taskId: string; documentNumber: string };
/** One awi_masters row as read for a set of links, with the master task when it could be loaded. */
export type LinkedAwiMaster = { projectId: string; taskId: string; source?: Task };

// Procedure content a linked task shows from its master and never owns itself.
const LINKED_PROCEDURE_FIELDS = ["stepToolLists", "stepPhotoAttachments", "stepPhotoAnnotations", "taskExplodedViews", "taskVideos"] as const;

export function awiTaskLink(task: Task): AwiTaskLink | undefined {
  const value = task.customFields?.[AWI_TASK_LINK_FIELD] as Partial<AwiTaskLink> | undefined;
  return value && typeof value.masterId === "string" && typeof value.projectId === "string" && typeof value.taskId === "string" && typeof value.documentNumber === "string" ? value as AwiTaskLink : undefined;
}

/** A Product task linked to a master AWI owns no procedure: its steps, parts, tools and media are the master's. */
export function taskOwnsProcedure(task: Task): boolean {
  return !awiTaskLink(task);
}

export function assertTaskOwnsProcedure(task: Task): void {
  if (!taskOwnsProcedure(task)) throw new Error(LINKED_AWI_EDIT_MESSAGE);
}

/** Tasks a step may be moved into: other plain task rows that own their procedure. */
export function stepMoveTargets(tasks: readonly Task[], sourceTaskId: string | undefined): Task[] {
  return tasks.filter((candidate) => candidate.rowType === "task" && candidate.id !== sourceTaskId && taskOwnsProcedure(candidate));
}

/** A linked task's planned time comes from its master: the sum of the master's step times, or its own duration when it has no steps. */
export function linkedAwiDurationMinutes(master: Task): number {
  const steps = master.manufacturingSteps ?? [];
  return steps.length > 0 ? sumStepDurationMinutes(steps) : Math.max(master.plannedDurationMinutes ?? 0, 0);
}

export function withLinkedAwiProcedure(task: Task, master: Task): Task {
  const fields = { ...task.customFields };
  for (const key of LINKED_PROCEDURE_FIELDS) {
    delete fields[key];
    if (master.customFields[key] !== undefined) fields[key] = master.customFields[key];
  }
  const plannedDurationMinutes = linkedAwiDurationMinutes(master);
  const startMs = Date.parse(task.plannedStart);
  const plannedFinish = Number.isFinite(startMs) ? new Date(startMs + plannedDurationMinutes * 60_000).toISOString() : task.plannedFinish;
  const planning = { ...task };
  delete planning.awiMasterStatus;
  return { ...planning, description: master.description, safetyNotes: master.safetyNotes, toolsRequired: master.toolsRequired,
    manufacturingSteps: master.manufacturingSteps, partReferences: master.partReferences, customFields: fields,
    plannedDurationMinutes, plannedFinish };
}

/** A linked task whose master could not be resolved: keep the link and the stored schedule, show no procedure. */
export function withUnavailableLinkedAwi(task: Task): Task {
  const fields = { ...task.customFields };
  for (const key of LINKED_PROCEDURE_FIELDS) delete fields[key];
  return { ...task, manufacturingSteps: [], partReferences: [], customFields: fields, awiMasterStatus: "unavailable" };
}

function usableMasterSource(task: Task, master: LinkedAwiMaster | undefined): Task | undefined {
  const link = awiTaskLink(task);
  if (!link || !master?.source) return undefined;
  if (master.taskId !== link.taskId || master.projectId !== link.projectId || master.taskId === task.id) return undefined;
  return awiTaskLink(master.source) ? undefined : master.source;
}

/** Load-time resolution: every linked task shows its master, or is marked unavailable. Plain tasks pass through. */
export function applyLinkedAwiMasters(tasks: readonly Task[], masters: ReadonlyMap<string, LinkedAwiMaster>): Task[] {
  return tasks.map((task) => {
    const link = awiTaskLink(task);
    if (!link) return task;
    const source = usableMasterSource(task, masters.get(link.masterId));
    return source ? withLinkedAwiProcedure(task, source) : withUnavailableLinkedAwi(task);
  });
}

// The content a link refresh owns: the master's procedure AND the time derived from it. Duration must be
// included: a master with no steps contributes only its own duration, so without it a late response could
// overwrite a fresher duration. Planning fields (name, operators, start, finish) are deliberately excluded so a
// planning edit during the refresh does not block it; linked durations are not user-editable (Task 4).
function linkedProcedureKey(task: Task): string {
  const media = LINKED_PROCEDURE_FIELDS.map((key) => task.customFields?.[key]);
  return JSON.stringify([task.manufacturingSteps, task.partReferences, task.description, task.safetyNotes, task.toolsRequired, media, task.plannedDurationMinutes]);
}

/**
 * Background refresh: replace a linked task only when a usable master changed it AND the task still shows the
 * procedure it showed when the refresh started (`startedFrom`). A task that is new since then (another
 * scenario or project) or whose procedure was replaced meanwhile (a fresher load won the race) is kept as is;
 * the next refresh will see it. A missing master keeps the current copy.
 */
export function refreshLinkedAwiTasks(
  tasks: Task[],
  masters: ReadonlyMap<string, LinkedAwiMaster>,
  startedFrom: readonly Task[],
): { tasks: Task[]; changed: boolean } {
  const baseline = new Map(startedFrom.map((task) => [task.id, linkedProcedureKey(task)]));
  let changed = false;
  const next = tasks.map((task) => {
    const link = awiTaskLink(task);
    const source = link ? usableMasterSource(task, masters.get(link.masterId)) : undefined;
    if (!source || baseline.get(task.id) !== linkedProcedureKey(task)) return task;
    const refreshed = withLinkedAwiProcedure(task, source);
    if (JSON.stringify(refreshed) === JSON.stringify(task)) return task;
    changed = true;
    return refreshed;
  });
  return { tasks: changed ? next : tasks, changed };
}
