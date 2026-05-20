import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
const targetProjectId = process.env.PROJECT_ID ?? "project-flexboost";
const scenarioId = process.env.SCENARIO_ID ?? "scenario-current-state";
const baseMs = Date.parse("2026-05-07T14:00:00.000Z");

const zonesByName: Record<string, { id: string; stationId: string }> = {
  Disassembly: {
    id: "zone-1778193564248",
    stationId: "station-zone-1778193564248",
  },
  "Sub assemblies": {
    id: "zone-1778212216855",
    stationId: "station-zone-1778212216855",
  },
  "FInal Assembly": {
    id: "zone-1778281814293",
    stationId: "station-zone-1778281814293",
  },
};

interface RestoreTask {
  wbs: string;
  zone: keyof typeof zonesByName;
  name: string;
  startMinute: number;
  durationMinutes: number;
  operators: string[];
  dependencyWbs?: string[];
  overTakt?: boolean;
}

const tasks: RestoreTask[] = [
  { wbs: "1", zone: "Disassembly", name: "Fluid Drain", startMinute: 0, durationMinutes: 20, operators: ["C"] },
  { wbs: "2", zone: "Disassembly", name: "Panel Removal", startMinute: 20, durationMinutes: 20, operators: ["D"] },
  { wbs: "3", zone: "Disassembly", name: "Remove Control Cabinet", startMinute: 40, durationMinutes: 20, operators: ["D"] },
  { wbs: "4", zone: "Disassembly", name: "Remove Cooling and After Treatment", startMinute: 60, durationMinutes: 30, operators: ["D"] },
  { wbs: "5", zone: "Disassembly", name: "Engine Removal", startMinute: 90, durationMinutes: 60, operators: ["D"] },
  { wbs: "6", zone: "Disassembly", name: "Remove Fuel tank and Flip", startMinute: 150, durationMinutes: 60, operators: ["D"] },
  { wbs: "7", zone: "Sub assemblies", name: "Battery Build", startMinute: 0, durationMinutes: 1200, operators: [], overTakt: true },
  { wbs: "8", zone: "Sub assemblies", name: "Trailer Build", startMinute: 0, durationMinutes: 240, operators: ["A"] },
  { wbs: "9", zone: "Sub assemblies", name: "Fuel Tank / Containment Package", startMinute: 210, durationMinutes: 120, operators: ["B"], dependencyWbs: ["6"] },
  { wbs: "10", zone: "Sub assemblies", name: "Panel rework station", startMinute: 40, durationMinutes: 60, operators: [], dependencyWbs: ["2"] },
  { wbs: "11", zone: "Sub assemblies", name: "mVEC/DC2DC Build", startMinute: 0, durationMinutes: 12, operators: ["D"] },
  { wbs: "12", zone: "Sub assemblies", name: "Upgrade Control Cabinet", startMinute: 72, durationMinutes: 132, operators: ["C"], dependencyWbs: ["3", "11"] },
  { wbs: "13", zone: "Sub assemblies", name: "Electric Motor / Clutch Stack Build", startMinute: 0, durationMinutes: 120, operators: ["B"] },
  { wbs: "14", zone: "Sub assemblies", name: "Engine, E-Motor, Alternator Build", startMinute: 210, durationMinutes: 120, operators: ["D"], dependencyWbs: ["13", "5"] },
  { wbs: "15", zone: "Sub assemblies", name: "V2 Cooling system with Panel", startMinute: 0, durationMinutes: 120, operators: [] },
  { wbs: "16", zone: "FInal Assembly", name: "Assembly Chassis", startMinute: 330, durationMinutes: 120, operators: ["C"], dependencyWbs: ["9"] },
  { wbs: "17", zone: "FInal Assembly", name: "Install Powertrain Module", startMinute: 450, durationMinutes: 60, operators: ["C"], dependencyWbs: ["16"] },
  { wbs: "18", zone: "FInal Assembly", name: "Install original cooling and after treatment system", startMinute: 510, durationMinutes: 60, operators: ["D"], dependencyWbs: ["17"] },
  { wbs: "19", zone: "FInal Assembly", name: "Reinstall control cabinet", startMinute: 570, durationMinutes: 120, operators: ["C"], dependencyWbs: ["18"] },
  { wbs: "20", zone: "FInal Assembly", name: "Reinstall the panel system", startMinute: 690, durationMinutes: 120, operators: ["D"], dependencyWbs: ["19"] },
  { wbs: "21", zone: "FInal Assembly", name: "Merge Battery and chassis", startMinute: 810, durationMinutes: 60, operators: ["D"], dependencyWbs: ["20"] },
  { wbs: "22", zone: "FInal Assembly", name: "Fluid Replenishment", startMinute: 870, durationMinutes: 30, operators: ["C"], dependencyWbs: ["21"] },
  { wbs: "23", zone: "FInal Assembly", name: "Install on trailer", startMinute: 900, durationMinutes: 60, operators: ["C"], dependencyWbs: ["22", "8"] },
];

