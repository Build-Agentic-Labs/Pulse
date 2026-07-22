# SOP Email Notifications — Design

**Date:** 2026-07-21
**Status:** Approved (brainstorm complete, pending implementation plan)
**Problem:** SOPs stall waiting on a signer. The pull-based queue at `/sops/review`
already answers "what's waiting on me," but signers who don't visit the app never
see it. Email is the only delivery channel (explicit decision — no in-app bell, no
web push).

## Decision summary

Outbox-style architecture with three amendments (adopted after adversarial review):

1. **The event stream is the source, not status changes.** `sop_event_log` is
   written transactionally with every transition — including the two button-less
   edges (`sign_sop`-internal approve/reject, and `request_sop_final_approval`,
   which never changes `sops.status` at all). A status trigger would miss the
   final-approval stall entirely.
2. **Fan-out decisions live in TypeScript, not plpgsql.** The recipient rules are
   intricate (actor exclusion, Quality-approver bars, recall-vs-reject
   disambiguation) and belong in Vitest. `sop_event_log` already *is* the outbox;
   no enqueue trigger and no queue table exist. The one new table is a **send
   ledger**, not a queue.
3. **Reminders are computed by scanning current state at drain time, never
   pre-scheduled.** Scan-based reminders self-cancel on recall, rejection,
   retirement, and seat reassignment — and a reassigned seat's new signer gets
   their first nudge naturally.

Recipients resolve at **drain time** (current roster), not frozen at event time.
These are "action needed now" emails; the event log is already the frozen
historical record. A pre-send state check skips any email whose moment has passed
(a stale "please review" trains people to ignore notifications).

Rejected alternatives:

- **Fire inline at transition time** — misses the `sign_sop`-internal transition
  (`src/domain/sop/lifecycle.ts:117` — that edge has no button), loses mail when
  the tab closes, and still needs a cron for reminders.
- **Supabase Edge Function via pg_net + pg_cron** — a second deploy target with
  no repo precedent, a second secret store, and the recipient logic exiled from
  Vitest.

## Data model

One new table (migration), plus zero changes to existing tables:

```sql
create table public.sop_notifications (
  id                 bigint generated always as identity primary key,
  sop_id             text not null references public.sops(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null,          -- see Kinds below
  event_id           bigint references public.sop_event_log(id) on delete cascade,
                                             -- null for reminders
  reminder_index     integer not null default 0,   -- 0 = first-touch, 1..2 = nudges
  sent_at            timestamptz,            -- null = claimed but unsent
  attempts           integer not null default 0,
  last_error         text,
  resend_message_id  text,
  created_at         timestamptz not null default now()
);

-- Exactly-once per event occurrence (first-touch mail):
create unique index sop_notifications_event_recipient_key
  on public.sop_notifications(event_id, recipient_id)
  where event_id is not null;

-- Exactly-once per nudge (reminders):
create unique index sop_notifications_reminder_key
  on public.sop_notifications(sop_id, recipient_id, kind, reminder_index)
  where event_id is null;
```

- **Idempotency anchors on `(event_id, recipient_id)`.** Explicitly NOT
  `content_hash` or `review_cycle`: `review_cycle` increments only on
  `effective → draft`, so a rejected SOP resubmitted with identical content
  reuses the same (cycle, hash) tuple and a hash-keyed index would swallow the
  legitimate second email. Each transition inserts a fresh `sop_event_log` row,
  so event-id anchoring gives exactly-once with no hash reasoning.
- **RLS posture copies `sop_event_log` exactly** (migration
  `20260715170000`, lines 38–45): RLS enabled, zero policies for
  `authenticated`, `revoke insert, update, delete from anon, authenticated`.
  Written and read only by the service-role drain. (No select grant to
  `authenticated` at all — unlike the event log, users never read this table.)
- **Stores `recipient_id`, never an email address.** `profiles.email` is
  resolved at send time — picks up address changes, keeps PII out of the ledger.

## Kinds, triggers, recipients

| Kind | Source event in `sop_event_log` | Recipients | Skip unless *now* |
|---|---|---|---|
| `review_requested` | `review_sent` | signers of every seat with `rasic <> 'informed'` — **not just R/A**; the draft-review phase blocks on all non-informed seats (`request_sop_final_approval` refuses until every such seat responds) | status still `in_review` AND `final_approval_requested_at` is null |
| `final_approval_requested` | `final_approval_requested` | Responsible/Accountable seat signers | status still `in_review` AND `final_approval_requested_at` set |
| `quality_release_requested` | `status_changed` with `details->>'to_status' = 'approved'` | approvers (`canDeptApprove`) in the workspace's `is_quality_gate` department, **minus** anyone barred from releasing by `lifecycle.ts:132-138`: seat-holders, the author, the submitter, and this-cycle overrulers | status still `approved` |
| `sent_back` | `review_returned` with `details->>'no_changes' = 'false'` | the SOP author (`created_by`) | SOP not obsolete/deleted |
| `sent_back` | `review_recalled` **AND** a current-cycle rejection signature exists | the SOP author | status still `draft` |

