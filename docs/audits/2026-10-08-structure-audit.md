# Pulse structure audit — modular-refactoring priorities

**Date:** 2026-10-08

**Base:** local `main` at `e47add7` (refactor: clarify workflow ownership and module contracts), verified present.

**Mode:** read-only. No application code, dependencies, database, or hosted environment was touched. This file is the only artifact.

**Method:** five parallel read-only reviews (SOP editor cluster, mobile capture, planner + Gantt, photo annotation viewer, repo-wide scan), each required to cite lines. Every defect and every top-ranked structural claim below was then re-read against source by the lead before inclusion. Items marked **[lead-verified]** were independently confirmed line by line; the rest were reviewed for plausibility but not re-executed.

**Scope note (2026-10-09):** the Planning space (work orders, SKU configurations, `src/lib/planning/*`, `src/components/planning/*`) is excluded from this audit by owner decision; that space is slated for removal. Findings that touched it were dropped from this report. **SOP approval routing** (routing state owner, workflow-view derivation, the remaining approval writes, and their defects) is also parked by owner decision: a dedicated harness for it will be built later. A one-line pointer remains in §3.1 so the material is not lost.

Labels: **CONFIRMED DEFECT** = the wrong code path is fully visible; **STRUCTURAL** = ownership/coupling/testability concern, not a bug; **HYPOTHESIS** = plausible from code, needs runtime or database confirmation.

---

## 0. Read this first: one confirmed defect outranks every refactor

The brief asked for structural priorities. One thing found on the way is more urgent than any of them.

### 0.1 Date-only strings render one day early west of UTC on controlled documents — CONFIRMED DEFECT (follows from the JS spec) [lead-verified]

- `src/domain/formatting.ts:99-106` `formatDateControlled` and `:74-78` `formatDate` do `new Date(iso)` then read local getters. `new Date("2026-07-15")` is UTC midnight, so `getDate()` returns 14 in any US timezone.
- Reaches: SOP `effective_date` (a `date` column, `src/lib/sop/store.ts:134`) on print preview (`sop-print-preview.tsx:67-68`) and DOCX export (`export-docx.ts:347,350`); signature dates via `formatDateControlled(row.signedAt.slice(0,10))` (`export-docx.ts:476`).
- Two local noon workarounds already exist and prove the bug has been met before: `domain/work-instruction/release.ts:178-180`, `domain/quality-wi/schema.ts:187`.
- No test covers `formatDateControlled`; vitest pins no `TZ`.

**Action:** parse `YYYY-MM-DD` as a local date once in `domain/formatting`, delete the two workarounds, add `TZ=America/Los_Angeles` tests. Controlled documents will change visibly, to the correct value.

---

## 1. Assessment of the current architecture

The 2026-10 passes did what they claimed: the SOP editor now has real owners for draft/concurrency (`use-sop-draft.ts`), attachments (`use-sop-attachments.ts`) and the save/sign/submit sequence (`editor-workflow.ts`); mobile has a clean storage owner for recovery (`recovery-draft-store.ts`) and pure timer math (`capture-session.ts`); the photo viewer's drawing/export moved to `lib/` with correct dependency direction. Those boundaries are sound and should not be reopened.

What remains is consistent across all four coordinators, and it is not a line-count problem:

1. **Write status and failure policy have no owner.** Mobile: eleven operations each set a last-writer-wins `saveState` string, so a retained failed patch is masked by any later success and realtime sync silently freezes (§4.2). Planner: the save-session protocol is spread across seven shared refs in six modules, and every confirmed save-ordering defect sits on that protocol (§4.3).
2. **Business rules live inline in coordinators and are untested.** Procedure step-list commands and the "task time = sum of steps" rule re-derived in procedure, drawer, mobile and a private domain copy. Gantt layout plus a second step-scheduling routine computed inline every render with no tests.
3. **Shared mutable refs are the coupling medium.** Mobile `selectedTaskIdRef` is swapped around a call to steer another function (`mobile-photo-portal.tsx:2260-2270`); planner hooks receive 15 raw setters and 15 refs in one option bag (`useWorkspaceData`, 39 options). The earlier planner extraction relocated effects but left state ownership in the coordinator.
4. **About 1,900 lines of planner code are dead or inert**: playback (`SIMULATION_ENABLED = false`, `line-workspace.tsx:203`), the detail drawer (`showDetailDrawer = false`, `:1562`, all of `drawer.tsx`), dormant IE allocation (`:2168-2575`, which is the only consumer of the 2026-10 `smart-allocation-client.ts` extraction), and the Gantt `"task"` row kind that `visibleRows` never emits. The drawer is a divergent fork of procedure editing with different save semantics, so it is a hazard, not just clutter.
5. **Dependency direction is right at runtime with three exceptions**: `src/domain/supabase-planner.ts` is a lib facade placed in `domain/` (deliberate, 90 importers, but lib modules now import it, giving a `lib → domain → lib` path); `src/lib/quality-wi/render-image.tsx:6-7` imports from `components/`; type-level cycles between `domain/sop/queue-ready.ts` ↔ `lib/sop/review-queue-data.ts`.
6. **Test shape:** the pure extractions are well tested; every multi-step workflow (mobile timer park/resume, planner scenario switch-back, SOP submission landing, Gantt interactions, print pagination) is testable only by mounting a full screen, or not at all. Gantt, `line-workspace.tsx`, `sop-print-preview.tsx`, `sop-list.tsx` have no tests. CI browser jobs are paused, so measured pagination has no layout coverage at all right now.

---

## 2. Ranked candidates (including "leave as is")

Priority is value ÷ (effort × regression risk), with confirmed defects weighted up.

