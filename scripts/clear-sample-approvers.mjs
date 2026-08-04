// One-off cleanup: remove the fictional sample approver roster from SOPs whose
// approvals array was overwritten by the (now removed) "fill with sample data"
// button. See the 2026-08-04 investigation: the button stamped five invented
// approvers into the controlled document, and no UI could edit them back out.
//
// What "clear" means here: each approval row keeps its ROLE and gets an empty
// name/position/date — i.e. exactly the blank template createEmptySop seeds
// (the sample roles are identical to DEFAULT_APPROVAL_ROLES, verified). Rows
// are never added or removed, so the document's shape is unchanged.
//
// Safety rails:
//   - only rows whose approver names EXACTLY match the sample roster are eligible,
//     so a converted SOP's real (transcribed) approvers can never be caught;
//   - drafts only, enforced in SQL — and independently by the live
//     enforce_sop_transition trigger, which raises on any document edit when
//     status <> 'draft' (so an in_review SOP is rejected by the database itself);
//   - jsonb_set on the single {approvals} path — no full-document overwrite;
//   - dry run by default. Nothing is written without --apply.
//
// Usage:
//   node --env-file=.env.local scripts/clear-sample-approvers.mjs
//   node --env-file=.env.local scripts/clear-sample-approvers.mjs --apply

import pg from "pg";

const SAMPLE_NAMES = ["Robbie Miller", "Dana Cho", "Luis Ortega", "Priya Nair", "Sara Whitfield"];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Add it to .env.local.`);
    process.exit(1);
  }
  return value;
}

/** True only when the row's names are exactly the sample roster, in order. */
function isSampleRoster(approvals) {
  if (!Array.isArray(approvals)) return false;
  const names = approvals.map((a) => (a && typeof a.name === "string" ? a.name.trim() : "")).filter(Boolean);
  return names.length === SAMPLE_NAMES.length && names.every((n, i) => n === SAMPLE_NAMES[i]);
}

/** Blank the person fields, keep the role — restores createEmptySop's template. */
function clearedApprovals(approvals) {
  return approvals.map((row) => ({ role: row?.role ?? "", name: "", position: "", date: "" }));
}

const apply = process.argv.includes("--apply");
const client = new pg.Client({
  connectionString: requireEnv("DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  const { rows } = await client.query(
    `select id, status,
            coalesce(nullif(document->'meta'->>'title',''), '(untitled)') as title,
            document->'approvals' as approvals
       from sops
      order by status, title`,
  );

  const eligible = rows.filter((r) => isSampleRoster(r.approvals));
  const drafts = eligible.filter((r) => r.status === "draft");
  const blocked = eligible.filter((r) => r.status !== "draft");

  console.log(`${eligible.length} SOP(s) carry the sample roster: ${drafts.length} draft, ${blocked.length} not draft.\n`);
  for (const row of blocked) {
    console.log(`  BLOCKED (${row.status}) ${row.title} — the database refuses document edits outside draft`);
  }
  if (blocked.length) console.log("");

  if (!apply) {
    for (const row of drafts) {
      const before = row.approvals.map((a) => a.name).filter(Boolean).join(", ");
      console.log(`  would clear: ${row.title} (${row.id.slice(0, 8)}) — ${before}`);
    }
    console.log(`\nDry run. Re-run with --apply to write.`);
    process.exit(0);
  }

  let cleared = 0;
  let skipped = 0;
  for (const row of drafts) {
    try {
      const next = clearedApprovals(row.approvals);
      // Guard again in SQL: drafts only, and the row must still hold the roster.
      const result = await client.query(
        `update sops
            set document = jsonb_set(document, '{approvals}', $1::jsonb)
          where id = $2 and status = 'draft'`,
        [JSON.stringify(next), row.id],
      );
      if (result.rowCount === 1) {
        cleared += 1;
        console.log(`cleared: ${row.title} (${row.id.slice(0, 8)})`);
      } else {
        skipped += 1;
        console.error(`skipped ${row.id.slice(0, 8)}: guarded update matched no row`);
      }
    } catch (error) {
      skipped += 1;
      console.error(`skipped ${row.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\nDone. ${cleared} cleared, ${skipped} skipped, ${blocked.length} blocked by status.`);
} finally {
  await client.end();
}
