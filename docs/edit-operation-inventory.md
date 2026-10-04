# Edit-operation inventory

Package A of `docs/edit-reliability-plan.md`. Audited on `main` `438a6df` (2026-10-04), read-only, from
actual call sites. Every row cites `file:line` on that commit. A claim marked **unverified** could not be
established from code alone; a claim marked **code-derived** follows from the code but was not
reproduced against a database in this pass. Historical documents were treated as claims to check, not
as facts; §9 records which held.

Field key used in every row: **(1)** user action · **(2)** owning component / handler · **(3)** scope
and how ids are obtained · **(4)** saver and tables / RPCs / storage touched · **(5)** request ordering
and transaction boundary, and what remains if request *N* fails · **(6)** authorization and version
checks · **(7)** pending status, acknowledgment, retry, failure handling · **(8)** what survives a
reload and where · **(9)** behaviour with concurrent edits or an older client · **(10)** tests found,
and whether they assert stored outcomes or only mocked call order.

Sections: 1 shared desktop infrastructure · 2 desktop shell path · 3 desktop procedure path ·
4 desktop direct writers · 5 mobile capture portal · 6 AWI · 7 SOP · 8 server routes, integrations and
operator scripts · 9 unused exports (active callers separated) · 10 historical claims vs code ·
11 cross-cutting findings.

---

## 1. Shared desktop infrastructure

- **Facade:** `src/domain/supabase-planner.ts` only re-exports (lines 7–111); implementations are in
  `src/lib/planner/*.ts`. The browser client `plannerClient()` is a per-browser singleton
  (`src/lib/planner/client.ts:67-110`); on the server it is a Proxy that throws on any access.
- **Controller:** `src/components/line-workspace.tsx` (3,652 lines) composes `useWorkspaceSaves`
  (line 629), `useProcedureDrafts` (665), `useProcedureSaveQueue` (~700), `useWorkspaceTools` (~820),
  `useWorkspaceMedia` (~845), `useWorkspaceScenarios`, `useWorkspaceRealtime`, `useWorkspaceData`.
- **Two save families** reachable from the desktop UI, plus direct writers that bypass both:
  1. *Shell path* — `markDirty()` (`use-workspace-saves.ts:120-125`) → 900 ms debounce
     (`usePlannerShellAutosave`, 451-492) → `persistPlannerState` (167-234) →
     `savePlannerShellToSupabase` (`shell-store.ts:230-358`). A destructive diff of the whole scenario:
     parents upserted, rows absent from memory deleted. Never writes `manufacturing_steps`,
     `part_references`, `step_tools` or media rows.
  2. *Procedure path* — `updateProcedureTask` (`line-workspace.tsx:1915-1962`) /
     `updateProcedureStepField` (`use-procedure-save-queue.ts:225-259`) → `scheduleProcedureTaskSave`
     (476-509, **750 ms debounce**, `PROCEDURE_SAVE_DEBOUNCE_MS` line 34) → `startProcedureTaskSave`
     (266-461) → `saveProcedureTaskUpdateToSupabase` (`task-store.ts:463-600`), or
     `saveTaskPhotoAnnotationsToSupabase` (130-159) for annotation-only patches. Version-checked, one
     merge-retry.
- **View-only gate** `blockViewOnlyWrite()` (`line-workspace.tsx:1647-1660`) is checked in
  `persistPlannerState` (`use-workspace-saves.ts:168`), `startProcedureTaskSave`
  (`use-procedure-save-queue.ts:283`), `applyProjectTasksUpdate` (`use-workspace-tools.ts:162`),
  `updateMasterBom` (`use-workspace-saves.ts:237`), `reorderTaskGroups` (`line-workspace.tsx:2938`),
  undo/redo (1663, 1679) and PFMEA (1868). It is **not** checked in media upload/paste/delete
  (`use-workspace-media.ts`, zero occurrences), step-tool add/remove (`use-workspace-tools.ts:108-145`),
  step move (`line-workspace.tsx:1964`), scenario rename/target/delete/duplicate
  (`use-workspace-scenarios.ts`) or the restore-step photo re-upload (2758). Those rely on RLS alone,
  which is the stated design (`query-helpers.ts:42-44` calls the client assertions "advisory UX guards").
- **Server authorization:** RLS `has_project_access(scenario_project_id(scenario_id), 'edit')` on
  tasks (`supabase/migrations/20260601124000_per_project_rls_isolation.sql:216-228`) and equivalents on
  zones/stations/children; storage policies in `20260701120000_media_storage_project_scoped.sql:27-157`.
  `tasks.version` and `manufacturing_steps.version` are bumped by trigger `bump_row_version`
  (`20260515163000_normalize_step_assets_and_versions.sql:1-27`) on **every** update, whether or not the
  client compared versions.
- **Pending/ack model:** `SaveState` (`shell-store.ts:28`: idle/loading/saving/saved/draft/retrying/
  conflict/error) is aggregated by `workspaceSaveStatus` (`src/domain/workspace-save-status.ts:89-107`)
  from the `WorkspaceWriteTracker` (17-59, keyed by operation) plus the procedure queue records. "Saved"
  is set by each writer after its own awaits resolve; there is no acknowledgment beyond the PostgREST
  response, except the AWI RPC and the master-BOM read-back.
- **Realtime deferral:** refreshes arriving while `hasPlannerShellSaveWork()` is true are parked
  (`use-workspace-realtime.ts:112-116, 186-191, 207-211`) and replayed by `flushDeferredRemoteRefresh`
  (332-339), which every writer calls in its `finally`.
- **Reload survival (desktop, all operations):**
  - IndexedDB `pulse-planner-cache` / store `project-snapshots`, keyed by project
    (`src/lib/planner-state-cache.ts:3-5, 153-197`) — a **display cache, not a recovery journal**: the
    remote load replaces it (`use-workspace-data.ts:324-333`) and the shell autosave stays disabled until
    the remote load confirms (`remoteStateConfirmedRef`, `use-workspace-saves.ts:130, 461`).
  - localStorage `buildlogic-line-planner-procedure-draft-v1:<projectId>` (`state.ts:35, 178-180,
    309-331`): dirty procedure drafts, reader accepts only `instruction` and `name` (`state.ts:276-280`);
    re-saved on load by `recoverProcedureDraftSaves` (`use-procedure-save-queue.ts:517-562`, called from
    `use-workspace-data.ts:259-263`).
  - localStorage `pulse:photo-annotation-draft:<taskId>:<photoId>` (`src/lib/photo-annotation-drafts.ts:3,
    29-32`), cleared only by a confirmed save (34-45; `use-procedure-save-queue.ts:387`).
  - UI-only keys (not edits): `buildlogic-line-planner-workspace-v1:<projectId>`, sessionStorage
    `pulse:project-switch-*` (`state.ts:36-39`), `PROCEDURE_HIDDEN_SECTIONS_STORAGE_KEY`
    (`procedure.tsx:146-171`).
  - **Everything else is memory only.**

---

## 2. Desktop shell path

### 2.1 `shell-autosave` — any Gantt/Setup edit that calls `markDirty`
1. Product numbers/text (`line-workspace.tsx:1694-1714`), zones add/update/delete/create-from-tasks
   (1716, 2687, 2712, 2745, 2793-2820), components (1730-1794), document type codes (1796-1851), product
   step checks (1853), PFMEA document (1867-1882), Gantt task patch `updateTask` (1884-1913, fed by
   `gantt-timeline.tsx:1094, 1104, 1129, 1241, 1250, 1293, 1670, 1983` and the setup/dashboard panels),
   dependencies (2597, 2634), headcount reset (2024), move tasks to zone (2833), add task (2977-3031),
   delete tasks (3037-3084), delete zone (2793), undo/redo (1662-1692), restore snapshot (2749-2756),
   IE allocation apply (2329).
2. `markDirty` → `usePlannerShellAutosave` → `persistPlannerState` (`use-workspace-saves.ts:120-125,
   451-492, 167-234`); also flushed on `pagehide`, on unmount and before scenario actions (350-399,
   127-144).
3. Whole `PlannerState` of the shown product + scenario from `latestDerivedStateRef.current`; project
   id from `state.product.projectId`, scenario from `state.scenario.id`.
4. `savePlannerShellToSupabase` (`shell-store.ts:230-358`): upserts `products`, `scenarios`, `stations`
   (with sequence-collision parking), `zones` (same), `manufacturing_components`, `document_type_codes`,
   `tasks` (`taskRow`, `row-mappers.ts:544-593`, excludes `version`), `task_dependencies`
   (select + upsert + delete), `custom_columns`; then deletes stale `tasks`, `zones`,
   `manufacturing_components`, `document_type_codes`, `stations`, `custom_columns`. No RPC.
5. 6 parallel existence reads (240-257), then roughly 2–20 sequential REST calls plus parallel park
   updates when a collision is detected (54-74). **Not a transaction.** Everything before the failing
   request stays committed (e.g. parents upserted but stale rows not deleted). Request order is the
   safety property (header comment, lines 1-6).
6. RLS. Client gates: `remoteStateConfirmedRef` (never saves before the remote load confirmed), view-only,
   `assertSaneStateDeletion` tripwire (`shell-store.ts:88-98`, applied 285-290: refuses to delete more
   than 50 % of an entity once at least 5 rows exist). **No version compare**: `taskRow` omits
   `version`; the trigger bumps it, which then forces any in-flight procedure save into its merge-retry.
7. `saving` → `saved` (195, 232); on error `setSaveError`, state `error`, toast (206-217). Tracker key
   `planner`. **No retry**; `plannerDirtyRef` stays set so the next edit or flush re-attempts. A save
   requested while one is in flight is parked in `queuedSaveStateRef` (186-190, 220). Local state is not
   rolled back. In-app navigation and `beforeunload` are guarded while dirty or failed (350-399).
8. Memory only. The IndexedDB snapshot is written only after a successful save (229).
9. Last write wins per row; full-list replacement per entity bounded only by the tripwire. A teammate's
   new task in another tab is deleted by this client's next save if this client's state predates it;
   realtime refresh and its deferral are the only mitigation. No old-client compatibility gate.
10. `src/domain/supabase-planner.save-order.test.ts:97` (request-order snapshot, mocked),
    `supabase-planner.sequence-collision.test.ts:249-314` (scripted client), `planner-save-tripwire.test.ts`,
    `use-workspace-saves.test.tsx:238-382` (gating/debounce/flush, facade mocked),
    `line-workspace.sync.test.tsx:232-354`. **Stored outcome:** `e2e/zero-zone-save.spec.ts:57-113`
    (real rows after reload, isolated database).

### 2.2 `delete-tasks` / `delete-zone` and the "Restore" toast
- `executeDeleteTasks` (`line-workspace.tsx:3037-3084`) and `executeDeleteZone` (2793-2820) remove rows
  from memory and `markDirty`. The autosave then issues `tasks.delete().in(...)`
  (`shell-store.ts:335-337`); FK cascades remove steps, parts, step_tools and media **rows**
  (`task-store.ts:427-430`). Storage objects are not removed on this path.
- "Restore" (`restorePlannerSnapshot`, 2749-2756) puts the pre-delete state back and calls `markDirty`;
  the shell save re-upserts `taskRow` only (`shell-store.ts:313`). **Code-derived:** if the 900 ms
  autosave already ran (the toast lives 9 s, 1226), restored tasks come back **without** steps, parts,
  step_tools or media rows, because the shell path never re-inserts children. The toast promises
  "deleted task data" (3053). Not reproduced live; no test asserts restored children.

### 2.3 `catalog-rename` / `catalog-delete` / `catalog-tidy`
1. Setup → Tools catalog (`project-catalog-setup-panel.tsx:508, 524, 449`) → `saveCatalogTool`
   (`use-workspace-tools.ts:219-277`), `deleteCatalogTool` (337-359), `tidyCatalogToolNames` (279-335).
2–4. `applyProjectTasksUpdate` (151-217) rewrites tool names inside every task's
   `customFields.stepToolLists` and calls `savePlannerShellToSupabase(nextState)` directly (183), then
   `upsertToolLibraryMetadata` (`tool-store.ts:162-206`) or `deleteToolLibraryFromSupabase` (208-226:
   row delete plus best-effort `storage.from("step-photos").remove`), then reloads the library.
5. Shell save (~10–20 requests) + 2–4 library requests, sequential, not a transaction. A failed shell
   save skips the library write and reverts the on-screen step-tool change (198-201); a failed library
   write after a successful shell save leaves tasks renamed but the library row not (272).
6. `remoteStateConfirmedRef` + view-only gates (154-163); RLS; no version check.
7. Tracker `planner` / `tool-catalog:<key>`; "saved" is reported after the shell save (184) while the
   library write is still pending; no retry.
8. Memory only.
9. **Confirmed pre-existing defect:** the shell save never writes `step_tools`, so a successful rename
   leaves `step_tools.tool_name` on the old name until a later `syncStepToolsForTasks` (Gantt reorder)
   happens — characterized by `use-workspace-tools.persistence.test.tsx:223`. The catalog rollout
   stays BLOCKED (`docs/correctness-scope.md` §3).
10. `use-workspace-tools.test.tsx:115-238` (mocked); `use-workspace-tools.persistence.test.tsx:173-223`
    (**in-memory tables with the real savers; asserts stored rows**).

