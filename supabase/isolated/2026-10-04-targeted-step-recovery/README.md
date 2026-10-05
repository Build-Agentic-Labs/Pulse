# Targeted step recovery pilot — NOT AUTHORIZED FOR PRODUCTION

User requested correction of the remaining edit-safety risks on 2026-10-04. Production database
activation and visible interface changes remain separate approvals. This directory is outside the
active migration/test paths; it changes no production schema, migration ledger or client call path.

## Concrete candidate

`20261005021558_targeted_step_recovery.sql` adds one RLS-protected recovery table, two authenticated
RPCs and three private helpers. It replaces no existing functions or policies. Migration execution
contains no data cleanup, expiry, storage deletion or existing-row modification.

- Delete validates the session actor, project access and expected step version. It locks scenario,
  product, task and steps in the existing reorder order, records that step's exact children and three
  scoped custom-field entries, then deletes only that step and compacts current numbering.
- The caller supplies an operation UUID. Reusing it with different actor/scope/step/version refuses;
  replay after a lost response returns the existing receipt. Replay after restore cannot delete again.
- Restore uses the stored record, never caller-supplied row snapshots. It restores the original step,
  children and missing scoped entries into the current task, preserving unrelated teammate edits and
  newly added steps. It recalculates duration. Occupied IDs, missing parents and malformed current
  field maps refuse atomically, leaving the recovery record intact.
- Direct record writes are forbidden to authenticated clients. Restore requires current project edit
  access. Existing storage objects remain untouched; the RPC restores captured metadata only.

## Observed validation

Executed on the retained `pulse-e2e` database, port 56322, in a transaction that included DDL and test
fixtures and was **rolled back**. No new objects, fixtures or migration ledger entries remain.
The absent-function check failed twice before the pilot. `targeted_step_recovery_test.sql` passes
**33/33 pgTAP assertions** with the candidate SQL present in the transaction.

Tests cover viewer/foreign/anonymous callers, captured-actor mismatch, stale step versions, exact
operation replay and UUID misuse, forbidden recovery-record writes, selected-step-only deletion,
child/custom-map capture, current numbering/duration, unrelated task preservation, occupied-ID and
malformed-map refusal with complete row comparisons, missing-parent recovery retention, authorized
teammate restore, repeat restore, teammate edits/new steps surviving and old delete replay after restore.

## Reproduce without resetting or applying anything

Use an already running, identified isolated database with the active schema. Never run against
production or the dev database. In one transaction: install pgTAP temporarily if absent; set the
search path to `public,extensions`; execute the candidate SQL; execute the test file with its initial
`begin` omitted; verify 33 passing TAP assertions; roll back. `ON_ERROR_STOP` is required. An SQL error
must close/rollback the session rather than commit anything. Do not use a fresh reset on retained data.

## Remaining release work

This is a candidate, not a completed Package E release:

1. Real independent-session reorder/delete/restore concurrency and injected mid-operation failure.
2. Narrow mobile store and UI integration replacing the whole-snapshot Restore path, with regression
   coverage, lost-response retry, local-write barriers and safe confirmation failures. Current mobile
   deletion still uses the legacy saver; the pilot has not changed current user behavior.
3. Record/media visibility and deployed grant review, narrow additive production migration approval,
   then generate types from the approved schema before client publication.
4. Document legacy writer support. These RPCs protect participating operations; old unversioned
   clients can still overwrite later. No silent global blocking, maintenance mode or add-only writer
   replacement is approved by this pilot.

Do not copy the older tool-catalog/fence prototype into this release. No catalog rollout, purge,
volume deletion or shared-writer rewrite is authorized here.
