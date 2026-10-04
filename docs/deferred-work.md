# Deferred work — decided, not yet done

Companion to `nextjs-refactor-plan.md`. These items are **intentionally deferred**,
not forgotten and not defects. Each says what it is, why it's parked, and what
finishing it involves.

Last reviewed: 2026-07-25

---

## 1. Solo self-review test mode — RETIRED 2026-07-25

**Decision: retired. This section previously read "KEEP, DO NOT REFACTOR" — that is
no longer true, and anything relying on it should be re-checked.**

Migration `20260723133000_required_department_approvers.sql` replaced the feature's
two RPCs with stubs — `sop_self_review_test_active()` returns `select false`,
`enable_sop_self_review_test()` raises "Solo self-review is no longer available;
assign a required departmental approver" — and cleared `self_review_test` on every
row. It was authored 2026-07-23 but only applied live on **2026-07-25**, because a
defect in the same migration blocked `db push` until then; so anyone reading this
between those dates would have seen the feature still working.

Replaced by the required-departmental-approver roster: solo review is now impossible
by design rather than by exception, since a seat's signer can never be the author.

### What is left, and how to remove it

Everything below is inert — `test_self` and `v_test_self` can never evaluate true —
but it is still present:

| Piece | Location |
|---|---|
| Column | `sops.self_review_test` (all rows false) |
| RPC (enable) | `enable_sop_self_review_test(text)` — raises |
| RPC (check) | `sop_self_review_test_active(text)` — returns false |
| Guard branches | `test_self` in `enforce_sop_transition()`, `v_test_self` in `sign_sop()` |
| Store field | `SopControl.selfReviewTest` (`src/lib/sop/review.ts`) |

`enableSopSelfReviewTest` and `soloSelfReviewReady` no longer exist in the app.

Removal is optional cleanup, not urgent — inert code costs nothing at runtime. If
done, the one hard constraint is that **`enforce_sop_transition()` and `sign_sop()`
must be patched in place** via `pg_get_functiondef` + guarded `replace`, never
rewritten from a file: no file in the repo holds their current text. Rewriting from
a checked-in version silently reverts every later migration — on 2026-07-25 that
nearly reinstated a removed approval gate that would have blocked every
`draft -> in_review`. See CLAUDE.md's hard rules.

The old "interim hardening" note about the enable RPC being reachable by any
authenticated user is moot: the RPC now raises for everyone.

---

## 2. Unwired modules — decide: finish or delete

Three modules exist, are tested, and are imported by nothing. Git history shows
each in exactly one commit, never modified — the signature of a domain layer built
ahead of its UI, **not** abandonment. Do not delete on "no importers" evidence.

| Module | Lines | Added | Commit |
|---|---:|---|---|
| `src/domain/schedule-import.ts` (+ 53-test file) | ~349 | 2026-07-08 | `2624e0f` "schedule-import resolution module + dry-run gate" |
| `src/domain/sop/numbering.ts` | ~small | 2026-07-07 | `f5a237f` |
| `src/domain/sop/version.ts` | ~small | 2026-07-07 | `f5a237f` |

`numbering.ts` and `version.ts` shipped in the same commit as `canTransitionSop`,
so all three are likely one unfinished intent: SOP document numbering, version
bumping, and transition validation.

**To finish:** wire `numbering.ts` into SOP creation, `version.ts` into the
effective→draft revision path. `schedule-import.ts` needs a UI entry point for
schedule import with its dry-run gate.

---

## 3. `canTransitionSop` — the untested-approval-workflow problem

`src/domain/sop/lifecycle.ts:77` has 29 well-written tests and **zero call sites**.
It is a TypeScript mirror of the Postgres trigger that does the real enforcement.
The mirror can drift from the trigger indefinitely while the suite stays green.

Two honest options:
- **(a)** Wire the app to call it as a client-side pre-check, making the 29 tests
  meaningful and improving UX (buttons disable instead of erroring).
- **(b)** Delete it and test the real trigger with SQL-level integration tests.

What must not happen: carrying the refactor forward believing the SOP approval
workflow is tested. It is not.

Recommendation: **(a)** — it's less work and the UX gain is real. Note this
interacts with item 1: the pre-check must respect solo test mode.

---

## 4. Complete backup coverage

**Status: database fully covered as of 2026-07-18 evening; storage partially.**

Done:
- `scripts/backup-flexboost.mjs` — 147.4 MB, 918 files, 898 photo assets.
  Planner data + step photos for the FlexBoost project.
- **Full database dump** (Docker + WSL2 now installed): `backups/db-data-*.sql`
  (all 46 populated tables — SOPs, signatures, departments, work orders, access
  control included; row counts verified), `db-schema-*.sql`, `db-roles-*.sql`.
  Command: `npx supabase db dump --db-url $DATABASE_URL [--data-only|--role-only]`.
  Note pg_dump's own hint: restore of a data-only dump needs `--disable-triggers`
  or constraint handling — another reason to test restore before relying on it.

Not covered:

Remaining gaps:

| Gap | Detail |
|---|---|
| Storage files | pg_dump captures file *metadata* rows only. `step-photos` bucket files are covered by the FlexBoost script; **`task-videos` and SOP annex files have no file-level backup** |
| Restore | No restore has been tested, and the data-only dump needs `--disable-triggers` handling. An untested backup is a guess |
| Cadence | Dumps are manual. Before real data: schedule them (or confirm Supabase plan PITR) |

**Recommended approach:** a script using the `pg` npm package against `DATABASE_URL`
— no Docker or Postgres server install needed (the Supabase CLI's `db dump`
requires Docker, which is not installed). Enumerate tables dynamically from
`information_schema` so coverage cannot drift as features are added, which is
exactly how the SOP tables got missed.

Note: **schema is already safe in git** — ~90 migrations under
`supabase/migrations/`. The genuine risk is data. Complete data + those migrations
is a real restore path.

Also worth checking: whether the Supabase plan includes Point-in-Time Recovery or
automatic daily backups. If so, that outranks anything scripted here.

**An untested restore is a guess.** Prove one works before Stage 3.

---

## 5. Smaller items

- **`/design/nothing` may be broken.** It hung at "LOADING WORKSPACE" when checked.
  Separately, `src/theme/nothing-design.css` (404 lines) is imported by nothing —
  the only CSS import in the repo is `globals.css` at `app/layout.tsx:7`. Possibly
  related. Decide: delete the file, or wire it into that route.
- **No CI exists.** No `.github/`. Nothing runs the 336 tests. (This is Stage 0
  work in the main plan, listed here for visibility.)
- **`org_tool_access` write policy is not workspace-scoped**
  (`20260601123000:103-115`). Impact is nil today — single workspace — but it
  becomes a real multi-tenancy defect the moment a second workspace exists.
- **Rate limiting is in-memory and per-instance** (`src/lib/api-auth.ts:72`). On
  serverless, limits multiply by instance count. Affects LLM-spending routes.

---

## 6. Planner procedure retry ignores an injected client — recorded 2026-10-03, not fixed

**What:** `saveProcedureTaskUpdateToSupabase` (`src/lib/planner/task-store.ts`) accepts an optional
client and uses it for its writes. On a version conflict, however, its single retry re-reads the task with
`loadTaskFromSupabase`, which takes no client parameter and always uses the page's shared planner client.
`saveManufacturingStepToSupabase` and `mergeLatestTaskToSupabase` have the same dependency.

**Impact today:** none observed. The only production caller (the browser procedure save queue) injects no
client. A future server caller that injects a per-request client and hits a version conflict would get the
browser-only trap error on the retry read, instead of a rebased save.

**Status:** pre-existing behaviour, moved verbatim in workspace-structure Phase 5. It is pinned by
`src/domain/supabase-planner.task-writes.test.tsx` ("uses an injected client for its writes but the page
client for the retry read"), so a fix must change that test on purpose.

**Finishing it:** add an optional client parameter to `loadTaskFromSupabase` (defaulting as today), pass
the injected client through the retry and the two helpers above, update the pinning test, and run the
procedure and AWI save suites. This is a behaviour change, so it needs its own review.

---

## 7. Planner task-store: unused functions, single-task read ordering, patch typing — recorded 2026-10-04, not changed

Surfaced by the final review of the workspace-structure refactor. All three pre-date the branch (verified at
merge base `edd45a9`); the branch moved them verbatim into `src/lib/planner/task-store.ts` / `read-store.ts`
and pinned their current behaviour in `src/domain/supabase-planner.task-writes.test.tsx`.

**a. Six exported task-write functions have no production caller** (only the facade re-export and their
tests): `updateTaskFields`, `upsertProcedureStep`, `reorderProcedureSteps`,
`saveTaskAndManufacturingStepToSupabase`, `saveManufacturingStepToSupabase`, `mergeLatestTaskToSupabase`.
They are pre-built, not dead by accident (same status as `sop/numbering.ts`, §2). Decide: wire them up or
delete them together with their characterization tests. Do not garbage-collect casually.

**b. The single-task read is less defensive than the full load.** `loadTaskFromSupabase` orders
`step_photos`, `step_tools`, `step_exploded_views` and `task_videos` by one column only (no `id` tiebreaker)
and does not page them or `task_dependencies`, while the full planner load uses `order(...).order(id)` and
500-row pages for the same tables. Probably harmless at current task sizes; a task with more than the API
row cap of media rows would silently truncate. Finishing it: mirror the full load's ordering and paging, and
update the request-order snapshots that record the current shape.

**c. `TaskFieldPatch` has no typed way to clear a column.** Every field is `Partial<Pick<Task, …>>`, and
`taskFieldPatchRow` skips `undefined` and maps `null` to SQL NULL, so clearing a value requires `null`,
which the type forbids (the test uses `null as never`). Finishing it: widen the patch type to allow `null`
per clearable column, or add an explicit clear API, and type the test accordingly. Behaviour change for
callers; `updateTaskFields` currently has none.
