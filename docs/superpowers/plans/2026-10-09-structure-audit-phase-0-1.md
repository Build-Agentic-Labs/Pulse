# Structure audit — Phase 0 + Phase 1 execution plan

Source: `docs/audits/2026-10-08-structure-audit.md` (§4 defects, §5 Phase 0 and Phase 1). Owner decisions 2026-10-09: scope is Phase 0 + Phase 1 only; delete the disabled playback simulation and the detail drawer; delete the dormant LLM-strategist allocation and its client module. Planning space and SOP approval routing are out of scope.

## Global Constraints

- Branch: `claude/pulse-structure-audit-e48946` (worktree). One commit per task, conventional commit format (`fix:` / `refactor:` / `test:`), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line.
- **Behavior fixes only. No boundary extractions, no new hooks, no file splits** beyond what a task names. Appearance, navigation, save timing, request volume, permissions and functionality stay identical except where a task states the intended change.
- **Sensitive, must not change unless the task says so:** SOP optimistic concurrency (`persistedUpdatedAt` token, `adoptWorkflowTransition`), approval transitions, save-before-upload ordering, server-seeded loading (`initial*` props, `skipInitial*Ref`), mobile capture timers / recovery drafts / queued writes / media uploads, photo annotation gestures / recovery / persistence, print pagination, the planner's granular save architecture. **Never add a full-state save path**; `savePlannerStateToSupabase` and `assertSaneStateDeletion` are untouched.
- Mobile scheduling (`domain/mobile-task-scheduling.ts`) and shared scheduling (`domain/task-scheduling.ts`) stay separate. Do not substitute one for the other.
- TDD: write the failing regression test first (RED), then the minimal fix (GREEN). Report RED and GREEN output in the task report.
- Gate before each commit: `npm run typecheck && npm run lint && npm test` all green, output pristine (no new warnings). Run focused test files while iterating; the full suite once before committing.
- Immutability: no in-place mutation of state objects (`pendingSaveRef.current.items = …` style assignments are to be replaced with new objects where touched).
- Controlled documents keep `formatDateControlled` (fixed MM/DD/YYYY); UI keeps `formatDate` / `formatDateTime`. No new local date helpers.
- CSS rule from CLAUDE.md: no additions to `app/globals.css` outside `@layer components`; feature styles are route/component scoped.

---

## Task 1: Date-only strings parse as local dates (Phase 0)

**Defect.** `src/domain/formatting.ts:74-78` (`formatDate`) and `:99-106` (`formatDateControlled`) call `new Date(iso)` and read local getters. For a date-only input such as `"2026-07-15"` the spec parses UTC midnight, so west-of-UTC machines render `07/14/2026`. Reaches SOP `effective_date` on the print preview (`src/components/sop/sop-print-preview.tsx:67-68`) and DOCX export (`src/lib/sop/export-docx.ts:347,350`), and signature dates via `formatDateControlled(row.signedAt.slice(0,10))` (`export-docx.ts:476`). Two existing noon workarounds prove prior encounters: `src/domain/work-instruction/release.ts:178-180` (`controlledDate`) and `src/domain/quality-wi/schema.ts:187`.

**Required behavior.**
1. Add one internal helper in `src/domain/formatting.ts`, `parseIsoDateInput(iso: string): Date` (exact name is free; one helper, not exported unless the two workaround sites need it): if `iso` matches `/^\d{4}-\d{2}-\d{2}$/`, construct a **local** date via `new Date(year, month - 1, day)`; otherwise `new Date(iso)` unchanged. Use it in `formatDate`, `formatDateTime` and `formatDateControlled`.
2. `export-docx.ts:476`: stop slicing a timestamp to a date-only string before formatting. Pass the full `signedAt` timestamp to `formatDateControlled` so the printed signature date is the local calendar day of the signature. If `signedAt` can be null/undefined there, preserve the existing fallback exactly.
3. Replace the two noon workarounds (`release.ts:178-180`, `quality-wi/schema.ts:187`) so they call the domain formatter (or the shared helper) instead of shifting to noon. Their rendered output for a date-only input must be identical to today's output on a west-of-UTC machine (they were already producing the correct day).
4. Delete `src/components/sop/editor/editor-formatting.ts` (a copy of `formatDate` without the null guard) and point its importers at `@/domain/formatting`.

