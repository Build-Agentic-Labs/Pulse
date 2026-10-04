# Workspace structural improvements — Astra scope / Sol 6.1 handoff

Status: Phases 1–4 implemented on `codex/workspace-structure` (ledgers at the end). Phase 5 not started. The correctness investigation is closed in `docs/correctness-scope.md`. Prepared by GPT-6 Astra through read-only source inspection, reviewed by the coordinating agent. Execution model: GPT-6.1 Sol, after the user reviews this scope.

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

### Phase 3 execution plan (current code, 2026-10-03; not started)

**Baseline:** `src/components/line-workspace.tsx` is 4,511 lines after Phases 1–2 and the correctness fixes. Function names below are the anchors; line numbers are approximate. This is a **behaviour-preserving extraction**. It does not take on persistence redesign, catalog work, the targeted restore client, durable edit recovery, or optimizer extraction (see `docs/correctness-scope.md`).

#### Boundaries

| Hook | Moves | Stays in `LineWorkspace` (shared cells passed in) | Est. lines |
|---|---|---|---:|
| `use-workspace-scenarios.ts` | `switchTargetId` and `isSwitchingScenario` state; `applyScenarioSwitch`, `ensureSavedBeforeScenarioAction`, `loadScenarioIntoView`, `refreshScenarioList`, `switchScenario`, `renameScenarioById`, `requestDeleteScenario`, `deleteScenarioById`, `duplicateActiveScenario`, `editScenarioTarget` | `scenarios` state, `scenarioCacheRef` and `mainScenarioIdRef` (read by the saves hook, created earlier); **the four scenario effects stay at their current slot** (see order constraints) | 280–330 |
| `use-workspace-realtime.ts` | `isRefreshTargetCurrent`, `refreshTasksFromSupabase`, `requestRemoteTaskRefresh`, `refreshPlannerFromSupabase`, `maybeNotifyConcurrentEdit`, `requestRemotePlannerRefresh`, `flushDeferredRemoteRefresh`; the refresh timers, pending task ids, conflict-notice throttle, `realtimeTaskIdSet` and its ref; the subscription effect | `pendingRemoteRefreshRef` and `remoteRefreshAppliedRef` (read and written by the saves hook, procedure queue and shell autosave) | 290–340 |
| `use-workspace-data.ts` | `finishProjectSwitch`; the seed and consumed-seed refs; the `[projectId]` load effect (cache/server seed, remote confirmation, draft recovery); the media-retry listeners; selected-task private-media hydration; `onReady`; the project-switch-start listener; the unmount-only skeleton-timer cleanup; `taskDetailHydrationStatus` and its request/fully-hydrated refs | `hasLoadedRemoteState`, `hasConfirmedRemoteState`, `isProjectSwitching`, `remoteStateConfirmedRef`, `loadedProjectIdRef`, `plannerDirtyRef`, `setSaveState`/`setSaveError`, selection and view state. These are read earlier in render by the scenario effects, URL effects and saves/queue/tools hooks, so they cannot move into a hook called later. | 420–480 |

Expected workspace after Phase 3: about 3,550–3,700 lines. This is an estimate, not a quota. Keeping the scenario effects and shared cells in place costs about 80 lines over the original 3,000–3,550 target. That is deliberate, to avoid reordering effects.

#### The deferred-refresh dependency (must be decided, not inherited)

`flushDeferredRemoteRefresh` is a hoisted function declaration in `LineWorkspace`. It is passed to `useWorkspaceSaves`, `useProcedureSaveQueue`, `useWorkspaceTools` and `useWorkspaceMedia`, all called **before** the realtime code. It reads `hasLocalSaveWork` from `useWorkspaceSaves`, so the dependency is circular, resolved today only by hoisting.

Each caller receives the function from the render that issued its save. That copy's `requestRemotePlannerRefresh` → `refreshPlannerFromSupabase` closes over **that render's `projectId`** and reads the scenario live from a ref.

**Plan:**
- `LineWorkspace` keeps a one-line hoisted `flushDeferredRemoteRefresh()` that forwards to `realtimeDelegateRef.current`.
- `useWorkspaceRealtime` sets `realtimeDelegateRef.current` every render.
- **This changes closure semantics from issuing-render to latest-render.** The one observable difference: after an **in-place** project change (route navigation remounts, so it cannot happen there), a deferred refresh flushed by a save issued under the old project now refreshes the project on screen. Today the request is made with the old project and then discarded by `isRefreshTargetCurrent`.
- Both outcomes leave state correct. The new one costs one extra read.
- Pin it with a lifecycle test before choosing. If exact preservation is required instead, the alternative is for the realtime hook to read `projectId` from `loadedProjectIdRef`; decide before implementation.

Realtime-triggered refreshes already use latest-render semantics (`requestRemotePlannerRefreshRef` and `requestRemoteTaskRefreshRef`) and keep them.

#### Effect-order constraints

Current order, top to bottom:
1. `latestDerivedStateRef` sync
2. Scenario effects:
   1. cache clear on `[projectId]`
   2. cache mirror
   3. scenario-list load
   4. main id
3. Saves hook (guard effects)
4. Drafts and queue hooks
5. Tools hook (library load)
6. Media hook (no effects)
7. Workspace snapshot write
8. URL sync
9. `popstate`
10. Development harness
11. **Load `[projectId]`**
12. Media-retry listeners
13. Private-media hydration
14. `onReady`
15. Project-switch-start listener
16. **Realtime subscription**
17. Unmount-only skeleton timer
18. Simulation, pointer
19. Undo tracking
20. **`usePlannerShellAutosave`**
21. Chrome and resize, keyboard, command palette

Rules:
- **The shell autosave must run after the load effect in the same commit** (Phase 1 invariant). `useWorkspaceData` is called at the load effect's slot, `useWorkspaceRealtime` right after it, both before `usePlannerShellAutosave`.
- **The scenario effects stay before the saves hook.** Moving them into a hook called later would reorder them past the saves, queue and tools effects. They are probably independent, but nothing proves it, so Phase 3 leaves them in place.
- **Inside `useWorkspaceData`,** keep the order load → media retry → hydration → `onReady` → switch-start listener → unmount timer cleanup.
  - Calling realtime after data moves the subscription after the unmount-only timer effect, so the two unmount cleanups swap order. They are independent: the subscription cleanup deliberately does **not** clear the skeleton timer, because clearing it on scenario change once wedged the switch skeleton. Pin that with the existing note and a test.
- **The `[projectId]` load effect must keep `[projectId]` as its only dependency.**
  - Setters and functions it uses from outside the hook (`setSaveState`, selection setters, draft recovery) go through one port ref updated every render, matching the existing `restoreProcedureDraftFieldsRef` pattern.
  - `react-hooks/refs` is off and `exhaustive-deps` is on, so adding them as dependencies would restart the load on every render.
