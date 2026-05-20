import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const backupTables = [
  "workspaces",
  "workspace_members",
  "projects",
  "products",
  "scenarios",
  "stations",
  "zones",
  "tasks",
  "task_dependencies",
  "manufacturing_steps",
  "part_references",
  "actual_events",
  "custom_columns",
  "step_photos",
  "step_tools",
];

const STEP_TOOL_LISTS_FIELD = "stepToolLists";
const STEP_PHOTO_ATTACHMENTS_FIELD = "stepPhotoAttachments";
const STEP_PART_REFERENCE_IDS_FIELD = "stepPartReferenceIds";
const STEP_PART_REFERENCE_REF_PREFIX = "part:";
const stepPhotoBucket = "step-photos";

function loadEnvValue(envText, key) {
  const line = envText
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${key}=`));

  if (!line) {
    return undefined;
  }

  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getCustomFields(task) {
  return isRecord(task.custom_fields) ? task.custom_fields : {};
}

function extractProcedureHelpers(tasks, manufacturingSteps = [], stepPhotos = [], normalizedStepTools = []) {
  const stepTools = [];
  const stepPartReferences = [];
  const stepPhotoAttachments = [];
  const inlinePhotoDataUrls = [];
  const storageReferences = new Set();

  tasks.forEach((task) => {
    const customFields = getCustomFields(task);
    const rawStepTools = isRecord(customFields[STEP_TOOL_LISTS_FIELD])
      ? customFields[STEP_TOOL_LISTS_FIELD]
      : {};
    const rawStepPartReferences = isRecord(customFields[STEP_PART_REFERENCE_IDS_FIELD])
      ? customFields[STEP_PART_REFERENCE_IDS_FIELD]
      : {};
    const rawStepPhotos = isRecord(customFields[STEP_PHOTO_ATTACHMENTS_FIELD])
      ? customFields[STEP_PHOTO_ATTACHMENTS_FIELD]
      : {};

    Object.entries(rawStepTools).forEach(([stepId, tools]) => {
      stepTools.push({
        taskId: task.id,
        taskWbs: task.wbs,
        taskName: task.name,
        stepId,
        tools: Array.isArray(tools) ? tools : [],
      });
    });

    Object.entries(rawStepPartReferences).forEach(([stepId, partReferenceIds]) => {
      stepPartReferences.push({
        taskId: task.id,
        taskWbs: task.wbs,
        taskName: task.name,
        stepId,
        partReferenceIds: Array.isArray(partReferenceIds)
          ? partReferenceIds.filter((partReferenceId) => typeof partReferenceId === "string")
          : [],
      });
    });

    Object.entries(rawStepPhotos).forEach(([stepId, photos]) => {
      if (!Array.isArray(photos)) {
        return;
      }

      photos.forEach((photo) => {
        if (!isRecord(photo)) {
          return;
        }

        const attachment = {
          taskId: task.id,
          taskWbs: task.wbs,
          taskName: task.name,
          stepId,
          ...photo,
        };

        stepPhotoAttachments.push(attachment);

        if (typeof photo.dataUrl === "string" && photo.dataUrl.startsWith("data:image/")) {
          inlinePhotoDataUrls.push({
            taskId: task.id,
            taskWbs: task.wbs,
            taskName: task.name,
            stepId,
            photoId: photo.id,
            name: photo.name,
            capturedAt: photo.capturedAt,
            contentType: photo.contentType,
            sizeBytes: photo.sizeBytes,
            dataUrl: photo.dataUrl,
          });
        }

        if (typeof photo.storagePath === "string" && photo.storagePath.trim()) {
          storageReferences.add(photo.storagePath);
        }
      });
    });
  });

  manufacturingSteps.forEach((step) => {
    const partReferenceIds = Array.isArray(step.dependency_ids)
      ? step.dependency_ids
          .filter((dependencyId) => typeof dependencyId === "string" && dependencyId.startsWith(STEP_PART_REFERENCE_REF_PREFIX))
          .map((dependencyId) => dependencyId.slice(STEP_PART_REFERENCE_REF_PREFIX.length))
      : [];

    if (partReferenceIds.length > 0) {
      stepPartReferences.push({
        taskId: step.task_id,
        taskWbs: null,
        taskName: null,
        stepId: step.id,
        partReferenceIds,
        source: "manufacturing_steps.dependency_ids",
      });
    }
  });

  stepPhotos.forEach((photo) => {
    if (typeof photo.storage_path === "string" && photo.storage_path.trim()) {
      storageReferences.add(photo.storage_path);
    }
  });

  normalizedStepTools.forEach((tool) => {
    stepTools.push({
      taskId: tool.task_id,
      stepId: tool.step_id,
      tools: [tool.tool_name].filter(Boolean),
      source: "step_tools",
    });
  });

  return {
    stepTools,
    stepPartReferences,
    stepPhotoAttachments,
    inlinePhotoDataUrls,
    storageReferences: [...storageReferences].sort(),
  };
}

async function listStorageObjects(supabase, prefix = "") {
  const { data, error } = await supabase.storage.from(stepPhotoBucket).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    throw error;
  }

  const objects = [];

  for (const item of data ?? []) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      objects.push(...(await listStorageObjects(supabase, name)));
      continue;
    }

    objects.push({
      bucket: stepPhotoBucket,
      path: name,
      id: item.id,
      name: item.name,
      updatedAt: item.updated_at,
      createdAt: item.created_at,
      lastAccessedAt: item.last_accessed_at,
      metadata: item.metadata,
    });
  }

  return objects;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const cwd = process.cwd();
  const envText = await readFile(path.join(cwd, ".env.local"), "utf8");
  const supabaseUrl = loadEnvValue(envText, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? loadEnvValue(envText, "SUPABASE_SERVICE_ROLE_KEY");
  const supabaseKey = serviceRoleKey ?? loadEnvValue(envText, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const targetWorkspaceId = process.env.WORKSPACE_ID || "";
  const targetProjectId = process.env.PROJECT_ID || "project-flexboost";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL and Supabase key in .env.local.");
  }

  if (!serviceRoleKey && process.env.ALLOW_ANON_BACKUP !== "true") {
    throw new Error("Project-scoped backups need SUPABASE_SERVICE_ROLE_KEY after RLS. Set ALLOW_ANON_BACKUP=true only for pre-RLS local backups.");
  }

  const backupRoot = path.join(cwd, "backups", `procedure-data-${timestampSlug()}`);
  const rawDir = path.join(backupRoot, "raw");
  const extractedDir = path.join(backupRoot, "extracted");
  await mkdir(rawDir, { recursive: true });
  await mkdir(extractedDir, { recursive: true });

  const supabase = createClient(supabaseUrl, supabaseKey);
  const tableData = {};

  async function readTable(table, queryBuilder = (query) => query) {
    const { data, error } = await queryBuilder(supabase.from(table).select("*"));
    if (error) {
      throw new Error(`Unable to back up ${table}: ${error.message}`);
    }

    tableData[table] = data ?? [];
    await writeJson(path.join(rawDir, `${table}.json`), tableData[table]);
  }

  await readTable("projects", (query) => {
    let scoped = query;
    if (targetProjectId) scoped = scoped.eq("id", targetProjectId);
    if (targetWorkspaceId) scoped = scoped.eq("workspace_id", targetWorkspaceId);
    return scoped;
  });

  const projectIds = new Set((tableData.projects ?? []).map((project) => project.id));
  const workspaceIds = new Set((tableData.projects ?? []).map((project) => project.workspace_id).filter(Boolean));
  if (targetWorkspaceId) workspaceIds.add(targetWorkspaceId);

  await readTable("workspaces", (query) => (workspaceIds.size ? query.in("id", [...workspaceIds]) : query));
  await readTable("workspace_members", (query) => (workspaceIds.size ? query.in("workspace_id", [...workspaceIds]) : query));
  await readTable("products", (query) => (projectIds.size ? query.in("project_id", [...projectIds]) : query));

  const productIds = new Set((tableData.products ?? []).map((product) => product.id));
  await readTable("scenarios", (query) => (productIds.size ? query.in("product_id", [...productIds]) : query));

  const scenarioIds = new Set((tableData.scenarios ?? []).map((scenario) => scenario.id));
  await readTable("stations", (query) => (scenarioIds.size ? query.in("scenario_id", [...scenarioIds]) : query));
  await readTable("zones", (query) => (scenarioIds.size ? query.in("scenario_id", [...scenarioIds]) : query));
  await readTable("tasks", (query) => (scenarioIds.size ? query.in("scenario_id", [...scenarioIds]) : query));

  const taskIds = new Set((tableData.tasks ?? []).map((task) => task.id));
  await readTable("task_dependencies", (query) => (taskIds.size ? query.in("successor_task_id", [...taskIds]) : query));
  await readTable("manufacturing_steps", (query) => (taskIds.size ? query.in("task_id", [...taskIds]) : query));
  await readTable("part_references", (query) => (taskIds.size ? query.in("task_id", [...taskIds]) : query));
  await readTable("actual_events", (query) => (taskIds.size ? query.in("task_id", [...taskIds]) : query));
  await readTable("step_photos", (query) => (taskIds.size ? query.in("task_id", [...taskIds]) : query));
  await readTable("step_tools", (query) => (taskIds.size ? query.in("task_id", [...taskIds]) : query));
  await readTable("custom_columns", (query) => {
    if (!productIds.size && !scenarioIds.size) return query;
    const filters = [];
    if (productIds.size) filters.push(`product_id.in.(${[...productIds].join(",")})`);
    if (scenarioIds.size) filters.push(`scenario_id.in.(${[...scenarioIds].join(",")})`);
    return query.or(filters.join(","));
  });

  let storageObjects = [];
  let storageListError;

  try {
    storageObjects = await listStorageObjects(supabase);
  } catch (error) {
    storageListError = error instanceof Error ? error.message : "Unable to list step photo storage objects.";
  }

  const helpers = extractProcedureHelpers(
    tableData.tasks ?? [],
    tableData.manufacturing_steps ?? [],
    tableData.step_photos ?? [],
    tableData.step_tools ?? [],
  );
  const listedStoragePaths = storageObjects.map((object) => object.path);
  const allStorageReferences = [...new Set([...helpers.storageReferences, ...listedStoragePaths])].sort();

  await writeJson(path.join(rawDir, "step_photo_storage_objects.json"), storageObjects);
  await writeJson(path.join(extractedDir, "step_tools.json"), helpers.stepTools);
  await writeJson(path.join(extractedDir, "step_part_references.json"), helpers.stepPartReferences);
  await writeJson(path.join(extractedDir, "step_photo_attachments.json"), helpers.stepPhotoAttachments);
  await writeJson(path.join(extractedDir, "inline_photo_data_urls.json"), helpers.inlinePhotoDataUrls);
  await writeJson(path.join(extractedDir, "step_photo_storage_references.json"), allStorageReferences);
  await writeJson(path.join(backupRoot, "procedure-data-full.json"), {
    generatedAt: new Date().toISOString(),
    tables: tableData,
    extracted: {
      ...helpers,
      storageReferences: allStorageReferences,
      storageObjects,
    },
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    scope: {
      workspaceId: targetWorkspaceId || null,
      projectId: targetProjectId || null,
    },
    backupRoot,
    tableCounts: Object.fromEntries(Object.entries(tableData).map(([table, rows]) => [table, rows.length])),
    extractedCounts: {
      stepTools: helpers.stepTools.length,
      stepPartReferences: helpers.stepPartReferences.length,
      stepPhotoAttachments: helpers.stepPhotoAttachments.length,
      inlinePhotoDataUrls: helpers.inlinePhotoDataUrls.length,
      stepPhotoStorageReferences: allStorageReferences.length,
      listedStepPhotoStorageObjects: storageObjects.length,
    },
    storageListError,
    note: "Read-only project-scoped backup of planner, procedure, tool, and photo metadata.",
  };

  await writeJson(path.join(backupRoot, "manifest.json"), manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
