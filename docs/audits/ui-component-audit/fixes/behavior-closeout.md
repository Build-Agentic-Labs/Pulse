# Behavior audit closeout — October 9, 2026

## Result

The confirmed behavior defects from the audit are addressed: confirmation focus/wording, hidden backup polling, clipped dropdowns, and keyboard crop adjustment. The remaining dialog review is complete at the source/contract level, with representative local browser checks. This is not a claim that every route, permission role, device or screen-reader combination has been exercised.

The next audit is the full component system: consistent visual families, variants, and one reusable implementation per relevant pattern. Button/IconButton/field consolidation from finding 6 belongs in that pass. Performance profiling remains a separate measurement opportunity; this work makes no speed claim.

## Dialog classification and changes

| Surface | Result | Evidence |
|---|---|---|
| Shared confirmations and AWI details | Native ModalSurface, safe initial focus, unique labels, focus return; pending guards retained | Browser pairs 01/05; focused interaction tests |
| Command palette, bulk editor, new AWI | Shared modal boundary; existing search/form/actions retained | Browser pairs 06/07/10; shared boundary tests; bulk nested Escape verified |
| Image/video lightboxes | Shared boundary; global shortcuts limited to a lightbox target | Browser pairs 08/09; media focus-boundary test; no video playback claim |
| SOP preview | Modal when standalone; embedded stays a region; restores focus after loading; nested dismissal order retained | Real local SOP pair 11; Escape/return-focus browser check |
| Gantt mapping/predecessor, PFMEA, SOP review feedback, referenced PDF | Shared modal boundary; existing callbacks and close policies retained | Source review and full suite; no individual browser screenshot certification |
| Work-instruction control/print preview | Shared boundary; control suspension closes its layer while retaining its draft; standalone print page remains standalone | Existing work-instruction/panel tests; retained-state shared test; print CSS source review |
| Crop editor | Shared nested modal plus keyboard resizing with common pointer bounds | Pair 04, crop/domain tests, 21 photo-viewer regression tests |
| Photo viewer | Existing specialized annotation/Tab handling retained; corrected capture/restore of opener and isolation from nested native modal shortcuts | Source review and photo-viewer regression tests |
| Member access, checklist PDF, WI conversion, Quality WI preview | Existing native dialogs retained; removed redundant Quality preview window Escape handler | Source review, existing suite |
| Board filters, phone QR, text-link popup, SOP audit panel and inline review comments | Intentionally nonmodal; retained | Source classification |

The initial inventory's literal role scan missed conditional document-preview markup; this pass explicitly reviewed those conditional cases too.

## Validation

- Full suite: 300 files / 2,483 tests passed before the final small SOP loading-focus correction. That correction was then verified in the local browser and five work-instruction panel regression tests.
- Native dialog open/close are stubbed in jsdom only; browser checks verify actual modal layering and keyboard behavior. Tests now dispatch the native cancel event rather than pretending a window key event implements browser defaults.
- Nested dropdown Escape closes only the dropdown; the next Escape closes its modal. Search with zero options is covered.
- Tab boundaries include native audio/video/iframe/contenteditable controls.
- Typecheck, lint, production build and diff whitespace checks passed after the final source changes.
- Existing save/data callbacks are retained; this pass did not perform real deletes, create backups, release documents, or access the hosted database.

## Screenshot evidence

[Before/after gallery](comparison.html) contains eleven pairs. It distinguishes real local SOP screens from synthetic fixtures. The modal rollout has representative screenshots, not one capture for every migrated caller. Similar-looking pairs demonstrate preserved visuals; keyboard focus, Escape layering and request counters provide the behavior evidence.

Temporary app fixture routes were removed; their source is saved as text beside this report. No test route ships in the build. Changes remain uncommitted on codex/ui-component-audit, with no merge, push or deployment.