### 2.4 `optimize-line` — full-state save into a fresh scenario
1. Gantt "Optimize line" → `optimizeLineIntoScenario` (`line-workspace.tsx:2112-2186`).
3. Current scenario → RPC → new scenario id; project from the `projectId` prop.
4. Drain → RPC `duplicate_scenario` (`scenario-store.ts:68-77`) → `loadPlannerStateFromSupabase` →
   `runLineOptimization` → **`savePlannerStateToSupabase`** (`shell-store.ts:100-228`: the shell
   upserts plus RPC `replace_task_children`, `20260601128000_replace_task_children_rpc.sql`, which
   deletes and re-inserts dependencies/steps/parts/actual_events in one transaction, then stale
   deletes) → scenario list refresh and load.
5. 1 RPC + full load + ~10 REST + 1 RPC + reload, sequential; only the child replacement is
   transactional. A failure after `duplicate_scenario` leaves the new scenario behind (no cleanup in
   the catch, 2176-2181).
6. RLS (scenario RPCs are SECURITY INVOKER since `20260605130000_secure_scenario_rpcs.sql:14-15`);
   `remoteStateConfirmedRef`; tripwire; no version check.
7. `loading` → `saved`; error → `error` + toast; no retry. 8. Memory only.
9. The duplicated scenario has no steps/tools/photos (`duplicate_scenario_rpc.sql:111-114`), so the
   child replacement destroys nothing — confirms `docs/correctness-scope.md` §3 "Optimizer" row.
10. `save-order.test.ts:86` (call order, mocked). No end-to-end test of the optimizer flow.

---

## 3. Desktop procedure path

### 3.1 `procedure-step-field-edit` — typing in a step's name / instruction (and other step fields)
1. `onProcedureFieldChange` from `procedure.tsx` / `step-editors.tsx` → `updateProcedureStepField`
   (`use-procedure-save-queue.ts:225-259`); focus/blur tracked by `markProcedureFieldActive/Inactive`
   (`use-procedure-drafts.ts:485-525`).
3. Scope `{projectId, scenarioId}` captured per queue record at schedule time (262-264, 490); task id
   from the step editor.
4. `saveProcedureTaskUpdateToSupabase` (`task-store.ts:463-600`): `assertTaskInProject` (RPC
   `task_project_id`), `tasks.update(...).eq(id).eq(version)` (503-509; row = description, safety notes,
   planned duration, custom_fields, plus name for AWIs — `row-mappers.ts:605-626`), parallel reads of
   `manufacturing_steps` and `part_references` (527-530), delete of stale steps (546-548), optional
   collision parking (550-555), **one `update … eq(version)` or `upsert` per step of the task**
   (557-588), `part_references` upsert (590-593) and stale delete (595-597), then a confirmation
   `loadTaskFromSupabase` (599). **AWI tasks** (`customFields.awiDocumentNumber`) instead call RPC
   `save_awi_procedure` (474-500; `src/lib/awi/procedure-store.ts:8-15`;
   `20261003180653_atomic_awi_procedure_save.sql`) — one transaction with expected task/step versions.
   *Measured 2026-10-04:* on a task with 5 steps one instruction edit issued 5 `PATCH
   manufacturing_steps`, on a 1-step task 1; the confirmation read paged `step_tools` across 3
   requests on the 1,100-tool task (see the baseline document).
5. Non-AWI: 1 RPC + 1 update + 2 parallel reads + 0..N step writes + parts + 1 multi-read confirmation,
   sequential, **not a transaction**. A step update failing mid-loop leaves the task row and earlier
   steps committed. AWI: one RPC, one transaction.
6. RLS; `assertTaskInProject`; **optimistic concurrency** on `tasks.version` and each
   `manufacturing_steps.version`. On a miss, with `allowVersionRetry`, reload and
   `mergeTaskWithServerVersions` (442-461: local fields win, server versions adopted, server-only steps
   appended), then **one** retry (518/580); a second miss throws a save-conflict error. Parts and stale-
   step deletes are **not** version-checked.
7. Queue per task (`use-procedure-save-queue.ts:38-45`): idle / dirty-pending / saving /
   saving-with-newer-pending / retrying / error / conflict. Debounce 750 ms (34); retry 2.5 s after a
   non-conflict failure (357-376), **unbounded** while the error persists; conflict stops and waits for
   the user (336, 357). Status `draft` while scheduled (494), `saving`, `saved` (458),
   `retrying`/`error` (345); toasts 349-354. Drafts are acknowledged only when the response confirms the
   exact field value and save id (`confirmProcedureDraftsFromSave`, `use-procedure-drafts.ts:558-635`); a
   stale response re-dirties the field (418-453). Scope exit **flushes** debounced saves
   (`flushScheduledProcedureSaves`, 569-577). View-only: the queued save is dropped silently (283-290).
8. localStorage draft snapshot (§1) — `name` / `instruction` only; recovered and re-saved 250 ms after
   the next open of that project (`use-workspace-data.ts:254-265`). Duration, quality check, tools and
   parts are **not** persisted locally.
9. Server echoes and realtime are merged field-by-field around dirty/active drafts
   (`mergeServerTaskIntoLocalTask`, `use-procedure-drafts.ts:324-404`) and deferred while a field is
   dirty (414-445). Two clients editing the same step: version conflict → merge-retry, local wins on
   edited fields. Any shell save (from any client) bumps `tasks.version` and forces the merge path. A
   step deleted on the server while edited locally is flagged `conflict` (358).
10. `use-procedure-save-queue.test.tsx:100-379`, `use-procedure-drafts.test.tsx`,
    `line-workspace.lifecycle.test.tsx:294-689` (all facade-mocked, assert timing/args/status);
    `supabase-planner.task-writes.test.tsx` "with an injected client" (scripted client, conflict
    retries); `supabase-planner.procedure-custom-fields.test.ts`; `supabase-planner.awi-save.test.ts:32-72`;
    pgTAP `supabase/tests/awi_procedure_save_test.sql` (**stored outcome, AWI only**); `e2e/awi.spec.ts`.
    **No pgTAP or browser test covers the non-AWI procedure save's stored outcome.**

### 3.2 `procedure-task-patch` — add / insert / remove / reorder steps, duration, quality check, parts, step-scoped custom fields, task text
1. `procedure.tsx` handlers `patchManufacturingSteps` 422-437, add/insert 457-477, remove 479-503
   (+ `onStepDeleted` restore toast), parts 520-557, instruction part mentions 566-661, task text
   834/929/939 — all via `onUpdateTask` = `updateProcedureTask` (`line-workspace.tsx:3451`, 1915-1962).
3–9. Same saver and queue as 3.1 with the whole task snapshot in one `scheduleProcedureTaskSave`
   (1955). Step deletion persists as the stale-step `delete().in(...)` (`task-store.ts:546-548`): hard
   delete, cascades `step_tools`/`step_photos` rows; **storage objects are not removed**. Reorder persists
   through stale-delete + parking + upserts (550-563), **not** through the `reorder_manufacturing_steps`
   RPC (which has no production caller, §9). `updateProcedureTask` does not call `markDirty`, so no
   shell save follows; `planned_duration_minutes` rides on the procedure row (`row-mappers.ts:623`).
8. Memory only (step structure is not in the draft snapshot).
10. `step-editors.test.tsx`, `procedure-custom-fields.test.ts`. No stored-outcome test for
    reorder/delete through the procedure save.

### 3.3 `restore-deleted-step` ("Restore Step" toast)
1. `notifyDeletedStepRestore` → `restoreTaskProcedureSnapshot` (`line-workspace.tsx:2758-2782`).
4. `updateProcedureTask` with the pre-delete steps/parts/customFields (→ 3.1 queue), then
   `settleWriteBatch` of `uploadStepPhotoAttachment` per photo (2770-2772) → `media-store.ts:135-198`,
   which for already-stored photos only upserts `step_photos` (141-146, 123-133).
5. The queued procedure save runs **concurrently** with the photo-row upserts; no ordering; not a
   transaction. Partial failure → `setSaveError`, `error` (2776-2778) although the step itself may have
   saved.
6. RLS + `assertTaskInProject`. 7. Tracker `photo-upload:<task>:<step>`. 8. Memory only. 9. Last
   write wins on photo rows. 10. None specific to this path.

### 3.4 `photo-annotation-save`
1. Viewer writes `customFields.stepPhotoAnnotations` via `updateProcedureTask` with a customFields-only
   patch (`line-workspace.tsx:1925-1956`).
4. `saveTaskPhotoAnnotationsToSupabase` (`task-store.ts:130-159`): assert, then up to 3 ×
   (`tasks.select(custom_fields, version).single()` → 3-way `mergeAnnotationDocuments` →
   `tasks.update({custom_fields}).eq(id).eq(version)`).
5. 1 RPC + 2 REST per attempt; CAS loop; after 3 misses throws "Photo annotations changed during saving."
6. RLS; version CAS on `tasks`; writes the **entire `custom_fields`** object merged from the server copy.
7. Queue as 3.1 (`annotationOnly`, 298-301); `acknowledgeAnnotationDrafts` clears localStorage only on a
   confirmed response (387). 8. localStorage `pulse:photo-annotation-draft:…`. 9. Three-way merge;
   concurrent editors converge. 10. `supabase-planner.photo-annotations.test.ts:22-30` (scripted),
   `use-procedure-save-queue.test.tsx:347-379`, `src/lib/photo-annotation-drafts.test.ts`.

---

## 4. Desktop direct writers (no queue)

### 4.1 `gantt-reorder` — drag process groups / move into zone
1. `gantt-timeline.tsx:943` → `onReorderTaskGroups` → `reorderTaskGroups` (`line-workspace.tsx:2851-2975`).
3. Changed tasks only (wbs/zone/station diff, 2918-2926); `projectId` prop.
4. `saveTasksToSupabase` **twice** (`task-store.ts:108-117`): per task RPC `scenario_project_id`
   (parallel), `tasks.upsert(taskRow[])`, then `syncStepToolsForTasks` (`tool-store.ts:266-293`:
   `step_tools` select, upsert, stale delete for tasks with ≥1 tool). First call writes temporary
   `wbs: tmp-<token>-N` (2950-2955), second the real values (2956); then the IndexedDB cache.
5. 2 × (N RPC + 1 upsert + 1–3 step_tools requests), sequential, not a transaction. A failure between
   the two calls leaves `tmp-…` WBS values in the database (**confirmed** from code; the plan's stated
   risk).
6. `blockViewOnlyWrite` (2938); RLS. **No version check** (`taskRow` has no version);
   `remoteStateConfirmedRef` is **not** checked here.
7. Holds `saveInFlightRef` (2942) so shell saves queue behind; tracker `gantt-order`; `saved`/`error` +
   toast (2957-2967); no retry; local state not reverted.
8. Memory only. 9. Last write wins on task rows. **Side effect:** `syncStepToolsForTasks` rewrites
   `step_tools` from the local `stepToolLists` custom field for every changed task, so an older client's
   view of tool lists overwrites newer rows — the "old clients can return" hazard in
   `docs/correctness-scope.md` §3, confirmed.
10. `task-writes.test.tsx:63-89` (request-order snapshots, scripted). No stored-outcome test of the
    two-phase WBS write.

### 4.2 `step-move` — move a manufacturing step to another task
1. `procedure.tsx:1063` confirm → `moveProcedureStepToTask` (`line-workspace.tsx:1964-2022`).
4. `moveManufacturingStepToTaskInSupabase` (`task-store.ts:602-643`): 2 project asserts, read target
   steps, `bumpManufacturingStepSequences` (N parallel updates), `manufacturing_steps.update({task_id,
   sequence: 200000})`, `step_tools.update({task_id})`, `step_photos.update({task_id})`, then two full
   `saveProcedureTaskUpdateToSupabase` (source, target).
5. ~8 + N + 2 procedure saves, sequential, not a transaction. A failure after the step-row update but
   before the procedure saves leaves the step moved with sequence 200000.
6. RLS; asserts; version checks only inside the two procedure saves. 7. Tracker `step-move:<stepId>`;
   optimistic state applied first (1995) and **rolled back to `previousState`** on error (2009), which
   also discards other edits made meanwhile; toast; no retry. 8. Memory only. 9. Last write wins.
10. `src/domain/move-manufacturing-step.test.ts` (pure domain). No saver test.

### 4.3 `step-tool-add` / `step-tool-remove`
1. `procedure.tsx:663-687` → `onUpdateTask(customFields)` **and** `onAddStepTool`/`onRemoveStepTool` →
   `persistAddStepTool` / `persistRemoveStepTool` (`use-workspace-tools.ts:108-145`).
4. `addStepToolToSupabase` (`tool-store.ts:32-49`: assert + `step_tools.upsert`, deterministic id
   `tool-<step>-<name>`), `removeStepToolFromSupabase` (51-57). In parallel the procedure queue saves
   `customFields.stepToolLists` (3.1).
5. 2 requests each; **two independent writers for one user action**; no ordering between the
   `step_tools` row and the `custom_fields` copy.
6. RLS; assert; no version; **no view-only gate**. 7. Tracker `tool:<step>:<key>`; `saving` → `saved`
   / `error` (111-121); no retry; no local revert. 8. Memory only. 9. Two sources of truth (`step_tools`
   rows vs `customFields.stepToolLists`), each last-write-wins. 10. `use-workspace-tools.test.tsx:97`,
   `supabase-planner.media-tools.test.tsx:153` (scripted).

### 4.4 `photo-upload`
1. `procedure.tsx:689` → `uploadStepPhotos` (`use-workspace-media.ts:74-130`).
4. Per photo `uploadStepPhotoAttachment` (`media-store.ts:135-198`): assert RPC, storage upload, signed
   URL, thumbnail upload, signed URL, `auth.getSession`, `step_photos.upsert`; photos in parallel via
   `settleWriteBatch` (`workspace-save-status.ts:9-14`).
