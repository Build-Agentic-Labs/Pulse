import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import { confirmedTaskOrder, mergeTaskOrder, rollbackTaskOrder, taskOrderPatch, taskReorderRequest } from "./task-reorder";

const tasks = [
  { id: "a", scenarioId: "s", wbs: "1", stationId: "station", name: "A", description: "Keep text", customFields: { tools: ["Wrench"] } },
  { id: "b", scenarioId: "s", wbs: "2", stationId: "station", name: "B", customFields: {} },
] as Task[];
const after = tasks.map((task) => ({ ...task, wbs: task.id === "a" ? "2" : "1" }));
const remote = tasks.map((task) => ({ ...taskOrderPatch(task), version: 4 }));
const request = () => taskReorderRequest("p", "s", "op", tasks, after, remote);

describe("atomic task reorder ownership", () => {
  it("uses fresh server versions while sending only order and placement", () => {
    expect(request()).toEqual({ p_project_id: "p", p_scenario_id: "s", p_operation_id: "op",
      p_expected_versions: { a: 4, b: 4 }, p_order: after.map(taskOrderPatch) });
    expect(request().p_order[0]).not.toHaveProperty("description");
    expect(tasks[0].wbs).toBe("1");
  });
  it.each([
    remote.slice(0, 1), [...remote, { ...remote[0], id: "new" }],
    [remote[0], remote[0]], [{ ...remote[0], wbs: "9" }, remote[1]],
    [{ ...remote[0], zone_id: "other" }, remote[1]],
    [{ ...remote[0], version: 0 }, remote[1]],
  ].map((rows) => ({ rows })))("refuses incomplete or changed remote baselines %#", ({ rows }) => {
    expect(() => taskReorderRequest("p", "s", "op", tasks, after, rows)).toThrow("Task reorder conflict");
  });
  it("refuses a foreign-scenario or duplicate target task", () => {
    expect(() => taskReorderRequest("p", "s", "op", tasks, [{ ...after[0], scenarioId: "other" }, after[1]], remote)).toThrow("Task reorder conflict");
    expect(() => taskReorderRequest("p", "s", "op", tasks, [after[0], after[0]], remote)).toThrow("Task reorder conflict");
  });
  it("merges confirmation without reverting text or children typed in flight", () => {
    const current = [{ ...after[0], description: "New text" }, after[1]];
    const rows = after.map((task) => ({ ...taskOrderPatch(task), version: 6 }));
    expect(mergeTaskOrder(current, rows)[0]).toEqual({ ...current[0], version: 6, zoneId: undefined });
    expect(mergeTaskOrder(current, rows)[0].customFields).toBe(current[0].customFields);
  });
  it("rolls back only ordering and preserves later edits and a newer reorder", () => {
    const current = [{ ...after[0], description: "New text" }, { ...after[1], wbs: "9" }];
    const result = rollbackTaskOrder(current, tasks, after);
    expect(result[0]).toEqual({ ...tasks[0], description: "New text" });
    expect(result[1]).toBe(current[1]);
  });
  it("does not apply an acknowledgment older than a task's current server version", () => {
    const current = [{ ...after[0], version: 10 }, after[1]];
    expect(mergeTaskOrder(current, remote)[0]).toBe(current[0]);
  });
  it.each([
    null, {}, { operation_id: "other", scenario_id: "s", tasks: remote },
    { operation_id: "op", scenario_id: "other", tasks: remote },
    { operation_id: "op", scenario_id: "s", tasks: remote.slice(0, 1) },
    { operation_id: "op", scenario_id: "s", tasks: [remote[0], remote[0]] },
    { operation_id: "op", scenario_id: "s", tasks: [{ ...remote[0], wbs: "~reorder~park" }, remote[1]] },
  ])("does not confirm a malformed response %#", (data) => {
    expect(() => confirmedTaskOrder(data, request())).toThrow("Unable to confirm");
  });
  it("allows a duplicate acknowledgment to return a newer committed order", () => {
    expect(confirmedTaskOrder({ operation_id: "op", scenario_id: "s", tasks: remote }, request())).toEqual(remote);
  });
});
