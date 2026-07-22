-- Send ledger for SOP email notifications. NOT a queue: sop_event_log is the
-- outbox (written transactionally with every transition); this table records
-- what has been sent, and its unique indexes are the exactly-once claims.
-- Spec: docs/superpowers/specs/2026-07-21-sop-notifications-design.md

create table public.sop_notifications (
  id                 bigint generated always as identity primary key,
  sop_id             text not null references public.sops(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind in (
                       'review_requested',
                       'final_approval_requested',
                       'quality_release_requested',
                       'sent_back'
                     )),
  event_id           bigint references public.sop_event_log(id) on delete cascade,
  reminder_index     integer not null default 0 check (reminder_index >= 0),
  sent_at            timestamptz,
  attempts           integer not null default 0,
  last_error         text,
  resend_message_id  text,
  created_at         timestamptz not null default now()
);

-- Exactly-once per event occurrence (first-touch mail).
create unique index sop_notifications_event_recipient_key
  on public.sop_notifications(event_id, recipient_id)
  where event_id is not null;

-- Exactly-once per nudge (reminders have event_id null, reminder_index 1..N).
create unique index sop_notifications_reminder_key
  on public.sop_notifications(sop_id, recipient_id, kind, reminder_index)
  where event_id is null;

-- Retry-lane scan: unsent rows.
create index sop_notifications_unsent_idx
  on public.sop_notifications(created_at)
  where sent_at is null;

-- Service-role only, both directions. Mirrors sop_event_log's write posture
-- (20260715170000 lines 38-45) but stricter: users never read this table.
alter table public.sop_notifications enable row level security;
revoke all on public.sop_notifications from anon, authenticated;
