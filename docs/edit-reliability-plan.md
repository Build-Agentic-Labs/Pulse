# Edit reliability and editor structure plan

Status reconciled 2026-10-04 against published main `1147c7d`, with all three CI jobs green.
The five-phase workspace restructure is complete. Package A and mobile slices B1/B2 are published;
C1 scoped mobile recovery is published with the approved legacy-review flow and exact write tokens.
The rest of Package B, the broader Package C recovery pilot, and Packages D–G have not started.
Catalog rollout and experimental database deployment remain blocked. This document is the active
roadmap; [docs/README.md](README.md) is the current status and documentation index.

The next investment should improve edit ownership, recoverability, and persistence boundaries. Smaller editor modules support that work; line reduction alone is not the goal. Keep the current UI unless the user approves a concrete visible change. Preserve existing data and retain all test database volumes.

## Historical Package A baseline and confidence

The source measurements below were taken directly from the working tree. **Refreshed 2026-10-04 on
`438a6df`:** the "Verified" column records what Package A re-measured; the historical request figures
were rerun on an identical fixture and reproduced, and two larger fixtures were added
(`docs/edit-reliability-baseline-2026-10-04.md` §2). Production behavior, usage frequency and failure
rates have still not been measured; latency was measured only on loopback with 5 samples per condition.

| Baseline | Value | Evidence and qualification | Verified 2026-10-04 on `438a6df` |
|---|---:|---|---|
| Mobile editor | 4,369 physical lines | `src/components/mobile-photo-portal.tsx` | unchanged |
| Planner workspace | 3,652 lines | `src/components/line-workspace.tsx` | unchanged |
| SOP editor | 3,493 lines | `src/components/sop/sop-editor.tsx` | unchanged |
| Gantt timeline | 2,787 lines | `src/components/gantt-timeline.tsx` | unchanged |
| Photo viewer | 2,455 lines | `src/components/step-photo-viewer.tsx` | unchanged |
| Workspace data-hook options | 39 fields | `UseWorkspaceDataOptions`; evidence of coupling, not 39 defects | 39 |
| Planner persistence modules | 15 | `src/lib/planner/` | 15 |
| Unit suite | 2,080 passing / 247 files | rerun this pass (was 2,072 reported) | typecheck + lint + tests pass |
| Browser suite | 20 passing | Handoff; mainly AWI/product scenarios, not mobile coverage | not rerun; CI green on the SHA |
| Active database suite | 22 files / 398 assertions | Handoff; experimental assertions excluded intentionally | 22 files; assertions not rerun |
| Planner bundle | 276.9 KiB gzip (was 277.0) | `npm run check:bundles` on this pass's production build; largest chunk 124.0 KiB | rerun |
| Requests, small fixture | 61 opening / 5 first Procedure | reproduced exactly (per-endpoint identical); "0 other switches" not re-measured | rerun |
| Requests, medium fixture (40 tasks, 200 steps, 400 tools) | 61 open / 5 Procedure / 18 per instruction edit / 30 mobile open | new; one edit PATCHes every step of the task | new |
| Requests, stress fixture (1,100 tasks/steps, 1,100 tools on one step) | 124 open (2.2 MiB) / 5 / 16 / 114 mobile open (2.3 MiB) | new; paging crossed as designed | new |
| Persistence latency, instruction edit | ~800 ms blur → row in DB | dominated by the 750 ms debounce; loopback; 4 warm samples | new |

### Verified source boundaries