5. ~7 requests per photo; a storage object can exist without a row if the metadata upsert fails (no
   cleanup). 6. RLS + storage policies; assert; no version; **no view-only gate**. 7. Holds
   `saveInFlightRef` (81); tracker `photo-upload:<task>:<step>`; optimistic insert rolled back **only for
   the failed photos** (108-120); no retry. 8. Memory only. 9. Rows keyed by photo id.
10. `use-workspace-media.test.tsx:102-127` (mocked), `media-tools.test.tsx:62-97` (scripted).

### 4.5 `photo-paste` (copy / cut between steps or tasks)
4. `pasteStepPhoto` (`use-workspace-media.ts:140-292`) → `copyStepPhotoAttachmentToStep`
   (`media-store.ts:222-287`: assert, storage copy ×1–2, sign, `step_photos.upsert`) or upload; then
   `saveTaskCustomFieldsToSupabase(target)` (`task-store.ts:161-165`: assert + `tasks.update({custom_fields})`
   **unversioned, whole object**), for a cross-task cut the same for the source, then a soft delete of
   the source photo.
5. 6–10 sequential requests, not a transaction; best-effort compensation on failure (245-279).
6. RLS; asserts; **no version check, no view-only gate**. **Code-derived:** the unversioned whole-object
   `custom_fields` update can overwrite a concurrent procedure save's `custom_fields` (annotations,
   tool lists, part markers). 7. Holds `saveInFlightRef`; tracker `photo-paste:…`; toasts. 8. Memory
   only. 9. Last write wins on `custom_fields`. 10. `use-workspace-media.test.tsx:217` (mocked),
   `supabase-planner.step-photo-copy-guard.test.ts`, `media-tools.test.tsx:97`.

### 4.6 `photo-delete` (+ Restore), `exploded-view-delete`, `video-delete`
4. `softDeleteStepPhotoAttachmentFromSupabase` (`media-store.ts:36-42`: `step_photos.update({deleted_at})`),
   `softDeleteExplodedViewFromSupabase` (44-52) + fire-and-forget storage remove (56-61, errors
   swallowed), `softDeleteTaskVideoFromSupabase` (455-461) + remove (465-470). Photo Restore re-runs
   `uploadStepPhotoAttachment`'s metadata-only path (`deleted_at: null`, 119).
5. 2 requests (+1 storage). 6. RLS; assert; no version; no view-only gate. 7. Optimistic removal,
   restored on failure (`use-workspace-media.ts:403-410, 306-309, 335-338`). 8. Memory only. 9. Soft
   delete, idempotent. 10. `use-workspace-media.test.tsx:139-215`, `media-tools.test.tsx:105`.

### 4.7 `master-bom-upload`
4. `updateMasterBom` (`use-workspace-saves.ts:236-327`): flush + `waitForLocalSavesToSettle(12000)`,
   then `saveMasterBomToSupabase` (`bom-store.ts:24-68`): one `products.update({custom_fields}).eq(id)
   .eq(project_id).select("*")` with an exact read-back comparison before reporting success.
5. 1 request after the barrier. 6. View-only + `remoteStateConfirmedRef`; RLS; **no version**; writes
   the whole product `custom_fields` (also carrying PFMEA / step-check fields as of that moment).
7. Tracker `master-bom`; toast; a queued shell snapshot is replayed with the verified BOM (304-325).
8. Memory only. 9. Last write wins on `products.custom_fields`. 10. `supabase-planner.master-bom.test.ts:73-111`
   (scripted read-back), `use-workspace-saves.test.tsx:103-238`, `project-catalog-setup-panel.master-bom.test.tsx`.

### 4.8 Scenario actions (`use-workspace-scenarios.ts`)
- `scenario-duplicate` (273-307): barrier → RPC `duplicate_scenario` (DB transaction) → reload. No
  view-only gate.
- `scenario-delete` (240-270): confirm → RPC `delete_scenario` (guards in SQL,
  `20260605120000_delete_scenario_rpc.sql:20-35`) → cache evict → reload. **No save barrier before the
  delete**: unsaved edits to that scenario are lost.
- `scenario-rename` (192-219) and `scenario-target` (311-339): optimistic, one `scenarios.update`
  (`scenario-store.ts:81-99`), revert + toast on failure; no version; **not tracked by the write
  tracker**, so navigation guards do not wait for them.
- Tests: `supabase-planner.scenarios.test.tsx:38-59` (scripted), `line-workspace.sync.test.tsx:339-369`,
  `src/domain/scenario-loading.test.ts`. **No pgTAP for `duplicate_scenario` / `delete_scenario`.**

### 4.9 Effect-driven writes and render-time writes (desktop)
- **No Supabase write during a server-component render was found**: `app/` outside route handlers has
  no insert/upsert/update/delete/rpc; `src/lib/supabase/server-data.ts:162` only reads, and its comment
  (line 42) states the profile/grant writes are deliberately client-side.
- `ensureDefaultWorkspaceMembership` (`workspace-store.ts:59-131`: `profiles.upsert` + RPC
  `redeem_workspace_access_grants`) runs from `auth-project-gate.tsx:295` and `:312`; guarded per client
  and user (`bootstrappedMembershipUserIdsByClient`, 53, 76-81, 109) and by an in-flight promise, both
  writes idempotent. *Measured 2026-10-04:* exactly 1 `POST profiles` and 1 `POST rpc/
  redeem_workspace_access_grants` per page open on every fixture and sample.
- `useWorkspaceSaves` unmount cleanup and `pagehide` both flush a dirty shell save (`use-workspace-saves.ts:351-353, 397`);
  `saveInFlightRef`/`queuedSaveStateRef` serialize a double trigger into a queued second save.
- Draft recovery (`use-workspace-data.ts:254-265`) skips tasks with in-flight or debounced work
  (`recoverProcedureDraftSaves`, 520-522).
- The development-only autosave harness (`procedure-autosave-harness.ts`, installed behind
  `NODE_ENV === "development"` at `line-workspace.tsx:983-998`) issues no Supabase writes.
- **Inert `DetailDrawer` with hazardous wiring:** `showDetailDrawer = false` (`line-workspace.tsx:1582`),
  but its props map `onUpdateTask={updateTask}` (3607) while its handlers patch steps/parts
  (`drawer.tsx:288-412, 482-495`). Re-enabled as wired, those edits would reach only the shell save and
  never persist.

---

## 5. Mobile capture portal (`src/components/mobile-photo-portal.tsx`) and photo viewer

Unqualified `:NNN` in this section refers to `src/components/mobile-photo-portal.tsx` (4,369 lines, one
exported symbol `MobilePhotoPortal`, line 809).

### 5.0 Topology
- Mounted by `app/projects/[projectId]/mobile-photos/page.tsx:13-18` and `app/mobile-photos/page.tsx:14-16`
  through `MobilePhotoRouteShell` (`src/components/project-route-shells.tsx:220-233`), keyed by project id
  (`:264-265`), so every project switch is a full remount. The shell stores the chosen project in
  `localStorage["pulse:photo-portal-project"]` (`:248-250`).
- `StepPhotoViewer` (`src/components/step-photo-viewer.tsx`) is **not** mounted by the portal; its only
  production mount is the desktop `step-editors.tsx:546-554`. Its saves go through the desktop
  procedure queue (§3.4).
- All writes use the browser singleton (`src/lib/planner/client.ts:70-83`). Database authorization is
  RLS: `has_project_access(task_project_id(task_id), 'edit')` on `step_photos` / `manufacturing_steps` /
  `step_tools` (`20260601124000_per_project_rls_isolation.sql:267-370`), storage path policy
  (`20260701120000_media_storage_project_scoped.sql:27-37`). Client-side `assertTaskInProject` /
  `assertTaskRowInProject` (`query-helpers.ts:45-67`) are advisory.
- **UI observation, separate from authorization:** the portal has no UI access-level gate (zero
  references to `accessLevel` or `role`; the shell computes `accessLevel` at
  `project-route-shells.tsx:244` but does not pass it), so the controls render the same for every access
  level. Whether a read-only user's write is refused is decided by the RLS policies above, which this
  pass did **not** exercise against a database; the inventory therefore makes no claim that an
  unauthorized write is or is not possible. What the code shows is only the UX consequence: a refused
  write surfaces as the "Not saved" status rather than as a disabled control.
- Every full `taskRow` upsert from the phone (`row-mappers.ts:544-595`) omits `version`, so the
  `bump_row_version` trigger increments it and forces later desktop version-checked saves into their
  merge-retry.
- Save plumbing: `saveState` (`:822`) / `writesPending` (`:858`); indicator `:3441-3444` shows
  "Not saved" | "Saving…" | "Saved", and **"Saved" is also shown for `idle`** (fresh load), meaning
  "nothing failed", not "this edit was confirmed". Write lock `beginLocalWrite`/`endLocalWrite`
  (`:1800-1815`); `hasLocalSaveWork()` (`:1365-1367`) counts a pending autosave timer and retained failed
  patches. Per-task serial chain `enqueueTaskScopedWrite` (`:1851-1865`): a failed earlier write never
  blocks the next. Realtime (`:1763-1800`) triggers task-scoped (250 ms) or whole-plan (350 ms) reads,
  deferred while local work is pending; refetched tasks **replace** local tasks wholesale (`:1438-1448`).
- *Measured 2026-10-04:* opening the portal issues 30 Supabase requests on the small and medium fixtures
  and 114 on the stress fixture (2.3 MiB), because unlike the desktop open it also loads `step_photos`,
  `step_exploded_views` and `task_videos` for every task (11 batched requests each on 1,100 tasks).

### 5.1 `new-step-draft-autosave` — typing name / instruction / duration in the New Step panel
2. Inputs `:3857-3860`, `:3962-3967`, `:3991-3996` → `scheduleNewStepAutosave` (`~:2047-2058`) → **450 ms**
   → `persistNewStepDraft` (`~:1949-2045`).
3. Task id = `selectedTaskIdRef.current` at persist time (`:1957`); step id from `newStepIdRef` /
   `ensureDraftStepId` (`:1882-1890`). Every task switch goes through `selectTask`, which flushes the
   pending draft **before** changing the selection (`:3277`, `:3296`), so a pending write routes to the
   task being left. `ensureTimedStepDraftPersisted` deliberately swaps `selectedTaskIdRef` around a
   persist for a parked task (`:2789-2801`). No misroute found; correctness rests on ref discipline, not
   on an id captured at keystroke time.
4. `saveMobileStepToSupabase` (`task-store.ts:187-240`): RPC `scenario_project_id`; `tasks` select;
   optional `tasks.upsert(…, {ignoreDuplicates: true})` for a never-saved process; RPC `task_project_id`;
   `manufacturing_steps` select; `update` by id + task_id with **patched fields only**, or `insert` with
   `sequence = max + 1` retried on `23505` up to 3×; if duration changed, select + `tasks.update
   ({planned_duration_minutes})`. Then, if the tool list changed or a prior sync failed,
   `syncStepToolsForStepToSupabase` (`tool-store.ts:51-87`: select, upsert, delete stale — **full-list**).
   Then every draft photo → `uploadStepPhotoAttachment` in parallel (5.5).
5. 5–9 sequential REST calls for the step, +3 for tools, +3–6 per photo. No transaction. Failure after
   the step update leaves the step saved but tools/photos not; the tool sync is remembered in
   `failedDraftToolSyncRef` (`:2037`), the patch in `failedDraftPatchesRef` (`:2038`), photos only in
   local draft state.
6. RLS + advisory RPCs. **No version check on the step update** (`task-store.ts:217-226`); `step.version`
   only refuses re-creating a step deleted elsewhere, `task.version` refuses re-creating a deleted
   process (`:196-199`). Field-level last-write-wins.
7. `saving` at schedule time (`:2053`); `saved` when the queued promise resolves (`:2028`). Failure →
   `error` + message, patch retained (`:2035-2040`); "Retry save" (`:3876`) re-runs the persist. The
   IndexedDB draft is cleared only after success and only when no other local write is in flight
   (`:2024-2027`).
8. **Survives reload:** IndexedDB database `buildlogic-mobile-drafts`, store `drafts`, **single fixed
   key** `mobile-new-step-draft-v1` (`:82-84`, `saveMobileNewStepRecoveryDraft :587-604`) — not
   project- or user-scoped; written on every schedule (`:2051`) and in persist (`:1967`). On load the
   draft is re-applied and re-saved after 250 ms (`:1707-1761`) only if `draft.taskId` exists in the
   loaded project (`:1716`); a draft from another project is neither restored nor cleared. Session UI
   state (selected task, open form, step id, timers) survives in
   `localStorage["pulse:mobile-capture-session:<projectId>"]` (`:246-248`; written `:1118-1136`; flushed on
   `pagehide` `:1138-1160`; legacy key `pulse:capture-timer:<projectId>` read then removed, `:250-252`).
9. A concurrent desktop edit of the same step: only the phone's changed fields are patched
   (`task-store.ts:208-212`); the "idle draft adopts remote changes" effect (`:1349-1363`) reloads the
   form from the refetched step when nothing is pending. The step tool list is **full-list
   replacement**: a stale phone list deletes a tool another device added. Older clients behave
   identically (no protocol or version gate anywhere).
10. `src/components/mobile-photo-portal.test.tsx:64-137` (mocked facade; call counts/args and UI text);
    `src/domain/supabase-planner.mobile-step.test.ts:47-73` (scripted client; asserts write list and
    fixture rows). Nothing covers tool-sync-after-step-failure or the photo leg.