| # | Candidate | Files | Type | Priority | Effort | Risk | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Date-only parsing in `domain/formatting` | `domain/formatting.ts:74-106` + SOP call sites | Defect | **P0** | S | Med (visible change, correct) | Do now |
| 2 | Photo viewer: photo-switch saves previous items onto next photo | `step-photo-viewer.tsx:636-668, 380-399, 558-580` | Defect | **P0** | S | Low | Fix + 3-photo test |
| 3 | Mobile write coordinator with failure-aware status (`useMobileWrites`) | `mobile-photo-portal.tsx:268, 286-288, 778-780, 1221-1288, 1495-1513` | Structural, fixes defect | **P1** | M | Med | Extract |
| 4 | Planner save-session protocol: characterize + fix D1/D1b/D4/D5, then `createPlannerSaveSession()` | `line-workspace.tsx`, `use-workspace-saves.ts`, `use-workspace-scenarios.ts`, `use-workspace-tools.ts` | Structural, fixes defects | **P1** | M–L | High | Characterize first |
| 5 | Remove dead planner code (playback, drawer, IE allocation, Gantt task rows) | `line-workspace.tsx`, `line-workspace/drawer.tsx`, `gantt-timeline.tsx` | Hygiene | **P1** | S | Low | Delete, two owner decisions |
| 6 | Mobile: `settleWriteBatch` at three `Promise.all` sites; fix stale "Save & next" closure | `mobile-photo-portal.tsx:1445, 1900, 2036, 2692` | Defect | **P1** | S | Low | Fix |
| 7 | SOP review-conversation hook (one fetch, one error policy, gated poll) | `sop-editor.tsx:348-354, 442-475, 968-984, 1304-1322` | Structural, fixes request volume | P2 | M | Med | Extract |
| 8 | Planner edit commands as pure domain reducers (`planner-commands.ts`, `procedure-step-commands.ts`) | `line-workspace.tsx:1864-1893, 2577-2655, 2667-2829, 3028-3075`; `procedure.tsx:426-508` | Structural | P2 | M | Low–Med | Extract |
| 9 | Gantt pure layout model (`buildGanttLayout`) incl. step windows | `gantt-timeline.tsx:526-647, 686-826` | Structural | P2 | M | Low | Extract first; controller later |
| 10 | Mobile new-step draft controller (draft + autosave + persist + recovery together) | `mobile-photo-portal.tsx:246-266, 1290-1493, 1120-1139, 2591-2655` | Structural, fixes defect | P2 | M–L | High | Characterize first |
| 11 | SOP conversion workflow out of `sop-list.tsx` | `sop-list.tsx:385-471` | Structural | P2 | M | Med | Extract (mirror `editor-workflow.ts`) |
| 12 | Mobile capture-timer transitions as pure reducer | `mobile-photo-portal.tsx:2090-2322, 2514-2589` → `capture-session.ts` | Structural | P2 | S–M | Low | Extract; keep parking coupled to draft |
| 13 | Print preview: fallback rendered from blocks; attachment-pages hook keyed on stable signature | `sop-print-preview.tsx:1210-1359, 797-886` | Structural, fixes churn | P2 | S–M | Med | Extract |
| 14 | Photo viewer pure gesture helpers → domain; `useAnnotationPersistence` | `step-photo-viewer.tsx:171-209, 854-868, 925-935, 1141-1152, 1194-1261` | Structural | P3 | S | Low | Extract helpers only |
| 15 | Photo viewer gesture/interaction controller | `step-photo-viewer.tsx:261-266, 973-1270` | Structural | Defer | L | Med–High | **Leave together** until undo or touch/zoom is planned |
| 16 | Gantt link-mode interaction controller | `gantt-timeline.tsx:1002-1127` | Structural | Defer | M | Med | **Leave together**; build only alongside D2/D3 fixes |
| 17 | Mobile list-owned drag/swipe + pure reorder computation | `mobile-photo-portal.tsx:238-252, 1673-1754, 1793-1883` | Structural | P3 | S | Low | Extract |
| 18 | Planner command palette + undo/redo hooks | `line-workspace.tsx:789-792, 1110-1131, 1338-1545, 1642-1672` | Structural | P3 | S | Low | Extract |
| 19 | Navigation-storage module (keys, last project, workspace pick) | 5 files, see §6 | Duplication | P3 | S | Low | Consolidate |
| 20 | Operator allocation / IE solver | `domain/operator-allocation.ts`, `domain/ie-smart-allocation-solver.ts` | — | P3 | M | Med | ~~**Leave together**; golden tests first, then dedupe 3 helpers~~ (obsolete 2026-10-10: targets deleted; see 2026-10-10 audit DOM-3) |
| — | `use-sop-draft.ts`, `use-sop-attachments.ts` boundary | | | | | | **Leave as is** (one effect-key fix, §4.1 D3) |
| — | `step-editors.tsx`, `pfmea-workspace.tsx`, `analytics.tsx`, `use-workspace-media.ts`, `use-procedure-save-queue.ts` | | | | | | **Leave as is** |
| — | Print preview offscreen measurement tree + visible render | `sop-print-preview.tsx:992-998, 1495-1558` | | | | | **Leave together** (documented CSS invariants) |
| — | Mobile timer + parked draft copy + session persistence | `capture-session.ts:34-45` | | | | | **Leave together** (one persisted unit) |
| — | Mobile draft persist + recovery fingerprint/acknowledge | `mobile-photo-portal.tsx:1393, 1459-1461` | | | | | **Leave together** (cross-module invariant otherwise) |
| — | Mobile account remount wrapper | `mobile-photo-portal.tsx:200-227` | | | | | **Leave as is** |
| — | Mobile `restoreDeletedSnapshot` full-state save | `mobile-photo-portal.tsx:1515-1544` | | | | | **Leave** until the restore RPC in `docs/restore-step-design.md` ships |
| — | `process-flowchart.tsx`, `app-flow-panels.tsx`, `work-instruction/*`, `row-mappers.ts`, notification stores | | | | | | **Leave as is** |
| — | Mobile vs shared scheduling | `domain/mobile-task-scheduling.ts`, `domain/task-scheduling.ts` | | | | | **Do not merge** (see §6, note the mobile policy is currently unreachable) |

---

## 3. Responsibility maps and proposed interfaces (strongest candidates)

### 3.1 SOP editor coordinator (`src/components/sop/sop-editor.tsx`, 1,979 lines)

