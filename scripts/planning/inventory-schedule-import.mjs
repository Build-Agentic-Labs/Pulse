#!/usr/bin/env node
/**
 * Read-only inventory dump for schedule-import hardening. Prints the current work-order
 * template set (generators + power modules with their set-definition links) and the trailer
 * config catalog, so the resolution tables can be built against real template names.
 *
 * Run: node --env-file=.env.local scripts/planning/inventory-schedule-import.mjs
 *
 * Makes NO writes. Complements harden-schedule-import.mjs (which applies the W1/W2/W3 setup).
 */
import pg from "pg";

async function main() {
  const cs = process.env.DATABASE_URL?.trim();
  if (!cs) {
    throw new Error("DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/planning/inventory-schedule-import.mjs");
  }
  const client = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const ws = (await client.query("select distinct workspace_id from work_order_templates limit 1")).rows[0]?.workspace_id;
    console.log(`workspace: ${ws}\n`);

    const templates = (
      await client.query(
        `select id, name, model, order_type, pm_template_id, default_trailer_letter, retired_at
         from work_order_templates where workspace_id = $1 order by order_type, name`,
        [ws],
      )
    ).rows;

    const byType = {};
    for (const row of templates) (byType[row.order_type] ??= []).push(row);
    for (const type of Object.keys(byType).sort()) {
      console.log(`=== order_type = ${type}  (${byType[type].length}) ===`);
      for (const row of byType[type]) {
        const retired = row.retired_at ? " [RETIRED]" : "";
        const link = row.pm_template_id ? `  pm->${String(row.pm_template_id).slice(0, 8)}` : "";
        const letter = row.default_trailer_letter ? `  letter=${row.default_trailer_letter}` : "";
        console.log(`  name=${JSON.stringify(row.name)}  model=${JSON.stringify(row.model)}${link}${letter}${retired}`);
      }
      console.log("");
    }

    const configs = (
      await client.query(
        "select letter, name, trailer_template_id from trailer_configs where workspace_id = $1 order by letter",
        [ws],
      )
    ).rows;
    console.log(`=== trailer_configs (${configs.length}) ===`);
    for (const row of configs) {
      console.log(`  ${row.letter} = ${JSON.stringify(row.name)}${row.trailer_template_id ? "  (template linked)" : ""}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
