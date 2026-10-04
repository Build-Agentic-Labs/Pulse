// Failure-path tests for scripts/lib/release-check.mjs over a simulated CLI, Docker and filesystem.
// No real command runs. The fake records every command, throws on any forbidden operation (reset,
// --no-backup, volume removal) and lets each scenario inject a failure or a signal at a named step.
import { describe, expect, it } from "vitest";
import {
  API_PORT, BROWSER_EXCLUDES, DB_ONLY_EXCLUDES, DB_PORT, RETAINED, RefusedError,
  assertRetainedConfig, rewriteReleaseConfig, runReleaseCheck,
} from "../scripts/lib/release-check.mjs";

type Deps = Parameters<typeof runReleaseCheck>[0];
type Row = Record<string, unknown>;
type Container = { project: string; ports: number[]; volume: string };
type Options = {
  retainedRunning?: boolean;
  retainedConfig?: string;
  volumes?: Record<string, string | null>; // name -> project label (null = unlabelled)
  existingPaths?: string[];
  failAt?: Partial<Record<Step, Error>>;
  signalAt?: Step;
  grepExit?: number;
  releaseIsolated?: { tables: number; functions: number };
  releaseLedger?: string[];
};
type Step = "start retained" | "snapshot" | "start release" | "stop release" | "test db" | "build" | "playwright" | "stop retained";

const ACTIVE = ["20260101000000_a.sql", "20260102000000_b.sql"];
const RETAINED_CONFIG = `project_id = "pulse-e2e"\n[api]\nport = 56321\n[db]\nport = 56322\n`;
const SOURCE_CONFIG = `project_id = "pulse"\n[api]\nport = 55321\n[db]\nport = 55322\n`;