**Inventory [lead-verified]:** 45 `useState`, 9 `useRef`, 15 `useEffect`, 2 `useLayoutEffect`, 3 `useCallback`, 7 `useMemo`. JSX begins at 1514.

| Concern | Where | Owner today |
|---|---|---|
| Route/view seeding, step navigation by array index | 267, 284, 580, 567-589, 667-673, 751-757, 884-895, 1028, 1055-1056, 1097-1119, 1341-1349 | Entangled; `setStepIndex` written from six places; URL rewritten by both `history.replaceState` and `router.*` |
| Approval routing, visibility derivation, approval workflow writes | 300-347, 397-440, 542-673, 900-1070, 1566-1571 | **Parked (owner decision): to be covered by a dedicated harness later.** For the record: 15 routing state slices with four writers; ~150 lines of untested visibility/lock/enablement rules; recall, controlled change, retry and reconciliation still call `review.ts` directly |
| Review conversation | 348-354, 442-475, 968-984, 1304-1322 | Three fetchers, three error policies |
| Audit trail | 355-359, 477-497, 770-781, 960, 978, 1014, 1053 | Refreshed ad hoc inside action `try` blocks |
| Draft/save, attachments | 369-389 | **Owned** by hooks (correct) |
| Reference data, converted toast, field hints, search reveal, overlays | 296-299, 289-291, 292, 287-288, 283-285 | Self-contained, low value to move |

**Interface sizes:** `SopDocumentSection` 15 props (receives the concurrency token only to test `!persistedUpdatedAt`; raw `setDeptId`); `SopQualitySection` 13 props with **four raw setters** (`quality-section.tsx:38-45`); `SopApprovalsSection` exposes the coalescer's option type (`approvals-section.tsx:5,33`); `useSopAttachments` takes `persistedUpdatedAt` as an effect key (causes §4.1 D3). `ReviewSectionProps` in `editor-types.ts:14-18` is unused.

**Leave together:** `sectionEditors` (1182-1250, shared by builder and review margin); converted toast; field hints; search reveal (until navigation is keyed by ID).

### 3.2 Mobile capture coordinator (`src/components/mobile-photo-portal.tsx`, 3,173 lines)

**Inventory [lead-verified]:** 43 `useState`, 48 `useRef`, 27 `useEffect`, 13 `useMemo`, 5 `useCallback`. JSX begins at 2771. Rendered via `project-route-shells.tsx:220-266`; the account-remount wrapper at 200-227 is small and correct.

| Concern | Where | Owner today |
|---|---|---|
| Load/seed/hydrate | 232-237, 312-322, 997-1118 | Entangled: `applySavedState` (1018-1079) restores selection, parked timers, screen and nine draft setters |
| Selection/navigation | 233-234, 253, 271, 2697-2763 | Entangled with draft flush and timer parking |
| Capture timer + session | 274-278, 328, 477-582, 2090-2322, 2514-2589 | Math owned by `capture-session.ts`; transitions entangled with draft (2176-2187 writes nine setters) |
| New-step draft | 246, 254-266, 269, 255-258, 289, 320-321, 329-330, 1290-1493, 2591-2655 | Snapshot assembled from render closures + refs (1333-1344) |
| Recovery drafts | 306-311, 1120-1181, 1350-1374 | Storage owned (`recovery-draft-store.ts`); lifecycle intentionally coupled to persist |
| **Write lock / queue / status** | 268, 286-288, 744-754, 778-780, 1221-1288, 1495-1513, 2019-2088 | **No owner**; `saveState` is last-writer-wins |
| Realtime refresh | 324-332, 377-383, 782-898, 1183-1219 | Cohesive but hand-copied from planner (comments at 831-832, 869-870 say "keep in sync" and point at `line-workspace.tsx`, where the code no longer lives — it is in `use-workspace-realtime.ts:112-205`) |
| Photo upload | 236, 272-273, 1239, 1546-1562, 1885-1967 | Cohesive for existing steps; new-step path split into draft |
| Task list drag/swipe/create/reorder | 238-252, 303-305, 1579-1883, 2414-2443 | Cohesive; belongs to the list |
| Viewport/keyboard/motion | 279-297, 584-742, 900-993 | Pure UI |

**Coupling hotspots:** `selectedTaskIdRef` (five groups; swapped at 2260-2270 as an implicit parameter), `newStepIdRef`, `plannerStateRef` (written imperatively in seven places plus one effect), `newStepAutosaveTimerRef`, `failedDraftPatchesRef`.

**Child props:** `MobileProcessList` 33 (two refs only the child uses; five raw setters; whole `derivedState`); `MobileNewStepEditor` 27 (3 grouped + 24 loose); `MobileStepEditor` 26 (whole `selectedTask` used only for alt text).

**Candidate 3 — `useMobileWrites`**
- Inputs: `isEditorCurrent`, `onDrained` (→ `flushDeferredRemoteRefresh`), `extraPendingWork()` (autosave timer, failed patches, failed tool syncs).
- Actions: `run(key, op)`, `enqueue(taskId, key, op)`, `hasWork()`, `status: { state, error, failures[] }`, `clearFailure(key)`. Internally: the planner's existing `WorkspaceWriteTracker` (`domain/workspace-save-status.ts:16-50`, "a different successful write cannot clear a failure") plus mobile's per-task promise chain, which the tracker lacks.
- Why: fixes §4.2 D2 structurally; one module answers "is anything unsaved or failed?" (today: three refs, a counter, a state string and two maps). Testable like `workspace-save-status.test.ts`.
- Must not change: per-task ordering (1272-1277); rejection of queued ops after account change (1274); "Saving…" whenever any write is pending (2867); the `beforeunload` condition (746); realtime deferral semantics; zero added requests.
- Tests: failure persists across another key's success; per-task order; post-account-change guard; lock held until batch settles; component test that Retry stays visible after an unrelated successful save.

