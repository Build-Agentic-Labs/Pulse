# Pulse documentation status and index

Reconciled 2026-10-04 against application main `1147c7d`. Local and origin/main are synchronized;
all three jobs passed in [main CI](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/37246120976).
This index identifies current contracts and next work. Dated audits, measurements and execution
ledgers describe their stated snapshots; their old branch status is not the active backlog.

## Current progress

| Work | Status | Evidence |
|---|---|---|
| Workspace structural Phases 1–5 | Published at `5526cfe` | [Completion ledger](history/workspace-structure-plan.md), [frozen review handoff](history/workspace-structure-handoff.md) |
| Procedure retry client ownership | Fixed at `0b41c81` | [Deferred-work §6](deferred-work.md#6-planner-procedure-retry-ignores-an-injected-client--recorded-2026-10-03-fixed-2026-10-04) |
| Single-task paging and deterministic ordering | Fixed at `438a6df` | [Deferred-work §7](deferred-work.md#7-planner-task-store-follow-ups--recorded-2026-10-04-paging-fixed-other-items-deferred) |
| Edit reliability Package A | Published | [Baseline](edit-reliability-baseline-2026-10-04.md), [operation inventory](edit-operation-inventory.md) |
| Mobile extraction B1/B2 | Published at `9dfcbb7` | [Historical extraction ledger](edit-reliability-plan.md#historical-package-b-extraction-ledger) |
| C1 scoped mobile recovery | Published at `1147c7d` | [Shipped contract, tests and limits](mobile-draft-recovery-c1-results.md) |
| Further mobile extraction, broader durable recovery and atomic reorder | Not started | [Active roadmap](edit-reliability-plan.md) |
| Targeted delete/restore | Proposed; no production implementation | [Design](restore-step-design.md), [deployment constraints](correctness-scope.md) |
| Catalog consistency rollout | Blocked on writer compatibility | [Design](tool-catalog-consistency-design.md), [correctness scope](correctness-scope.md) |

Compared with the structural baseline, the workspace component is 6,655 → 3,652 lines and the planner
persistence file is 4,932 → a 111-line compatibility facade; code moved to focused modules rather than
being deleted. The mobile component is now 4,044 lines (4,369 before B1/B2; 3,955 after extraction,
then C1 added ownership/recovery behavior). Automated tests are 1,820 → 2,173 and browser cases 18 → 26;
these are test counts, not coverage percentages. Active pgTAP is 22 files / 398 assertions. The 64
experimental assertions excluded from that active suite are not claimed as equivalent coverage.

C1's one-sample mobile request check reproduced the prior medians of 30 / 30 / 114 on small/medium/stress
fixtures. Its final portal gzip increase is 2.54 KiB. No speedup or universal offline-safety claim is made.
Same-task concurrent puts and document teardown before local commit remain limitations.

## Where to look

- Next work and approval boundaries: [edit reliability roadmap](edit-reliability-plan.md).
- Remaining defects and technical decisions: [deferred work](deferred-work.md).
- Completed C1 contract, UI approval, acceptance evidence and rollback: [C1 results](mobile-draft-recovery-c1-results.md).
- Measured edit paths: [operation inventory](edit-operation-inventory.md), with its current-status overlay.
- Performance measurement method: [performance guide](performance.md); historical raw evidence remains under `outputs/measurements/`.
- Live operating guidance: [notification runbook](runbooks/notifications.md), [theme contract](ui-theme-contract.md), [SolidWorks integration](solidworks-integration.md).
- Local backup scope and evidence: [foundation](local-backup-foundation.md), [access plan](local-backup-access-plan.md), and the `local-backup-*.json` reports.
- Architecture rationale used by repository conventions: [historical Next.js plan](nextjs-refactor-plan.md).

Atomic reorder is the recommended next pilot, not authorization to implement or deploy it. Further editor
extraction should follow a cohesive ownership boundary, not a line quota. Targeted restore and catalog
rollout require separate database/client compatibility decisions. No experimental SQL is authorized for
production by this cleanup.

## Documentation consolidation

Five completed or superseded documents moved to [history](history/README.md). Their unique evidence and
incident rationale remain available. The completed C1 implementation handoff was removed after its
storage, lifecycle and adoption contract was consolidated into the C1 results document. The initial C1
revision-counter/Discard design is archived explicitly as superseded and must not guide new code.

Dated audits under `audits/`, reviews under `reviews/`, and plans/specifications under `superpowers/`
remain evidence for their stated feature and date. They are not a combined current task list. Keep
backup reports and measurement artifacts; completion alone does not make that evidence redundant.

Atomic task reorder: [Package D results and production gate](atomic-task-reorder-results.md). Implemented and tested on the feature branch; production application and client publication are pending approval.
