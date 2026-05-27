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
if (!serviceRoleKey) {
  throw new Error("Backfill requires SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey);
const targetProjectId = process.env.PROJECT_ID ?? "project-flexboost";
const scenarioId = process.env.SCENARIO_ID ?? "scenario-current-state";
const now = new Date().toISOString();

const zonesByName = {
  Disassembly: { id: "zone-1778193564248", code: "DIS" },
  "Sub assemblies": { id: "zone-1778212216855", code: "SUB" },
  "Final Assembly": { id: "zone-1778281814293", code: "FIN" },
};

const components = [
  { code: "FLD", name: "Fluids / Safe Prep" },
  { code: "PNL", name: "Panel System" },
  { code: "CCB", name: "Control Cabinet" },
  { code: "CDF", name: "Cooling / DEF / Aftertreatment" },
  { code: "EAM", name: "Engine / Alternator Module" },
  { code: "PTM", name: "Powertrain Module" },
  { code: "TNK", name: "Fuel Tank / Chassis Prep" },
  { code: "BAT", name: "Battery Pack" },
  { code: "TRL", name: "Trailer" },
  { code: "MVC", name: "MVEC / DC2DC Electrical Build" },
  { code: "EMO", name: "E-Motor Assembly" },
  { code: "CLU", name: "Clutch Assembly" },
  { code: "ALT", name: "Alternator Assembly" },
];

const documentTypes = [
  { code: "WI", name: "Work Instruction" },
  { code: "QC", name: "Quality Check" },
  { code: "MAT", name: "Material List" },
  { code: "TRV", name: "Traveler" },
];

const taskCodeMap = {
  "task-flexboost-1": ["FLD", "DIS", 10],
  "task-flexboost-2": ["PNL", "DIS", 10],
  "task-flexboost-3": ["CCB", "DIS", 10],
  "task-flexboost-4": ["CDF", "DIS", 10],
  "task-flexboost-5": ["EAM", "DIS", 10],
  "task-flexboost-6": ["TNK", "DIS", 10],
  "task-flexboost-7": ["BAT", "SUB", 10],
  "task-flexboost-8": ["TRL", "SUB", 10],
  "task-flexboost-9": ["TNK", "SUB", 10],
  "task-flexboost-10": ["PNL", "SUB", 10],
  "task-flexboost-11": ["MVC", "SUB", 10],
  "task-flexboost-12": ["CCB", "SUB", 10],
  "task-flexboost-14": ["EMO", "SUB", 10],
  "task-1778789409179": ["CLU", "SUB", 10],
  "task-flexboost-15": ["CDF", "SUB", 10],
  "task-flexboost-17": ["ALT", "SUB", 10],
  "task-flexboost-18": ["CDF", "FIN", 10],
  "task-flexboost-19": ["CCB", "FIN", 10],
  "task-flexboost-20": ["PNL", "FIN", 10],
  "task-flexboost-21": ["BAT", "FIN", 10],
  "task-flexboost-22": ["FLD", "FIN", 10],
  "task-flexboost-23": ["TRL", "FIN", 20],
  "task-1779302977922": ["PTM", "FIN", 10],
};

async function throwIfError(label, operation) {
  const { data, error } = await operation;
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }

  return data;
}

const scenario = await throwIfError(
  "load scenario",
  supabase.from("scenarios").select("id, product_id").eq("id", scenarioId).maybeSingle(),
);
if (!scenario) {
  throw new Error(`Scenario not found: ${scenarioId}`);
}

const product = await throwIfError(
  "load product",
  supabase.from("products").select("id, project_id").eq("id", scenario.product_id).maybeSingle(),
);
if (!product || product.project_id !== targetProjectId) {
  throw new Error(`Scenario ${scenarioId} does not belong to project ${targetProjectId}.`);
}

await throwIfError("update product code", supabase.from("products").update({ product_code: "FB-V2" }).eq("id", product.id));

for (const zone of Object.values(zonesByName)) {
  await throwIfError("update zone code", supabase.from("zones").update({ code: zone.code }).eq("id", zone.id));
}

await throwIfError(
  "upsert components",
  supabase.from("manufacturing_components").upsert(
    components.map((component, index) => ({
      id: `component-flexboost-${component.code.toLowerCase()}`,
      scenario_id: scenarioId,
      zone_id: null,
      code: component.code,
      name: component.name,
      description: null,
      sequence: index + 1,
      active: true,
      created_at: now,
      updated_at: now,
    })),
  ),
);

await throwIfError(
  "upsert document types",
  supabase.from("document_type_codes").upsert(
    documentTypes.map((documentType) => ({
      id: `document-type-flexboost-${documentType.code.toLowerCase()}`,
      project_id: null,
      product_id: product.id,
      code: documentType.code,
      name: documentType.name,
      active: true,
      created_at: now,
      updated_at: now,
    })),
  ),
);

const existingTasks = await throwIfError(
  "load tasks",
  supabase.from("tasks").select("id").eq("scenario_id", scenarioId).in("id", Object.keys(taskCodeMap)),
);
const existingTaskIds = new Set(existingTasks.map((task) => task.id));
let updatedTasks = 0;

for (const [taskId, [componentCode, zoneCode, taskNumber]] of Object.entries(taskCodeMap)) {
  if (!existingTaskIds.has(taskId)) {
    continue;
  }

  await throwIfError(
    `update ${taskId}`,
    supabase
      .from("tasks")
      .update({
        component_id: `component-flexboost-${componentCode.toLowerCase()}`,
        task_number: taskNumber,
        manufacturing_code: `${componentCode}-${zoneCode}-${taskNumber}`,
        code_locked: false,
        code_generated_at: now,
      })
      .eq("id", taskId),
  );
  updatedTasks += 1;
}

console.log(JSON.stringify({ productId: product.id, scenarioId, components: components.length, documentTypes: documentTypes.length, updatedTasks }, null, 2));
