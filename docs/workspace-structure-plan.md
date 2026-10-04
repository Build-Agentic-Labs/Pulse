# Workspace structural improvements — Astra scope / Sol 6.1 handoff

Status: Phase 1 (save ownership) implemented on `codex/workspace-structure`; see the Phase 1 ledger at the end. Phases 2–5 not started. Prepared by GPT-6 Astra through read-only source inspection, reviewed by the coordinating agent. Execution model: GPT-6.1 Sol, after the user reviews this scope.

Application baseline: `edd45a93ee27f061948c9afd407da29075297aa7` (performance/save-recovery update plus cached-reload test-readiness correction). Branch for this work: `codex/workspace-structure`.

## Outcome and limits

Make save ownership, media operations, and data synchronization easier to understand and test while preserving existing behavior. Move persistence into `src/lib/planner` and retain existing public imports through a compatibility facade.

No UI redesign, label/layout changes, schema changes, data cleanup, dependency upgrades, new global state store, or permission changes. The user requires approval before visible UI changes and prohibits deleting data. This scope does not authorize resetting a retained local database.

Line counts are maintainability estimates, not quotas. They include imports, comments, and blank lines. Tests are measured separately. Most existing logic moves intact; total repository LOC may increase because of explicit interfaces and tests. Do not compress formatting or split a coherent invariant merely to reach a number. A cohesive module above its estimate needs an explanation, not arbitrary fragmentation.

Prefer source modules around 500 physical lines or fewer when the responsibility is cohesive. The larger draft, mapping, read, and transaction modules below are intentional exceptions; do not fragment their invariants to meet this preference.

## Baseline and size targets

Measured with `splitlines()` for physical lines and nonempty `strip()` for nonblank lines. Refresh counts and source anchors at execution time.

| Existing file | Physical LOC | Nonblank LOC |
| --- | ---: | ---: |
| `src/components/line-workspace.tsx` | 6,655 | 6,119 |
| `src/domain/supabase-planner.ts` | 4,932 | 4,415 |
| `line-workspace/procedure.tsx` | 1,303 | 1,195 |
| `line-workspace/step-editors.tsx` | 1,208 | 1,149 |
| `line-workspace/pfmea-workspace.tsx` | 1,102 | 1,048 |
| `line-workspace/setup-panels.tsx` | 1,046 | 996 |
| `line-workspace/drawer.tsx` | 1,032 | 974 |

The existing procedure, step editor, PFMEA, setup, and drawer UI modules stay intact in the core scope.

| Item | Existing LOC likely moved | Destination targets | Owner after phase |
| --- | ---: | --- | ---: |
| 1. Save/retry/draft ownership and development harness | 1,750–2,000 | Four modules, 300–800 each | Workspace: 4,850–5,150 |
| 2. Media and tool operations | 580–650 | Two modules, 260–450 each | Workspace: 4,300–4,650 |
| 3. Loading, realtime, scenario lifecycle | 1,050–1,250 | Three hooks, 300–650 each | Workspace: 3,000–3,550 |
| 4A. Supabase client/mapping foundations | 850–1,000 | Client 160–210; mapping 550–750; helpers 100–180 | Data module: 4,000–4,200 |
| 4B. Supabase media/tool persistence | 1,450–1,650 | Cohesive modules, 180–550 each | Data module: 2,450–2,800 |
| 5. Supabase access, reads, granular writes | Remaining implementation | Stores, 65–750 each | Compatibility facade: 80–180 |
| Optional 6. Palette, optimization, task actions | 1,400–1,700 | Three modules, 350–700 each | Workspace: 1,600–2,200 |

Owner estimates include replacement wiring. Do not subtract every maximum independently. The core scope realistically leaves a 3,000–3,550-line composition component; reaching 1,600–2,200 requires the optional tranche.

## Ownership contract before extraction

Draft merging, queues, deferred remote updates, exact acknowledgments, and version rebasing form one interacting state machine. The loading owner must use its merge API. It must not invent a second merge implementation.

Preserve `WorkspaceWriteTracker`, `workspaceSaveStatus`, `workspaceSaveBarrier`, and `useWriteTracker`. Procedure queues continue contributing to aggregate status. Keep current operation keys and sequence-aware completion semantics.

Create `line-workspace/workspace-controller-types.ts` only if it removes repeated signatures; target 60–120 lines. Prefer narrow capabilities:

