# Correctness investigation: scope close-out (2026-10-03)

Branch `codex/workspace-structure`. Nothing below has been merged, pushed or deployed. No production migration has been applied, and no guard is active.

## 1. Completed, validated fixes (committed locally)

| Fix | Commit | Evidence |
|---|---|---|
| Phase 1 save ownership, plus the cross-product save-scope and scenario-draft recovery corrections | Phase 1 ledger in `docs/workspace-structure-plan.md` | lifecycle and seam tests, browser suite |
| Phase 2 media and tools extraction | Phase 2 ledger | seam tests, browser suite |
| Catalog operations stop when their task rewrite is refused (unconfirmed state, view-only access) | `aee57b1` | tool tests; mutations caught |
| A failed catalog rewrite's step-tool changes are undone on screen, keeping edits made meanwhile | `8b14112` | in-memory reproduction with the real savers; 5 mutations caught |
| Zero-zone products stop deriving the Unzoned station twice (every later shell save was failing, after a partial write) | `33b2797` | unit and derivation tests; `e2e/zero-zone-save.spec.ts` checks stored rows on the retained database and failed before the fix |

These change behaviour only where a defect was reproduced. All were run through the full gate: unit tests, lint, build, typecheck, bundle check, and the browser suite on the retained isolated database.

## 2. Additive database work: isolated and unused

Migration `20261003210000_step_recovery_and_tool_changes.sql` (`2277e69`, now under `supabase/isolated/2026-10-03-step-recovery/`) is applied **only** to the retained isolated database. It adds:
- the `deleted_manufacturing_steps` recovery table
- `delete_manufacturing_step`, `restore_manufacturing_step` and `apply_step_tool_changes`

No client code calls them. They are not deployed and change no existing object. Evidence:
- `scripts/verify-local-migration.mjs`: every pre-existing record unchanged
- pgTAP `step_recovery_test.sql`: 48/48
- two-session concurrency checks

`supabase/isolated/2026-10-03-step-recovery/tests/compat_cutover_test.sql` is a design characterization. Its prototypes exist only inside a rolled-back transaction.

**Before any use:**
- approval of the user-facing messages (catalog design §5c)
- the client project in section 3
- a production deployment decision

### Keeping the isolated migration out of production

**Relocated 2026-10-03** (contents byte-identical, verified by SHA-256) from the active paths to `supabase/isolated/2026-10-03-step-recovery/`, with a "NOT AUTHORIZED FOR PRODUCTION" README:
- `supabase/isolated/2026-10-03-step-recovery/migrations/20261003210000_step_recovery_and_tool_changes.sql` (was `supabase/migrations/`)
- `supabase/isolated/2026-10-03-step-recovery/tests/step_recovery_test.sql` (was `supabase/tests/`)
- `supabase/isolated/2026-10-03-step-recovery/tests/compat_cutover_test.sql` (was `supabase/tests/`; it calls the isolated functions)

No tool discovers the new location:
- CI's `supabase db reset --local` / `supabase test db --local` read only `supabase/migrations` and `supabase/tests`, and `config.toml` has `schema_paths = []`;
- `scripts/apply-migration-safely.mjs` and `scripts/repair-migration-ledger.mjs` read only `supabase/migrations`;
- `scripts/test-browser.mjs` copies only `supabase/migrations`.

**The two pgTAP files are therefore excluded from the normal database suite.** CI no longer runs their 64 assertions. The active suite is smaller **by exclusion, not equivalent coverage.**

The retained isolated database and its migration ledger were **not** modified. The gitignored copy of the migration under `scratch/browser-db/supabase/migrations/` (from earlier isolated runs) also stays as it was. That isolated workdir must still never be reset with `npm run test:browser`, which would re-apply whatever it contains.

