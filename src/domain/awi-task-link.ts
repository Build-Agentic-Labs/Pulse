import type { Task } from "./types";
export const AWI_TASK_LINK_FIELD = "awiMasterLink";
export type AwiTaskLink = { masterId: string; projectId: string; taskId: string; documentNumber: string };
export function awiTaskLink(task: Task): AwiTaskLink | undefined {
  const value = task.customFields?.[AWI_TASK_LINK_FIELD] as Partial<AwiTaskLink> | undefined;
  return value && typeof value.masterId === "string" && typeof value.projectId === "string" && typeof value.taskId === "string" && typeof value.documentNumber === "string" ? value as AwiTaskLink : undefined;
}
export function withLinkedAwiProcedure(task: Task, master: Task): Task {
  const fields = {...task.customFields};
  for (const key of ["stepToolLists", "stepPhotoAttachments", "stepPhotoAnnotations", "taskExplodedViews", "taskVideos"]) {
    delete fields[key];
    if (master.customFields[key] !== undefined) fields[key] = master.customFields[key];
  }
  return {...task, description:master.description, safetyNotes:master.safetyNotes, toolsRequired:master.toolsRequired,
    manufacturingSteps:master.manufacturingSteps, partReferences:master.partReferences, customFields:fields};
}
