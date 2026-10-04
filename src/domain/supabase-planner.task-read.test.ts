// The single-task read (loadTaskFromSupabase): every child collection is paged and ordered with an `id`
// tiebreaker, matching the full planner load and the private-media hydrate. These tests run the real
// loader against a scripted client that HONOURS the order/range modifiers it receives, so ordering and
// paging are exercised rather than echoed. Node environment: an explicit client is injected and the
// browser client must never be touched.
import { describe, expect, it, vi } from "vitest";
import { READ_PAGE_SIZE } from "@/lib/supabase/read-all-pages";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import { getTaskStepPhotoAttachmentMap } from "./step-photos";
import { loadTaskFromSupabase, loadTaskPrivateMediaFromSupabase } from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

type Row = Record<string, unknown>;
type Client = NonNullable<Parameters<typeof loadTaskFromSupabase>[2]>;
const PROJECT = "proj-1";
const API_MAX_ROWS = 1000; // supabase/config.toml [api] max_rows; the hosted project returned exactly 1000 of 1312 rows
const TASK = { id: "task-1", scenario_id: "scenario-1", name: "Fit", custom_fields: {}, version: 1 };
const STEP: Row = { id: "step-1", task_id: "task-1", sequence: 1, name: "Fit", version: 1 };

/** Applies the request's eq/is filters, order(...) modifiers and range(...) to a table, like PostgREST would. */
function serve(rows: Row[], request: RecordedRequest): Row[] {
  let out = rows.filter((row) => request.filters.every((filter) => {
    const eq = filter.match(/^(\w+)=(.*)$/);
    if (eq) return String(row[eq[1]!]) === eq[2];
    const isNull = filter.match(/^(\w+) is null$/);
    if (isNull) return row[isNull[1]!] == null;
    throw new Error(`unsupported filter ${filter}`);
  }));
  const orders = request.modifiers.filter((m) => m.startsWith("order(")).map((m) => m.slice(6, -1));
  out = [...out].sort((a, b) => {
    for (const column of orders) {
      const c = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
      if (c) return c;
    }
    return 0;
  });
  const range = request.modifiers.find((m) => m.startsWith("range("))?.match(/range\((\d+),(\d+)\)/);
  // Like the hosted API: a ranged request gets its slice, an unranged one is silently capped at max_rows.
  out = range ? out.slice(Number(range[1]), Number(range[2]) + 1) : out.slice(0, API_MAX_ROWS);
  return out;
}

