#!/usr/bin/env node
/**
 * Schedule-import hardening — idempotent data setup for the Planning work-order sets.
 * Captures the W1/W2/W3 steps from docs/superpowers/specs/2026-07-07-schedule-import-hardening.md
 * so the live-DB changes are version-controlled, auditable, and re-runnable (safe to run twice).
 *
 * Run: node --env-file=.env.local scripts/planning/harden-schedule-import.mjs
 *
 * What it does (all idempotent):
 *   W1  Retype power-module templates mistyped as head_unit -> power_module, and a stray
 *       trailer template mistyped as head_unit -> trailer.
 *   W2  Upsert the two trailer configs: E = Electric, S = Surge / Hydraulic.
 *   W3  Link each generator (head_unit) template to its power-module template via the
 *       (E)BOSS{A}-{B} nomenclature: {A} = power module, so HEAD UNIT 70-xx -> the 70 PM.
 *       Only links sizes whose PM template exists (70/220/400/500 today; 25/125 pending BOMs).
 *
 * Does NOT touch the production schedule CSV (read-only input) and makes no destructive changes.
 */
import pg from "pg";

const TRAILER_CONFIGS = [
  ["E", "Electric"],
  ["S", "Surge / Hydraulic"],
];

/** First number of a combo like "BOSS70-40" / "HEAD UNIT 70-65" -> "70" (the power-module size). */
function comboPmSize(text) {
  const match = /(\d+)-\d+/.exec(text || "");
  return match ? match[1] : null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/planning/harden-schedule-import.mjs");
  }
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const ws = (await client.query("select distinct workspace_id from work_order_templates limit 1")).rows[0]?.workspace_id;
    if (!ws) throw new Error("No templates found; nothing to harden.");
    console.log(`workspace: ${ws}`);

    await client.query("BEGIN");

    // ── W1: fix mistyped templates ────────────────────────────────────────
    const pmFix = await client.query(
      `update work_order_templates set order_type = 'power_module'
       where workspace_id = $1 and retired_at is null and order_type = 'head_unit'
         and (name ilike '%PM%' or model ilike '%PM%')
       returning name`,
      [ws],
    );
    const trailerFix = await client.query(
      `update work_order_templates set order_type = 'trailer'
       where workspace_id = $1 and retired_at is null and order_type = 'head_unit'
         and (name ilike '%trailer%' or model ilike '%trailer%' or model ilike '%trlr%')
       returning name`,
      [ws],
    );

    // ── W2: trailer config catalog ────────────────────────────────────────
    for (const [letter, name] of TRAILER_CONFIGS) {
      await client.query(
        `insert into trailer_configs (workspace_id, letter, name) values ($1, $2, $3)
         on conflict (workspace_id, letter) do update set name = excluded.name`,
        [ws, letter, name],
      );
    }

    // ── W3: link generators to their PM template ──────────────────────────
    const pms = (
      await client.query(
        "select id, name, model from work_order_templates where workspace_id = $1 and order_type = 'power_module' and retired_at is null",
        [ws],
      )
    ).rows;
    const pmBySize = {};
    for (const pm of pms) {
      const size = /(\d+)\s*PM/i.exec(pm.model || pm.name)?.[1];
      if (size) pmBySize[size] = pm;
    }
    const gens = (
      await client.query(
        "select id, name, model from work_order_templates where workspace_id = $1 and order_type = 'head_unit' and retired_at is null",
        [ws],
      )
    ).rows;
    const linked = [];
    const pending = [];
    for (const gen of gens) {
      const size = comboPmSize(gen.model) || comboPmSize(gen.name);
      const pm = size ? pmBySize[size] : null;
      if (pm) {
        await client.query("update work_order_templates set pm_template_id = $1 where id = $2", [pm.id, gen.id]);
        linked.push(`${gen.name} -> ${pm.name}`);
      } else {
        pending.push(`${gen.name} (needs ${size ? `${size} PM` : "combo?"})`);
      }
    }

    await client.query("COMMIT");

    console.log(`\nW1  retyped -> power_module: ${pmFix.rows.length}  [${pmFix.rows.map((r) => r.name).join(", ")}]`);
    console.log(`W1  retyped -> trailer:      ${trailerFix.rows.length}  [${trailerFix.rows.map((r) => r.name).join(", ")}]`);
    console.log(`W2  trailer configs upserted: ${TRAILER_CONFIGS.map(([l]) => l).join(", ")}`);
    console.log(`W3  generator->PM links:      ${linked.length} linked, ${pending.length} pending`);
    pending.forEach((p) => console.log(`      pending: ${p}`));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