### 5.2 `new-step-tools` / `new-step-checks` / `new-step-photos` — draft panel sub-edits
2. `:3115-3126`, `:3128-3133`, `:3199-3205`, `:3207-3227`, `:3229-3234`; all call `persistNewStepDraft`
   immediately (no debounce). 3–9 as 5.1. `removeNewStepDraftPhoto` only drops the photo from the
   snapshot and re-upserts the rest (`:3230-3233`); it never soft-deletes a `step_photos` row already
   written by an earlier persist, so that row and object stay live and reappear on refetch
   (**code-derived**). 10. None specific.

### 5.3 `step-save-and-next` — "Save & add next"
2. `goToNextManufacturingStep :3236-3274` → `persistNewStepDraft(snapshot, {onSaved})`; `onSaved` fires
   only if the selected task and draft step are unchanged (`:2029`), then a fresh draft id is opened
   (`:3264-3272`). A running lap overwrites `durationText` first (`:3244-3252`). 7. Failure keeps the
   draft open (`:2032-2040`); tested `mobile-photo-portal.test.tsx:88-107`.

### 5.4 `existing-step-inline-edit` — name / duration / instruction / checks on an expanded saved step
2. Blur handlers `:4114-4126`, `:4159-4165`, `:4303-4308`, checks `:4335` → `updateManufacturingStep
   :2583-2589` → `updateManufacturingStepOnTask :2591-2616` → `persistTargetedState` + task queue.
4. `saveMobileStepToSupabase` with the field patch only (`:2602-2612`).
5. 4–7 sequential calls; no transaction. Local state updated optimistically **before** the write
   (`:2060-2063`) and **not rolled back** on failure; patch retained (`:2607`).
6. As 5.1. 7. `saving` → `saved` / `error` (`:2064-2074`); "Retry save" (`:3783`,
   `retryFailedStepSaves :2553-2581`) replays every retained patch, re-syncs tools if flagged and
   re-upserts all photos of that step. 8. Memory only. 9. Field-level LWW; a duration change also
   rewrites `tasks.planned_duration_minutes` from the server's step rows (`task-store.ts:234-238`).
10. `mobile-photo-portal.test.tsx:108-123`.

### 5.5 `photo-upload-existing-step` — Camera / Upload on a saved step
2. File inputs `:4229-4249` → `handlePhotoFiles(stepId, files) :2421-2456`. 3. `taskId = selectedTask.id`
   at call time (`:2425`); `activeProjectContext` (`:993`) supplies workspace/project ids for the path.
4. `buildPhotoAttachment` (`:647-676`: canvas JPEG, max edge 1280, quality 0.72) then
   `uploadStepPhotoAttachment` (`media-store.ts:140-205`): RPC, storage upload to
   `workspaces/<ws>/projects/<p>/tasks/<t>/steps/<s>/<photoId>.jpg` (`media-storage.ts:259-275`), signed
   URL, WebP thumbnail upload, signed URL, `auth.getSession()`, `step_photos.upsert` with
   `deleted_at: null` (`media-store.ts:96-137`).
5. 5–7 sequential calls per photo, photos in **parallel** (`:2434-2436`); not transactional (an object
   can exist without a row). Not on the task queue, so concurrent with 5.1/5.4 writes.
6. RLS + storage policy; no version. 7. Optimistic data-URL insert (`:2432`), swapped on success
   (`:2437`), **rolled back** on failure (`:2440-2447`); no retry; the compressed file is lost on failure.
8. Memory only. 9. Upsert by photo id, idempotent per id.
10. `supabase-planner.media-tools.test.tsx:61-104` (scripted). No component test.

### 5.6 `photo-remove` / `photo-restore`
2. `:4272` → `requestRemovePhoto :2492-2502` → `removePhoto :2458-2490`; prompt → `restoreDeletedPhoto
   :2112-2128`. 4. Remove: `softDeleteStepPhotoAttachmentFromSupabase` (`media-store.ts:36-42`), storage
   objects kept. Restore: `uploadStepPhotoAttachment` metadata-only branch (`media-store.ts:146-151`) →
   `step_photos.upsert(… deleted_at: null)`. 5. 2 and 3 calls. 6. RLS; no version. 7. Remove: optimistic,
   rolled back on failure (`:2481-2487`). Restore: optimistic re-add, **no rollback** (`:2114`,
   `:2121-2124`); the restore prompt is memory only. 8. Memory only. 9. LWW on `deleted_at`.
10. `media-tools.test.tsx:105`. No test for restore-by-upsert.

### 5.7 `step-tool-add` / `step-tool-remove` (saved step, library picker)
2. `renderToolPicker` bindings `:4318-4320` → `:2504-2530`, `:2532-2551`. 4. `addStepToolToSupabase` /
   `removeStepToolFromSupabase` (`tool-store.ts:26-52`), deterministic id `tool-<step>-<name>`. 5. 2 calls
   each, on the task queue. 6. RLS; idempotent per id. 7. Optimistic (`:2512`, `:2539`); **no rollback**.
8. Memory only. 9. Per-row writes are safe, but the next 5.1 persist with `syncTools` or
   `retryFailedStepSaves` replaces the step's full list from the phone copy (`:2012-2013`, `:2565-2567`).
10. `media-tools.test.tsx:153`.

### 5.8 `process-add`
2. `addHighLevelTask :2146-2222`. 3. WBS = max top-level + 1 (`:508-516`); id `task-<Date.now()>`
   (`:2163`) — millisecond collision across devices is possible (**unverified**). 4. `saveTaskToSupabase`
   → `saveTasksToSupabase` (`task-store.ts:108-116`): RPC, `tasks.upsert(taskRow)`, `syncStepToolsForTasks`
   (nothing to write for a new task). 5. 3 calls on the task queue. 6. RLS; no version. 7. Optimistic,
   **rolled back** on failure (`:2209-2211`); tested `mobile-photo-portal.test.tsx:138-147`. 8. Memory
   only. 9. Two devices adding simultaneously can create duplicate WBS (no client uniqueness; schema
   constraint not verified). 10. Plus `task-writes.test.tsx:62-127`.

### 5.9 `process-rename`
2. Name blur `:3811-3819` → `updateTask :2130-2144`. 4. `saveTaskToSupabase` = **full `taskRow` upsert** of
   the phone's copy (every planning column, station/zone, status, dates, custom_fields) +
   `syncStepToolsForTasks` (full-list for tasks with ≥1 tool). 5. 3–5 calls; not transactional. 6. RLS;
   **no version check**. 7. Optimistic, no rollback. 8. Memory only. 9. **Whole-row LWW**: a stale phone
   rename overwrites desktop planning edits made since the phone's last refetch and resets the task's
   tool list to the phone copy. 10. `task-writes.test.tsx:63-108` (request order only).

### 5.10 `process-reorder` (drag handle)
2. `:2378-2419` → `persistHighLevelTaskReorder :2224-2345`. 3. New WBS/zone/station for every task in the
   affected groups (`:2283-2301`); only changed tasks written (`:2302-2312`). 4. Two `saveTasksToSupabase`
   calls: first with `wbs: tmp-<token>-<n>`, then the final rows (`:2340-2343`); each = N parallel RPCs,
   one full-row `tasks.upsert`, one `step_tools` select + optional full-list sync. 5. 2 × (N + 3) calls.
   **If the second call fails, the database keeps `tmp-…` WBS values** while local state already shows
   the final order (`persistTargetedState` sets state first, `:2061-2062`); a reload shows the `tmp-`
   codes. Confirms `docs/tool-catalog-consistency-design.md` §5b limitation 4 and the plan's stated
   risk. 6. RLS; no version. 7. No rollback, no retry; drag refused while `saveState === "saving"`
   (`:2378-2380`). 8. Memory only. 9. Multi-task full-row LWW. 10. **None** (no test references `tmp-`).

### 5.11 `process-delete` (swipe → Delete process)
2. `requestDeleteProcess :2946-2975`. 4. `deletePlannerTask` (`task-store.ts:485-510`): RPC; 3 parallel
   selects of storage paths; `tasks.delete()` (FK cascades remove steps, tools, photos, parts, events,
   dependencies); best-effort `storage.remove` on both buckets (`media-storage.ts:303-315`, logged never
   thrown). 5. 6 calls; the row delete is the single atomic point. 6. RLS; no version, no edited-since
   check. 7. Local removal **after** success (`:2957-2962`); failure keeps the row (tested
   `mobile-photo-portal.test.tsx:45-63`). 8. Irreversible; no restore prompt. 10. `task-writes.test.tsx:217-253`.

### 5.12 `step-delete` (expanded step → Delete)
2. `:4176` → confirm `:4202` → `deleteManufacturingStep :2857-2903`. 3. Remaining steps renumbered
   locally (`:2871-2873`); step-scoped photo/tool maps stripped from `customFields` (`:2874`, `:483-507`).
4. `saveTaskWithManufacturingStepsToSupabase` (`task-store.ts:160-185`): RPC; **full `tasks.upsert`**;
   select step ids; `bumpManufacturingStepSequences` (N parallel updates parking every step at ≥100001);
   `manufacturing_steps.upsert` of **all remaining steps from the phone copy**; `delete().in(staleIds)`;
   `syncStepToolsForTask(allowEmptyWipe: true)` (full-list, task-wide). Then fire-and-forget
   `softDeleteStepPhotoAttachmentFromSupabase` for the deleted step's photos (`:2893`) — those rows were
   already cascaded by the step delete (`20260515163000_…sql:32`), so the updates match 0 rows and the
   storage objects remain.
5. 6 + N sequential calls; no transaction. Failure between park and upsert leaves every step of the task
   at a parked sequence while the phone shows 1..n (self-heals only if a later save succeeds).
6. RLS; **no version check**. 7. Optimistic, no rollback; a "Restore Step" prompt follows regardless of
   outcome (`:2894-2901`). 8. Memory only (the restore snapshot is a closure). 9. **Sibling steps are
   rewritten from the phone copy** (confirms `docs/restore-step-design.md` §1 "Delete A2") and the task
   tool list replaced task-wide. 10. `task-writes.test.tsx:152-178` (request order). No component test.

### 5.13 `restore-deleted-step-snapshot` — "Restore Step"
2. Prompt `:3476` → `restoreDeletedSnapshot(previousState, taskId) :2080-2110`. 3. **Scope is the whole
   scenario**: the snapshot is the entire pre-delete `PlannerState`.
4. `savePlannerStateToSupabase(snapshot)` (`shell-store.ts:104-230`), then `uploadStepPhotoAttachment` for
   **every photo of every step of every task** (`:2092-2101`).
5. 6 parallel existence reads; tripwire ×6; parent upserts; `tasks.upsert` (all tasks, full rows); RPC
   `replace_task_children` (`20260601128000_replace_task_children_rpc.sql:33-37`: deletes **all**
   `task_dependencies`, `manufacturing_steps`, `part_references`, `actual_events` of every task in the
   scenario and re-inserts the snapshot's copies; `step_tools`, `step_photos`, `step_exploded_views` go
   by FK cascade and are **never re-inserted**); `custom_columns`; stale deletes. Then N photo metadata
   upserts via `Promise.allSettled` (`:2099`) — **rejections are swallowed and the status still becomes
   `saved`** (`:2102`). Everything before a failing request persists; after the RPC, tools and exploded
   views are already gone. The RPC itself is atomic.
6. RLS; the only guard is the deletion tripwire. No version checks; all task versions bump.
7. Optimistic whole-state replacement, no rollback, no retry. 8. Memory only.
9. **Scenario-wide LWW**: reverts every teammate edit since the phone's last refetch and wipes all step
   tools and exploded views in the scenario. Confirms `docs/restore-step-design.md` §1,
   `docs/workspace-structure-handoff.md` item 2 and `docs/correctness-scope.md` §3 item 3. The isolated
   `delete_manufacturing_step` / `restore_manufacturing_step` RPCs are referenced nowhere in `src/`.
10. `supabase-planner.save-order.test.ts:85-96` pins request order (mocked). Nothing tests
    `restoreDeletedSnapshot` or its stored outcome.

### 5.14 `capture-timer` — Start / Stop / lap / park / resume
2. `startCaptureTimerForCurrentTask :3056-3098`, `stopCaptureTimer :3100-3113`, `openCaptureTaskFromHeader
   :3341-3348`, `applyLapForTimerState :2618-2650`, `parkTimedCaptureForTask :2689-2707`,
   `restoreParkedTaskCapture :2719-2741`, `ensureTimedStepDraftPersisted :2769-2802`,
   `advanceCaptureTimerLap :3042-3054`. 3. The timer carries `taskId`, `activeStepId`, `taskName`
   (`:153-161`); Stop applies the lap to the timer's own ids (`:2628-2629`). 4–7. Database writes are
   exactly those of 5.1 / 5.4 (`elapsedMinutesFromTimer` rounds up to ≥1 min, `:148-150`); timer state is
   **not** stored in the database. 8. Timer, parked timers and draft field copies survive in
   `localStorage["pulse:mobile-capture-session:<projectId>"]` (`:348-391`, `:1071-1136`); running timers
   resume from stored elapsed (`:1109-1116`, `:1621-1630`). 9. Resuming a parked timer overwrites the form
   from the parked client-side copy, not the server (`:2709-2717`). 10. **None.**

### 5.15 `annotation-save` — StepPhotoViewer markup (desktop mount)
2. `updateAnnotations` (`step-photo-viewer.tsx:591-600`) → `persistAnnotations` (`:575-589`: localStorage
   draft, 350 ms debounce) → `flushPendingAnnotations` (`:552-573`) → `onUpdatePhoto`; flushed on photo
   change (`:753-754`), unmount (`:922-926`), `pagehide` / `beforeunload` (`:793-803`). 3–7. See §3.4.