function fakeWorld(options: Options = {}) {
  const commands: string[] = [];
  const logs: string[] = [];
  const containers = new Map<string, Container>();
  const volumes = new Map<string, string | null>(Object.entries(options.volumes ?? {
    "supabase_db_pulse-e2e": "pulse-e2e", "supabase_storage_pulse-e2e": "pulse-e2e", supabase_db_pulse: "pulse",
  }));
  containers.set("supabase_db_pulse", { project: "pulse", ports: [55322], volume: "supabase_db_pulse" });
  const freshVolumes = new Set<string>();
  const files = new Map<string, string>([
    [`${RETAINED.workdir}/supabase/config.toml`, options.retainedConfig ?? RETAINED_CONFIG],
    ["supabase/config.toml", SOURCE_CONFIG],
  ]);
  const paths = new Set<string>([...files.keys(), ...(options.existingPaths ?? []), "supabase/migrations", "supabase/templates", "supabase/seed.sql", "supabase/tests"]);
  let signalHandler: ((signal: string) => void) | undefined;
  let pendingAbort: AbortSignal | undefined;

  const projectOf = (workdir: string) => files.get(`${workdir}/supabase/config.toml`)?.match(/project_id = "([^"]+)"/)?.[1] ?? "?";
  const start = (workdir: string, excludes: string) => {
    const id = projectOf(workdir);
    const db = `supabase_db_${id}`;
    if (!volumes.has(db)) { volumes.set(db, id); freshVolumes.add(db); }
    if (!volumes.has(`supabase_storage_${id}`)) volumes.set(`supabase_storage_${id}`, id);
    containers.set(db, { project: id, ports: [DB_PORT], volume: db });
    if (!excludes.split(",").includes("kong")) containers.set(`supabase_kong_${id}`, { project: id, ports: [API_PORT], volume: "" });
  };
  const stop = (workdir: string) => { const id = projectOf(workdir); for (const [name, c] of containers) if (c.project === id) containers.delete(name); };
  if (options.retainedRunning) start(RETAINED.workdir, BROWSER_EXCLUDES);

  const dbOnPort = () => [...containers.values()].find((c) => c.ports.includes(DB_PORT));
  const stepFor = (args: string[]): Step | undefined => {
    const text = args.join(" ");
    if (text.includes("start --workdir scratch/browser-db")) return "start retained";
    if (text.includes("start --workdir scratch/release-db")) return "start release";
    if (text.includes("stop --workdir scratch/release-db")) return "stop release";
    if (text.includes("stop --workdir scratch/browser-db")) return "stop retained";
    if (text.includes("test db")) return "test db";
    return undefined;
  };
  const hit = async (step: Step | undefined, signal?: AbortSignal) => {
    if (!step) return;
    if (options.failAt?.[step]) throw options.failAt[step];
    if (options.signalAt === step && signalHandler) {
      // The signal arrives while this command runs; the real exec rejects when its signal aborts.
      pendingAbort = signal;
      signalHandler("SIGINT");
      signalHandler("SIGINT"); // a second Ctrl-C during cleanup must be ignored
      throw Object.assign(new Error("aborted"), { code: null });
    }
  };

  const exec: Deps["exec"] = async (command, args, extra = {}) => {
    const line = [command, ...args].join(" ");
    commands.push(line);
    if (/\bdb reset\b|--no-backup|volume rm|volume prune|rm -rf/.test(line)) throw new Error(`FORBIDDEN: ${line}`);
    if (command === "docker") {
      const filter = (flag: string) => args[args.indexOf(flag) + 1];
      if (args[0] === "ps") {
        const all = args.includes("-a");
        const label = args.includes("--filter") && filter("--filter").startsWith("label=") ? filter("--filter").slice("label=com.supabase.cli.project=".length) : undefined;
        const port = args.includes("--filter") && filter("--filter").startsWith("publish=") ? Number(filter("--filter").slice(8)) : undefined;
        void all; // the fake has no stopped containers: stop removes them
        return { code: 0, stdout: [...containers].filter(([, c]) => (label === undefined || c.project === label) && (port === undefined || c.ports.includes(port))).map(([n]) => n).join("\n") };
      }
      if (args[0] === "volume") {
        const label = args.includes("--filter") ? filter("--filter").slice("label=com.supabase.cli.project=".length) : undefined;
        return { code: 0, stdout: [...volumes].filter(([, p]) => label === undefined || p === label).map(([n]) => n).join("\n") };
      }
      if (args[0] === "inspect") {
        const c = containers.get(args[1]);
        if (!c) throw Object.assign(new Error("no such container"), { code: 1 });
        return { code: 0, stdout: `${c.project}\n${JSON.stringify([{ Type: "volume", Name: c.volume, Destination: "/var/lib/postgresql/data" }])}` };
      }
    }
    if (command === "npx" && args[2] === "start") { await hit(stepFor(args), extra.signal); start(args[4], args[6]); return { code: 0, stdout: "" }; }
    if (command === "npx" && args[2] === "stop") { await hit(stepFor(args), extra.signal); stop(args[4]); return { code: 0, stdout: "" }; }
    if (command === "npx" && args[2] === "status") return { code: 0, stdout: JSON.stringify({ API_URL: `http://127.0.0.1:${API_PORT}`, ANON_KEY: "anon", SERVICE_ROLE_KEY: "service" }) };
    if (command === "npx" && args[2] === "test") { await hit("test db", extra.signal); return { code: 0, stdout: "" }; }
    if (command === "npm") { await hit("build", extra.signal); return { code: 0, stdout: "" }; }
    if (command === "npx" && args[0] === "playwright") { await hit("playwright", extra.signal); return { code: 0, stdout: "" }; }
    if (command === "grep") {
      const code = options.grepExit ?? 1;
      if (code === 0 || (extra.allowExit ?? []).includes(code)) return { code, stdout: code === 0 ? "src/x.ts\n" : "" };
      throw Object.assign(new Error("grep failed"), { code });
    }
    throw new Error(`unexpected command ${line}`);
  };

  const query: Deps["query"] = async (sql) => {
    const db = dbOnPort();
    if (!db) throw new Error("no database on the test port");
    if (options.failAt?.snapshot && db.project === RETAINED.id) throw options.failAt.snapshot;
    const fresh = freshVolumes.has(db.volume);
    if (sql.includes("schema_migrations")) return [{ ledger: fresh ? (options.releaseLedger ?? ACTIVE.map((f) => f.split("_")[0])) : ["20250101000000", "20250102000000", "20261003210000"] }] as Row[];
    if (sql.includes("to_regclass")) return [fresh ? (options.releaseIsolated ?? { tables: 0, functions: 0 }) : { tables: 1, functions: 3 }] as Row[];
    return [{ name: "public.tasks", rows: fresh ? "0" : "42" }, { name: "auth.users", rows: fresh ? "0" : "3" }] as Row[];
  };

  const fs: Deps["fs"] = {
    exists: async (p) => paths.has(p),
    mkdir: async (p) => { paths.add(p); },
    readFile: async (p) => { const text = files.get(p); if (text === undefined) throw new Error(`ENOENT ${p}`); return text; },
    writeFile: async (p, text) => { files.set(p, text); paths.add(p); },
    cp: async (from, to) => { if (paths.has(to)) throw new Error(`EEXIST ${to}`); paths.add(to); },
    readdir: async () => ACTIVE,
  };

  const deps: Deps = {
    exec, query, fs,
    log: (m) => logs.push(m), error: (m) => logs.push(m),
    now: () => new Date("2026-10-04T10:11:12.000Z"),
    onSignal: (handler) => { signalHandler = handler; return () => { signalHandler = undefined; }; },
    env: {},
  };
  return {
    deps, commands, logs, containers, volumes,
    running: (id: string) => [...containers.values()].some((c) => c.project === id),
    supabaseCommands: () => commands.filter((c) => c.startsWith("npx --yes supabase")),
    get pendingAbort() { return pendingAbort; },
  };
}

