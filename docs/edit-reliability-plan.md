# Edit reliability and editor structure plan

Prepared October 4, 2026. Planning baseline: `0b41c81` on `main`. **Rebased 2026-10-04 on `438a6df`**
(Claude's single-task paging fix, merged with CI green); see `docs/edit-reliability-baseline-2026-10-04.md`.

Status: **Package A delivered** on branch `codex/edit-reliability-baseline` (documentation and measurement
tooling only; nothing merged or pushed). Packages B–G remain proposed and not authorized for
implementation or database deployment. This document does not reopen the completed five-phase structural plan.

The next investment should improve edit ownership, recoverability, and persistence boundaries. Smaller editor modules support that work; line reduction alone is not the goal. Keep the current UI unless the user approves a concrete visible change. Preserve existing data and retain all test database volumes.

## Evidence and confidence

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

| Package | Scope | Dependency | Completion evidence |
|---|---|---|---|
| A | Refresh evidence and map edit operations | Claude finishes | **Delivered 2026-10-04**: `docs/edit-reliability-baseline-2026-10-04.md`, `docs/edit-operation-inventory.md`, `scripts/measure-edit-baseline.mjs` |
| B | Extract mobile responsibilities without behavior changes | A | Same outcomes, requests, and lifecycle timing under characterization tests |
| C | Prove durable recovery for one narrow edit operation | A; coordinate with B | Edit survives interruption; no wrong-scope replay or duplicate effect |
| D | Prove atomic task reorder for updated clients | A and operation contract | All-or-nothing database tests; no tool/media side effects |
| E | Targeted step delete/restore | C and approved DB design | Exact associated-record preservation and concurrent-edit isolation |
| F | Catalog consistency and remaining operation migration | C–E; compatibility gate | All participating writers and deployment policy validated |
| G | Further editor and controller decomposition | Measured need | Narrower ownership without lifecycle or performance regressions |

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

## Package C one durable recovery pilot

Candidate: a Gantt duration edit, because it is narrow and currently participates in broader shell saving. Confirm its actual persistence path in A. If another operation offers a safer isolated boundary, document why before choosing it.

Define an operation envelope: schema version, operation ID, authenticated owner/workspace/project/scenario/entity scope, intended field change, baseline version, creation sequence, and acknowledgment. Store intent durably before dispatch. Scope visibility and replay to the correct signed-in user; signing out or changing accounts must not expose another user's drafts.

Lifecycle: locally recorded → queued → sending → acknowledged, or retryable failure/conflict. Clear only the exact acknowledged intent. Local recovery must not claim database confirmation. Test storage quota/unavailability, malformed/old journal formats, and browser restart. Durable browser storage is not a backup guarantee against device loss or manual site-data clearing.

Do not replay entire stale planner snapshots. Replay after revalidation; preserve newer local edits and surface conflicts through approved existing interactions. If a new warning or recovery control is needed, obtain UI approval first. Keep local schema upgrades reversible and do not discard unknown records.

Exit: successful persistence and recovery demonstrated against a real isolated database; zero wrong-owner replay and zero lost acknowledged edits in the specified test matrix. A count of passing tests alone is insufficient.

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

Thresholds above are proposed review triggers, not measured improvements. ~~The historical 61/5/0 request fixture must be rerun at the new baseline before comparison.~~ Rerun 2026-10-04 and reproduced (61/5); a mobile-open phase and two larger fixtures are now part of `scripts/measure-edit-baseline.mjs`. The existing browser suite is still not evidence of mobile coverage — no browser test drives a mobile edit.

For each contained change: targeted tests, lint and typecheck as appropriate. At phase completion: full unit suite, lint, optimized build followed by settled typecheck, bundle checks, active database tests, relevant browser cases, and diff checks. Never build and typecheck concurrently. A fresh isolated database built only from active migrations verifies experimental-function independence before publication. Preserve retained databases and their original running/stopped state.

Keep failures at every important request boundary, cross-scope completion, multi-tab concurrency, reload before send/after commit, and offline replay in the test matrix. Inject failures in disposable fixtures only. Tests must prove stored outcomes, not merely optimistic UI or mocked call order.

## Handoff and stop points

When Claude finishes: record its final SHA, inspect its diff, refresh this baseline, and remove any already-completed work from A. Do not start a branch or alter Claude's checkout while it is active.

Approve one work package at a time. Each report includes: exact baseline/final SHA, changed ownership, behavior changes, data touched, tests, measured deltas, unresolved risks, and rollback limitations. Separate extraction commits from fixes. No automatic merge, push, production migration, UI change, or follow-on package is authorized by this plan.

Recommended first authorization: ~~Package A, then~~ a small slice of B — specifically the pure
capture-session module extraction proposed in `docs/edit-reliability-baseline-2026-10-04.md` §4, with its
eleven characterization tests written first. Scope C and D after A; do not wait for every editor to be
split before addressing concrete reliability risks. Package A's inventory suggests C's candidate (a Gantt
duration edit) rides the unversioned shell save, and that the two-request reorders (desktop and mobile)
and the mobile Restore are the three paths where an interruption leaves visibly wrong data.
