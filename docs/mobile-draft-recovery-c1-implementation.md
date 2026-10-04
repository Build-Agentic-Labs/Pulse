# C1 mobile draft recovery implementation brief

Prepared 2026-10-04 for Claude. This is the implementation handoff for scoped mobile New Step recovery. It supersedes the proposed algorithms in `mobile-draft-recovery-c1-design.md`; that document remains the investigation history. Implement the bounded change below, not the abandoned revision-counter design or the broader Package C journal.

The user requested this brief so implementation can begin. Preserve all existing data. The legacy recovery UI below is a concrete proposal for review, not approval of its exact appearance. Prepare a reviewable preview before changing the live user flow. No merge, push, production migration, new dependency, or database reset is authorized by this document.

## Baseline and evidence

Local checkout inspected at `9dfcbb7`, branch `codex/mobile-capture-session`, clean before this document was added. The user reports that B1/B2 are being merged; publication is not independently verified here. Before implementation, fetch and confirm the merged baseline, then use a new `codex/mobile-draft-recovery` branch. Do not reset an existing checkout or overwrite another agent's changes. Carry this brief onto the implementation branch without mixing it into an ongoing publication unexpectedly.

| Evidence | Observed or reported result | What it establishes |
|---|---|---|
| Current recovery store, inspected | One fixed key, `mobile-new-step-draft-v1`, in `buildlogic-mobile-drafts` / `drafts`, database version 1 | Every product and account in the same origin/profile shares one recovery slot |
| B2 characterization | Cross-product replacement pinned in tests; real browser exercises save, overwrite, reload and clear | A demonstrated local recovery overwrite risk, not a hypothetical performance issue |
| Current portal, inspected | `scheduleNewStepAutosave` starts a local write immediately; database save is scheduled after 450 ms; `persistNewStepDraft` writes locally again | No fixed 450 ms local durability guarantee; duplicate local-write call sites must share snapshot identity |
| Current successful save, inspected | Clears the shared record after step, tools and photo operations complete, with local pending-work guards | Cleanup is not tied to the precise content stored |
| Current capture session, inspected | Project-scoped localStorage also hydrates parked draft fields | IndexedDB keys alone cannot establish account isolation; this recovery source must be covered |
| B1/B2 reported full gate | 2,150 tests / 251 files, 20 existing browser cases plus 1 recovery case | Baseline evidence; not rerun for this document |
| Focused B2 independent review | 23 unit/component cases passed in the preceding review | Storage extraction tests are available to extend |
| Reported mobile-open requests | 30 small / 30 medium / 114 stress | Browser-issued request baseline; excludes server-rendered reads and is not an edit-latency measurement |

Source files: `src/components/mobile-photo-portal.tsx`, `src/components/mobile-photo-portal/recovery-draft-store.ts`, `src/components/mobile-photo-portal/capture-session.ts`, their tests, `e2e/mobile-recovery-draft.spec.ts`, and the Package B ledger in `docs/edit-reliability-plan.md`. Use symbol names, not historical line numbers.

## Outcome and limits

Deliver independent recovery slots per signed-in user, product and task; exact acknowledgment of a saved snapshot; safe account transitions; and an explicit, non-destructive route to review old drafts.

Keep the existing database write functions, permissions, 450 ms autosave scheduling, 250 ms restored-draft scheduling for owned drafts, media processing, and editor layout. Do not introduce a general journal or solve simultaneous editing in multiple tabs. Same-user, same-task concurrent writes may still replace each other; document this remaining limitation and never describe C1 as lossless or offline-safe.

Local cleanup of an exactly acknowledged v2 record is permitted as normal recovery lifecycle. Do not delete user database rows, media, legacy records, malformed records, or retained database volumes. No expiry or bulk storage clearing.

## Storage contract

Keep the same IndexedDB database, object store, keyPath and database version. Use a new key prefix and encode each scope component so delimiters cannot collide:

`mobile-new-step-draft-v2:<encoded userId>:<encoded projectId>:<encoded taskId>`

Each record carries `schemaVersion: 2`, `key`, `userId`, `projectId`, `taskId`, `draftId` (the New Step id), a unique `writeToken`, `updatedAt`, and the existing full payload: name, instruction, durationText, tools, photos, checks and checkValues. Require a valid step id before persisting. A revision counter may aid diagnostics but must not authorize deletion.

Generate a fresh token for each changed snapshot, not each helper invocation. Capture payload, scope and token together. The immediate local write, delayed save, retry and acknowledgment for that unchanged snapshot use the same token. A new edit gets a new token even if another tab happens to use an equal counter or timestamp.