- State access: current-state getter and functional React setter.
- Scope: current project/scenario getters and confirmation predicates.
- Feedback: existing toast, restore, and confirmation callbacks.
- Save coordination: tracker, reported status setters, save barrier, pending-work predicates and deferred-refresh callback.
- Procedure editing: field draft APIs, task merge/acknowledgment, schedule/persist, and reset/restore methods.

Each hook receives only the capabilities it uses. Avoid a single bag of all component variables, circular imports between hooks, or a new context solely to avoid explicit arguments. Initially retaining a few ownership refs in the composition root is acceptable. Use current-value refs/stable delegates where asynchronous callbacks cross ownership boundaries. Hook construction must not start network activity.

## Phase 1 — Save ownership

Perform small extractions and verify each before continuing.

### 1A. `use-procedure-drafts.ts` — 600–800 lines

Move draft refs, sequence counters, render-version state, `LOCAL_EDITED_TASK_TEXT_FIELDS`, draft field activation/update APIs, task-text preservation/merge, draft acknowledgment, deferred procedure update storage/application, and draft snapshot persistence/restoration.

Source anchors: `bumpProcedureDraftVersion` through `updateProcedureStepField` (approximately 1065–1625, excluding queue-only accessors); `confirmProcedureDraftsFromSave` (approximately 3738–3816). Expose explicit initialize/reset methods for load and successful scenario switch.

Inject a current queue-work predicate into local-text preservation. Do not import the queue hook or capture a stale boolean. Loading consumes this owner's merge/defer API.

### 1B. `use-procedure-save-queue.ts` — 350–500 lines

Move queue types, queue/timer refs, accessors and pending predicates, `startProcedureTaskSave`, `persistProcedureTaskUpdate`, `scheduleProcedureTaskSave` (approximately 3817–4029), and existing scope-exit debounce flushing.

Expose scheduling, immediate persistence, flush-on-scope-exit, pending predicates, status snapshots and controlled reset. Preserve:

- 750 ms debounce; 2,500 ms retry delay.
- Annotation-only coalescing and baseline.
- Exact save ID, edit sequence, and value acknowledgment.
- Immediate drain of newer edits with obsolete debounce cancellation.
- Confirmed version rebasing before the next save.
- Conflict handling distinct from ordinary retry.
- Flushing scheduled work during existing cleanup events.

The controller instance must not be recreated for each queue update.

### 1C. `use-workspace-saves.ts` — 300–450 lines

Move reported/aggregate save status wiring, shell save refs and debounce, `flushPendingPlannerSave`, `waitForLocalSavesToSettle`, `persistPlannerState`, `updateMasterBom`, and tightly coupled save/navigation guards. General module/history navigation remains outside.

Preserve `waitForLocalSavesToSettle(12000, "master-bom")`: retry may resolve its own failed operation, while unrelated errors/conflicts still block and active saves still drain. Keep verified BOM merging into current state and queued shell snapshots.

The shell save has destructive diff behavior. Preserve all remote-confirmation/deletion guards, do not expand its callers, and retain granular procedure, media, and BOM writes.

### 1D. `procedure-autosave-harness.ts` — 400–470 lines

Move the embedded development harness (approximately 1626–2023) intact behind an installation/cleanup function. Keep registration small and preserve development-only/URL-parameter activation. Rewriting its test model or removing checks is separate work.

Phase 1 target: workspace 4,850–5,150 lines.

## Phase 2 — Media and tools

### `use-workspace-media.ts` — 390–450 lines

Move `uploadStepPhotos` through `removeStepPhoto` (approximately 4665–5014) with typed wiring. Preserve existing exposed operations: upload, paste/cut, video deletion, exploded-view deletion, photo removal/restore.

Maintain destination-before-source persistence for cut/paste, same-task single-object merging, current-state item-only rollback, storage cleanup after confirmed row deletion, tracked operation keys, and idempotent completion. Preserve the newly added media retry restoration and concurrent instruction edits. Leave the existing clipboard provider boundary intact.

### `use-workspace-tools.ts` — 260–330 lines

Move library state/load effect and `persistAddStepTool` through `deleteCatalogTool` (approximately 4441–4664). Move registry derivation only if it depends exclusively on tasks/library state. Confirm all callers before deciding ownership of `applyProjectTasksUpdate`; pass a shared operation if non-tool callers need it.

Phase 2 target: workspace 4,300–4,650 lines.

