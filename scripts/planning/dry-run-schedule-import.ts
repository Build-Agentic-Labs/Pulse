#!/usr/bin/env node --experimental-strip-types
/**
 * Dry-run validator for the schedule → work-order-set importer (the spec's acceptance gate).
 * Reads the June Henderson production schedule (read-only), resolves EVERY line against the
 * current template inventory snapshot, and prints resolved vs. flagged with enumerated reasons.
 * Writes nothing. Proves the resolution tables are hardened before the importer is built.
 *
 * Run: node --experimental-strip-types scripts/planning/dry-run-schedule-import.ts [path-to-csv]
 * Default CSV: ~/Downloads/For work orders/productionschedulejune.csv
 *
 * Reuses the single source of truth in src/domain/schedule-import.ts — no duplicated logic.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTemplateIndex,
  cleanSo,
  isSectionHeaderRow,
  resolveLine,
  type FlagCode,
  type LineResolution,
  type TemplateRow,
} from "../../src/domain/schedule-import.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.join(os.homedir(), "Downloads", "For work orders", "productionschedulejune.csv");
const CSV_PATH = process.argv[2] ?? DEFAULT_CSV;
const SNAPSHOT_PATH = path.join(HERE, "template-inventory-snapshot.json");

/** RFC-4180 parse → rows of fields (handles quoted commas + embedded newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      /* skip */
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const FLAG_LABELS: Record<FlagCode, string> = {
  "blank-model": "blank MODEL TYPE (likely a spacer/notes row)",
  "unrecognized-model": "not a GEN/PM/TRL set product (handle as standalone)",
  "unknown-customer": "customer not recognized",
  "no-gen-template-for-combo": "no generator template exists for the combo",
  "no-template-for-customer": "combo exists but not this customer variant",
  "pm-template-missing": "power-module template not authored (D5 skip)",
  "template-model-mismatch": "matched template's name/model disagree — verify BOM (advisory)",
  "trailer-letter-unspecified": "trailer stock without an E/S brake (advisory)",
  "trailer-config-missing": "resolved trailer letter not in the catalog (advisory)",
  "ao-to-enter": "assembly A# still to enter (advisory)",
};

