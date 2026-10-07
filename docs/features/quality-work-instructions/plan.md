# Department work instruction builder — local implementation plan

Approved scope: user's 2026-10-06 request and follow-up. Preserve the existing general WI Word
layout; reuse product authoring controls through small adapters, never mount its planning workspace.
Baseline `9d6ef21`. Branch `codex/quality-work-instructions`. No production deployment, merge or push
is authorized. CI configuration is unchanged until local validation and user testing are complete.

## Final design pass

- General WIs are separate from product AWI/task tables and SOP approval transitions. Existing SOP,
  department, access and numbering data remains unchanged. No cleanup, reset or volume deletion.
- Existing Quality tool access determines workspace visibility. Editing and direct publishing require
  actual membership of the owning department plus tool edit access, or workspace owner/admin access.
  Do not reuse the broader SOP approval helper, which can grant cross-department Quality approval.
- Drafts have stable UUIDs and no document number. Multiple-department authors choose an eligible
  department. Department ownership is fixed after creation; moving it is outside this first version.
- A publish transaction validates current permissions and expected document version, requires complete
  content and committed images, allocates WI-DEPT-NNN only on first publish, freezes a revision and
  records an idempotency key. Later revisions keep the same number. Failed/retried publishing cannot
  burn extra numbers or overwrite a published revision. Number collisions include legacy SOP doc types.
- Every edit is a scoped, version-checked operation, not a full-state graph save. Removal preserves
  step records/assets. Reordering validates the complete current step set under a document lock.
- Images use private storage and immutable object paths. Published snapshots retain references to old
  assets. No automatic object deletion. Preview and Word export use the existing renderer with an adapter.
- Pending edits have account/workspace/document-scoped browser recovery and exact operation acknowledgment.
  Database confirmation controls Saved. Offline/conflicting changes remain recoverable; publishing waits
  for all edits/uploads. No claim that browser teardown before a storage commit is universally safe.
- Published content and working draft are distinct. Future SOP linking can select stable WI/revision IDs;
  linking, review flow, timers, BOM, operators and manufacturing checks are outside this version.

## Phases and exit checks

1. **Foundation:** domain model; additive schema; RLS/immutable revisions; granular mutation and publish
   operations; private images. SQL tests cover actual member, manager, viewer, other department/workspace,
   anonymous calls, version conflicts, forged direct writes, simultaneous numbering, retry and rollback.
2. **Authoring:** department library, small details/step/photo components, independent stores and draft
   controller. Unit/component tests cover selection, formatting, ordered saves, failure/recovery, account
   changes, stale acknowledgment, conflict preservation and publish barriers.
3. **Rendering/local acceptance:** existing-theme preview/export; real browser create/edit/reload/image/
   publish/revise cases on a named isolated database; long text and pagination checks; full test/lint/
   build then typecheck; bundle comparison; no unrelated data changes. Supply the local URL for user tests.
4. **Only after local acceptance:** wire SQL/browser cases into CI, verify a fresh isolated schema and
   all jobs; review production migration separately. Do not publish untested schema-dependent UI to main.

Target boundaries: domain schema/validation, document reads, mutation/publish store, image store,
library, editor composition, details, step editor, photos, preview, and draft controller. Most UI
files should stay under 350 lines. Exceptions require a named responsibility and review; splitting the
same tangled state across files is not an improvement.

## Status

Phases 1–3 implemented and locally validated on 2026-10-07; ready for user acceptance.
Phase 4 has not started. Local-only browser/SQL coverage stays outside CI's active discovery
paths until acceptance. App unit tests use existing automatic discovery without a CI configuration edit.
See [local acceptance](local-acceptance.md) for measured results, limits and release conditions.
