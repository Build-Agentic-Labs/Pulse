import { describe, expect, it, vi } from "vitest";
import { loadPlannerCoreStateFromSupabase } from "./supabase-planner";

const NOW = "2026-08-05T12:00:00.000Z";

type QueryResult = Record<string, unknown> | Array<Record<string, unknown>> | null;

function createPlannerClientFixture() {
  const requestedTables: string[] = [];
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

    select() { return this; }
    eq() { return this; }
    order() { return this; }
    limit() { return this; }
    or() { return this; }
    in() { return this; }
    is() { return this; }

    maybeSingle() {
      const value = rows[this.table];
      return Promise.resolve({
        data: Array.isArray(value) ? value[0] ?? null : value,
        error: null,
      });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: QueryResult; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: rows[this.table] ?? [], error: null }).then(onfulfilled, onrejected);
    }
  }

  const createSignedUrls = vi.fn(() => Promise.resolve({ data: [], error: null }));
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
    rpc: () => Promise.resolve({ data: false, error: null }),
    storage: {
      from: () => ({ createSignedUrls }),
    },
  };

  return { client, createSignedUrls, requestedTables };
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
});