**Tests (RED first)** in `src/domain/formatting.test.ts`, pinned to a west-of-UTC zone. Vitest runs under the ambient TZ; set it per test with `process.env.TZ = "America/Los_Angeles"` is not reliable after startup in Node, so instead add a `test:tz` variant is NOT wanted either. Use this approach: assert against the local-constructed expectation, i.e. compare `formatDateControlled("2026-07-15")` to `"07/15/2026"` (this fails today on any west-of-UTC machine and passes on UTC machines; CI runs in UTC). To make the regression observable on CI too, add a second assertion that uses `vi.stubEnv` is also unreliable for TZ — therefore ALSO add a unit test on the helper's branch directly: `formatDateControlled("2026-07-15")` must equal `formatDateControlled(new Date(2026, 6, 15).toISOString())`, and `formatDateControlled("2026-07-15T12:00:00Z")` must still use timestamp semantics. Add the same shape for `formatDate`. Add a test for `export-docx.ts`'s signature-date rendering if a test file exists there; if not, cover it through the release/quality-wi tests already present (`src/domain/work-instruction/release.test.ts`, `src/domain/quality-wi/schema.test.ts` or wherever `controlledDate` is tested) — update those expectations only if they encoded the noon shift.

**Must not change.** `formatDateControlled` stays locale-independent MM/DD/YYYY. Invalid input still returns the input string (`formatDateControlled`) or `""` (`formatDate`). No call site outside the files named here changes.

**Files.** `src/domain/formatting.ts`, `src/domain/formatting.test.ts`, `src/lib/sop/export-docx.ts`, `src/domain/work-instruction/release.ts`, `src/domain/quality-wi/schema.ts`, `src/components/sop/editor/editor-formatting.ts` (delete) + its importers.

---

## Task 2: Photo viewer — photo-switch cross-save, pointer cancel, per-move draft writes (Phase 1)

**Defects** in `src/components/step-photo-viewer.tsx`:
- **D1 (data loss).** The text-measurement `useLayoutEffect` at 636-668 depends on `photo.id` and `persistAnnotations`. On a photo switch it runs before the restore `useEffect` at 558-580, while `annotations` still holds the previous photo's items, and `persistAnnotations` (380-399) has already captured the new `photo.id`. If any previous-photo text item lacks `height` (legacy data; `normalizePhotoAnnotationDocument` leaves it `undefined`, `src/domain/photo-annotations.ts:221-224`), line 662 calls `persistAnnotations(prevItems)`, setting `pendingSaveRef = {photoId: NEW, items: prevItems}` and writing a draft for the new photo; the restore effect's `flushPendingAnnotations()` (559) then sends the previous photo's items to the new photo via `onUpdatePhoto`. Secondary: navigated-to photos are never re-measured because the effect's deps do not change.
- **D2.** The overlay wires `onPointerDown/Move/Up` only (1930-1932); `dragState.pointerId` / `textBoxDragPending.pointerId` (887, 915) are stored but never compared (1022-1270). A `pointercancel` (touch pan/pinch) leaves drag state stuck: background pointerdown is ignored (974) and the next pointer keeps dragging the stale annotation.
- **D4 (perf).** Every pointermove during drag/resize calls `updateAnnotations` (1080-1123) → `writeAnnotationDraft` (386), which reads, parses, normalizes and re-stringifies the whole localStorage draft including image-overlay data URLs.
- **D3 (hygiene).** `pendingSaveRef.current.items = merged.items` at 592 mutates in place.

