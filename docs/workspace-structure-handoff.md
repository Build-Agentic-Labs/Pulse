# Workspace structure refactor — review handoff (2026-10-03)

**Implementation is frozen.** The branch is ready for an independent review of the cumulative diff. It has not been merged, pushed or published.

## Branch state

| | |
|---|---|
| Branch | `codex/workspace-structure` (local only; no remote branch) |
| HEAD | `92211a0` before this handoff commit; the handoff and deferred-work note are the only later commit |
| Working tree | clean |
| Merge base with `main` | `edd45a9` ("test: wait for AWI edit readiness after cached reload"). `main` has not moved since, so the branch is 71 commits ahead and 0 behind. |
| Review diff | `git diff edd45a9...HEAD`: 72 files, +20,443 / −9,028 before this handoff |

The five core phases are complete:
- **Phase 1:** save ownership;
- **Phase 2:** media and tools;
- **Phase 3:** loading, realtime and scenarios;
- **Phase 4:** persistence foundations and media;
- **Phase 5:** reads, saves, scenarios and access.

Each phase has a ledger in `docs/workspace-structure-plan.md`. Optional Phase 6 has not started.

## Changed files (72), by kind

### Structural moves (29): behaviour-preserving extraction

- **`src/components/line-workspace.tsx`:** 6,655 lines at the merge base, now 3,652, with the rest split into 10 hooks under `src/components/line-workspace/`:
  - `use-procedure-drafts.ts`
  - `use-procedure-save-queue.ts`
  - `use-workspace-saves.ts`
  - `procedure-autosave-harness.ts`
  - `workspace-controller-types.ts`
  - `use-workspace-tools.ts`
  - `use-workspace-media.ts`
  - `use-workspace-scenarios.ts`
  - `use-workspace-realtime.ts`
  - `use-workspace-data.ts`
- **`src/domain/supabase-planner.ts`:** 4,932 lines at the merge base, now a 111-line re-export facade. The code lives in 15 leaves under `src/lib/planner/`:
  - foundations: `client`, `query-helpers`, `row-mappers`, `realtime`;
  - media and tools: `media-rows`, `media-storage`, `media-store`, `tool-store`;
  - Phase 5 stores: `access-store`, `workspace-store`, `read-store`, `scenario-store`, `shell-store`, `bom-store`, `task-store`.
- **`src/lib/awi/procedure-store.ts`:** one import re-pointed to `@/lib/planner/client`, the same function (approved Option A). This removed the only import cycle.
- **`src/lib/planning/store.ts`:** two comments only.

**Every facade signature is preserved and no importer changed.** For Phases 4–5 this was checked by a TypeScript checker dump of all 90 exports, plus a byte-identical statement check.

### Behaviour fixes (7 commits): reproduced defects, each with regression tests

| Commit | Fix | Logic changed in |
|---|---|---|
| `0b7f767` | Never cache one project's planner state under another project's key | `src/lib/planner-state-cache.ts` |
| `65fe170` | Keep procedure and BOM saves in the scope that issued them | `use-procedure-save-queue.ts`, `use-workspace-saves.ts`, `workspace-controller-types.ts`, `line-workspace.tsx` |
| `0e71301` | Limit the scenario-switch draft reset to the scenario being left | `use-procedure-drafts.ts`, `line-workspace.tsx` |
| `f49eddf` | Re-save recovered scenario drafts and never drop unsaved ones on switch | `use-procedure-drafts.ts`, `use-procedure-save-queue.ts`, `line-workspace.tsx` |
| `aee57b1` | Stop catalog tool operations when their task rewrite is refused | `use-workspace-tools.ts`, `line-workspace.tsx` |
| `8b14112` | Undo a failed catalog rewrite's step-tool changes on screen | `use-workspace-tools.ts`, `src/domain/step-tools.ts` (new helper) |
| `33b2797` | Stop zero-zone products deriving the Unzoned station twice | `src/domain/task-planning.ts` |

Three files exist only for these fixes: `planner-state-cache.ts`, `task-planning.ts` and `step-tools.ts`. The other fix lines sit inside the structural files above. **Review those hunks by commit, not as moves.**

### Tests and tooling (31)

**Unit and component tests (27):**
- `line-workspace.lifecycle.test.tsx` and `line-workspace.sync.test.tsx`: black-box, written against the original component;
- 8 hook test files and fixtures under `src/components/line-workspace/`;
- 10 `src/domain/supabase-planner.*.test.ts(x)` suites;
- `planner-derivation.test.ts`, `step-tools.test.ts`, `task-planning.test.ts`;
- `src/lib/awi/procedure-store.default-client.test.tsx`, `src/lib/planner-state-cache.test.ts`;
- shared helpers `src/test-support/in-memory-supabase.ts` and `src/test-support/recording-supabase.ts`.

**Browser tests (2):**
- `e2e/zero-zone-save.spec.ts` (new);
- `e2e/awi.spec.ts` (+71 lines: the cross-product save-scope regression).

**Tooling (2):**
- `scripts/check-client-bundles.mjs`: fails the check if the dev autosave harness ships;
- `scripts/release-check-fresh-db.mjs`: new fresh-database release check.

### Documentation (4)

- `docs/workspace-structure-plan.md`: plan and the five phase ledgers;
- `docs/correctness-scope.md`;
- `docs/tool-catalog-consistency-design.md`: proposal, blocked;
- `docs/restore-step-design.md`: proposal.

### Isolated experimental files (5): unused, not authorized for production