const RELEASE_ID = "pulse-release-20261004-101112";
const expectNoForbiddenOperation = (world: ReturnType<typeof fakeWorld>) =>
  expect(world.commands.some((c) => /\bdb reset\b|--no-backup|volume rm/.test(c))).toBe(false);

describe("config identity", () => {
  it("accepts the retained config only with its exact project id and ports", () => {
    expect(() => assertRetainedConfig(RETAINED_CONFIG)).not.toThrow();
    expect(() => assertRetainedConfig(RETAINED_CONFIG.replace("pulse-e2e", "pulse"))).toThrow(RefusedError);
    expect(() => assertRetainedConfig(RETAINED_CONFIG.replace("56322", "55322"))).toThrow(/does not publish port 56322/);
    expect(() => assertRetainedConfig(`${RETAINED_CONFIG}port = 55323\n`)).toThrow(/553xx/);
  });

  it("rewrites the development config to the release identity and test ports, and refuses a partial rewrite", () => {
    const rewritten = rewriteReleaseConfig(SOURCE_CONFIG, RELEASE_ID);
    expect(rewritten).toContain(`project_id = "${RELEASE_ID}"`);
    expect(rewritten).toMatch(/port = 56321/);
    expect(rewritten).not.toContain("553");
    expect(() => rewriteReleaseConfig('project_id = "other"\nport = 55322\n', RELEASE_ID)).toThrow(/not rewritten/);
  });
});

describe("happy path", () => {
  it("snapshots, stops and restores a stopped retained database, and keeps the disposable volumes", async () => {
    const world = fakeWorld();
    const result = await runReleaseCheck(world.deps);
    expect(result.failures).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.releaseId).toBe(RELEASE_ID);
    expectNoForbiddenOperation(world);
    const supabase = world.supabaseCommands();
    expect(supabase).toEqual([
      `npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x ${DB_ONLY_EXCLUDES}`,
      "npx --yes supabase@2.119.0 stop --workdir scratch/browser-db",
      `npx --yes supabase@2.119.0 start --workdir scratch/release-db/${RELEASE_ID} -x ${BROWSER_EXCLUDES}`,
      `npx --yes supabase@2.119.0 test db --workdir scratch/release-db/${RELEASE_ID}`,
      `npx --yes supabase@2.119.0 status --workdir scratch/release-db/${RELEASE_ID} -o json`,
      `npx --yes supabase@2.119.0 stop --workdir scratch/release-db/${RELEASE_ID}`,
      `npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x ${DB_ONLY_EXCLUDES}`,
      "npx --yes supabase@2.119.0 stop --workdir scratch/browser-db",
    ]);
    expect(world.running(RETAINED.id)).toBe(false);
    expect(world.running(RELEASE_ID)).toBe(false);
    expect([...world.volumes.keys()]).toEqual(expect.arrayContaining([`supabase_db_${RELEASE_ID}`, `supabase_storage_${RELEASE_ID}`, "supabase_db_pulse-e2e"]));
    expect(result.results).toEqual([
      "identity verified; ledger = 2 active migrations; isolated objects absent",
      "no application reference to isolated objects",
      "active pgTAP suite passed",
      "browser suite passed",
      "retained pulse-e2e back to stopped; ledger (3) and row counts (2 tables) unchanged",
    ]);
    // The retained config is read before the first CLI call that targets it.
    expect(world.commands.findIndex((c) => c.includes("scratch/browser-db"))).toBeGreaterThan(-1);
  });

  it("returns a running retained database to running with the full service set", async () => {
    const world = fakeWorld({ retainedRunning: true });
    const result = await runReleaseCheck(world.deps, { skipBrowser: true });
    expect(result.exitCode).toBe(0);
    const starts = world.supabaseCommands().filter((c) => c.includes("start --workdir scratch/browser-db"));
    expect(starts).toEqual([`npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x ${BROWSER_EXCLUDES}`]);
    expect(world.running(RETAINED.id)).toBe(true);
    expect(world.running(RELEASE_ID)).toBe(false);
    expect(result.results.at(-1)).toMatch(/back to running/);
  });
});