## Phase 3 — Loading and synchronization

| Destination | Target LOC | Ownership |
| --- | ---: | --- |
| `use-workspace-data.ts` | 500–650 | Server/cache seed selection, project load, confirmation/readiness, project-switch timing, selected-task private-media hydration/retry, load scope refs |
| `use-workspace-realtime.ts` | 300–400 | Scope checks, task/full refresh, deferred refresh, subscription lifecycle; consume draft merge and queue cleanup APIs |
| `use-workspace-scenarios.ts` | 300–380 | Scenario list/cache, switch/duplicate/delete/rename/target actions, save-before-switch barrier and controlled draft/queue reset |

Source anchors: scenario actions approximately 2067–2317; realtime refresh 2318–2552 and subscription 2970–3022; project-switch/load 2553–2853; private-media effects 2854–2941; scenario list/cache effects 738–778.

Preserve cache-first display with fresh remote-confirmed editability, per-scenario isolation, media-only merge into current selected task, stale scope rejection, existing shell/loading behavior, and current subscription cleanup timing. Keep project-switch timer cleanup distinct from subscription cleanup. Local module navigation must not start new server/RSC reads or mount hidden panels.

Phase 3 target: workspace 3,000–3,550 lines.

## Phase 4 — Persistence foundations and media

Introduce leaf modules under `src/lib/planner`. Keep the existing `src/domain/supabase-planner.ts` public path as a compatibility facade throughout; do not force unrelated callers to change. Implementation modules import leaves directly, never their own facade.

| Destination | Target LOC | Responsibility |
| --- | ---: | --- |
| `client.ts` | 160–210 | Environment, browser client/session helpers; preserve injected server clients and browser trap |
| `row-mappers.ts` | 550–750 | Scalar conversions and entity row serialization/mapping |
| `query-helpers.ts` | 100–180 | Error handling, scope filters and task/project assertions |
| `media-rows.ts` | 250–350 | Media row types, indexes, normalization and mapping |
| `media-storage.ts` | 350–500 | Signed URLs/cache, storage paths, blob/thumbnail helpers |
| `media-store.ts` | 450–550 | Photo/exploded/video row and upload/copy/delete persistence |
| `tool-store.ts` | 350–450 | Tool synchronization, library persistence, supporting ID helpers |
| `realtime.ts` | 180–230 | Typed realtime payload helpers and subscription |

Approximate source anchors: client 284–407; mappers 408–931 and 954–1071 plus part/event/custom-column mapping; media normalization/signing 1194–1547; tool persistence 3594–3817 and 4415–4499; media operations 3818–3858 and 4500–4877; realtime payload helpers 101–206 and subscription 4878–4932.

Adjust media boundaries 50–100 lines if necessary to avoid cycles. Keep signing and its browser-only cache together. Preserve per-client WeakMap deduplication and optional injected clients. Do not redesign account-switch cache semantics in this scope.

Pure sequence-collision calculation may move to a domain module; database sequence parking belongs in persistence. Database row mapping belongs with persistence even if a mapping function makes no network call.

## Phase 5 — Remaining persistence

| Destination under `src/lib/planner` | Target LOC | Responsibility |
| --- | ---: | --- |
| `workspace-store.ts` | 450–650 | Workspace/project/member/grant context APIs, split access below |
| `access-store.ts` | 250–400 | Permission checks, role/grant helpers, per-client concurrent-read deduplication |
| `read-store.ts` | 550–700 | Core/full/summary, task/target/private-media reads |
| `scenario-store.ts` | 130–190 | Scenario queries/actions and related SOP summaries |
| `shell-store.ts` | 310–380 | Existing guarded shell and legacy full-state saves |
| `bom-store.ts` | 65–100 | Existing verified granular BOM save |
| `task-store.ts` | 550–750 | Granular task/step writes, procedure transaction and latest-task merge |
| `src/domain/supabase-planner.ts` facade | 80–180 | Explicit compatibility exports only |

Keep signatures, exported types, optional injected clients, error behavior, RLS, fresh permission checks, server read-only behavior, and granular save contracts stable. Preserve `assertSaneStateDeletion` and all existing guards. Add no new legacy full-state save caller. Preserve narrow media projections, bounded filters, pagination ordering, and concurrency.

