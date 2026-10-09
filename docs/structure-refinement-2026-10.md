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