- **Subscription stability:**
  - dependencies stay `[product.id, scenario.id, hasLoadedRemoteState]`;
  - the task set stays behind `realtimeTaskIdSetRef`, so adding a task never re-subscribes;
  - cleanup still clears both timers, drops pending task ids, and flushes (never drops) scope-exit procedure saves.

#### Behaviour and fixes that must be preserved (each needs a passing test before and after)

- Cache-first paint, but **remote-confirmed editability**: a cache- or server-seeded state never autosaves. A failed remote load stays unconfirmed with an error status.
- Server seed outranks cache; a stale-scenario cache is skipped; a load resolving after unmount or a project change is ignored.
- Procedure draft recovery on load: recovered drafts are registered as pending at once. Drafts for tasks not in this load are kept.
- Scenario switch:
  - save-before-switch barrier, aborting on failure;
  - instant cached switch;
  - drafts reset only for the scenario being left (`resetProcedureDrafts(leavingTaskIds)`);
  - incoming dirty drafts re-saved;
  - per-scenario hydration status.
- Realtime:
  - task refresh debounced 250 ms, full refresh 350 ms;
  - deferred while shell save work is pending and flushed after (`flushDeferredRemoteRefresh`);
  - stale-scope results discarded;
  - procedure-draft protection on merge;
  - concurrent-edit notice throttled to one per minute.
- Private media hydrated one task at a time; only media merged; stale scope discarded; failure retried on online/focus/visibility.
- Project-switch skeleton timing, and timer cleanup kept separate from subscription cleanup.
- The validated fixes:
  - cross-product save scope;
  - scoped draft reset and recovery;
  - catalog refusal and failed-rewrite revert;
  - zero-zone derivation (`e2e/zero-zone-save.spec.ts`).

#### Validation criteria

1. **Before moving any code:**
   - Audit `line-workspace.lifecycle.test.tsx` (20 cases) against the list above.
   - Add characterization tests, written against the current code, for every item not yet covered. Expected gaps:
     - realtime deferral and flush ordering;
     - subscription not recreated on task add;
     - cleanup flushing saves without clearing the skeleton timer;
     - hydration scope discard and retry;
     - rename/target revert;
     - the deferred-refresh closure decision.
2. **One contained commit per hook** (scenarios, then realtime with the delegate, then data). Each commit:
   - leaves those tests green unchanged;
   - has mutation checks on its seams;
   - passes the full gate: unit, lint, optimized build then typecheck (never concurrently), bundle budgets, diff check;
   - passes the full browser suite on the retained isolated database without a reset (`browser-retained.mjs`), including the sidebar product switch and the zero-zone save.
3. **No added reads on product open or module navigation.** Compare request counts (core load, media hydration, scenario list, realtime subscribe) before and after on the same fixture. Report counts, not speed.
4. **Ledger:** actual line counts per module, the closure decision taken, effect-order evidence, and any deviation. Stop after Phase 3 for review.

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

### Phase 4 execution plan (current code, 2026-10-03; not started)

**Baseline:** `src/domain/supabase-planner.ts` is 4,932 lines, with no `"use client"` marker. **98 files import it** (components, stores, server data, API routes), and **23 test files mock it by path** (`vi.mock("@/domain/supabase-planner", ...)`).

This is a **structural move only**:
- no change to queries, request counts, persistence behaviour, authorization, schema or UI;
- the 61 product-open requests are not optimized;
- the blocked catalog work is not touched, and the isolated database functions are not called.

#### Rules that make it safe

1. **No importer changes.** Every existing import of `@/domain/supabase-planner` stays, and the facade re-exports each moved export under the same name and signature. An importer switched to a leaf path would silently bypass the 23 path-based test mocks, so Phase 4 switches none.
2. **Leaves never import the facade.** The facade imports leaves; leaves import only other leaves (in the order below), domain modules and `@/lib/supabase/client`.
   - Verified: the only existing cycle is facade ↔ `src/lib/awi/procedure-store.ts` (the facade uses `saveAwiProcedure`, and procedure-store uses `createPlannerSupabaseClient`).
   - It is left as-is. Re-pointing procedure-store at `client.ts` would be an importer change, deferred to Phase 5.
3. **Leaves are plain modules:** no `"use client"`, no `"server-only"`. The facade is imported by server code (`src/lib/supabase/server-data.ts`, `app/sops/page.tsx`, SolidWorks API routes). A `"use client"` leaf would turn its exports into client-reference proxies on the server (CLAUDE.md rule).
4. **Client boundary unchanged:**
   - `plannerClient()` keeps its browser singleton on `globalThis.__buildlogicPlannerSupabaseClient` (tests inject through that key).
   - It keeps its server trap: construction is allowed, any use throws with guidance.
   - The env constants are still read at module load.
   - Every `client?` parameter (29 functions) keeps defaulting **at call time** (`client ?? plannerClient()`), so per-request server clients from `server-data.ts` and the SolidWorks routes behave exactly as now.
5. **Authorization unchanged:** each check stays in the same function, in the same order:
   - `assertTaskInProject` / `assertTaskRowInProject` (`task_project_id` / `scenario_project_id` RPCs);
   - `requireToolLibraryProjectId`;
   - project-scoped storage paths and project-filtered deletes.

   RLS stays the enforcement layer.
6. **Module state keeps its guards:**
   - `signedUrlCache` moves together with its browser-only guard (`typeof window === "undefined"` → no caching), which prevents cross-user URL leaks on the server and must never be relaxed.
   - The per-client WeakMap and in-flight read maps (super-admin, membership, workspace groups) are Phase 5 and stay put.

#### Boundaries (`src/lib/planner/`), in dependency order

