// Assisted backfill: restore structure in already-converted SOP Procedure text
// (spec docs/superpowers/specs/2026-08-04-sop-procedure-structure-design.md).
//
// Phase 1 (default): for each DRAFT SOP whose procedure narrative is longer
// than 400 chars, ask Claude to restructure (RESTRUCTURE_INSTRUCTION), verify
// mechanically that only whitespace/glyphs changed, and write a reviewable
// before/after diff to scratch/procedure-backfill/<sop-number-or-id>.diff.txt.
// NOTHING is written to the database in this phase.
//
// Phase 2 (--apply): after a human has reviewed the diffs, re-run with --apply.
// Re-generates deterministically? No — it REUSES the reviewed outputs stored in
// scratch/procedure-backfill/<id>.after.txt (written in phase 1), re-verifies
// each against the CURRENT database text (a draft edited since phase 1 fails
// verification and is skipped), and applies per-row guarded updates:
//   update sops set document = jsonb_set(document, '{procedure,processFlowDescription}', $1)
//   where id = $2 and status = 'draft'
// Drafts only, one row at a time, no full-state save path.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-procedure-structure.mjs
//   node --env-file=.env.local scripts/backfill-procedure-structure.mjs --apply
//
// Requires ANTHROPIC_API_KEY (phase 1) and DATABASE_URL (both phases — the
// same Postgres connection env var name every other pg-backed ops script in
// scripts/ reads, e.g. scripts/apply-migration-safely.mjs) in .env.local.

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join(process.cwd(), "scratch", "procedure-backfill");
const MIN_LENGTH = 400;
// Own env var — SOP_EXTRACTION_MODEL steers the app's conversion route with a
// DIFFERENT default, and sharing it would silently re-steer this script. A
// mid-tier default is correct here: restructuring is mechanical, and the
// wording verifier makes a weaker model fail SAFE (skip + log, never corrupt).
const MODEL = process.env.BACKFILL_RESTRUCTURE_MODEL || "claude-sonnet-4-6";

// --- Canonical copies -------------------------------------------------------
// These two are byte-identical to src/domain/sop/procedure-text-restructure.ts
// (the canonical source); a repo test asserts they stay in sync.

function contentProjection(text) {
  return (text.normalize("NFC").match(/[\p{L}\p{N}]/gu) ?? []).join("");
}

function restructurePreservesWording(before, after) {
  return contentProjection(before) === contentProjection(after);
}