function world(tables: Record<string, Row[]>, options: { failPage?: { table: string; from: number } } = {}) {
  const browser = createRecordingSupabase({ reply: () => ({ data: TASK }) });
  (globalThis as { __buildlogicPlannerSupabaseClient?: unknown }).__buildlogicPlannerSupabaseClient = browser.client;
  const db = createRecordingSupabase({
    userId: "user-1",
    reply: (request): ScriptedReply | undefined => {
      if (request.target === "task_project_id") return { data: PROJECT };
      if (request.kind === "storage") return { data: (request.payload as string[]).map((path) => ({ path, signedUrl: `https://signed.test/${path}` })) };
      if (request.kind !== "from") return undefined;
      if (request.target === "tasks") return { data: TASK };
      // Photos attach to steps the task actually has, so every world carries step-1 unless it supplies its own steps.
      if (request.target === "manufacturing_steps" && !tables.manufacturing_steps) return { data: serve([STEP], request) };
      const from = Number(request.modifiers.find((m) => m.startsWith("range("))?.match(/\((\d+),/)?.[1] ?? 0);
      if (options.failPage && options.failPage.table === request.target && options.failPage.from === from) {
        return { error: { message: `page ${from} unavailable` } };
      }
      return { data: serve(tables[request.target] ?? [], request) };
    },
  });
  const pagesOf = (table: string) => db.requests.filter((r) => r.kind === "from" && r.target === table).map((r) => r.modifiers.find((m) => m.startsWith("range("))!);
  return { db, browser, client: db.client as unknown as Client, pagesOf };
}

const photo = (id: string, captured_at: string, extra: Row = {}): Row =>
  ({ id, task_id: "task-1", step_id: "step-1", storage_path: `p/${id}.jpg`, captured_at, deleted_at: null, ...extra });
const photoIds = (task: { customFields: Record<string, unknown> } | null) =>
  (getTaskStepPhotoAttachmentMap(task as never)["step-1"] ?? []).map((p) => p.id);

describe("deterministic ordering", () => {
  // Eleven photos captured in one batch share a timestamp; stored in scrambled insertion order.
  const batch = ["k", "c", "h", "a", "j", "e", "b", "i", "d", "g", "f"].map((id) => photo(id, "2026-10-01T10:00:00.000Z"));
  const tables = { step_photos: [photo("z-earlier", "2026-09-30T08:00:00.000Z"), ...batch, photo("late", "2026-10-02T00:00:00.000Z")] };

  it("orders tied captured_at photos by id, identically to the private-media hydrate", async () => {
    const { client, browser } = world(tables);
    const full = await loadTaskFromSupabase("task-1", PROJECT, client);
    const hydrate = await loadTaskPrivateMediaFromSupabase("task-1", PROJECT, client);
    const expected = ["z-earlier", ...[...batch].map((p) => String(p.id)).sort(), "late"];
    expect(photoIds(full)).toEqual(expected);
    expect(photoIds(hydrate)).toEqual(expected);
    expect(browser.requests).toEqual([]);
  });

  it("requests exactly the hydrate's order and filters for each media table", async () => {
    const { db, client } = world(tables);
    await loadTaskFromSupabase("task-1", PROJECT, client);
    const shape = (table: string) => db.requests.filter((r) => r.target === table).map((r) => `${r.filters.join(" ")} | ${r.modifiers.filter((m) => !m.startsWith("range")).join(" ")}`);
    expect(shape("step_photos")).toEqual(["task_id=task-1 deleted_at is null | order(captured_at) order(id)"]);
    expect(shape("step_exploded_views")).toEqual(["task_id=task-1 deleted_at is null | order(captured_at) order(id)"]);
    expect(shape("task_videos")).toEqual(["task_id=task-1 deleted_at is null | order(captured_at) order(id)"]);
    expect(shape("step_tools")).toEqual(["task_id=task-1 | order(sequence) order(id)"]);
    expect(shape("task_dependencies")).toEqual(["successor_task_id=task-1 | order(id)"]);
    expect(shape("manufacturing_steps")).toEqual(["task_id=task-1 | order(sequence) order(id)"]);
    expect(shape("part_references")).toEqual(["task_id=task-1 | order(created_at) order(id)"]);
  });
});

describe("paging", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => photo(`p${String(i).padStart(5, "0")}`, "2026-10-01T10:00:00.000Z"));

  it("returns every row of a collection larger than one page exactly once, in order", async () => {
    const rows = many(READ_PAGE_SIZE * 2 + 200);
    const { client, pagesOf } = world({ step_photos: rows });
    const ids = photoIds(await loadTaskFromSupabase("task-1", PROJECT, client));
    expect(ids).toEqual(rows.map((r) => String(r.id)));
    expect(new Set(ids).size).toBe(rows.length);
    expect(pagesOf("step_photos")).toEqual(["range(0,499)", "range(500,999)", "range(1000,1499)"]);
  });

  it("stops after one extra empty page when a collection ends exactly on a page boundary", async () => {
    for (const pages of [1, 2]) {
      const rows = many(READ_PAGE_SIZE * pages);
      const { client, pagesOf } = world({ step_photos: rows, step_tools: Array.from({ length: READ_PAGE_SIZE }, (_, i) => ({ id: `t${i}`, task_id: "task-1", step_id: "step-1", tool_name: `Tool ${i}`, sequence: i + 1 })) });
      const task = await loadTaskFromSupabase("task-1", PROJECT, client);
      expect(photoIds(task)).toHaveLength(rows.length);
      expect(pagesOf("step_photos")).toHaveLength(pages + 1);
      expect(pagesOf("step_photos").at(-1)).toBe(`range(${READ_PAGE_SIZE * pages},${READ_PAGE_SIZE * (pages + 1) - 1})`);
      expect(pagesOf("step_tools")).toEqual(["range(0,499)", "range(500,999)"]);
    }
  });

  it("rejects when a later page fails instead of returning an incomplete task", async () => {
    const { client } = world({ step_photos: many(READ_PAGE_SIZE + 5) }, { failPage: { table: "step_photos", from: READ_PAGE_SIZE } });
    await expect(loadTaskFromSupabase("task-1", PROJECT, client)).rejects.toThrow("page 500 unavailable");
  });

  it("adds no request for collections of today's sizes (largest production task: 199 photos)", async () => {
    const { db, client } = world({
      step_photos: many(199),
      step_tools: Array.from({ length: 39 }, (_, i) => ({ id: `t${i}`, task_id: "task-1", step_id: "step-1", tool_name: `Tool ${i}`, sequence: i + 1 })),
      manufacturing_steps: [STEP, ...Array.from({ length: 48 }, (_, i) => ({ id: `s${i}`, task_id: "task-1", sequence: i + 2, version: 1 }))],
      task_dependencies: [{ id: "d1", predecessor_task_id: "task-0", successor_task_id: "task-1" }, { id: "d2", predecessor_task_id: "task-9", successor_task_id: "task-1" }],
    });
    await loadTaskFromSupabase("task-1", PROJECT, client);
    // One project check, the task row, and exactly one request per child table: the same count as before paging.
    expect(db.requests.filter((r) => r.kind !== "storage").map((r) => r.target)).toEqual([
      "task_project_id", "tasks", "task_dependencies", "manufacturing_steps", "part_references", "step_photos", "step_tools", "step_exploded_views", "task_videos",
    ]);
  });
});

