# UI cleanup implementation checkpoint — October 9, 2026

Open [before-and-after gallery](comparison.html).

- [x] Shared confirmations: native modal foundation, safe initial focus, Tab loop, Escape, restoration, unique title IDs, neutral confirmation wording. Both anchored and centered placements retain their layout/callbacks.
- [x] Backup panel: active prop, document-visibility check, retained state, coalesced reads, fresh read after creation. No backend job changes.
- [x] ThemedSelect: available-space positioning, horizontal clamp, upward placement independent of transform animation.
- [x] Crop controls: keyboard arrows and Shift acceleration; extracted shared pure bounds calculation, pointer contract preserved.
- [x] AWI details migrated to the shared modal foundation; before/after screenshots captured.
- [x] Remaining dialog callers classified; matching custom modal boundaries migrated. See behavior-closeout.md for coverage.
- [ ] Next component-system audit: shared Button/IconButton/field contracts and representative migrations.
- [ ] Optional future performance work: comparable traces before making any speed claims.

## Verification

- Full suite: 299 files / 2,477 tests passed before the last stale-read guard.
- After that guard: all 27 focused tests passed, including the new stale-read regression test; type checks and production build passed.
- Lint and diff whitespace checks passed.
- Local browser: real SOP confirmation opens with Cancel focused; Tab/Shift+Tab wrap; Escape restores opener. No record deleted.
- Local mock fixture: hidden backup reads increased 3 → 9 before; after fix remained 10 → 10 while hidden; returning initiated a refresh. Automated hidden-document, slow-request, retained-state and creation-race checks pass.
- Picker fixture: bottom-edge menu opens above, all eight options visible, Role 8 selectable. Browser verification caught a transform-animation conflict, fixed using independent translate positioning.
- Crop fixture: keyboard moves east edge; Reset/Done/Escape contract covered by tests. Original pointer bounds extracted intact into one pure function.

The fixture route was removed after capture. Its source is retained as `local-fixture.tsx.txt` for reproduction; it is not an application route and mocks backup reads. Current-run screenshots are unedited browser captures. No live data or live infrastructure was modified. Changes remain uncommitted in the audit worktree. Local preview runs on port 3217.

## AWI details follow-up

- Shared ModalSurface replaces the custom portal/dialog wrapper; unique title and datalist IDs prevent collisions.
- The number field still receives initial focus. Forward Tab loops at Save; Escape restores the opener.
- Pending saves still disable fields and cancellation. The existing procedure-save prerequisite, metadata update, error handling and successful reload are unchanged.
- Eight focused tests passed across AWI and shared feedback, covering focus restoration, failed save prerequisites, pending-close prevention, duplicate-submit guard, and preservation of edited values on metadata errors.
- Browser used a synthetic fixture with beforeSave returning false; no database writes. Fixture source is retained as awi-fixture.tsx.txt; route removed.

## Final behavior checkpoint

See [closeout and verification coverage](behavior-closeout.md). The confirmed behavior defects are addressed. Shared visual components remain a separate next phase, not marked complete by this work.