Approximate source anchors: access/workspace 1688–2535; core/full/summary 2536–2854; scenarios 2855–2953; guarded shell saves 2955–3240; BOM 3241–3286; granular writes 3287–3593 and procedure transaction 3886–4088; task/target/media reads 4089–4267. Function names and imports take precedence over stale line numbers.

## Optional phase 6 — Separate approval/scope decision

After the core tranche is stable:

- `use-workspace-command-palette.ts`: 350–450 lines, palette/search/keyboard actions.
- `use-workspace-optimization.ts`: 600–700 lines, allocation API, reset/copy/optimization.
- `use-workspace-task-actions.ts`: 550–650 lines, dependencies, zones, grouping, task create/delete/restore.

Target workspace: 1,600–2,200 lines for composition, derived view models, selection/navigation wiring and JSX. Do not split JSX or existing child UI modules solely to lower counts. Disabled simulation or underscore-prefixed paths are not automatically authorized dead-code deletion.

## Commit and verification gates

Use one contained extraction per commit where practical. Phase 1's dependent interfaces can be introduced together if needed to keep commits compiling. Maintain a phase ledger with actual physical/nonblank counts, moved/added/deleted lines, preserved invariants and verification evidence.

1. Run targeted existing suites for each boundary; add behavior tests for ownership/lifecycle seams, not import-shape tests.
2. Before accepting each phase: full unit suite, lint, typecheck, diff check.
3. Optimized build, then settled typecheck and bundle budget check. Never build and typecheck concurrently in the same output directory.
4. Relevant browser cases during a phase; all 18 baseline cases at the integration gate. Test project/module/scenario switching and pending/error navigation for lifecycle phases. Confirm no shell remount, changed UI, or increased network bursts.
5. Re-run comparable opening/request benchmarks after loading or import-graph changes. Report warm/cold context, fixture size and actual transferred bytes; file length is not a speed metric.
6. Follow repository branch -> green CI -> merge workflow. Do not publish unreviewed behavior changes as part of extraction.

Baseline verification from the coordinating agent: 1,820 automated tests pass; all 18 browser cases pass in CI; database pgTAP, production build, typecheck, lint and bundle budgets pass. The verified commit was fast-forwarded to main and pushed with local/remote SHA match. Evidence: [green feature-branch CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/37161934638). These counts are a coverage baseline, not a substitute for new seam tests. Astra did not rerun tests during read-only scoping.

Required behavior coverage includes overlapping writes in both completion orders; unrelated failed write retention; obsolete timer cancellation; failed BOM retry preserving confirmed data; media retry with concurrent instruction edits; draft recovery; transaction retry/conflict/version rebasing; navigation read counts; private-media hydration; access concurrency; and fresh view-only permission enforcement.

### Local database safety

`scripts/test-browser.mjs` currently resets `scratch/browser-db`. Do not run `npm run test:browser` against retained local data. Reuse a validated retained-DB setup and invoke Playwright without reset, or use a newly created explicitly isolated disposable test environment. The existing CI reset is confined to its fresh ephemeral runner.

Retained local endpoints from this session: API `http://127.0.0.1:56321`, Postgres port `56322`, workdir `scratch/browser-db`, optimized browser build `.next-e2e`, app port `3100`. Verify identity/ports and schema before use; never assume they remain current. Resolve credentials from local status without printing them. Production/dev remains separate at port `3000` with `.next-dev`. Do not copy credentials into this plan. Do not stop test databases with backup deletion.

## Sol 6.1 execution instruction

Verify branch `codex/workspace-structure`, baseline and a clean starting state. Read `CLAUDE.md`, applicable instructions, installed Next.js docs, and Supabase skill before persistence work. Refresh anchors/counts. Execute approved phases sequentially, beginning with save ownership. Move bodies with minimal semantic edits and narrow typed capabilities, preserving async freshness and all listed invariants.

Do not silently include optional phase 6. If an extraction requires a behavior fix, UI change, data/schema change, permission change or widened save path, stop that expansion and describe it separately. If a coherent module exceeds its estimate, explain and revise the estimate; do not fragment it to satisfy a number.

At each gate report source counts and tests, then continue only within the approved scope. At completion report maintained behavior, actual module sizes, benchmark evidence where relevant, and intentional remaining large modules.

## Remaining uncertainty

These are architecture estimates, not compiler-verified import graphs. Draft/queue mutual predicates and initial-load restore/reset ownership are the highest-risk seams. Resolve their interfaces in Phase 1 before committing to exact final counts. No performance gain is promised from file splitting alone.

