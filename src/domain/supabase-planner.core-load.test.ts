import { describe, expect, it, vi } from "vitest";
import { loadPlannerCoreStateFromSupabase, loadTaskPrivateMediaFromSupabase } from "./supabase-planner";

const NOW = "2026-08-05T12:00:00.000Z";

type QueryResult = Record<string, unknown> | Array<Record<string, unknown>> | null;

function createPlannerClientFixture() {
  const requestedTables: string[] = [];
  const selects: { table: string; columns: string }[] = [];
  let taskError: Error | null = null;
  const readErrors = new Map<string, { message: string; code?: string }>();
  const holds = new Map<string, Promise<void>>();
  const rows: Record<string, QueryResult> = {
    products: [{
      id: "product-1",
      project_id: "project-1",
      name: "FlexBoost",
      revision: "A",
      status: "draft",
      demand_quantity: 10,
      demand_period: "day",
      custom_fields: {},
      created_at: NOW,
      updated_at: NOW,
    }],
    projects: [{ id: "project-1", workspace_id: "workspace-1", name: "FlexBoost" }],
    workspaces: [{ id: "workspace-1", name: "ANA Corp" }],
    workspace_members: [{ role: "owner" }],
    scenarios: [{
      id: "scenario-1",
      product_id: "product-1",
      name: "Main",
      target_output: 10,
      target_output_period: "day",
      created_at: NOW,
      updated_at: NOW,
    }],
    stations: [{ id: "station-1", scenario_id: "scenario-1", sequence: 1, name: "Station 1" }],
    zones: [],
    manufacturing_components: [],
    document_type_codes: [],
    tasks: [{
      id: "task-1",
      scenario_id: "scenario-1",
      station_id: "station-1",
      row_type: "task",
      wbs: "1",
      name: "Install assembly",
      planned_start: NOW,
      planned_finish: NOW,
      planned_duration_minutes: 60,
      custom_fields: {
        operatorIds: ["A"],
        stepPhotoAttachments: { "step-1": [{ storagePath: "private/photo.jpg" }] },
        taskExplodedViews: [{ storagePath: "private/exploded.png" }],
        taskVideos: [{ storagePath: "private/video.mp4" }],
      },
      version: 7,
    }],
    custom_columns: [],
    task_dependencies: [],
    manufacturing_steps: [{
      id: "step-1",
      task_id: "task-1",
      sequence: 1,
      name: "Install",
      instruction: "Install the assembly.",
      duration_minutes: 20,
      dependency_ids: ["part:part-1|qty:4"],
      version: 2,
    }],
    part_references: [{ id: "part-1", task_id: "task-1", part_number: "ABC", quantity: 1 }],
    actual_events: [],
    step_tools: [{ id: "tool-1", task_id: "task-1", step_id: "step-1", tool_name: "Impact gun", sequence: 1 }],
  };

  class Query {
    constructor(private readonly table: string) {}

    private columns = "*";
    select(columns = "*") { this.columns = columns; selects.push({ table: this.table, columns }); return this; }
    eq() { return this; }
    order() { return this; }
    limit() { return this; }
    range() { return this; }
    or() { return this; }
    in() { return this; }
    is() { return this; }

    async maybeSingle() {
      await holds.get(this.table);
      const value = rows[this.table];
      const row = Array.isArray(value) ? value[0] ?? null : value;
      const data = this.table === "tasks" && this.columns !== "*" && row
        ? { id: row.id, photo_annotations: (row.custom_fields as Record<string, unknown>)?.stepPhotoAnnotations ?? null }
        : row;
      return {
        data,
        error: readErrors.get(this.table) ?? (this.table === "tasks" ? taskError : null),
      };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: QueryResult; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: rows[this.table] ?? [], error: null }).then(onfulfilled, onrejected);
    }
  }

  const createSignedUrls = vi.fn((paths: string[]) => Promise.resolve({
    data: paths.map((path) => ({ path, signedUrl: `https://private.test/${path}?signed=true` })), error: null,
  }));
  const rpc = vi.fn((name: string) => Promise.resolve({ data: name === "task_project_id" ? "project-1" : false, error: null }));
  const client = {
    from(table: string) {
      requestedTables.push(table);
      return new Query(table);
    },
    auth: {
      getSession: () => Promise.resolve({
        data: { session: { user: { id: "user-1" } } },
        error: null,
      }),
    },
    rpc,
    storage: {
      from: () => ({ createSignedUrls }),
    },
  };

  return { client, createSignedUrls, requestedTables, selects, rows, rpc,
    failTaskRead: () => { taskError = new Error("Media read unavailable"); },
    readErrors,
    holdRead: (table: string) => {
      let release!: () => void;
      holds.set(table, new Promise<void>((resolve) => { release = resolve; }));
      return release;
    },
  };
}

