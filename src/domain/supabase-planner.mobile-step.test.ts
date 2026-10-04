import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveMobileStepToSupabase } from "./supabase-planner";
import type { ManufacturingStep, Task } from "./types";

const step: ManufacturingStep = { id: "s", sequence: 1, name: "Phone name", instruction: "Phone instruction", durationMinutes: 5 };
const task = { id: "t", scenarioId: "scenario", manufacturingSteps: [step] } as Task;
function fixture({ parent = true, project = "p", collision = false, offline = false } = {}) {
  const writes: { table: string; op: string; value: Record<string, unknown>; options?: unknown }[] = [];
  let storedParent = parent;
  const rows: Record<string, unknown>[] = [{ id: "other", task_id: "t", sequence: 1, name: "Desktop step", instruction: "Keep", duration_minutes: 3 }];
  if (parent) rows.push({ id: "s", task_id: "t", sequence: 2, name: "Old name", instruction: "Desktop instruction", duration_minutes: 5, version: 9 });
  class Query {
    private op = "select";
    private filters: Record<string, unknown> = {};
    private value: Record<string, unknown> = {};
    constructor(private table: string) {}
    select() { return this; }
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    update(value: Record<string, unknown>) { this.op = "update"; this.value = value; writes.push({ table: this.table, op: this.op, value }); return this; }
    upsert(value: Record<string, unknown>, options: unknown) { this.op = "upsert"; this.value = value; writes.push({ table: this.table, op: this.op, value, options }); return this; }
    insert(value: Record<string, unknown>) { this.op = "insert"; this.value = value; writes.push({ table: this.table, op: this.op, value }); return this; }
    result() {
      if (offline && this.op !== "select") return { data: null, error: new Error("offline") };
      if (this.table === "tasks") {
        if (this.op === "upsert") storedParent = true;
        return { data: storedParent ? { id: "t" } : null, error: null };
      }
      if (this.op === "insert") {
        if (collision) { collision = false; rows.push({ id: "remote-new", sequence: 2, duration_minutes: 2 }); return { data: null, error: { code: "23505" } }; }
        rows.push({ ...this.value, version: 1 });
        return { data: rows.at(-1), error: null };
      }
      if (this.op === "update") {
        const row = rows.find((row) => row.id === this.filters.id);
        Object.assign(row!, this.value);
        return { data: row, error: null };
      }
      return { data: rows, error: null };
    }
    maybeSingle() { return Promise.resolve(this.result()); }
    then(resolve: (value: unknown) => unknown) { return Promise.resolve(this.result()).then(resolve); }
  }
  const client = { from: (table: string) => new Query(table), rpc: () => Promise.resolve({ data: project, error: null }) } as unknown as SupabaseClient;
  return { client, rows, writes };
}
describe("mobile step persistence", () => {
  it("does not write after an account changes during the prerequisite reads", async () => {
    const f = fixture();
    let checks = 0;
    await expect(saveMobileStepToSupabase(task, step, { name: step.name }, "p", f.client, () => {
      if (++checks > 1) throw new Error("account changed");
    })).rejects.toThrow("account changed");
    expect(f.writes).toEqual([]);
  });

  it("retains an already saved step but refuses a later duration update after an account change", async () => {
    const f = fixture();
    await expect(saveMobileStepToSupabase(task, step, { name: step.name, durationMinutes: 5 }, "p", f.client, () => {
      if (f.writes.length) throw new Error("account changed");
    })).rejects.toThrow("account changed");
    expect(f.writes).toEqual([{ table: "manufacturing_steps", op: "update", value: { name: step.name, duration_minutes: 5 } }]);
  });
  it("edits only the phone field, retaining desktop instruction and other steps", async () => {
    const f = fixture();
    const saved = await saveMobileStepToSupabase(task, step, { name: step.name }, "p", f.client);
    expect(saved.instruction).toBe("Desktop instruction");
    expect(f.writes).toEqual([{ table: "manufacturing_steps", op: "update", value: { name: "Phone name" } }]);
    expect(f.rows[0].name).toBe("Desktop step");
  });
  it("creates an unsaved parent before a child and retries a concurrent sequence insertion", async () => {
    const f = fixture({ parent: false, collision: true });
    const saved = await saveMobileStepToSupabase(task, step, { name: step.name, durationMinutes: 5 }, "p", f.client);
    expect(f.writes[0]).toMatchObject({ table: "tasks", op: "upsert", options: { ignoreDuplicates: true } });
    expect(saved.sequence).toBe(3);
    expect(f.writes.at(-1)).toMatchObject({ table: "tasks", value: { planned_duration_minutes: 10 } });
  });
  it("does not recreate a deleted saved process", async () => {
    const f = fixture({ parent: false });
    await expect(saveMobileStepToSupabase({ ...task, version: 2 }, step, { name: step.name }, "p", f.client)).rejects.toThrow("no longer available");
    expect(f.writes).toEqual([]);
  });
  it("keeps project membership checks and reports a failed write", async () => {
    const f = fixture({ project: "other" });
    await expect(saveMobileStepToSupabase(task, step, { name: step.name }, "p", f.client)).rejects.toThrow("active workspace");
    expect(f.writes).toEqual([]);
    const failed = fixture({ offline: true });
    await expect(saveMobileStepToSupabase(task, step, { name: step.name }, "p", failed.client)).rejects.toThrow("offline");
  });
});
