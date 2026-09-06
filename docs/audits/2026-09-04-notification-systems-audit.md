# Notification Systems Audit — 2026-09-04

**Scope:** every surface that tells a human something happened — SOP email
pipeline, workspace welcome email, notification bell, invitation email,
password-recovery email, and the Supabase auth mailer. Code, migrations, specs,
tests, Vercel env, and the live production database were all inspected.

**Verdict:** the SOP email pipeline is well-engineered for what it covers —
outbox + ledger, exactly-once claims, attempt-scaled retry, failure
classification, and a health verdict. But it covers a narrow slice of what
the app does, and the slice it covers has produced **one email in 45 days**.
The single live stall in production (an SOP in review for 37 days) is one the
pipeline cannot see. Nothing watches the health signal. Invitation and recovery
mail bypass the ledger. There is no inbox, no preferences, no delivery
tracking, and no run log. It is a solid transactional-email kernel, not yet a
notification *system*.

---

## 1. Inventory — what exists today

| Surface | Trigger | Transport | Ledger | Tests |
|---|---|---|---|---|
| SOP workflow email (4 kinds) | `sop_event_log` scan, 30-day window | Resend REST via drain | `sop_notifications` | 43 domain + 29 drain |
| SOP reminders (signers only, day 3 & 6) | live-state scan at drain time | same | same table, `event_id null` | in domain tests |
| Workspace welcome | `audit_log` `workspace_members.insert` | same drain, second store | `workspace_notifications` | 9 + 5 |
| Notification bell | poll `fetchReviewQueueData` every 60s + focus | in-app, derived | none (localStorage acks) | 1 + 9 summary |
| Invitation / access-granted email | `POST /api/invites` | Resend, inline, fire-and-forget | **none** | 2 template |
| Password recovery code | `POST /api/auth/password-reset/request` | Resend, inline | **none** | — |
| Signup confirmation, email change | `supabase.auth.signUp` | **Supabase built-in mailer** | n/a | — |
| Drain trigger | Vercel cron `0 13 * * *` (GET) + browser kick (POST) after 5 mutation sites | — | — | 3 kick |

Key files: `app/api/sops/notifications/drain/route.ts`,
`src/lib/sop/notifications-drain.ts`, `src/lib/sop/notifications-store.ts`,
`src/domain/sop/notifications.ts`, `src/lib/workspace/welcome-store.ts`,
`src/components/notification-bell.tsx`, `app/api/invites/route.ts`,
`app/api/auth/password-reset/request/route.ts`.

Production env (Vercel): `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`,
`NEXT_PUBLIC_SITE_URL` present in Production + Preview;
`SUPABASE_SERVICE_ROLE_KEY` Production only (so previews cannot drain — good).

Ledger posture verified live: RLS on, zero policies, grants only to
`postgres` and `service_role`. Indexes match the migrations. All 14 members
have a `profiles.email`. Notification test files: 8 files, 101 tests, green.

---

## 2. Broken or degraded — verified against production

### 2.1 The pipeline is blind to author-side stalls (the one live stall)

SOP `e8418fea` has been `in_review` for **37 days**. Its only blocking seat
returned "no changes needed" on 2026-07-29 (event 50). The next step is the
*author* clicking "Send for final approval"
(`src/components/sop/sop-editor.tsx:2129-2140`). There is no notification kind
for "every reviewer responded", and `resolveReminders` only generates nudges
for signers (`review_requested`, `final_approval_requested`,
`quality_release_requested`). Result: zero emails, zero reminders, zero bell
entries for the author. The system built to end stalls has the only stall in
production sitting in its blind spot.

Production reminder count, all time: **0**.

### 2.2 No proof the daily cron has ever run

Nothing a drain does is recorded except ledger rows. The only ledger row
(`id=1`) was stamped 2026-08-05 05:33 UTC — the manual revival, not the 13:00
UTC cron. There is no `drain_runs` record, no structured log, no log drain.
"Is the cron running?" cannot be answered from anything in the repo or
database. The 2-week RESEND_FROM outage would look identical today until
someone opened the Vercel cron page.

### 2.3 The 503 health signal has no consumer

`assessDrainHealth` is correct and tested, but no Sentry, uptime check, log
drain, or alert route exists in the repo or `package.json`. A 503 at 13:00 UTC
is written to Vercel's function log and nowhere else.

### 2.4 Duplicate-send window on every send

`createResendSender` posts with no `Idempotency-Key`. Sequence: claim → Resend
accepts → `markSent` fails (DB blip, function timeout) → row is unsent → retry
lane resends 30 minutes later. Resend supports idempotency keys; the ledger id
is the natural key. Today exactly-once is true for the *claim* but not the
*send*.

### 2.5 `sent_at` means "Resend accepted", not "delivered"

No webhook route exists. Bounces, complaints, and deferred delivery are
invisible; a hard-bouncing address is retried on every future event forever.
No suppression list. An admin cannot answer "was Tomas actually notified?"

### 2.6 Invitation and recovery mail bypass the ledger

