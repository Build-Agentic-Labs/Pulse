// A catalog rename / delete / tidy whose task save fails, followed by an unrelated edit that saves
// normally. Runs the REAL save functions against a small in-memory database, so the assertions are
// about what ends up stored (step_tools vs tool_library), not just about what was sent.
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { ProjectToolCatalogEntry } from "@/domain/project-catalog";
import { addStepTool, getStepToolList, STEP_TOOL_LISTS_FIELD } from "@/domain/step-tools";
import {
  savePlannerShellToSupabase,
  saveTasksToSupabase,
  upsertToolLibraryMetadata,
  type SaveState,
} from "@/domain/supabase-planner";
import { canonicalToolKey } from "@/domain/tool-name-format";
import type { PlannerState } from "@/domain/types";
import { WorkspaceWriteTracker } from "@/domain/workspace-save-status";
import { deferredPromise, procedureTestTask } from "./procedure-test-fixtures";
import { useWorkspaceTools } from "./use-workspace-tools";

vi.hoisted(() => {
  // Read once at module load; the client itself is the in-memory fake installed below.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
});

const PROJECT_ID = "project-tools";
type Row = Record<string, unknown>;
type Op = "select" | "upsert" | "update" | "delete";

function createInMemoryDatabase() {
  const tables = new Map<string, Row[]>();
  const holds: Array<{ table: string; op: Op; reached: () => void; gate: Promise<void> }> = [];
  const rows = (table: string) => tables.get(table) ?? [];

  class Query {
    private op: Op = "select";
    private payload: unknown;
    private filters: Array<(row: Row) => boolean> = [];
    private one = false;
    constructor(private readonly table: string) {}
    select() { return this; }
    upsert(payload: unknown) { this.op = "upsert"; this.payload = payload; return this; }
    update(payload: unknown) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => String(row[column]) === String(value)); return this; }
    in(column: string, values: unknown[]) {
      const allowed = new Set(values.map(String));
      this.filters.push((row) => allowed.has(String(row[column])));
      return this;
    }
    or() { return this; }
    order() { return this; }
    range() { return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    private async run() {
      const holdIndex = holds.findIndex((hold) => hold.table === this.table && hold.op === this.op);
      if (holdIndex >= 0) {
        const [hold] = holds.splice(holdIndex, 1);
        hold!.reached();
        await hold!.gate;
      }
      const matches = (row: Row) => this.filters.every((filter) => filter(row));
      let data: unknown = null;
      if (this.op === "select") {
        const found = rows(this.table).filter(matches);
        data = this.one ? found[0] ?? null : found;
      } else if (this.op === "upsert") {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const next = [...rows(this.table)];
        const saved = incoming.map((row) => {
          const index = next.findIndex((existing) => existing.id === row.id);
          const merged = { ...(index >= 0 ? next[index] : {}), ...row };
          if (index >= 0) next[index] = merged; else next.push(merged);
          return merged;
        });
        tables.set(this.table, next);
        data = this.one ? saved[0] : saved;
      } else if (this.op === "update") {
        tables.set(this.table, rows(this.table).map((row) => (matches(row) ? { ...row, ...(this.payload as Row) } : row)));
      } else {
        tables.set(this.table, rows(this.table).filter((row) => !matches(row)));
      }
      return { data, error: null };
    }
    then<A, B>(onFulfilled?: (value: { data: unknown; error: null }) => A, onRejected?: (reason: unknown) => B) {
      return this.run().then(onFulfilled, onRejected);
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    rpc: async () => ({ data: PROJECT_ID, error: null }),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };

  return {
    client,
    rows,
    /** Holds the next matching write until the returned gate is resolved or rejected. */
    holdNext(table: string, op: Op) {
      const gate = deferredPromise<void>();
      const reached = deferredPromise<void>();
      holds.push({ table, op, reached: () => reached.resolve(), gate: gate.promise });
      return { reached: reached.promise, release: gate.resolve, fail: gate.reject };
    },
  };
}

let db: ReturnType<typeof createInMemoryDatabase>;

const seededTask = procedureTestTask("Fit the bracket", 1, {
  customFields: { [STEP_TOOL_LISTS_FIELD]: { "step-1": ["torque  wrench", "Hex Key"] } },
});
const initialState: PlannerState = {
  ...emptyPlannerState,
  product: { ...emptyPlannerState.product, id: "product-1", projectId: PROJECT_ID },
  scenario: { ...emptyPlannerState.scenario, id: "scenario-main", productId: "product-1" },
  tasks: [seededTask],
};
const entry = { key: "torque wrench", rawName: "torque  wrench", libraryId: "lib-torque" } as ProjectToolCatalogEntry;
const operations = {
  rename: (tools: ReturnType<typeof useWorkspaceTools>) =>
    tools.saveCatalogTool(entry, { name: "Torque Driver", category: "power" as never }),
  delete: (tools: ReturnType<typeof useWorkspaceTools>) => tools.deleteCatalogTool(entry),
  tidy: (tools: ReturnType<typeof useWorkspaceTools>) => tools.tidyCatalogToolNames([{ from: "torque  wrench", to: "Torque Wrench" }]),
};

