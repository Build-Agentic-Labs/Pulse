-- Send ledger for workspace welcome emails. audit_log is the outbox (its
-- trigger already records every workspace_members.insert transactionally);
-- this table records what has been sent, and its unique index is the
-- exactly-once claim. Clone of the sop_notifications pattern — deliberately a
-- separate table so the shipped SOP ledger stays untouched.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260722150000_workspace_notifications_ledger.sql
-- Spec: docs/superpowers/specs/2026-07-22-workspace-welcome-email-design.md

create table public.workspace_notifications (
  id                 bigint generated always as identity primary key,
  workspace_id       text not null references public.workspaces(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind = 'workspace_welcome'),
  event_id           bigint not null references public.audit_log(id) on delete cascade,
  sent_at            timestamptz,
  attempts           integer not null default 0,
  last_error         text,
  resend_message_id  text,
  created_at         timestamptz not null default now()
);

create unique index workspace_notifications_event_recipient_key
  on public.workspace_notifications(event_id, recipient_id);

create index workspace_notifications_unsent_idx
  on public.workspace_notifications(created_at)
  where sent_at is null;

alter table public.workspace_notifications enable row level security;
revoke all on public.workspace_notifications from anon, authenticated;
