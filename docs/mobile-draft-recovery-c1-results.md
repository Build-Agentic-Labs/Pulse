# C1 implementation results — 2026-10-04

**Published:** main `1147c7d` (2026-10-04), fast-forwarded from `9dfcbb7`. Local and origin/main are synchronized; the feature branch was removed after its commit was confirmed on origin/main.

All three jobs passed in [feature CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/37245651707)
and [main CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/37246120976).
This is the canonical C1 contract, verification and limitations document. The completed implementation
handoff was consolidated here; the superseded initial design is kept under `docs/history/`.

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

## Shipped storage and adoption rules

- Key: `mobile-new-step-draft-v2:<encoded userId>:<encoded projectId>:<encoded taskId>`.
- Record: `schemaVersion: 2`, repeated scope, `draftId` equal to the valid step id, unique `writeToken`,
  `updatedAt`, and the full name/instruction/duration/tools/photos/checks/checkValues payload.
- Immediate local write, debounce, retry and acknowledgment reuse the same unchanged snapshot/token.
  A changed snapshot gets a fresh token. No revision or timestamp inequality authorizes deletion.
- Save/load/acknowledge/adopt use captured scope and per-key same-instance ordering. Local operations
  settle on transaction completion; transaction errors and aborts reject, and opened connections close.
- Acknowledgment uses atomic get/conditional delete with matching schema, scope, draft id and exact token.
  The complete remote step/tools/photos chain must succeed first; a failed local put never permits cleanup.
- Recovery checks only the selected loaded task. Missing-task, empty and malformed records are retained;
  recovery does not automatically switch tasks or create a draft directory.
- Identity is a local ownership label; existing server permissions authorize remote writes. There is no
  anonymous/shared key and no network identity lookup per keystroke. Account changes detach old state,
  cancel unsent work and prevent subsequent queued mutation stages from starting in the new account.
- Legacy Review/Back/Not now do not write. Use revalidates the reviewed legacy snapshot and destination
  slot in one transaction, persists the owned copy before opening the editor, and retains the legacy
  source unchanged. An occupied owned slot is refused. Repeat adoption retains the original step id.
- No expiry, bulk clearing, new IndexedDB version, production migration, dependency or permission change.

## Acceptance evidence by boundary

| Boundary | Evidence |
|---|---|
| Products and tasks | Real Chromium IndexedDB retains separate pending payloads across switches |
| Accounts | One browser profile switches U1 → U2 → U1; U2 receives no U1 owned payload |
| Tokens and ordering | Store/component tests; two browser tabs demonstrate old-token acknowledgment preserves newer content |
| Lifecycle | Component tests cancel unsent work and isolate late completions; step/tool/photo helper tests guard later mutation stages |
| Legacy | Component and browser Review/Back/Not now/Use tests preserve source and prevent replacement; repeat Use creates no duplicate step |
| Invalid data and failures | Store tests retain malformed/unknown slots and handle transaction abort; component tests retain recovery after tool failure and warn on unavailable storage |
| Reload | Browser reload restores a locally committed draft while remote saving is blocked; immediate reload observed 3/3 recovery without a commit wait |

These assertions establish the tested contracts, not universal offline safety. Baseline characterization
cases were updated where C1 intentionally changed behavior; not every test was a pre-fix reproduction.

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