8. `localStorage["pulse:photo-annotation-draft:<taskId>:<photoId>"]` holding `{base, local}`, re-applied
   **only when that photo's viewer reopens** (`:753-762`). 10. `step-photo-viewer.lifecycle.test.tsx:70-127`
   (real localStorage), `step-photo-viewer.test.tsx:241`, `supabase-planner.photo-annotations.test.ts:21-33`.
   Viewer non-writes: download/print local; copy/paste buffer in memory (`:516`, `:2054-2058`);
   `useRecoveringPhoto` only re-signs URLs. No caption-edit path exists (`updateStepPhotoCaptionInSupabase`
   has no caller).

### 5.16 Timers and effects that write (mobile)
| Timer / effect | Writes | Cleanup |
|---|---|---|
| `newStepAutosaveTimerRef` 450 ms (`:2052-2056`) | Supabase (5.1) + IndexedDB | Cleared on task switch/close; **not cleared on unmount** (`:1343-1347` clears only motion timers). A pending autosave fires after navigating away and writes to the task it was scheduled for. |
| Draft-restore `setTimeout` 250 ms (`:1755-1758`) | Supabase (5.1) | Not cancelled on unmount; once per mount (`draftRestoreAttemptedRef`). |
| Session snapshot effect (`:1071-1136`) + `pagehide` (`:1138-1160`) | localStorage session key | Listener removed; writes on every change of its 7 deps. |
| 1 s tick (`:1162-1169`) | none | cleared |
| Remote refresh timers 350 / 250 ms | reads only | cleared in realtime cleanup (`:1786-1800`) |
| `enqueueTaskScopedWrite` chains (`:1851-1865`) | Supabase | survive unmount by design |
| Viewer `saveTimerRef` 350 ms (`step-photo-viewer.tsx:589`) | parent save queue | flushed on photo change / unmount / pagehide |

The "adopt remote changes into idle draft" effect (`:1349-1363`) overwrites draft inputs from
`plannerState` whenever nothing is pending; a keystroke in the same tick as a refetch could be lost
(**unverified**, not tested).

### 5.17 Mobile test coverage
`mobile-photo-portal.test.tsx` mocks the facade and covers 5.1, 5.3, 5.4, 5.8, 5.11 via call counts and
rendered text. **No tests** exist for 5.5–5.7, 5.9, 5.10, 5.12, 5.13, 5.14, the localStorage session or
the IndexedDB draft (no test under `src/**/*.test.*` or `e2e/` mentions `Restore Step`, `tmp-`,
`mobile-capture-session`, `buildlogic-mobile-drafts` or `Start timer`). Saver tests are scripted-client
(`mobile-step.test.ts`, `media-tools.test.tsx`, `task-writes.test.tsx`, `photo-annotations.test.ts`);
none hits a real database. **Updated after B2 (2026-10-04):** one browser test now covers a mobile route — `e2e/mobile-recovery-draft.spec.ts` drives the New Step draft (save, overwrite, reload recovery, clear of the IndexedDB record) on the isolated database; it does not cover 5.5–5.7, 5.9, 5.10, 5.12, 5.13 or 5.14.

---

## 6. AWI (assembly work instructions)

AWI masters are ordinary planner projects (`projects.is_awi_master = true`) with one station and one task
(`create_awi_master`, `20261003013548_awi_master_authoring.sql:26-58`). The editor is the planner
`LineWorkspace` with `awiMaster` set (`app/awi/[masterId]/page.tsx:17`, `line-workspace.tsx:412-418`), so
every AWI edit path is a planner path (§3–§4) with one fork: the procedure save detects
`customFields.awiDocumentNumber` and uses the `save_awi_procedure` RPC (`task-store.ts:470`).

### 6.1 `awi-create` — "Add AWI" → "Create draft"
2. `awi-directory.tsx:48-56`. 3. `workspaceId` prop (`app/awi/(directory)/page.tsx:9-15`). 4. `createAwiMaster`
   (`src/lib/awi/store.ts:20-26`) → RPC `create_awi_master` then an `awi_masters` read. 5. 2 sequential
   requests; the RPC is one transaction (project via `create_project_with_starter_plan`, station, task,
   first step at sequence 10, `awi_masters` row). A failed follow-up read leaves the master created with
   the message "Your AWI was created but could not be opened…" (`store.ts:25`). 6. RPC checks `auth.uid()`
   and `has_workspace_role(owner|admin|editor)`; number allocation serialized by `pg_advisory_xact_lock`
   (`:39`). 7. `pending` flag, `role="alert"` errors, no retry. 8. Memory only. 9. Duplicate numbers
   prevented by the lock + `AWI-NNNN` max + 1 scan. 10. `awi-directory.test.tsx`; `e2e/awi.spec.ts:31-46`;
   pgTAP `awi_master_test.sql` (**stored outcome**).

### 6.2 `awi-step-field-edit` — typing in a step's name or instruction
2–3. `procedure.tsx:626-661` → `updateProcedureStepField` (`use-procedure-save-queue.ts:225-259`); scope
   captured at schedule time (§3.1).
4. Same queue as §3.1 → `saveProcedureTaskUpdateToSupabase` AWI branch (`task-store.ts:470-497`) →
   `saveAwiProcedure` (`src/lib/awi/procedure-store.ts:8-15`) → RPC `save_awi_procedure`
   (`20261003180653_atomic_awi_procedure_save.sql`) touching `tasks`, `manufacturing_steps`,
   `part_references`.
5. **1 request** when `scope.projectId` is set (the queue always passes it, `use-procedure-save-queue.ts:322`).
   Single transaction, SECURITY INVOKER, locks task + children `FOR UPDATE` in id order. Nothing partial
   can persist.
6. RPC verifies `auth.uid()`, `has_project_access(edit)`, master membership, exact patch keys (`name,
   description, safety_notes, planned_duration_minutes, custom_fields`) and the document number; compares
   `p_expected_version` to `tasks.version`, `p_expected_step_versions` to live step versions and
   `p_expected_parts` to live parts, raising `40001` on mismatch. **Idempotent replay:** when the live
   content already equals the payload the RPC returns the current snapshot without bumping versions, so a
   committed save whose response was lost can be retried. The client maps `40001`/`23505` to the conflict
   message (`procedure-store.ts:11-13`); the queue treats "conflict" as terminal (`:325, 357`).
7. As §3.1; visible label `AwiSaveStatus` (`awi-editor-actions.tsx:5-10`: "Save pending — keep this draft
   open" for error/retrying, "Conflicting edit…" for conflict). An acknowledgment must be a full
   `{task, steps, parts}` or the client refuses to mark saved (`task-store.ts:480-483`).
8. Only `instruction` / `name` drafts in `localStorage` `buildlogic-line-planner-procedure-draft-v1:<projectId>`
   (§1); IndexedDB cache written only after a confirmed save or load.
9. The other device's commit wins; this client shows the conflict with its draft intact
   (`e2e/awi.spec.ts:387-414`). An older client sending extra patch keys fails with `22023`.
10. `use-procedure-save-queue.test.tsx:100-414`, `supabase-planner.awi-save.test.ts:32-72`,
    `src/lib/awi/procedure-store*.test.*`, `procedure-autosave-harness.test.tsx`; pgTAP
    `awi_procedure_save_test.sql` (**stored outcomes**: lost-ack retry, conflict keeps the other edit, reorder
    preserves photo/tool rows, only confirmed removals applied, 1,203-step ack); browser
    `e2e/awi.spec.ts:143-169, 278-305, 362-438` (durable rows via `pg`).

### 6.3 `awi-structure-edit` — add / remove / reorder step, duration, checks, parts, part mentions, title
2–4. `procedure.tsx:422-445, 525-600, 640-661`; title `:823-840` → `updateProcedureTask` → same saver
   as 6.2 (parts via `p_parts` / `p_expected_parts`). The task name reaches `tasks.name` only for masters
   (`row-mappers.ts:617-625`); `awi_masters.title` and `draft_updated_at` are synced by trigger
   `private.awi_mark_draft` (`20261003013548:62-77`). 8. **Not** persisted locally: these edits live in
   `queue.pendingTaskSnapshot` until confirmed; a reload between the edit and its save loses it
   (`beforeunload` guard while `hasLocalSaveWork`, `use-workspace-saves.ts:355-361`). A customFields-only
   patch does **not** schedule a save unless photo annotations changed (`line-workspace.tsx:1922-1946`).
10. e2e `:67-69, 278-305, 348-360`; pgTAP reorder/removal assertions.

### 6.4 `awi-step-tool-add` / `-remove`
Same as §4.3 (`use-workspace-tools.ts:108-145`, `tool-store.ts:32-57`). The in-memory `stepToolLists`
patch does not schedule a procedure save, and the RPC excludes `stepToolLists` when comparing
`custom_fields`. Whether `customFieldsRow` strips `stepToolLists` from the outgoing patch: **unverified**.
Tracker key `tool:<step>:<key>`; a failure stays in the tracker until a later success with the same key
and forces status `error` (`workspace-save-status.ts:33-50, 97`). Tests: `e2e/awi.spec.ts:72-141` (status
waits for both writes in either order; a failed tool write is not hidden by a successful procedure save),
`use-workspace-tools.persistence.test.tsx:173-223`.

### 6.5 `awi-step-photo-upload` / `-remove` / `-paste`, video / exploded-view delete
Same as §4.4–§4.6. A missing signed URL after the row is saved throws "The photo was saved, but a signed
URL could not be created" (`media-store.ts:192-195`). Tests add `e2e/awi.spec.ts:228-276` (failed deletion
restores the control; a concurrent instruction edit is preserved).

### 6.6 `awi-release` — Work Instructions → Release → "Release Rev X"
2. `setup-panels.tsx:532-550` → `work-instruction-control.tsx:572-588`. 4. `releaseWorkInstruction`
   (`src/lib/work-instruction/store.ts:160-200`): `freezePhotos` (storage copies in `step-photos`) →
   `work_instruction_releases` insert `.select().single()`; on failure the copied objects are removed
   (`:193-197`). Trigger `private.awi_publish_release` sets `awi_masters.published_at /
   published_release_id` (`20261003013548:79-87`); the DB assigns revision letter, releaser, timestamp.
5. N storage copies (count unverified) + 1 insert, sequential; the insert is atomic with its trigger.
6. Client: `onBeforeRelease` (`line-workspace.tsx:3477`) → `ensureSavedBeforeScenarioAction`
   (`use-workspace-scenarios.ts:116-135`: confirmed remote state, shell flush, 12 s settle barrier);
   `reloadControl` must succeed ("Unknown history must never be treated as an empty revision list",
   `setup-panels.tsx:540`); readiness reasons; confirm dialog. Whether any trigger validates `content_hash`
   against the current draft rows: **unverified**. 7. `busy === "release"`; notice "Released as Rev A."
8. Memory only. 10. `e2e/awi.spec.ts:307-346`; pgTAP `work_instruction_control_test.sql`.

### 6.7 `awi-reference-add` / `-remove`
`work-instruction-control.tsx:394-395, 370` → `addWorkInstructionReference` (projects read → optional
upload to `wi-reference-files` → `work_instruction_references` insert; failure removes the upload),
`removeWorkInstructionReference` (row delete, best-effort object remove). RLS only; no version; memory
only. Tests: **unverified** (none found).

### 6.8 AWI cross-cutting
- "Saved" waits for tool **and** procedure writes because `workspaceSaveStatus`
  (`workspace-save-status.ts:89-107`) folds the tracker snapshot and the queue records; any tracker
  failure or queue `lastError` wins over later successes. Verified end-to-end by `e2e/awi.spec.ts:72-141`.
- Scope-exit flushes debounced saves rather than dropping them (`use-procedure-save-queue.ts:569-577`);
  background-scope results never report into the visible status (`:273, 310`).
- The destructive shell save is still reachable inside an AWI master through catalog rename/delete
  (`use-workspace-tools.ts:151-217`), gated on `remoteStateConfirmedRef`.

---

## 7. SOP editor and review surfaces

### 7.1 `sop-autosave` / `sop-save-and-close` / `sop-retry`
1. Every field edit calls `update()` (`sop-editor.tsx:867-875`: bumps `editVersionRef`, sets `dirty`,
   status `idle`); autosave effect `:1217-1228` with **`AUTOSAVE_DELAY_MS = 2000`** (`:194`), armed only
   when `canEdit && !submittingForApproval && !requestingFinalApproval && workspaceId && dirty &&
   !conflicted && selectedDept && saveStatus === "idle"`; "Save & close" `:2592` → `:1263-1267`; "Retry"
   `:2046` → `persist()`.
3. `workspaceId` prop (SOP workspace provider / cookie), `sop.id`, `deptId` (first save only), user id via
   `getUserFromSession` (no network, `src/lib/sop/store.ts:232`).
4. `persist :911-947` → `runSave :975-1021` → `saveSop` (`store.ts:230-330`): existing SOP = one guarded
   `sops` UPDATE `.eq("id").eq("updated_at", expectedUpdatedAt).is("deleted_at", null).select(...).maybeSingle()`
   (`:258-271`); first save = INSERT (`:276-288`) with `sop_number` forced empty (`sop-editor.tsx:981-987`).
   The whole document is written as one jsonb `document` plus promoted columns including `status`
   (`:242-252`).
5. **1 request**; the INSERT primary-key-collision recovery adds a read + guarded UPDATE (`:299-325`).
   Atomic per row.