| Module | Moves (current anchors; names win over lines) | Exported via the facade | Est. lines |
|---|---|---|---:|
| `client.ts` | env constants (61–62); `PlannerSupabaseGlobal`, `migrateLocalStorageSessionToCookies`, `plannerClient` (284–381); `createPlannerSupabaseClient`, `getUserFromSession` (383–407) | `createPlannerSupabaseClient(): SupabaseClient<Database>`, `getUserFromSession(supabase)` | 150–190 |
| `query-helpers.ts` | `MISSING_RELATION_CODES`, `isMissingRelationError` (435–440); `assertSafeOrFilterValue`, `buildOrFilter`, `documentTypeScopeFilter`, `customColumnScopeFilter` (932–953); `assertTaskInProject`, `assertTaskRowInProject` (1564–1592); `throwIfError`, `newScopedId` (1671–1687) | none (internal) | 100–150 |
| `row-mappers.ts` | scalar helpers and all entity mappers (408–931, except the query helpers above); `taskRow`, `customFieldsRow`, `procedureTaskUpdateRow`, `dependencyRow`, `manufacturingStepRows`/`Row`, `normalizeManufacturingStepSequences` (954–1082); `partReferenceRows`, `actualEventRow`, `customColumnRow` (1548–1670). Sequence-collision **DB parking** (1083–1193) stays in the facade for Phase 5 (shell/task stores). | `mapScenarioSummary`, `procedureTaskUpdateRow` | 650–750 |
| `realtime.ts` | `RealtimePlannerTable`, `PlannerRealtimeScope`, `PlannerRealtimePayload`, `taskIdFromRealtimePayload`, `canPatchTaskFromRealtimePayload`, `isRealtimePayloadInScope` (101–206); `subscribePlannerStateChanges` (4878–4932) | those names, same signatures | 170–220 |
| `media-rows.ts` | `StepPhotoRow`, `StepExplodedViewRow`, `StepToolRow`, `TaskVideoRow`, `SignedMediaRow`; `mapStepPhotoRecord`, `mapTaskVideoRecord`, `mapStepExplodedViewRecord` (1194–1275); `withNormalizedStepAssets`, `indexStepPhotos`/`ExplodedViews`/`TaskVideos`/`StepTools` (1434–1547) | none | 260–330 |
| `media-storage.ts` | bucket and signing constants (63–73); `signedUrlCache` with its browser guard (75–100); `signedStorageUrl(s)` and `withSigned*Rows`, including tool-library images (1276–1433); storage-path builders (1593–1637); `storageObjectPaths`, `removeStorageObjects` (3770–3797); `dataUrlToBlob`, `blobToImage`, `createPhotoThumbnailBlob`, `safeStorageSegment`, `stableStoragePublicUrl` (4279–4375); `refreshSignedMediaUrl` (4376–4399) | `refreshSignedMediaUrl` | 380–460 |
| `media-store.ts` | soft deletes, caption update, `removeExplodedViewObject` (3818–3858); `currentUserIdForAttribution` (4400–4414); `stepPhotoRow`, `saveStepPhotoMetadataToSupabase`, `uploadStepPhotoAttachment`, `removeStepPhotoAttachmentObject`, `copyStepPhotoAttachmentToStep`, `saveExplodedViewToSupabase`, `saveTaskVideoToSupabase`, `softDeleteTaskVideoFromSupabase`, `removeTaskVideoObject` (4500–4877), with their input types | all of these, plus `ExplodedViewUploadInput` and `TaskVideoUploadInput` | 430–520 |
| `tool-store.ts` | `ToolLibraryRow`, `ToolLibraryItem` (260–281); `addStepToolToSupabase`, `removeStepToolFromSupabase`, `syncStepToolsForStepToSupabase` (3594–3660); `requireToolLibraryProjectId`, `loadToolLibraryFromSupabase`, `uploadToolLibraryImage`, `upsertToolLibraryMetadata`, `deleteToolLibraryFromSupabase` (3661–3817, minus storage helpers); `stepToolId`, `toolLibraryId` (4356–4367); `mapToolLibraryRow`, `stepToolRowsFromTask`, `syncStepToolsForTasks`, `syncStepToolsForTask` (4415–4499) | the six functions and `ToolLibraryItem` | 330–420 |

**Stays in the facade for Phase 5:**
- reads: core, full and summary loads, task and target reads, `loadTaskPrivateMediaFromSupabase`;
- the shell and full-state saves, the BOM save, granular task and step writes, the procedure transaction;
- scenarios, workspace and access, with their in-flight/WeakMap state;
- `SaveState`, `assertSaneStateDeletion`, `upsertWouldCollideOnSequence` and sequence parking.

**Expected sizes:** the facade drops to about 2,450–2,800 lines (the original target), and about 2,500–2,650 lines move into the leaves. These are estimates. A leaf above its range needs a reason, not fragmentation. Media boundaries may shift 50–100 lines to avoid a cycle; signing always stays with its cache.

**Facade form:**

```ts
export { uploadStepPhotoAttachment, ... } from "@/lib/planner/media-store";
export type { ToolLibraryItem, ... } from "@/lib/planner/tool-store";
```

`vi.mock(path, async (original) => ({ ...await original(), ... }))` still sees every name. Internal calls between moved functions were never mockable through the facade and remain so, so no test depended on that.

#### Tests that establish behaviour before extraction (written against the current file first)

**Existing real-implementation suites that must stay green:**
- the `supabase-planner.*.test.ts` files: awi-save, core-load, master-bom, mobile-step, photo-annotations, procedure-custom-fields, sequence-collision, step-photo-copy-guard, summary, workspace-list;
- `planner-realtime.test.ts`, `scenario-loading.test.ts`, `planner-save-tripwire.test.ts`, `project-catalog.test.ts`;
- `use-workspace-tools.persistence.test.tsx` (real savers over an in-memory database);
- `use-recovering-photo.test.tsx`;
- all component suites (mocked facade).

**Gaps to characterize first:**
1. **Facade export surface:** a sorted list of export names, plus `typeof` for runtime values. It fails if a name disappears or changes kind.
2. **Client boundary:**
   - server (node environment): the trap is constructible, any property access throws the guidance message, symbol/`then` probes return `undefined`;
   - browser (jsdom): one singleton, respecting an injected `globalThis` client;
   - missing env: the existing error;
   - `getUserFromSession` returns a null user without a session and never calls `getUser`.
3. **Signed-URL cache:**
   - browser: caches and refreshes after the margin;
   - server: never caches (the leak guard);
   - `refreshSignedMediaUrl` against a fake storage client.
4. **Media store over the in-memory database** (moved into a shared test helper):
   - `uploadStepPhotoAttachment`: data-URL path (upload, thumbnail, metadata row, project assertion) and the signed-https path (metadata only);
   - copy (the existing guard), soft delete, object removal;
   - `saveExplodedViewToSupabase` / `saveTaskVideoToSupabase` with an **injected** client, as the SolidWorks routes call them; a failed task-project assertion throws before any upload.
5. **Tool store:**
   - per-row add and remove by computed id; per-step sync;
   - library load, upsert (rename and category carry), delete with its project-scope requirement;
   - signed library images.
6. **Realtime:** `subscribePlannerStateChanges` over a fake channel. Tables and filters are registered per product and scenario, only in-scope payloads are emitted, and cleanup removes the channel.
7. **Row mappers:** golden snapshots of `mapTask`/`mapProduct`/`mapStation`/`mapZone`/step and part mappers, and the matching `*Row` serializers, over representative rows. Any mapping change shows as a diff.

#### Commit sequence (each one compiling, tested and gated)

**4A:**
1. characterization tests and the shared in-memory test helper
2. `client.ts`
3. `query-helpers.ts`
4. `row-mappers.ts`

**4B:**

