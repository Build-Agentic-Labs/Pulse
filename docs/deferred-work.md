# Deferred work — decided, not yet done

Companion to `nextjs-refactor-plan.md`. These items are **intentionally deferred**,
not forgotten and not defects. Each says what it is, why it's parked, and what
finishing it involves.

Last reviewed: 2026-07-25. **Reconciled 2026-10-04** (edit-reliability plan, Package A, on `main`
`438a6df`): every section below now carries a status line — *verified current*, *fixed*, *historical*
or *not yet verified* — checked against the code on that commit. Older text is kept as incident
history; where it no longer describes the code, the status line says so.

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

> **Status 2026-10-04:** partly historical. `schedule-import.ts` **no longer exists** (decided
> 2026-07-21: its sheet parsing became `src/domain/planning/schedule-row.ts`, the rest was deleted — see
> CLAUDE.md "Deliberate decisions"). `version.ts` **is wired**: `src/components/sop/sop-editor.tsx:26`
> imports `nextVersionLabel`/`versionLabel`, and `src/lib/sop/review.ts:14` its `ChangeSignificance`
> type. Only `numbering.ts` (26 lines) still has no non-test importer — *verified current*.

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

> **Status 2026-10-04:** *verified current* — `canTransitionSop` is still declared only in
> `src/domain/sop/lifecycle.ts` and called from nothing but its tests. The "must respect solo test
> mode" note at the end is historical: that mode is retired (§1).

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

> **Status 2026-10-04:** *historical, superseded, not re-verified here.* A local backup suite now
> exists under `scripts/backup/` (archive, verify, recovery and stress rehearsals) with its reports in
> `docs/local-backup-*.md` / `.json`. Whether the gaps listed below (storage files, tested restore,
> cadence) are closed by it was not checked in this pass.

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

- **`/design/nothing` may be broken.** *(2026-10-04: the CSS half is fixed —
  `app/design/nothing/layout.tsx:3` now imports `nothing-design.css`; whether the route still hangs
  was not re-checked.)* It hung at "LOADING WORKSPACE" when checked.
  Separately, `src/theme/nothing-design.css` (404 lines) was imported by nothing —
  the only CSS import in the repo is `globals.css` at `app/layout.tsx:7`. Possibly
  related. Decide: delete the file, or wire it into that route.
- **No CI exists.** *(2026-10-04: historical, fixed — `.github/workflows/ci.yml` runs typecheck,
  lint, the unit suite, the production build, the bundle budget, pgTAP on a throwaway local database
  and the AWI browser suite; `relock.yml` regenerates the lockfile.)* No `.github/`. Nothing runs the 336 tests. (This is Stage 0
  work in the main plan, listed here for visibility.)
- **`org_tool_access` write policy is not workspace-scoped** *(2026-10-04: historical, fixed —
  `20260811120000_structured_workspace_invites.sql:86-89` recreates "org_tool_access manager write"
  with `has_workspace_role(workspace_id, owner|admin)` in both `using` and `with check`.)*
  (`20260601123000:103-115`). Impact is nil today — single workspace — but it
  becomes a real multi-tenancy defect the moment a second workspace exists.
- **Rate limiting is in-memory and per-instance** (`src/lib/api-auth.ts:72`; *2026-10-04: verified
  current*, the bucket map is now at `src/lib/api-auth.ts:108`). On
  serverless, limits multiply by instance count. Affects LLM-spending routes.

---

## 6. Planner procedure retry ignores an injected client — recorded 2026-10-03, FIXED 2026-10-04

> **Status 2026-10-04:** *fixed, verified on `main`* at `0b41c81` — `src/lib/planner/task-store.ts`
> passes the issuing client to `loadTaskFromSupabase` at the conflict reloads (lines 512, 574) and the
> confirmation read (599). CI on that commit was green.

**What it was:** `saveProcedureTaskUpdateToSupabase` (`src/lib/planner/task-store.ts`) accepted an optional
client and used it for its writes, but its version-conflict reload and its final confirmation read went
through `loadTaskFromSupabase`, which had no client parameter and always used the page's shared browser
client. A server caller injecting a per-request client would have hit the browser-only trap on the first
conflict instead of getting a rebased retry.

**Fix (branch `codex/procedure-retry-client`):** `loadTaskFromSupabase(taskId, projectId?, client?)` gained an
optional trailing client (default unchanged: the browser client), and the procedure save passes its issuing
client to both conflict reloads and the final confirmation read. Six lines of code. Retry limit (one),
version handling, authorization checks and error messages are unchanged; no caller or signature other than
that optional parameter changed. The only production caller (the browser save queue) injects no client and
behaves exactly as before.

**Regression test:** `src/domain/supabase-planner.task-writes.test.tsx`, "with an injected client" — two
distinct, fully functional clients (injected vs installed browser client), with the browser client required
to see zero requests: task-conflict retry, step-conflict retry, a second conflict (one retry, then the
conflict error), and the no-injection path. The three injected cases failed before the fix and pass after.

**Not changed (still browser-only, no client parameter):** `saveManufacturingStepToSupabase` and
`mergeLatestTaskToSupabase` still read through `loadTaskFromSupabase`'s default. They have no production
caller (see §7a), so threading a client through them was left out of this fix on purpose.

---

## 7. Planner task-store: unused functions, single-task read ordering, patch typing — recorded 2026-10-04, not changed

> **Status 2026-10-04 (later the same day):** **b is fixed, verified on `main`** at `438a6df` — every
> child read in `loadTaskFromSupabase` (`src/lib/planner/read-store.ts:534-540`) goes through
> `readAllPages` with `order(<key>).order("id")`; CI green. **a and c are *verified current*** — the six
> functions still have no production caller and `TaskFieldPatch` still cannot express a clear. See
> `docs/edit-operation-inventory.md` for the active-vs-unused writer list.

