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
