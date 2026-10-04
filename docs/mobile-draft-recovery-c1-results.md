# C1 implementation results — 2026-10-04

Feature branch: `codex/mobile-draft-recovery`. Confirmed merged baseline: local and fetched
origin/main both `9dfcbb739a5b0136734bc7f883730ac3a2521ad1`. The user subsequently authorized merging when complete; repository policy requires feature-branch CI before publication.

## Delivered contract

New Step recovery uses encoded user/product/task keys in the existing IndexedDB database/store/version.
Each changed snapshot has a unique write token shared by its immediate local write, debounce, retry and
acknowledgment. Same-instance operations are serialized. Cleanup requires matching scope, draft id and
exact token in one readwrite transaction. Unknown/malformed occupied records are preserved.

The account boundary waits for identity before mounting an editable portal, instead of accepting edits
while ownership is unresolved. Account changes remount without reusing another account's server seed,
cancel unsent autosaves, ignore stale restore responses, and guard queued mutation stages. Optional
lifetime checks were added to the mobile step, tool-sync and photo-upload helpers because those helpers
initiate further requests after awaits; portal-entry checks alone cannot enforce the boundary.
Already-issued requests cannot be recalled. Existing callers omitting the guards retain their behavior.

Capture-session keys include user and product. Unowned legacy capture sessions are left untouched and
are not hydrated into a signed-in user's editor. The IndexedDB legacy record has an explicit Review/Back/
Not now/Use flow. User approved the concrete preview in this conversation on 2026-10-04: “Approve this UI”.
Review never saves. Use atomically verifies the reviewed source and absence of an occupied owned slot,
copies into a new owned record, then opens the usual autosaving editor. The source remains unchanged;
repeat adoption retains the same step identity. No discard or migration is included.

## Evidence

- Unit/component suite: 2,173 tests in 253 files (baseline 2,150/251; +23 cases).
- Focused legacy interaction test failed before wiring and passed afterward.
- Removing the exact-token comparison caused two scoped-store tests to fail; source was restored.
- Lint, production build, subsequent typecheck and bundle budgets pass.
- Active isolated database suite: 398 assertions across 22 files pass. Migration ledger remains 151;
  no migration/reset was run. Synthetic fixtures add rows; user/development database is untouched.
- Full real-browser suite: 26/26 pass, including six C1 cases. Immediate reload recovered the latest text in 3/3 observations on this machine without waiting for storage or save status. This is characterization, not a guaranteed durability bound.

Counts measured on one production-build sample per fixture, before connecting the legacy notice:

| Browser-issued mobile-open requests | Baseline median | C1 core |
|---|---:|---:|
| Small | 30 | 30 |
| Medium | 30 | 30 |
| Stress | 114 | 114 |

The baseline's first small sample was 29; the one-request difference is the existing `is_super_admin`
bootstrap call (one versus two), not a new identity request per edit. The approved notice reads local
IndexedDB only; its completed browser tests are separate from these counts. One sample is a count check,
not a latency study. Raw evidence: `outputs/measurements/mobile-recovery-c1/`. An initial measurement
attempt used an old normal build and was excluded/preserved in gitignored scratch.

Final portal bundle: 70,836 → 79,310 raw bytes; 18,848 → 21,444 gzip bytes (+2,596 bytes / 2.54 KiB).
Chunk count stays 112. The >2 KiB increase was reviewed: scoped transaction/validation logic, account
lifecycle checks and explicit legacy-review UI are added runtime code; there is no new dependency.
Planner entry budget 277.0 → 277.1 KiB gzip; largest chunk remains 124.0 KiB. No speedup is claimed.

## Remaining limits and rollback

- Same-user/same-task simultaneous-tab writes remain last-write-win. Exact tokens prevent stale deletion,
  not competing puts. Cross-account/product/task isolation is covered by the fixture matrix.
- Full page teardown before an asynchronous local transaction commits can still lose the latest change.
  Immediate reload observations characterize one machine/browser, not a universal durability guarantee.
- Old unowned localStorage parked payloads remain stored but are not exposed by the IndexedDB legacy
  review UI. They are deliberately not attributed or replayed. No legacy data is deleted.
- Failed local storage writes show the existing warning and do not prevent remote saving. An unchanged
  snapshot whose local put failed is retried remotely; a fresh edit is needed for another local put.
- Empty/unknown occupied owned slots are not overwritten by legacy adoption; use reports that the current
  draft must be finished. Absent-task records stay stored rather than being purged.
- “Saved” refers to the complete remote chain, not a promise of instant local durability. Timer UX and
  broader journaling remain deferred.
- Old builds do not understand v2 records after rollback. Keep those records for re-upgrade; never copy
  them back into the shared legacy key. Rollback may restore the old unscoped behavior.

The source/test footprint exceeds the original 7–10-file estimate because enforcing account lifecycle
required guarding three multi-request helpers and updating their existing characterization tests. No
additional subsystem extraction was started. Final changed-file counts include docs and raw evidence.
