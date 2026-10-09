# Structural refinement: SOP, mobile capture, and planner

## Scope and isolation

This records two structural passes across the three agreed areas, building on the previous planner data/save extraction. It is not a complete rewrite or a claim that every workflow has been audited. No visual redesign, save-policy change, schema change, or deployment is part of this pass. Local commit and merge were subsequently authorized after the user reviewed the test app.

Worktree: `codex/structure-refinement`. Runtime checks used a dedicated local Docker stack and synthetic records. The main checkout and hosted environment were not modified during implementation and validation; the authorized delivery step is a local merge only. Local email and AI-provider credentials are intentionally absent.

## Responsibility map

| Area | Coordinator retains | Extracted owner | Interface |
| --- | --- | --- | --- |
| SOP | Loading, permissions, draft persistence, uploads, reference data, approval workflow | `editor/reference-library-editor.tsx`: reference presentation, picker and rename input | Existing typed references, links, documents, and action callbacks |
| SOP | File operations and current annex rows | `editor/annexes-editor.tsx`: form fields, rename interaction, upload feedback | Existing functional row updater and file-operation callbacks |
| SOP | Screen composition | `editor/editor-controls.tsx`: shared add/remove controls | Labels and click callbacks |
| Mobile capture | Session timers, step drafts, recovery, saves, photos, tool persistence | `mobile-photo-portal/mobile-step-tools.tsx`: tool list and entry controls | Library, selected tools, add/remove callbacks, manual-entry state |
| Planner | Allocation preparation, review, applying results, and all existing save hooks | `lib/planner/smart-allocation-client.ts`: authenticated request/response handling | Existing request and promise of an allocation plan |

The mobile coordinator retains a small adapter for its two existing tool-picker call sites. There are no new fetching effects, caches, subscriptions, dynamic imports, or client boundaries. The extracted function bodies were compared against the baseline and are identical. Component props preserve current callback semantics, including functional annex updates against the latest rows.

## Why these boundaries

Reference selection and attachment rename failures can now be located and tested without reading the entire SOP coordinator. Mobile tool rendering is shared by new and existing steps without pulling capture recovery into the presentation layer. Planner request failures can be tested independently of the workspace's rendering and persistence code.

The earlier planner refactor already owns data, save queues, media, scenarios, tools, and realtime in separate modules. Those modules remain the owners. The disabled playback panel was deliberately left alone: relocating inactive UI would add little practical value in this pass.

## Second pass: larger screen sections

The SOP coordinator now composes dedicated document, overview, procedure, approval-routing, and Quality sections. Its navigation remains in the coordinator and is passed into the document section as a slot. Shared field/list controls and lifecycle history live together in `editor-fields.tsx`; review-date formatting has one owner. Overview/procedure section editors remain available to the existing review margin UI.

Mobile now composes `MobileProcessList`, `MobileNewStepEditor`, `MobileStepEditor`, and `MobileStepSummary`. Photo controls, draft fields, tool entry, and checks live with the appropriate step UI. List keys and draft keys are preserved on the new component boundaries. Mutable refs, timers, recovery, drag lifecycle, save queues, and all persistence callbacks remain in the coordinator. Step-label formatting is shared by the two step displays.

Before the final JSX return, both coordinator function bodies match the first-pass snapshots exactly. This checks that state initialization, effects, save and recovery handlers, and derived decisions were not rewritten while extracting presentation.

| Main component | Before both passes | After both passes | Reduction |
| --- | ---: | ---: | ---: |
| SOP editor | 3,498 | 2,436 | 1,062 (30%) |
| Mobile capture | 3,998 | 3,246 | 752 (19%) |
| Planner | 3,683 | 3,655 | 28 (under 1%) |

These are ownership changes, not equivalent reductions in total application code. The planner review did not justify a second large UI split: its existing feature modules already own the active panels and data/save responsibilities, and its remaining standalone playback panel is disabled. No speculative planner rewrite was added.

## Validation