Store API responsibilities:

- Validate keys, scope, schema and payload before recovery. Preserve unknown or malformed records unchanged; never overwrite an unknown schema simply because it occupies the requested key. Return a contained failure instead.
- Save and load only the supplied scope. Do not consult mutable current-user or current-project state inside asynchronous callbacks.
- Resolve local writes on transaction completion, not merely request success. Serialize same-instance writes per key in edit order; an older delayed local put must not land after a newer edit or recreate a record after acknowledgment.
- Acknowledge in one readwrite transaction: read the key and delete only if schema, scope, draftId and writeToken all equal the successfully saved snapshot. Resolve on transaction completion. No timestamp or numeric inequality comparison.
- Await the snapshot's local-write settlement before its cleanup. Failure to store locally must not falsely imply recovery protection or block the existing remote save; a failed local write never authorizes deleting an unrelated record.
- Handle transaction abort as well as open, request and transaction errors; close opened connections on every settled path. No hanging promise after an aborted transaction.

This token contract prevents stale deletion. It deliberately does not prevent another tab's put from replacing a record before either save completes.

## Editor and identity lifecycle

Use the existing session helper and auth subscription conventions. The session user id labels local ownership; it is not an authorization check. Do not add a network identity request per edit. Existing server authorization remains authoritative.

1. Establish an identity generation for each account context. Capture it with scheduled saves and restore requests.
2. While initial identity is loading, retain edits in memory. When identity resolves to the same originating session, persist the latest pending snapshot without requiring another keystroke. Never assign an old account's pending snapshot to a newly signed-in account. If provenance cannot be established, preserve without replay and report the blocker.
3. With no identity, do not use an anonymous/shared storage key. Reuse the existing local-recovery warning and do not claim durability.
4. On logout/account change, cancel unsent old-generation remote work, detach old editor state and invalidate pending restore responses. A scheduled old-account callback must not begin database writes using the new session. Check generation before each queued stage that initiates a new request; already-issued requests cannot be recalled.
5. Late completions may perform exact cleanup only under their captured old scope; they must not mutate the new editor's state, errors, selection or Saved indicator. A partial/failed operation retains its recovery record.
6. Audit all New Step hydration sources, including parked fields in the project-scoped capture session. Reuse the scoped draft store as the authority for recoverable payloads; do not replay unowned parked text/photos into a different account. Keep timer arithmetic unchanged. If the existing auth/remount boundary cannot enforce this without a broader session-format change, report that one concrete blocker before broadening scope.

Load the selected task's v2 draft after identity and task membership are known. Recheck generation and selection after awaiting storage. On opening New Step for another task, check its scoped record before generating an empty draft. Preserve foreign-task records; do not purge records when a task is absent from the current loaded scenario. Do not add automatic task switching or a draft directory in C1.

Remote success means the existing complete save chain succeeded, including required tools/photos. Acknowledgment uses that chain's captured snapshot token. Do not clear recovery on the step-row response alone.

## Legacy recovery UI proposal

The old record has no trustworthy author. Task membership cannot establish authorship. Do not auto-restore, auto-submit, re-key, rewrite or delete it. Do not remove the old automatic recovery path in a released build until the replacement flow below is approved and tested.

Present this proposal in the existing New Step area using current typography, spacing, hover states and button components. Provide a screenshot or isolated preview for user approval before enabling it in the live app.

**Notice:** “A draft from an earlier version is saved on this device. Its author is unknown.”

**Actions:** “Review saved draft” and “Not now”.

Only offer the notice after the current user has access to the loaded task/project that matches the record. “Not now” dismisses it for the current visit without changing storage. Do not persist a global dismissal that hides it from another account.

“Review saved draft” opens a read-only preview of available content in the existing panel/dialog style. It must not trigger autosave or replace a current draft. Show: “Only use this draft if you recognize it and intend to save it to this product.” Actions: “Use this draft” and “Back”. Reuse safe existing renderers; no raw HTML injection.

“Use this draft” is the explicit decision to copy the reviewed payload into the current user's scoped recovery slot. Refuse to replace an existing non-empty owned draft; let the user finish that draft first. Persist the owned copy successfully before opening the normal autosaving editor. If that write fails, leave both the legacy record and current editor unchanged. Revalidate scope and the reviewed legacy snapshot before adoption so a newer legacy write is not accidentally selected. The legacy record remains unchanged even after remote success; no Discard control or legacy cleanup in C1. Repeated review/adoption must not silently duplicate a previously saved step: retain the legacy step identity and use the existing idempotent step save semantics, with an explicit regression test.