const RESTRUCTURE_INSTRUCTION = `You are restructuring the Procedure narrative of a controlled SOP document. The text lost its formatting during a document conversion: paragraph breaks may be collapsed, list items may be run together, numbered sub-headings may be buried mid-line.

Return the SAME text with ONLY its structure restored:
- Put each numbered sub-heading (like "4.4 Document Creation") on its own line, exactly as written.
- Put each list item on its own line starting with "• " (bullet + space). Convert run-together lists (comma- or semicolon-joined items, often Capitalized) into bullet lines.
- Separate paragraphs with one blank line.
- NEVER reword, summarize, reorder, add, or drop content. Every letter and digit of the original must appear, in order. Separator punctuation (the commas or semicolons that joined run-together list items) may be dropped when the items become bullet lines; all other punctuation stays.

Return ONLY the restructured text — no commentary, no code fences.`;
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Add it to .env.local.`);
    process.exit(1);
  }
  return value;
}

async function loadDrafts(client) {
  const { rows } = await client.query(
    `select id, document->'meta'->>'sopNumber' as sop_number,
            document->'meta'->>'title' as title,
            document->'procedure'->>'processFlowDescription' as text
       from sops
      where status = 'draft'
        and length(coalesce(document->'procedure'->>'processFlowDescription', '')) > $1
      order by sop_number nulls last, id`,
    [MIN_LENGTH],
  );
  return rows;
}

function fileStem(row) {
  return (row.sop_number || row.id).replaceAll(/[^\w.-]/g, "_");
}

async function generate() {
  const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const client = new pg.Client({
    connectionString: requireEnv("DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const rows = await loadDrafts(client);
    console.log(`${rows.length} draft SOP(s) with a procedure narrative over ${MIN_LENGTH} chars.`);
    await mkdir(OUT_DIR, { recursive: true });
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      const label = `${row.sop_number || row.id} — ${row.title || "untitled"}`;
      // Streaming accessor because 32k max_tokens trips the SDK's ten-minute
      // non-streaming guard; finalMessage() returns the same Message shape.
      const response = await anthropic.messages
        .stream({
          model: MODEL,
          // Sized per the sister extraction route's precedent (32k): opus runs
          // adaptive thinking by default and it shares this budget, so 8k could
          // truncate the longest procedures. Truncation fails SAFE (the verifier
          // rejects a missing tail) but costs yield; headroom is cheaper.
          max_tokens: 32768,
          system: RESTRUCTURE_INSTRUCTION,
          messages: [{ role: "user", content: row.text }],
        })
        .finalMessage();
      if (response.stop_reason === "max_tokens") {
        failed += 1;
        console.error(`TRUNCATED (max_tokens) — skipped: ${label}`);
        continue;
      }
      const after = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      if (!restructurePreservesWording(row.text, after)) {
        failed += 1;
        console.error(`VERIFY FAILED (wording changed) — skipped: ${label}`);
        continue;
      }
      const stem = fileStem(row);
      await writeFile(path.join(OUT_DIR, `${stem}.id.txt`), row.id, "utf8");
      await writeFile(path.join(OUT_DIR, `${stem}.after.txt`), after, "utf8");
      await writeFile(
        path.join(OUT_DIR, `${stem}.diff.txt`),
        [`=== ${label}`, "", "--- BEFORE ---", row.text, "", "--- AFTER ---", after, ""].join("\n"),
        "utf8",
      );
      ok += 1;
      console.log(`verified + diff written: ${label}`);
    }
    console.log(`\nDone. ${ok} verified, ${failed} skipped. Review ${OUT_DIR}/*.diff.txt, then re-run with --apply.`);
  } finally {
    await client.end();
  }
}

async function apply() {
  const client = new pg.Client({
    connectionString: requireEnv("DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const stems = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".after.txt"));
    if (stems.length === 0) {
      console.error(`No reviewed outputs found in ${OUT_DIR}. Run the generate phase first.`);
      process.exit(1);
    }
    let applied = 0;
    let skipped = 0;
    for (const file of stems) {
      const stem = file.replace(/\.after\.txt$/, "");
      // Per-item isolation: one bad pair or transient DB error skips that row
      // and keeps the run going — the operator always gets the full report of
      // what applied and where it stopped, instead of a mid-loop crash.
      try {
        const id = (await readFile(path.join(OUT_DIR, `${stem}.id.txt`), "utf8")).trim();
        const after = await readFile(path.join(OUT_DIR, file), "utf8");
        const { rows } = await client.query(
          `select status, document->'procedure'->>'processFlowDescription' as text from sops where id = $1`,
          [id],
        );
        const current = rows[0];
        if (!current || current.status !== "draft") {
          skipped += 1;
          console.error(`skipped ${stem}: not found or no longer a draft`);
          continue;
        }
        // A draft edited since generation fails re-verification and is skipped —
        // the reviewed diff no longer describes the row.
        if (!restructurePreservesWording(current.text ?? "", after)) {
          skipped += 1;
          console.error(`skipped ${stem}: database text changed since the diff was generated`);
          continue;
        }
        const result = await client.query(
          `update sops
              set document = jsonb_set(document, '{procedure,processFlowDescription}', to_jsonb($1::text))
            where id = $2 and status = 'draft'`,
          [after, id],
        );
        if (result.rowCount === 1) {
          applied += 1;
          console.log(`applied: ${stem}`);
        } else {
          skipped += 1;
          console.error(`skipped ${stem}: guarded update matched no row`);
        }
      } catch (error) {
        skipped += 1;
        console.error(`skipped ${stem}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`\nDone. ${applied} applied, ${skipped} skipped.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--apply")) {
  await apply();
} else {
  await generate();
}