**Candidate 10 — new-step draft controller:** reducer + "latest" ref so `snapshot()` is never stale (fixes §4.2 D1); explicit `taskId` on `persist` (removes the ref swap); one `hydrate(source)` replacing the four divergent copies at 1060-1074, 2176-2187, 2273-2296, 1120-1129 (two set duration only when > 0, two default to "5"). **Keep recovery inside** this controller: fingerprint, token and acknowledge-after-exact-persist (1393, 1459-1461) all depend on the persisted snapshot. Preserve 450 ms debounce, 250 ms recovery re-save, patch-only payload against `draftBaseStepsRef`, `onSaved` gating (1464), effect-762 adoption conditions, flush-before-task-switch (2698). Characterize first; existing recovery and capture-session suites must pass unchanged.

**Candidate 12 — capture-timer reducer** in `capture-session.ts`; thin hook keeps ref mirror, 1 s ticker, session effects. Leave parking coupled to the draft via a narrow port (`draft.snapshot()` / `draft.hydrate(parked)`). Preserve elapsed-time rules, ≥1-minute laps, session key, `pagehide` flush, Stop applying the lap to the timer's own task/step (2100-2117).

### 3.3 Planner coordinator (`src/components/line-workspace.tsx`, 3,655 lines) and Gantt (2,757 lines)

**Inventory [lead-verified]:** 37 `useState`, 36 `useRef`, 18 `useEffect`, 12 `useMemo`, 0 `useCallback`; hooks called: `useWorkspaceSaves` (624), `useProcedureDrafts` (645), `useProcedureSaveQueue` (680), `usePlannerPresence` (798), `useWorkspaceTools` (812), `useWorkspaceMedia` (826), `useWorkspaceScenarios` (853), `useWorkspaceData` (983), `useWorkspaceRealtime` (1027), `usePlannerShellAutosave` (1133). JSX begins at 3273.

The earlier extraction relocated effects into hooks but left state in the coordinator: `useWorkspaceData` receives 39 options (15 raw setters, 15 refs), `useWorkspaceScenarios` 26, `useWorkspaceRealtime` 25. The save-session protocol lives in shared refs — `plannerDirtyRef`, `remoteStateConfirmedRef`, `remoteRefreshAppliedRef`, `saveInFlightRef` + `queuedSaveStateRef`, `pendingRemoteRefreshRef`, `mainScenarioIdRef`, `scenarioCacheRef` — touched from six modules; `setSaveState` has eight writers. `scenarioCacheRef` is written by the coordinator (549, 556, 2141), `useWorkspaceSaves` (283) and `useWorkspaceScenarios` (142, 151, 249). `use-workspace-tools.ts:183` calls `savePlannerShellToSupabase` **outside** `saveInFlightRef`, so it can overlap an autosave [lead-verified].

**Candidate 4 — characterize, fix, then `createPlannerSaveSession()`**
- Step 1 (behavior fixes, each its own commit with a test): always release the lock and drain the queue on release (§4.3 D1/D1b); restore must not set the echo flag (D4); echo suppression only when `!plannerDirtyRef`; refetch or validate a cached scenario on switch-back (D5).
- Step 2: fold the refs into a store mirroring `createProcedureSaveQueueStore`: `confirmRemote()`, `markUserEdit()`, `markServerEcho()`, `withShellLock(key, fn)` (releases + drains), `isShellBusy()`. Coordinator keeps state cells and effect order. The 900 ms / 750 ms timings and request counts must stay identical.
- Why: each defect today is an implicit protocol violation between modules; a named store makes the protocol testable.

**Candidate 8 — pure domain reducers** `(state, args, {now, newId}) => state` for `updateTask` (1864-1893), `setTaskDependencies` (2577-2612), `linkTaskStartToFinish` (2614-2655), zone/component/doc-type CRUD, `addTaskToZone`, `executeDeleteTasks`; and `procedure-step-commands.ts` owning the step-derived-duration rule now re-derived in `procedure.tsx:349-352, 432-435, 492-495`, `drawer.tsx`, `mobile-photo-portal.tsx:155` and `domain/move-manufacturing-step.ts:20`. Coordinator keeps `markDirty()`, `setPlannerState(s => cmd(s, …))`, selection side effects. One characterization test per command including D3's interaction with rescheduling.

**Candidate 9 — `buildGanttLayout({ tasks, stations, zones, expandedGroupIds })`** returning `{ bounds, processGroups, zoneGroups, visibleRows, rowGeometry, groupByTaskId, zoneByGroupId, stepWindows }`, absorbing `gantt-timeline.tsx:526-647, 686-826` verbatim. It is pure, untested, recomputed every render, and contains a second step-scheduling policy (`resolveStepWindow`, cycle fallback via `resolvingStepRefs`). This, not an interaction controller, is the right first Gantt boundary. Gantt has **no** bar drag/resize state machine: its interactions are HTML5 group drag-and-drop, a text-input-driven start/finish link mode, and two modals. The link controller (state `{ linkingRowId, startDrafts }`; events `focusStart/typeStart/escape/blur/clickFinish/activateRow`; intents `select/updateTask/patchStepDependencies/linkTaskStartToFinish`) should be built only together with the D2/D3 fixes, since those change exactly its intents. Cheap independent moves: extract `PredecessorPickerDialog` and `TaskCodeMappingDialog`; delete the dead `"task"` branches (1919-2060, 2345-2430) and `highlightedRowIds` (only ever set to an empty set).

**`line-workspace/` files over 1,000 lines:** `procedure.tsx` one panel, keep UI, move step commands (above); `step-editors.tsx` a tested editor library, **leave**; `pfmea-workspace.tsx` narrow 9-prop interface, **leave** (one defect, §4.3 D6); `setup-panels.tsx` mixed — move `WorkInstructionsPanel` (418-778) to its own file; `drawer.tsx` **dead and divergent** — delete.

### 3.4 Photo annotation viewer (`src/components/step-photo-viewer.tsx`, 2,315 lines)

