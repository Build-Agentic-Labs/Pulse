-- Delivery tracking + suppression + transactional-mail ledger (Phase 1 of
-- docs/audits/2026-09-04-notification-systems-audit.md).
--
--   1) email_deliveries — one row per Resend webhook event (delivered, bounced,
--      complained, …), deduped on the webhook's own event id (Svix delivers at
--      least once). What turns "Resend accepted it" into "it arrived".
--   2) email_suppressions — addresses the drain must never mail again: hard
--      bounces and complaints (from the webhook) or a manual entry from the console.
--   3) transactional_emails — the record invitation and password-recovery sends
--      never had. Never stores a code or link; only who, what kind, and whether
--      the provider accepted it.
--
-- All three are service-role only. Additive + idempotent. Apply with:
--   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904122000_email_deliveries.sql

create table if not exists public.email_deliveries (
  id                 bigint generated always as identity primary key,
  webhook_event_id   text not null unique,
  resend_message_id  text,
  event_type         text not null,
  recipient_email    text,
  occurred_at        timestamptz not null,
  payload            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists email_deliveries_message_idx
  on public.email_deliveries(resend_message_id);

alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from anon, authenticated;

create table if not exists public.email_suppressions (
  email              text primary key,
  reason             text not null check (reason in ('hard_bounce', 'complaint', 'manual')),
  source_message_id  text,
  created_at         timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;

create table if not exists public.transactional_emails (
  id                 bigint generated always as identity primary key,
  kind               text not null check (kind in ('invite', 'access_granted', 'password_recovery')),
  recipient_email    text not null,
  recipient_id       uuid,
  workspace_id       text,
  resend_message_id  text,
  status             text not null check (status in ('sent', 'failed')),
  error              text,
  created_at         timestamptz not null default now()
);

create index if not exists transactional_emails_recipient_idx
  on public.transactional_emails(recipient_email, created_at desc);

alter table public.transactional_emails enable row level security;
revoke all on public.transactional_emails from anon, authenticated;
