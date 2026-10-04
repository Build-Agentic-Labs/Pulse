// Characterization of the row serializers and mappers that Phase 4 moves (row-mappers.ts): a planner
// state saved with the real shell save and read back with the real task loader keeps every planning
// field. The step-scoped media and tool maps are stripped from the task row and rebuilt from their own
// rows. Runs against an in-memory client injected as the browser singleton.
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { EXPLODED_VIEWS_FIELD } from "@/domain/step-exploded-views";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "@/domain/step-photos";
import { STEP_TOOL_LISTS_FIELD } from "@/domain/step-tools";
import { TASK_VIDEOS_FIELD } from "@/domain/task-videos";
import type { PlannerState, Task } from "@/domain/types";
import { createInMemorySupabase } from "@/test-support/in-memory-supabase";
import { loadTaskFromSupabase, savePlannerShellToSupabase } from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

let db: ReturnType<typeof createInMemorySupabase>;
beforeEach(() => {
  db = createInMemorySupabase({ projectId: "project-1" });
  (globalThis as { __buildlogicPlannerSupabaseClient?: unknown }).__buildlogicPlannerSupabaseClient = db.client;
});

const task: Task = {
  id: "task-1", scenarioId: "scenario-1", stationId: "station-1", zoneId: "zone-1", componentId: "component-1",
  taskNumber: 7, manufacturingCode: "EB-07", codeLocked: true, codeGeneratedAt: "2026-10-01T00:00:00.000Z",
  rowType: "task", wbs: "1.2", name: "Fit the bracket", description: "Two bolts", plannedStart: "2h",
  plannedFinish: "3h", plannedDurationMinutes: 60, actualStart: "2h", actualFinish: "3h", actualDurationMinutes: 55,
  plannedOperators: 2, actualOperators: 1, plannedManHours: 2, actualManHours: 1.5, status: "in_progress",
  percentComplete: 40, ownerName: "Pat", role: "Fitter", skillLevel: "B", dependencyIds: [], criticalPath: true,
  bottleneckFlag: false, qualityGate: true, travelerSignoffRequired: true, sopLink: "https://sop.test",
  workInstructionLink: "https://wi.test", drawingLink: "https://dwg.test", materialKit: "Kit 4",
  toolsRequired: ["Hex Key"], equipmentRequired: ["Hoist"], safetyNotes: "Gloves", qcChecklist: "Torque",
  reworkRisk: "low", notes: "Note",
  customFields: {
    keep: "custom value",
    stepPartMentions: { "step-1": ["P-1"] },
    [STEP_TOOL_LISTS_FIELD]: { "step-1": ["Stale local tool"] },
    [STEP_PHOTO_ATTACHMENTS_FIELD]: { "step-1": [] },
    [EXPLODED_VIEWS_FIELD]: [],
    [TASK_VIDEOS_FIELD]: [],
  },
  manufacturingSteps: [], partReferences: [], version: 1,
} as unknown as Task;

const state: PlannerState = {
  ...emptyPlannerState,
  product: { ...emptyPlannerState.product, id: "product-1", projectId: "project-1", name: "FlexBoost", customFields: { family: "EBOSS" } },
  scenario: { ...emptyPlannerState.scenario, id: "scenario-1", productId: "product-1", name: "Main" },
  stations: [{ id: "station-1", scenarioId: "scenario-1", sequence: 1, name: "Assembly", ownerName: "", plannedCycleMinutes: 60,
    plannedOperators: 2, plannedManHours: 2, taktStatus: "missing", bottleneckFlag: false, area: "Bay 1" }],
  zones: [{ id: "zone-1", scenarioId: "scenario-1", sequence: 1, name: "Assembly", color: "#15756d",
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
  tasks: [task],
} as PlannerState;

it("keeps every planning field of a task through the shell save and the task loader", async () => {
  await savePlannerShellToSupabase(state, db.client as never);

  const stored = db.rows("tasks")[0]!;
  expect(stored.custom_fields).toEqual({ keep: "custom value", stepPartMentions: { "step-1": ["P-1"] } });
  expect(stored).toMatchObject({ id: "task-1", scenario_id: "scenario-1", station_id: "station-1", zone_id: "zone-1",
    wbs: "1.2", planned_duration_minutes: 60, tools_required: ["Hex Key"], code_locked: true });
  expect(db.rows("products")[0]).toMatchObject({ id: "product-1", project_id: "project-1", name: "FlexBoost" });
  expect(db.rows("stations").map((row) => row.id)).toEqual(["station-1"]);
  expect(db.rows("zones").map((row) => row.id)).toEqual(["zone-1"]);

  // Step rows live in their own tables; the loader rebuilds the step tool map from step_tools.
  db.seed("manufacturing_steps", [{ id: "step-1", task_id: "task-1", sequence: 1, name: "Fit", instruction: "Fit it", duration_minutes: 5, quality_check: null, dependency_ids: [], version: 3 }]);
  db.seed("step_tools", [{ id: "tool-step-1-hex-key", task_id: "task-1", step_id: "step-1", tool_name: "Hex Key", sequence: 1 }]);
  const loaded = await loadTaskFromSupabase("task-1", "project-1");

  const planningFields = (value: Task) => {
    const { customFields: _customFields, manufacturingSteps: _steps, partReferences: _parts, version: _version, ...rest } = value as Task & { version?: number };
    return rest;
  };
  expect(planningFields(loaded!)).toEqual(planningFields(task));
  expect(loaded!.customFields).toMatchObject({ keep: "custom value", stepPartMentions: { "step-1": ["P-1"] }, stepToolLists: { "step-1": ["Hex Key"] } });
  expect(loaded!.manufacturingSteps).toEqual([expect.objectContaining({ id: "step-1", sequence: 1, name: "Fit", instruction: "Fit it", durationMinutes: 5, version: 3 })]);
});