- Mobile `restoreDeletedSnapshot` calls `savePlannerStateToSupabase(snapshot)` and then restores photos using `Promise.allSettled`. This is scenario-snapshot work behind a one-step restore action. The earlier investigation reports real-database data-loss reproduction; this planning pass only rechecked the code.
- Desktop Gantt reorder and mobile `persistHighLevelTaskReorder` both save temporary WBS values and final values in separate awaited operations. Network interruption between them is a design risk, not a new reproduction from this pass.
- `shell-store.ts` explicitly contains multi-request saves. Its deletion tripwire protects against some mass deletions, not every stale overwrite or child replacement.
- ~~`loadTaskFromSupabase` still reads some media/tool/dependency collections without the full loader's paging and deterministic tie-breaking.~~ **Fixed on `main` at `438a6df`** and verified live (Package A).
- SOP `persist` already serializes saves and uses a persisted version token. Preserve its document-control rules rather than replacing it with a generic planner saver.
- ~~`docs/deferred-work.md` and `docs/correctness-scope.md` contain historical statements that no longer describe current deployment and CI.~~ **Reconciled 2026-10-04**: every section carries a status line; the verdict on each recorded risk is in `docs/edit-operation-inventory.md` §10.

## Decisions and constraints

### Single task read investigation received October 4

Claude reported a read-only production investigation after this plan was drafted. These measurements were supplied by the user and have not been independently repeated here:

| Collection | Reported largest collection per task |
|---|---:|
| Photos | 199 |
| Tools | 39 |
| Steps | 49; already paged |
| Parts | 16; already paged |
| Exploded views | 6 |
| Dependencies | 2 |
| Videos | 0 |

Reported API cap: 1,000 rows. No current per-task truncation was found. Reported timestamp ties: 27 photos in six groups across five tasks, largest group 11. A visible reorder was not reproduced; tied query ordering permits it. Save-completion merging currently masks the photo-order difference, whereas idle realtime/mobile refetch can apply it.

Recommended prerequisite: a separate, bounded single-task read fix using existing paging helpers and the full/hydrated loaders' stable ordering. Test multi-page collections, tied primary sort values, exact page boundaries, injected-client propagation, and preserved filters. Query-shape snapshots alone are not proof. On current-size fixtures request counts should not increase; at an exact page-size boundary an extra empty request may be necessary to establish completion. Do not label a prospective five-line estimate as the full test/validation scope.

Status: **complete.** Implemented on `main` at `438a6df` (branch `codex/single-task-read-paging`, CI green)
and verified by Package A both in code (`read-store.ts:534-540`) and live (the stress fixture's
confirmation read paged `step_tools` across three requests). This prerequisite is removed from Package A.

### Implementation rules

1. No framework replacement, global state-library migration, or repository-wide rewrite is proposed.
2. Extraction and behavior correction are separate commits and separate validation claims.
3. Project-wide catalog scope and existing permission rules remain the chosen design direction, but the old-client rollout remains blocked.
4. Do not apply the isolated recovery migration, change production tables, delete records, or introduce automatic cleanup as part of this plan's early phases.
5. Database-backed operation design can proceed in disposable infrastructure only after its specific implementation approval. Production deployment remains a separate decision.
6. Shared infrastructure may handle operation identity, ownership, acknowledgment, and recovery. Planner, mobile capture, and controlled SOP workflows retain their own domain rules.
7. No performance percentages or time estimates are promised before a reproducible baseline exists.

## Work packages and order

| Package | Scope | Status | Evidence and next gate |
|---|---|---|---|
| A | Baseline and edit-operation inventory | Complete | Published with B1/B2 at `9dfcbb7`; historical measurements retained |
| B | Mobile responsibility extraction | Partial | B1/B2 published; further extraction not started |
| C | Narrow edit recovery pilots | Partial | C1 phone draft scoping published at `1147c7d`; broader durable-recovery pilot not started |
| D | Atomic task reorder | Not started | Proposed next implementation pilot; design, failure matrix and any database change need review |
| E | Targeted step delete/restore | Not started | Depends on approved database design and client compatibility |
| F | Catalog consistency and writer compatibility | Blocked | Existing client compatibility risks unresolved |
| G | Further editor/controller decomposition | Not started | Choose boundaries using measured need, not line quotas |

Packages C and D are small vertical pilots, not permission to journal every edit or replace every saver at once. E and F cannot be declared globally safe while incompatible deployed clients remain able to overwrite their results.

## Package A establish the next baseline