`app/api/invites/route.ts:83-94` (`deliver`) and the recovery route send
inline, log a `console.error` on failure, and forget. No record of what was
sent to whom, no retry, no resend history. 22 grants exist in production; the
number of invitation emails that actually went out is unknowable. For an
access-control product, the invitation is the highest-stakes email you send.

### 2.7 Welcome email path has never fired and mostly cannot

10 `workspace_members.insert` events since 2026-08-13. Nine were invite
redemptions (skipped by design — `wasRedeemedInvite`), one was removed before
the drain saw it. Zero `workspace_notifications` rows. Only domain auto-join
can trigger a welcome, and none has occurred since the feature shipped. The
feature is unexercised in production for six weeks; treat it as untested.

### 2.8 Reminder cap = permanent silence after day 6

`MAX_REMINDERS = 2`, `REMINDER_AFTER_DAYS = 3`. A signer who ignores the day-3
and day-6 nudges is never contacted again, and nobody else is told. No
escalation, no digest, no SLA.

### 2.9 Retry budget is ~3.5 hours, then the row dies silently

Three attempts at 30 / 60 / 120-minute spacing. A Resend incident longer than
that kills rows permanently; dead rows (`attempts >= 3`, `sent_at null`)
surface nowhere except a hand-written SQL query. The 30-day event window also
means an event that stays undelivered for a month ages out silently.

### 2.10 Auth emails still ride Supabase's built-in mailer

`src/lib/auth-form-actions.ts:54` calls `supabase.auth.signUp` and tells the
user to check their inbox. Signup confirmation and email-change confirmation
go through whatever SMTP the hosted project has. **Could not be verified this
session** (management-API token access was blocked). If it is Supabase's
default mailer, it is rate-limited to a few emails per hour and is explicitly
not for production. Invites and recovery were already moved to Resend for
this reason; the remaining auth templates were not.

### 2.11 Bell: per-device acks, app-wide polling

Acknowledgments live in `localStorage` keyed by workspace+user, so a dismissal
on one device leaves the badge lit on another. Each poll runs six Supabase
queries per signed-in user per minute plus on every window focus, in every
space. Trivial at 14 users; a ceiling at 500.

### 2.12 Minor

- `isAuthorizedCronRequest` compares `CRON_SECRET` with `===` (not
  constant-time). Low risk, one-line fix.
- Retried first-touch emails and the welcome retry lane render with actor
  "Pulse" / `selfCaused: true` — wording degrades on retry (known, accepted).
- Kick rate limiter is per-instance in-memory (documented; fine at this scale).

---

## 3. Missing for enterprise grade

### 3.1 Event coverage

Today: 4 SOP kinds + welcome. Not covered:

- **Author: review complete → request final approval** (the live stall).
- **Release / effective**: nobody — author, seats, or *Informed* seats — is
  told an SOP went effective. Informed seats exist for exactly this.
- **Objections**: raised, sustained, overruled, withdrawn (9+6+3 event writers
  in migrations, zero notifications).
- **Remarks**: `remark_added` events exist (2 in production), no notification.
- **Seat reassignment**: the new signer gets no first-touch email, only a
  reminder ≥3 days after the original `review_sent`.
- **Membership**: invite accepted (to the inviter), member removed, role
  changed, owner transferred.
- **Security**: password changed, new-device sign-in, MFA enrolment.
- **Planning / Production spaces**: zero notifications of any kind (work
  order approved, schedule changed, task assigned/blocked/overdue).

### 3.2 User preferences

None. No per-kind or per-channel toggle, no immediate-vs-daily-digest, no
quiet hours, no `List-Unsubscribe` header, no per-workspace defaults
(reminder cadence, escalation target). Transactional workflow mail can be
mandatory, but enterprise IT and the people receiving it expect control over
volume and cadence.

### 3.3 Persistent in-app inbox

The bell is a derived count with no history. Enterprise users expect: a list
of what they were notified about, cross-device read state, mark-all-read,
deep links that survive the item being resolved, and "you were emailed about
this on Tuesday".

### 3.4 Escalation and SLA

No stage SLAs, no escalation path (department head → Quality → admin), no
weekly stalled-work digest for Quality/admins, no "this SOP has been in review
for 30 days" anywhere.

### 3.5 Delivery tracking and suppression

Resend webhooks (`email.delivered`, `email.bounced`, `email.complained`), a
per-recipient delivery status, a suppression list honoured by the drain, and
an admin view of it.

### 3.6 Operational visibility and runbook

`notification_drain_runs` (started, finished, counts, problems, caller),
alerting on unhealthy runs and on cron silence, an admin page over the ledger
with one-click resend, and a written runbook (today the runbook is a memory
file).

### 3.7 Channels

Email only. The company authenticates through Entra; Microsoft Teams is the
natural second channel. Web push for the bell is cheap once an inbox table
exists.

### 3.8 Test coverage gaps

- No route test for the drain (auth, 503 path, both stores).
- No store test: `notifications-store.ts` is 490 lines of query assembly with
  zero tests; the welcome store has 5.
- No pgTAP asserting the ledgers' service-role-only posture (10 SOP pgTAP
  files exist; none touch `sop_notifications`).
