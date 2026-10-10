# Structure audit Phase 0 — local verification

Implemented on 2026-10-10 in the existing checkout. All five branches were stacked from `main` at `e9dd1a3`, pushed, and passed both CI jobs (`checks` and `database`). With owner approval, main was then fast-forwarded through A → B → C → D → E, preserving the reviewed code tip `512b4d3`. No production query or production migration has been performed. Production work remains subject to the approval steps in the [implementation plan](../superpowers/plans/2026-10-10-structure-audit-phase-0.md#task-11-gate-live-verification-merge-production-migration).

## Changes and branch gates

Each branch passed production build, standalone typecheck after build, lint, the complete Vitest suite, and all client bundle budgets.

| Branch | Code tip | Test files / tests | Planner entry, gzip |
|---|---|---:|---:|
| `fix/test-safety-net` | `7b0fbf1` | 307 / 2,540 | 291.3 KiB |
| `fix/scenario-switch-back` | `1138987` | 307 / 2,543 | 291.3 KiB |
| `fix/awi-link-integrity` | `1e3e05d` | 309 / 2,583 | 291.8 KiB |
| `fix/settings-phone-portal` | `5e84fc1` | 312 / 2,586 | 291.7 KiB |
| `chore/delete-smart-allocation` | `4db3a59` | 311 / 2,574 | 291.7 KiB |

- A pins the test timezone and collects the proxy host tests. The canary failed under UTC before the pin. Temporary regressions produced exactly three date failures and two proxy failures; both mutations were restored.
- B evicts the departing scenario from the cache. Returning reloads remote rows, while fresh optimizer seeds remain usable.
- C centralizes linked AWI ownership, derives duration from the master, guards desktop and phone writes, preserves recovered phone drafts, freezes linked-task timers, adds six database guards, batches master reads, tolerates unavailable masters in planner loads, and rejects stale refresh results. Strict single-task hydration still reports failures for retry.
- D replaces Settings project lifecycle controls with the universal Phone portal and aligns its server and client directory scope with Product. Embedded settings remain Account, Appearance, and Organization.
- E removes the unused allocation API, solver, playback, report builders, helpers, and scripts. Four live-path characterization tests passed before deletion. The retained allocation audit, recommendations, and Optimize line scheduler remain in use. The requested deleted-symbol search returned no matches in application code, scripts, or tests.

Every implementation task passed separate specification and quality reviews. An independent final review of `e9dd1a3..4db3a59` also passed with no actionable introduced defects.

## Database verification

Used only the retained `pulse-e2e` stack: API `127.0.0.1:56321`, database `127.0.0.1:56322`. The separate root `pulse` stack was untouched. No database reset or `db push` was used.

- Baseline: 24 SQL test files / 485 checks passed.
- New guard test reproduced eight expected failures before the migration.
- The safe local applier applied `20261010190000_awi_link_child_guard.sql` and its ledger row in one transaction, preserving all 86 pre-existing tables and 806 rows.
- After application: all 25 SQL test files / 497 checks passed, including the 12 new guard checks.
- An authenticated editor insert was also rejected with SQLSTATE `23514` and the shared linked-master message; the check rolled back.
- The migration adds only a private trigger function and triggers, so public generated types were not changed. Production type generation remains in the release checklist.

The pinned CLI required `?sslmode=disable` on the explicit local database URL. Browser fixtures were added only to the local test stack after the migration preservation check. At completion, the temporary dev server was stopped and `pulse-e2e` was returned to its original stopped state with its volumes preserved. Other local stacks were left running unchanged.

## Browser verification

All checks used an authenticated local fixture. Screenshots and scripts are retained locally in `scratch/phase0-verification/` (Git-ignored).

| Check | Observed result | Screenshot |
|---|---|---|
| Scenario switch-back | A task inserted into Main while viewing a copy appeared on return and survived another edit, save, and reload. | [Scenario](../../scratch/phase0-verification/01-scenario-switch.png) |
| Linked AWI | A 12-minute master produced a read-only 0.2-hour duration and visible Gantt bar; the linked task was absent from step Move destinations. | [Duration](../../scratch/phase0-verification/02-linked-duration.png), [Move menu](../../scratch/phase0-verification/02b-move-targets.png) |
| Phone | Linked master notice and steps rendered without Add, timer, or expand controls; no procedure writes were sent. | [Phone](../../scratch/phase0-verification/03-phone-readonly.png) |
| Master refresh | Changing the master in the AWI builder from 12 to 18 minutes updated the linked duration to 0.3 hours, with one metadata request across rapid return events. | [Refresh](../../scratch/phase0-verification/04-master-refresh.png) |
| Unavailable master | The planner opened, displayed the unavailable notice, retained stored timing, and saved an ordinary task edit. The temporary broken link was restored. | [Unavailable](../../scratch/phase0-verification/05-unavailable-master.png) |
| Settings | Phone portal QR rendered; Projects was absent; the old Projects query fell back to Account; embedded sections were unchanged. | [Portal](../../scratch/phase0-verification/06-settings-phone-portal.png), [Fallback](../../scratch/phase0-verification/06b-settings-fallback.png), [Embedded](../../scratch/phase0-verification/06c-embedded-settings.png) |
| Live allocation after cleanup | Optimize line created a new scenario with no calls to the removed API route and no page errors. | [Optimization](../../scratch/phase0-verification/07-live-optimize-line.png) |

Settings was repeated without page errors after refreshing the stale dev cache caused by component deletion. Deleted-route references in old dev/browser-test generated types also required refreshing those local caches before the final build. Caches were moved aside, preserving their contents. No application workaround or typecheck exclusion was added.

## Bundle result and boundaries

Final gzip entries: planner 291.7 KiB, SOP list 286.9 KiB, Planning 298.1 KiB, AWI directory 317.9 KiB, AWI editor 282.0 KiB. All are below 350 KiB; the largest chunk is 138.6 KiB against 160 KiB.

The planner grew by 0.4 KiB (about 0.14%) from the 291.3 KiB baseline, so the plan's expectation of no growth was not met. The linked-integrity branch added 0.5 KiB, Settings removed 0.1 KiB, and the dead-code deletion left the entry size unchanged. This does not fail the configured bundle gate.

No package-lock or CI workflow changes were made; browser CI jobs remain disabled. Successor rescheduling after master duration changes and broader mobile draft recovery remain outside this plan. Logs are retained at `/tmp/pulse-phase0-{A,B,C,D,E}-*.log`.

## Branch CI and merge

All five reviewed branch heads passed both required jobs before the owner-approved merge:

- [Test safety net CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/38078103014)
- [Scenario switch-back CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/38078103732)
- [Linked AWI integrity CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/38078103503)
- [Settings phone portal CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/38078103418)
- [Dead allocation cleanup CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/38078103498)

The merge introduced no conflicts or application changes beyond the reviewed branches. This follow-up records the release status in documentation only.

## Release remaining

1. Separate owner approvals for the production orphan query, migration and ledger entry, post-apply type generation, and deployment environment cleanup. No orphan cleanup is bundled into this migration.
2. Record release results after those steps; no memory update has been made during local implementation.
