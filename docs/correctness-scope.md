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

Migration `20261003210000_step_recovery_and_tool_changes.sql` (`2277e69`) is applied **only** to the retained isolated database. It adds:
- the `deleted_manufacturing_steps` recovery table
- `delete_manufacturing_step`, `restore_manufacturing_step` and `apply_step_tool_changes`

No client code calls them. They are not deployed and change no existing object. Evidence:
- `scripts/verify-local-migration.mjs`: every pre-existing record unchanged
- pgTAP `step_recovery_test.sql`: 48/48
- two-session concurrency checks

`supabase/tests/compat_cutover_test.sql` is a design characterization. Its prototypes exist only inside a rolled-back transaction.

**Before any use:**
- approval of the user-facing messages (catalog design §5c)
- the client project in section 3
- a production deployment decision

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
