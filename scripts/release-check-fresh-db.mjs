// Release check on a FRESH, disposable local database that holds only the active migrations.
//
// The retained isolated database (project "pulse-e2e", scratch/browser-db) also contains isolated,
// unapproved functions, so passing there cannot prove the app no longer needs them. This script:
//   1. snapshots the retained database (migration ledger + exact row counts) and records whether it
//      was running, then stops it if needed so the fixed test ports are free (data kept);
//   2. creates a NEW project with a unique id (pulse-release-<timestamp>) in its own workdir, after
//      proving no container, volume or workdir with that identity exists. Initialization comes from
//      `supabase start` on that brand-new volume, from a copy of supabase/migrations + seed.sql only.
//      It never resets anything: an unexpected existing database makes it stop instead;
//   3. verifies the exact identity (project label, data volume, the containers publishing the test
//      ports), that the ledger equals the active migration files, and that the isolated objects are
//      absent; then runs the active pgTAP suite, the browser suite, and a static source check;
//   4. stops the disposable project WITH its data retained (nothing is deleted automatically), then
//      returns the retained database to its original running/stopped state and verifies its ledger
//      and row counts are unchanged.
//
// Usage: node scripts/release-check-fresh-db.mjs [--skip-browser] [-- <playwright args>]
// This script never runs `db reset`, never passes --no-backup, and never deletes a volume.
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import pg from "pg";

const CLI = ["--yes", "supabase@2.119.0"];
const RETAINED = { id: "pulse-e2e", workdir: "scratch/browser-db" };
const DB_PORT = 56322;
const API_PORT = 56321;
const BROWSER_EXCLUDES = "studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit";
// Snapshot-only starts of the retained database run Postgres alone, so no service boots against it.
const DB_ONLY_EXCLUDES = `${BROWSER_EXCLUDES},gotrue,realtime,storage-api,kong,postgrest`;
const ISOLATED_TABLES = ["deleted_manufacturing_steps"];
const ISOLATED_FUNCTIONS = ["delete_manufacturing_step", "restore_manufacturing_step", "apply_step_tool_changes"];

const args = process.argv.slice(2);
const skipBrowser = args.includes("--skip-browser");
const playwrightArgs = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15).toLowerCase();
const RELEASE = { id: `pulse-release-${stamp}`, workdir: `scratch/release-db/pulse-release-${stamp}` };

const log = (message) => console.log(`[release-check] ${message}`);
function run(command, commandArgs, { env = process.env, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
    if (capture) child.stderr.on("data", () => {}); // CLI startup output includes local keys: never echo it.
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} ${commandArgs.slice(0, 3).join(" ")} failed (${code})`))));
  });
}
const docker = async (...dockerArgs) => (await run("docker", dockerArgs, { capture: true })).split("\n").map((line) => line.trim()).filter(Boolean);
const containersOf = (id, status) => docker("ps", ...(status ? [] : ["-a"]), "--filter", `label=com.supabase.cli.project=${id}`, "--format", "{{.Names}}");
const volumesOf = (id) => docker("volume", "ls", "--filter", `label=com.supabase.cli.project=${id}`, "--format", "{{.Name}}");
const publisherOf = async (port) => docker("ps", "--filter", `publish=${port}`, "--format", "{{.Names}}");
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
function check(condition, message) { if (!condition) throw new Error(`Refusing to continue: ${message}`); }

/** The database on DB_PORT must be exactly this project's container, on this project's data volume. */
async function assertDatabaseIdentity(id) {
  const name = `supabase_db_${id}`;
  check((await publisherOf(DB_PORT)).join() === name, `port ${DB_PORT} is not served by ${name} alone`);
  const [label, mounts] = await docker("inspect", name, "--format", "{{index .Config.Labels \"com.supabase.cli.project\"}}\n{{json .Mounts}}");
  check(label === id, `${name} is labelled for project "${label}"`);
  const data = JSON.parse(mounts).find((mount) => mount.Destination === "/var/lib/postgresql/data");
  check(data?.Type === "volume" && data.Name === name, `${name} does not store its data in volume ${name}`);
}

async function query(sql, params = []) {
  const client = new pg.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres` });
  await client.connect();
  try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
}

