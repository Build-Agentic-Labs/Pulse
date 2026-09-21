# SOP review-flow audit — September 21, 2026

The current production flow has confirmed defects and should not yet be treated as fully verified for company sign-off. Fixes are prepared locally on `codex/sop-review-flow-audit`. No production migration, deployment, company-record update, invitation, signature, or test email was performed.

## Expected routing

Each required department names one person in the Approvals roster. That same person returns draft feedback and later signs the formal departmental approval. Reviewer and Approver department roles both appear as eligible choices in the roster. Adding someone to a department alone does not assign an SOP: they must occupy its roster seat, and the author must send the SOP for review.

An invited nominee can occupy a seat before joining. Workspace-grant redemption retains their user identity and assigned seat, and makes the review accessible after acceptance. Pending nominees do not receive an actionable review request before joining; reminders go to the author. Administrative reassignment handles unavailable reviewers.

After every assigned reviewer responds, the author addresses remarks and requests final signatures. Current-content signatures from every required department move the SOP to approved automatically. An independent Quality approver then signs and releases it. Quality release cannot be performed by the author, submitter, any seated reviewer, or someone who overruled an objection in that cycle.

## Confirmed defects and local corrections

Feedback dead end (high priority). The editor and review-submission RPC enforce one draft review per reviewer per cycle. A later migration restored a contradictory final-approval requirement for an affirmative review on the latest content hash. After feedback, edits, and resubmission, reviewers could neither submit again nor advance to signatures. The migration restores the single-round contract: all required reviewers must have responded and all remarks must be resolved. Formal signatures remain bound to the exact current content and cycle.

Direct-update bypass (high priority). An authorized direct update to the SOP could populate final-approval fields without calling the gated request RPC. A reproduced database test caught no exception when reviews were still outstanding. A new column trigger applies the same completion and authorization checks, stamps the real requester and content hash, and prevents forged values. A separate event trigger records exactly one request event, including for a valid direct update; repeated RPC requests remain idempotent.

Revoked reviewer access (high priority). The SECURITY DEFINER review-submission RPC checked seat identity but not current workspace and department membership. It now requires both and locks the SOP row to serialize against recall and reassignment. The final-approval request also rechecks read access for an author/submitter whose membership was removed.

Reassignment during final approval. A replacement could inherit a formal-signature task without completing draft review; an admin could also assign the original submitter, who is barred from signing. Reassignment now rejects the submitter and reopens draft review when the replacement has not reviewed this cycle. Signed seats remain immutable. Successful client reassignment kicks notification delivery immediately.

Cross-SOP signature matching. Batched signatures discarded their SOP identity, and the final-approval queue matched only department, cycle, and hash. The store now preserves SOP identity and the queue includes it when matching signatures, preventing another SOP's signature from hiding a pending item.

Quality queue eligibility. The queue showed every approved SOP to every Quality approver, including people barred from releasing that SOP. It now excludes the author, submitter, seat holders, and current-cycle objection overrulers. General in-flight visibility remains available in the data.

Department changes could lose routing. Moving a roster seat deleted its original row before inserting the replacement; a rejected insert could leave no seat. Signer eligibility also came from stale React state after an asynchronous fetch. The operation now fetches current destination membership and updates the seat atomically. Database and component regressions cover preserved routing and a successful move.

Notification destinations. Review, departmental-signature, and reassignment notifications opened the author editor rather than the screen containing the recipient's actions. Both email and inbox links now open the review queue. Author and Quality actions retain their specific SOP links.

Stale notifications. Event assembly discarded review-cycle identity, allowing prior-cycle events to be reconsidered against a new cycle. The resolver now filters these out. A review request also excludes reviewers who already returned this cycle. Pending invitees in the final-signature reminder path now prompt the author rather than receiving an action they cannot perform.

Incomplete roster readiness. An unstaffed required seat was omitted from the set of reviewers used to calculate readiness. The author queue now refuses readiness while any required seat is empty.

A pre-existing Windows-only test failure compared CRLF file text against a normalized template literal. The assertion now normalizes line endings; the production restructuring instruction is unchanged.

## Live observations

The hosted database migration ledger included every migration present on main at the start of the audit. The latest eight notification-drain records were healthy, including scheduled and browser-triggered runs. The 30-day SOP ledger contained three successful sends (two review-complete notices and one escalation), with no unsent rows in that query. This proves recorded provider acceptance for those rows, not delivery of newly assigned reviews or arrival in a recipient's mailbox.

The live snapshot contained 14 drafts and one in-review SOP. The in-review row had no title and its seated member had Author department access. No production data or access roles were changed. The database's existing signing model is designated-seat identity plus active membership; its department-role behavior was not silently changed into a different policy.

Read-only browser inspection of the open Last-Minute Order Escalation and Approval Process SOP showed no required departmental seats, only the automatic Quality gate. The Manufacturing/Production picker showed no eligible Reviewer or Approver members, with Invite a reviewer available. Its Send for review button also reported a separate procedure-validation issue: the Yes and No branches of decision step 9 pointed to the same destination. These are observed setup/content conditions, not notification failures; they were left untouched.

## Verification and limits

The complete application suite passed: 183 files, 1,529 tests. Typecheck, lint, production build, client bundle budgets, and git diff whitespace checks passed.

All 15 SOP/nomination SQL suites passed: 228 pgTAP assertions, including 24 new end-to-end regressions. Coverage includes feedback and edited resubmission, direct-update gating, event deduplication, requester/hash integrity, final-stage reassignment, independent Quality release, revoked membership, atomic department moves, nomination acceptance, tenancy, quorum, objections, signatures, and frozen release history.

Docker Desktop failed to start. Database checks therefore ran on an isolated PostgreSQL 18 instance containing schema definitions read from the hosted database, including functions, relevant triggers, RLS policies, and function privileges. Only synthetic fixture records were written locally; company rows were not copied. The finished migration was applied from the unpatched schema snapshot and the suites rerun. This is not a fresh replay of the entire Supabase migration history on the configured PostgreSQL 17 stack; normal database CI remains a release requirement.

The migration changes function bodies and adds trigger functions, without changing tables, callable RPC arguments, or return shapes. `npm run gen:types` was attempted but the Supabase CLI is not installed on PATH. The existing generated types were left untouched, and application typecheck passed.

The browser check was read-only against the existing live application. The patched code has not been browser-tested against a fully isolated Supabase/auth deployment with separate author, reviewer, and Quality sessions. No real email was sent, and no mailbox acceptance test or live controlled release was performed. CI has not run for these uncommitted local changes.

## Release handoff

Apply `20260921230000_sop_review_flow_hardening.sql` through the normal migration process and deploy the application changes together after CI. Then exercise an explicitly disposable SOP with distinct author, departmental reviewer, and independent Quality approver accounts: assignment/invite acceptance, one feedback round, resolved edits, final signatures, and release. Confirm each real notification opens the correct action and reaches the intended recipient. Until that deployment and smoke test are complete, these local results are not a certification that production is fully functional.

## Automatic reviewer indicators (follow-up)

All SOPs now derives reviewer-circle status from current-cycle feedback, unresolved comments, and signatures bound to the current SOP, signer, department, cycle, and content hash. Resolved feedback clears red; final approval shows awaiting signature; all of a reviewer's assigned seats must be signed before showing Signed. Indicators remain visible during author corrections and while awaiting Quality. Existing visible-page polling refreshes these statuses every 15 seconds and on window return. The feedback dialog uses the same current status labels.

Seven focused tests passed, including stale/cross-document signatures and multiple seats. Typecheck and lint on changed files passed. These changes do not introduce database schema changes.