## Phase 1 ledger — save ownership (2026-10-03)

Commits, all on `codex/workspace-structure` after `3d46341`: `5ea124c` drafts (1A), `8617840` queue (1B), `72b9cfa` workspace saves (1C), `1c1779a` dev harness (1D); `f38a61a` comment/API cleanup with no behavior change; `02cd1e8`, `e323c05`, `7f5d252` tests; `c8ff5b3` bundle guard.

| File | Physical | Nonblank | Plan estimate |
| --- | ---: | ---: | --- |
| `line-workspace.tsx` (was 6,655 / 6,119) | 5,099 | 4,733 | 4,850–5,150 |
| `line-workspace/use-procedure-drafts.ts` | 684 | 602 | 600–800 |
| `line-workspace/use-procedure-save-queue.ts` | 460 | 412 | 350–500 |
| `line-workspace/use-workspace-saves.ts` | 473 | 429 | 300–450 → revised 450–480 |
| `line-workspace/procedure-autosave-harness.ts` | 442 | 405 | 400–470 |
| `line-workspace/workspace-controller-types.ts` | 31 | 26 | 60–120 (only shared capability types) |

`line-workspace.tsx`: 1,735 lines removed, 179 added. Moved bodies are verbatim. Every non-verbatim line was checked against the original by line accounting and by per-commit adversarial review. New tests add 1,772 physical lines (6 files).

Decisions and deviations:
- Phase 1 kept the original closure semantics. Functions are still re-declared every render, so an async continuation (save completion, retry, debounce) uses the `projectId` and callbacks of the render that started it. Stable callbacks are not unsafe in themselves. A later change may introduce them, provided it keeps the issuing save's scope (project, scenario, write tracker and cache key fixed when the save starts) and chooses on purpose which dependencies must be read fresh (planner state, drafts, queue records). Phase 1 made no such choice. Only mutable state is identity-stable: draft refs, and one queue store per mount (`useState(createProcedureSaveQueueStore)`).
- Drafts read the queue only through an injected probe that is evaluated at call time. `updateProcedureStepField` lives in the queue hook (the plan listed it under drafts) because it schedules saves. This removes the only drafts→queue write edge.
- `reportedSaveState`/`setSaveState`, `reportedSaveError`/`setSaveError` and `plannerDirtyRef` stay in `LineWorkspace` and are passed in. If they came from a custom hook, `exhaustive-deps` would flag the `[projectId]` load effect and the project-switch listener, forcing dependency-array edits on the load effect.
- `useWorkspaceSaves` is called at the old page-exit/link-guard effect slot. `usePlannerShellAutosave` is a separate hook called at the old debounce slot, because it must run after the load effect in the same commit. That second hook is the reason `use-workspace-saves.ts` is over its first estimate.
- The queue has no reset (scenario switches drain through the save barrier, as before). `persistProcedureTaskUpdate` stays private (no outside caller).
- The harness registration is a positive, constant-folded development branch. `check:bundles` now fails if harness code reaches a client chunk.