/** Read-only: migration ledger plus an exact row count of every table in the app-owned schemas. */
async function snapshot(id) {
  await assertDatabaseIdentity(id);
  const [{ ledger }] = await query("select coalesce(json_agg(version order by version), '[]') as ledger from supabase_migrations.schema_migrations");
  const counts = await query(`
    select table_schema || '.' || table_name as name,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows
    from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema in ('public', 'auth', 'storage', 'supabase_migrations')
    order by 1`);
  return { ledger, counts: Object.fromEntries(counts.map((row) => [row.name, Number(row.rows)])) };
}

async function isolatedObjects() {
  const [row] = await query(`
    select (select count(*) from unnest($1::text[]) as t(name) where to_regclass('public.' || t.name) is not null) as tables,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any ($2::text[])) as functions`, [ISOLATED_TABLES, ISOLATED_FUNCTIONS]);
  return { tables: Number(row.tables), functions: Number(row.functions) };
}

async function startRetained(excludes) {
  await run("npx", [...CLI, "start", "--workdir", RETAINED.workdir, "-x", excludes], { capture: true });
}
const stopProject = (workdir) => run("npx", [...CLI, "stop", "--workdir", workdir], { capture: true });

async function activeMigrationVersions() {
  return (await readdir("supabase/migrations")).filter((file) => /^\d+_.*\.sql$/.test(file)).map((file) => file.split("_")[0]).sort();
}

let retainedWasRunning = false;
let retainedBefore;
let releaseStarted = false;
const results = [];

