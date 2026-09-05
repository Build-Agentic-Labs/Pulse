-- Notification core (Phase 0 of docs/audits/2026-09-04-notification-systems-audit.md).
--
--   1) sop_notifications: new kinds; review_cycle on every row so reminders in a
--      later review cycle are distinct claims (the old reminder key had no cycle, so
--      once a signer had received both nudges in cycle 0 they could never be nudged
--      again); a content snapshot so retries are byte-identical (a prerequisite for
--      Resend idempotency keys, which 409 on a changed body); skipped_reason marks a
--      row as terminal without a send (preference off, suppressed address).
--   2) workspace_notifications: membership kinds, content snapshot, skipped_reason.
--   3) notification_drain_runs: one row per drain invocation — the missing run log.
--   4) notification_digests: exactly-once ledger for periodic digests.
--   5) Two NEW event triggers feeding the outbox: signature_added (objections and
--      approvals are signature rows, not events) and seat_reassigned (a reassigned
--      signer had no first-touch email). Both call the live append_sop_event and
--      touch nothing in sign_sop / enforce_sop_transition (patched in place — never
--      rewritten from a file here).
--
-- Additive + idempotent. Apply with:
--   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904120000_notification_core.sql

-- ---------------------------------------------------------------------------
-- 1. sop_notifications
-- ---------------------------------------------------------------------------
alter table public.sop_notifications
  add column if not exists review_cycle integer not null default 0,
  add column if not exists content jsonb,
  add column if not exists skipped_reason text;

alter table public.sop_notifications drop constraint if exists sop_notifications_kind_check;
alter table public.sop_notifications add constraint sop_notifications_kind_check check (kind in (
  'review_requested',
  'final_approval_requested',
  'quality_release_requested',
  'sent_back',
  'review_complete',
  'released',
  'seat_assigned',
  'objection_raised',
  'objection_resolved',
  'remark_added',
  'stall_escalated'
));

-- Reminder claims are exactly-once per (sop, recipient, kind, nudge, CYCLE).
drop index if exists public.sop_notifications_reminder_key;
create unique index sop_notifications_reminder_key
  on public.sop_notifications(sop_id, recipient_id, kind, reminder_index, review_cycle)
  where event_id is null;

-- The reminder scan reads sent rows per in-flight SOP; the retry lane reads unsent rows.
create index if not exists sop_notifications_sop_idx
  on public.sop_notifications(sop_id);

-- ---------------------------------------------------------------------------
-- 2. workspace_notifications
-- ---------------------------------------------------------------------------
alter table public.workspace_notifications
  add column if not exists content jsonb,
  add column if not exists skipped_reason text;

alter table public.workspace_notifications drop constraint if exists workspace_notifications_kind_check;
alter table public.workspace_notifications add constraint workspace_notifications_kind_check check (kind in (
  'workspace_welcome',
  'invite_accepted',
  'role_changed',
  'member_removed'
));

-- ---------------------------------------------------------------------------
-- 3. notification_drain_runs — the run log. Service-role only.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_drain_runs (
  id           bigint generated always as identity primary key,
  caller       text not null check (caller in ('cron', 'kick', 'manual')),
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  healthy      boolean not null,
  problems     text[] not null default '{}',
  report       jsonb not null default '{}'::jsonb
);

create index if not exists notification_drain_runs_started_idx
  on public.notification_drain_runs(started_at desc);

alter table public.notification_drain_runs enable row level security;
revoke all on public.notification_drain_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. notification_digests — exactly-once ledger for periodic digests.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_digests (
  id                 bigint generated always as identity primary key,
  workspace_id       text not null references public.workspaces(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind in ('stalled_weekly')),
  period_key         text not null,
  content            jsonb,
  sent_at            timestamptz,
  attempts           integer not null default 0,
  last_error         text,
  last_attempt_at    timestamptz,
  resend_message_id  text,
  skipped_reason     text,
  created_at         timestamptz not null default now()
);

create unique index if not exists notification_digests_period_key
  on public.notification_digests(workspace_id, recipient_id, kind, period_key);

create index if not exists notification_digests_unsent_idx
  on public.notification_digests(created_at)
  where sent_at is null;

alter table public.notification_digests enable row level security;
revoke all on public.notification_digests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Outbox events for signatures and seat reassignment.
-- ---------------------------------------------------------------------------
create or replace function public.log_sop_signature_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_sop_event(
    new.sop_id,
    'signature_added',
    jsonb_build_object(
      'signature_id', new.id,
      'meaning', new.meaning,
      'signer_id', new.signer_id,
      'seat_department_id', new.seat_department_id,
      'review_cycle', new.review_cycle,
      'rejected_reason', new.rejected_reason,
      'resolves_signature_id', new.resolves_signature_id
    )
  );
  return new;
end;
$$;

drop trigger if exists log_sop_signature_event on public.sop_signatures;
create trigger log_sop_signature_event
after insert on public.sop_signatures
for each row execute function public.log_sop_signature_event();

create or replace function public.log_sop_seat_reassignment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signer_id is distinct from old.signer_id then
    perform public.append_sop_event(
      new.sop_id,
      'seat_reassigned',
      jsonb_build_object(
        'department_id', new.department_id,
        'from_signer_id', old.signer_id,
        'to_signer_id', new.signer_id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_sop_seat_reassignment_event on public.sop_review_seats;
create trigger log_sop_seat_reassignment_event
after update of signer_id on public.sop_review_seats
for each row execute function public.log_sop_seat_reassignment_event();
