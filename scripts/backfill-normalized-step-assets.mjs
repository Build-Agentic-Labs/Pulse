import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STEP_TOOL_LISTS_FIELD = "stepToolLists";
const STEP_PHOTO_ATTACHMENTS_FIELD = "stepPhotoAttachments";
const STEP_PHOTO_SUMMARY_FIELD = "stepPhotoSummary";
const STEP_TOOL_SUMMARY_FIELD = "stepToolSummary";
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

function safeStorageSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function cleanToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function dataUrlToUpload(dataUrl, fallbackContentType) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);

  if (!match) {
    throw new Error("Invalid image data URL.");
  }

  const contentType = match[1] || fallbackContentType || "image/jpeg";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const body = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");

  return { body, contentType };
}

function extensionForContentType(contentType = "") {
  const subtype = contentType.split("/")[1]?.toLowerCase().replace("jpeg", "jpg");
  return subtype && /^[a-z0-9]+$/.test(subtype) ? subtype : "jpg";
}

function buildStoragePath(taskId, stepId, photo) {
  if (typeof photo.storagePath === "string" && photo.storagePath.trim()) {
    return photo.storagePath.trim();
  }

  const contentType = typeof photo.contentType === "string" ? photo.contentType : "image/jpeg";
  return [
    safeStorageSegment(taskId),
    safeStorageSegment(stepId),
    `${safeStorageSegment(photo.id)}.${extensionForContentType(contentType)}`,
  ].join("/");
}

function publicUrlForStoragePath(supabase, storagePath) {
  return supabase.storage.from(stepPhotoBucket).getPublicUrl(storagePath).data.publicUrl;
}

async function uploadStorageObjectWithRetry(supabase, storagePath, body, options, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { error } = await supabase.storage.from(stepPhotoBucket).upload(storagePath, body, options);

    if (!error) {
      return;
    }

    lastError = error;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1250));
    }
  }

  throw lastError;
}

function taskPayloadSize(task) {
  return Buffer.byteLength(JSON.stringify(task.custom_fields ?? {}));
}