function main(): void {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as {
    trailerLetters: string[];
    templates: TemplateRow[];
  };
  const index = buildTemplateIndex(snapshot.templates, snapshot.trailerLetters);

  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  const header = rows[0].map((h) => h.replace(/\s+/g, " ").trim());
  const col = (name: string) => header.findIndex((h) => h.toUpperCase() === name.toUpperCase());
  const idx = {
    model: col("MODEL TYPE"),
    brake: col("BRAKE TYPE"),
    customer: col("CUSTOMER NAME"),
    fgAo: col("FG SKU AO"),
    so: col("SO#"),
  };
  const rawRows = rows.slice(1).filter((r) => r.some((c) => c && c.trim()));

  // Skip section-divider rows (no unit data) — they're not importable lines.
  const results: Array<{ resolution: LineResolution; model: string; customer: string; so: string; soFlag: boolean }> = [];
  let skippedHeaders = 0;
  for (const r of rawRows) {
    const line = {
      model: (r[idx.model] ?? "").trim(),
      customer: (r[idx.customer] ?? "").trim(),
      brake: (r[idx.brake] ?? "").trim(),
      fgAo: (r[idx.fgAo] ?? "").trim(),
    };
    const rawSo = (r[idx.so] ?? "").trim();
    const so = cleanSo(r[idx.so] ?? "");
    // Feed the RAW SO to the header test: a row whose only datum is "NEED SO#" is a data error
    // to flag, not a divider to silently drop.
    if (isSectionHeaderRow({ model: line.model, so: rawSo, customer: line.customer, fgAo: line.fgAo })) {
      skippedHeaders++;
      continue;
    }
    results.push({ resolution: resolveLine(line, index), model: line.model, customer: line.customer, so: so.so, soFlag: so.flag });
  }
  const data = results;

  const resolved = results.filter((x) => x.resolution.status === "resolved");
  const flagged = results.filter((x) => x.resolution.status === "flagged");

  const bar = "─".repeat(78);
  console.log(`\n${bar}\nSCHEDULE-IMPORT DRY RUN  ·  ${path.basename(CSV_PATH)}\n${bar}`);
  console.log(`Raw rows: ${rawRows.length}   Skipped section headers: ${skippedHeaders}   Importable lines: ${data.length}`);
  console.log(`Resolved: ${resolved.length}   Flagged: ${flagged.length}`);

  // Resolved by kind
  const byKind = new Map<string, number>();
  for (const x of resolved) byKind.set(x.resolution.kind, (byKind.get(x.resolution.kind) ?? 0) + 1);
  console.log(`\nRESOLVED by kind:`);
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

  // Advisory (non-blocking) flags across ALL importable lines — including advisories riding on
  // otherwise-blocked lines, so the full A#-to-enter backlog is visible (spec: "the 9 flagged
  // June lines are known and acceptable").
  const advisoryCounts = new Map<FlagCode, number>();
  for (const x of results) {
    for (const f of x.resolution.flags) if (!f.blocking) advisoryCounts.set(f.code, (advisoryCounts.get(f.code) ?? 0) + 1);
  }
  if (advisoryCounts.size) {
    console.log(`\nADVISORIES across all lines (non-blocking):`);
    for (const [code, n] of [...advisoryCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${code} — ${FLAG_LABELS[code]}`);
    }
  }

  // Data-quality: SO# cleaning (spec rule — NEED/blank SO is flagged for the header, not the set).
  const noSo = results.filter((x) => x.soFlag).length;
  console.log(`\nDATA QUALITY:`);
  console.log(`  ${String(noSo).padStart(3)}  lines with no usable SO# (NEED/blank) — header follow-up, does not block the set`);

  // Flagged by blocking reason
  const blockingCounts = new Map<FlagCode, number>();
  for (const x of flagged) {
    for (const f of x.resolution.flags) if (f.blocking) blockingCounts.set(f.code, (blockingCounts.get(f.code) ?? 0) + 1);
  }
  console.log(`\n${bar}\nFLAGGED — blocking reasons (a line may carry more than one):\n${bar}`);
  for (const [code, n] of [...blockingCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${code} — ${FLAG_LABELS[code]}`);
  }

  // Enumerated flagged lines, grouped by (model + customer + reasons)
  const groups = new Map<string, { count: number; model: string; customer: string; reasons: string[] }>();
  for (const x of flagged) {
    const reasons = x.resolution.flags.filter((f) => f.blocking).map((f) => f.code);
    const key = `${x.model} :: ${x.customer} :: ${reasons.join("+")}`;
    const g = groups.get(key) ?? { count: 0, model: x.model || "(blank)", customer: x.customer || "(blank)", reasons };
    g.count++;
    groups.set(key, g);
  }
  console.log(`\nFLAGGED lines, enumerated (${flagged.length} lines in ${groups.size} groups):`);
  for (const g of [...groups.values()].sort((a, b) => b.count - a.count)) {
    console.log(`  ${String(g.count).padStart(3)}×  ${g.model}  ·  cust=${g.customer}`);
    console.log(`        → ${g.reasons.join(", ")}`);
  }

  // Acceptance gate: assert real invariants, not a tautology.
  const problems: string[] = [];
  const resolvedWithBlocking = resolved.filter((x) => x.resolution.flags.some((f) => f.blocking));
  if (resolvedWithBlocking.length) problems.push(`${resolvedWithBlocking.length} "resolved" line(s) carry a blocking flag`);
  const incompleteHybrid = resolved.filter(
    (x) => x.resolution.kind === "hybrid" && (!x.resolution.genTemplateId || !x.resolution.pmTemplateId),
  );
  if (incompleteHybrid.length) problems.push(`${incompleteHybrid.length} "resolved" hybrid(s) missing a gen or PM template id`);
  const resolvedPmNoTemplate = resolved.filter((x) => x.resolution.kind === "power_module" && !x.resolution.pmTemplateId);
  if (resolvedPmNoTemplate.length) problems.push(`${resolvedPmNoTemplate.length} "resolved" PM line(s) missing a PM template id`);
  const flaggedNoReason = flagged.filter((x) => !x.resolution.flags.some((f) => f.blocking));
  if (flaggedNoReason.length) problems.push(`${flaggedNoReason.length} flagged line(s) with no blocking reason`);
  if (resolved.length + flagged.length !== results.length) problems.push(`resolved + flagged ≠ importable lines`);

  console.log(`\n${bar}`);
  if (problems.length === 0) {
    console.log(`ACCEPTANCE ✓  Every resolved line is a complete, buildable set/order; every`);
    console.log(`              flagged line carries a specific blocking reason. No silent resolution.`);
  } else {
    console.log(`ACCEPTANCE ✗  invariant violations:`);
    for (const p of problems) console.log(`   - ${p}`);
    process.exitCode = 1;
  }
  console.log(bar + "\n");
}

main();
