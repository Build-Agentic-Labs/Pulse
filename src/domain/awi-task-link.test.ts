import { describe, expect, it } from "vitest";
import { awiTaskLink, AWI_TASK_LINK_FIELD, withLinkedAwiProcedure } from "./awi-task-link";
import { emptyPlannerState } from "./empty-planner-state";
import { manufacturingStepRows, partReferenceRows, taskRow } from "@/lib/planner/row-mappers";
import type { Task } from "./types";
const base = {...emptyPlannerState.tasks[0], id:"product-task", customFields:{}, manufacturingSteps:[], partReferences:[], plannedDurationMinutes:30, plannedOperators:2} as Task;
const link = {masterId:"master", projectId:"master-project", taskId:"master-task", documentNumber:"AWI-0001"};
describe("master AWI task links", () => {
  it("keeps scheduling and the link while showing current master content", () => {
    const task = {...base, customFields:{[AWI_TASK_LINK_FIELD]:link}};
    const master = {...base, id:"master-task", description:"Current master", plannedDurationMinutes:90, customFields:{stepToolLists:{step1:["Wrench"]}}, manufacturingSteps:[{id:"step1", name:"Fit", sequence:1, instruction:"Fit the part", durationMinutes:5}]} as Task;
    const linked = withLinkedAwiProcedure(task, master);
    expect(linked.plannedDurationMinutes).toBe(30);
    expect(linked.plannedOperators).toBe(2);
    expect(linked.manufacturingSteps).toEqual(master.manufacturingSteps);
    expect(awiTaskLink(linked)).toEqual(link);
    expect(withLinkedAwiProcedure(linked, {...master, description:"Edited master"}).description).toBe("Edited master");
    expect(manufacturingStepRows([linked])).toEqual([]);
    expect(partReferenceRows([linked])).toEqual([]);
    expect(taskRow(linked).custom_fields).toHaveProperty(AWI_TASK_LINK_FIELD, link);
  });
  it("ignores incomplete references", () => {
    expect(awiTaskLink({...base, customFields:{[AWI_TASK_LINK_FIELD]:{masterId:"master"}}})).toBeUndefined();
  });
});