describe("loadPlannerCoreStateFromSupabase", () => {
  it("confirms editable task detail without reading or signing private media", async () => {
    const { client, createSignedUrls, requestedTables } = createPlannerClientFixture();

    const state = await loadPlannerCoreStateFromSupabase("project-1", undefined, client as never);

    expect(state?.tasks[0]).toMatchObject({
      id: "task-1",
      manufacturingSteps: [{
        id: "step-1",
        instruction: "Install the assembly.",
        partReferenceIds: ["part-1"],
        partReferenceQuantities: { "part-1": 4 },
        version: 2,
      }],
      partReferences: [{ id: "part-1", partNumber: "ABC", quantity: 1 }],
      customFields: {
        operatorIds: ["A"],
        stepToolLists: { "step-1": ["Impact gun"] },
      },
    });
    expect(state?.tasks[0].customFields).not.toHaveProperty("stepPhotoAttachments");
    expect(state?.tasks[0].customFields).not.toHaveProperty("taskExplodedViews");
    expect(state?.tasks[0].customFields).not.toHaveProperty("taskVideos");
    expect(requestedTables).not.toContain("step_photos");
    expect(requestedTables).not.toContain("step_exploded_views");
    expect(requestedTables).not.toContain("task_videos");
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("starts membership and administrator checks while the organization read is still pending", async () => {
    const fixture = createPlannerClientFixture();
    const releaseWorkspace = fixture.holdRead("workspaces");
    const state = loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    try {
      await vi.waitFor(() => {
        expect(fixture.requestedTables).toContain("workspaces");
        expect(fixture.requestedTables).toContain("workspace_members");
        expect(fixture.rpc).toHaveBeenCalledWith("is_super_admin");
      });
      expect(fixture.requestedTables).not.toContain("project_access");
    } finally { releaseWorkspace(); }
    expect((await state)?.project).toMatchObject({ workspaceId: "workspace-1", role: "owner", accessLevel: "edit" });
  });

  it.each(["owner", "admin"])("keeps manager access without reading project overrides for %s", async (role) => {
    const fixture = createPlannerClientFixture();
    fixture.rows.workspace_members = [{ role }];
    fixture.readErrors.set("project_access", { message: "Must not read manager overrides" });
    const state = await loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    expect(state?.project).toMatchObject({ role, accessLevel: "edit" });
    expect(fixture.requestedTables).not.toContain("project_access");
  });

  it("keeps superadministrator access without requiring a membership", async () => {
    const fixture = createPlannerClientFixture();
    fixture.rows.workspace_members = [];
    fixture.rpc.mockResolvedValue({ data: true, error: null });
    const state = await loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    expect(state?.project).toMatchObject({ role: "owner", accessLevel: "edit" });
    expect(fixture.requestedTables).not.toContain("project_access");
  });

  it.each([
    ["edit", "editor"], ["view", "viewer"], ["none", undefined],
  ])("preserves explicit %s access for a non-manager", async (level, role) => {
    const fixture = createPlannerClientFixture();
    fixture.rows.workspace_members = [{ role: "editor" }];
    fixture.rows.project_access = [{ level }];
    const state = await loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    expect(state?.project?.role).toBe(role);
    expect(state?.project?.accessLevel).toBe(level);
  });

  it("rechecks changed access on the next load instead of retaining the earlier permission", async () => {
    const fixture = createPlannerClientFixture();
    fixture.rows.workspace_members = [{ role: "editor" }];
    fixture.rows.project_access = [{ level: "edit" }];
    const first = await loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    fixture.rows.project_access = [{ level: "view" }];
    const second = await loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    expect(first?.project?.accessLevel).toBe("edit");
    expect(second?.project?.accessLevel).toBe("view");
    expect(fixture.requestedTables.filter((table) => table === "project_access")).toHaveLength(2);
  });

  it("preserves legacy membership fallback only when the project access table is absent", async () => {
    const fixture = createPlannerClientFixture();
    fixture.rows.workspace_members = [{ role: "viewer" }];
    fixture.readErrors.set("project_access", { message: "Missing relation", code: "42P01" });
    const state = await loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never);
    expect(state?.project?.role).toBe("viewer");
    expect(state?.project?.accessLevel).toBeUndefined();
  });

  it.each(["workspaces", "workspace_members", "project_access"])("never confirms the graph when the %s access read fails", async (table) => {
    const fixture = createPlannerClientFixture();
    fixture.rows.workspace_members = [{ role: "editor" }];
    fixture.readErrors.set(table, { message: "Access lookup unavailable", code: "08006" });
    await expect(loadPlannerCoreStateFromSupabase("project-1", undefined, fixture.client as never)).rejects.toMatchObject({ message: "Access lookup unavailable" });
    expect(fixture.requestedTables).not.toContain("manufacturing_steps");
  });
});

describe("private media refresh", () => {
  it("does not re-read steps, dependencies, parts, or tools", async () => {
    const { client, requestedTables, selects, rpc } = createPlannerClientFixture();
    const task = await loadTaskPrivateMediaFromSupabase("task-1", "project-1", client as never);
    expect(task?.id).toBe("task-1");
    expect(requestedTables).toEqual(["tasks", "step_photos", "step_exploded_views", "task_videos"]);
    expect(task?.customFields).not.toHaveProperty("stepPhotoAttachments");
    expect(selects.find(({ table }) => table === "tasks")?.columns).toBe("id,photo_annotations:custom_fields->stepPhotoAnnotations");
    expect(task).toEqual({ id: "task-1", customFields: { stepPhotoAnnotations: {} } });
    expect(rpc).toHaveBeenCalledWith("task_project_id", { target_task_id: "task-1" });
  });

  it("keeps photo annotations and signs all normalized media without exposing editable fields", async () => {
    const { client, rows, createSignedUrls } = createPlannerClientFixture();
    const mark = { version: 2, items: [{ id: "arrow", type: "arrow", color: "red", strokeWidth: 3, x1: 0, y1: 0, x2: 1, y2: 1 }] };
    (rows.tasks as Record<string, unknown>[])[0].custom_fields = {
      stepPhotoAnnotations: { "photo-1": mark }, unrelated: "Never duplicate task content",
      stepPhotoAttachments: { "step-1": [{ id: "legacy", dataUrl: "data:image/png;base64,large" }] },
    };
    rows.step_photos = [{ id: "photo-1", task_id: "task-1", step_id: "step-1", file_name: "bracket.png", storage_path: "photo.png", thumbnail_storage_path: "thumbnail.png" }];
    rows.step_exploded_views = [{ id: "view-1", task_id: "task-1", storage_path: "view.png" }];
    rows.task_videos = [{ id: "video-1", task_id: "task-1", storage_path: "video.mp4" }];
    const task = await loadTaskPrivateMediaFromSupabase("task-1", "project-1", client as never);
    expect(task?.customFields).toMatchObject({
      stepPhotoAttachments: { "step-1": [{ id: "photo-1", annotations: mark, dataUrl: "https://private.test/photo.png?signed=true", thumbnailUrl: "https://private.test/thumbnail.png?signed=true" }] },
      taskExplodedViews: [{ id: "view-1", dataUrl: "https://private.test/view.png?signed=true" }],
      taskVideos: [{ id: "video-1", videoUrl: "https://private.test/video.mp4?signed=true" }],
    });
    expect(Object.keys(task!).sort()).toEqual(["customFields", "id"]);
    expect(task?.customFields).not.toHaveProperty("unrelated");
    expect(createSignedUrls).toHaveBeenCalledTimes(3);
  });

  it("treats a deleted task as absent without fetching media", async () => {
    const { client, rows, requestedTables } = createPlannerClientFixture();
    rows.tasks = [];
    await expect(loadTaskPrivateMediaFromSupabase("task-1", "project-1", client as never)).resolves.toBeNull();
    expect(requestedTables).toEqual(["tasks"]);
  });

  it("rejects another project's task before any task or storage read", async () => {
    const { client, requestedTables, createSignedUrls } = createPlannerClientFixture();
    await expect(loadTaskPrivateMediaFromSupabase("task-1", "another-project", client as never)).rejects.toThrow("does not belong");
    expect(requestedTables).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("propagates read failures so the shell can retry without clearing media", async () => {
    const { client, failTaskRead, requestedTables } = createPlannerClientFixture();
    failTaskRead();
    await expect(loadTaskPrivateMediaFromSupabase("task-1", "project-1", client as never)).rejects.toThrow("Media read unavailable");
    expect(requestedTables).toEqual(["tasks"]);
  });
});