**The actual deployment process** (confirmed in the repository):
- **CI** (`.github/workflows/ci.yml`) runs `supabase db start`, then `supabase db reset --local` (every migration, applied to the runner's throwaway database), then `supabase test db --local`. No step targets a remote project.
- **Vercel** builds with `next build` (`package.json`); `vercel.json` holds only the notification cron. Deployment applies no migration.
- **Production migrations are applied by hand.** An operator runs `node --env-file=.env.local scripts/apply-migration-safely.mjs <file>`, one additive migration at a time. That script refuses destructive SQL and checks row counts inside the transaction. `docs/runbooks/notifications.md` says to never use `supabase db push`. Functions that are patched in place are confirmed with `npx supabase db query --linked` (CLAUDE.md). Ledger drift from custom appliers is repaired with `scripts/repair-migration-ledger.mjs` / `supabase migration repair` (`docs/db-audit-2026-06-01.md`).
- `npm run gen:types` reads the production project's schema, so it would not show isolated objects.

**Therefore:** nothing deploys `20261003210000` automatically. The risk is human or tooling: once the file sits in `supabase/migrations` on `main`, `supabase migration list` / `db push`, or an operator applying "everything new", would treat it as pending.

**Exclusion procedure.** Step 1 was approved and done (above); step 2 still applies:
1. ~~**Relocate the three files** out of the deploy and CI paths~~ (done), into `supabase/isolated/2026-10-03-step-recovery/`, with a README stating: "Not authorized for production. Apply only to isolated databases with `scripts/verify-local-migration.mjs`."
   - That script accepts any path with a valid migration file name.
   - `main`'s `supabase/migrations` and `supabase/tests` then contain nothing unapproved.
   - The pgTAP files would no longer run in CI, but can still be run by hand against an isolated database. Adding a CI job for them would itself need approval.
2. **Add a release checklist item:** compare `supabase/migrations` with the production ledger before any apply, and apply only versions explicitly authorized for that release.
3. **The retained isolated database** (`scratch/browser-db`) already has the migration applied, with its ledger row. That is isolated only, and no production action follows from it.

Until then, the branch stays local (no merge, no push), which is the current state.

## 3. Separate implementation project: catalog consistency and targeted restore

Designs: `docs/tool-catalog-consistency-design.md`, `docs/restore-step-design.md`.

**The catalog rollout is BLOCKED.** It must not be described as safe. These risks remain unresolved:
1. **Old clients can return.** A tab or phone running pre-rollout code can come back at any time, for example after being offline, and run full-list tool syncs that overwrite tool assignments, including the results of catalog operations.
   - A quiet observation period is **evidence, not a guarantee**.
   - A maintenance window reduces the population but cannot close the boundary.
   - Refusing old clients is unsafe: it strands partial writes mid-save (tested) and loses edits that have no durable recovery (section 4).
2. **Making the whole-task replacement add-only is not "correct".** It only stops the destruction. Consequences for callers that rely on replacement semantics:

   | Caller | Effect of add-only |
   |---|---|
   | Mobile **Restore** (old and current code) | The restored step goes to the **end** when its position is taken (the old delete renumbers, so it usually is), while the phone shows it in its original place. The snapshot's step edits, reorders, quantity and dependency changes are **silently ignored**. Rows added since are kept. The call reports success either way. |
   | **Optimizer** (`savePlannerStateToSupabase` into a freshly duplicated scenario) | No change: its payload equals the copied rows. Correct only while `duplicate_scenario` keeps copying no steps and the optimizer keeps not editing children. |
   | Any **future** full-state save meant to persist deletions, reorders or edits of children | They would be **silently dropped**, because the function returns nothing to report what it ignored. |

   It would need a result that reports ignored rows, and callers that surface it. Until then it is a damage limiter, not a fix.
3. **Old Restore's shell part.** It still writes the phone's stale task rows and deletes tasks, zones and stations missing from its snapshot. Fixing that needs versioned shell saves, a broader persistence redesign.

**Scope of the project, when approved:**
- catalog RPCs
- client changes to all tool writers
- the targeted delete/restore client
- the atomic reorder
- telemetry
- whatever old-client boundary policy is finally accepted

Each piece needs its own approval and migration plan.

## 4. Separate future project: broad durable edit recovery

Today only procedure step name/instruction text (and, partly, photo annotations) survives a reload. Everything else is memory-only: Gantt, product setup, zones, task add/delete, step structure, tool changes, media uploads, catalog, BOM. Most mobile edits are memory-only too (inventory in catalog design §5b).

**What the project covers:** a write-ahead local journal for every edit type, plus making multi-request operations atomic or idempotent so they can be replayed.

**Why it matters for the blocked rollout:** it is the precondition for ever refusing an outdated client safely, since the refused edit must survive the reload and an interrupted operation must complete on replay. It is independent of the structural phases and of the catalog project.

## What resumes now

Phase 3 of the structural plan (loading, realtime, scenarios) is a behaviour-preserving extraction. It does not absorb sections 2–4. See "Phase 3 execution plan" in `docs/workspace-structure-plan.md`.