try {
  // 1. Retained database: record state and snapshot. Never reset, never deleted.
  check((await volumesOf(RETAINED.id)).length > 0, `retained project ${RETAINED.id} has no volumes`);
  retainedWasRunning = (await containersOf(RETAINED.id, "running")).includes(`supabase_db_${RETAINED.id}`);
  log(`retained ${RETAINED.id} is ${retainedWasRunning ? "running" : "stopped"}`);
  if (!retainedWasRunning) await startRetained(DB_ONLY_EXCLUDES);
  retainedBefore = await snapshot(RETAINED.id);
  const retainedIsolated = await isolatedObjects();
  log(`retained snapshot: ${retainedBefore.ledger.length} migrations, ${Object.keys(retainedBefore.counts).length} tables; isolated objects present: ${JSON.stringify(retainedIsolated)}`);
  await stopProject(RETAINED.workdir);
  check((await containersOf(RETAINED.id, "running")).length === 0, `retained ${RETAINED.id} did not stop`);

  // 2. A brand-new disposable project: nothing with this identity may exist yet.
  check(RELEASE.id !== RETAINED.id && RELEASE.id.startsWith("pulse-release-"), "unexpected release project id");
  check((await containersOf(RELEASE.id)).length === 0, `containers already exist for ${RELEASE.id}`);
  check((await volumesOf(RELEASE.id)).length === 0, `volumes already exist for ${RELEASE.id}`);
  check((await docker("volume", "ls", "--format", "{{.Name}}")).every((name) => !name.endsWith(`_${RELEASE.id}`)), `a volume named for ${RELEASE.id} exists`);
  check(!(await exists(RELEASE.workdir)), `${RELEASE.workdir} already exists`);
  check((await publisherOf(DB_PORT)).length === 0 && (await publisherOf(API_PORT)).length === 0, `ports ${API_PORT}/${DB_PORT} are in use`);

  await mkdir(`${RELEASE.workdir}/supabase`, { recursive: true });
  const config = (await readFile("supabase/config.toml", "utf8")).replace('project_id = "pulse"', `project_id = "${RELEASE.id}"`).replaceAll("553", "563");
  check(config.includes(`project_id = "${RELEASE.id}"`), "config project id was not rewritten");
  await writeFile(`${RELEASE.workdir}/supabase/config.toml`, config);
  for (const name of ["migrations", "templates", "seed.sql", "tests"]) {
    await cp(`supabase/${name}`, `${RELEASE.workdir}/supabase/${name}`, { recursive: true, errorOnExist: true, force: false });
  }
  log(`starting fresh project ${RELEASE.id} (initialized from ${(await activeMigrationVersions()).length} active migrations)`);
  releaseStarted = true;
  await run("npx", [...CLI, "start", "--workdir", RELEASE.workdir, "-x", BROWSER_EXCLUDES], { capture: true });

  // 3. Identity, contents, then the suites.
  await assertDatabaseIdentity(RELEASE.id);
  check((await publisherOf(API_PORT)).join() === `supabase_kong_${RELEASE.id}`, `port ${API_PORT} is not served by ${RELEASE.id}`);
  check((await volumesOf(RELEASE.id)).includes(`supabase_db_${RELEASE.id}`), "release data volume missing");
  const { ledger } = await snapshot(RELEASE.id);
  check(JSON.stringify(ledger) === JSON.stringify(await activeMigrationVersions()), "release ledger differs from supabase/migrations");
  const releaseIsolated = await isolatedObjects();
  check(releaseIsolated.tables === 0 && releaseIsolated.functions === 0, `isolated objects present: ${JSON.stringify(releaseIsolated)}`);
  results.push(`identity verified; ledger = ${ledger.length} active migrations; isolated objects absent`);

  const references = await run("grep", ["-rlE", [...ISOLATED_TABLES, ...ISOLATED_FUNCTIONS].join("|"), "src", "app"], { capture: true }).catch(() => "");
  check(references.trim() === "", `application code references isolated objects:\n${references}`);
  results.push("no application reference to isolated objects");

  await run("npx", [...CLI, "test", "db", "--workdir", RELEASE.workdir]);
  results.push("active pgTAP suite passed");

  if (!skipBrowser) {
    const status = JSON.parse(await run("npx", [...CLI, "status", "--workdir", RELEASE.workdir, "-o", "json"], { capture: true }));
    check(status.API_URL === `http://127.0.0.1:${API_PORT}` && status.ANON_KEY && status.SERVICE_ROLE_KEY, "release API unavailable");
    const env = { ...process.env, PULSE_BROWSER_TEST: "1",
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, E2E_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      RESEND_API_KEY: "", ANTHROPIC_API_KEY: "", NEXT_PUBLIC_WEB_VITALS_ENDPOINT: "" };
    await run("npm", ["run", "build"], { env });
    await assertDatabaseIdentity(RELEASE.id);
    await run("npx", ["playwright", "test", ...playwrightArgs], { env });
    results.push("browser suite passed");
  }
} catch (error) {
  console.error(`[release-check] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  // 4. Stop the disposable project with its data retained, then restore the retained database.
  if (releaseStarted) {
    await stopProject(RELEASE.workdir).catch((error) => { console.error(error.message); process.exitCode = 1; });
    log(`stopped ${RELEASE.id}; its volumes are kept: ${(await volumesOf(RELEASE.id)).join(", ") || "none"}`);
  }
  if (retainedBefore) {
    try {
      check((await publisherOf(DB_PORT)).length === 0, `port ${DB_PORT} still in use after stopping ${RELEASE.id}`);
      await startRetained(retainedWasRunning ? BROWSER_EXCLUDES : DB_ONLY_EXCLUDES);
      const after = await snapshot(RETAINED.id);
      const ledgerSame = JSON.stringify(after.ledger) === JSON.stringify(retainedBefore.ledger);
      const changed = Object.keys({ ...retainedBefore.counts, ...after.counts }).filter((name) => retainedBefore.counts[name] !== after.counts[name]);
      if (!retainedWasRunning) await stopProject(RETAINED.workdir);
      const nowRunning = (await containersOf(RETAINED.id, "running")).length > 0;
      check(nowRunning === retainedWasRunning, `retained ${RETAINED.id} not returned to its original state`);
      check(ledgerSame, "retained migration ledger changed");
      check(changed.length === 0, `retained row counts changed: ${changed.join(", ")}`);
      results.push(`retained ${RETAINED.id} back to ${retainedWasRunning ? "running" : "stopped"}; ledger (${after.ledger.length}) and row counts (${Object.keys(after.counts).length} tables) unchanged`);
    } catch (error) {
      console.error(`[release-check] RETAINED CHECK FAILED: ${error.message}`);
      process.exitCode = 1;
    }
  }
  results.forEach((line) => log(`ok: ${line}`));
  log(process.exitCode ? "release check FAILED" : `release check passed on ${RELEASE.id}`);
}