**Required behavior.**
1. `persistAnnotations` returns early without writing a draft or scheduling a flush when `incomingRef.current.id !== photo.id` (the viewer is mid-switch). Remove `photo.id` from the layout effect's dependency list and instead trigger measurement of height-less text items from the restore path (so a navigated-to photo with legacy text gets measured once after restore, with the correct photo id). The measurement result must still be persisted for the correct photo.
2. Add `onPointerCancel` and `onLostPointerCapture` handlers on the overlay that reset `dragState`, `textBoxDragPending` and any in-progress draft (arrow/shape/freehand/callout) and release capture. In `handleOverlayPointerMove` / `handleOverlayPointerUp`, ignore events whose `pointerId` differs from the stored one. Do **not** add `touch-action` CSS changes in this task (that changes touch scrolling behavior; out of scope).
3. Draft persistence to localStorage happens on the debounced save (inside the 350 ms timer callback, before `flushPendingAnnotations`) or on gesture end, not on every pointermove. The in-memory `pendingSaveRef` still updates per move so an unload flush captures the latest state. Unload/pagehide flush (598-609) and unmount flush (682-686) must still write the draft before calling `onUpdatePhoto`.
4. Replace the in-place mutation at 592 with a new object.

**Tests (RED first)** in `src/components/step-photo-viewer.lifecycle.test.tsx` (extend; follow its existing mocking of measurement at 32-60):
- Three photos; photo 2 carries a legacy text callout with no `height`. Navigate 1→2→3. Assert `onUpdatePhoto` is never called with photo 3's id carrying photo 2's items, and that photo 2 received a measured-height update under its own id.
- Start a default-mode drag on an annotation, dispatch `pointercancel`, then pointerdown on the background: assert the background click deselects (i.e. drag state was cleared) and no further `onUpdatePhoto` arrives from stale drag.
- During a drag, count `localStorage.setItem` calls (spy): zero per pointermove, one at gesture end or debounce.

**Must not change.** The 350 ms debounce; flush-on-unmount and on-unload semantics; restore-and-auto-submit on open (561-569); `mergeAnnotationDocuments` merge rules; existing tests in `step-photo-viewer.test.tsx` and `.lifecycle.test.tsx` stay green unchanged except where a test asserted per-move draft writes.

**Files.** `src/components/step-photo-viewer.tsx`, `src/components/step-photo-viewer.lifecycle.test.tsx`.

---

## Task 3: Mobile — settle upload batches; stale "Save & next" timer closure (Phase 1)

**Defects** in `src/components/mobile-photo-portal.tsx`:
- **D3.** `Promise.all` over uploads at 1445-1450 (`persistNewStepDraft`), 1900-1902 (`handlePhotoFiles`) and 2036 (`retryFailedStepSaves`) rejects on the first failure, so the write lock is released and sibling photos are rolled back locally while their uploads are still in flight (they later reappear on refetch as ghosts). The planner already fixed this pattern with `settleWriteBatch` (`src/domain/workspace-save-status.ts:9-15`, used at `src/components/line-workspace/use-workspace-media.ts:95`): waits for every member, then rejects with the first error.
- **D7.** `goToNextManufacturingStep`'s `onSaved → onReady` callback (around 2657-2695; the check is at 2692) tests `captureTimer.running` from the render that issued the click. If the user taps Stop while the save is in flight, `advanceCaptureTimerLap(nextStepId)` (2518-2531) runs against a stopped timer and writes a non-running timer with `activeStepId` set and `taskId: null` into the session (535-547).

**Required behavior.**
1. Replace the three `Promise.all` upload/save batches with `settleWriteBatch` (import from `@/domain/workspace-save-status`). Rollback and error handling after the batch stay as they are, but now run only after every member has settled.
2. In the `onReady` callback, read the live timer via `captureTimerRef.current` and only call `advanceCaptureTimerLap(nextStepId)` when that timer is running **and** its `taskId` equals the task being edited. Same fix for the stale `newStepMotionPhase === "exit"` guard at ~972 only if it is on the same code path; otherwise leave it.

