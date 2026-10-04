// Edit-reliability baseline measurement against the RETAINED isolated database (project pulse-e2e,
// scratch/browser-db). Companion to docs/edit-reliability-plan.md Package A.
//
//   node scripts/measure-edit-baseline.mjs [--skip-build] [--samples N] [--out DIR]
//
// Like scratch/dev-retained.mjs and the historical browser-retained runner, this NEVER starts, resets or
// stops the database: start it yourself (`npx supabase@2.119.0 start --workdir scratch/browser-db -x ...`),
// run this, then return it to its original state. Keys come from `supabase status` and are never printed.
// Seeded fixtures stay in the isolated database (new workspaces, random run id); nothing else is written.
// The build is repeated here because NEXT_PUBLIC_* values are inlined at build time.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summarize } from "./measure/summarize.mjs";

process.chdir(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const samples = flag("--samples") ?? "5";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15).toLowerCase();
const outDir = flag("--out") ?? join("outputs", "measurements", "edit-baseline", stamp);
const cli = ["--yes", "supabase@2.119.0"];

function run(command, commandArgs, env = process.env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} ${commandArgs[0]} failed (${code})`))));
  });
}
const text = (command, commandArgs) => spawnSync(command, commandArgs, { encoding: "utf8" }).stdout.trim();

const status = JSON.parse(await run("npx", [...cli, "status", "--workdir", "scratch/browser-db", "-o", "json"], process.env, true));
if (status.API_URL !== "http://127.0.0.1:56321" || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error("Measurements require the isolated local Supabase API on 127.0.0.1:56321 (retained pulse-e2e).");
}
const env = {
  ...process.env,
  PULSE_MEASURE: "1",
  MEASURE_OUT: outDir,
  MEASURE_SAMPLES: samples,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  E2E_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  RESEND_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  NEXT_PUBLIC_WEB_VITALS_ENDPOINT: "",
};
mkdirSync(outDir, { recursive: true });
const environment = {
  sha: text("git", ["rev-parse", "HEAD"]),
  dirty: text("git", ["status", "--porcelain", "--", "src", "app", "package.json", "package-lock.json"]) !== "",
  node: process.version,
  next: JSON.parse(readFileSync("node_modules/next/package.json", "utf8")).version,
  playwright: JSON.parse(readFileSync("node_modules/@playwright/test/package.json", "utf8")).version,
  os: `${text("uname", ["-s"])} ${text("uname", ["-r"])} ${text("sw_vers", ["-productVersion"])}`.trim(),
  cpu: text("sysctl", ["-n", "machdep.cpu.brand_string"]),
  memoryBytes: Number(text("sysctl", ["-n", "hw.memsize"])),
  docker: text("docker", ["--version"]),
  network: "loopback (127.0.0.1), no throttling; Next.js production server (next start) on :3100; Supabase local stack (Kong) on :56321",
  database: "retained isolated project pulse-e2e (scratch/browser-db), started from its existing data, never reset",
  samplesPerFixture: Number(samples),
  startedAt: new Date().toISOString(),
};
writeFileSync(join(outDir, "environment.json"), JSON.stringify(environment, null, 2));
console.log(`[measure] ${environment.sha}${environment.dirty ? " (dirty)" : ""} → ${outDir}`);

if (!args.includes("--skip-build")) await run("npm", ["run", "build"], env);
let exitCode = 0;
try {
  await run("npx", ["playwright", "test", "-c", "scripts/measure/playwright.config.ts"], env);
} catch (error) {
  console.error(error.message);
  exitCode = 1;
}
const files = readdirSync(outDir).filter((file) => file.startsWith("sample-"));
if (files.length) {
  const summary = summarize(outDir);
  writeFileSync(join(outDir, "summary.md"), summary);
  console.log(summary);
} else {
  console.error("[measure] no samples were written");
  exitCode = 1;
}
process.exitCode = exitCode;