> **Delivered 2026-10-04** on `codex/edit-reliability-baseline`. The inventory is
> `docs/edit-operation-inventory.md`; the baseline, measurements, reconciliation notes and the recommended
> first Package B slice are in `docs/edit-reliability-baseline-2026-10-04.md`. Fixture sizes used:
> small 1/1/0, medium 40/200/400, stress 1,100/1,100/1,100 (tasks/steps/step_tools). Anonymized production
> counts were **not** obtained, so no fixture is claimed typical.

Make a writer inventory covering desktop, mobile, AWI, SOP, server routes, integrations, retry/recovery paths, and scripts. For each operation record: user action, scope, owning controller, saver, tables/storage touched, number and ordering of requests, version checks, local recovery location, success signal, retry policy, and old-client behavior. Audit against actual call sites; exported functions with no production callers do not count as active writers.

Reconcile historical planning notes without deleting useful incident history. Mark each item as verified current, fixed, historical, or not yet verified. Complete bounded single-task paging work only if still outstanding, in its own change.

Use three deterministic synthetic fixtures: a small workflow fixture, a realistic medium fixture, and a stress fixture that crosses configured row/page boundaries. Record exact task/step/media counts and payload sizes. Do not invent what constitutes a typical production project; obtain anonymized counts before making that claim.

Capture operation outcomes, request counts grouped by endpoint, bytes transferred, and time from user action to confirmed persistence. Record cold/warm runs separately, browser/version, build SHA, hardware, network profile, and dataset seed. No production user content or credentials in evidence logs.

Acceptance: every identified production edit path has an inventory row; baseline tests and saved evidence identify their exact SHA; unknowns are explicit rather than assigned zero risk.

## Package B mobile extraction

Start with characterization of the existing component before moving code. Suggested boundaries and physical-line planning ranges follow. These are unvalidated sizing hypotheses, not quotas or additive promises; refine them after the symbol/dependency map.

| Boundary | Candidate ownership | Suggested size |
|---|---|---:|
| Capture session | Timers, laps, parking/resuming, session serialization | 350–650 lines |
| New-step drafts | Snapshot, durable draft access, debounce and recovery scheduling | 350–650 |
| Mobile write coordination | Task-scoped queues, pending state, retries and acknowledgments | 250–450 |
| Media actions | Upload, remove, restore-photo, completion/error handling | 200–400 |
| Navigation and task ordering | Selection, capture flush, drag state and reorder orchestration | 250–450 |
| View components | Process list, detail editor, capture controls, tool picker | Prefer coherent components around 150–400 each |

Use extraction boundaries with clear owners rather than a single hook accepting every setter. A remaining mobile composition component around 1,800–2,600 lines is an initial review target, not an acceptance gate. Preserve JSX, interaction behavior, effect order, closure scope, and storage keys.

Characterize: pending edits during selection and unmount, timer park/resume, new-step recovery, upload failure, concurrent edits during rollback, rejected delete, retry ordering, and late responses after project/task change. Known defects may be documented by characterization, but passing tests must not be described as proving those behaviors correct.

Exit: all moved-path tests pass before and after; no newly introduced production write path; no unexplained request or payload increase on identical fixtures; no UI changes.

### Historical Package B extraction ledger

| Slice | Branch / commits | Moved | Sizes (physical lines) | Evidence |
|---|---|---|---|---|
| **B1 — hook-free capture-session utilities** (published 2026-10-04 at `9dfcbb7`) | `codex/mobile-capture-session` from `af54721`: `eefa142` tests first, `4897989` extraction, then the docs commit | Lines 137–476 of `mobile-photo-portal.tsx` → `src/components/mobile-photo-portal/capture-session.ts`: timer data model and constants, timer arithmetic, header-chip derivation, `localStorage` session read/write with legacy-key fallback. No hook, effect, handler or JSX moved. | Component 4,369 → **4,045** (341 lines removed incl. blanks, 17 import lines added). Module **348** (21 exports; `normalizeParkedTaskCaptureState`, `normalizeParkedCaptureByTaskId`, `normalizeCaptureTimerSnapshot` stay private; `isRecord` is exported because `removeStepScopedCustomFields` in the component still calls it — a production use, not a test convenience). Tests: `capture-session.test.ts` 233 lines / 22 cases; `mobile-photo-portal.capture-session.test.tsx` 399 lines / 25 cases. | See rows below |

