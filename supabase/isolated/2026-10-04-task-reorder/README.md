# Atomic task reorder pilot — NOT AUTHORIZED FOR PRODUCTION

Implementation and release gate: [results](../../../docs/atomic-task-reorder-results.md).
SQL is outside `supabase/migrations`; the normal CI database/browser jobs do not provision or exercise
this pilot automatically. Client changes must stay unmerged until the reviewed RPCs are deployed.

- `20261005022000_atomic_task_reorder.sql`: additive production candidate, not applied remotely.
- `task-reorder.test.sql`: 41 pgTAP assertions, synthetic fixtures in a rolled-back transaction.
- `verify-sql.mjs`: verifies installed RPC body matches candidate and runs pgTAP on port 56322 only.
- `verify.mjs`: reads isolated local credentials internally and runs the five DB/API cases. Never prints keys.
- `reorder.integration.test.ts`: real requests, overlapping transactions and old-path interruption.
- `reorder.browser.spec.ts` / `playwright.config.ts`: rendered desktop/mobile drag verification on 3214.

Start retained `pulse-e2e` from its existing data, never reset it. Provision only in explicitly isolated
infrastructure; no command here starts, resets or stops a database. Preserve all volumes and restore
its previous stopped/running state after tests. Integration/browser fixtures are retained synthetic rows.
The pilot schema is already provisioned locally; do not replay its CREATE statements over it.

After provisioning the candidate, from repo root:

```
node supabase/isolated/2026-10-04-task-reorder/verify-sql.mjs
node supabase/isolated/2026-10-04-task-reorder/verify.mjs
```

Browser runs need a production build in `.next-e2e`, `PULSE_BROWSER_TEST=1`, the isolated API on 56321,
and local keys supplied internally by the retained runner. No keys, user credentials or response bodies
are part of the published measurements.