Hand-off notes for later phases (recorded, not redesigned in Phase 1):
- Deferred-refresh dependency (Phase 3): `flushDeferredRemoteRefresh` (realtime, still a hoisted declaration in the component) and `hasLocalSaveWork` (saves hook) depend on each other. Today this works only through function hoisting. When realtime becomes a hook, give it an explicit delegate, and decide which render's scope each side reads.
- Loading reaches drafts through `restoreProcedureDraftFieldsRef` and `applyProcedureDraftsToTaskRef`. Realtime should consume `hasDirtyOrActiveProcedureDrafts`, `storeDeferredProcedureServerUpdate`, `mergeServerTaskIntoLocalTask` and `flushScheduledProcedureSaves` (through `flushProcedureSavesOnScopeExitRef`). `mergeServerTaskIntoLocalTaskRef` already had no reader before Phase 1.
- Shared save lock (Phase 2): `saveInFlightRef` is the shell-save lock, and media and Gantt-order writes in the component also take it. While it is held, shell saves queue in `queuedSaveStateRef`. Only the shell save loop and the BOM save drain that queue, so a write that releases the lock leaves a queued snapshot until the next change. Phase 2 inherits this unchanged.
- Cross-product save scope (hardening after Phase 1). Normal route navigation was already safe. `/projects/A/planner` → `/projects/B/planner` changes the `[projectId]` route segment, so each product gets a fresh workspace, and an older workspace's save finishes on its own. The two defects reported earlier exist only for an in-place `projectId` change on a mounted workspace. The component supports that path (its load effect switches projects in place), but no current route uses it. The earlier claim that the sidebar or command palette reached them was wrong. The changes below harden in-place scope changes; they do not fix a route-navigation bug. The browser test "a product save held across a sidebar product switch…" is navigation coverage, and it passes on both the pre-fix and fixed builds. The hardening:
  - Each procedure queue record carries its issuing scope (project and scenario) and the scheduling render's start function. Completions merge only into a planner state in that scope; otherwise they invalidate the issuing project's cache. Out-of-scope work never reports status or replays deferred refreshes. Failed out-of-scope saves retry their own snapshot against their own project and notify once.
  - Status, the save barrier and navigation guards count only foreground records (`isForegroundSaveScope`).
  - A scope-exit flush starts each save through the render that scheduled it, so it goes to its own project.
  - `writeCachedPlannerState` refuses a state whose project differs from the key and drops that key's snapshot. A persisted shell state is cached under its own project.
  - A master BOM save merges, reports, and patches queued shell snapshots only for its issuing product.
  - The load effect's recovered-draft re-save is skipped if the mounted workspace switched projects in place. The drafts stay in that project's storage.

  Shared-draft boundary (in-place switches):
  - Holds, with lifecycle tests:
    - B's typing, saves, failures, cleanup and recovery write only B's draft key.
    - A→B→A→B with failed unsaved edits in both products recovers each product's edit from its own storage and saves it to its own project.
    - An older workspace's background retry that is still in flight cannot acknowledge an edit typed after returning to A; it drains that edit, rebased.
  - **Gap introduced by the hardening, now fixed:**
    1. A's save is in flight across an in-place switch to B.
    2. A scenario switch in B (allowed, because B's barrier ignores A's background work) used to clear every in-memory draft, A's included.
    3. If A's save then failed, its failure path rewrote A's draft storage from memory and erased the edit.

    The scenario-switch reset now removes only the drafts of the tasks in the planner state being left. A task id identifies exactly one scenario, which I checked rather than assumed:
    - `tasks.id` is the table-wide primary key, and the isolated DB has no duplicates.
    - The live `duplicate_scenario` assigns copies `id || '-' || suffix` and copies no procedure steps.
    - Client-created tasks use `task-${Date.now()}`, which the same key protects once saved.

    Regression test: "a scenario switch in B keeps A's unsaved draft…". It fails before the correction, with A's stored draft erased, and passes after it. A's draft stays stored through the failed save and the background retry, then is recovered and saved to A on return.

    Same product: "keeps another scenario's recoverable draft…" fails before the correction and passes after it.
    - A recovered draft for the night scenario now survives a Main→night switch, where it used to be dropped from memory and later from storage.
    - The night scenario shows its own draft. Main's draft is removed and never applied there.
    - The night scenario's next edit saves only that scenario's task.

    Follow-up, fixed: recovered drafts of a non-Main scenario. Before this fix:
    - Opening the scenario showed its recovered draft with the status reading **Saved**, though the draft was never re-saved.
    - Leaving the scenario dropped the draft from memory.
    - A later edit anywhere in the project then rewrote draft storage without it. This was the loss window the earlier correction had only moved.

    The fix:
    - Project load and scenario switch now share one recovery path (`recoverProcedureDraftSaves`). Each task with a recovered unsaved draft becomes a pending queue record in its issuing scope at once, so the status ("Saving…"), the save barrier and the navigation guards count it before any timer runs. After the existing 250 ms delay the normal debounced save is armed.
    - Tasks whose save is already in flight or debounced are not registered again, so nothing is scheduled twice. A failed or conflicted record is re-registered, and its pending retry is replaced the way an edit replaces it.
    - The scenario-switch reset never drops a dirty, unacknowledged draft. Leaving the scenario must pass the existing save barrier, so the draft is persisted or the switch is refused. Failures and conflicts keep the draft dirty in memory and in the project's draft storage.

    Lifecycle tests, each failing before this fix:
    - the exact sequence (open, no edits, check the status, switch away and back, reload)
    - Saved only after the save is confirmed
    - switching away before the 250 ms timer (the switch waits for the save)
    - a failed recovery that blocks leaving, then retries to Saved
    - a conflicted recovery that stays stored and never shows Saved, then is recovered after a reload
    - reloading before recovery completes
    - editing Main never erases another scenario's unsaved draft
  - Same boundary, checked without changes:
    - Pending draft snapshots clone all in-memory drafts, but every consumer filters by task id: marking for save, acknowledgment, sequence, applying drafts, cleanup and the annotation acknowledgment. A queue test pins that another scope's draft in a snapshot is never marked, acknowledged, applied or cleaned.
    - Any scope exit still cancels every pending retry timer, including background retries of other scopes. Their edits stay in the queue snapshot and in their project's draft storage, and are recovered when that scope opens again.

  Remaining architectural limitation: draft storage is mixed-scope. One in-memory draft map serves every product and scenario a mounted workspace has shown, and each project's stored snapshot is rebuilt from that whole map. So a snapshot can carry other scopes' drafts, and a draft that has left memory can be dropped from its own project's storage by the next write. This is not harmless by construction. The tested protections are:
  - task-scoped acknowledgment, cleanup and pending-snapshot use;
  - each scope's writes go to its own storage key;
  - the scenario-switch reset is limited to the scenario being left;
  - recovery applies only drafts that match a loaded task.

  Another protection: recovery re-saves recovered unsaved drafts for whichever scope opens, and the reset keeps unacknowledged drafts. These protections are tested, not structural. A future change that rebuilds a project's draft storage from a partial in-memory map would reopen the loss path. A master BOM save in flight still holds the navigation guard briefly after an in-place switch. Media and tool completions (Phase 2 code) still report into the visible status, though the cache guard now protects their cache writes.