describe("refusals before touching anything", () => {
  it("refuses a retained workdir whose config carries another project id, before any CLI call", async () => {
    const world = fakeWorld({ retainedConfig: RETAINED_CONFIG.replace("pulse-e2e", "pulse") });
    const result = await runReleaseCheck(world.deps);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]).toMatch(/project_id "pulse", expected "pulse-e2e"/);
    expect(world.supabaseCommands()).toEqual([]);
  });

  it("refuses to start a retained environment with a missing or unlabelled volume, and never repairs it", async () => {
    const missing = fakeWorld({ volumes: { "supabase_db_pulse-e2e": "pulse-e2e", supabase_db_pulse: "pulse" } });
    expect((await runReleaseCheck(missing.deps)).failures[0]).toMatch(/retained volumes missing: supabase_storage_pulse-e2e/);
    expect(missing.supabaseCommands()).toEqual([]);
    expect(missing.volumes.has("supabase_storage_pulse-e2e")).toBe(false);

    const unlabelled = fakeWorld({ volumes: { "supabase_db_pulse-e2e": "pulse-e2e", "supabase_storage_pulse-e2e": "pulse-e2e", "supabase_config_pulse-e2e": null } });
    expect((await runReleaseCheck(unlabelled.deps)).failures[0]).toMatch(/without the project label: supabase_config_pulse-e2e/);
    expect(unlabelled.supabaseCommands()).toEqual([]);
  });

  it("refuses an existing release workdir after restoring the retained database", async () => {
    const world = fakeWorld({ existingPaths: [`scratch/release-db/${RELEASE_ID}`] });
    const result = await runReleaseCheck(world.deps);
    expect(result.failures[0]).toMatch(/already exists/);
    expect(world.supabaseCommands().some((c) => c.includes("start --workdir scratch/release-db"))).toBe(false);
    expect(world.running(RETAINED.id)).toBe(false);
    expect(result.results).toEqual(["retained pulse-e2e back to stopped; ledger (3) and row counts (2 tables) unchanged"]);
  });
});