- Full suite after the second pass: 292 files, 2,442 tests passed.
- Whole-project lint and TypeScript checks passed.
- Production build passed; the development server was stopped before building.
- Function-body comparison passed for the extracted SOP, mobile, and planner functions.
- Local browser: typed reference and annex field changes persisted when reopening a saved SOP.
- Local browser: annex upload to local storage and attachment rename persisted after reload.
- Local browser at phone width: tool assignment and removal persisted after reload.
- Second-pass local browser: a new step's name, description, seven-minute duration, uploaded photo, and assigned tool remained visible after closing and reloading; assertions specifically checked description and tool persistence, and the browser snapshot showed duration and photo.
- Six additional SOP section tests cover metadata-preserving title updates, read-only fields, review attention, author-only controlled changes, busy submission, Quality release controls, and unsaved approval routing.
- Built-app smoke check: SOP section navigation, saved mobile step, and planner loaded without browser page errors.
- Browser checks blocked non-local requests; no remote origins were observed in the SOP/mobile edit checks.
- Added regression coverage for concurrent annex row changes, failed rename retry, read-only attachment access, mobile tool deduplication/removal, and planner authentication/response failures.

The first browser probes required selector and navigation corrections: SOP navigation buttons include step numbers, `/sops/new` remains the creation route after save, and mobile reload restores the selected process. Final checks reopened the saved SOP and respected mobile selection restoration. No application behavior was changed to accommodate tests.

## Temporary CI browser pause

At the user's request, both browser jobs (`browser` and `quality-wi`) have a commented job-level false condition. Unit/component tests, lint, type checking, build, bundle budgets, and database tests remain configured. The workflow parses successfully. Removing those two conditions restores the jobs. This remains local and has not changed GitHub's running workflows or branch protection settings.

## Limits and follow-up

Live email delivery and AI-provider execution were not exercised. The isolated app reports unavailable notification delivery because no email credentials are configured; this is expected in this environment. Allocation transport behavior was verified with mocked responses, not a live provider call. Mobile camera hardware and every approval role were not re-tested by this pass.

The main components still coordinate substantial workflows. These passes improve ownership of selected, verified boundaries; further decomposition should begin with characterization of a specific workflow, especially SOP approval orchestration or mobile capture recovery, rather than a line-count target. Their existing save and recovery paths were intentionally retained.

Runtime probes, screenshots, local credentials, and test fixture metadata are ignored under `scratch/local-refinement/` and are not part of the source changes. `AGENTS.md` was generated by the installed Next.js development runtime and is separate from the refactor.

## Third pass: workflow ownership

The first two passes and the temporary CI pause were subsequently pushed to main. This third pass was implemented and validated in `codex/refinement-next`; the user subsequently authorized committing it and merging into local main. The previous local Docker database and storage volumes were preserved when the worktree moved.

### Implemented boundaries

- `editor/use-sop-draft.ts` owns the draft, edit-version tracking, save serialization, optimistic concurrency token, conflict state, autosave and unload warning. Workflow writes explicitly advance the token before enabling further saves. Reload and controlled-change adoption remain distinct operations, preserving their prior semantics.
- `editor/use-sop-attachments.ts` owns attachment loading, upload/open/rename/remove operations and operation feedback. Uploading a new annex still waits for its row to save. A reference document still saves the SOP first, uploads the file, then adds document metadata. Failed storage deletion retains the document row.
- `lib/sop/editor-workflow.ts` owns routing reads and the save/sign/submit sequence. The screen retains navigation, permission decisions, busy feedback, and reconciliation after a partially successful invitation request. Server-seeded routing and existing coalesced refresh behavior remain intact.
- Mobile's new-step editor receives focused draft, capture-display and media interfaces. Text changes make one workflow call; the coordinator updates state and schedules persistence together. Retry saving no longer requires the UI to assemble a snapshot. Existing-step editors receive only their own tool-entry value and delete-prompt action, rather than access to the whole tool-name map or a parent setter. The coordinator and UI now share the draft snapshot type.
- Gantt uses the existing `taskDependsOn` domain helper instead of a duplicate graph traversal. Argument direction, existing-map reuse, self-link rejection and cycle behavior are preserved.
- `lib/photo-annotation-export.ts` owns canvas drawing and raster export. Its function bodies were moved verbatim; viewer gestures, text-editing lifecycle, local recovery and persistence remain together. Existing drawing exports remain available for compatibility.

