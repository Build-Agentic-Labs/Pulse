// Release check on a FRESH, disposable local database that holds only the active migrations.
//
// The retained isolated database (project "pulse-e2e", scratch/browser-db) also contains isolated,
// unapproved functions, so passing there cannot prove the app no longer needs them. The check:
//   1. asserts the retained workdir's exact identity (project id and ports in its config.toml) and that
//      its expected volumes are present, records whether it is running, snapshots it (migration ledger
//      and exact row counts), then stops it if needed so the fixed test ports are free (data kept);
//   2. creates a NEW project with a unique id (pulse-release-<stamp>) in its own workdir, after proving
//      no container, volume or workdir with that identity exists. Initialization comes from
//      `supabase start` on that brand-new volume, from a copy of supabase/migrations + seed.sql only.
//      Nothing is ever reset: an unexpected existing environment makes the check stop;
//   3. verifies the exact identity (project label, data volume, the containers publishing the test
//      ports), that the ledger equals the active migration files, and that the isolated objects are
//      absent; then runs the active pgTAP suite, the browser suite, and a static source check;
//   4. stops the disposable project WITH its data retained (nothing is deleted automatically), then
//      returns the retained database to its original running/stopped state and verifies its ledger
//      and row counts are unchanged.
//
// Every step after the retained database is touched runs under cleanup protection: whatever fails,
// the finally block stops what this run started, restores the retained state, and reports. SIGINT /
// SIGTERM abort the current command and run the same cleanup. A forced termination (SIGKILL, power
// loss, a second Ctrl-C while cleanup runs) CANNOT be protected against: the recovery commands printed
// at startup then have to be run by hand. They only `stop`; nothing here ever resets, applies a
// migration, repairs an environment, passes --no-backup or removes a volume.
//
// The orchestration takes its commands, database access and filesystem as injected dependencies so
// the failure paths are testable without real infrastructure (tests/release-check-fresh-db.test.ts).

export const CLI = ["--yes", "supabase@2.119.0"];
export const RETAINED = { id: "pulse-e2e", workdir: "scratch/browser-db" };
export const DB_PORT = 56322;
export const API_PORT = 56321;
export const BROWSER_EXCLUDES = "studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit";
// Snapshot-only starts of the retained database run Postgres alone, so no service boots against it.
export const DB_ONLY_EXCLUDES = `${BROWSER_EXCLUDES},gotrue,realtime,storage-api,kong,postgrest`;
export const ISOLATED_TABLES = ["deleted_manufacturing_steps"];
export const ISOLATED_FUNCTIONS = ["delete_manufacturing_step", "restore_manufacturing_step", "apply_step_tool_changes"];
export const RETAINED_VOLUMES = [`supabase_db_${RETAINED.id}`, `supabase_storage_${RETAINED.id}`];

export class RefusedError extends Error {
  constructor(message) { super(`Refusing to continue: ${message}`); this.name = "RefusedError"; }
}
function check(condition, message) { if (!condition) throw new RefusedError(message); }

export function releaseStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15).toLowerCase();
}

/** The identity a retained workdir's config.toml must carry before any CLI call is pointed at it. */
export function assertRetainedConfig(configText) {
  const projectId = configText.match(/^project_id\s*=\s*"([^"]*)"/m)?.[1];
  check(projectId === RETAINED.id, `${RETAINED.workdir}/supabase/config.toml has project_id "${projectId}", expected "${RETAINED.id}"`);
  for (const port of [API_PORT, DB_PORT]) {
    check(new RegExp(`^port\\s*=\\s*${port}$`, "m").test(configText), `${RETAINED.workdir} config does not publish port ${port}`);
  }
  check(!/^port\s*=\s*553\d\d$/m.test(configText), `${RETAINED.workdir} config still publishes a 553xx (development) port`);
}

export function rewriteReleaseConfig(configText, releaseId) {
  const rewritten = configText.replace('project_id = "pulse"', `project_id = "${releaseId}"`).replaceAll("553", "563");
  check(rewritten.includes(`project_id = "${releaseId}"`), "config project id was not rewritten");
  check(/^port\s*=\s*56321$/m.test(rewritten) && /^port\s*=\s*56322$/m.test(rewritten), "config ports were not rewritten to 563xx");
  check(!/553/.test(rewritten), "config still contains a 553xx port");
  return rewritten;
}

