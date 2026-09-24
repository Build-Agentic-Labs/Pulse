# SOP review flow — what is left

Status as of 2026-09-24, after the review-queue, reminder and author-feedback work
(merged to `main` 2026-09-23/24, plus `feat/sop-back-to-queue`). Older decided-but-undone
items live in [deferred-work.md](deferred-work.md); this file covers only what this round of
work left open.

## What shipped (for context)

- Review queue: one plain table (Number · Title · Author · Status · Received) grouped into
  **Needs your review**, **Feedback on your SOPs** and **Awaiting Quality release**; sidebar
  badge with the actionable count; unreleased SOPs show `SOP-DEPT-###`.
- Reviewers clicking an SOP land in its review, never the author's builder.
- **Remind** button (author only, once per 24 h per reviewer, email + in-app).
  Migration `20260923120000_sop_manual_reviewer_reminder.sql`.
- Final approval locked until every returned remark is addressed; the single-round review
  migration `20260921230000_sop_review_flow_hardening.sql` applied to production 2026-09-24.
- Author's Draft Review is the document itself: remark cards in the margin, edit the section
  in place, mark addressed, next step in the page bar; flagged sections highlighted.
- One header back arrow everywhere: back one page, else the page's parent.

## Needs a decision

| Item | Options | Notes |
|---|---|---|
| Final approval from **All SOPs** | Route a seated approver to the queue's signature workspace (like draft review now does), or keep the builder's final-approval step | Draft review already routes to the queue; signatures do not yet. |
| Back arrow inside the SOP builder | Make each builder step a history entry so the arrow steps back through steps, or keep steps out of history | Today the arrow leaves the SOP; Back/Next and the sidebar move between steps. |
| Feedback view header | Drop the duplicated SOP title from the page bar; drop the ✕ now that the sidebar is visible | Cosmetic. |
| Remark card accent | Give margin cards a matching amber accent | Only the document section is highlighted today. |
| `SOP-DEPT-###` in lists | Keep the placeholder, or add an "Unreleased" hint | Owner chose the placeholder "for now". |
| Turnaround metrics | Build a report from the data already recorded | Sent (`review_sent` event), received and returned (`sop_review_submissions.submitted_at`), signatures (`signed_at`) are all stored; nothing reads them yet. |

## Known gaps (small, not yet done)

- **Process flow and annexes can't be edited from a margin card.** Their remarks show
  "Edit in builder". The other six sections edit in place.
- **Narrow screens:** margin cards need room beside the page. Below roughly 1,100 px they
  crowd the page; there is no stacked mobile layout yet.
- **Loading state back target:** while an SOP loads, the header arrow's fallback is always
  All SOPs, even when it was opened from the Review queue. Only matters if the page is
  opened fresh in a new tab.
- **Quality release rows** in the queue use the SOP's last-updated date as "Received"
  (there is no approved-at on the list row).
- **Bell vs sidebar counts differ by design:** the bell hides items you have clicked; the
  sidebar badge counts until the work is done.

## Verify live (not yet exercised end to end)

- **Remind:** not clicked for real — doing so emails a real reviewer. The database rules were
  checked against production in a rolled-back transaction.
- **Mark addressed / Send for signatures** on a real SOP after the flow migration: not
  clicked (would change live data). The Process Engineering SOP "Last-Minute Order
  Escalation" is the natural test once its last remark is addressed.
- **Email delivery locally:** `/api/sops/notifications/drain` returns 503 on the dev server,
  most likely a missing `SUPABASE_SERVICE_ROLE_KEY` / `RESEND_*` in `.env.local`. Production
  sends via the Vercel cron.
- **pgTAP suites** run only in CI (no Docker locally).

## Housekeeping

- **Delete the test SOP** `sop-test-review-98de0ca8` ("TEST - review flow (delete me)") with
  the cleanup script from the session, then check it succeeded. It has not been run; it may
  need the auto-written change-history row (and any notifications) removed first.
- **Duplicate SOPs:** production holds four "Last-Minute Order Escalation and Approval
  Process" rows (three drafts, one owned by Jennifer Li). Confirm which to keep.
- **Migration history:** migrations applied with `scripts/apply-migration-safely.mjs` are not
  recorded in `supabase_migrations.schema_migrations` (it stops at 20260918130000). Check live
  function definitions, not that table, to know what is applied.
- **Other work in this checkout:** the problem-solving pilot (migration
  `20260924180000_problem_solving_pilot.sql`) was merged by a separate session; whether its
  migration is applied to production was not checked here. The training & qualification
  spec is intentionally left uncommitted.
