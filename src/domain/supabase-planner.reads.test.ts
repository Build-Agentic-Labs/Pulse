// Characterization of the planner reads Phase 5 moves into src/lib/planner/read-store.ts: the full
// planner load (request set, scoping, paging, media signing, project resolution), its null and
// failure paths, and the SolidWorks task-target feed. Server path (node): an explicit client is
// passed, as server components and the plugin routes do, and signatures are never cached here.
import { describe, expect, it, vi } from "vitest";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import {
  loadPlannerCoreStateFromSupabase,
  loadPlannerStateFromSupabase,
  loadPlannerStateWithProjectFromSupabase,
  loadPlannerSummaryStateFromSupabase,
  loadProjectTaskTargetsFromSupabase,
} from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const NOW = "2026-10-03T12:00:00.000Z";
type Row = Record<string, unknown>;
type Client = NonNullable<Parameters<typeof loadPlannerStateFromSupabase>[2]>;

const graph: Record<string, Row[] | Row | null> = {
  products: { id: "product-1", project_id: "proj-1", name: "FlexBoost", custom_fields: {}, created_at: NOW, updated_at: NOW },
  projects: { id: "proj-1", workspace_id: "ws-1", name: "FlexBoost", is_awi_master: false },
  workspaces: { id: "ws-1", name: "ANA" },
  workspace_members: { role: "owner" },
  scenarios: { id: "scenario-1", product_id: "product-1", name: "Main", created_at: NOW, updated_at: NOW },
  stations: [{ id: "station-1", scenario_id: "scenario-1", sequence: 1, name: "S1" }],
  zones: [{ id: "zone-1", scenario_id: "scenario-1", sequence: 1, name: "Z1" }],
  manufacturing_components: [],
  document_type_codes: [],
  tasks: [
    { id: "task-1", scenario_id: "scenario-1", wbs: "1", name: "Fit", custom_fields: { keep: 1 }, version: 2 },
    { id: "task-2", scenario_id: "scenario-1", wbs: "2", name: "Wire", custom_fields: {}, version: 1 },
  ],
  custom_columns: [],
  task_dependencies: [{ id: "dep-1", predecessor_task_id: "task-1", successor_task_id: "task-2" }],
  manufacturing_steps: [{ id: "step-1", task_id: "task-1", sequence: 1, name: "Fit", version: 3 }],
  part_references: [],
  actual_events: [
    { id: "ev-2", task_id: "task-1", timestamp: "2026-10-02", event_type: "start" },
    { id: "ev-1", task_id: "task-1", timestamp: "2026-10-01", event_type: "start" },
  ],
  step_photos: [{ id: "photo-1", task_id: "task-1", step_id: "step-1", storage_path: "full/photo.jpg", thumbnail_storage_path: "full/thumb.jpg", captured_at: NOW }],
  step_tools: [{ id: "tool-1", task_id: "task-1", step_id: "step-1", tool_name: "Hex key", sequence: 1 }],
  step_exploded_views: [{ id: "view-1", task_id: "task-1", step_id: null, storage_path: "full/view.png", captured_at: NOW }],
  task_videos: [{ id: "video-1", task_id: "task-2", storage_path: "full/video.webm", captured_at: NOW }],
};

function replyFrom(rows: Record<string, Row[] | Row | null>, extra?: (r: RecordedRequest) => ScriptedReply | undefined) {
  return (request: RecordedRequest): ScriptedReply | undefined => {
    const custom = extra?.(request);
    if (custom) return custom;
    if (request.target === "is_super_admin") return { data: false };
    if (request.kind === "storage" && request.op === "createSignedUrls") {
      return { data: (request.payload as string[]).map((path) => ({ path, signedUrl: `signed:${path}` })) };
    }
    if (request.kind !== "from" || !(request.target in rows)) return undefined;
    return { data: rows[request.target] };
  };
}

const client = (db: ReturnType<typeof createRecordingSupabase>) => db.client as unknown as Client;