/**
 * @param {object} deps
 * @param {(command: string, args: string[], options?: {env?: object, capture?: boolean, allowExit?: number[], signal?: AbortSignal}) => Promise<{code: number, stdout: string}>} deps.exec
 *   Runs a command. Rejects with an Error carrying `.code` unless the exit code is 0 or listed in allowExit.
 * @param {(sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>} deps.query  Postgres on DB_PORT as postgres.
 * @param {{exists(p: string): Promise<boolean>, mkdir(p: string): Promise<void>, readFile(p: string): Promise<string>, writeFile(p: string, text: string): Promise<void>, cp(from: string, to: string): Promise<void>, readdir(p: string): Promise<string[]>}} deps.fs
 * @param {(message: string) => void} deps.log
 * @param {(message: string) => void} deps.error
 * @param {() => Date} deps.now
 * @param {(handler: (signal: string) => void) => () => void} deps.onSignal  Registers a SIGINT/SIGTERM handler; returns the unregister function.
 * @param {object} [deps.env]
 * @param {{skipBrowser?: boolean, playwrightArgs?: string[]}} [options]
 * @returns {Promise<{exitCode: number, releaseId: string, results: string[], failures: string[]}>}
 */
export async function runReleaseCheck(deps, options = {}) {
  const { exec, query, fs, log, error, now, onSignal, env = {} } = deps;
  const releaseId = `pulse-release-${releaseStamp(now())}`;
  const release = { id: releaseId, workdir: `scratch/release-db/${releaseId}` };
  const results = [];
  const failures = [];
  const fail = (message) => { failures.push(message); error(`[release-check] FAILED: ${message}`); };

  // Signals abort the command in flight; cleanup then runs with a fresh controller.
  let controller = new AbortController();
  let interrupted = null;
  const unregister = onSignal((signal) => {
    if (interrupted) { log(`${signal} received again; cleanup is already running, let it finish`); return; }
    interrupted = signal;
    log(`${signal} received: aborting the current step and running cleanup`);
    controller.abort(new Error(`interrupted by ${signal}`));
  });
  const sh = (command, args, extra = {}) => exec(command, args, { env, capture: true, ...extra, signal: controller.signal });
  const docker = async (...args) => (await sh("docker", args)).stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const containersOf = (id, onlyRunning) => docker("ps", ...(onlyRunning ? [] : ["-a"]), "--filter", `label=com.supabase.cli.project=${id}`, "--format", "{{.Names}}");
  const volumesOf = (id) => docker("volume", "ls", "--filter", `label=com.supabase.cli.project=${id}`, "--format", "{{.Name}}");
  const allVolumes = () => docker("volume", "ls", "--format", "{{.Name}}");
  const publisherOf = (port) => docker("ps", "--filter", `publish=${port}`, "--format", "{{.Names}}");
  const supabase = (args, extra) => sh("npx", [...CLI, ...args], extra);

  /** The database on DB_PORT must be exactly this project's container, on this project's data volume. */
  async function assertDatabaseIdentity(id) {
    const name = `supabase_db_${id}`;
    check((await publisherOf(DB_PORT)).join() === name, `port ${DB_PORT} is not served by ${name} alone`);
    const [label, mounts] = await docker("inspect", name, "--format", '{{index .Config.Labels "com.supabase.cli.project"}}\n{{json .Mounts}}');
    check(label === id, `${name} is labelled for project "${label}"`);
    const data = JSON.parse(mounts ?? "null")?.find((mount) => mount.Destination === "/var/lib/postgresql/data");
    check(data?.Type === "volume" && data.Name === name, `${name} does not store its data in volume ${name}`);
  }
  const assertApiIdentity = async (id) => check((await publisherOf(API_PORT)).join() === `supabase_kong_${id}`, `port ${API_PORT} is not served by ${id}`);

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
  const activeMigrationVersions = async () =>
    (await fs.readdir("supabase/migrations")).filter((file) => /^\d+_.*\.sql$/.test(file)).map((file) => file.split("_")[0]).sort();

  /** Before any start or stop is pointed at the retained workdir: exact identity, expected volumes. */
  async function assertRetainedEnvironment() {
    assertRetainedConfig(await fs.readFile(`${RETAINED.workdir}/supabase/config.toml`));
    const labelled = await volumesOf(RETAINED.id);
    const named = (await allVolumes()).filter((name) => name.endsWith(`_${RETAINED.id}`));
    const missing = RETAINED_VOLUMES.filter((name) => !labelled.includes(name));
    check(missing.length === 0, `retained volumes missing: ${missing.join(", ")}. Not creating or repairing anything; restore them by hand first`);
    const unlabelled = named.filter((name) => !labelled.includes(name));
    check(unlabelled.length === 0, `retained volumes without the project label: ${unlabelled.join(", ")}`);
  }
  const startRetained = (excludes) => supabase(["start", "--workdir", RETAINED.workdir, "-x", excludes]);
  const stopProject = (workdir) => supabase(["stop", "--workdir", workdir]);

  const state = { retainedChecked: false, retainedWasRunning: false, retainedStartedByUs: false, retainedBefore: null, releaseStarted: false };

  log(`[release-check] disposable project ${release.id}; retained ${RETAINED.id} is never reset, migrated or deleted`);
  log(`[release-check] if this process is killed, recover BY HAND with:  npx ${CLI.join(" ")} stop --workdir ${release.workdir}  (kept volumes)  and  npx ${CLI.join(" ")} stop --workdir ${RETAINED.workdir}  then restart the retained project if it was running. Never pass --no-backup.`);

  try {
    // 1. Retained database: identity, state, snapshot. Never reset, never deleted, never repaired.
    await assertRetainedEnvironment();
    state.retainedChecked = true;
    state.retainedWasRunning = (await containersOf(RETAINED.id, true)).includes(`supabase_db_${RETAINED.id}`);
    log(`[release-check] retained ${RETAINED.id} is ${state.retainedWasRunning ? "running" : "stopped"}`);
    if (!state.retainedWasRunning) {
      state.retainedStartedByUs = true;
      await startRetained(DB_ONLY_EXCLUDES);
    }
    state.retainedBefore = await snapshot(RETAINED.id);
    const retainedIsolated = await isolatedObjects();
    log(`[release-check] retained snapshot: ${state.retainedBefore.ledger.length} migrations, ${Object.keys(state.retainedBefore.counts).length} tables; isolated objects present: ${JSON.stringify(retainedIsolated)}`);
    await stopProject(RETAINED.workdir);
    check((await containersOf(RETAINED.id, true)).length === 0, `retained ${RETAINED.id} did not stop`);

    // 2. A brand-new disposable project: nothing with this identity may exist yet.
    check(release.id !== RETAINED.id && release.id.startsWith("pulse-release-"), "unexpected release project id");
    check((await containersOf(release.id, false)).length === 0, `containers already exist for ${release.id}`);
    check((await volumesOf(release.id)).length === 0, `volumes already exist for ${release.id}`);
    check((await allVolumes()).every((name) => !name.endsWith(`_${release.id}`)), `a volume named for ${release.id} exists`);
    check(!(await fs.exists(release.workdir)), `${release.workdir} already exists`);
    check((await publisherOf(DB_PORT)).length === 0 && (await publisherOf(API_PORT)).length === 0, `ports ${API_PORT}/${DB_PORT} are in use`);

    await fs.mkdir(`${release.workdir}/supabase`);
    await fs.writeFile(`${release.workdir}/supabase/config.toml`, rewriteReleaseConfig(await fs.readFile("supabase/config.toml"), release.id));
    for (const name of ["migrations", "templates", "seed.sql", "tests"]) await fs.cp(`supabase/${name}`, `${release.workdir}/supabase/${name}`);
    const active = await activeMigrationVersions();
    log(`[release-check] starting fresh project ${release.id} (initialized from ${active.length} active migrations)`);
    state.releaseStarted = true;
    await supabase(["start", "--workdir", release.workdir, "-x", BROWSER_EXCLUDES]);

    // 3. Identity, contents, then the suites.
    await assertDatabaseIdentity(release.id);
    await assertApiIdentity(release.id);
    check((await volumesOf(release.id)).includes(`supabase_db_${release.id}`), "release data volume missing");
    const { ledger } = await snapshot(release.id);
    check(JSON.stringify(ledger) === JSON.stringify(active), "release ledger differs from supabase/migrations");
    const releaseIsolated = await isolatedObjects();
    check(releaseIsolated.tables === 0 && releaseIsolated.functions === 0, `isolated objects present: ${JSON.stringify(releaseIsolated)}`);
    results.push(`identity verified; ledger = ${ledger.length} active migrations; isolated objects absent`);

    // grep exits 1 for "no match" and 2 for an error; only 1 means "no references".
    const grep = await sh("grep", ["-rlE", [...ISOLATED_TABLES, ...ISOLATED_FUNCTIONS].join("|"), "src", "app"], { allowExit: [1, 2] });
    check(grep.code === 1, grep.code === 0 ? `application code references isolated objects:\n${grep.stdout}` : "the static reference check could not run");
    results.push("no application reference to isolated objects");

    await supabase(["test", "db", "--workdir", release.workdir], { capture: false });
    results.push("active pgTAP suite passed");

    if (!options.skipBrowser) {
      const status = JSON.parse((await supabase(["status", "--workdir", release.workdir, "-o", "json"])).stdout);
      check(status.API_URL === `http://127.0.0.1:${API_PORT}` && status.ANON_KEY && status.SERVICE_ROLE_KEY, "release API unavailable");
      const testEnv = { ...env, PULSE_BROWSER_TEST: "1",
        NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, E2E_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
        RESEND_API_KEY: "", ANTHROPIC_API_KEY: "", NEXT_PUBLIC_WEB_VITALS_ENDPOINT: "" };
      await sh("npm", ["run", "build"], { env: testEnv, capture: false });
      await assertDatabaseIdentity(release.id);
      await assertApiIdentity(release.id);
      await sh("npx", ["playwright", "test", ...(options.playwrightArgs ?? [])], { env: testEnv, capture: false });
      results.push("browser suite passed");
    }
  } catch (caught) {
    fail(interrupted ? `interrupted by ${interrupted}` : caught.message);
  } finally {
    // 4. Cleanup runs even after an abort: stop what this run started, then restore the retained state.
    controller = new AbortController();
    const attempt = async (label, action) => { try { await action(); } catch (caught) { fail(`${label}: ${caught.message}`); } };

    if (state.releaseStarted) {
      await attempt("stopping the disposable project", () => stopProject(release.workdir));
      await attempt("listing the disposable project's volumes", async () =>
        log(`[release-check] stopped ${release.id}; its volumes are kept: ${(await volumesOf(release.id)).join(", ") || "none"}`));
    }

    if (state.retainedChecked && (state.retainedStartedByUs || state.retainedBefore)) {
      await attempt("restoring the retained database", async () => {
        if (state.retainedBefore) {
          // The snapshot completed, so this run stopped the retained project; restart it only onto a free port.
          check((await publisherOf(DB_PORT)).length === 0, `port ${DB_PORT} still in use; not starting ${RETAINED.id} on top of it`);
          await startRetained(state.retainedWasRunning ? BROWSER_EXCLUDES : DB_ONLY_EXCLUDES);
          const after = await snapshot(RETAINED.id);
          const ledgerSame = JSON.stringify(after.ledger) === JSON.stringify(state.retainedBefore.ledger);
          const changed = Object.keys({ ...state.retainedBefore.counts, ...after.counts }).filter((name) => state.retainedBefore.counts[name] !== after.counts[name]);
          if (!state.retainedWasRunning) await stopProject(RETAINED.workdir);
          check(ledgerSame, "retained migration ledger changed");
          check(changed.length === 0, `retained row counts changed: ${changed.join(", ")}`);
          results.push(`retained ${RETAINED.id} back to ${state.retainedWasRunning ? "running" : "stopped"}; ledger (${after.ledger.length}) and row counts (${Object.keys(after.counts).length} tables) unchanged`);
        } else if (state.retainedStartedByUs) {
          // Started for the snapshot but the snapshot never completed, so it is still up: put it back to
          // stopped, after proving the thing on the port is the retained database and nothing else.
          await assertDatabaseIdentity(RETAINED.id);
          await stopProject(RETAINED.workdir);
          results.push(`retained ${RETAINED.id} back to stopped (snapshot had not completed, so no comparison)`);
        }
        const running = (await containersOf(RETAINED.id, true)).length > 0;
        check(running === state.retainedWasRunning, `retained ${RETAINED.id} is ${running ? "running" : "stopped"} but was ${state.retainedWasRunning ? "running" : "stopped"}`);
      });
    }
    unregister();
  }

  results.forEach((line) => log(`[release-check] ok: ${line}`));
  const exitCode = failures.length ? 1 : 0;
  log(`[release-check] ${exitCode ? "release check FAILED" : `release check passed on ${release.id}`}`);
  return { exitCode, releaseId: release.id, results, failures };
}