Evidence: 1,820 → 1,893 unit tests pass (230 files), including a black-box `LineWorkspace` lifecycle test written and passing against `3d46341` before it ran on the extracted code. Every new seam test was checked against targeted mutations of the behavior it guards. Lint, the optimized build, the settled typecheck and bundle budgets pass (planner entry 275.1 KiB vs 275.2 baseline; largest chunk 124.0 KiB; 0 chunks contain harness code). All 19 browser cases (18 baseline plus the product-switch regression) pass against the retained isolated database (`scratch/browser-db`, ports 563xx, not reset). Its schema already contained `20261003180653` (function bodies identical to the migration file) although the ledger row is absent.

## Phase 2 ledger — media and tools (2026-10-03)

Commits on `codex/workspace-structure` after `370ae18`: `0b0db70` (tools) and `d9c6e26` (media). Baseline is the committed code after the Phase 1 recovery fixes (`line-workspace.tsx` 5,122 physical / 4,755 nonblank), not the original plan estimate.

| File | Physical | Nonblank | Plan estimate |
| --- | ---: | ---: | --- |
| `line-workspace.tsx` | 4,510 | 4,197 | — (652 lines removed, 40 added) |
| `line-workspace/use-workspace-tools.ts` | 335 | 305 | 260–330 |
| `line-workspace/use-workspace-media.ts` | 431 | 395 | 390–450 |

Tools is 5 lines over its estimate. It holds the library state, its load effect, both derived values, the step-tool writes and the catalog operations, plus option documentation. It is kept whole rather than trimmed.

Ownership and decisions:
- **Tools.** The library state and its per-project load effect, the derived `toolLibrary` and `projectToolRegistry` (both depend only on tasks and library state, so they moved per the plan), the step-tool writes, and catalog rename/tidy/delete. `applyProjectTasksUpdate` moved with tools because every caller is a catalog operation; no shared operation was needed. The hook is called at the old load-effect position, so effect order is unchanged.
- **Media.** Upload, clipboard paste and cut, video and exploded-view deletes, and photo delete with Restore. The functions were moved verbatim. The shared shell-save lock is passed in unchanged: photo uploads, pastes and photo deletes still hold it, so shell saves requested meanwhile queue behind them. Video and exploded-view deletes still never touch it.
- **Unchanged edges.** Functions are still re-declared per render, as in Phase 1. Media and tools completions still report into the visible status unconditionally, a pre-existing behavior; the Phase 1 cache guard still protects any cache writes. Nothing from the Phase 1 scope or recovery fixes changed. `restoreTaskProcedureSnapshot`, which re-uploads a deleted step's photos, stays in the component as a task action.
- **Catalog refusal, fixed in a separate commit after Phase 2.** `applyProjectTasksUpdate` used to refuse its guarded shell save (before the latest data was confirmed) but return normally. Rename, delete and tidy then went on to rename or delete library rows and report success. It also had no view-only gate. It now resolves `false` on refusal (the existing unconfirmed-state block, or the existing view-only gate with its notice) and still rejects on failure. Rename, delete and tidy stop on refusal before any library write or success report.

  Tests for each operation:
  - unconfirmed data: no task or library writes, no Saved
  - view-only: no writes
  - failed rewrite: no dependent library writes or success reports
  The refusal cases fail before the fix; the allowed operations are unchanged.

  What tidy does when its task rewrite is refused or fails:
  - It makes no library writes and shows no "Tool names cleaned up".
  - On failure, `applyProjectTasksUpdate` has already shown "Save failed" and set the error status. Tidy catches the rejection and resolves, because it runs fire-and-forget.
  - In both cases its `finally` still re-reads the library. That read is the only thing that runs after the stop.
  Rename and delete reject to the catalog panel instead. (An earlier report said tidy "carries on" after a failure; that was wrong.)