- `supabase/isolated/2026-10-03-step-recovery/README.md`
- `…/migrations/20261003210000_step_recovery_and_tool_changes.sql`
- `…/tests/step_recovery_test.sql`
- `…/tests/compat_cutover_test.sql`
- `scripts/verify-local-migration.mjs`: applies one migration file to the local isolated database on port 56322 only.

## No experimental migration in the active paths

Confirmed at HEAD:
- **Active migrations:** `supabase/migrations` holds 151 files, and none is `20261003210000`.
- **Unchanged paths:** the branch changes nothing in `supabase/migrations`, `supabase/tests`, `supabase/seed.sql` or `supabase/config.toml` (`git diff --name-status edd45a9..HEAD -- <paths>` is empty).
- **No references:** the experimental objects (`deleted_manufacturing_steps`, `delete_manufacturing_step`, `restore_manufacturing_step`, `apply_step_tool_changes`) appear in no active migration, test, seed file, or `src`/`app` file. The only script mentioning them is the release check, which asserts they are absent.
- **Fresh-database proof:** a database built only from the active migrations has none of these objects.

## Final validation

### Application gate

Re-run at HEAD `92211a0`, sequentially (build always finished before typecheck started). Logs are in `scratch/validation-2026-10-03/` (gitignored, local).

| Command | Result | Log |
|---|---|---|
| `npm run lint` | pass | `lint.log` |
| `npx vitest run` | 2,051 tests, 245 files pass | `vitest.log` |
| `npm run build` | pass | `build.log` |
| `npm run check:bundles` | pass: planner 277.0 KiB, largest chunk 124.0 KiB | `bundles.log` |
| `npm run typecheck` | pass | `typecheck.log` |
| `git diff --check edd45a9` | clean | `diff-check.log` |

### Database and browser checks

Last run on the Phase 5 code, which is unchanged since apart from documentation. The logs and inputs are in the same folder.

- **Retained isolated database `pulse-e2e`** (started from its existing data, never reset, returned to stopped):
  - 22 active pgTAP files, 398 assertions (`pgtap-retained.log`);
  - 20/20 browser cases (`browser-retained.log`).
- **Fresh disposable database:** `node scripts/release-check-fresh-db.mjs` passed on `pulse-release-20261004-060459` (`release-check.log`):
  - its identity was verified;
  - only the active migrations were applied;
  - the experimental objects are absent;
  - pgTAP 22/398 and the browser suite pass;
  - the retained database's ledger and row counts are unchanged afterwards.
- **Request counts:** identical per endpoint to Phase 4 on both databases: 61 on product open, 5 on the first switch to Procedure (`req-*.json`).
- **Mutations:** all 41 targeted mutations were caught before and after the Phase 5 moves (`mutations-*.txt`, runner `mutate_p5.py`). The "before" file predates the 2 BOM mutations; `mutations-after-moves.txt` shows all 41.

Two tools live outside the repository and are copied into that folder: the retained-database browser runner (`browser-retained.mjs`) and the request-count spec (`zz-request-counts.spec.ts`, copied into `e2e/` only for the run). The reproducible committed path is the release-check script.

## Known unresolved issues

### Existing behaviour: present at the merge base, not introduced by this branch

1. **Catalog rename, delete and tidy never persist step-tool references**, even when they succeed. The catalog rollout is **blocked**: old clients can return, and add-only child replacement silently ignores intended changes (`docs/correctness-scope.md` §3, `docs/tool-catalog-consistency-design.md`).
2. **Mobile Restore Step wipes every step tool and exploded view in the scenario**, and its shell part writes stale task rows. A proposal exists, not implemented (`docs/restore-step-design.md`).
3. **Whole-plan saves are separate requests, not one transaction.** A failure partway leaves the earlier writes in place. Their order is now pinned by tests.
4. **Most edits have no durable recovery across a reload.** Only procedure step name/instruction drafts survive (`docs/correctness-scope.md` §4).
5. **Draft storage is mixed-scope.** One in-memory draft map serves every scope the workspace has shown. The branch's fixes add tested protections but not structural isolation (Phase 1 ledger).
6. **Media and tool completions report into the visible save status unconditionally.** A master BOM save in flight briefly holds the navigation guard after an in-place product switch.
7. **Injected-client retry limitation.** The procedure save's retry reads through the page client. It is pinned by a test and recorded as follow-up in `docs/deferred-work.md` §6; it is not fixed.
8. **Browser-only persistence functions.** Many workspace, scenario and task-write functions take no client parameter, so they cannot run on the server.

### Regressions

None identified. All gates pass, request counts are unchanged, and every behaviour change is one of the seven fixes above.

### Measured costs and process notes (not functional regressions)

- **Client bundles grew** about 1.6–1.8 KiB gzip per entry across the branch, from module wrappers in Phases 4 and 5. The planner entry went from 275.2 KiB at the start to 277.0 KiB; the largest chunk is unchanged at 124.0 KiB. Runtime impact was not measured.
- **CI coverage dropped by exclusion, not equivalence.** CI no longer runs the two isolated pgTAP files (64 assertions), because they test unapproved objects.
- **The release check is not in CI.** It needs Docker and about five minutes, and each run deliberately leaves a stopped `pulse-release-<timestamp>` project. One exists now; removing it is a manual decision.
- **Before any production apply,** compare `supabase/migrations` with the production ledger, and apply only versions explicitly authorized (`docs/correctness-scope.md` §2, step 2).