**B1 evidence**
- *Bodies:* lines 137–476 of `af54721` diffed against the module minus its header and `export ` prefixes — **identical**.
- *Characterization before/after:* the 25 component tests were committed first (`eefa142`) and pass against the pre-move code (25/25) and after the move (25/25) without modification. The 22 unit tests failed red before the move (module absent) and pass after (21 were written before the first run; the `startedAt === 0` case was added after that run exposed the falsy check, still before the move). 22 + 25 = 47 = the suite's growth from 2,080 to 2,127. Two component tests and one unit test are labelled as pinning current behaviour, not desired behaviour (`docs/deferred-work.md` §8 a, b, d).
- *Application gate (sequential):* `npm run lint` pass; `npx vitest run` **2,127 tests / 249 files** (Package A baseline 2,080 / 247: +47 tests, +2 files, all new); `npm run build` pass, then `npm run typecheck` pass; `npm run check:bundles` pass.
- *Bundles, same toolchain and production env, baseline built in place from `af54721`'s component:* entries planner 277.0 → 277.0, sops 281.8 → 281.8, planning 284.0 → 284.0, awi directory 286.2 → 286.2, awi master 275.8 → **275.9** (+0.1 KiB gzip; below the 2 KiB investigation trigger; the portal chunk itself is unchanged; **hypothesis**, not established: rounding or hash/module-id churn in a shared chunk — no chunk-level comparison of that entry's resources was made); largest chunk 124.0 both. The chunk containing the portal (found by its storage-key string) is **70,851 B raw / 18,862 B gzip in both builds**; 112 chunks in both. (Package A's table shows 276.9 for the planner entry because that run measured the isolated-API build, whose inlined `NEXT_PUBLIC_*` strings are shorter; with the production env the pre-move number is 277.0.)
- *Browser:* the 20-case `e2e/` suite passed 20/20 (2.1 min) on the retained `pulse-e2e` database against the **post-move** build. A first attempt ran against a stale pre-move build because a snapshot helper failed; that result was discarded and the suite rerun.
- *Measurements* (`scripts/measure-edit-baseline.mjs --samples 5`, run `outputs/measurements/edit-baseline/20261004-195326/`, compared with Package A's `20261004-191434/`, same fixture sizes, fresh seeds): **per-endpoint request counts identical on every phase and fixture**, including `mobile:open` 30 / 30 / 114 (small / medium / stress); response bytes identical (stress planner open 2,194.7 vs 2,195.0 KiB, the known access-bootstrap duplicate variance: 123/124/124/123/119 vs 124/124/124/124/119 requests); app-origin bytes identical (mobile open 50.0 / 53.8 / 88.6 KiB both runs). Warm-median timings (ms, A → B): small open 379 → 381, Procedure 70 → 71, edit 818 → 812, mobile open 126 → 134; medium 378 → 381, 76 → 75, 820 → 817, 217 → 221; stress 641 → **732**, 214 → 215, 890 → 890, 1,314 → 1,395; blur → row 805/798/766 → 797/797/761. The stress planner-open shift (per sample 662, 627, 634, 641, 704 → 759, 716, 732, 649, 739) has no mechanism in this change — the portal chunk is not loaded on the planner route and its bytes are identical — so it is reported as unexplained run-to-run variance at n = 4, consistent with Package A's caution that these samples are not a regression basis; the mobile-open stress shift (+6 %) sits inside the same band.
- *Isolated infrastructure:* `pulse-e2e` was stopped before and is stopped after (started once from its data, never reset); ledger 151 before and after; row deltas are the three seeded fixtures plus the browser suite's own rows (`retained-db-delta.json` in the run folder). The development project `pulse` was never touched; no volume removed; no experimental function activated.
- *Behaviour:* none changed by design; the gaps surfaced by characterization are recorded in `docs/deferred-work.md` §8 and left for a separate, approved change.
- *B1 verification snapshot:* B2 and publication followed later; both slices are now published.
- *Post-review verification (2026-10-04):* three compiling behavioural mutations were applied in turn to
  `capture-session.ts` and the code restored to HEAD afterwards (verified identical): project id dropped
  from the session key → 21 tests fail (5 unit, 16 component); running time ignored in
  `getCaptureTimerElapsed` → 14 fail (7 unit, 7 component); parked map dropped on write → 5 fail (2 unit,
  3 component). Every intended test failed in each case.

| **B2 — IndexedDB recovery-draft store** (published 2026-10-04 at `9dfcbb7`) | `codex/mobile-capture-session`, on top of B1 (`eefa142`, `4897989`, `2ad6420`, `d626ca3`) | Constants `MOBILE_DRAFT_DB_NAME` (`buildlogic-mobile-drafts`), `MOBILE_DRAFT_STORE_NAME` (`drafts`), `MOBILE_NEW_STEP_DRAFT_KEY` (`mobile-new-step-draft-v1`), type `MobileNewStepDraftRecord`, and `readBlobAsDataUrl`, `openMobileDraftDb`, `saveMobileNewStepRecoveryDraft`, `loadMobileNewStepRecoveryDraft`, `clearMobileNewStepRecoveryDraft` → `src/components/mobile-photo-portal/recovery-draft-store.ts`. The component keeps when to save, load and clear, the 250 ms recovery timer, the task-exists check, the `hasDraftStepContent` gate and the user-facing error message. | **Actual:** component 4,045 → **3,955** (96 lines removed incl. blanks, 6 import lines added); module **105** (5 exports: the three verbs, the record type, `readBlobAsDataUrl`; the three constants and `openMobileDraftDb` private). Tests: `recovery-draft-store.test.ts` 11 cases; `mobile-photo-portal.recovery-draft.test.tsx` 12 cases; `e2e/mobile-recovery-draft.spec.ts` 1 real-browser case; double in `src/test-support/indexeddb-double.ts`. | Ownership: the module owns the database/store names, the single fixed key (its lack of project/user scoping is a Package C design input and is **not** changed here), the record shape, the `updatedAt` stamp, and the open/put/get/delete lifecycle with `database.close()` in every `finally`. Exports: the three verbs, the record type, and `readBlobAsDataUrl` (production caller `buildPhotoAttachment`); `openMobileDraftDb` and the constants stay private. Tests before moving: unit tests over a minimal IndexedDB double (save writes one record under the fixed key with an ISO `updatedAt` and closes; load returns it or null; clear deletes; second save overwrites; missing `indexedDB` rejects with the exact message; open/transaction/request errors reject with their own messages and still close), a real `FileReader` test for `readBlobAsDataUrl`, component tests over the double (record written on typing, overwritten on further typing, cleared after a successful save with no timer armed, retained after a failed save, recovery on mount only when the task exists, empty-content record cleared, unavailable storage surfaces the recovery-draft error message), and a real-browser Playwright test on the isolated database using actual IndexedDB in an isolated context: save, overwrite, reload/read with the save blocked, then clear after the save succeeds. Acceptance as B1: deletion-plus-import diff, identical bodies apart from `export`, tests pass before and after, sequential gate, browser suite, measurement rerun with identical `mobile:open` counts, bundle comparison explained. |


**B2 commits:** `769eee9` tests first (component characterization over the double, the double itself, the
real-browser spec), `edf6112` extraction, `110dce6` spec fix (derived default duration; wait for the blocked
recovery re-save), then the docs/evidence commit.

**B2 evidence**
- *Bodies:* the constants (lines 100–102), the type (104–116) and the functions (236–313) of `769eee9`'s
  component diffed against the module minus its header and `export ` prefixes — **identical**.
- *Characterization before/after:* the 12 component tests pass against the pre-move code (12/12, run
  twice) and after the move (12/12) without modification. The 11 unit tests failed red before the move
  (module absent) and pass after. One component test is labelled KNOWN SCOPING (a foreign project's
  record is overwritten by the next local write — the single-key behaviour Package C will redesign).
- *Real browser:* `e2e/mobile-recovery-draft.spec.ts` on the retained `pulse-e2e` database, actual
  Chromium IndexedDB in a fresh Playwright context (no real user's storage): save (record under
  `mobile-new-step-draft-v1` in `buildlogic-mobile-drafts`/`drafts` with the draft fields and an ISO
  `updatedAt`), overwrite (same step id, newer timestamp, one record), reload/read (draft restored into
  the form, "Recovered an unsaved phone draft" shown, record still present after the blocked re-save
  fails, zero rows in the database), clear (after the step saves the row exists and the record is null).
  1/1 passing (1.9 s). The spec lives in `e2e/`, so CI's browser job now runs it too.
- *Application gate (sequential):* `npm run lint` pass; `npx vitest run` **2,150 tests / 251 files** (B1:
  2,127 / 249; +23 = 11 unit + 12 component); `npm run build` pass, then `npm run typecheck` pass;
  `npm run check:bundles` pass; browser suite 20/20 existing cases + the new spec 1/1 on the post-move
  build.
- *Bundles vs B1's final build (same toolchain, production env):* entries planner 277.0 → 277.0, sops
  281.8 → 281.8, planning 284.0 → 284.0, awi directory 286.2 → 286.2, awi master 275.9 → **275.8** (back
  to Package A's rounded number; this is **consistent with** the B1 shift having been rounding or hash churn but does not prove it — the entry's per-chunk resources were not compared across the three builds); largest chunk 124.0 both; 112 chunks
  both. The chunk holding the portal and the new module: **70,851 → 70,836 B raw (−15), 18,862 → 18,870 B
  gzip (+8)** — the module boundary changes the minifier's scope and name mangling by a handful of bytes;
  far below the 2 KiB trigger, and not byte-equal by design.
- *Measurements* (run `20261004-221223/` vs B1's `20261004-195326/`, same fixture sizes): per-endpoint
  request counts identical on every phase and fixture; `mobile:open` 30 / 30 / 114 (one small sample at
  29, the known access-bootstrap duplicate variance); response bytes identical to ±0.4 KiB;
  **mobile-open app-origin bytes identical** (50.0 / 53.8 / 88.6 KiB). The planner-open app-origin bytes are
  1.3 KiB lower on medium and 2.7 KiB lower on stress (small identical). The recorder stores one aggregate
  per phase, not per resource, so the source is **not established**. Working hypothesis: the
  server-rendered document (HTML + RSC payload) of those samples, since the rounded entry and chunk
  weights are unchanged and the mobile-open app bytes (the route this change affects) are identical;
  but unchanged rounded chunk sizes do not exclude small chunk-level differences, and nothing was
  compared at resource level. Confirming it needs per-resource capture, which the tool does not yet do. Warm-median timings (ms, B1 → B2):
  mobile open 134 → 129 / 221 → 210 / 1,395 → 1,379; stress planner open 732 → 653 (back inside Package
  A's band; consistent with run-to-run variance at n = 4, still not a controlled comparison); everything else within
  ±5 ms. Blur → row 797 / 797 / 761 → 798 / 797 / 763.
- *Isolated infrastructure:* `pulse-e2e` stopped before and after each of the three starts (measurement +
  full browser run; two single-spec reruns), never reset; ledger 151 throughout; row deltas are the
  fixtures and the browser suites' own rows (`retained-db-delta.json` in the run folder). `pulse` dev
  database untouched; no volume removed; no experimental function activated; no dependency added (the
  IndexedDB double is hand-written test support).
- *Preserved by design:* database/store names, fixed key, record format and `updatedAt`, error messages,
  `database.close()` in every `finally`, FileReader behaviour, the component's 450 ms autosave and 250 ms
  recovery re-save, its task-exists and content checks, storage scoping, hydration behaviour, UI.
- *Newly observed, not changed:* the recovery draft's `durationText` for a task with no steps is the
  task's planned duration ("60" for the fixture), not the "5" default used once steps exist — pinned by
  the real-browser spec; and in jsdom (no `indexedDB`) every draft keystroke surfaces the
  "could not store the local recovery draft" message, which the existing component tests had been
  tolerating silently (now pinned as the unavailable-storage path).
- *B2 verification snapshot:* no further extraction was done at that point. B1/B2 were subsequently published, and C1 followed at `1147c7d`.

## Package C one durable recovery pilot

Candidate: a Gantt duration edit, because it is narrow and currently participates in broader shell saving. Confirm its actual persistence path in A. If another operation offers a safer isolated boundary, document why before choosing it.

Define an operation envelope: schema version, operation ID, authenticated owner/workspace/project/scenario/entity scope, intended field change, baseline version, creation sequence, and acknowledgment. Store intent durably before dispatch. Scope visibility and replay to the correct signed-in user; signing out or changing accounts must not expose another user's drafts.

Lifecycle: locally recorded → queued → sending → acknowledged, or retryable failure/conflict. Clear only the exact acknowledged intent. Local recovery must not claim database confirmation. Test storage quota/unavailability, malformed/old journal formats, and browser restart. Durable browser storage is not a backup guarantee against device loss or manual site-data clearing.

Do not replay entire stale planner snapshots. Replay after revalidation; preserve newer local edits and surface conflicts through approved existing interactions. If a new warning or recovery control is needed, obtain UI approval first. Keep local schema upgrades reversible and do not discard unknown records.

Exit: successful persistence and recovery demonstrated against a real isolated database; zero wrong-owner replay and zero lost acknowledged edits in the specified test matrix. A count of passing tests alone is insufficient.

> **C1 shipped 2026-10-04 at `1147c7d`:** scoped phone New Step recovery, exact write-token
> acknowledgment, account lifecycle checks, and the approved non-destructive legacy-review flow.
> See [C1 contract and results](mobile-draft-recovery-c1-results.md). This is a bounded recovery
> improvement, not the general write-ahead journal described above. Same-task concurrent puts and
> teardown before local commit remain limitations. The Gantt duration pilot has not started.

## Package D atomic reorder pilot

Specify one reorder operation containing scope, intended ordering, expected versions, and an idempotency key. Authorization and version validation occur in the database operation. Temporary numbering, if needed internally, must not be committed independently. The operation must not rewrite step tools, media, or unrelated task fields.

Test two users reordering concurrently, concurrent field edits, duplicate submission, lost response followed by retry, task added/deleted during reorder, permission change, and mid-operation database failure. Assert full final row sets, not just HTTP success.

Exit: either all intended ordering changes commit or none do; unchanged tool/media rows; conflict preserves other users' changes. Network-request reduction is measured against A, not assumed.

Important: this makes the updated path safer. It does not neutralize old clients that still perform two-request reorders. Keep that distinction explicit in release claims.

## Package E targeted delete and restore

Re-review the isolated SQL as a candidate design, not approved production code. Record the selected step and associated rows atomically before explicit user-requested deletion. Restore only those records, preserving attribution, versions, ordering rules, tools, photo metadata, exploded views, and part associations. Storage objects require their own preservation/lifecycle design; database atomicity does not cover remote file operations.

Acceptance: teammate-created steps and unrelated edits survive; repeat restore is idempotent; restore into a deleted task refuses safely; failures retain a recoverable record; authorization is enforced for delete, record visibility, and restore. No expiry, purge, or historical cleanup is authorized.

Retain the existing whole-snapshot path's incident evidence as a regression fixture, but never exercise it on user data. Deployment depends on the compatibility decision below.

## Package F catalog and compatibility gate

Keep catalog operations project-wide, including scenarios, with existing permissions. Define rename collisions, normalization, delete semantics, concurrent per-step edits, and retry results explicitly. All participating writers must preserve confirmed catalog changes; a transaction alone does not stop a later stale client overwrite.

Inventory offline draft replay and all legacy writers. A version header is informational, not authorization. A quiet observation period is evidence, not proof that no old client can return. A refusal gate can interrupt an already-started multi-request operation. An add-only replacement can silently break existing intended edits. None is accepted as a complete cutover solution.

Before implementation release approval, present enforceable guarantees, remaining unsupported legacy behavior, rollback mechanics, and any unavoidable maintenance window or user interaction. If a safe boundary cannot be demonstrated, keep the feature blocked; do not silently expand into a full platform rewrite.

## Package G later structure work

After the operation pilots, narrow workspace controller ownership. `UseWorkspaceDataOptions` currently has 39 fields; lowering that count by wrapping the same fields in a bag is not progress. Prefer explicit lifecycle methods and scope-owned resources, with tests for callback freshness, effect order, stale responses, and cleanup.

Separate SOP saving/review transitions from attachments and presentation while preserving document-control semantics. Extract Gantt rendering/interaction and photo annotation controls only where profiling or change frequency justifies it. Do not combine all editors into one generic framework.

## Measurement and validation contract

| Dimension | Required evidence | Proposed acceptance |
|---|---|---|
| Preservation | Before/after row and object checks on seeded fixtures | No unrelated record/file changes |
| Recovery | Restart/reload, delayed network, failure and conflict cases | Recover exact pending intent or report actionable conflict |
| Concurrency | Independent clients and real DB sessions | No silent overwriting of newer unrelated edits |
| Retry | Lost response and repeated operation ID | No duplicate user-visible effect |
| Authorization | Viewer, other workspace, revoked permissions | No unauthorized writes or draft exposure |
| Network | Same fixture, endpoint counts and bytes | Extraction: unchanged except explained measurement noise; redesigned operation: explicit expected delta |
| Latency | At least 30 samples per comparable condition | Report median and p95; investigate >10% regression, not an automatic flaky CI gate |
| Bundle | Optimized builds, same dependency lockfile | No unexplained growth; investigate >2 KiB gzip per affected entry |
| Structure | Module size, ownership, imports, cycles | No new cycles; public contracts unchanged for extractions |

Thresholds above are proposed review triggers, not measured improvements. ~~The historical 61/5/0 request fixture must be rerun at the new baseline before comparison.~~ Rerun 2026-10-04 and reproduced (61/5); a mobile-open phase and two larger fixtures are now part of `scripts/measure-edit-baseline.mjs`. Since B2, one browser test drives a mobile edit: `e2e/mobile-recovery-draft.spec.ts` exercises the New Step draft on `/projects/<id>/mobile-photos` (typing, the IndexedDB recovery record, reload recovery, retry, clear) against the isolated database with actual Chromium IndexedDB. Its coverage is narrow — one task, one draft text field, step writes blocked and unblocked by route interception, no photos, tools, timers, reorder, delete or Restore — so the browser suite is still not evidence of general mobile coverage.

For each contained change: targeted tests, lint and typecheck as appropriate. At phase completion: full unit suite, lint, optimized build followed by settled typecheck, bundle checks, active database tests, relevant browser cases, and diff checks. Never build and typecheck concurrently. A fresh isolated database built only from active migrations verifies experimental-function independence before publication. Preserve retained databases and their original running/stopped state.

Keep failures at every important request boundary, cross-scope completion, multi-tab concurrency, reload before send/after commit, and offline replay in the test matrix. Inject failures in disposable fixtures only. Tests must prove stored outcomes, not merely optimistic UI or mocked call order.

## Execution boundaries

Before any next package, branch from current published main, inspect the relevant current call paths,
and define a bounded stored-outcome test matrix. Reuse the operation inventory as historical evidence;
refresh only paths touched by the next change. Do not repeat the completed restructure.

Preserve user data and retained database volumes. Any visible UI change needs prior approval.
Database designs and migrations are separate release decisions; the isolated experimental SQL remains
outside production paths. Follow the repository's branch → green CI → main workflow when publication
is authorized. Do not start D, E, F or broader C solely because this roadmap describes them.