const storedStepTools = () =>
  db.rows("step_tools")
    .filter((row) => row.task_id === "task-1" && row.step_id === "step-1")
    .map((row) => String(row.tool_name))
    .sort();
const libraryNames = () => db.rows("tool_library").map((row) => String(row.tool_name)).sort();

function renderTools() {
  const notifyFeedback = vi.fn();
  const hook = renderHook(() => {
    const [plannerState, setPlannerState] = useState<PlannerState>(initialState);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveError, setSaveError] = useState<string>();
    const remoteStateConfirmedRef = useRef(true);
    const tools = useWorkspaceTools({
      projectId: PROJECT_ID,
      libraryProjectId: PROJECT_ID,
      derivedState: plannerState,
      setPlannerState,
      writeTracker: new WorkspaceWriteTracker(PROJECT_ID),
      remoteStateConfirmedRef,
      setSaveState,
      setSaveError,
      notifyFeedback,
      blockViewOnlyWrite: () => false,
      flushDeferredRemoteRefresh: () => undefined,
    });
    return { plannerState, setPlannerState, saveState, saveError, tools };
  });
  return { ...hook, notifyFeedback };
}

beforeEach(async () => {
  db = createInMemoryDatabase();
  (globalThis as { __buildlogicPlannerSupabaseClient?: unknown }).__buildlogicPlannerSupabaseClient = db.client;
  // The saved starting point: the task (with its step tools) and the library row.
  await saveTasksToSupabase([seededTask], PROJECT_ID);
  await upsertToolLibraryMetadata({ toolName: "torque  wrench", category: "hand", projectId: PROJECT_ID });
  expect(storedStepTools()).toEqual(["Hex Key", "torque  wrench"]);
});

for (const [name, run] of Object.entries(operations)) {
  it(`${name}: a failed task save leaves nothing the next normal save could persist, and keeps edits made meanwhile`, async () => {
    const { result, notifyFeedback } = renderTools();
    await act(async () => { await Promise.resolve(); });
    const shellSave = db.holdNext("tasks", "upsert");

    // 1. Start the catalog operation; its task save is now in flight.
    let outcome: Promise<string> | undefined;
    await act(async () => {
      outcome = run(result.current.tools).then(() => "resolved", (error: Error) => error.message);
      await shellSave.reached;
    });

    // Meanwhile: an unrelated field edit, and a tool added to the same step (saved on its own).
    await act(async () => {
      result.current.setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => addStepTool({ ...task, name: "Renamed meanwhile" }, "step-1", "Mallet")),
      }));
      await result.current.tools.persistAddStepTool("task-1", "step-1", "Mallet", 3);
    });

    // 2. The task save fails.
    await act(async () => {
      shellSave.fail(new Error("Shell save failed"));
      await outcome;
    });
    expect(await outcome).toBe(name === "tidy" ? "resolved" : "Shell save failed");
    expect(result.current.saveState).toBe("error");
    expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "Save failed" }));
    expect(libraryNames()).toEqual(["torque  wrench"]);

    // The screen shows what is saved: the previous tool back, plus both edits made meanwhile.
    const localTask = result.current.plannerState.tasks[0]!;
    expect(localTask.name).toBe("Renamed meanwhile");
    expect(getStepToolList(localTask, "step-1")).toEqual(["torque  wrench", "Hex Key", "Mallet"]);

    // 3. An unrelated edit then saves through the normal paths: the shell autosave, and a Gantt
    //    reorder (the one desktop path that rewrites a task's step_tools from the local lists).
    const afterEdit = { ...result.current.plannerState, tasks: [{ ...localTask, wbs: "2" }] };
    await savePlannerShellToSupabase(afterEdit);
    await saveTasksToSupabase(afterEdit.tasks, PROJECT_ID);

    // 4. The failed catalog change was not persisted; task references still agree with the library.
    expect(db.rows("tasks")[0]).toMatchObject({ name: "Renamed meanwhile", wbs: "2" });
    expect(storedStepTools()).toEqual(["Hex Key", "Mallet", "torque  wrench"]);
    const libraryKeys = new Set(libraryNames().map(canonicalToolKey));
    expect(libraryKeys.has(canonicalToolKey("torque  wrench"))).toBe(true);
  });
}

it("characterizes today: the shell save never writes step tool lists, so even a successful rename leaves step_tools on the old name", async () => {
  // Pre-existing since the initial import and reported separately: step tool lists are stripped from
  // the tasks row and live in step_tools, which savePlannerShellToSupabase never touches.
  const { result } = renderTools();
  await act(async () => { await Promise.resolve(); });

  await act(async () => { await operations.rename(result.current.tools); });

  expect(result.current.saveState).toBe("saved");
  expect(getStepToolList(result.current.plannerState.tasks[0]!, "step-1")).toEqual(["Torque Driver", "Hex Key"]);
  expect(libraryNames()).toEqual(["Torque Driver"]);
  expect(storedStepTools()).toEqual(["Hex Key", "torque  wrench"]);
  expect(db.rows("tasks")[0]?.custom_fields).not.toHaveProperty(STEP_TOOL_LISTS_FIELD);
});
