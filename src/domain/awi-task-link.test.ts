import { describe, expect, it } from "vitest";
import {
  applyLinkedAwiMasters, assertTaskOwnsProcedure, awiTaskLink, AWI_TASK_LINK_FIELD, LINKED_AWI_EDIT_MESSAGE,
  linkedAwiDurationMinutes, refreshLinkedAwiTasks, stepMoveTargets, taskOwnsProcedure, withLinkedAwiProcedure,
  withUnavailableLinkedAwi, type LinkedAwiMaster,
} from "./awi-task-link";
import { emptyPlannerState } from "./empty-planner-state";
import { manufacturingStepRows, partReferenceRows, taskRow } from "@/lib/planner/row-mappers";
import type { ManufacturingStep, Task } from "./types";

const START = "2026-10-01T08:00:00.000Z";
const base = { ...emptyPlannerState.tasks[0], id: "product-task", rowType: "task", plannedStart: START, plannedFinish: START,
  customFields: {}, manufacturingSteps: [], partReferences: [], plannedDurationMinutes: 30, plannedOperators: 2 } as Task;
const link = { masterId: "master", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-0001" };
const fitStep = { id: "step1", name: "Fit", sequence: 1, instruction: "Fit the part", durationMinutes: 5 } as ManufacturingStep;
const linkedTask = { ...base, customFields: { [AWI_TASK_LINK_FIELD]: link } } as Task;
const master = { ...base, id: "master-task", description: "Current master", plannedDurationMinutes: 90,
  customFields: { stepToolLists: { step1: ["Wrench"] } }, manufacturingSteps: [fitStep] } as Task;
const masters = (source?: Task): Map<string, LinkedAwiMaster> =>
  new Map([["master", { projectId: "master-project", taskId: "master-task", source }]]);

describe("master AWI task links", () => {
  it("keeps the link and operators while showing the current master content", () => {
    const linked = withLinkedAwiProcedure(linkedTask, master);
    expect(linked.plannedOperators).toBe(2);
    expect(linked.manufacturingSteps).toEqual(master.manufacturingSteps);
    expect(awiTaskLink(linked)).toEqual(link);
    expect(withLinkedAwiProcedure(linked, { ...master, description: "Edited master" }).description).toBe("Edited master");
    expect(manufacturingStepRows([linked])).toEqual([]);
    expect(partReferenceRows([linked])).toEqual([]);
    expect(taskRow(linked).custom_fields).toHaveProperty(AWI_TASK_LINK_FIELD, link);
  });

  it("takes the task's time from the master's steps and moves the finish with it", () => {
    const linked = withLinkedAwiProcedure(linkedTask, master);
    expect(linked.plannedDurationMinutes).toBe(5);
    expect(linked.plannedFinish).toBe("2026-10-01T08:05:00.000Z");
    expect(taskRow(linked).planned_duration_minutes).toBe(5);
  });

  it("replaces only procedure fields, clears stale media and runtime status, and preserves planning", () => {
    const media = { stepToolLists: ["tool"], stepPhotoAttachments: ["photo"], stepPhotoAnnotations: ["annotation"], taskExplodedViews: ["view"], taskVideos: ["video"] };
    const task: Task = { ...linkedTask, awiMasterStatus: "unavailable", name: "Product operation", customFields: { ...linkedTask.customFields, ...media, planningNote: "Keep" } };
    const source: Task = { ...master, safetyNotes: "Wear gloves", toolsRequired: ["Wrench"], partReferences: [{ id: "p", partNumber: "PART-1" }], customFields: { ...media, planningNote: "Ignore" } };
    const linked = withLinkedAwiProcedure(task, source);
    expect(linked).toMatchObject({ name: task.name, plannedStart: START, description: source.description, safetyNotes: source.safetyNotes, toolsRequired: source.toolsRequired, partReferences: source.partReferences });
    expect(linked.customFields).toEqual({ ...task.customFields, ...media });
    expect(linked).not.toHaveProperty("awiMasterStatus");
    expect(taskRow(task)).not.toHaveProperty("awiMasterStatus");
    expect(taskRow(task)).not.toHaveProperty("awi_master_status");
    expect(manufacturingStepRows([linked])).toEqual([]);
    expect(partReferenceRows([linked])).toEqual([]);
    const cleared = withLinkedAwiProcedure(linked, { ...master, customFields: {} });
    expect(cleared.customFields).toEqual({ [AWI_TASK_LINK_FIELD]: link, planningNote: "Keep" });
    expect(task.awiMasterStatus).toBe("unavailable");
  });

  it("falls back to the master's own duration only when the master has no steps", () => {
    expect(linkedAwiDurationMinutes({ ...master, manufacturingSteps: [] })).toBe(90);
    expect(linkedAwiDurationMinutes(master)).toBe(5);
    expect(linkedAwiDurationMinutes({ ...master, manufacturingSteps: undefined, plannedDurationMinutes: -10 })).toBe(0);
  });

  it("ignores incomplete references", () => {
    expect(awiTaskLink({ ...base, customFields: { [AWI_TASK_LINK_FIELD]: { masterId: "master" } } })).toBeUndefined();
  });
});

describe("a linked task owns no procedure", () => {
  it("refuses procedure writes with the shared message", () => {
    expect(taskOwnsProcedure(base)).toBe(true);
    expect(taskOwnsProcedure(linkedTask)).toBe(false);
    expect(() => assertTaskOwnsProcedure(linkedTask)).toThrow(LINKED_AWI_EDIT_MESSAGE);
    expect(() => assertTaskOwnsProcedure(base)).not.toThrow();
    expect(LINKED_AWI_EDIT_MESSAGE).toBe("Edit these instructions in the linked master AWI.");
  });

  it("offers only other plain tasks as step-move targets", () => {
    const other = { ...base, id: "other" } as Task;
    const milestone = { ...base, id: "milestone", rowType: "milestone" } as Task;
    const linkedOther = { ...linkedTask, id: "linked-other" } as Task;
    expect(stepMoveTargets([base, other, milestone, linkedOther], base.id).map((task) => task.id)).toEqual(["other"]);
  });
});

describe("resolving and refreshing links", () => {
  it("marks a task unavailable, keeping its link and stored schedule, when its master cannot be used", () => {
    const [unavailable] = applyLinkedAwiMasters([{ ...linkedTask, manufacturingSteps: [fitStep] }], new Map());
    expect(unavailable.awiMasterStatus).toBe("unavailable");
    expect(awiTaskLink(unavailable)).toEqual(link);
    expect(unavailable.plannedDurationMinutes).toBe(30);
    expect(unavailable.manufacturingSteps).toEqual([]);
    expect(withUnavailableLinkedAwi(linkedTask).partReferences).toEqual([]);
    const stale: Task = { ...linkedTask, customFields: { ...linkedTask.customFields, stepToolLists: {}, stepPhotoAttachments: {}, stepPhotoAnnotations: {}, taskExplodedViews: [], taskVideos: [], planningNote: "Keep" } };
    expect(withUnavailableLinkedAwi(stale).customFields).toEqual({ [AWI_TASK_LINK_FIELD]: link, planningNote: "Keep" });
    expect(unavailable.plannedFinish).toBe(linkedTask.plannedFinish);
  });

  it("rejects a master row that does not match the link, a self-link, or a chained master", () => {
    const wrongTask = new Map([["master", { projectId: "master-project", taskId: "other-task", source: master }]]);
    const chained = masters({ ...master, customFields: { [AWI_TASK_LINK_FIELD]: link } } as Task);
    const selfLinked = { ...linkedTask, id: "master-task" } as Task;
    expect(applyLinkedAwiMasters([linkedTask], wrongTask)[0].awiMasterStatus).toBe("unavailable");
    expect(applyLinkedAwiMasters([linkedTask], chained)[0].awiMasterStatus).toBe("unavailable");
    expect(applyLinkedAwiMasters([selfLinked], masters(master))[0].awiMasterStatus).toBe("unavailable");
    const wrongProject = new Map([["master", { projectId: "other-project", taskId: "master-task", source: master }]]);
    expect(applyLinkedAwiMasters([linkedTask], wrongProject)[0].awiMasterStatus).toBe("unavailable");
  });

  it("resolves usable links and leaves plain tasks untouched", () => {
    const [resolved, plain] = applyLinkedAwiMasters([linkedTask, base], masters(master));
    expect(resolved.manufacturingSteps).toEqual([fitStep]);
    expect(resolved.awiMasterStatus).toBeUndefined();
    expect(plain).toBe(base);
  });

  const longer = { ...master, manufacturingSteps: [fitStep, { ...fitStep, id: "step2", sequence: 2, durationMinutes: 10 }] } as Task;

  it("refresh keeps the current copy when a master is missing, and reports no change when nothing moved", () => {
    const current = withLinkedAwiProcedure(linkedTask, master);
    const tasks = [current, base];
    const unchanged = refreshLinkedAwiTasks(tasks, masters(master), tasks);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.tasks).toBe(tasks);
    const missing = refreshLinkedAwiTasks([current], masters(undefined), [current]);
    expect(missing).toEqual({ tasks: [current], changed: false });
  });

  it("refresh replaces a linked task when its master changed, including the derived duration", () => {
    const current = withLinkedAwiProcedure(linkedTask, master);
    const refreshed = refreshLinkedAwiTasks([current], masters(longer), [current]);
    expect(refreshed.changed).toBe(true);
    expect(refreshed.tasks[0].plannedDurationMinutes).toBe(15);
    expect(refreshed.tasks[0].manufacturingSteps).toHaveLength(2);
  });

  it("refresh preserves planning edits made while the response was in flight", () => {
    const startedAs = withLinkedAwiProcedure(linkedTask, master);
    const current = { ...startedAs, name: "Renamed", plannedOperators: 3, plannedStart: "2026-10-01T09:00:00.000Z" };
    const refreshed = refreshLinkedAwiTasks([current], masters(longer), [startedAs]);
    expect(refreshed.tasks[0]).toMatchObject({ name: "Renamed", plannedOperators: 3, plannedStart: current.plannedStart, plannedFinish: "2026-10-01T09:15:00.000Z" });
  });

  it("refresh drops an older response when a fresher load replaced the task's procedure meanwhile", () => {
    const startedAs = withLinkedAwiProcedure(linkedTask, master);
    const fresher = withLinkedAwiProcedure(linkedTask, longer); // e.g. a realtime full reload landed first
    const stale = refreshLinkedAwiTasks([fresher], masters(master), [startedAs]);
    expect(stale).toEqual({ tasks: [fresher], changed: false });
  });

  it("refresh drops a late duration-only response from a master with no steps", () => {
    const noSteps = (plannedDurationMinutes: number) => ({ ...master, manufacturingSteps: [], plannedDurationMinutes }) as Task;
    const startedAs = withLinkedAwiProcedure(linkedTask, noSteps(5));
    const fresher = withLinkedAwiProcedure(linkedTask, noSteps(20)); // a fresher load already shows 20 minutes
    expect(fresher.plannedDurationMinutes).toBe(20);
    const late = refreshLinkedAwiTasks([fresher], masters(noSteps(5)), [startedAs]);
    expect(late).toEqual({ tasks: [fresher], changed: false });
  });

  it("refresh never touches tasks that were not on screen when it started (another scenario or project)", () => {
    const startedAs = withLinkedAwiProcedure(linkedTask, master);
    const otherScenarioTask = { ...withLinkedAwiProcedure(linkedTask, master), id: "other-scenario-task" } as Task;
    const result = refreshLinkedAwiTasks([otherScenarioTask], masters(longer), [startedAs]);
    expect(result).toEqual({ tasks: [otherScenarioTask], changed: false });
  });
});
