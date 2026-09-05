-- Channel integrations (Phase 2 of docs/audits/2026-09-04-notification-systems-audit.md).
--
--   1) workspace_integrations — per-workspace channel config, today a Microsoft
--      Teams incoming-webhook URL. Owners/admins manage it (has_workspace_role);
--      the drain reads it with the service role.
--   2) push_subscriptions — Web Push subscriptions, one row per browser endpoint,
--      own rows only. The drain reads them with the service role and prunes
--      endpoints the push service reports gone.
--
-- Additive + idempotent. Apply with:
--   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904123000_workspace_integrations.sql

create table if not exists public.workspace_integrations (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  kind         text not null check (kind in ('teams_webhook')),
  config       jsonb not null default '{}'::jsonb,
  enabled      boolean not null default false,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, kind)
);

alter table public.workspace_integrations enable row level security;

drop policy if exists workspace_integrations_managers on public.workspace_integrations;
create policy workspace_integrations_managers on public.workspace_integrations
for all to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