6. **Persisted version token** = `persistedUpdatedAtRef` (`:437-438`), the `updated_at` string, advanced
   synchronously from the save response before any awaiting click resumes (`:992-994`); zero rows →
   `SopConflictError` → `conflicted = true` freezes autosave (`:1012-1015`); "Reload latest" (`:2032-2041`)
   replaces local state (`:1024-1055`). Post-save merge: if `editVersionRef.current === sopEditVersion`
   adopt the server copy, else keep local edits and fold in `updatedAt` only (`:995-1008`). Server:
   RLS `sops workspace update` (`20260710120000_sop_rls_definer_fixes.sql:67-85`), trigger
   `sops_ab_department_content_edit` (`20260715122000:70-100`, other department's draft is view-only),
   `sops_enforce_transition` (fires on every update), `sops_aa_set_content_hash`, `sops_set_updated_at`
   (so the token always moves server-side). Note: the token is the `updated_at` timestamp compared with
   `.eq()`, **not** the `sops.version` column, which is the document revision label (`store.ts:245`).
7. `SaveStatus = idle | saving | saved | error` (`:184`). Serialization: `saveInFlightRef` + `inFlightSaveRef`
   so a click awaits the running save then issues exactly one fresh save (`:918-927`). A failed non-conflict
   save waits for Retry or the next edit; `beforeunload` while dirty (`:1204-1212`); in-app `confirmLeave`
   (`:1252-1261`).
8. **Nothing survives a reload locally** — no draft storage for SOP content (`pulse:sops:v1` is a legacy
   read-only import key, `store.ts:20, 367-377`); only the workspace selection cookie / localStorage
   (`workspace-cookie.ts`, `sop-workspace-provider.tsx:24, 85`).
9. The `updated_at` compare makes the second writer conflict. The write is a **full-document replace**,
   so a client whose token is still valid overwrites fields it never saw inside its own token window
   (no field-level merge). Older clients lacking `linkedSops` / `referenceDocs` are normalized on read
   (`store.ts:122-123`).
10. `src/lib/sop/store.test.ts:88-142` (collision recovery, conflict, error pass-through — mocked order).
    **No test of `persist()`'s serialization / edit-version logic** (no `sop-editor.test.*`). pgTAP
    `sops_enforcement_test.sql`, `sop_authz_test.sql`, `sop_rls_test.sql`, `sop_tenancy_test.sql` (DB rules).

### 7.2 `sop-annex-upload`
`handleAnnexUpload :1057-1097`: `persist()` first if the annex row is unsaved; `uploadSopAnnexFile`
(`annex-files.ts:82-165`): read → storage upload (`upsert: false`) → `sop_annex_files` upsert on
`(sop_id, annex_id)` → re-read the winner → remove the losing object. 4–5 sequential requests (+1 save);
a row failure removes the uploaded object (`:160-163`). Trigger `sop_annex_files_scope`
(`20260715124000:75-95`); policies `:103-170`. Phased status, no retry; memory only until the row commits.
Tests: `annex-files.test.ts:86-211` (mocked order).

### 7.3 `sop-annex-file-remove` / `-row-remove` / `-rename`
`:1113-1121`, `:1188-1202`, `:2273-2276`, `:3268-3278` → `removeSopAnnexFile` (`annex-files.ts:176-190`: row
delete then best-effort object remove), `renameSopAnnexFile :167-174`. Row removal then `update({annexes})`:
the file row is gone immediately while the document change waits for the 2 s autosave; **a failed autosave
leaves the file deleted and the annex row still in the document** (code-derived).

### 7.4 `sop-reference-doc-upload` / `-remove` — `:1123-1151`, `:1172-1186`; same saver and caveats as 7.2/7.3.

### 7.5 `sop-roster-seat-add` / `-remove` / `-signer-change`
`sop-roster-editor.tsx:174, 208, 259, 268, 315` via `guarded :138-148` (single `busy` key). `upsertSeat`
(`review.ts:491-505`, `sop_review_seats` upsert on `(sop_id, department_id)`, `rasic` fixed to
`responsible`), `removeSeat :526-531`. 1 request each. RLS + trigger `sop_review_seats_freeze`
(`20260710121000:108-140`) and `a_sop_review_seats_staffed_on_submit` (`20260715130000:21-28`). No version;
memory only. Tests: `sop-roster-editor.test.tsx:68-459` (mocked); pgTAP `sop_seats_test.sql`.

### 7.6 `sop-approver-invite` (author-nominated reviewer)
`reviewer-invite-form.tsx:26-31, 58-59` → `POST /api/sops/approvers/stage` (§8 W7) → RPC
`stage_sop_approver`; then `upsertSeat` when seatable (`sop-roster-editor.tsx:160-176`). Delivery happens
in 7.7. Tests: `reviewer-invite-form.test.tsx`; pgTAP `reviewer_nomination_test.sql`.

### 7.7 `sop-send-for-review` (`handleStartApproval :1427-1525`)
Sequence: `persist()` → `getSopControl` → [already `in_review`: optional
`submitSopWithApproverInvitations`] → [all reviewers responded, no open remarks: `sendSopForSignatures`] →
otherwise `getUserFromSession`, `listSignatures`, `signSop(id, "authorship")` (`review.ts:284-305`, RPC
`sign_sop`) → `getSopControl` → `submitSopWithApproverInvitations` (`review.ts:731-740` → `POST
/api/sops/approvers/submit`, §8 W8) or `transitionSop(id, "in_review", updatedAt)` (`review.ts:565-593`,
guarded UPDATE). Up to ~7 sequential requests, **not one transaction**: the authorship signature can
commit while the transition fails; the catch re-reads control and adopts `in_review` if it happened
(`:1507-1516`). DB gates: `enforce_sop_transition` (patched in place — 12 migrations use
`pg_get_functiondef`), staffed-seat trigger, `expectedUpdatedAt` compare client-side and inside the route.
Client gates: `submittingForApproval` blocks re-entry and disarms autosave (`:1218`); pre-checks
(`:1429-1440`). Errors → `saveError`; "Retry invitations" (`:2018-2027`) for partial delivery;
`kickSopNotifications()` (`notify-kick.ts:18-27`, fire-and-forget) after every lifecycle write. Memory
only. Tests: `review.test.ts:39-49` (mocked), pgTAP `sop_review_flow_test.sql`, `sops_enforcement_test.sql`,
`sop_cycle_test.sql`, `reviewer_nomination_test.sql`. **No component test of `handleStartApproval`.**

### 7.8 `sop-request-final-approval` (`:1407-1425`)
`sendSopForSignatures` (`review.ts:720-723`, RPC `send_sop_for_signatures(p_expected_hash, p_expected_cycle)`)
→ `syncSignatureRequestControl :1396-1405`. 1 RPC transaction + reads; the DB raises for missing approvers
or unaddressed remarks (`20260921230000:131-154`). The sibling `requestSopFinalApproval`
(`review.ts:165-169`) has no production caller.

### 7.9 `sop-mark-remark-addressed` (`:1363-1386`)
`persist()` (when resolving) → `resolveSopReviewAnnotation` (`review-annotations.ts:212-219`, RPC) →
re-list. Two writes in sequence; **a failed RPC after a successful save leaves the remark open**.

### 7.10 `sop-start-controlled-change` (`:1317-1361`)
`getSopControl` → `transitionSop(id, "draft", updatedAt, {revisionReason, changeSignificance})` → `getSop`
→ state reset. Gate D fields enforced by `enforce_sop_final_approval_fields` (`20260921230000`).

### 7.11 `sop-auto-recall-to-draft` (effect `:1285-1315`) — **an automatic write from a render effect**
When the author opens an `in_review` SOP whose `reviewGate.canMakeChanges` is true, the editor itself
runs `transitionSop(sop.id, "draft", latest.updatedAt)` once per `${sop.id}:${reviewCycle}`
(`feedbackUnlockAttempt` ref) and advances the token; failure → status `error` "Could not enable editing.
Reload to retry." This is a client effect, not an RSC render, so it does not violate the server-read rule,
but it is the only edit in the inventory that fires without a user action.

### 7.12 Reviewer: `sop-review-remark-save` / `-delete` / `sop-review-submit`
`sop-review-workspace.tsx:269` → `saveSopReviewRemark` (`review-annotations.ts:191-204`,
`sop_review_annotations` insert; `created_by` / `review_cycle` stamped by trigger); `:222` →
`deleteSopReviewAnnotation :206-210`; `:192` → `submitSopReviewResult :138-147` (RPC `submit_sop_review`).
`commentSavingRef` prevents double submits; draft text retained on failure. Tests:
`sop-review-workspace.test.tsx:35-119` (mocked), pgTAP `sop_review_flow_test.sql`.

### 7.13 `sop-comment-reply` / `sop-author-response`
`sop-review-comment.tsx:26-29` → `addSopCommentReply` (`review-annotations.ts:226-234`: `sop_comment_replies`
upsert with a **client-generated id** and `ignoreDuplicates`, then read-back — the pending id is kept in a
ref so a retry after a lost response is idempotent); `:36` → `saveSopAuthorResponse :221-224` (update,
trigger `guard_sop_author_response`). Tests: `comment-reply-retry.test.ts`.

### 7.14 Signatures: `sop-dept-sign`, `sop-quality-release`
`sop-final-approval-workspace.tsx:101-124` → `signSopWithMark` (`review.ts:724-729`, RPC
`sign_sop_with_mark(p_hash, p_cycle, department)`). `sop-quality-approval-workspace.tsx:97-130` →
`signSopWithMark(quality)` → `getSopControl` → if `approved`, `transitionSop(id, "effective")`; a
`SopConflictError` is re-read and treated as success if the SOP is already effective. DB: `sign_sop`
content pin (`20260723120000_sign_sop_content_pin.sql:43-46`), seat/assignment guards
(`20261002010000:68-74`). Tests: pgTAP `sop_objections_test.sql`, `sop_quorum_test.sql`; **no component
tests** for these two workspaces.

### 7.15 `sop-remind-reviewer` — `reviewer-remind-button.tsx:45-62` → `remindSopReviewer` (`review.ts:227-242`,
RPC); `inFlight` ref; cooldown error adopts the DB window. Tests: `reviewer-remind-button.test.tsx`; pgTAP
`sop_reviewer_reminder_test.sql`.

### 7.16 List-level: create, convert, import, delete
`sop-new-client.tsx:27, 93-97` renders `SopEditor isNew` (first autosave INSERTs). `sop-list.tsx:413-466`
convert: `uploadConversionSource` → `fetch /api/sops/extract` (§8 W11) → `saveSop` INSERT → best-effort
`upsertSeat` loop → navigate; failure removes the upload. Import `:528`: sequential `saveSop` INSERTs.
Delete `:489`: `deleteSop` soft-delete after a `tasks` where-used count (`store.ts:351-360`), optimistic
removal rolled back on error.

### 7.17 Print / DOCX export — read-only
`handleExport :1527-1545` builds a client-side blob; `export-docx.ts` only fetches `/sop/ana-logo.png`.
No writes in `sop-feedback-panel.tsx`, `sop-margin-notes.tsx`, `sop-detail-client.tsx`.
`sop-print-preview.tsx` was not inspected.

### 7.18 SOP cross-cutting
Double-submit / stale-save guards: `saveInFlightRef` + `inFlightSaveRef` (`:918-927`); render-snapshot
`sopEditVersion` vs `editVersionRef` (`:445, 995`); `persistedUpdatedAtRef` advanced before the promise
resolves (`:992`); `conflicted` freezes autosave; `submittingForApproval` / `requestingFinalApproval`
disarm autosave (`:1218`); roster `busy`; comment `commentSavingRef`; reply idempotent id. **SOP has no
local draft persistence; AWI persists only two step text fields.** Both rely on `beforeunload` for
everything else.

---

## 8. Server routes, integrations and operator scripts

### 8.0 Scope and shared primitives
| Surface | Count | Notes |
|---|---|---|
| `app/api/**/route.ts` | 17 | 11 write (DB / storage / external service), 6 read-only or log-only |
| `"use server"` actions | **0** | `grep -rln '"use server"' src app` is empty |
| Server-component writes | **0 violations found** | the only non-client `.rpc` is the read `is_problem_solving_pilot` (`app/sops/problem-solving/page.tsx:12`, `src/lib/supabase/server-data.ts:162`); `proxy.ts:45,62` rotates **auth cookies** only |
| Supabase edge functions | none | `supabase/functions` absent |
| Vercel cron | 1 | `vercel.json`: `0 13 * * *` → `GET /api/sops/notifications/drain` |
| Operator scripts that can write a database | 18 | §8.4 |
| Planning-space writes | 20 exported functions | all browser-client; none server-side (§8.3) |

- `requireApiUser` (`src/lib/api-auth.ts:42-82`): bearer-first (`:54`); a malformed `Authorization`
  header is rejected rather than falling back (`:56-62`); cookie fallback (`:66`, `cookieScopedSupabase`
  `:85-101`); verified by `auth.getUser(token)` (`:67-69`). Returns a caller-scoped client so RLS is the
  data gate.
- `createApiRateLimiter` (`:107-126`): per-process `Map` (comment `:103-106`) — **in-memory, per
  instance**, verified current.
- `isAuthorizedCronRequest` (`src/lib/sop/notifications-drain.ts:58-66`): `CRON_SECRET` bearer,
  constant-time compare, refuses when the secret is unset.
- Service-role clients are built **inside route handlers only** (e.g. `app/api/invites/route.ts:241`,
  `app/api/webhooks/resend/route.ts:56`, `app/api/sops/notifications/drain/route.ts:42`).