20 `useState`, 14 `useRef`, 11 `useEffect`, 10 `useCallback`. Rendered by `line-workspace/step-editors.tsx:546-555` (full behavior) and `quality-wi/wi-photos.tsx:179-200` (no `taskId`, so recovery is silently off; `onUpdatePhoto` undefined when disabled, so edits are silently discarded while the UI still allows drawing). The mobile portal does not render it. Dependency direction domain ← lib ← component is correct; `lib/photo-annotation-export.ts` has no test of its own. Two inversions: `measureTextCalloutBox` creates a `<canvas>` inside `domain/photo-annotations.ts:398-406`; the pure 3-way merge `mergeAnnotationDocuments` lives in the localStorage module `lib/photo-annotation-drafts.ts:7-17` and is imported by `lib/planner/task-store.ts:40`.

**Verdict: leave the gesture state machine together.** There is no hit-testing math (DOM targets carry identity), no zoom/pan, no undo. A reducer `reduceAnnotationGesture(state, action, ctx) → { state, effects }` is well defined (state `idle | drafting | pendingTextDrag | dragging`; actions `pointerDown{target}`, `pointerMove`, `pointerUp`, `pointerCancel`, `reset`; effects `annotationOps`, `select`, `capture`, `focusText/blurText`), but it only pays for itself when undo or touch/zoom is planned. Before any of that: fix §4.4 D1 and D2, move pure helpers (`applyDragDelta` 854-868, draft-commit thresholds 1194-1261, callout placement 925-935 duplicated at 1796-1805, freehand sampling 1141-1152) into `domain/photo-annotations.ts`, and record the ten characterization sequences listed in §5 Phase 2. Replace the two optional props with an explicit `persistence: { taskId, onUpdatePhoto } | { mode: "read-only" }` and render read-only as read-only.

---

## 4. Defects found (distinct from structure)

### 4.1 SOP editor and print preview

| ID | Label | Finding | Lines |
|---|---|---|---|
| D1 | CONFIRMED [lead-verified] | Two window-level Escape listeners with no layering: with the audit panel open on Draft Review, one Escape closes the panel **and** fires the embedded preview's `onClose` (`leaveFeedbackView`), changing step or routing away. `ReferencePdfPreview` does it correctly with capture + `stopImmediatePropagation` (`reference-pdf-preview.tsx:144-150`) | `sop-editor.tsx:774-781`, `sop-print-preview.tsx:438-457` |
| D3 | CONFIRMED [lead-verified] (request volume) | `useSopAttachments` list effect is keyed on `persistedUpdatedAt`, which advances on every autosave (`use-sop-draft.ts:184-185`): one extra query per autosave, and a new `annexFiles` array identity re-rasterizes every attached PDF in the mounted preview (`sop-print-preview.tsx:797-886`) | `use-sop-attachments.ts:253-274` |
| D5 | CONFIRMED [lead-verified] (request volume) | Annotation poll runs every 15 s + focus + visibilitychange for every editor mount (unsaved, effective, never-reviewed), uncoordinated with the routing poll | 1304-1322 |
| D6 | CONFIRMED | Inconsistent read-error policy: effect 442 clears open remarks and submissions but not addressed ones; poll retains | 467-471 vs 1317 |
| D7–D8 | CONFIRMED minor | `linkableSopsError` never cleared on later success; `handleExport` has no catch and revokes the object URL immediately after `click()` | 692-707, 1072-1090 |
| D10 | CONFIRMED low | `onClose()` invoked inside a `setInlineDoc` updater; updaters may run twice | `sop-print-preview.tsx:449-453` |

Print preview: `buildPrintBlocks` and `packBlocks` are pure and tested; still-inline pure pieces are the keepGroup pre-pass (`use-paginated-pages.ts:64-75`), page-sequence/numbering (733-742, 1379, 1398, 1420 — numbering is a data contract because annotations persist `page_number`), and the 150-line hand-rendered fallback (1210-1359) that has already drifted from the block renderers (missing `AttachmentCommentButton`, no sub-heading blocks, Change History duplicated at 1319-1328 and 1341-1350).

### 4.2 Mobile capture

| ID | Label | Finding | Lines |
|---|---|---|---|
| D1 | CONFIRMED [lead-verified] | `handleNewStepPhotoFiles` awaits `buildPhotoAttachment`, then builds the snapshot from the **stale render closure** (`getNewStepDraftSnapshot` reads `newStepName`, `newStepInstruction`, … at 1333-1344); `persistNewStepDraft` first cancels the pending autosave holding the newer text (1380). Take a photo, type immediately: the text is reverted and the recovery record overwritten. No test | 2628-2648, 1333-1344, 1376-1395 |
| D2 | CONFIRMED [lead-verified] | `saveState` is last-writer-wins; Retry renders only while `errorMessage` is set (2972), which any later success clears; `hasLocalSaveWork()` includes `failedDraftPatchesRef.size > 0`, so every realtime refresh is deferred forever while the header says "Saved" | 778-780, 1495-1513, 2972 |
| D3 | CONFIRMED | Fail-fast `Promise.all` over uploads releases the write lock and rolls back sibling photos that later succeed (ghosts on refetch). Desktop fixed this with `settleWriteBatch` (`workspace-save-status.ts:8-14`) | 1445-1450, 1900-1902, 2036 |
| D4–D6 | KNOWN (`docs/edit-operation-inventory.md` §5.2, §5.12, §5.13; `docs/restore-step-design.md`) | Draft-photo removal after persist does not remove; step delete ignores its own failure; Restore Step is the portal's only full-state save (1526) — blocked on the restore RPC rollout, do not refactor around it | 2650-2655, 2324-2372, 1515-1544 |
| D7 | CONFIRMED low | "Save & next" `onReady` tests `captureTimer.running` from the click's render; Stop during the save yields a timer with `activeStepId` set and `taskId: null`, written to session | 2692, 2518-2531 |
| D8 | CONFIRMED [lead-verified] | `withUpdatedTask(…, shouldReschedule)` is never called with `true` (1265, 1415, 1574, 2076, 2345), so `rescheduleMobileTasksByDependencies` has **no runtime caller**. The "keep the two scheduling policies separate" decision currently guards dead code. Owner decision needed; do not substitute the shared scheduler | 172-188 |
| H1 | HYPOTHESIS | Remote load re-applies `applySavedState` after the server seed without checking `hasLocalSaveWork()`/`newStepTouchedRef`; can clobber typing during a 30–114-request load | 1001-1104 |
| S2 | STRUCTURAL | `assertCaptureCurrent` applied on draft/retry paths but not on tool add/remove, `handlePhotoFiles`, `removePhoto`, restores | 1438-1448 vs 1901, 1935, 1985, 2008, 2080 |

