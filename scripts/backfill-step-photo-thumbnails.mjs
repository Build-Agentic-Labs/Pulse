import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(`${process.cwd()}/`);
const sharp = require("sharp");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://neaadefipcpxxcqszpud.supabase.co";
const PROJECT_ID = process.argv[2] || "project-flexboost";
const BUCKET = "step-photos";
const THUMBNAIL_EDGE = 320;

function loadEnvValue(envText, key) {
  const line = envText
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${key}=`));

  if (!line) return undefined;
  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

async function loadServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  }

  try {
    const envText = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    return loadEnvValue(envText, "SUPABASE_SERVICE_ROLE_KEY");
  } catch {
    return undefined;
  }
}

function safeStorageSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function thumbnailStoragePath(photo) {
  const storagePath = String(photo.storage_path);
  const directory = storagePath.includes("/") ? storagePath.slice(0, storagePath.lastIndexOf("/")) : "";
  const fileName = `${safeStorageSegment(photo.id)}.webp`;
  return directory ? `${directory}/thumbnails/${fileName}` : `thumbnails/${fileName}`;
}

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
    const page = await throwIfError(label, await buildQuery().range(from, from + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const serviceKey = await loadServiceKey();
if (!serviceKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
}

const supabase = createClient(SUPABASE_URL, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const products = await selectAll("products", () => supabase.from("products").select("id").eq("project_id", PROJECT_ID));
const productIds = products.map((row) => String(row.id));
const scenarios = productIds.length
  ? await selectAll("scenarios", () => supabase.from("scenarios").select("id").in("product_id", productIds))
  : [];
const scenarioIds = scenarios.map((row) => String(row.id));
const tasks = scenarioIds.length
  ? await selectAll("tasks", () => supabase.from("tasks").select("id").in("scenario_id", scenarioIds))
  : [];
const taskIds = tasks.map((row) => String(row.id));
const photos = taskIds.length
  ? await selectAll("step_photos", () =>
      supabase
        .from("step_photos")
        .select("id,task_id,step_id,storage_path,thumbnail_storage_path")
        .in("task_id", taskIds)
        .is("deleted_at", null)
        .is("thumbnail_storage_path", null),
    )
  : [];

let processed = 0;
let failed = 0;

for (const photo of photos) {
  const sourcePath = String(photo.storage_path ?? "");
  if (!sourcePath) {
    failed += 1;
    console.warn(`skip ${photo.id}: missing storage_path`);
    continue;
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(sourcePath);
    if (error) throw error;

    const sourceBuffer = Buffer.from(await data.arrayBuffer());
    const thumbnailBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const thumbnailPath = thumbnailStoragePath(photo);

    await throwIfError(
      "upload thumbnail",
      await supabase.storage.from(BUCKET).upload(thumbnailPath, thumbnailBuffer, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true,
      }),
    );

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(thumbnailPath);
    await throwIfError(
      "update step photo thumbnail",
      await supabase
        .from("step_photos")
        .update({
          thumbnail_storage_path: thumbnailPath,
          thumbnail_url: publicData.publicUrl,
        })
        .eq("id", photo.id),
    );

    processed += 1;
    if (processed % 25 === 0 || processed === photos.length) {
      console.log(`processed ${processed}/${photos.length}`);
    }
  } catch (error) {
    failed += 1;
    console.warn(`failed ${photo.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({ projectId: PROJECT_ID, candidates: photos.length, processed, failed }, null, 2));