This is application-level separation, not protection from someone with access to the browser profile. Legacy review is an explicit exception for unowned content, not proof of original ownership. Record the exact user approval before shipping this UI. Backend/store tests and an isolated UI preview can proceed while that approval is pending.

## Acceptance tests

Write focused failing regressions before implementation. Tests must inspect stored payloads and database outcomes, not only mock calls.

| ID | Required case | Pass condition |
|---|---|---|
| T1 | Same user, products X then Y then X | Independent records; original X content recovers |
| T2 | Tasks A then B then A in one product | Both records preserved; selected task restores its own content |
| T3 | Users U1 then U2 then U1 in one browser context | U2 never automatically receives U1 owned payload, including parked-session hydration; U1 can recover |
| T4 | Two tabs restore same draft and produce equal counters but different tokens | Ack for token A never deletes stored token B; exact B acknowledgment clears B |
| T5 | Delayed local put, remote success, newer edit | No acknowledged-record resurrection by an older put; newer snapshot remains recoverable |
| T6 | Same snapshot immediate write, debounce, retry | Token carried consistently; successful full save removes only that snapshot |
| T7 | Project/account change during restore, timer and queued save | No stale display or newly initiated save under the wrong account; late completion isolated |
| T8 | Identity loading, null identity, identity later available | No shared key; no silent reassignment; same-session pending edit can become durable |
| T9 | Legacy preview, Back, Not now, Use, repeat Use, existing owned draft | No writes during preview; no legacy mutation/deletion; no replacement of owned work or duplicate step |
| T10 | Unknown schema, malformed payload, absent task | Bytes preserved; no automatic replay or overwrite |
| T11 | Storage quota/open/request/transaction abort; remote/tools/photo failure | Settled error handling; no false cleanup; recoverable record retained where previously committed |
| T12 | Reload after local commit with remote save blocked | Exact payload restored; database remains unsaved until retry succeeds |
| T13 | Immediate reload without reading/waiting for local record | Characterize observed loss window; no universal durability claim or flaky pass threshold |

Use unit tests for token/key/transaction contracts and component tests for lifecycle and UI intent. Real Chromium IndexedDB must cover T1/T2, T3 in one profile, T4 with two pages, T9 and T12. Synthetic users and fixtures only. A mock cannot establish browser transaction concurrency.

## Measurements and scope budget

Success metrics are zero cross-scope overwrites in the fixture matrix, zero mismatched-token deletions, zero legacy-record modifications, and zero unintended remote writes during review/account-switch cases. All are test assertions, not claims of universal correctness.

Compare browser-issued mobile-open request counts on the same small/medium/stress fixtures with the recorded 30/30/114 baseline. Explain any delta; do not add network traffic per keystroke for identity. Measure compressed portal bundle delta and investigate unexplained growth above 2 KiB. No promised speedup. Do not repeat every historical benchmark or collect latency statistics unless a relevant regression appears.

Estimated planning allowance, not a target or measured result: store/types +100–180 net lines; portal lifecycle +80–160; legacy UI +60–120; tests/support +300–500; documentation +20–50. Approximately 7–10 files, 560–1,010 net lines. Reuse existing components. If implementation exceeds this materially, explain the concrete dependency rather than automatically extracting another subsystem or writing another design document.

## Execution and completion

1. Confirm the merged baseline and create the feature branch. Read repo instructions. Reuse the existing inventory; no broad research agents or new architecture audit.
2. Implement scoped storage and exact-token acknowledgment behind focused regression tests. Keep production entry points coherent at each commit.
3. Integrate lifecycle checks and task-specific restore. Build the legacy-flow preview for the single required user UI review. Do not release a build with inaccessible legacy drafts as an interim shortcut.
4. After UI approval, wire the legacy flow and run the acceptance matrix. Keep same-task concurrent-write replacement explicitly deferred.
5. Run full unit suite, lint, production build, then typecheck and bundle gate; relevant browser cases plus existing suite. Follow established active-database checks against isolated fixtures. Never run reset-based tooling on retained databases; restore initial running/stopped state and retain volumes.
6. Report baseline/final SHA, changed files, exact test counts, request/bundle deltas, UI approval evidence, unresolved limitations and rollback behavior. Old code cannot read v2 records after rollback; records must remain stored for re-upgrade, not be copied back into the global v1 key.
7. Commit locally and stop for review. No merge/push or next package without instruction.

Do not restart planning over pre-existing limitations already excluded here. Escalate only a failed acceptance criterion, a required visible change beyond the proposed review flow, or a preservation/auth boundary that cannot be met within this scope.
