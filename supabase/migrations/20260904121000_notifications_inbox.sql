-- Notification inbox + preferences (Phase 1 of docs/audits/2026-09-04-notification-systems-audit.md).
--
--   1) notifications — the per-user, channel-independent record of every decision
--      the drain makes, written BEFORE any delivery. Recipients read their own rows;
--      read-state changes go through SECURITY DEFINER RPCs so nobody can edit a
--      title or body. Everything else is service-role only.
--   2) notification_preferences — per user × kind × channel (email/teams/push),
--      immediate or off; workspace_id '' means "every workspace". Own rows only.
--
-- Additive + idempotent. Apply with:
--   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904121000_notifications_inbox.sql

create table if not exists public.notifications (
  id                 bigint generated always as identity primary key,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  workspace_id       text references public.workspaces(id) on delete cascade,
  source             text not null check (source in ('sop', 'workspace', 'digest')),
  source_ledger_id   bigint,
  kind               text not null,
  entity_type        text,
  entity_id          text,
  title              text not null,
  body               text not null default '',
  link               text,
  delivered_channels jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  read_at            timestamptz
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);

create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_id)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
for select to authenticated using (recipient_id = auth.uid());

-- No insert/update/delete policies: writes are the drain's (service role) and the
-- RPCs' below. The revoke is belt-and-braces on the hosted project.
revoke insert, update, delete on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create or replace function public.mark_notifications_read(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = any(p_ids)
     and recipient_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.mark_all_notifications_read(p_workspace text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and (p_workspace is null or workspace_id = p_workspace);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_notifications_read(bigint[]) from anon;
revoke execute on function public.mark_all_notifications_read(text) from anon;

create table if not exists public.notification_preferences (
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id text not null default '',
  kind         text not null,
  channel      text not null check (channel in ('email', 'teams', 'push')),
  mode         text not null check (mode in ('immediate', 'off')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, workspace_id, kind, channel)
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