- **Failed catalog rewrite, fixed in a separate commit (`8b14112`).** A failed rewrite's optimistic change used to stay on screen.
  - **Correction to the earlier note:** a later *shell* save could not persist it. `savePlannerShellToSupabase` strips step tool lists from the task row and never writes `step_tools`.
  - **The real persisting path:** any save that rewrites a task's `step_tools` from local state. On the desktop that is the Gantt reorder (`saveTasksToSupabase` → `syncStepToolsForTasks`).
  - **Reproduced against an in-memory database running the real savers** (`use-workspace-tools.persistence.test.tsx`):
    - rename stored the new name in `step_tools` while the library kept the old one
    - delete removed the step's assignment while the library row stayed
    - tidy changed the stored spelling

  The fix is a targeted revert, never an older snapshot. On failure, `applyProjectTasksUpdate` reverts only the step tool lists its rewrite changed (`diffStepToolLists` / `revertStepToolListChanges` in `domain/step-tools`):
  - A step untouched since gets its previous list.
  - A step edited meanwhile keeps that edit (tools added since stay, tools removed since stay removed).
  - Deleted tasks, and steps whose tools were cleared meanwhile, are skipped.
  - A scenario switched away from meanwhile is not touched.

  This reverts to what the database holds, because step tools only change through their own per-row writes. Error status, the "Save failed" toast and the stop before library writes are unchanged.

  Tests:
  - rename, delete and tidy, each with an unrelated field edit and a step tool added while the save was pending
  - the screen reverting
  - the scenario guard
  - six domain cases

  Five targeted mutations are each caught.
- **Remaining window (not changed).** A Gantt reorder issued *while* a catalog save is still pending writes the optimistic lists of the reordered tasks before the failure is known. The revert then shows the previous lists while those rows hold the new ones, until the next reload. Closing it means the catalog save holding the shared shell-save lock. That is a lifecycle change, not made here.
- **Reported, not changed: successful catalog rewrites never persist step tool references.** This is pre-existing since the initial import, for the same reason: the shell save does not write `step_tools`.
  - **Rename:** the library row moves to the new name while `step_tools` keep the old one. After a reload the old name returns, as a tool with no library entry.
  - **Delete:** the library row is deleted but the step references remain.
  - **Tidy:** stored spellings stay messy.
  A characterization test pins this. The fix belongs in a separate, approved change (see the proposal in the hand-off report).

Validation:
- Seam tests: 6 for tools and 5 for media. Each fails against a targeted mutation of the behavior it guards: lock taken and released, rollback that keeps concurrent edits, destination-first cut with compensation, stale library responses, tracker keys, the confirmation guard, and category migration.
- Gate: full unit suite 1,904 tests (232 files), 1,912 after the catalog-refusal fix, and 1,923 (233 files) after the failed-rewrite fix, each with the full browser suite passing; lint; optimized build, then typecheck; `check:bundles`; 0 chunks with harness code; all 19 browser cases against the retained isolated database (not reset).
- Bundles are unchanged from Phase 1: planner entry 275.1 KiB, AWI master 274.0 KiB, largest chunk 124.0 KiB gzip. The failed-rewrite fix adds 0.3 KiB to each (275.4 and 274.3); the largest chunk is unchanged. No runtime speed claim is made; nothing was measured beyond bundle sizes.
