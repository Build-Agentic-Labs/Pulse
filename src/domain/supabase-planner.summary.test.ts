import { describe, expect, it } from "vitest";
import { buildPlannerSummaryState } from "./supabase-planner";

const NOW = "2026-08-05T12:00:00.000Z";

describe("buildPlannerSummaryState", () => {
  it("keeps dashboard rows while excluding editable children and media-bearing collections", () => {
    const summary = buildPlannerSummaryState({
      product: {
        id: "product-1",
        project_id: "project-1",
        name: "FlexBoost",
        revision: "A",
        status: "draft",
        demand_quantity: 10,
        demand_period: "day",
        custom_fields: { masterBom: { rows: [{ partNumber: "PRIVATE" }] } },
        created_at: NOW,
        updated_at: NOW,
      },
      scenario: {
        id: "scenario-1",
        product_id: "product-1",
        name: "Main",
        target_output: 10,
        target_output_period: "day",
        created_at: NOW,
        updated_at: NOW,
      },
      stations: [
        {
          id: "station-1",
          scenario_id: "scenario-1",
          sequence: 1,
          name: "Station 1",
        },
      ],
      zones: [
        {
          id: "zone-1",
          scenario_id: "scenario-1",
          sequence: 1,
          name: "zone one",
          color: "#111111",
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      tasks: [
        {
          id: "task-1",
          scenario_id: "scenario-1",
          station_id: "station-1",
          zone_id: "zone-1",
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
            stepToolLists: { "step-1": [{ name: "Impact gun" }] },
          },
          version: 7,
          dependency_ids: ["task-older"],
          manufacturing_steps: [{ id: "step-1", sequence: 1, instruction: "Sensitive detail" }],
          part_references: [{ id: "part-1", part_number: "ABC" }],
        },
      ],
    });

    expect(summary.product.name).toBe("FlexBoost");
    expect(summary.product.customFields).toEqual({});
    expect(summary.scenario.id).toBe("scenario-1");
    expect(summary.stations).toHaveLength(1);
    expect(summary.zones).toHaveLength(1);
    expect(summary.tasks).toHaveLength(1);
    expect(summary.tasks[0]).toMatchObject({
      id: "task-1",
      name: "Install assembly",
      version: 7,
      dependencyIds: [],
      manufacturingSteps: [],
      partReferences: [],
      customFields: { operatorIds: ["A"] },
    });
    expect(summary.components).toEqual([]);
    expect(summary.documentTypes).toEqual([]);
    expect(summary.dependencies).toEqual([]);
    expect(summary.actualEvents).toEqual([]);
    expect(summary.customColumns).toEqual([]);
  });
});