function isoAt(minute: number) {
  return new Date(baseMs + minute * 60_000).toISOString();
}

function taskIdForWbs(wbs: string) {
  return `task-flexboost-${wbs}`;
}

async function throwIfError<T>(operation: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await operation;
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

const taskRows = tasks.map((task) => {
  const zone = zonesByName[task.zone];
  return {
    id: taskIdForWbs(task.wbs),
    scenario_id: scenarioId,
    station_id: zone.stationId,
    zone_id: zone.id,
    parent_task_id: null,
    row_type: "task",
    wbs: task.wbs,
    name: task.name,
    description: null,
    planned_start: isoAt(task.startMinute),
    planned_finish: isoAt(task.startMinute + task.durationMinutes),
    planned_duration_minutes: task.durationMinutes,
    actual_start: null,
    actual_finish: null,
    actual_duration_minutes: null,
    planned_operators: task.operators.length,
    actual_operators: null,
    planned_man_hours: (task.durationMinutes / 60) * task.operators.length,
    actual_man_hours: null,
    status: task.wbs === "1" ? "ready" : "not_started",
    percent_complete: 0,
    owner_id: null,
    owner_name: null,
    role: null,
    skill_level: null,
    critical_path: false,
    bottleneck_flag: Boolean(task.overTakt),
    quality_gate: false,
    traveler_signoff_required: false,
    sop_link: null,
    work_instruction_link: null,
    drawing_link: null,
    material_kit: null,
    tools_required: [],
    equipment_required: [],
    safety_notes: null,
    qc_checklist: null,
    rework_risk: null,
    notes: null,
    custom_fields: {
      operatorIds: task.operators,
    },
  };
});

const dependencyRows = tasks.flatMap((task) =>
  (task.dependencyWbs ?? []).map((predecessorWbs, index) => ({
    id: `dep-${taskIdForWbs(predecessorWbs)}-${taskIdForWbs(task.wbs)}-${index}`,
    predecessor_task_id: taskIdForWbs(predecessorWbs),
    successor_task_id: taskIdForWbs(task.wbs),
    type: "finish_to_start",
    lag_minutes: 0,
    constraint_type: null,
  })),
);

async function main() {
  if (process.env.ALLOW_RESTORE_CURRENT_STATE !== "true") {
    throw new Error("Restore is locked. Set ALLOW_RESTORE_CURRENT_STATE=true and PROJECT_ID to run this project-scoped reset.");
  }

  if (!serviceRoleKey) {
    throw new Error("Restore requires SUPABASE_SERVICE_ROLE_KEY after workspace RLS is enabled.");
  }

  const scenario = await throwIfError(supabase.from("scenarios").select("id,product_id").eq("id", scenarioId).maybeSingle());
  if (!scenario) {
    throw new Error(`Scenario ${scenarioId} was not found.`);
  }

  const product = await throwIfError(supabase.from("products").select("id,project_id").eq("id", scenario.product_id).maybeSingle());
  if (!product || product.project_id !== targetProjectId) {
    throw new Error(`Scenario ${scenarioId} does not belong to project ${targetProjectId}.`);
  }

  const restoreTaskIds = taskRows.map((task) => task.id);

  await throwIfError(supabase.from("task_dependencies").delete().in("successor_task_id", restoreTaskIds));
  await throwIfError(supabase.from("task_dependencies").delete().in("predecessor_task_id", restoreTaskIds));
  await throwIfError(supabase.from("manufacturing_steps").delete().in("task_id", restoreTaskIds));
  await throwIfError(supabase.from("part_references").delete().in("task_id", restoreTaskIds));
  await throwIfError(supabase.from("actual_events").delete().in("task_id", restoreTaskIds));
  await throwIfError(supabase.from("tasks").delete().eq("scenario_id", scenarioId));
  await throwIfError(supabase.from("tasks").insert(taskRows));

  if (dependencyRows.length) {
    await throwIfError(supabase.from("task_dependencies").insert(dependencyRows));
  }

  const { count } = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("scenario_id", scenarioId);
  console.log(`Restored ${count ?? taskRows.length} FlexBoost Gantt task(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
