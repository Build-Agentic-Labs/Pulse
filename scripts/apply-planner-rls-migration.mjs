import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260521120000_fix_planner_seed_insert_rls.sql",
);

const countTables = [
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
];

function loadEnvValue(envText, key) {
  const line = envText
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${key}=`));

  if (!line) {
    return undefined;
  }

  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  try {
    const envText = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    const fromFile = loadEnvValue(envText, "DATABASE_URL");
    if (fromFile) {
      return fromFile;
    }
  } catch {
    // .env.local is optional when DATABASE_URL is exported in the shell.
  }

  return undefined;
}

function assertMigrationIsNonDestructive(sql) {
  const forbidden = [
    /\bdrop\s+table\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /\bdrop\s+schema\b/i,
    /\balter\s+table\b.+\bdrop\s+column\b/is,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(sql)) {
      throw new Error(`Refusing to run migration: matched unsafe pattern ${pattern}`);
    }
  }
}

async function countRows(client) {
  const counts = {};

  for (const table of countTables) {
    const result = await client.query(`select count(*)::int as count from public.${table}`);
    counts[table] = result.rows[0]?.count ?? 0;
  }

  return counts;
}

async function main() {
  const databaseUrl = await loadDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Add it to .env.local from Supabase Dashboard → Project Settings → Database → Connection string (URI).",
    );
  }

  const sql = await readFile(migrationPath, "utf8");
  assertMigrationIsNonDestructive(sql);

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const before = await countRows(client);
    console.log("Row counts before migration:");
    console.log(before);

    await client.query("begin");
    await client.query(sql);
    await client.query("commit");

    const after = await countRows(client);
    console.log("Row counts after migration:");
    console.log(after);

    for (const table of countTables) {
      if (before[table] !== after[table]) {
        throw new Error(`Row count changed for ${table}: ${before[table]} → ${after[table]}`);
      }
    }

    console.log("Migration applied successfully. No table row counts changed.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