describe("cleanup after failures", () => {
  it("stops a retained database it started when the snapshot fails, and starts no release project", async () => {
    const world = fakeWorld({ failAt: { snapshot: new Error("connection refused") } });
    const result = await runReleaseCheck(world.deps);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(["connection refused"]);
    expect(world.supabaseCommands()).toEqual([
      `npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x ${DB_ONLY_EXCLUDES}`,
      "npx --yes supabase@2.119.0 stop --workdir scratch/browser-db",
    ]);
    expect(world.running(RETAINED.id)).toBe(false);
    expect(result.results).toEqual(["retained pulse-e2e back to stopped (snapshot had not completed, so no comparison)"]);
    expectNoForbiddenOperation(world);
  });

  it("leaves a running retained database running when the snapshot fails", async () => {
    const world = fakeWorld({ retainedRunning: true, failAt: { snapshot: new Error("boom") } });
    const result = await runReleaseCheck(world.deps);
    expect(result.exitCode).toBe(1);
    expect(world.running(RETAINED.id)).toBe(true);
    expect(world.supabaseCommands()).toEqual([]);
  });

  it("stops the disposable project and restores the retained one when the release start fails", async () => {
    const world = fakeWorld({ failAt: { "start release": new Error("docker pull failed") } });
    const result = await runReleaseCheck(world.deps);
    expect(result.failures).toEqual(["docker pull failed"]);
    expect(world.supabaseCommands()).toContain(`npx --yes supabase@2.119.0 stop --workdir scratch/release-db/${RELEASE_ID}`);
    expect(world.running(RETAINED.id)).toBe(false);
    expect(result.results).toEqual(["retained pulse-e2e back to stopped; ledger (3) and row counts (2 tables) unchanged"]);
    expectNoForbiddenOperation(world);
  });

  it("does not start the retained database while the test port is still in use", async () => {
    const world = fakeWorld({ failAt: { "stop release": new Error("stop hung") } });
    const result = await runReleaseCheck(world.deps, { skipBrowser: true });
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(expect.arrayContaining([
      "stopping the disposable project: stop hung",
      expect.stringMatching(/port 56322 still in use; not starting pulse-e2e on top of it/),
    ]));
    expect(world.supabaseCommands().filter((c) => c.includes("start --workdir scratch/browser-db"))).toHaveLength(1);
  });

  it("fails when the fresh database still holds the isolated objects, before running any suite", async () => {
    const world = fakeWorld({ releaseIsolated: { tables: 1, functions: 3 } });
    const result = await runReleaseCheck(world.deps);
    expect(result.failures[0]).toMatch(/isolated objects present: {"tables":1,"functions":3}/);
    expect(world.supabaseCommands().some((c) => c.includes("test db"))).toBe(false);
    expect(world.commands.some((c) => c.startsWith("npm run build"))).toBe(false);
    expect(world.running(RETAINED.id)).toBe(false);
  });

  it("fails when the fresh ledger differs from the active migration files", async () => {
    const world = fakeWorld({ releaseLedger: ["20260101000000"] });
    expect((await runReleaseCheck(world.deps)).failures[0]).toMatch(/release ledger differs/);
  });

  it("treats only grep exit 1 as 'no references'", async () => {
    expect((await runReleaseCheck(fakeWorld({ grepExit: 0 }).deps)).failures[0]).toMatch(/application code references isolated objects/);
    expect((await runReleaseCheck(fakeWorld({ grepExit: 2 }).deps)).failures[0]).toMatch(/static reference check could not run/);
  });

  it("reports a changed retained ledger after restore", async () => {
    const world = fakeWorld();
    let reads = 0;
    const query = world.deps.query;
    world.deps.query = async (sql, params) => {
      const rows = await query(sql, params);
      if (sql.includes("schema_migrations") && ++reads === 3) return [{ ledger: ["changed"] }];
      return rows;
    };
    const result = await runReleaseCheck(world.deps, { skipBrowser: true });
    expect(result.failures).toEqual(["restoring the retained database: Refusing to continue: retained migration ledger changed"]);
  });
});

describe("signals", () => {
  it("aborts the current step on SIGINT, ignores a second signal, and still cleans up", async () => {
    const world = fakeWorld({ signalAt: "start release" });
    const result = await runReleaseCheck(world.deps);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(["interrupted by SIGINT"]);
    expect(world.pendingAbort?.aborted).toBe(true);
    expect(world.logs.some((line) => line.includes("received again; cleanup is already running"))).toBe(true);
    expect(world.supabaseCommands().slice(-3)).toEqual([
      `npx --yes supabase@2.119.0 stop --workdir scratch/release-db/${RELEASE_ID}`,
      `npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x ${DB_ONLY_EXCLUDES}`,
      "npx --yes supabase@2.119.0 stop --workdir scratch/browser-db",
    ]);
    expect(world.running(RETAINED.id)).toBe(false);
    expectNoForbiddenOperation(world);
  });

  it("prints the by-hand recovery commands at startup, without --no-backup", async () => {
    const world = fakeWorld();
    await runReleaseCheck(world.deps, { skipBrowser: true });
    const recovery = world.logs.find((line) => line.includes("recover BY HAND"));
    expect(recovery).toContain(`stop --workdir scratch/release-db/${RELEASE_ID}`);
    expect(recovery).toContain("stop --workdir scratch/browser-db");
    expect(recovery).toContain("Never pass --no-backup");
  });
});