describe("full planner load", () => {
  it("reads the graph in three waves, scoped to the product's earliest scenario, and signs media", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom(graph) });
    const loaded = await loadPlannerStateWithProjectFromSupabase("proj-1", undefined, client(db));

    expect(db.lines()).toEqual([
      "products.select(*) project_id=proj-1 | order(created_at) limit(1) maybeSingle",
      "projects.select(*) id=proj-1 | maybeSingle",
      "scenarios.select(*) product_id=product-1 | order(created_at) limit(1) maybeSingle",
      "auth.getSession",
      "workspaces.select(*) id=ws-1 | maybeSingle",
      "workspace_members.select(role) workspace_id=ws-1 user_id=user-1 | maybeSingle",
      "rpc:is_super_admin",
      "stations.select(*) scenario_id=scenario-1 | order(sequence) order(id) range(0,499)",
      "zones.select(*) scenario_id=scenario-1 | order(sequence) order(id) range(0,499)",
      "manufacturing_components.select(*) scenario_id=scenario-1 | order(sequence) order(id) range(0,499)",
      "document_type_codes.select(*) or(project_id.eq.proj-1,product_id.eq.product-1) | order(created_at) order(id) range(0,499)",
      "tasks.select(*) scenario_id=scenario-1 | order(wbs) order(id) range(0,499)",
      "custom_columns.select(*) or(product_id.eq.product-1,scenario_id.eq.scenario-1) | order(created_at) order(id) range(0,499)",
      "task_dependencies.select(*) successor_task_id in [task-1,task-2] | order(id) range(0,499)",
      "manufacturing_steps.select(*) task_id in [task-1,task-2] | order(sequence) order(id) range(0,499)",
      "part_references.select(*) task_id in [task-1,task-2] | order(created_at) order(id) range(0,499)",
      "actual_events.select(*) task_id in [task-1,task-2] | order(timestamp) order(id) range(0,499)",
      "step_photos.select(*) task_id in [task-1,task-2] deleted_at is null | order(captured_at) order(id) range(0,499)",
      "step_tools.select(*) task_id in [task-1,task-2] | order(sequence) order(id) range(0,499)",
      "step_exploded_views.select(*) task_id in [task-1,task-2] deleted_at is null | order(captured_at) order(id) range(0,499)",
      "task_videos.select(*) task_id in [task-1,task-2] deleted_at is null | order(captured_at) order(id) range(0,499)",
      "storage:step-photos.createSignedUrls([full/photo.jpg,full/thumb.jpg])",
      "storage:step-photos.createSignedUrls([full/view.png])",
      "storage:task-videos.createSignedUrls([full/video.webm])",
    ]);

    const { state, project } = loaded!;
    expect(project).toMatchObject({ projectId: "proj-1", workspaceId: "ws-1", role: "owner", accessLevel: "edit" });
    expect(state.project).toBe(project);
    expect(state.tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(state.tasks[1]!.dependencyIds).toEqual(["task-1"]);
    expect(state.tasks[0]!.manufacturingSteps?.map((step) => step.id)).toEqual(["step-1"]);
    expect(state.tasks[0]!.customFields).toMatchObject({
      keep: 1,
      stepToolLists: { "step-1": ["Hex key"] },
      stepPhotoAttachments: { "step-1": [expect.objectContaining({ id: "photo-1", dataUrl: "signed:full/photo.jpg", storagePath: "full/photo.jpg", thumbnailUrl: "signed:full/thumb.jpg" })] },
    });
    expect(JSON.stringify(state.tasks[1]!.customFields)).toContain("signed:full/video.webm");
    expect(state.actualEvents.map((event) => event.id)).toEqual(["ev-1", "ev-2"]);
    expect(state.dependencies.map((dependency) => dependency.id)).toEqual(["dep-1"]);
  });

  it("loads a requested scenario only within the product, and keeps the full and core wrappers distinct", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom(graph) });
    await loadPlannerStateFromSupabase("proj-1", "scenario-9", client(db));
    expect(db.lines()).toContain("scenarios.select(*) product_id=product-1 id=scenario-9 | maybeSingle");

    const core = createRecordingSupabase({ userId: "user-1", reply: replyFrom(graph) });
    const state = await loadPlannerCoreStateFromSupabase("proj-1", undefined, client(core));
    expect(core.lines().filter((line) => /step_photos|step_exploded_views|task_videos|storage:/.test(line))).toEqual([]);
    expect(state!.tasks[0]!.customFields).not.toHaveProperty("stepPhotoAttachments");
  });

  it("returns null without further reads when the product or its scenario is missing", async () => {
    const noProduct = createRecordingSupabase({ reply: replyFrom({ ...graph, products: null }) });
    await expect(loadPlannerStateFromSupabase("proj-1", undefined, client(noProduct))).resolves.toBeNull();
    expect(noProduct.lines()).toEqual(["products.select(*) project_id=proj-1 | order(created_at) limit(1) maybeSingle"]);

    const noScenario = createRecordingSupabase({ userId: "user-1", reply: replyFrom({ ...graph, scenarios: null }) });
    await expect(loadPlannerStateFromSupabase("proj-1", "other", client(noScenario))).resolves.toBeNull();
    expect(noScenario.lines().some((line) => line.startsWith("tasks."))).toBe(false);
  });

  it("without a project id, loads the earliest product and resolves its own project", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom(graph) });
    const state = await loadPlannerStateFromSupabase(undefined, undefined, client(db));
    expect(db.lines()[0]).toBe("products.select(*) | order(created_at) limit(1) maybeSingle");
    expect(db.lines()[1]).toBe("projects.select(*) id=proj-1 | maybeSingle");
    expect(state!.project?.projectId).toBe("proj-1");
  });

  it("refuses a product that belongs to no project, after reading it", async () => {
    const orphan = { ...(graph.products as Row), project_id: null };
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom({ ...graph, products: orphan }) });
    await expect(loadPlannerStateFromSupabase(undefined, undefined, client(db))).rejects.toThrow("This product is not assigned to a workspace yet.");
    expect(db.lines().some((line) => line.startsWith("projects."))).toBe(false);
  });

  it("propagates a failed child read instead of returning a partial graph", async () => {
    const db = createRecordingSupabase({
      userId: "user-1",
      reply: replyFrom(graph, (r) => (r.target === "manufacturing_steps" ? { error: { message: "steps unavailable" } } : undefined)),
    });
    await expect(loadPlannerStateFromSupabase("proj-1", undefined, client(db))).rejects.toThrow("steps unavailable");
  });

  it("refuses a project the caller cannot see", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom({ ...graph, projects: null }) });
    await expect(loadPlannerStateFromSupabase("proj-1", undefined, client(db))).rejects.toThrow("Workspace not found or you do not have access to it.");
  });
});

