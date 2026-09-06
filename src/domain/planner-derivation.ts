import { applyCalculatedFields } from "./calculations";
import { syncTaskOperatorCount } from "./operator-assignments";
import { normalizeTaskPlanningContext } from "./task-planning";
import { STEP_PART_MENTIONS_FIELD } from "./step-part-mentions";
import type { PlannerState, Task } from "./types";

// Step content is authoritative in state.tasks, but does not enter scheduling
// calculations. Duration edits separately update plannedDurationMinutes.
function samePlanningTask(left: Task, right: Task) {
  if (left === right) return true;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  keys.delete("manufacturingSteps");
  return [...keys].every((key) => {
    if (key !== "customFields") return Object.is(left[key as keyof Task], right[key as keyof Task]);
    if (left.customFields === right.customFields) return true;
    const fields = new Set([...Object.keys(left.customFields), ...Object.keys(right.customFields)]);
    fields.delete(STEP_PART_MENTIONS_FIELD);
    return [...fields].every((field) => Object.is(left.customFields[field], right.customFields[field]));
  });
}

/** Per-workspace memoization; never share a user's planner cache on the server. */
export function createPlannerDerivation() {
  let previous: PlannerState | undefined;
  let calculated: ReturnType<typeof applyCalculatedFields> | undefined;
  let previousTasks: Task[] = [];

  return (state: PlannerState) => {
    const reusePlan = previous && calculated &&
      previous.product === state.product && previous.stations === state.stations &&
      previous.zones === state.zones && previous.scenario.id === state.scenario.id &&
      previous.tasks.length === state.tasks.length &&
      state.tasks.every((task, index) => samePlanningTask(task, previous!.tasks[index]));

    if (!reusePlan) {
      const context = normalizeTaskPlanningContext(state.tasks, state.zones, state.stations, state.scenario.id);
      calculated = applyCalculatedFields(state.product, context.stations, context.tasks.map(syncTaskOperatorCount));
    }
    const plan = calculated!;
    const tasks = state.tasks.map((task, index) => {
      if (reusePlan && task === previous!.tasks[index]) return previousTasks[index];
      return { ...plan.tasks[index], manufacturingSteps: task.manufacturingSteps, customFields: task.customFields };
    });
    previous = state;
    previousTasks = tasks;
    return {
      state: { ...state, product: plan.product, stations: plan.stations, tasks },
      // Calculation-only snapshot. UI and saving must always use state.tasks.
      planningTasks: plan.tasks,
    };
  };
}
