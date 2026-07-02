// Reconcile Storage objects against the DB rows that reference them, and optionally delete orphans.
//
// The step-photos and task-videos buckets accumulate orphaned objects when rows were hard-deleted
// without storage cleanup (historical task deletes, failed uploads). This script:
//   1. lists every object in both buckets (recursive folder walk),
//   2. collects every storage_path / thumbnail_storage_path referenced by step_photos,
//      step_exploded_views, task_videos and tool_library — INCLUDING soft-deleted rows, whose
//      objects are still referenced and must NOT be treated as orphans,
//   3. prints the objects nothing references, and
//   4. deletes them only when run with --delete (dry-run by default).
//
// Usage:
//   node --env-file=.env.local scripts/cleanup-orphaned-storage.mjs           # dry run (default)
//   node --env-file=.env.local scripts/cleanup-orphaned-storage.mjs --delete  # remove orphans

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run with node --env-file=.env.local).",
  );
  process.exit(1);
}

const DELETE_MODE = process.argv.includes("--delete");
const LIST_PAGE_SIZE = 1000;
const SELECT_PAGE_SIZE = 1000;
const REMOVE_CHUNK_SIZE = 100;

// Which tables reference each bucket's objects. Photos, exploded views and tool-library images all
// share the step-photos bucket; build animations live in task-videos.
const BUCKET_SOURCES = {
  "step-photos": [
    { table: "step_photos", columns: ["storage_path", "thumbnail_storage_path"] },
    { table: "step_exploded_views", columns: ["storage_path", "thumbnail_storage_path"] },
    { table: "tool_library", columns: ["storage_path"] },
  ],
  "task-videos": [{ table: "task_videos", columns: ["storage_path", "thumbnail_storage_path"] }],
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function throwIfError(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data ?? [];
}

async function selectAll(label, buildQuery) {
  const rows = [];

  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const page = throwIfError(label, await buildQuery().range(from, from + SELECT_PAGE_SIZE - 1));
    rows.push(...page);
    if (page.length < SELECT_PAGE_SIZE) return rows;
  }
}

// Storage list() is per-folder, so walk the tree: entries without an id are folders.
async function listObjectPaths(bucket, prefix = "") {
  const paths = [];

  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const entries = throwIfError(
      `list ${bucket}/${prefix || "(root)"}`,
      await supabase.storage.from(bucket).list(prefix, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    );

    for (const entry of entries) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) {
        paths.push(entryPath);
      } else {
        paths.push(...(await listObjectPaths(bucket, entryPath)));
      }
    }

    if (entries.length < LIST_PAGE_SIZE) return paths;
  }
}

async function collectReferencedPaths(sources) {
  const referenced = new Set();

  for (const source of sources) {
    // No deleted_at filter on purpose: soft-deleted rows still reference their objects.
    const rows = await selectAll(source.table, () => supabase.from(source.table).select(source.columns.join(",")));
    for (const row of rows) {
      for (const column of source.columns) {
        const value = row[column];
        if (typeof value === "string" && value) {
          referenced.add(value);
        }
      }
    }
    console.log(`  ${source.table}: ${rows.length} rows (soft-deleted included)`);
  }

  return referenced;
}

async function removeInChunks(bucket, paths) {
  let removed = 0;

  for (let start = 0; start < paths.length; start += REMOVE_CHUNK_SIZE) {
    const chunk = paths.slice(start, start + REMOVE_CHUNK_SIZE);
    throwIfError(`remove from ${bucket}`, await supabase.storage.from(bucket).remove(chunk));
    removed += chunk.length;
    console.log(`  removed ${removed}/${paths.length}`);
  }

  return removed;
}

console.log(`Mode: ${DELETE_MODE ? "DELETE (orphans will be removed)" : "dry run (pass --delete to remove)"}`);

let totalObjects = 0;
let totalOrphans = 0;
let totalRemoved = 0;

for (const [bucket, sources] of Object.entries(BUCKET_SOURCES)) {
  console.log(`\n== bucket: ${bucket} ==`);

  const objectPaths = await listObjectPaths(bucket);
  console.log(`${objectPaths.length} objects in Storage`);
  const referenced = await collectReferencedPaths(sources);
  console.log(`${referenced.size} distinct referenced paths`);

  const orphans = objectPaths.filter((path) => !referenced.has(path));
  totalObjects += objectPaths.length;
  totalOrphans += orphans.length;

  if (orphans.length === 0) {
    console.log("No orphaned objects.");
    continue;
  }

  console.log(`${orphans.length} orphaned object(s):`);
  for (const path of orphans) {
    console.log(`  ${DELETE_MODE ? "DELETE" : "orphan"} ${bucket}/${path}`);
  }

  if (DELETE_MODE) {
    totalRemoved += await removeInChunks(bucket, orphans);
  }
}

console.log(
  `\nDone. ${totalObjects} objects scanned, ${totalOrphans} orphaned, ${
    DELETE_MODE ? `${totalRemoved} removed.` : "0 removed (dry run — rerun with --delete to remove them)."
  }`,
);