describe("filters", () => {
  it("keeps the project assertion first and excludes soft-deleted media and other tasks' rows", async () => {
    const { db, client } = world({
      step_photos: [photo("live", "2026-10-01T00:00:00.000Z"), photo("gone", "2026-10-01T00:00:00.000Z", { deleted_at: "2026-10-02T00:00:00.000Z" }), photo("other", "2026-10-01T00:00:00.000Z", { task_id: "task-2" })],
      step_exploded_views: [{ id: "v-live", task_id: "task-1", storage_path: "v/live.png", captured_at: "2026-10-01T00:00:00.000Z", deleted_at: null }, { id: "v-gone", task_id: "task-1", storage_path: "v/gone.png", captured_at: "2026-10-01T00:00:00.000Z", deleted_at: "2026-10-02T00:00:00.000Z" }],
      task_dependencies: [{ id: "d1", predecessor_task_id: "task-0", successor_task_id: "task-1" }, { id: "d-other", predecessor_task_id: "task-0", successor_task_id: "task-2" }],
    });
    const task = await loadTaskFromSupabase("task-1", PROJECT, client);
    expect(db.requests[0]).toMatchObject({ kind: "rpc", target: "task_project_id", payload: { target_task_id: "task-1" } });
    expect(photoIds(task)).toEqual(["live"]);
    expect(JSON.stringify(task!.customFields)).not.toContain("v/gone.png");
    expect(JSON.stringify(task!.customFields)).toContain("v/live.png");
    expect(task!.dependencyIds).toEqual(["task-0"]);
  });

  it("refuses a task outside the project before reading anything else", async () => {
    const browser = createRecordingSupabase();
    const db = createRecordingSupabase({ reply: (r) => (r.target === "task_project_id" ? { data: "other-project" } : undefined) });
    await expect(loadTaskFromSupabase("task-1", PROJECT, db.client as unknown as Client)).rejects.toThrow("This task does not belong to the active workspace.");
    expect(db.requests.map((r) => r.target)).toEqual(["task_project_id"]);
    expect(browser.requests).toEqual([]);
  });
});