Universal rule: **the event's `actor_id` is always excluded** — nobody is
notified of their own action.

The recall-vs-reject disambiguation matters because `in_review → draft` covers
both submitter recall and reviewer rejection under the same event name
(`review_recalled`). Without the rejection-signature guard, authors would be
emailed about their own recalls. The rejection check mirrors the `sentBack`
derivation in `src/lib/sop/review-queue-data.ts`.

The two `sent_back` sources share one kind deliberately: to the author, "sent
back with remarks" and "rejected to draft" are the same call to action; the
ledger's event-id key still separates them.

The skip-unless-now column is asymmetric by design: signer mail is skipped
aggressively (stale "please review" is harmful), while `sent_back` mail survives
most subsequent state (remarks still need addressing).

## Reminders

Scoped to **signer stalls only** (kinds `review_requested`,
`final_approval_requested`, `quality_release_requested`). No author re-nudges on
`sent_back` in v1 — the stated problem is signers.

- Constants, hard-coded in the domain module: `REMINDER_AFTER_DAYS = 3`,
  `MAX_REMINDERS = 2`. No per-workspace settings.
- A reminder is due when the stall condition **currently holds** (seat unsigned /
  review unsubmitted / approved SOP unreleased) and ≥3 days have passed since
  the anchor: the source event's `created_at` for nudge 1, the previous
  reminder's `sent_at` for nudge 2.
- Eligibility is recomputed from live state every drain, so reminders self-cancel
  when the SOP is recalled, rejected, retired, or the seat is reassigned. A
  reassigned seat's new signer enters the scan and receives nudge 1 (their
  first) — no special-case enqueue needed.
- Reminder ledger rows have `event_id = null` and `reminder_index` 1..2; the
  partial unique index makes each nudge exactly-once.

## Domain module

`src/domain/sop/notifications.ts` — pure, no I/O, colocated test. Exports:

```ts
resolveEventRecipients(event: NotifiableEvent, ctx: SopNotificationContext): PendingNotification[]
resolveReminders(now: Date, sopStates: SopReminderState[]): PendingNotification[]
```

Both return `{ recipientId, kind, sopId, eventId?, reminderIndex }` — decisions
only. `ctx` carries the SOP snapshot, seats, quality-approver facts (with the
four bar flags precomputed), and current-cycle rejection existence — plain
values, assembled by the drain, so tests never mock a client. `details` jsonb
from old events is treated as `unknown` and narrowed defensively; unparseable
events are skipped and counted, never thrown on.

Also in this module: **four literal template functions** returning
`{ subject, text, html }`. No template engine, no channel abstraction, no
per-event-type registry.

| Kind | Subject shape |
|---|---|
| `review_requested` | `Review requested: SOP-0042 "Line Clearance" (Rev C)` |
| `final_approval_requested` | `Signature needed: SOP-0042 "Line Clearance"` |
| `quality_release_requested` | `Ready for release: SOP-0042 "Line Clearance"` |
| `sent_back` | `Sent back with remarks: SOP-0042 "Line Clearance"` |