### 4.3 Planner and Gantt

| ID | Label | Finding | Lines |
|---|---|---|---|
| D1/D1b | CONFIRMED | `reorderTaskGroups` releases `saveInFlightRef` only `if (isCurrent())`, so a project switch mid-RPC leaves the lock held and every later `persistPlannerState` queues with no drain; lock holders (media, reorder) release without draining `queuedSaveStateRef` | `line-workspace.tsx:2932-2961`, `use-workspace-saves.ts:186-190` |
| D2 | CONFIRMED [lead-verified] | A Gantt step-to-step link sends `onUpdateTask(task, { manufacturingSteps })` → shell save; `savePlannerShellToSupabase` upserts `tasks`, `task_dependencies`, zones, components, custom columns but **never `manufacturing_steps`**. The link survives only locally until a procedure save of that task happens to carry it | `gantt-timeline.tsx:1093-1105`, `shell-store.ts:230-358` |
| D3 | CONFIRMED [lead-verified] | Group start edit calls `onUpdateTask` once per task; each `updateTask` reschedules preserving only **its own** task's manual start (`preserveManualStartTaskIds: new Set([taskId])`), so only the last dependent keeps the typed offset | `gantt-timeline.tsx:1059-1068`, `line-workspace.tsx:1886-1890` |
| D4 | CONFIRMED | `restorePlannerSnapshot` sets the echo-suppression flag together with `markDirty()`; the autosave effect consumes the flag and cancels the pending save. "Restore Zone / Task(s)" persist only on the next edit, flush or pagehide | `line-workspace.tsx:2730-2732`, `use-workspace-saves.ts:465-468` |
| D5 | HYPOTHESIS, highest severity | Switching back to a cached scenario applies the cache with no reload; realtime covers only the active scenario. A teammate's rows added meanwhile are deleted by the next shell diff-save if under the tripwire. Needs a two-client test | `use-workspace-scenarios.ts:139-144`, `line-workspace.tsx:554-558` |
| D6 | CONFIRMED | `PfmeaWorkspace` seeds its document once per `product.id`; undo/redo or realtime changes to the PFMEA field are invisible and overwritten on next edit | `pfmea-workspace.tsx:271-315, 389-393` |
| D7–D10 | CONFIRMED low | Failed optimize leaves an orphan "⚡ Optimized" scenario; Gantt label-resize listeners never cleaned up; side effects in state updaters at `line-workspace.tsx:1913-1941`, `use-procedure-save-queue.ts:235-258`; palette memo suppresses exhaustive-deps and captures stale selection | as cited |
| — | NOTE | Two callers of the legacy full-state save remain: `line-workspace.tsx:2140` (fresh duplicated scenario, lower risk) and `mobile-photo-portal.tsx:1526` (restore after delete). Tripwire intact in `shell-store.ts:88`. No new full-save-shaped functions [lead-verified] | |

### 4.4 Photo annotation viewer

| ID | Label | Finding | Lines |
|---|---|---|---|
| D1 | CONFIRMED code path [lead-verified]; reachable only with legacy height-less text callouts | The text-measurement `useLayoutEffect` depends on `photo.id` and runs before the restore effect; at that moment `annotations` still holds the **previous** photo's items while `persistAnnotations` has already captured the **new** `photo.id`. A height-less legacy text item on the photo being left causes `pendingSaveRef = {photoId: NEW, items: prevItems}` and a draft write for the new photo; the restore effect's `flushPendingAnnotations()` then sends the previous photo's items to the new photo. Navigated-to photos are never re-measured (deps unchanged), so legacy text stays height-less until navigated away from. Existing switch test uses an arrow only | 636-668, 380-399, 558-580; `domain/photo-annotations.ts:221-224` |
| D2 | CONFIRMED [lead-verified] | No `onPointerCancel`/`onLostPointerCapture`; stored `pointerId` never compared. A touch pan/pinch leaves `dragState` set: background pointerdown ignored, next pointer keeps dragging the stale annotation | 1930-1932, 887, 915, 1022-1270 |
| D3 | CONFIRMED low | `persistAnnotations` called inside `setAnnotations` updaters; `pendingSaveRef.current.items` mutated in place | 405, 662, 592 |
| D4 | CONFIRMED perf | Full localStorage draft write (read, parse, normalize, stringify, including image-overlay data URLs) on **every pointermove** | 1080-1123, `photo-annotation-drafts.ts:31` |
| H | HYPOTHESIS | Draft key is `taskId:photoId` with no user scope and no sign-out clear; on a shared browser, user B auto-submits user A's unacknowledged draft | `photo-annotation-drafts.ts:19`, viewer 561-569 |

### 4.5 Repo-wide

- **§0.1 above.**
- F3 HYPOTHESIS: browser caches keyed by project, not user, surviving the soft-navigation sign-out (`planner-state-cache.ts:12`, IndexedDB `pulse-planner-cache`; `sidebar-workspace-panel.tsx:71-102`; `drawer.tsx:91`). One `clearUserScopedClientCaches()` on `SIGNED_OUT`.
- STRUCTURAL [lead-verified]: `src/lib/quality-wi/render-image.tsx:6-7` imports from `components/` (a byte-identical copy of `lib/step-photo-image.ts:15-22` `readBlobAsDataUrl`); `quality-wi/wi-photos.tsx:6` imports `buildPhotoAttachment` from the mobile portal while `lib/step-photo-image.ts` has the same function.
- STRUCTURAL: `domain/sop/queue-ready.ts:10` ↔ `lib/sop/review-queue-data.ts:11` type-level cycle; `lib/planner/smart-allocation-client.ts:1` imports the facade whose header says "leaves never import this file".
- `domain/operator-allocation.ts` + `ie-smart-allocation-solver.ts`: pure and cohesive; `buildSmartOperatorAssignments` (655-887), `repairPlanDeterministically` (390-613) and `buildDeterministicCoveragePlan` (614) have no direct tests; summary-task check duplicated 4×, `taskWindowsOverlap` 2×, successor count 2×. Golden tests first, then dedupe into `task-hierarchy.ts`. Do not split by length.