5. `realtime.ts`
6. `media-rows.ts` plus `media-storage.ts` (together: the signing cache and its users)
7. `media-store.ts`
8. `tool-store.ts`

**Every commit must show:**
- a mechanical moved-lines check (each moved body byte-identical apart from imports and exports);
- the unchanged export-surface test;
- a script check that no leaf imports the facade and no leaf has a module directive;
- targeted suites, mutation checks on the new seams, and the full unit suite, lint and typecheck.

**Final tree:**
- optimized build, then `check:bundles` (sizes and the dev-harness guard), typecheck and diff check, run sequentially;
- the full browser suite on the retained isolated database (no reset);
- the product-open and module-switch **request counts identical** to the Phase 3 baseline (61 / 5 / 0) on the same scenario.

Stop after Phase 4 for review.

#### Out of scope

- Behaviour or query changes, request reduction, catalog or restore work, isolated-function activation.
- Re-pointing any importer (including breaking the procedure-store cycle).
- Account-switch cache redesign, Phase 5 stores, `database.types.ts` regeneration.

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

### Phase 5 execution plan (current code, 2026-10-03; not started)

**Baseline:** the facade `src/domain/supabase-planner.ts` is 2,587 lines and holds 74 top-level declarations: access, workspace, reads, scenarios, saves and granular task writes. Function names are the anchors; line ranges are approximate.

This is a **structural move only.** Public signatures, every existing caller, authorization order, client injection (`client ?? plannerClient()` at call time), module-level state and persistence behaviour stay as they are.

**Out of scope:** catalog redesign, recovery redesign, the isolated experimental functions, UI changes, migrations, merge and push.

#### Boundaries (`src/lib/planner/`), in dependency order

| Module | Moves (current anchors) | Facade exports kept | Est. lines |
|---|---|---|---:|
| `access-store.ts` | `loadProjectContext` (263–327); `inflightSuperAdminChecks` + `fetchIsSuperAdmin` (328–360); `fetchProjectAccessLevel`, `fetchUserProjectAccessMap`, `fetchOrgToolAccess` (361–442); `loadMembersAccessForWorkspace`, `AuditLogEntry`, `loadAuditLogFromSupabase`, `setProjectAccessInSupabase`, `setOrgToolAccessInSupabase` (968–1110) | `fetchIsSuperAdmin`, `fetchOrgToolAccess`, `loadMembersAccessForWorkspace`, `AuditLogEntry`, `loadAuditLogFromSupabase`, `setProjectAccessInSupabase`, `setOrgToolAccessInSupabase` | 330–370 |
| `workspace-store.ts` | `WORKSPACE_COLUMNS`, `PROJECT_COLUMNS` (149–151); `bootstrappedMembershipUserIdsByClient`, `inflightMembershipLoads`, `ensureDefaultWorkspaceMembership` (443–525); `inflightWorkspaceGroupReads`, `loadWorkspaceProjectGroups`, `readWorkspaceProjectGroups` (526–669); project create/update/delete, profile names, workspace update, members, access grants (with expiry and revocations), member role and removal, own profile name (670–967) | the 15 exported functions | 530–580 |
| `read-store.ts` | `loadPlannerStateWithProjectFromSupabase`, summary rows/columns, `buildPlannerSummaryState`, `loadPlannerSummaryStateFromSupabase`, `loadPlannerStateFromSupabase`, `loadPlannerCoreStateFromSupabase` (1111–1429); `ProjectTaskTarget`, `loadProjectTaskTargetsFromSupabase`, `loadTaskPrivateMediaFromSupabase`, `loadTaskFromSupabase` (2399–2577) | those 8 functions and the type | 500–540 |
| `scenario-store.ts` | `loadScenariosForProduct`, `SopSummary`, `listSopSummariesFromSupabase`, `duplicateScenario`, `updateScenarioTarget`, `renameScenario`, `deleteScenario` (1430–1537) | all of these | 115–140 |
| `shell-store.ts` | `SaveState` (145–148); sequence-collision types, `upsertWouldCollideOnSequence`, `parkSequencesIfUpsertWouldCollide` (217–262); `assertSaneStateDeletion`, `savePlannerStateToSupabase`, `savePlannerShellToSupabase` (1538–1815) | `SaveState`, `upsertWouldCollideOnSequence`, `assertSaneStateDeletion`, both saves | 330–360 |
| `bom-store.ts` | `saveMasterBomToSupabase` (1816–1861) | the same | 55–70 |
| `task-store.ts` | step-sequence collision helpers `manufacturingStepSaveNeedsCollisionSafeResequence`, `bumpManufacturingStepSequences` (152–216); the granular task and step writes, `taskFieldPatchRow`/`updateTaskFields`, `upsertProcedureStep`, `reorderProcedureSteps`, `deletePlannerTask`, `mergeTaskWithServerVersions`, `saveProcedureTaskUpdateToSupabase`, `moveManufacturingStepToTaskInSupabase` (1862–2398); `mergeLatestTaskToSupabase` (2578–2588) | the 16 exported functions | 620–660 |

**Facade afterwards:** imports and re-exports only, about 100–160 lines. **Moved in total:** about 2,450 lines.

`task-store.ts` is above the original 550–750 midpoint. That is deliberate: it keeps the procedure transaction and every step-sequence write in one module (see the next section).

#### What must stay together (save ordering and failure behaviour)

1. **`shell-store.ts`**, both shell saves, with `assertSaneStateDeletion` and sequence parking. Order:
   1. the six existence reads, then the deletion tripwire **before any write**;
   2. products → scenarios → stations (park, then upsert) → zones (park, then upsert) → components → document types → tasks;
   3. then `replace_task_children` (full save) or the dependency select/upsert/delete (shell save);
   4. then custom columns;
   5. then stale deletes in the order tasks → zones → components → document types → stations → custom columns. That order follows the foreign keys: stations are deleted last because task FKs are `ON DELETE SET NULL`.

   These are separate requests, not atomic (as documented in the zero-zone fix). The move must not reorder or merge them.
2. **The procedure transaction family in `task-store.ts`:**
   - `saveProcedureTaskUpdateToSupabase`, with its AWI branch to `saveAwiProcedure`, the version check and the single retry with `mergeTaskWithServerVersions`;
   - the step-sequence collision check and `bumpManufacturingStepSequences`, also used by `saveTaskWithManufacturingStepsToSupabase`;
   - the other step writes: `saveTaskAndManufacturingStepToSupabase`, `saveManufacturingStepToSupabase`, `upsertProcedureStep`, `reorderProcedureSteps`, `moveManufacturingStepToTaskInSupabase`, `saveMobileStepToSupabase`.

   Splitting them would separate one ordering invariant (`UNIQUE(task_id, sequence)` parking) across modules.