The SOP screen is now 1,989 lines, versus 2,436 at the previous checkpoint and 3,498 before these passes. The photo viewer is 2,315 lines, versus 2,599. Line counts are supporting evidence only: the benefit is separate ownership and independently testable operations, not fewer total source lines.

### Validation and limits

- Full suite: 295 files, 2,458 tests passed, including 16 new save, attachment and approval contract tests.
- The new tests cover stale-render saves, typing during an in-flight save, overlapping saves using fresh tokens, conflict recovery, workflow token adoption, save-before-upload ordering, failed deletion, save-before-signing, post-signing concurrency tokens, and completed-review routing.
- Whole-project lint, type checking and production build passed.
- Built local app: SOP sections, existing mobile step and planner opened without page errors.
- Built local app: a new SOP and annex row saved before attachment upload, and the row and renamed file remained after reopening.
- Built local app at phone width: a new step's name, description, nine-minute duration, photo and assigned tool survived reopening. Existing-step tool additions/removals and canceling a delete prompt also passed. Remote requests were blocked, and the mobile check observed none.
- Browser probes needed selector corrections for the responsive SOP navigation and the tool library's canonical capitalization; these did not require application changes.

Local email delivery, every approval role, device camera hardware, and new annotation gestures were not exercised end-to-end. Existing annotation rendering/lifecycle and capture recovery tests passed. The local application remains available on the same test port. No hosted database, deployment or CI configuration was changed by this pass.

### Consolidation decisions

Mobile scheduling and the shared scheduler are not behaviorally interchangeable: their fallback on dependency cycles differs, and the shared scheduler also supports preserving manual starts. Keep these policies explicit until their intended behavior is decided and characterized. Combining them solely because they look similar could alter dates.

Gantt drag/link interaction state and annotation pointer/text-editing state remain with their current coordinators. Their next useful boundary would be a separately characterized interaction controller, not another large prop bundle. The current pass removes proven duplication and independent export work without rewriting those state machines.

## Interface tightening and scheduling characterization

The SOP screen no longer receives raw document/save setters or the concurrency-token setter. It uses explicit actions to observe a workflow status, adopt a completed transition, report errors, clear feedback, or report an invitation retry success. Status-only reads still do not advance the save token, and successful workflow feedback does not mark unsaved content clean. Two new regression tests guard these distinctions.

Attachment handling now receives only the document ID, annex rows, persistence readiness and specific reference/annex update actions. It cannot patch unrelated document fields. Preview closing, upload feedback clearing and missing-attachment reporting are named actions. The upload-status contract lives in `editor/attachment-types.ts`, removing the workflow's type dependency on the UI component.

Mobile's scheduling function was moved unchanged to `domain/mobile-task-scheduling.ts` so both implementations can be tested directly. Eight comparison tests cover empty input, independent/linear/branching/joined/missing-dependency graphs, 80 deterministic acyclic schedules, consistent cycles, inconsistent cycles, self-links, invalid finish times and explicit preservation of manual starts. Both policies match on the tested ordinary graphs. In the inconsistent-cycle example, mobile schedules A at 9:30 while the shared policy schedules it at 10:00. With a manually placed dependent task at noon, both defaults schedule it at 9:00; the shared scheduler keeps noon only when its explicit preservation option is enabled. No scheduling rules were consolidated or changed.

Final follow-up validation: 296 test files and 2,468 tests passed, whole-project lint passed, production build passed, and post-build type checking passed. Local browser checks revalidated SOP navigation, attachment upload/rename persistence, existing mobile step fields/photos/tools, canceled deletion and planner loading. Validation was completed in the isolated worktree before the authorized local-main merge.