function summarizePhotos(photoRows) {
  const activeRows = photoRows.filter((photo) => !photo.deleted_at);
  return {
    photoCount: activeRows.length,
    hasPhotos: activeRows.length > 0,
    lastPhotoUploadedAt:
      activeRows
        .map((photo) => photo.captured_at || photo.created_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
  };
}

function summarizeTools(toolRows) {
  return {
    toolCount: toolRows.length,
    hasTools: toolRows.length > 0,
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const cwd = process.cwd();
  const envText = await readFile(path.join(cwd, ".env.local"), "utf8");
  const supabaseUrl = loadEnvValue(envText, "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = loadEnvValue(envText, "NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const reportRoot = path.join(cwd, "backups", `step-assets-backfill-${timestampSlug()}`);
  await mkdir(reportRoot, { recursive: true });

  const [{ data: tasks, error: tasksError }, { data: steps, error: stepsError }] = await Promise.all([
    supabase.from("tasks").select("id,wbs,name,custom_fields").order("wbs"),
    supabase.from("manufacturing_steps").select("id,task_id,sequence").order("sequence"),
  ]);

  if (tasksError) {
    throw tasksError;
  }

  if (stepsError) {
    throw stepsError;
  }

  const [{ data: existingPhotos, error: existingPhotosError }, { data: existingTools, error: existingToolsError }] =
    await Promise.all([
      supabase.from("step_photos").select("*"),
      supabase.from("step_tools").select("*"),
    ]);

  if (existingPhotosError) {
    throw existingPhotosError;
  }

  if (existingToolsError) {
    throw existingToolsError;
  }

  const stepById = new Map((steps ?? []).map((step) => [String(step.id), step]));
  const existingPhotoIds = new Set((existingPhotos ?? []).map((photo) => String(photo.id)));
  const existingPhotoStoragePaths = new Set((existingPhotos ?? []).map((photo) => String(photo.storage_path)));
  const existingToolKeys = new Set(
    (existingTools ?? []).map((tool) => `${tool.step_id}:${String(tool.tool_name).trim().toLocaleLowerCase()}`),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    reportRoot,
    tasks: [],
    totals: {
      tasksExamined: 0,
      taskCustomFieldsUpdated: 0,
      photosDiscovered: 0,
      inlinePhotosDiscovered: 0,
      photoRowsInserted: 0,
      photoRowsSkipped: 0,
      storageUploads: 0,
      toolsDiscovered: 0,
      toolRowsInserted: 0,
      toolRowsSkipped: 0,
      beforeBytes: 0,
      afterBytes: 0,
    },
  };

  for (const task of tasks ?? []) {
    const customFields = isRecord(task.custom_fields) ? task.custom_fields : {};
    const rawPhotoMap = isRecord(customFields[STEP_PHOTO_ATTACHMENTS_FIELD])
      ? customFields[STEP_PHOTO_ATTACHMENTS_FIELD]
      : {};
    const rawToolMap = isRecord(customFields[STEP_TOOL_LISTS_FIELD])
      ? customFields[STEP_TOOL_LISTS_FIELD]
      : {};
    const beforeBytes = taskPayloadSize(task);
    const taskPhotoRows = [];
    const taskToolRows = [];
    const taskReport = {
      taskId: task.id,
      wbs: task.wbs,
      name: task.name,
      beforeBytes,
      afterBytes: beforeBytes,
      photosDiscovered: 0,
      inlinePhotosDiscovered: 0,
      photoRowsInserted: 0,
      photoRowsSkipped: 0,
      storageUploads: 0,
      toolsDiscovered: 0,
      toolRowsInserted: 0,
      toolRowsSkipped: 0,
      warnings: [],
    };

    report.totals.tasksExamined += 1;
    report.totals.beforeBytes += beforeBytes;

    for (const [stepId, rawPhotos] of Object.entries(rawPhotoMap)) {
      if (!Array.isArray(rawPhotos)) {
        continue;
      }

      if (!stepById.has(stepId)) {
        taskReport.warnings.push(`Skipping photos for missing step ${stepId}.`);
        continue;
      }

      for (const rawPhoto of rawPhotos) {
        if (!isRecord(rawPhoto) || typeof rawPhoto.id !== "string") {
          continue;
        }

        const dataUrl = typeof rawPhoto.dataUrl === "string" ? rawPhoto.dataUrl : "";
        const isInline = dataUrl.startsWith("data:image/");
        const isHttp = /^https?:\/\//.test(dataUrl);
        const storagePath = buildStoragePath(task.id, stepId, rawPhoto);
        const alreadyMigrated = existingPhotoIds.has(rawPhoto.id) || existingPhotoStoragePaths.has(storagePath);

        taskReport.photosDiscovered += 1;
        report.totals.photosDiscovered += 1;

        if (isInline) {
          taskReport.inlinePhotosDiscovered += 1;
          report.totals.inlinePhotosDiscovered += 1;
        }

        if (!isInline && !isHttp) {
          taskReport.warnings.push(`Skipping photo ${rawPhoto.id}; no usable image data or URL.`);
          continue;
        }

        const contentType = typeof rawPhoto.contentType === "string" ? rawPhoto.contentType : "image/jpeg";
        let publicUrl = isHttp ? dataUrl : publicUrlForStoragePath(supabase, storagePath);

        if (alreadyMigrated) {
          taskReport.photoRowsSkipped += 1;
          report.totals.photoRowsSkipped += 1;
        } else if (apply) {
          if (isInline) {
            const upload = dataUrlToUpload(dataUrl, contentType);
            await uploadStorageObjectWithRetry(supabase, storagePath, upload.body, {
              cacheControl: "31536000",
              contentType: upload.contentType,
              upsert: true,
            }).catch((uploadError) => {
              throw new Error(`Unable to upload ${task.wbs} / ${stepId} / ${rawPhoto.id}: ${uploadError.message}`);
            });

            publicUrl = publicUrlForStoragePath(supabase, storagePath);
            taskReport.storageUploads += 1;
            report.totals.storageUploads += 1;
          }

          const row = {
            id: rawPhoto.id,
            task_id: task.id,
            step_id: stepId,
            storage_path: storagePath,
            public_url: publicUrl,
            file_name: typeof rawPhoto.name === "string" && rawPhoto.name.trim() ? rawPhoto.name : "Step photo",
            mime_type: contentType,
            size_bytes: typeof rawPhoto.sizeBytes === "number" ? rawPhoto.sizeBytes : null,
            width: typeof rawPhoto.width === "number" ? rawPhoto.width : null,
            height: typeof rawPhoto.height === "number" ? rawPhoto.height : null,
            caption: typeof rawPhoto.caption === "string" ? rawPhoto.caption : null,
            captured_at:
              typeof rawPhoto.capturedAt === "string" && rawPhoto.capturedAt.trim()
                ? rawPhoto.capturedAt
                : new Date().toISOString(),
            uploaded_by: null,
            deleted_at: null,
          };
          const { error: insertPhotoError } = await supabase.from("step_photos").upsert(row);

          if (insertPhotoError) {
            throw new Error(`Unable to insert step photo ${rawPhoto.id}: ${insertPhotoError.message}`);
          }

          taskPhotoRows.push(row);
          existingPhotoIds.add(rawPhoto.id);
          existingPhotoStoragePaths.add(storagePath);
          taskReport.photoRowsInserted += 1;
          report.totals.photoRowsInserted += 1;
        } else {
          taskReport.photoRowsInserted += 1;
          report.totals.photoRowsInserted += 1;
        }
      }
    }

    for (const [stepId, rawTools] of Object.entries(rawToolMap)) {
      if (!Array.isArray(rawTools)) {
        continue;
      }

      if (!stepById.has(stepId)) {
        taskReport.warnings.push(`Skipping tools for missing step ${stepId}.`);
        continue;
      }

      const uniqueTools = rawTools
        .map(cleanToolName)
        .filter(Boolean)
        .filter((tool, index, list) => list.findIndex((item) => item.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index);

      for (const [index, tool] of uniqueTools.entries()) {
        const key = `${stepId}:${tool.toLocaleLowerCase()}`;

        taskReport.toolsDiscovered += 1;
        report.totals.toolsDiscovered += 1;

        if (existingToolKeys.has(key)) {
          taskReport.toolRowsSkipped += 1;
          report.totals.toolRowsSkipped += 1;
          continue;
        }

        const row = {
          id: `tool-${safeStorageSegment(stepId)}-${safeStorageSegment(tool.toLocaleLowerCase())}`,
          task_id: task.id,
          step_id: stepId,
          tool_name: tool,
          sequence: index + 1,
        };

        if (apply) {
          const { error: insertToolError } = await supabase.from("step_tools").upsert(row);

          if (insertToolError) {
            throw new Error(`Unable to insert step tool ${stepId} / ${tool}: ${insertToolError.message}`);
          }

          existingToolKeys.add(key);
        }

        taskToolRows.push(row);
        taskReport.toolRowsInserted += 1;
        report.totals.toolRowsInserted += 1;
      }
    }

    const hasLegacyPayload =
      isRecord(customFields[STEP_PHOTO_ATTACHMENTS_FIELD]) || isRecord(customFields[STEP_TOOL_LISTS_FIELD]);

    if (hasLegacyPayload) {
      const currentDbPhotoRows = (existingPhotos ?? []).filter((photo) => photo.task_id === task.id);
      const currentDbToolRows = (existingTools ?? []).filter((tool) => tool.task_id === task.id);
      const nextCustomFields = { ...customFields };
      delete nextCustomFields[STEP_PHOTO_ATTACHMENTS_FIELD];
      delete nextCustomFields[STEP_TOOL_LISTS_FIELD];
      nextCustomFields[STEP_PHOTO_SUMMARY_FIELD] = summarizePhotos([...currentDbPhotoRows, ...taskPhotoRows]);
      nextCustomFields[STEP_TOOL_SUMMARY_FIELD] = summarizeTools([...currentDbToolRows, ...taskToolRows]);
      taskReport.afterBytes = Buffer.byteLength(JSON.stringify(nextCustomFields));
      report.totals.afterBytes += taskReport.afterBytes;

      if (apply) {
        const { error: updateTaskError } = await supabase
          .from("tasks")
          .update({ custom_fields: nextCustomFields })
          .eq("id", task.id);

        if (updateTaskError) {
          throw new Error(`Unable to update task ${task.wbs} custom_fields: ${updateTaskError.message}`);
        }
      }

      report.totals.taskCustomFieldsUpdated += 1;
    } else {
      report.totals.afterBytes += beforeBytes;
    }

    if (
      taskReport.photosDiscovered > 0 ||
      taskReport.toolsDiscovered > 0 ||
      taskReport.beforeBytes !== taskReport.afterBytes ||
      taskReport.warnings.length > 0
    ) {
      report.tasks.push(taskReport);
    }
  }

  await writeJson(path.join(reportRoot, "report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