**Tests (RED first)** in `src/components/mobile-photo-portal.test.tsx` and/or `src/components/mobile-photo-portal.capture-session.test.tsx` (follow their existing facade mocking):
- Existing step: two photos uploaded, first upload rejects, second resolves after a delay. Assert the lock-release/rollback happens after both settle, and the second photo is not rolled back (it remains in state) — or, if the existing rollback semantics intentionally remove all photos of the batch, assert that rollback runs after both settle and no "ghost" re-upload is attempted. Pick whichever matches the current code's intent; document the choice in the report.
- "Save & next" with a running timer; stop the timer while the save promise is pending; assert the session write does not contain a timer with `activeStepId` set and `taskId: null`.

**Must not change.** Per-task write ordering (`enqueueTaskScopedWrite`, 1271-1288); optimistic data-URL insert then swap; the no-retry policy for uploads; the 450 ms draft debounce; the 180 ms motion timer; request counts.

**Files.** `src/components/mobile-photo-portal.tsx` and the two test files.

---

## Task 4: SOP editor — attachment refetch key, annotation poll gating, Escape layering (Phase 1)

**Defects** (non-routing) in `src/components/sop/sop-editor.tsx`, `src/components/sop/editor/use-sop-attachments.ts`, `src/components/sop/sop-print-preview.tsx`:
- **D3 (request volume).** `use-sop-attachments.ts:253-274` keys the annex-file list effect on `persistedUpdatedAt`, which advances on every autosave (`use-sop-draft.ts:184-185`), so every autosave issues `listSopAnnexFiles`; the new array identity then re-rasterizes every attached PDF in a mounted print preview (`sop-print-preview.tsx:381-384, 797-886`).
- **D5 (request volume).** `sop-editor.tsx:1304-1322` polls `listSopReviewAnnotations` every 15 s plus on focus and visibilitychange for every editor mount (unsaved SOPs with a client-generated id, effective SOPs, drafts never sent for review), independent of the coalesced routing refresh.
- **D6.** Effect 442-475 clears open remarks and submissions on a read error (467-471) but leaves addressed remarks; the poll retains state on error (1317).
- **D1.** Two window `keydown` Escape listeners with no layering: `sop-editor.tsx:774-781` (audit panel) and `sop-print-preview.tsx:438-457` (preview). With the audit panel open on Draft Review, one Escape closes the panel and also fires the preview's `onClose`. `src/components/sop/reference-pdf-preview.tsx:144-150` shows the correct pattern (capture-phase listener + `stopImmediatePropagation`).
- **D10.** `sop-print-preview.tsx:449-453` calls `onClose()` inside a `setInlineDoc` updater.

**Required behavior.**
1. `use-sop-attachments.ts`: key the list effect on `hasPersistedSop` (already an input) instead of `persistedUpdatedAt`; keep the `workspaceId`/`sopId` keys. Attachment upload/rename/remove paths that already re-list after their own write keep doing so. If `persistedUpdatedAt` is then unused by the hook, remove it from the hook's inputs and its call site.
2. `sop-editor.tsx` annotation poll: only run (interval, focus, visibilitychange) when `hasPersistedSop` is true **and** the SOP is review-relevant: `sop.status === "in_review"` or there is review history (`hasReviewHistory`, defined at ~556). On error, retain the last state (keep current poll behavior). Keep the 15 s interval and the visibility check.
3. Effect 442-475: on read error, retain all three arrays (do not clear). This aligns the two read paths' error policy to "retain".
4. Escape: make the audit panel's listener and the print preview's listener capture-phase and call `stopImmediatePropagation()` after handling, mirroring `reference-pdf-preview.tsx:144-150`, so the topmost layer consumes the key. Order of precedence when several are open: reference PDF preview → inline doc inside print preview → print preview `onClose` → audit panel. Verify by reading how each registers; do not introduce a global key-handling module.
5. Move `onClose()` out of the `setInlineDoc` updater: read the current inline-doc value from a ref or state and branch outside the updater.

**Tests (RED first).** `src/components/sop/editor/use-sop-attachments.test.tsx` (extend): advancing `persistedUpdatedAt` without changing `hasPersistedSop` issues no extra `listSopAnnexFiles` call. A new or extended `sop-editor` behavior test is acceptable only if a lightweight harness already exists; otherwise write the poll gating as a small pure predicate `shouldPollReviewAnnotations({ hasPersistedSop, status, hasReviewHistory })` in `src/domain/sop/` with its own test, and use it in the effect. Escape layering: a jsdom test on `SopPrintPreview` or a focused test of the handler is acceptable; if `SopPrintPreview` is too heavy to mount, extract the keydown handler as a small testable function in the same file and test that it calls `stopImmediatePropagation` and closes exactly one layer.