/** Real dependencies for the CLI entry. Captured command output never reaches the console unless logged on purpose. */
export async function createNodeDeps() {
  const { spawn } = await import("node:child_process");
  const nodeFs = await import("node:fs/promises");
  const { default: pg } = await import("pg");

  const exec = (command, args, { env = process.env, capture = false, allowExit = [], signal } = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", signal });
      let stdout = "";
      if (capture) child.stdout.on("data", (chunk) => { stdout += chunk; });
      if (capture) child.stderr.on("data", () => {}); // CLI startup output includes local keys: never echo it.
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 || allowExit.includes(code)) resolve({ code, stdout });
        else reject(Object.assign(new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${code})`), { code }));
      });
    });

  const query = async (sql, params = []) => {
    const client = new pg.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres` });
    await client.connect();
    try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
  };

  const fs = {
    exists: async (path) => { try { await nodeFs.stat(path); return true; } catch { return false; } },
    mkdir: (path) => nodeFs.mkdir(path, { recursive: true }),
    readFile: (path) => nodeFs.readFile(path, "utf8"),
    writeFile: (path, text) => nodeFs.writeFile(path, text),
    cp: (from, to) => nodeFs.cp(from, to, { recursive: true, errorOnExist: true, force: false }),
    readdir: (path) => nodeFs.readdir(path),
  };

  const onSignal = (handler) => {
    const listeners = ["SIGINT", "SIGTERM"].map((signal) => [signal, () => handler(signal)]);
    listeners.forEach(([signal, listener]) => process.on(signal, listener));
    return () => listeners.forEach(([signal, listener]) => process.off(signal, listener));
  };

  return { exec, query, fs, log: console.log, error: console.error, now: () => new Date(), onSignal, env: process.env };
}
