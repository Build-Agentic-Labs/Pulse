import { describe, expect, it } from "vitest";
import { emptyPlannerState } from "./empty-planner-state";
import { createPlannerDerivation } from "./planner-derivation";
import { applyCalculatedFields, calculateProductKpis } from "./calculations";
import { normalizeTaskPlanningContext } from "./task-planning";
import { syncTaskOperatorCount } from "./operator-assignments";
import type { PlannerState, Task } from "./types";

function fixture(): PlannerState {
  const task: Task = {
    id: "t1", scenarioId: "scenario-empty", stationId: "s1", rowType: "task", wbs: "1", name: "Install",
    plannedStart: "2026-01-01T08:00:00Z", plannedFinish: "2026-01-01T09:00:00Z",
    plannedDurationMinutes: 60, plannedOperators: 1, plannedManHours: 1,
    status: "not_started", percentComplete: 0, dependencyIds: [], criticalPath: false,
    bottleneckFlag: false, qualityGate: false, travelerSignoffRequired: false,
    customFields: { operatorIds: ["A"] },
    manufacturingSteps: [{ id: "step1", sequence: 1, instruction: "Install bracket", durationMinutes: 60 }],
  };
  return { ...emptyPlannerState, tasks: [task, { ...task, id: "t2", wbs: "2" }] };
}

describe("planner derivation", () => {
  it("does not duplicate an existing Unzoned station when a derived state is derived again", () => {
    // What the workspace does on every edit: derive, then store the derived state (catalog writes,
    // optimistic updates), then derive that again.
    const unzoned = "station-scenario-empty-unzoned";
    const loaded = fixture();
    const saved: PlannerState = {
      ...loaded,
      stations: [{
        id: unzoned, scenarioId: "scenario-empty", sequence: 1, name: "Unzoned", ownerName: "",
        plannedCycleMinutes: 0, plannedOperators: 1, plannedManHours: 0, taktStatus: "missing", bottleneckFlag: false,
      }],
      tasks: loaded.tasks.map((task) => ({ ...task, stationId: unzoned })),
    };
    let state = saved;
    for (let round = 0; round < 3; round += 1) {
      state = createPlannerDerivation()(state).state;
      expect(state.stations.map((station) => station.id)).toEqual([unzoned]);
      expect(state.tasks.map((task) => task.stationId)).toEqual([unzoned, unzoned]);
    }
  });

  it("keeps planning calculations and unchanged rows stable while exposing fresh instruction text", () => {
    const derive = createPlannerDerivation();
    const initial = fixture();
    const before = derive(initial);
    const edited = { ...initial, tasks: initial.tasks.map((task, index) => index ? task : {
      ...task, manufacturingSteps: [{ ...task.manufacturingSteps![0], instruction: "Install two brackets" }],
    }) };
    const after = derive(edited);
    expect(after.planningTasks).toBe(before.planningTasks);
    expect(after.state.stations).toBe(before.state.stations);
    expect(after.state.product).toBe(before.state.product);
    expect(after.state.tasks[1]).toBe(before.state.tasks[1]);
    expect(after.state.tasks[0].manufacturingSteps?.[0].instruction).toBe("Install two brackets");
    expect(initial.tasks[0].manufacturingSteps?.[0].instruction).toBe("Install bracket");
  });

  it.each<Partial<Task>>([
    { plannedDurationMinutes: 120 }, { customFields: { operatorIds: ["A", "B"] } },
    { plannedStart: "2026-01-01T07:00:00Z" }, { wbs: "2.1", parentTaskId: "t2" },
    { zoneId: "new-zone" }, { name: "Renamed task" },
  ])("recalculates changed planning inputs without changing results: %j", (patch) => {
    const derive = createPlannerDerivation();
    const initial = fixture();
    const before = derive(initial);
    const updated = { ...initial, tasks: [{ ...initial.tasks[0], ...patch }, initial.tasks[1]] };
    const after = derive(updated);
    const context = normalizeTaskPlanningContext(updated.tasks, updated.zones, updated.stations, updated.scenario.id);
    const expected = applyCalculatedFields(updated.product, context.stations, context.tasks.map(syncTaskOperatorCount));
    expect(after.planningTasks).not.toBe(before.planningTasks);
    expect(after.state.tasks).toEqual(expected.tasks);
    expect(after.state.stations).toEqual(expected.stations);
    expect(calculateProductKpis(after.state.product, after.state.stations, after.planningTasks))
      .toEqual(calculateProductKpis(expected.product, expected.stations, expected.tasks));
  });

  it("reuses planning when linked-part text moves, while exposing current link positions", () => {
    const derive = createPlannerDerivation();
    const initial = fixture();
    const before = derive(initial);
    const links = { step1: [{ id: "mention", partReferenceId: "part", text: "bracket", start: 8, end: 15 }] };
    const edited = { ...initial, tasks: [{ ...initial.tasks[0], customFields: {
      ...initial.tasks[0].customFields, stepPartMentions: links,
    } }, initial.tasks[1]] };
    const after = derive(edited);
    expect(after.planningTasks).toBe(before.planningTasks);
    expect(after.state.tasks[0].customFields.stepPartMentions).toBe(links);
  });

  it("invalidates on project changes, reordered rows, and product configuration", () => {
    const derive = createPlannerDerivation();
    const initial = fixture();
    derive(initial);
    const reordered = derive({ ...initial, tasks: [...initial.tasks].reverse() });
    expect(reordered.state.tasks.map((task) => task.id)).toEqual(["t2", "t1"]);
    const changed = derive({ ...initial, product: { ...initial.product, grossAvailableMinutes: 480 } });
    expect(changed.state.product.netAvailableMinutes).toBe(480);
    expect(derive(emptyPlannerState).state.tasks).toEqual([]);
  });
});