**Must not change.** Server-seeded first paint (`skipInitialReviewFetchRef` skip logic); the coalesced routing refresh (untouched — approval routing is out of scope); concurrency token behavior; the "cycle-scoped, not hash-scoped" filtering comment and logic at 461-466; print pagination.

**Files.** `src/components/sop/editor/use-sop-attachments.ts` (+ test), `src/components/sop/sop-editor.tsx`, `src/components/sop/sop-print-preview.tsx`, optionally `src/domain/sop/review-polling.ts` (+ test).

---

## Task 5: Planner — shell lock release/drain, restore autosave, echo suppression (Phase 1)

**Defects** in `src/components/line-workspace.tsx` and `src/components/line-workspace/use-workspace-saves.ts`:
- **D1.** `reorderTaskGroups` (2831-2966) releases `saveInFlightRef` only `if (isCurrent())` (2961). A project switch while the reorder RPC is in flight leaves the lock held for the mount; later `persistPlannerState` calls queue into `queuedSaveStateRef` (`use-workspace-saves.ts:186-190`) and nothing drains it.
- **D1b.** Lock holders in `use-workspace-media.ts` (81/126, 153/288, 354/418) and `reorderTaskGroups` (2932/2961) release the lock without draining `queuedSaveStateRef`, so a shell autosave queued during a media operation stays "saving" until the next edit or flush.
- **D4.** `restorePlannerSnapshot` (2730-2732) sets `remoteRefreshAppliedRef.current = true` together with `markDirty()`. The autosave effect (`use-workspace-saves.ts:465-468`) consumes that one-shot flag and skips, so "Restore Zone / Restore Task(s)" are not autosaved until a later edit, flush or pagehide. Procedure save completion also sets the flag (`use-procedure-save-queue.ts:389-391`) and can cancel a pending 900 ms shell autosave.
- **D5 (HYPOTHESIS, characterize only).** Switching back to a cached scenario applies the cache without reload (`use-workspace-scenarios.ts:139-144`, mirror at `line-workspace.tsx:554-558`).

**Required behavior.**
1. `reorderTaskGroups`: release `saveInFlightRef` in `finally` unconditionally; `isCurrent()` continues to gate state updates and notices only.
2. Introduce one small helper **inside `use-workspace-saves.ts`** (no new file): `releaseShellLock()` that sets `saveInFlightRef.current = false` and, if `queuedSaveStateRef.current` is set, triggers the same drain path the hook already uses after a completed save. Return it from the hook and use it at every lock release site in `use-workspace-media.ts` and `reorderTaskGroups` instead of the raw `saveInFlightRef.current = false`. The hook already owns the lock; this does not add a new owner.
3. `restorePlannerSnapshot`: do not set `remoteRefreshAppliedRef`. Restore is a user edit and must autosave on the normal 900 ms path.
4. Autosave effect (`use-workspace-saves.ts:465-468`): consume the echo flag only when `plannerDirtyRef.current` is false; if the planner is dirty, clear the flag and proceed with the save. Keep the existing 900 ms timing.
5. D5: write a characterization test only (no behavior change): switch A → B (B cached), simulate a server-side task insert on B while on A, switch back to B, make one edit, and assert what the diff-save would delete. Record the observed behavior in the test name/description and in the report. The fix is deferred to the owner.

**Tests (RED first)** in `src/components/line-workspace/use-workspace-saves.test.tsx` (extend; 545 lines of existing patterns) and `src/components/line-workspace/use-workspace-media.test.tsx`:
- Lock held + queued save → `releaseShellLock()` drains exactly one save.
- Reorder with scope change mid-request: lock is released.
- Restore snapshot → a save is issued after the 900 ms timer without any further edit.
- Dirty planner + echo flag set → save still happens; clean planner + echo flag → save skipped (existing behavior preserved).
- D5 characterization as above (in `use-workspace-scenarios` test; create `src/components/line-workspace/use-workspace-scenarios.test.tsx` if absent, following `use-workspace-saves.test.tsx` harness patterns).