- Bell: one render test.
- No end-to-end "transition → event → email" test against local Supabase +
  Inbucket.
- No production smoke that exercises the *app's* sender config (the 2026-07-22
  false positive hit Resend directly).

---

## 4. Roadmap

### Phase 0 — stop the bleeding (days)

1. **`review_complete` kind** → author, when every blocking seat has responded
   and no open annotations remain (mirror `finalApprovalReady` in
   sop-editor). Add author reminders for `review_complete` and `sent_back`.
   Backfill-safe: anchored on the last `review_returned` event id.
2. **`Idempotency-Key: sop_notifications:<ledger id>`** on the Resend POST.
3. **`notification_drain_runs` table** + insert per run (caller, counts,
   problems, duration). Cheap, and it answers "did the cron run".
4. **External heartbeat**: an uptime/cron monitor that GETs the drain with
   `CRON_SECRET` on a schedule and alerts on non-200 or silence. The 503 finally
   goes somewhere.
5. **Verify hosted SMTP**; if default, point Supabase custom SMTP at Resend
   (`smtp.resend.com`) so confirmation/email-change mail matches the rest.
6. **Dead-row surfacing**: daily digest to workspace owners listing blocked or
   dead ledger rows, or fold them into the health verdict.
7. Constant-time `CRON_SECRET` compare.

### Phase 1 — a notification core (2–4 weeks)

1. **`notifications` table** (recipient, workspace, kind, entity, title, body,
   link, created_at, read_at, delivered_channels jsonb). RLS: recipient reads
   and marks own. The drain writes one row per decision *before* email; email
   becomes one delivery channel of the row. Bell reads this table for history
   and keeps the derived actionable count for the badge. Cross-device read
   state for free.
2. **`notification_preferences`** (user × kind × channel, immediate/digest) +
   workspace defaults (reminder cadence, escalation target). Drain honours
   them.
3. **Resend webhooks** → `email_deliveries` + suppression list; drain skips
   suppressed addresses and reports them.
4. **Escalation policy**: day 3 and 6 nudge → day 10 escalate to the seat's
   department approver/admin → weekly stalled digest to Quality.
5. **Coverage**: release/effective (incl. Informed seats), objections,
   remarks, seat reassignment first-touch, invite accepted, member changes.
6. **Ledger the invite and recovery sends** through the same table.
7. **Cron cadence**: hourly if the Vercel plan allows; the kick remains the
   fast path.
8. **Tests**: drain route test, store tests on local Supabase, pgTAP for
   ledger posture, one e2e transition→Inbucket check in CI.

### Phase 2 — channels and operations (quarter)

1. Teams connector (incoming webhook per workspace, or Graph).
2. Web push for the bell.
3. Admin notifications console: ledger + deliveries view, resend, per-user
   history, health dashboard.
4. Sentry (or equivalent) with alert routing; SLOs: p95 event→send under 5
   minutes, zero dead rows older than 24 hours, cron heartbeat every run.
5. Runbook in `docs/runbooks/notifications.md`.

### Definition of "enterprise grade" for this app

Exactly-once *and* idempotent at the provider; every decision recorded before
delivery; delivery status known per recipient; preferences honoured;
escalation instead of silence; every run logged and alerted; invitations and
credentials audited like everything else; tests that exercise the real config
path; a runbook a new engineer can follow.

---

## 5. Could not verify this session

- Hosted Supabase auth SMTP / rate-limit configuration (token access blocked).
- Whether the Vercel cron has ever executed (no run record exists; requires
  the Vercel dashboard or a log drain).
- Resend-side deliverability (DMARC policy, bounce rate) — requires the Resend
  dashboard.

---

## Appendix — evidence queries (run with `psql "$DATABASE_URL"`)

```sql
-- Ledger totals by kind
select kind, count(*) total, count(*) filter (where sent_at is not null) sent,
       count(*) filter (where sent_at is null and attempts >= 3) dead
from sop_notifications group by kind;

-- Notifiable events vs ledger coverage
select e.event_type, count(*) events, count(distinct n.event_id) covered
from sop_event_log e left join sop_notifications n on n.event_id = e.id
group by 1;

-- In-flight SOPs by age (the stall list the pipeline should own)
select id, status, round(extract(epoch from (now()-updated_at))/86400) days
from sops where deleted_at is null and status in ('in_review','approved')
order by updated_at;

-- Welcome eligibility per member-add
select a.id, a.created_at,
  exists (select 1 from workspace_access_grants g
          where g.workspace_id=a.workspace_id and g.redeemed_by=a.target_id::uuid
            and abs(extract(epoch from (g.redeemed_at - a.created_at))) <= 5) invite
from audit_log a where a.action='workspace_members.insert' order by 2;
```

Findings as of 2026-09-04 (production, 60-day window): 1 ledger row (sent,
6.5-day lag from its event), 0 reminders, 0 welcome rows, 10 member-adds (9
invite redemptions), 1 SOP in review for 37 days, 26 auth users / 14 members,
all with emails.