3. **Task row writes then tool sync:** `saveTasksToSupabase`, `saveTaskToSupabase` and `saveTaskWithManufacturingStepsToSupabase` keep the order assert → upsert → (steps) → tool sync from `tool-store`.
4. **`deletePlannerTask`:** reads the storage paths **before** the row delete and removes the objects **after** it.
5. **`saveMasterBomToSupabase`:** a single verified update, with no change to its client-side verification.
6. **In-flight and dedupe state stays with the function that writes it** (all `WeakMap`s keyed by client, so nothing leaks across users on the server):
   - `inflightSuperAdminChecks` with `fetchIsSuperAdmin` (`access-store`);
   - `bootstrappedMembershipUserIdsByClient` and `inflightMembershipLoads` with `ensureDefaultWorkspaceMembership` (`workspace-store`);
   - `inflightWorkspaceGroupReads` with `loadWorkspaceProjectGroups` (`workspace-store`).

   No state object is exported. Other modules call the functions.
7. **Load concurrency:** `loadPlannerStateWithProjectFromSupabase` starts the membership and administrator checks while the organization read is still pending, which `core-load.test.ts` pins. Its body moves intact.

#### Avoiding new import cycles

**Leaf dependencies stay acyclic:**

```
client ← query-helpers ← row-mappers ← media-rows ← media-storage ← (media-store, tool-store)
access-store ← workspace-store
read-store → access-store, media-*, row-mappers
scenario-store → row-mappers
shell-store → row-mappers
bom-store → row-mappers
task-store → read-store, tool-store, media-storage
```

No leaf imports the facade. The extraction tool from Phase 4 aborts on any reference back to the facade, and the per-commit check re-verifies this.

**The one forced decision (needs your approval):** `task-store.ts` must call `saveAwiProcedure` (`src/lib/awi/procedure-store.ts`), and that module imports `createPlannerSupabaseClient` **from the facade**. That would make a new cycle through a leaf: task-store → procedure-store → facade → task-store.

| Option | What | Cost |
|---|---|---|
| **A (recommended)** | Re-point procedure-store's one import to `@/lib/planner/client` (the identical function the facade re-exports). | A one-line importer change. It removes the existing facade ↔ procedure-store cycle entirely. Mock impact checked: `procedure-store.test.ts` passes clients explicitly, and component suites mock `saveProcedureTaskUpdateToSupabase` wholesale, so no test relies on the facade mock reaching procedure-store. |
| B | Keep `saveProcedureTaskUpdateToSupabase` and its helpers (`mergeTaskWithServerVersions`, and the step-sequence helpers it shares) in the facade. | The cycle stays exactly as today, but the facade keeps about 230 lines of logic, and the step-sequence helpers end up shared between the facade and `task-store`. |

**Phase 5 changes no other importer.** All 98 importers and the 23 path-based mocks stay on the facade.

#### Existing coverage and characterization gaps

**Already real-implementation tested** (must stay green unchanged):
- `core-load` (core load, access checks and their concurrency, private media), `summary`, `workspace-list` (bootstrap, groups, dedupe);
- `sequence-collision` (both saves), `planner-save-tripwire`, `master-bom`, `mobile-step`, `photo-annotations`, `awi-save` (AWI branch of the procedure save);
- `procedure-store.test.ts`, `row-roundtrip` (shell save and task load), `media-tools` / `server-media` (private media), `use-workspace-tools.persistence`.

**Gaps to characterize first,** over the shared in-memory client (extended with per-RPC answers and `or()`/`readRowsByIds` support where needed):
1. **Access:**
   - `fetchIsSuperAdmin` shares one in-flight request per client and re-checks after it settles;
   - `fetchOrgToolAccess`;
   - `setProjectAccessInSupabase` / `setOrgToolAccessInSupabase` payloads;
   - `loadMembersAccessForWorkspace`; `loadAuditLogFromSupabase` mapping and paging.
2. **Workspace:**
   - project create (RPC, then project context), update, delete (products before projects);
   - access grant upsert: domain check, expiry, revocation delete before upsert; grant delete;
   - member role and removal RPC; own profile name validation; profile-name batching; member list.
3. **Reads:** the full `loadPlannerStateFromSupabase` path (media signing, project rejection) and `loadProjectTaskTargetsFromSupabase`.
4. **Scenarios:** duplicate, rename, target and delete payloads and errors; `listSopSummariesFromSupabase`.
5. **Task writes:**
   - `saveTaskWithManufacturingStepsToSupabase`: bump, upsert, stale delete, tool sync with empty wipe;
   - `deletePlannerTask`: storage paths before the delete, objects after;
   - `moveManufacturingStepToTaskInSupabase`: order; `upsertProcedureStep` / `reorderProcedureSteps` RPCs;
   - `updateTaskFields` patch mapping; `mergeLatestTaskToSupabase`;
   - the **non-AWI** `saveProcedureTaskUpdateToSupabase` path: version check, one retry, conflict.
6. **Save ordering:** a recorded request-order golden for **both** shell saves: every request, in order, including the tripwire happening before the first write.
7. **Signatures:** the Phase 4 checker dump of all 90 facade exports, re-baselined at the start of Phase 5, must stay identical after every commit.

Each new test is mutation-checked against the pre-move code, like Phases 3 and 4.

#### Commit sequence

1. characterization tests
2. (if option A is approved) re-point procedure-store, its own commit
3. `access-store.ts`
4. `workspace-store.ts`
5. `read-store.ts`
6. `scenario-store.ts`
7. `shell-store.ts`
8. `bom-store.ts`
9. `task-store.ts`
10. facade cleanup (re-exports only)

**Every commit must show:**
- moved statements verbatim (tool self-check);
- signatures identical; no leaf → facade import; no module directives; acyclic leaves; module-private visibility restored;
- the relocated mutations still caught;
- full unit suite, lint and typecheck.

#### Final release validation (fresh disposable database)

Passing on the retained database alone **cannot** prove the isolated experimental functions are unused: that database contains them. So the final gate adds a **fresh, separately identified disposable database that holds only active migrations.**

1. **Identity:**
   - a new workdir `scratch/release-db`, with `project_id = "pulse-release"` (Supabase keys containers and volumes by project id, so its storage is separate from the retained `pulse-e2e`);
   - the same ports 56321/56322, because `playwright.config.ts` and the e2e specs require them.
2. **Isolation from the retained database:**
   - stop `pulse-e2e` with a plain `stop` (keeps its volumes);
   - start `pulse-release`;
   - before any reset, assert with `docker ps` that `supabase_db_pulse-release` is running and nothing from `pulse-e2e` is.