### 8.1 Writing routes
**W1 Password recovery request** — `app/api/auth/password-reset/request/route.ts:58-108` →
`src/lib/auth/password-recovery-request.ts:74-107`. Unauthenticated by design; rate-limited per hashed
email (3 / 15 min) and hashed IP (10 / 15 min) (`route.ts:25-26, 71-75`). Service role:
`auth.admin.generateLink`, Resend send, `transactional_emails` insert. No transaction: a send failure
after the link is minted leaves a failed ledger row and an undelivered token (`lib:103-104`); ledger
failures never throw (`transactional-log.ts:33-36`). Same "accepted" body for unknown accounts. Tests:
`route.test.ts` (8 cases, mocked) + `password-recovery-request.test.ts`.

**W2 Local backup start** — `app/api/backups/route.ts:38-50` → `src/lib/backup/local.ts:45-62`. **No
database write**: writes `backups/local/<id>.json` and spawns `scripts/backup/worker.mjs` detached.
Gates: `requireApiUser` → `is_super_admin` → `localOnly` (non-production + localhost) → same-origin →
limiter 2/min → readiness → single running backup. Tests: `route.test.ts` (5 cases).

**W3 Workspace invitation** — `app/api/invites/route.ts:47-321`. Caller client (RLS):
`workspace_revocations` delete (`:183-190`), `workspace_access_grants` upsert on (workspace, email)
(`:192-215`). Service role: `generateLink` / `inviteUserByEmail` / `resetPasswordForEmail`, Resend send,
`transactional_emails`. **No transaction**: on email failure the grant exists and the response says
`granted: true, emailSent: false` (`:234-238, 266-271`; documented at `:40-46`). Limiter 20/min;
`has_workspace_role(owner|admin)` pre-check, owner-only for admin invites. Idempotency key is per
request (`invite-delivery.ts:104`), so a double-click sends twice. Membership is minted later by
`redeem_workspace_access_grants()` at sign-in. Tests: `route.test.ts` (8 cases, mocked, asserts grant
payload + ledger row); `invite-delivery.ts` has **no test file**.

**W4 Notifications admin console** — `app/api/notifications/admin/route.ts:71-143`. Service role:
`resend` → `resetLedgerRow` (`admin-overview.ts:195-220`) then an inline drain; `unsuppress` →
`email_suppressions` delete; `teams_test` → HTTP POST, no DB write. Gate: `is_super_admin` via caller
client, fails closed; limiter 30/min. Tests: `route.test.ts` (4 cases), store tests.

**W5 SolidWorks exploded-view ingest** — `app/api/solidworks/exploded-view/route.ts:60-159` →
`saveExplodedViewToSupabase` (`media-store.ts:314-380`). Multipart `meta` validated by hand (`:75-93`),
MIME whitelist, 10 MB cap; project visibility confirmed with the caller client; `assertTaskInProject`.
Caller (bearer) client: storage upload under `exploded/` (`media-store.ts:332-338`), signed URL,
`step_exploded_views` insert (`:367`). **No transaction**: a failed insert orphans the object. Limiter
60/min. **No idempotency key**: a plugin retry after a timeout creates a second row and object (id from
`newScopedId("view")`, `:320`); plugin retry behaviour **unverified** (no plugin code in the repo). No
version header or negotiation → old-plugin behaviour **unverified**. **No route test, no store test**;
`scripts/solidworks-mock-bridge.mjs` exercises the contract manually.

**W6 SolidWorks build-animation ingest** — `app/api/solidworks/build-animation/route.ts:59-156` →
`saveTaskVideoToSupabase` (`media-store.ts:401-453`). Same shape as W5 with a 200 MB cap, limiter
12/min, `maxDuration = 300`; writes the `task-videos` bucket then `task_videos`. Same orphan-on-failure
and no-idempotency properties. **No route or store test**; the mock bridge does not exercise it.

**W7 SOP approver staging** — `app/api/sops/approvers/stage/route.ts:5-14` → caller-client RPC
`stage_sop_approver` (`20261002025835_deferred_sop_approver_invitations.sql:22`, SECURITY DEFINER; raises
on non-editable draft, wrong department, domain, revoked, self-approval, duplicate seat). Single RPC =
single transaction; limiter 20/min. Returns a fixed body regardless of RPC payload (`:13`). **No route
test**; body parsing tested in `reviewer-nomination.test.ts`.

**W8 SOP submit for review + deferred approver invitations** — `app/api/sops/approvers/submit/route.ts:14-125`.
Caller client: `sops` read, `can_edit_sop_content`, `nominate_department_reviewer`,
`mint_pending_department_reviewer`, `sop_review_seats.signer_id` update, `sops.status → in_review`
conditional on `expectedUpdatedAt` (`:80`, guarded by the `enforce_sop_transition` trigger). Service
role: `acquire_sop_submission_lock` (`20261002033058_sop_submission_lock.sql:10-17`, 10-minute stale
takeover), nomination delivery claims (10-minute lease), `sop_approver_delivery_payloads` snapshot,
setup link, Resend (`sop-approver:<delivery_id>` key), lock delete in `finally`. **Not one
transaction**: a transition failure after accounts were minted leaves accounts/seats with the SOP still
draft (`submitted: false`); a send failure after the transition returns `submitted: true` plus the
pending addresses and releases the claim. No lock is taken when there is nothing pending (`:41`), so
that path relies on the `updated_at` CAS alone. Refuses automatic resend more than 23 h after the
snapshot (`:95-97`). Limiter 10/min. Tests: `route.test.ts` (7 cases: overlap refusal, no email on DB
refusal, retry without re-mint).

**W9 Notification drain** — `app/api/sops/notifications/drain/route.ts:35-100` →
`run-drain-request.ts:52-111` → `notifications-drain.ts:391-500`. Service role. Stores:
`sop_notifications` + `notifications` inbox, `workspace_notifications`, `notification_digests`
(cron only). External: Resend, Teams webhook (allow-listed URL), Web Push. Per item: claim (ledger
INSERT; `23505` ⇒ skip) → inbox insert (failure logged, not rolled back) → send → `markSent` /
`markFailed`; retry lane with conditional `claimRetry`; run row in `notification_drain_runs`. GET:
`CRON_SECRET`; POST: any signed-in user, limiter 6/min, safe because the drain is idempotent. Provider
`Idempotency-Key = <ledger>:<ledgerId>`; 3 attempts at 30/60/120 min. Tests: seven store/drain test
files over fake stores; **no route-level test**.

**W10 Reviewer nomination** — `app/api/sops/reviewers/nominate/route.ts:114-259`. Caller client:
`nominate_department_reviewer`, `mint_pending_department_reviewer` RPCs. Service role: invitation
email, inbox inserts (`inbox-writer.ts:24-45`, never throws). Email is sent **before** the seat is
minted; a mint failure yields `seated: false, emailSent: true`, reported honestly (`:252-256`). Limiter
10/min. Tests: `route.test.ts` (12 cases).

**W11 SOP conversion** — `app/api/sops/extract/route.ts:139-298`. Service role: `sop_extraction_requests`
insert + prune (the **only cross-instance rate gate** in the app, `:80-104`). Caller client: storage
download then best-effort remove. External: Anthropic. No SOP row is written here. Gate:
`has_org_tool_access(edit)`, fails closed; limiter 5/min + DB count. Tests: `route.test.ts` (5 cases).

**W12 Resend delivery webhook** — `app/api/webhooks/resend/route.ts:19-66` → `recordDeliveryEvent`
(`deliveries-store.ts:17-46`). Svix HMAC via `RESEND_WEBHOOK_SECRET`; **no rate limiting** (signature is
the gate). Service role: `email_deliveries` insert (duplicate `svix-id` → `23505` → `{duplicate: true}`,
no suppression writes), then `email_suppressions` upsert per address. **Partial-write gap
(code-derived):** a suppression failure after a successful insert throws → 500 → the provider redelivers
→ the redelivery hits the duplicate branch and **skips suppressions** (`deliveries-store.ts:29-44`).
**No route test**; `deliveries-store.test.ts`, `webhook-signature.test.ts`, `resend-webhook.test.ts` exist.

**Read-only / non-DB routes:** `notifications/health` (CRON secret, reads), `performance` (log only,
same-origin + 4 KB cap, unauthenticated, no limiter), `phone-portal-url` (auth, enumerates host NICs,
**no limiter**), `smart-allocation` (auth, RLS project check, limiter 10/min, external OpenAI, DB
read-only; route untested), `solidworks/targets` (auth, **no limiter**, no test).

### 8.2 SolidWorks plugin integration
Contract per `docs/solidworks-integration.md:28-30, 44, 106-115`: bearer Supabase access token,
service-account password grant, refresh token in Windows Credential Manager (doc claim; plugin source is
not in the repo → **unverified**). Server side has no plugin-version header, no idempotency header and
no `If-None-Match`; **retries after a timeout duplicate media rows** (W5/W6). Old-plugin compatibility:
**unverified**. `scripts/solidworks-mock-bridge.mjs:69-70, 82, 97, 106, 138` exercises targets +
exploded-view only and writes real rows wherever it is pointed (no dry-run).

### 8.3 Planning / work-order writes (browser client, listed for completeness)
All use `createPlannerSupabaseClient()` (e.g. `src/lib/planning/store.ts:667`,
`sales-order-store.ts:255`) from `"use client"` components (`work-order-new.tsx:196, 217`,
`work-order-detail.tsx:305, 329`, `schedule-upload.tsx:145`). No server-side planning write exists.
| Function | Lines | Tables | Transactionality |
|---|---|---|---|
| `createDraftWorkOrderSet` | `store.ts:663-793` | `work_orders` ×2, `work_order_lines` | client-side; draft-number `23505` retry once (`:697-699`); PM failure → verified Main rollback, surfaces "delete manually" if the rollback matched 0 rows (`:739-760`) |
| `approveWorkOrderSet` | `store.ts:795-817` | RPC `approve_work_order_set` (`20260721150000`) | atomic numbering in the DB — the only RPC write in Planning |
| `importSchedule` | `sales-order-store.ts:251-330` | `schedule_imports`, `sales_orders`, `sales_order_lines` | chunked inserts; header deleted on failure (cascade) (`:291-311`) |
| `markLineConverted` | `sales-order-store.ts:398-420` | `sales_order_lines` | CAS on `work_order_id is null` (`:405-410`) |
| others (`saveConfig`, `retireConfig`, `transitionWorkOrder`, `saveTrailerConfig`, `upsertItemMaster`, `grantSpaceAccess`, …) | `store.ts:819-1235`, `config-store.ts:206-345` | single-row writes | none |
Tests: **no** `src/lib/planning/*.test.ts` for the stores; parsers are tested.

### 8.4 User access and membership writes
- `redeem_workspace_access_grants()` (`20260811120000_structured_workspace_invites.sql:258+`, SECURITY
  DEFINER) upserts `workspace_members`, rewrites `org_tool_access` and `space_access`; invoked
  **client-side** at sign-in (`workspace-store.ts:94`) with a `profiles` upsert (`:88-93`), then
  `kickSopNotifications`. The admin grant upsert also exists client-side (`workspace-store.ts:469`).
- `org_tool_access` / `project_access` upserts: `access-store.ts:246, 261` (client).
- Auto-join by domain: `enforce_signup_domain()` / `enforce_approved_email_domain()` triggers
  (`20260612120000_domain_auto_join.sql:121`, `20260703120000:439`) — DB-side.

### 8.5 Operator and maintenance scripts
| Script | Class | Client | Safety gates |
|---|---|---|---|
| `apply-migration-safely.mjs` | **production-writing** operator | pg `DATABASE_URL` | refuses destructive SQL (`:25-34`), single transaction + in-transaction row-count asserts (`:115-125`), `--allow-dml` opt-in (`:83`); no dry-run flag |
| `apply-per-project-rls-migration.mjs`, `apply-planner-rls-migration.mjs`, `apply-user-access-migrations.mjs` | production-writing one-offs | pg | refuse destructive, row-count assert, rollback on error |
| `apply-auth-config.mjs` | production-writing (hosted auth config) | Management API | patches listed keys only |
| `backfill-flexboost-nomenclature.mjs` | production-writing | **service role** (`:15-17`) | **no dry-run, no `--apply`**; updates `products`, `zones`, upserts components / document types (`:105-161`) |
| `backfill-step-photo-thumbnails.mjs` | production-writing | service role (`:24-30, 67`) | **no dry-run**; storage upload + `step_photos` update (`:120-132`) |
| `backfill-normalized-step-assets.mjs` | production-writing | anon + sign-in (`:132`) | dry-run default, `--apply` |
| `backfill-procedure-structure.mjs` | production-writing | pg | two-phase, `--apply` after human diff review |
| `cleanup-orphaned-storage.mjs` | production-writing (storage delete) | service role | dry-run default, `--delete` |
| `clear-sample-approvers.mjs` | production-writing | pg | dry-run default, `--apply`; draft-only rule (`:71`) |
| `restore-step-tools-from-backup.mjs` | production-writing | service role | dry-run default, `--apply`; verifies after upsert |
| `restore-flexboost-gantt.ts` | **destructive** production-writing | service role | hard-deletes dependencies/steps/parts/events/tasks of a scenario (`:241-246`) behind `ALLOW_RESTORE_CURRENT_STATE=true` + `PROJECT_ID` (`:205`); no dry-run |
| `seed-workspace-defaults.mjs` | environment-writing | pg | single transaction, upsert-only, validated args |
| `upsert-auth-user.mjs` | production-writing (auth) | service role | **password on argv** (`:3`), no confirmation |
| `repair-migration-ledger.mjs` | production-writing (ledger metadata) | pg | idempotent `ON CONFLICT DO NOTHING` |
| `planning/harden-schedule-import.mjs` | production-writing | pg | idempotent / re-runnable |
| `check-migration-state.mjs`, `planning/inventory-schedule-import.mjs`, `backup-*.mjs`, `backup/recovery-metadata.mjs`, `backup/verify.mjs` | read-only | — | — |
| `test-delete-scenario.mjs`, `test-duplicate-scenario.mjs`, `test-rbac-boundaries.mjs` | test-only | pg | single transaction, always rolled back |
| `test-scenario-flow.mjs` | test-only **but persists then cleans up** on the target DB | pg | no dry-run |
| `verify-local-migration.mjs`, `release-check-fresh-db.mjs`, `measure-edit-baseline.mjs`, `backup/*rehearse*.mjs` | local / isolated only | — | refuse non-local targets |
| `solidworks-mock-bridge.mjs` | writes via API (real rows) | bearer | no dry-run |