---

## 5. Phased plan (small, independently verifiable)

Each phase lands on its own branch, CI green, verified in the browser where behavior is observable. Nothing in Phase 1 or 2 changes module boundaries.

**Phase 0 — stop the line (hours)**
1. Date-only parsing in `domain/formatting` with `TZ`-pinned tests; delete the two noon workarounds (§0.1).

**Phase 1 — local defect fixes with regression tests (days)**
2. Photo viewer: guard `persistAnnotations` on `incomingRef.current.id !== photo.id`; trigger measurement from the restore step instead of `photo.id`; add `onPointerCancel`/`onLostPointerCapture` + pointerId guard; write the draft at gesture end, not per move. Tests: 3-photo legacy-text navigation; cancel mid-drag.
3. Mobile: `settleWriteBatch` at 1445/1900/2036; read `captureTimerRef.current` and match `taskId` in "Save & next". Tests: one failed upload does not roll back siblings; Stop during save leaves no half-bound timer.
4. SOP: key the attachment list on `hasPersistedSop`; gate the annotation poll on persisted + review-relevant status and route it through `useCoalescedRefresh`; capture-phase Escape with `stopImmediatePropagation` in the audit panel and preview. Tests: autosave issues no annex query; Escape closes one layer.
5. Planner: always release the shell lock and drain the queue; restore does not set the echo flag; echo suppression only when not dirty. Tests: D1, D1b, D4 as written in §4.3. Write the two-client cached-scenario test for D5 and decide refetch-vs-validate from its result.
6. Delete dead planner code (§2 #6). Owner decisions: retire `SIMULATION_ENABLED`? keep the LLM-strategist allocation (if yes, move it to its own module)? Preserve snapshot tolerance of `detailDrawerCollapsed` (`state.ts:240`).

**Phase 2 — characterization before boundaries (days)**
7. Mobile: characterization of typing during slow photo preparation, overlapping photo picks, and `hydrate` parity across the four draft-hydration copies.
8. Gantt: layout tests (zone order, deleted-zone fallback, step windows with sequential/step→step/step→task/two-step-cycle) and link-mode matrix (`"="`, `1.5h`/`2 hrs`/`2`, `canUseFinishAsLinkSource`, finish-click on step vs group, Escape).
9. Photo viewer: recorded pointer sequences per tool (arrow thresholds, shape thresholds + reversed drag, freehand single-point/sampling/cap, callout click vs drag, select-tool handles, textarea pending drag, 350 ms debounce, photo switch mid-gesture).
10. ~~Allocation: golden tests for `buildSmartOperatorAssignments`, `repairPlanDeterministically`, `buildDeterministicCoveragePlan`.~~ (obsolete 2026-10-10: targets deleted; see 2026-10-10 audit DOM-3)

**Phase 3 — the two boundary extractions (1–2 weeks total)**
11. `useMobileWrites` (candidate 3), then convert the eleven status writers.
12. Planner `createPlannerSaveSession()` (candidate 4 step 2), only after Phase 1 item 5 is green.

**Phase 4 — second tier (as capacity allows)**
13. `buildGanttLayout` + the two dialog extractions; fix D2 (step link via the task-store step write, not the shell) and D3 (group edit preserves all manual starts) and build the link controller alongside.
14. Planner and procedure pure command reducers (candidate 8). Mobile capture-timer reducer (12); list-owned drag + domain reorder (17).
15. SOP review-conversation hook (7); step navigation keyed by `StepId` (the index arithmetic at 1055 goes away); print fallback from blocks + attachment-pages hook (13).
16. SOP conversion workflow out of `sop-list.tsx`; photo-viewer pure helpers + persistence contract.

---

## 6. Consolidation opportunities

**Behavior-equivalent (safe to consolidate; bodies compared):**

| Duplicate | Locations | Note |
|---|---|---|
| `readBlobAsDataUrl` | `lib/step-photo-image.ts:15-22` = `mobile-photo-portal/recovery-draft-store.ts:24-31` | Byte-identical; `lib/quality-wi/render-image.tsx:7` imports the component copy |
| `buildPhotoAttachment` / `buildStepPhotoAttachment` | `mobile-photo-portal/photo-preparation.ts:7-73` = `lib/step-photo-image.ts:15-90` | Same constants (1280 px, 0.72), bodies and error strings |
| Process number from task | `gantt-timeline.tsx:427`, `mobile-photo-portal.tsx:66`, `domain/task-planning.ts:48` | Keep the domain one |
| `copyTextWithSelection` + clipboard fallback flow | `line-workspace.tsx:2012-2085`, `gantt-timeline.tsx:235-256, 1129-1191` | |
| Step-ref codec | encode `gantt-timeline.tsx:435-448`, decode `domain/task-scheduling.ts:16-27` | Co-locate in domain |
| `removeStepScopedCustomFields` | `domain/task-mutations.ts:16`, `domain/move-manufacturing-step.ts:28` | Mobile's copy at `mobile-photo-portal.tsx:83` **omits `STEP_PART_MENTIONS_FIELD`** (orphan mentions on mobile step delete) — a differing policy by accident |
| Summary-task WBS check, `taskWindowsOverlap`, successor count | `operator-allocation.ts:87-90, 138-149, 104`; `ie-smart-allocation-solver.ts:175-178, 180-191, 193`; `calculations.ts:202-205`; `report.ts:29-32` | After golden tests |
| Last-project / project-switch storage keys and readers | `sidebar-workspace-panel.tsx:23-27`, `user-nav.tsx:15-22`, `auth-project-gate.tsx:48-53, 112-130`, `sop-workspace-provider.tsx:19, 91-98`, `line-workspace/state.ts:37-40` | Plain module `lib/navigation-storage.ts` |
| Role predicates | 8 sites incl. `sidebar-workspace-panel.tsx:45-51`, `workspace-members-settings.tsx:84`, `lib/planner/workspace-store.ts:256` | Mostly equivalent; some add super-admin. `domain/workspace/roles.ts` |
| Settings `Block`/`Row` | `app-settings-panel.tsx:233-305` copied into `workspace-members-settings.tsx:43-63`, `workspace-list-settings.tsx:17`, `notification-admin-settings.tsx:14` "to avoid a circular import" | `settings-primitives.tsx` breaks the cycle |
| `formatDate` copy | `sop/editor/editor-formatting.ts:1-4` | Delete |
| `editor-types.ts` `ReviewSectionProps`; `step-photo-viewer.tsx:6` re-export of drawing functions | | Unused / test-only; delete |

**Differing policy (keep separate, name the difference):**

| Pair | Difference | Decision |
|---|---|---|
| Mobile vs shared scheduling (`domain/mobile-task-scheduling.ts` vs `task-scheduling.ts`) | Cycle fallback differs (mobile 9:30 vs shared 10:00 in the inconsistent-cycle fixture); shared has `preserveManualStartTaskIds` | Already characterized. **Do not merge.** But note §4.2 D8: the mobile policy has no runtime caller. Owner must decide whether the phone should reschedule at all before anyone touches either |
| Mobile vs planner realtime refresh (`mobile-photo-portal.tsx:782-898` vs `use-workspace-realtime.ts:112-205`) | Same 250 ms coalescing scaffold; mobile does wholesale task replace with no procedure-draft merge, full reload without scenario id, no `isRefreshTargetCurrent` stale-scope check, no concurrent-edit notice | Share only the **scheduler** (timers, coalescing, defer/flush); keep merge policies separate. Retires the stale "keep in sync with line-workspace.tsx" comments |
| Mobile vs planner write lock/status | Mobile has a per-task promise-chain serializer the planner lacks; planner has failure-aware `WorkspaceWriteTracker` the mobile lacks | Adopt the tracker inside `useMobileWrites`; keep the serializer |
| Mobile new-step draft vs planner procedure drafts | Different write units (single step via `saveMobileStepToSupabase` vs task procedure via `saveProcedureTaskUpdateToSupabase`), 450 ms vs 750 ms debounce, IndexedDB token store vs localStorage snapshot, no auto-retry vs 2.5 s retry | **Keep separate**; merging changes save timing and request volume |
| Annotation drafts vs mobile recovery store vs procedure drafts | localStorage/id-merge/auto-resubmit/no user scope vs IndexedDB/write-token/explicit review/user-scoped vs localStorage/project-keyed | Three policies, not duplication. The policy question is user scoping on shared machines |
| Photo upload (mobile `handlePhotoFiles` vs `use-workspace-media.ts:74-130`) | Same algorithm; mobile `Promise.all` vs desktop `settleWriteBatch` | Converge mobile onto `settleWriteBatch` now (Phase 1); share the core only after `useMobileWrites` exists |
| Step-list mutation rules (`procedure.tsx:426-508` vs `drawer.tsx:279-331`) | Sort, duration fallback, id scheme, check config all differ | Delete the drawer; the question dissolves |
| WBS ordering (`procedure.tsx:315` `parseFloat` vs `compareWbsValues`) | "1.10" sorts before "1.2" in procedure | Fix toward canonical; it is a defect, not a policy |
| Shell-store prelude (`shell-store.ts:100-161` vs `230-290`) | Equivalent, but both are legacy save paths | Leave unless candidate 4 needs a pure `computeStaleIds` + tripwire |
| Bearer-fetch helpers (7 sites, `refreshSession` vs `getSession`) | Session policy differs | One helper with an explicit `refresh` option |

---

## 7. The three highest-value next changes

1. **Fix date-only parsing (§0.1).** It prints wrong dates on controlled documents that gate approvals. It is a few lines, untested today, and precedes any refactor because a refactor that preserves it preserves the damage.

2. **Give mobile writes an owner (`useMobileWrites`, candidate 3), after the three `Promise.all` and stale-closure fixes (Phase 1 item 3).** This is the only extraction in the audit that directly dissolves a confirmed user-facing defect (a failed step save masked as "Saved" while realtime sync silently stops) rather than relocating code. It reuses `WorkspaceWriteTracker`, which the planner already proved, and it is the prerequisite the draft controller and photo-pipeline convergence both depend on. Medium effort, medium risk, tests exist to copy from.

3. **Characterize and fix the planner save-session protocol (Phase 1 item 5), then name it (`createPlannerSaveSession()`, candidate 4).** Four confirmed save-ordering defects and the highest-severity hypothesis in the codebase (stale cached scenario → diff-save deletes a teammate's rows) all sit on seven refs shared across six modules. The earlier extraction moved effects into hooks but not the protocol they implement; until the protocol is one object with named operations, every new hook that touches saves will add another writer to `setSaveState`. Do the behavior fixes as separate commits first so the store extraction can be verified as a pure move.

The Gantt pure layout model (candidate 9) is a close fourth: lower risk than any of the above, pure, currently untested, and it carries a second step-scheduling policy that nobody has characterized. It shares no files with item 3's Phase 1 fixes.

---

## Appendix A. Verification status

Lead-verified line by line: §0.1, SOP D1/D3/D5, mobile D1/D2/D8, planner D2/D3 and the tools-hook lock bypass, photo D1/D2, dead-flag constants, full-state-save callers, the lib→components import, hook/state counts for all six target files, the mobile "keep in sync" comment pointing at relocated code. All other findings were reviewed for internal consistency against the cited lines but not independently re-derived. Nothing was executed.

## Appendix B. Out of scope / not examined

Live database state (row counts, current RPC bodies), runtime reproduction of any defect, browser rendering, email/notification delivery, the paused CI browser jobs, `node_modules/next` docs.