Surfaced by the final review of the workspace-structure refactor. All three pre-date the branch (verified at
merge base `edd45a9`); the branch moved them verbatim into `src/lib/planner/task-store.ts` / `read-store.ts`
and pinned their current behaviour in `src/domain/supabase-planner.task-writes.test.tsx`.

**a. Six exported task-write functions have no production caller** (only the facade re-export and their
tests): `updateTaskFields`, `upsertProcedureStep`, `reorderProcedureSteps`,
`saveTaskAndManufacturingStepToSupabase`, `saveManufacturingStepToSupabase`, `mergeLatestTaskToSupabase`.
They are pre-built, not dead by accident (same status as `sop/numbering.ts`, §2). Decide: wire them up or
delete them together with their characterization tests. Do not garbage-collect casually.

**b. The single-task read is less defensive than the full load — FIXED 2026-10-04 (branch
`codex/single-task-read-paging`).** `loadTaskFromSupabase` ordered `step_photos`, `step_tools`,
`step_exploded_views` and `task_videos` by one column only (no `id` tiebreaker) and did not page them or
`task_dependencies`, while the full planner load and the private-media hydrate use `order(...).order(id)` and
500-row pages for the same tables.

*Investigation before changing anything (read-only against production):* the hosted API cap is effectively
1,000 rows (an unranged request returned 1,000 of 1,312 `step_photos`). The largest task has 199 photos, 39
tools, 6 exploded views, 2 dependencies, so **nothing was being truncated**. Ties in the single sort key are
real: 27 live photos in 6 groups on 5 tasks share an identical `captured_at` within one step (largest group
11, a batch upload), nothing downstream re-sorts, and the realtime/mobile refetch paths replace local photo
order with the refetched order. So a reorder of tied photos was *possible* on those tasks after a refetch;
**no visible reorder was observed**. This closes a latent limit and a nondeterministic ordering, not a
reproduced defect.

*Fix:* all seven child reads go through `readAllPages` with the hydrate's filters and `order(<key>, id)`.
Injected client, authorization order, return shape and callers are unchanged; collections of today's sizes
issue exactly the same number of requests as before. Tests (`src/domain/supabase-planner.task-read.test.ts`,
over a scripted client that honours order/range and caps unranged reads at 1,000): tied timestamps order by
id identically to the hydrate; 1,200 rows return every row exactly once in order; exact page boundaries
(500, 1,000) terminate after one empty page; a later-page failure rejects the whole read; today's sizes add
no request; project and soft-delete filters intact. On the previous loader the ordering, shape, paging,
boundary and failure tests fail. Six request-order snapshots in `task-writes.test.tsx` were updated and show
only the added `order(id) range(0,499)`.

**c. `TaskFieldPatch` has no typed way to clear a column.** Every field is `Partial<Pick<Task, …>>`, and
`taskFieldPatchRow` skips `undefined` and maps `null` to SQL NULL, so clearing a value requires `null`,
which the type forbids (the test uses `null as never`). Finishing it: widen the patch type to allow `null`
per clearable column, or add an explicit clear API, and type the test accordingly. Behaviour change for
callers; `updateTaskFields` currently has none.

---

## 8. Mobile capture-session behaviour pinned by characterization, not corrected — recorded 2026-10-04

Surfaced while extracting the hook-free capture-session utilities out of `src/components/mobile-photo-portal.tsx`
(edit-reliability Package B, first slice, branch `codex/mobile-capture-session`). Each item is pinned by a
test that asserts the **current** behaviour, so a future fix must change that test deliberately. Line numbers
are post-extraction.

**a. A stale stored selection reopens the draft panel on the fallback task.** The session-hydration effect
(`mobile-photo-portal.tsx:748`) applies `showNewStepForm` and `newStepId` from
`localStorage["pulse:mobile-capture-session:<projectId>"]` without checking that the stored `selectedTaskId`
still exists; the load path's `applySavedState` does check (`resolvedTaskId === preferredTaskId`) but runs
after. Result: when the stored task has been deleted, the first task is selected and an empty New Step panel
opens on it with the stale step id. Test: `mobile-photo-portal.capture-session.test.tsx`, "KNOWN GAP: a
stored selection for a task that no longer exists…". Fix belongs with the hydration ownership work, not an
extraction commit.

**b. Unmount does not flush an armed autosave.** The 450 ms new-step autosave timer
(`mobile-photo-portal.tsx:1728`) is cleared on task switch and on close, but the unmount cleanup
(`:1021`) clears only motion timers. The timer then fires after unmount and still writes to the task it was
scheduled for, so nothing is lost today; the gap is that nothing flushes synchronously and a navigation that
also tears down the page (reload) between keystroke and timer loses the edit. Already listed in
`docs/edit-operation-inventory.md` §5.16; now pinned by "KNOWN GAP: unmounting with the autosave debounce
armed…".

**c. A timer started with no draft open cannot be stopped from the header.** `startCaptureTimerForCurrentTask`
(`:2733`) binds `activeStepId: null` when the New Step panel is closed. `isActiveHeaderCaptureTimer` requires a
bound step, so no header chip and no Stop control render (`canStartCaptureTimer`, `:697`, still shows
"Timer", which is a no-op while that timer runs). The timer is persisted in the session and keeps running
until a draft is opened (which binds it) or the session is cleared. Pinned by "a timer started without an
open draft is bound to no step…". UX decision needed (bind to the task and show the chip, or refuse to start
without a step); not changed here.

**d. Trivia, not a defect:** `getCaptureTimerElapsed` treats `startedAt === 0` as "not started" (falsy
check). Real clocks never produce 0; pinned in `capture-session.test.ts` so a future change is deliberate.