### 8.6 Server-side findings
- **Unused exports:** of 42 exported server-side write helpers, every one has a non-test caller except
  `callerScopedSupabase` (`api-auth.ts:29-36`), which is used only inside its own module — dead export
  surface, not a dead function.
- **Auth / rate limit gaps:** no auth by design on `password-reset/request` (double-bucket limiter),
  `webhooks/resend` (signature, **no limiter**) and `performance` (log only). Auth but no limiter:
  `solidworks/targets` and `phone-portal-url` (reads) and the cron GET. **Every DB-writing
  authenticated route has both `requireApiUser` and a limiter**, all per-instance except `sops/extract`.
  Service-role bypass occurs only where documented, and authorization is first established with the
  caller's client or a shared secret in every case.
- **Risks surfaced (inventory only):** SolidWorks ingest has no idempotency (W5/W6); storage-then-insert
  ordering orphans objects on insert failure (`media-store.ts:332→367, 410→441`); the webhook's
  suppression write is never retried after a recorded delivery (W12); two scripts write production with
  a service-role key and no dry-run gate, one takes a password on argv, one hard-deletes behind an env
  flag; four write routes have no route-level test (`webhooks/resend`, `sops/notifications/drain`,
  `sops/approvers/stage`, both `solidworks/*`), and `media-store.ts` and `invite-delivery.ts` have no test
  files.

---

## 9. Exported write functions with no production caller (active callers separated)

Method: `grep -rnw <name> src app scripts` excluding `*.test.*`, the facade
(`src/domain/supabase-planner.ts`) and the defining line. These are **not active writers** and must not be
counted as such; they are pre-built or orphaned (`docs/deferred-work.md` §7a lists six of them).

| Function | Defined | Non-test callers |
|---|---|---|
| `updateTaskFields` | `task-store.ts:361` | none |
| `upsertProcedureStep` | `task-store.ts:382` | none |
| `reorderProcedureSteps` (RPC `reorder_manufacturing_steps`, `20260601127000`) | `task-store.ts:401` | none — the atomic reorder RPC exists in the DB but no client calls it; both desktop (§3.2) and mobile (§5.10) reorder through multi-request paths |
| `saveTaskAndManufacturingStepToSupabase` | `task-store.ts:196` | none |
| `saveManufacturingStepToSupabase` | `task-store.ts:257` | none |
| `mergeLatestTaskToSupabase` | `task-store.ts:645` | none |
| `saveTaskRowToSupabase` | `task-store.ts:119` | none — **not in §7a** |
| `uploadToolLibraryImage` | `tool-store.ts:120` | none — not in §7a |
| `updateStepPhotoCaptionInSupabase` | `media-store.ts:63` | none — not in §7a |
| `removeStepPhotoAttachmentObject` | `media-store.ts:200` | none — not in §7a |
| `requestSopFinalApproval` | `src/lib/sop/review.ts:165` | none (the UI uses `sendSopForSignatures`) |
| `saveMySignatureProfile`, `moveSeat`, `reassignSeat` | `src/lib/sop/review.ts` | none (roster UI calls only `upsertSeat` / `removeSeat`; `review.test.ts:21-31` tests the latter two) |
| `addSopReviewAnnotation` | `src/lib/sop/review-annotations.ts` | none (the UI uses `saveSopReviewRemark`) |
| `callerScopedSupabase` | `src/lib/api-auth.ts:29` | used only inside its own module — dead export surface, not a dead function |

Active but **non-desktop-only** callers (listed so they are not mistaken for unused):
`saveExplodedViewToSupabase`, `saveTaskVideoToSupabase` → SolidWorks routes (§8 W5/W6);
`saveMobileStepToSupabase`, `syncStepToolsForStepToSupabase`, `saveTaskWithManufacturingStepsToSupabase`,
`saveTaskToSupabase`, `deletePlannerTask` → mobile portal only (§5); `savePlannerStateToSupabase` → mobile
Restore (§5.13) and the desktop optimizer (§2.4); workspace/access writers → Settings/sidebar components
and `auth-project-gate.tsx`. `src/lib/awi/*` has no unused exports.

---

## 10. Historical claims checked against the code

| Claim | Source | Verdict |
|---|---|---|
| Injected-client retry "is not fixed" | `workspace-structure-handoff.md` item 7 | **Stale** — fixed at `0b41c81` (`task-store.ts:512, 574, 599`) |
| Single-task read lacks id tiebreaker and paging | handoff item 9, `deferred-work.md` §7b | **Stale** — fixed at `438a6df` (`read-store.ts:534-540`); confirmed live by the stress fixture's 3-page `step_tools` confirmation read |
| Six task-write functions have no production caller | handoff item 9, §7a | **Confirmed and incomplete** — §9 lists nine more unused exports |
| Catalog rename/delete/tidy never persist step-tool references | handoff item 1, `correctness-scope.md` §3 | **Confirmed** (`shell-store.ts:230-358` writes no `step_tools`) |
| Whole-plan saves are separate requests, not one transaction | handoff item 3 | **Confirmed**; only `replace_task_children` is transactional |
| Only procedure step name/instruction drafts survive reload (annotations partly) | handoff item 4, `correctness-scope.md` §4 | **Confirmed for desktop**; **imprecise for mobile** — the new-step draft also survives, in IndexedDB (§5.1) |
| Draft storage is mixed-scope | handoff item 5 | **Confirmed** (`use-procedure-drafts.ts:76`) |
| Media and tool completions report into the visible status unconditionally | handoff item 6 | **Confirmed** (`use-workspace-media.ts:106, 216, 302, 332, 373`; `use-workspace-tools.ts:115, 136`) |
| Many persistence functions are browser-only | handoff item 8 | **Confirmed** for `scenario-store.ts`, `tool-store.ts` writers, most of `task-store.ts` |
| Optimizer payload equals copied rows | `correctness-scope.md` §3 | **Confirmed** (`duplicate_scenario_rpc.sql:111-114`) |
| Gantt reorder writes temporary then final WBS in separate awaited operations | `edit-reliability-plan.md` | **Confirmed** (`line-workspace.tsx:2950-2956`; mobile `:2340-2343`) |
| Mobile Restore wipes tools and exploded views scenario-wide; shell part writes stale task rows | `correctness-scope.md` §3 item 3, handoff item 2, `restore-step-design.md` §1 | **Confirmed** (§5.13) |
| Mobile step delete rewrites sibling steps from the phone copy | `restore-step-design.md` §1 "Delete A2" | **Confirmed** (§5.12) |
| Full-list tool syncs, Restore shell writes, reorder stranding `tmp-` WBS | `tool-catalog-consistency-design.md` §5b limitations 1–4 | **Confirmed**; no client sends `x-pulse-write-protocol` and no client calls the isolated functions |
| Restore prompt text promises tools/part links/photos | `restore-step-design.md` | **Contradicted by the saver** (tools are not restored), as that design already notes |
| "Nothing below has been merged" | `correctness-scope.md:3` | **Stale** — merged at `5526cfe`; the isolated migration is still outside the active paths |
| `sop/version.ts` is imported by nothing | `deferred-work.md` §2 | **Stale** — `sop-editor.tsx:26`, `review.ts:14`; `numbering.ts` still unwired |
| `canTransitionSop` has zero call sites | `deferred-work.md` §3 | **Confirmed** |
| `self_review_test` remnants remain | `deferred-work.md` §1 | **Confirmed** (`review.ts:25, 52, 158`; `database.types.ts`) |
| "No CI exists", `org_tool_access` write policy not workspace-scoped | `deferred-work.md` §5 | **Stale** (both fixed; see that file's status lines) |
| Rate limiting is in-memory and per-instance | `deferred-work.md` §5 | **Confirmed** (`api-auth.ts:108`); the one exception is `sops/extract`'s DB-backed count |
| Deployment applies no migration; production migrations are applied by hand; CI resets a local DB | `correctness-scope.md` §2 | **Confirmed as to tooling**; operator practice is unverifiable from the repo |
| "SOP persist already serializes saves and uses a persisted version token" | `edit-reliability-plan.md` | **Confirmed**, with the precision that the token is `updated_at`, not `sops.version` |
| Desktop "Restore Task/Zone" after autosave loses children | — | **New, code-derived, not stated in any document** (§2.2) |

---

## 11. Cross-cutting findings

1. **Several persistence regimes coexist.** Summarized from the rows above, by operation class:
   - *Single transaction with a version or token check:* AWI procedure save (`save_awi_procedure`, §6.2),
     SOP document save (`updated_at` token, §7.1), SOP lifecycle RPCs and guarded transitions (§7.7–§7.14),
     work-order approval (`approve_work_order_set`, §8.3), the SOP approver staging RPC (§8 W7).
   - *Multi-request with optimistic versions and one merge-retry:* the desktop non-AWI procedure save
     (§3.1–§3.2) and the step move's two embedded procedure saves (§4.2).
   - *Single-row compare-and-set without a version column:* photo annotations (3-attempt CAS on
     `tasks.version`, §3.4), master BOM (read-back equality, §4.7), `markLineConverted` (§8.3).
   - *Single transaction, no version check:* `duplicate_scenario` / `delete_scenario` RPCs (§4.8),
     `replace_task_children` inside the full-state save (§2.4, §5.13), `create_awi_master` (§6.1).
   - *Multi-request, unversioned, last-write-wins:* the shell save (§2.1–§2.3), both reorders (§4.1,
     §5.10), mobile full-row task upserts and step delete (§5.9, §5.12), mobile Restore's parent upserts
     (§5.13), media uploads/pastes/deletes (§4.4–§4.6, §5.5–§5.6), step-tool add/remove and the full-list
     tool syncs (§4.3, §5.7), catalog operations (§2.3), scenario rename/target (§4.8), SOP annex rows
     (§7.2–§7.4), SOP roster seats (§7.5), SolidWorks media ingest (§8 W5/W6).
   - *Exceptions inside that last class:* the mobile step field patch writes only changed fields
     (field-level, not whole-row, LWW — §5.1, §5.4); `step_tools` rows and SOP comment replies use
     deterministic or client-generated ids, so a retry is idempotent even without a version (§4.3,
     §7.13); the shell save's deletions are bounded by the `assertSaneStateDeletion` tripwire (§2.1); the
     shell save and master BOM refuse to run before the remote load is confirmed (§2.1, §4.7).
   Operations not listed here were not classified.
2. **The two reorders and the mobile Restore are the three paths where an interrupted sequence leaves
   visibly wrong data** (`tmp-` WBS; children or tools gone). None has a stored-outcome test.
3. **Two writers for one tool change** (`step_tools` row and `customFields.stepToolLists`, desktop and
   mobile) and **unversioned whole-object `custom_fields` writes** (photo paste, mobile full-row upserts)
   are where concurrent edits silently overwrite each other.
4. **Durable local recovery exists for exactly three things:** desktop step name/instruction drafts
   (localStorage), photo annotation drafts (localStorage, applied only when the viewer reopens), and the
   mobile new-step draft (IndexedDB, one global key). Every other edit depends on `beforeunload`.
5. **"Saved" means different things:** server-confirmed field values (procedure queue, AWI), a
   PostgREST 2xx on the last request (shell, tools, media, mobile), read-back equality (master BOM), or
   simply "nothing has failed yet" (mobile `idle`).
6. **Client-side view-only gating is advisory and uneven**: present on the shell/procedure/catalog
   paths, absent on media, tools, step move, scenario actions and the whole mobile portal (§1, §5.0).
   This is a UI observation. Database authorization is the RLS and trigger layer cited in §1 and §5.0;
   this pass read those policies but did not test them against a database, so it does not claim that any
   unauthorized write is possible or impossible.
7. **Test character:** request-order assertions on mocked or scripted clients dominate. Stored-outcome
   coverage exists for the AWI RPC (pgTAP + browser), the shell save (`zero-zone-save.spec.ts`), the
   catalog rewrite (in-memory tables) and the master BOM read-back. No pgTAP covers
   `replace_task_children`, `reorder_manufacturing_steps`, `duplicate_scenario`, `delete_scenario`; no
   browser test touches a mobile route; four write routes have no route test.
8. **Unverified items carried forward:** whether `customFieldsRow` strips `stepToolLists` from the AWI
   patch; whether a release trigger validates `content_hash`; mobile `task-<Date.now()>` id collisions;
   the race between a keystroke and a refetch in the mobile idle-draft adoption effect; SolidWorks plugin
   retry behaviour and versioning; operator adherence to the by-hand migration process; whether
   `/design/nothing` still hangs.