describe("dashboard summary load", () => {
  it("reads only the product, earliest scenario and its stations, zones and task rows", async () => {
    const db = createRecordingSupabase({ reply: replyFrom(graph) });
    const summary = await loadPlannerSummaryStateFromSupabase("proj-1", client(db));
    expect(db.lines().map((line) => line.replace(/select\([^)]*\)/, "select(…)"))).toEqual([
      "products.select(…) project_id=proj-1 | order(created_at) limit(1) maybeSingle",
      "scenarios.select(…) product_id=product-1 | order(created_at) limit(1) maybeSingle",
      "stations.select(…) scenario_id=scenario-1 | order(sequence) order(id) range(0,499)",
      "zones.select(…) scenario_id=scenario-1 | order(sequence) order(id) range(0,499)",
      "tasks.select(…) scenario_id=scenario-1 | order(wbs) order(id) range(0,499)",
    ]);
    expect(db.requests[0]!.columns).not.toContain("custom_fields");
    expect(summary!.tasks).toHaveLength(2);
  });
});

describe("SolidWorks task targets", () => {
  it("lists work tasks of each product's earliest scenario, grouped by zone sequence", async () => {
    const db = createRecordingSupabase({
      reply: replyFrom({
        products: [{ id: "product-1" }, { id: "product-2" }],
        scenarios: [
          { id: "main-1", name: "Main", product_id: "product-1" },
          { id: "main-2", name: "Main B", product_id: "product-2" },
          { id: "copy-1", name: "Optimized", product_id: "product-1" },
        ],
        zones: [{ id: "z-late", name: "Final", code: "FN", sequence: 5 }, { id: "z-early", name: "Frame", code: null, sequence: 1 }],
        tasks: [
          { id: "t1", name: "Late", manufacturing_code: "F1", scenario_id: "main-1", row_type: "task", zone_id: "z-late" },
          { id: "t2", name: "Unzoned", manufacturing_code: null, scenario_id: "main-1", row_type: null, zone_id: null },
          { id: "t3", name: "Gate", manufacturing_code: null, scenario_id: "main-1", row_type: "milestone", zone_id: "z-early" },
          { id: "t4", name: "Early", manufacturing_code: "E1", scenario_id: "main-2", row_type: "task", zone_id: "z-early" },
        ],
      }),
    });
    const targets = await loadProjectTaskTargetsFromSupabase("proj-1", db.client as never);
    expect(db.lines()).toEqual([
      "products.select(id) project_id=proj-1",
      "scenarios.select(id,name,product_id) product_id in [product-1,product-2] | order(created_at)",
      "zones.select(id,name,code,sequence) scenario_id in [main-1,main-2]",
      "tasks.select(id,name,manufacturing_code,scenario_id,row_type,zone_id) scenario_id in [main-1,main-2] | order(wbs) range(0,999)",
    ]);
    expect(targets).toEqual([
      { id: "t4", name: "Early", code: "E1", scenarioName: "Main B", zoneName: "Frame", zoneCode: null },
      { id: "t1", name: "Late", code: "F1", scenarioName: "Main", zoneName: "Final", zoneCode: "FN" },
      { id: "t2", name: "Unzoned", code: null, scenarioName: "Main", zoneName: null, zoneCode: null },
    ]);
  });

  it("pages tasks 1000 at a time and stops early when there is nothing to list", async () => {
    let page = 0;
    const db = createRecordingSupabase({
      reply: (r) => {
        if (r.target === "products") return { data: [{ id: "p" }] };
        if (r.target === "scenarios") return { data: [{ id: "s", name: "Main", product_id: "p" }] };
        if (r.target === "tasks") {
          page += 1;
          return { data: Array.from({ length: page === 1 ? 1000 : 2 }, (_, i) => ({ id: `t${page}-${i}`, scenario_id: "s" })) };
        }
        return undefined;
      },
    });
    expect(await loadProjectTaskTargetsFromSupabase("proj-1", db.client as never)).toHaveLength(1002);
    expect(db.lines().filter((line) => line.startsWith("tasks.")).map((line) => line.split("| ")[1])).toEqual(["order(wbs) range(0,999)", "order(wbs) range(1000,1999)"]);

    const none = createRecordingSupabase({ reply: (r) => (r.target === "products" ? { data: [] } : undefined) });
    expect(await loadProjectTaskTargetsFromSupabase("proj-1", none.client as never)).toEqual([]);
    expect(none.lines()).toEqual(["products.select(id) project_id=proj-1"]);
  });
});