3. **Fresh contents:**
   - `db reset --local --workdir scratch/release-db` applies **only** `supabase/migrations` (copied fresh; the isolated folder is not copied) plus `seed.sql`;
   - assert that the experimental objects are **absent**: `to_regclass('public.deleted_manufacturing_steps')`, and `to_regprocedure(...)` for `delete_manufacturing_step`, `restore_manufacturing_step` and `apply_step_tool_changes`, are all null.
4. **Run:**
   - the active pgTAP suite (22 files);
   - the full browser suite, built against this database;
   - the request-count scenario. All must pass on the fresh database, with counts identical to Phase 4.
5. **Static check:** no `src`/`app` code references the experimental RPC or table names.
6. **Cleanup:**
   - stop `pulse-release` with `--no-backup` (deletes only that disposable project's volumes);
   - restart `pulse-e2e` and confirm its migration ledger still lists `20261003210000`, and its row counts match a checksum taken before step 2. The retained database is never reset or removed.
7. **Script:** this is packaged as `scripts/release-check-fresh-db.mjs`, which refuses to run unless every identity assertion holds. It is a new committed script; its exact behaviour is part of this plan for approval.

**After the local gate:** a future push would also run CI's own fresh-database job. That is not part of this phase (no push).

#### Not included

Catalog redesign, recovery redesign, the experimental database functions, request optimization, UI changes, migrations, merge and push. Stop after Phase 5 for review.

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

  This restores the lists the client had before the rewrite, keeping edits made since. That usually matches the database, but **not always**. It does not when another write changed the same steps' `step_tools` rows while the save was pending:
  - a Gantt reorder issued in that window (see below)
  - another tab or user
  - the mobile portal's full-list syncs

  In those cases the screen can disagree with the database until the next reload or realtime refresh. (Corrected 2026-10-03; this entry originally claimed the revert always matched the database.)

  Error status, the "Save failed" toast and the stop before library writes are unchanged.

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
  A characterization test pins this. Verified on the real retained database on 2026-10-03 with disposable fixtures. The design proposal is in `docs/tool-catalog-consistency-design.md`; it is not implemented and awaits review.

Validation:
- Seam tests: 6 for tools and 5 for media. Each fails against a targeted mutation of the behavior it guards: lock taken and released, rollback that keeps concurrent edits, destination-first cut with compensation, stale library responses, tracker keys, the confirmation guard, and category migration.
- Gate: full unit suite 1,904 tests (232 files), 1,912 after the catalog-refusal fix, and 1,923 (233 files) after the failed-rewrite fix, each with the full browser suite passing; lint; optimized build, then typecheck; `check:bundles`; 0 chunks with harness code; all 19 browser cases against the retained isolated database (not reset).
- Bundles are unchanged from Phase 1: planner entry 275.1 KiB, AWI master 274.0 KiB, largest chunk 124.0 KiB gzip. The failed-rewrite fix adds 0.3 KiB to each (275.4 and 274.3); the largest chunk is unchanged. No runtime speed claim is made; nothing was measured beyond bundle sizes.

## Zero-zone save fix (2026-10-03, separate from the phases)

Commit `33b2797`. Found while verifying the catalog proposal on the retained database; fixed on its own before Phase 3 or any catalog work.

- **Defect.** On a product with no zones, `normalizeTaskPlanningContext` generated the Unzoned station and also passed through every in-use input station. Once the Unzoned station had been saved, tasks pointed to it, so it came back twice. Every later shell save (Gantt edits, product fields, catalog rewrites) sent the duplicate id and failed with Postgres `21000`. The bug had been on `main` since `8b32966` (2026-05-28). The desktop optimizer derives stations through the same function before its scenario save.
- **Partial writes.** `savePlannerShellToSupabase` had already upserted `products` and `scenarios` before `stations` failed. So product fields were stored while task rows and later writes were not.
- **Fix.** Pass-through skips station ids the derivation already generated, and repeats. Station ids, task assignments, zoned products and other pass-through stations are unchanged. A state that already holds duplicates collapses to one of each. No data was deleted and no migration was added.
- **Tests:**
  - normalizer: an existing Unzoned station stays single across repeated derivation; other in-use stations pass through once; zoned behavior is pinned
  - repeated `createPlannerDerivation`
  - `e2e/zero-zone-save.spec.ts` on the retained database with a disposable workspace and product: a Gantt duration edit, a reload, another Gantt edit and a product rename, each checked as **stored rows**, with exactly one Unzoned station and unchanged task assignments
  - Against the unfixed build, the e2e case failed at its first Gantt edit (`POST stations 500`, duration still 60 min). The repeat guard was mutation-checked.
- **Not changed: the shell save is still not atomic.** It is still a sequence of separate requests. Any other failure part-way (network, RLS, another constraint) can still leave the earlier tables written and the later ones not. This fix removes only this particular cause.
- **Gate:**
  - 1,927 unit tests (233 files), lint, optimized build, `check:bundles`, typecheck and diff check pass
  - bundles unchanged (planner 275.4 KiB, AWI master 274.3 KiB, largest chunk 124.0 KiB)
  - all 20 browser cases on the retained isolated database (not reset; stopped afterwards with volumes kept)

## Paused for correctness proposals (2026-10-03)

Phase 3 is paused while these are reviewed. Neither is implemented, and no migration has been written or applied.
- `docs/restore-step-design.md` — **Restore Step data-preservation fix.**
  - Verified on the retained database: today's mobile Restore deletes every tool assignment and exploded view in the scenario, deletes a teammate's newer step in another task, and reverts sibling edits.
  - Proposal: server-held deleted-step records with targeted delete and restore RPCs, plus a guard on `replace_task_children`.
- `docs/tool-catalog-consistency-design.md` §5b — **an enforceable old-client fence.**
  - All tool writes go through a diff-based RPC, and a `step_tools` trigger refuses divergent direct writes.
  - Offline drafts are preserved: legacy drafts are add-only, with a notice.
  - Deployment order is M1 → C1 → M2 → M3/C2, with acceptance criteria per stage.
- **2026-10-03, Restore Step stage 1 implemented (isolated database only), `2277e69`.**
  - Added the recovery table and the `delete_manufacturing_step`, `restore_manufacturing_step` and `apply_step_tool_changes` functions.
  - Verification: pgTAP 48/48 (all 23 files, 446 assertions); every pre-existing record unchanged by the migration; two-session concurrency checks.
  - No client uses them yet, and nothing is deployed.
  - The step_tools-only compatibility fence is withdrawn: it would leave partial writes from old clients' multi-request operations. A write-protocol gate (header-identified clients, refused at the first write) is proposed instead, in the catalog design §5b. The exact user-facing messages awaiting approval are in §5c.
- **2026-10-03, compatibility rollout revised (proposal only; nothing activated).**
  - The refusing write-protocol gate is withdrawn, for two reasons:
    1. Most desktop edits (shell, Gantt, structure, tools, media) have no durable recovery; only step name/instruction drafts do.
    2. A refusal that lands between an old save's requests strands a partial write. Tested in `supabase/isolated/2026-10-03-step-recovery/tests/compat_cutover_test.sql` with prototypes in a rolled-back transaction: a refusal mid-reorder left temporary WBS values stored.
  - **The replacement:** never refuse already-deployed clients. Instead:
    - log-only telemetry of header-less writes;
    - a non-destructive `replace_task_children`;
    - the atomic reorder;
    - durable recovery in v2;
    - catalog operations enabled only after an observed zero-old-client period around a maintenance window.
  - Residual risks from tabs that stay open are listed in the catalog design §5b.
  - The header is an identifier only. Tests show it never bypasses permissions.
  - Writer and edit-recovery inventories are in the catalog design §5b.
- **2026-10-03, investigation closed.**
  - The closing scope is in `docs/correctness-scope.md`: completed fixes; isolated, unused additive database work; the blocked catalog and restore project; durable edit recovery as a future project.
  - The catalog rollout stays blocked: old clients can return after any observation period, and add-only whole-task replacement silently ignores intended changes.
  - The Phase 3 execution plan is ready above (not started).

## Phase 3 ledger — loading, realtime, scenarios (2026-10-03)

**Status:** complete on `codex/workspace-structure`, local commits only. Not merged or pushed. Phase 4 not started. Behaviour-preserving: no UI, data-contract, permission or database change. The isolated database functions are untouched and unused, and the catalog rollout stays blocked.

**Commits:**

| Commit | Purpose |
|---|---|
| `2dc709e` | 13 characterization tests (`line-workspace.sync.test.tsx`), written against the pre-extraction code |
| `fa22ea2` | Type-only test fix (the realtime scope type is derived from the subscribe signature) |
| `3ddc034` | Scenarios extraction |
| `f51e9d5` | Strengthens one test (the old scenario's queued task ids are dropped). Verified green on the pre-extraction realtime code before committing. |
| `37411de` | Realtime extraction |
| `d6f19d6` | Data-loading extraction |

**Sizes** (physical / nonblank lines):

| File | Before | After |
|---|---:|---:|
| `line-workspace.tsx` | 4,511 / 4,198 | **3,652 / 3,414** |
| `use-workspace-scenarios.ts` | — | 354 / 335 |
| `use-workspace-realtime.ts` | — | 393 / 355 |
| `use-workspace-data.ts` | — | 498 / 460 |
| `line-workspace.sync.test.tsx` (test) | — | 545 / 495 |

`use-workspace-realtime.ts` (393) and `use-workspace-data.ts` (498) are above the plan's ranges. The data hook carries an explicit options type for every outside setter and ref. The workspace landed inside the expected 3,550–3,700 range.

**Decisions taken:**
- **Deferred refresh keeps issuing-render semantics, exactly as before** (user decision).
  - `LineWorkspace` keeps a hoisted `flushDeferredRemoteRefresh()` that forwards to a holder **created fresh each render** and filled with **that render's** `useWorkspaceRealtime` functions.
  - A save issued in a render therefore flushes that render's refresh: its `projectId`, write tracker and stale-scope checks, even after an in-place project switch. That refresh is then discarded by `isRefreshTargetCurrent`.
  - Replacing the holder with a persistent object (`useRef({}).current`, i.e. latest-render semantics) fails the characterization test.
- **Kept in `LineWorkspace`** to avoid reordering effects or changing dependencies:
  - the four scenario effects, the scenario list, cache and Main id;
  - `pendingRemoteRefreshRef` and `remoteRefreshAppliedRef`;
  - the loaded and confirmed flags, project switching, hydration status and its refs, and the switch timer refs;
  - the unmount-only skeleton-timer cleanup, after the realtime call, so the two unmount cleanups keep their order.
- **Data hook dependencies.** The moved effects keep **byte-identical dependency arrays** in the same order. This was checked mechanically against `37411de`.
  - Values an effect lists come from parameters.
  - Other outside setters and refs are read from an options ref when the effect runs, the values the effect captured in `LineWorkspace`.
  - The load effect calls the `finishProjectSwitch` of the render it runs in.
- **Call positions:**
  - `useWorkspaceScenarios` has no effects, so its position is irrelevant.
  - `useWorkspaceData` is at the load effect's slot.
  - `useWorkspaceRealtime` is at the subscription's slot.
  - `usePlannerShellAutosave` still runs after the load effect (Phase 1 invariant).

**Pre-existing behaviour, pinned and not changed:** during an in-place product switch, the media-hydration effect runs in the same commit as the load effect, with the previous selection still current. It reads the previous task under the new product once (`[task-a, project-b]`), and that result is discarded by the scenario check. The test pins the exact sequence because it depends on effect order.

**Evidence:**
- **Characterization tests** (13), unchanged through all three moves, cover:
  - deferral and flush ordering; issuing scope after an in-place switch;
  - subscription stability on task add; re-subscription on scenario switch; queued-id drop;
  - save before switch: flush order, and a failed save blocking the switch;
  - delayed full, task and media responses discarded across scenario/product switches;
  - media loaded once with media-only merge, retried only on focus/online/visibility;
  - the switching state holding its 320 ms minimum while the subscription is re-created;
  - unmount cancelling the switch timer and queued refreshes;
  - read counts.

  Existing lifecycle tests (26) also stay green.
- **Mutations:**
  - 7 against the pre-extraction code (one initially survived; its test was strengthened);
  - 3 on the scenarios hook;
  - 6 on realtime, including the latest-render forwarder;
  - 5 on the data hook.

  All are caught.
- **Request counts on the retained isolated database,** same disposable scenario, before (`7761f33` build) and after (`d6f19d6` build), two runs each:

  | Phase | REST requests |
  |---|---:|
  | Product open | 61 |
  | First switch to Procedure | 5 (that task's media reads) |
  | Each other switch (Gantt, Setup, Dashboard, Procedure again, Gantt) | 0 |

  **Identical per endpoint, before and after; no increase.** No speed claim is made.
- **Final-tree gate:**
  - 1,940 unit tests (234 files), lint, optimized build, then `check:bundles`, typecheck and diff check, run sequentially;
  - bundles unchanged: planner 275.4 KiB, AWI master 274.3 KiB, largest chunk 124.0 KiB;
  - **20/20 browser cases** on the retained isolated database (not reset).

## Phase 4 ledger — persistence foundations and media (2026-10-03)

**Status:** complete on `codex/workspace-structure`, local commits only. Not merged or pushed. Phase 5 not started. Structural move only:
- no change to queries, request counts, persistence behaviour, authorization, schema or UI;
- no catalog work; the isolated database functions are not activated.

### Isolated migration relocation (`773ae2a`, separate commit, before any extraction)

- **Moved** to `supabase/isolated/2026-10-03-step-recovery/`, contents byte-identical (SHA-256 checked), with a "NOT AUTHORIZED FOR PRODUCTION" README:
  - `20261003210000_step_recovery_and_tool_changes.sql` (from `supabase/migrations/`)
  - `step_recovery_test.sql` (from `supabase/tests/`)
  - `compat_cutover_test.sql` (from `supabase/tests/`)
- **Not discovered** by CI (`db reset` / `test db` read only `supabase/migrations` and `supabase/tests`; `schema_paths = []`), by `apply-migration-safely.mjs`, by `repair-migration-ledger.mjs`, or by `test-browser.mjs` (which copies only `supabase/migrations`).
- **Coverage:** their 64 pgTAP assertions are **excluded** from the normal database suite. The active suite is now 22 files / 398 assertions, against 24 / 462 before. That is a coverage exclusion, **not equivalent coverage**.
- **Untouched:** the retained isolated database, its migration ledger, and the gitignored copy under `scratch/browser-db/supabase/migrations/`.

### Commits

| Commit | Purpose |
|---|---|
| `9c3c41f` | characterization tests and `src/test-support/in-memory-supabase.ts` |
| `f36f2f3` | `client.ts` |
| `509ebb6` | `query-helpers.ts` |
| `f47cf7d` | `row-mappers.ts` |
| `040cd22` | `realtime.ts` |
| `2736a43` | `media-rows.ts` + `media-storage.ts` |
| `d919031` | `media-store.ts` |
| `a20d719` | `tool-store.ts` |

### Sizes (physical / nonblank lines)

| File | Lines |
|---|---:|
| `src/domain/supabase-planner.ts` (facade) | **2,587 / 2,319** (was 4,932 / 4,415) |
| `client.ts` | 135 / 121 |
| `query-helpers.ts` | 86 / 72 |
| `row-mappers.ts` | 717 / 672 |
| `realtime.ts` | 168 / 153 |
| `media-rows.ts` | 280 / 250 |
| `media-storage.ts` | 396 / 343 |
| `media-store.ts` | 470 / 421 |
| `tool-store.ts` | 320 / 281 |

- All leaves are within or near their estimates.
- The facade is slightly above the 2,450–2,800 range on physical lines, but within it on nonblank lines.
- Tests: the in-memory client is 165 lines; the four new test files total 503.

### How the move was done

- A TypeScript-parser tool moved named top-level declarations **verbatim**, with their leading comments and in original order. It derived each leaf's imports from what the moved code references, and **aborted if moved code referenced anything still in the facade**. The facade kept importing what it still uses and re-exported exactly its previously exported names. Each move was self-checked: every moved statement appears byte-identical in its leaf, ignoring only an added `export`.
- **Visibility:** declarations nothing outside their leaf imports are module-private again, as they were inside the facade. That includes the signed-URL cache map, its record type and its read/write guards.
- **Type-only imports:** imports of leaf-declared types are marked `import type`.

### Compatibility evidence

- **No importer changed.** Since `773ae2a`, only the facade and the new leaves changed among non-test files. All 98 importers and the 23 path-based `vi.mock` users run unchanged, and their suites pass.
- **Signatures:** a TypeScript-checker dump of every facade export (call signatures, expanded type aliases and properties) is **identical to the pre-Phase-4 baseline** for all 90 exports after every commit. The only normalized difference is the checker's internal symbol counter in `__@iterator@N`. Typecheck of every caller also passes.
- **Leaf rules, checked after every commit:**
  - no leaf imports the facade;
  - no module directive in any leaf (they stay plain modules, imported by server code);
  - leaf dependencies are acyclic (`tool-store` / `media-store` → `media-storage` → `media-rows` → `row-mappers`; all → `query-helpers` → `client`);
  - the only cycle touching the facade or leaves is the pre-existing facade ↔ `src/lib/awi/procedure-store.ts`, left unchanged.
- **Client boundary unchanged:** the browser singleton on `globalThis.__buildlogicPlannerSupabaseClient`, the server trap, env read at load, and `client ?? plannerClient()` at call time. Authorization checks stay in the same functions, in the same order.

### Behaviour tests (written against the pre-move code)

- **Browser path (`media-tools`):**
  - photo upload path, attribution, signed URL; project check before storage;
  - metadata-only re-save; unsignable upload keeps its row and throws;
  - copy and its same-path guard; removal, soft deletes, captions;
  - signing cache and refresh;
  - step tools and library project scoping;
  - subscription listeners, scope filtering, cleanup.
- **Server path (`server-media`):**
  - SolidWorks exploded-view and video ingest with an injected client, project check before upload;
  - the server never caching signatures, **guard by guard** (the read guard and the write guard independently).
- **Client boundary:** singleton reuse, session bridge only without a cookie session, session user without `getUser`, missing-configuration error. The server trap stays covered by `server-guard.test.ts`.
- **Row round trip:** every planning field of a task survives the real shell save and task loader; stripped media and tool maps are rebuilt from their rows.
- **Mutations:** 12 targeted mutations, re-located automatically to whichever file held the code at each step, were caught at every stage:
  - both signing-cache guards and browser caching
  - photo, exploded-view and assertion project checks
  - the task-row serializer
  - subscription scope filtering
  - client singleton and session bridge
  - the tool-library project requirement

  One initially survived (the cache's two redundant guards masked each other). A guard-by-guard test was added before any code moved.

### Final-tree gate

- 1,962 unit tests (238 files), lint, optimized build, then `check:bundles`, typecheck and diff check, run sequentially.
- **Active** pgTAP: 22 files / 398 assertions, passing on the retained isolated database. The isolated files are excluded, as above.
- **20/20 browser cases** on the retained isolated database (not reset).
- **Request counts:** same scenario as Phase 3, two runs, **identical per endpoint** (61 on product open, 5 on the first switch to Procedure, 0 on other switches).

### Limitations and notes

- **Bundles grew 0.6 KiB gzip per entry** (planner 275.4 → 276.0, AWI master 274.3 → 274.9, sops 280.2 → 280.8, planning 282.4 → 283.0, AWI directory 284.6 → 285.2). The largest chunk is unchanged at 124.0 KiB, and every budget has ample room. This is consistent with eight additional module wrappers; no runtime cost is claimed or measured.
- **Duplicate test helper:** `use-workspace-tools.persistence.test.tsx` keeps its own in-memory client, left unchanged to avoid modifying a passing test. The new tests use `src/test-support/in-memory-supabase.ts`.
- **Facade still holds:** reads, shell and full-state saves, BOM, granular task writes, the procedure transaction, scenarios, workspace and access, and sequence parking (Phase 5). The facade ↔ procedure-store cycle remains; re-pointing that importer is a Phase 5 decision.