**Must not change.** 900 ms shell autosave and 750 ms procedure debounce; request counts; `savePlannerShellToSupabase` diff semantics and tripwires; `use-workspace-tools.ts` (its out-of-lock shell save is a separate known item; leave it); the per-render realtime forwarder.

**Files.** `src/components/line-workspace.tsx`, `src/components/line-workspace/use-workspace-saves.ts` (+ test), `src/components/line-workspace/use-workspace-media.ts` (+ test), `src/components/line-workspace/use-workspace-scenarios.test.tsx` (new, characterization only).

---

## Task 6: Delete dead and inert planner code (Phase 1)

Owner decisions 2026-10-09: delete playback simulation and the detail drawer; delete the dormant LLM-strategist allocation and its client module.

**Remove** (all confirmed unreachable; verify each with grep before deleting):
- `src/components/line-workspace.tsx`: `SIMULATION_ENABLED` (203-210) and everything gated on it — `PlaybackPanel` (217-382), playback state `currentMinute`/`speed`/`isPlaying`/`playbackCollapsed` (449-452), the interval effect (1067-1085), the button (3523-3535), the render (3627-3644), Gantt props `currentMinute`/`showPlaybackMarker` (3562-3563), the padding branch (3393). The detail drawer chain: `detailDrawerCollapsed`/`detailDrawerWidth`/`isResizingDetailDrawer` (453-456), `detailDrawerResizeRef` (514), the outside-click listener (1087-1104), resize effect (1146-1182), `startDetailDrawerResize` (1253-1263), `showDetailDrawer` (1562), `--detail-drawer-width` (1579), the render (3597-3624), the `DetailDrawer` dynamic import (193). `_smartAllocateHeadcount` (2168-2575) and its import of `smart-allocation-client` (3); `_updateStationOperators` (2657-2665); `chromeStatusTimerRef` and its effect/clears (513, 1144, 1184-1189) if nothing arms it; `mergeServerTaskIntoLocalTaskRef` (668, 671) if it has no reader.
- `src/components/line-workspace/drawer.tsx`: delete the file and its test(s) if any exist only for it.
- `src/lib/planner/smart-allocation-client.ts` and `.test.ts`: delete; remove the facade re-export if `src/domain/supabase-planner.ts` exposes it.
- `src/components/gantt-timeline.tsx`: the `"task"` row kind is never produced by `visibleRows` (745-772). Remove the `GanttRow` `"task"` variant, the table branch (1919-2060), the SVG branch (2345-2430), the `updateStartLinkDraft` task branch (1073-1079), `getTaskState` (149-177) if then unused, and `highlightedRowIds` (505; only ever set to an empty set at 1038, 1125, 1195) with its reads. Remove the now-unused `currentMinute`/`showPlaybackMarker` props and the playback marker render (2484-2512).
- Any CSS classes used only by removed JSX (grep `app/globals.css` and route-scoped CSS; remove only exact-match orphans).

**Must stay.** Workspace snapshot parsing stays tolerant of the persisted `detailDrawerCollapsed` field (`src/components/line-workspace/state.ts:240`) — keep the parser accepting and ignoring it. `OperatorUtilizationPanel`, the deterministic allocation path (`app/api/smart-allocation/route.ts`, `domain/operator-allocation.ts`, `domain/ie-smart-allocation-solver.ts`) and `analytics.tsx` stay. `createPlannerSupabaseClient`'s other facade exports stay.

**Tests.** No new behavior; existing `line-workspace*.test.tsx`, Gantt sync test, `state.test.ts` must pass unchanged (except deleting tests that only exercised removed code). `npm run build` must pass (dynamic import removal). `npm run check:bundles` if it runs locally.

**Files.** As listed. Expect roughly 1,900 deleted lines.
