// Turns a measurement run directory (environment.json, fixture-*.json, sample-*.json) into Markdown.
//   node scripts/measure/summarize.mjs outputs/measurements/edit-baseline/<stamp>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (dir, file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const stat = (values) => values.length ? `${median(values)} (min ${Math.min(...values)}, max ${Math.max(...values)}, n=${values.length})` : "—";

export function summarize(dir) {
  const environment = read(dir, "environment.json");
  const files = readdirSync(dir);
  const fixtures = files.filter((f) => f.startsWith("fixture-")).map((f) => read(dir, f));
  const samples = files.filter((f) => f.startsWith("sample-")).map((f) => read(dir, f));
  const lines = [];
  lines.push(`# Edit baseline measurement ${environment.startedAt}`, "");
  lines.push(`Build SHA \`${environment.sha}\`${environment.dirty ? " (working tree dirty in src/app)" : ""}; Node ${environment.node}; Next ${environment.next}; Playwright ${environment.playwright}; Chromium ${samples[0]?.browser ?? "?"}.`);
  lines.push(`${environment.os}; ${environment.cpu}; ${(environment.memoryBytes / 2 ** 30).toFixed(0)} GiB; ${environment.docker}.`);
  lines.push(`Network: ${environment.network}. Database: ${environment.database}.`);
  lines.push(`Samples per fixture: ${environment.samplesPerFixture}. Sample 1 of each fixture is the cold run (first visit to that project since the server started; every sample uses a new browser context, so the browser cache is empty in all of them). Warm = samples 2..n. Only browser-issued requests are counted; server-component fetches during the first paint are not visible to the recorder.`, "");
  lines.push("## Fixtures", "", "| Fixture | zones | stations | tasks | steps | step_tools | seed time |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const fx of fixtures) lines.push(`| ${fx.fixture} | ${fx.counts.zones} | ${fx.counts.stations} | ${fx.counts.tasks} | ${fx.counts.manufacturing_steps} | ${fx.counts.step_tools} | ${fx.seedMs} ms |`);
  lines.push("");
  for (const fx of fixtures) {
    const own = samples.filter((s) => s.fixture === fx.fixture).sort((a, b) => a.sample - b.sample);
    if (!own.length) continue;
    lines.push(`## ${fx.fixture}`, "");
    const phases = Object.keys(own[0].phases);
    lines.push("### Timing (ms)", "", "| Phase | cold (sample 1) | warm median (min, max, n) |", "|---|---:|---|");
    for (const phase of phases) {
      const warm = own.slice(1).map((s) => s.phases[phase]?.durationMs).filter((v) => v != null);
      lines.push(`| ${phase} | ${own[0].phases[phase]?.durationMs ?? "—"} | ${stat(warm)} |`);
    }
    const warmPersist = own.slice(1).map((s) => s.persistence.fromBlurToDbMs).filter((v) => v != null);
    lines.push(`| blur → row observable in DB (poll ${own[0].persistence.pollIntervalMs} ms) | ${own[0].persistence.fromBlurToDbMs ?? "not confirmed"} | ${stat(warmPersist)} |`, "");
    lines.push("### Supabase requests by endpoint", "");
    for (const phase of phases) {
      const perSample = own.map((s) => s.phases[phase]?.requests ?? {});
      const keys = [...new Set(perSample.flatMap((r) => Object.keys(r)))].sort();
      const totals = perSample.map((r) => Object.values(r).reduce((n, e) => n + e.count, 0));
      const respBytes = perSample.map((r) => Object.values(r).reduce((n, e) => n + e.responseBytes, 0));
      const reqBytes = perSample.map((r) => Object.values(r).reduce((n, e) => n + e.requestBytes, 0));
      const app = own.map((s) => s.phases[phase]?.appResponseBytes ?? 0);
      const identical = totals.every((t) => t === totals[0]) && keys.every((k) => perSample.every((r) => (r[k]?.count ?? 0) === (perSample[0][k]?.count ?? 0)));
      lines.push(`#### ${phase}`, "", `Total Supabase requests per sample: ${totals.join(", ")} (${identical ? "identical endpoint counts in every sample" : "counts differ between samples"}). Response bytes median ${kib(median(respBytes))}, request bytes median ${kib(median(reqBytes))}; app-origin (documents, chunks, RSC) response bytes median ${kib(median(app))}.`, "");
      lines.push("| Endpoint | count (per sample) | response bytes (median) | failed |", "|---|---|---:|---:|");
      for (const key of keys) {
        const counts = perSample.map((r) => r[key]?.count ?? 0);
        const bytes = perSample.map((r) => r[key]?.responseBytes ?? 0);
        const failed = perSample.reduce((n, r) => n + (r[key]?.failed ?? 0), 0);
        lines.push(`| \`${key}\` | ${counts.every((c) => c === counts[0]) ? counts[0] : counts.join("/")} | ${kib(median(bytes))} | ${failed} |`);
      }
      lines.push("");
    }
    const errors = own.flatMap((s) => s.pageErrors);
    lines.push(`Page errors: ${errors.length ? errors.join("; ") : "none"}.`, "");
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  console.log(summarize(process.argv[2]));
}
