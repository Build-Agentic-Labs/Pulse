import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://neaadefipcpxxcqszpud.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_ID = process.argv[2] || "project-flexboost";
const backupRoot =
  process.argv[3] ||
  path.join(process.cwd(), "backups", `flexboost-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const bucketName = "step-photos";

if (!SERVICE_KEY) {
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY before running this backup.");
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function throwIfError(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data ?? [];
}

async function selectAll(label, buildQuery) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const query = buildQuery().range(from, from + pageSize - 1);
    const page = await throwIfError(label, await query);
    rows.push(...page);
    if (page.length < pageSize) {
      return rows;
    }
  }
}

function byId(rows) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function sortByNumberThenText(a, b, numberKey, textKey = "id") {
  return Number(a[numberKey] ?? 0) - Number(b[numberKey] ?? 0) || String(a[textKey]).localeCompare(String(b[textKey]));
}

function safeFileName(value) {
  return String(value || "unnamed").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function downloadStorageObject(storagePath, localRelativePath, downloads) {
  if (!storagePath || downloads.some((item) => item.storagePath === storagePath)) {
    return;
  }

  const localPath = path.join(backupRoot, localRelativePath);
  await mkdir(path.dirname(localPath), { recursive: true });

  const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
  const record = {
    bucket: bucketName,
    storagePath,
    localPath: localRelativePath.replaceAll("\\", "/"),
    downloaded: false,
    error: null,
  };

  if (error) {
    record.error = error.message;
    downloads.push(record);
    return;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  await writeFile(localPath, buffer);
  record.downloaded = true;
  record.bytes = buffer.length;
  downloads.push(record);
}

const startedAt = new Date().toISOString();
await mkdir(backupRoot, { recursive: true });
await mkdir(path.join(backupRoot, "raw"), { recursive: true });

const project = await throwIfError(
  "projects",
  await supabase.from("projects").select("*").eq("id", PROJECT_ID).maybeSingle(),
);

if (!project) {
  throw new Error(`Project not found: ${PROJECT_ID}`);
}

const workspace = project.workspace_id
  ? await throwIfError("workspaces", await supabase.from("workspaces").select("*").eq("id", project.workspace_id).maybeSingle())
  : null;

const products = await selectAll("products", () => supabase.from("products").select("*").eq("project_id", PROJECT_ID).order("name"));
const productIds = products.map((row) => String(row.id));
const scenarios = productIds.length
  ? await selectAll("scenarios", () => supabase.from("scenarios").select("*").in("product_id", productIds).order("created_at"))
  : [];
const scenarioIds = scenarios.map((row) => String(row.id));
const stations = scenarioIds.length
  ? await selectAll("stations", () => supabase.from("stations").select("*").in("scenario_id", scenarioIds).order("sequence"))
  : [];
const zones = scenarioIds.length
  ? await selectAll("zones", () => supabase.from("zones").select("*").in("scenario_id", scenarioIds).order("sequence"))
  : [];
const tasks = scenarioIds.length
  ? await selectAll("tasks", () => supabase.from("tasks").select("*").in("scenario_id", scenarioIds).order("wbs"))
  : [];
const taskIds = tasks.map((row) => String(row.id));
const manufacturingSteps = taskIds.length
  ? await selectAll("manufacturing_steps", () =>
      supabase.from("manufacturing_steps").select("*").in("task_id", taskIds).order("sequence"),
    )
  : [];
const stepPhotos = taskIds.length
  ? await selectAll("step_photos", () => supabase.from("step_photos").select("*").in("task_id", taskIds).order("captured_at"))
  : [];
const stepTools = taskIds.length
  ? await selectAll("step_tools", () => supabase.from("step_tools").select("*").in("task_id", taskIds).order("sequence"))
  : [];
const partReferences = taskIds.length
  ? await selectAll("part_references", () => supabase.from("part_references").select("*").in("task_id", taskIds).order("created_at"))
  : [];
const actualEvents = taskIds.length
  ? await selectAll("actual_events", () => supabase.from("actual_events").select("*").in("task_id", taskIds).order("timestamp"))
  : [];
const allDependencies = await selectAll("task_dependencies", () => supabase.from("task_dependencies").select("*").order("created_at"));
const taskIdSet = new Set(taskIds);
const taskDependencies = allDependencies.filter(
  (row) => taskIdSet.has(String(row.predecessor_task_id)) || taskIdSet.has(String(row.successor_task_id)),
);
const customColumns = await selectAll("custom_columns", () => supabase.from("custom_columns").select("*").order("created_at"));
const customColumnsForProject = customColumns.filter(
  (row) =>
    (row.product_id && productIds.includes(String(row.product_id))) ||
    (row.scenario_id && scenarioIds.includes(String(row.scenario_id))),
);
const toolLibrary = await selectAll("tool_library", () => supabase.from("tool_library").select("*").order("tool_name"));
const toolLibraryForProject = toolLibrary.filter((row) => row.project_id === null || String(row.project_id) === PROJECT_ID);

const raw = {
  project,
  workspace,
  products,
  scenarios,
  stations,
  zones,
  tasks,
  task_dependencies: taskDependencies,
  manufacturing_steps: manufacturingSteps,
  step_tools: stepTools,
  step_photos: stepPhotos,
  part_references: partReferences,
  actual_events: actualEvents,
  custom_columns: customColumnsForProject,
  tool_library: toolLibraryForProject,
};

for (const [tableName, rows] of Object.entries(raw)) {
  await writeJson(path.join(backupRoot, "raw", `${tableName}.json`), rows);
}

const stationsById = byId(stations);
const zonesById = byId(zones);
const stepsByTaskId = Map.groupBy(manufacturingSteps, (row) => String(row.task_id));
const photosByStepId = Map.groupBy(stepPhotos, (row) => String(row.step_id));
const toolsByStepId = Map.groupBy(stepTools, (row) => String(row.step_id));
const partsByTaskId = Map.groupBy(partReferences, (row) => String(row.task_id));
const eventsByTaskId = Map.groupBy(actualEvents, (row) => String(row.task_id));
const dependenciesBySuccessorId = Map.groupBy(taskDependencies, (row) => String(row.successor_task_id));
const tasksByScenarioId = Map.groupBy(tasks, (row) => String(row.scenario_id));
const stationsByScenarioId = Map.groupBy(stations, (row) => String(row.scenario_id));
const zonesByScenarioId = Map.groupBy(zones, (row) => String(row.scenario_id));
const scenariosByProductId = Map.groupBy(scenarios, (row) => String(row.product_id));

const downloads = [];
for (const photo of stepPhotos) {
  const fileName = safeFileName(photo.file_name || path.basename(photo.storage_path || photo.id));
  const localRelativePath = path.join("assets", "step-photos", ...String(photo.storage_path).split("/"));
  await downloadStorageObject(photo.storage_path, localRelativePath || path.join("assets", "step-photos", `${photo.id}-${fileName}`), downloads);
}

for (const tool of toolLibraryForProject) {
  if (!tool.storage_path) {
    continue;
  }
  const localRelativePath = path.join("assets", "tool-library", ...String(tool.storage_path).split("/"));
  await downloadStorageObject(tool.storage_path, localRelativePath, downloads);
}

function photoWithLocalAsset(photo) {
  const download = downloads.find((item) => item.storagePath === photo.storage_path);
  return {
    ...photo,
    local_asset: download?.downloaded ? download.localPath : null,
    download_error: download?.error ?? null,
  };
}

const structured = {
  metadata: {
    projectId: PROJECT_ID,
    supabaseUrl: SUPABASE_URL,
    exportedAt: new Date().toISOString(),
    startedAt,
    backupRoot,
    counts: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0])),
    downloadedAssets: downloads.filter((item) => item.downloaded).length,
    failedAssetDownloads: downloads.filter((item) => !item.downloaded).length,
  },
  project,
  workspace,
  products: products.map((product) => ({
    ...product,
    scenarios: (scenariosByProductId.get(String(product.id)) ?? []).map((scenario) => ({
      ...scenario,
      stations: (stationsByScenarioId.get(String(scenario.id)) ?? []).sort((a, b) => sortByNumberThenText(a, b, "sequence")),
      zones: (zonesByScenarioId.get(String(scenario.id)) ?? []).sort((a, b) => sortByNumberThenText(a, b, "sequence")),
      tasks: (tasksByScenarioId.get(String(scenario.id)) ?? []).map((task) => ({
        ...task,
        station: task.station_id ? stationsById.get(String(task.station_id)) ?? null : null,
        zone: task.zone_id ? zonesById.get(String(task.zone_id)) ?? null : null,
        dependencies: dependenciesBySuccessorId.get(String(task.id)) ?? [],
        part_references: partsByTaskId.get(String(task.id)) ?? [],
        actual_events: eventsByTaskId.get(String(task.id)) ?? [],
        manufacturing_steps: (stepsByTaskId.get(String(task.id)) ?? [])
          .sort((a, b) => sortByNumberThenText(a, b, "sequence"))
          .map((step) => ({
            ...step,
            tools: (toolsByStepId.get(String(step.id)) ?? []).sort((a, b) => sortByNumberThenText(a, b, "sequence")),
            photos: (photosByStepId.get(String(step.id)) ?? []).map(photoWithLocalAsset),
          })),
      })),
    })),
  })),
  tool_library: toolLibraryForProject.map((tool) => {
    const download = downloads.find((item) => item.storagePath === tool.storage_path);
    return {
      ...tool,
      local_asset: download?.downloaded ? download.localPath : null,
      download_error: download?.error ?? null,
    };
  }),
  custom_columns: customColumnsForProject,
  asset_downloads: downloads,
};

await writeJson(path.join(backupRoot, "structured-flexboost.json"), structured);
await writeJson(path.join(backupRoot, "asset-downloads.json"), downloads);

const lines = [
  "# FlexBoost Backup",
  "",
  `Exported at: ${structured.metadata.exportedAt}`,
  `Supabase project URL: ${SUPABASE_URL}`,
  `Pulse project ID: ${PROJECT_ID}`,
  "",
  "## Contents",
  "",
  "- `structured-flexboost.json`: nested project/product/scenario/task/step data for another Codex agent.",
  "- `raw/*.json`: raw table dumps for exact review or restoration work.",
  "- `assets/step-photos/`: downloaded process/manufacturing step photos from Supabase Storage.",
  "- `assets/tool-library/`: downloaded tool library images from Supabase Storage.",
  "- `asset-downloads.json`: storage download manifest with any errors.",
  "",
  "## Counts",
  "",
  ...Object.entries(structured.metadata.counts).map(([key, value]) => `- ${key}: ${value}`),
  `- downloaded assets: ${structured.metadata.downloadedAssets}`,
  `- failed asset downloads: ${structured.metadata.failedAssetDownloads}`,
  "",
  "## Review Map",
  "",
];

for (const product of structured.products) {
  lines.push(`### Product: ${product.name} (${product.id})`, "");
  for (const scenario of product.scenarios) {
    lines.push(`#### Scenario: ${scenario.name} (${scenario.id})`, "");
    for (const task of scenario.tasks) {
      const stepCount = task.manufacturing_steps.length;
      const photoCount = task.manufacturing_steps.reduce((count, step) => count + step.photos.length, 0);
      const toolCount = task.manufacturing_steps.reduce((count, step) => count + step.tools.length, 0);
      lines.push(`- ${task.wbs} ${task.name} (${task.id})`);
      lines.push(`  - station: ${task.station?.name ?? "none"}; zone: ${task.zone?.name ?? "none"}`);
      lines.push(
        `  - planned: ${task.planned_duration_minutes} min, actual: ${task.actual_duration_minutes ?? "n/a"} min, steps: ${stepCount}, step tools: ${toolCount}, photos: ${photoCount}`,
      );
    }
    lines.push("");
  }
}

await writeFile(path.join(backupRoot, "README.md"), lines.join("\n"), "utf8");

console.log(JSON.stringify(structured.metadata, null, 2));