Body: one sentence of what happened and who acted; one sentence of what's needed
from the recipient (naming the seat's department for review mail); a button-link
to `{origin}/sops/{id}`; dates via `formatDate` from `@/domain/formatting`
(email is a UI surface, not a controlled document — `formatDateControlled` does
not apply). Reminders reuse the same templates with a `Reminder: ` subject
prefix and a "waiting N days" line.

## Drain route, kick, cron

**One route, two callers:** `app/api/sops/notifications/drain/route.ts`.

| Caller | Method | Auth |
|---|---|---|
| Vercel Cron (daily) | GET | `Authorization: Bearer ${CRON_SECRET}` — Vercel attaches it automatically once the env var is set; 401 without it |
| Kick (browser, post-mutation) | POST | `requireApiUser` + existing `createApiRateLimiter`; any signed-in user may kick — the drain is idempotent, over-kicking is harmless |

Drain algorithm (service-role client, mirroring `app/api/invites/route.ts`):

1. **Event scan** — `sop_event_log` rows in a 30-day lookback window whose
   `event_type` is one of the five sources, left-anti-joined against the ledger.
2. **Batch context fetch** — sops, seats, quality-department approvers,
   current-cycle rejection signatures, review submissions. Batched `IN` queries
   (the `listSeatsForSops` precedent); no per-SOP loops.
3. **Decide** — hand plain values to the domain resolvers.
4. **Send loop, claim-by-insert** — insert the ledger row first (the unique
   index IS the claim; a concurrent drain gets `23505` and skips), then POST to
   Resend's REST API with plain `fetch`, then stamp `sent_at` +
   `resend_message_id`. Per-row `try/catch`; one failure never aborts the batch.
5. **Retry lane** — rows with `sent_at IS NULL` older than a 10-minute lease are
   re-attempted (`attempts++`, `last_error` recorded), capped at 3 attempts,
   then left as dead rows. Hard bounces (Resend 4xx for a recipient) are marked
   dead immediately — never retried.
6. **Response** — counts (sent / skipped / failed / skipped_no_email) plus
   `oldestUnnotifiedEventAgeHours`, the health signal visible in cron logs.

**The kick:** `kickSopNotifications()` in `src/lib/sop/notify-kick.ts` — a
fire-and-forget `fetch` with a swallowed rejection, called after RPC success in
the four browser-only mutation wrappers: `signSop`, `requestSopFinalApproval`,
and `transitionSop` in `src/lib/sop/review.ts`, and `submitSopReviewResult` in
`src/lib/sop/review-annotations.ts`. Those wrappers use
`createPlannerSupabaseClient()` (browser-only by contract), so the kick cannot
run during server renders. A failed kick costs nothing; the cron is the
backstop. This neutralizes the inline approach's only advantage (latency)
without inheriting its flaws.

**Cron:** new `vercel.json`:

```json
{ "crons": [{ "path": "/api/sops/notifications/drain", "schedule": "0 13 * * *" }] }
```

Daily (Hobby-plan-compatible; per-minute needs Pro). With kicks handling
first-touch latency, daily granularity is sufficient — "remind after 3 days" is
day-granular.

**Secrets:** new env vars `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`
(Vercel + `.env.local`). `SUPABASE_SERVICE_ROLE_KEY` already exists in
production. Missing `RESEND_API_KEY` → drain runs scans but reports
`configured: false` and sends nothing (the invites-route degrade pattern);
local dev needs no mail secrets.

**Zero new npm dependencies.** Resend via raw `fetch` — avoids the `relock.yml`
lockfile workflow entirely.

**Deliverability precondition:** the sending domain must be verified in Resend
with SPF/DKIM (DMARC-aligned) before launch, or Google Workspace will
spam-folder everything and the feature silently fails its purpose. This is an
ops task, not a code task, and it gates go-live.

## Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Cron silently stops | Nothing visibly breaks | Kicks keep first-touch mail flowing; `oldestUnnotifiedEventAgeHours` makes the stall legible in Vercel logs. Observable, not alerting — no pager in v1 |
| Resend down / 5xx | Unsent rows accumulate | Retry lane; dead after 3 attempts, inspectable via `sent_at IS NULL AND attempts >= 3` |
| Hard bounce | 4xx for one recipient | Mark dead immediately, continue batch |
| Drain crashes mid-loop | Claimed-but-unsent rows | Lease expiry reclaims them next drain |
| Event ages past 30-day window | Permanent silence for it | Requires 30 days of every drain failing while the age metric screams. Accepted |
| `profiles.email` null | No address | Skip, count as `skipped_no_email` |
| Crash between Resend 2xx and stamp | Rare duplicate email | Accepted at-least-once cost; `resend_message_id` aids diagnosis |
| Kick fails | Mail waits for daily cron | By design; silent catch |
| Malformed old `details` jsonb | Resolver can't classify | Narrow defensively, skip + count, never throw |

Load-bearing invariant: **facts are never lost.** The event log is written
transactionally regardless of this feature's health, so every failure above is a
delay, not a loss — a fixed drain re-derives everything from durable state.

## Testing

- **`src/domain/sop/notifications.test.ts`** (the bulk): table-driven over both
  resolvers — one case per rule-table row plus each exclusion: actor excluded
  everywhere; informed seats never mailed; Support/Consulted mailed on
  `review_sent` but not `final_approval_requested`; each of the four Quality
  bars; `review_recalled` without rejection signature → no mail;
  `no_changes: true` → no mail; every skip-unless-now case; reminder anchor
  math, 3-day boundary, `MAX_REMINDERS` cap, self-cancel, reassigned-seat nudge.
  Template tests: subject shapes, SOP link present, reminder prefix.
- **Drain route test** (pattern of `src/lib/api-auth.test.ts`): GET without
  `CRON_SECRET` → 401; POST unauthenticated → 401; missing `RESEND_API_KEY` →
  `configured: false` with scans still run; `23505` on ledger insert → skip,
  not failure. Resend `fetch` stubbed at the boundary.
- **Migration** applied via the live-DB flow; RLS posture verified by a
  query-as-authenticated-user check.
- **Live verification** (CLAUDE.md rule 6): drive a real SOP through
  submit → sign → final approval in the browser with Resend in test mode;
  confirm ledger rows and all four kinds; one cron-shaped `curl` with the
  bearer to prove the GET path.

## Explicit YAGNI cuts

- No in-app bell, no web push, no weekly digest (user decisions).
- No channel abstraction, template engine, or event-type registry.
- No preference center; not even `email_muted` until the first complaint.
- No Resend SDK; no bounce webhooks; no delivery-status UI; no
  notification-history page (`sop_event_log` panel is the history).
- No author reminders; no enqueue-on-reassignment special case (the scan covers
  it within a day); no per-workspace reminder settings.
- No alerting/pager on drain health — the age metric in cron logs only.

## Post-migration checklist

- `npm run gen:types` and commit `src/lib/database.types.ts` (CLAUDE.md).
- Set `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET` in Vercel and `.env.local`.
- Verify sending domain in Resend (SPF/DKIM) — gates go-live.
