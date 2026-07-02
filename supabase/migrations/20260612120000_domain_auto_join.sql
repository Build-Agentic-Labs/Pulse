-- Domain auto-join: anyone signing in with a confirmed email on an approved domain
-- automatically becomes a member of the mapped workspace (default role 'viewer', no
-- project access — managers grant per-project levels from Settings -> Members). This
-- closes the "orphan account" gap where a user could self-register and exist in
-- auth.users while being invisible in organization settings.
--
-- Also blocks sign-ups from non-approved domains at the database level (the client
-- forms validate first for a friendly message; this trigger is the enforcement).

create table if not exists workspace_auto_join_domains (
  domain text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  role workspace_role not null default 'viewer',
  created_at timestamptz not null default now(),
  constraint workspace_auto_join_domains_normalized check (domain = lower(btrim(domain)))
);

alter table workspace_auto_join_domains enable row level security;

drop policy if exists "auto_join_domains manager read" on workspace_auto_join_domains;
drop policy if exists "auto_join_domains manager insert" on workspace_auto_join_domains;
drop policy if exists "auto_join_domains manager update" on workspace_auto_join_domains;
drop policy if exists "auto_join_domains manager delete" on workspace_auto_join_domains;

create policy "auto_join_domains manager read" on workspace_auto_join_domains
for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

create policy "auto_join_domains manager insert" on workspace_auto_join_domains
for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

create policy "auto_join_domains manager update" on workspace_auto_join_domains
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

create policy "auto_join_domains manager delete" on workspace_auto_join_domains
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

-- Seeding is environment-specific and lives outside migration history (audit #5):
-- run scripts/seed-workspace-defaults.mjs to register the auto-join domain rule.

-- Extend the redeem RPC (already called on every app load) with the auto-join step.
-- Body mirrors the live definition (including the modules copy from
-- 20260601121000 and search_path = '' from 20260601129000) and adds:
--   * a confirmed-email requirement (auth.users.email_confirmed_at) before any
--     membership is created, and
--   * domain auto-join after explicit grants are redeemed, so a grant's role wins
--     over the domain default when both exist.
create or replace function public.redeem_workspace_access_grants()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  current_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
  current_domain text;
  grant_count integer := 0;
  auto_join_count integer := 0;
begin
  if auth.uid() is null or current_email = '' or position('@' in current_email) = 0 then
    return 0;
  end if;

  -- Memberships are only minted for accounts whose email address is confirmed
  -- (OAuth providers confirm implicitly; password sign-ups confirm via email).
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    return 0;
  end if;

  current_domain := split_part(current_email, '@', 2);

  -- Explicit invites first: grant role/modules take precedence over domain defaults.
  insert into public.workspace_members (workspace_id, user_id, role, modules)
  select grant_row.workspace_id, auth.uid(), grant_row.role, grant_row.modules
  from public.workspace_access_grants grant_row
  where grant_row.email = current_email
    and not exists (
      select 1
      from public.workspace_members member_row
      where member_row.workspace_id = grant_row.workspace_id
        and member_row.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics grant_count = row_count;

  update public.workspace_access_grants
  set redeemed_by = coalesce(redeemed_by, auth.uid()),
      redeemed_at = coalesce(redeemed_at, now())
  where email = current_email;

  -- Domain auto-join: confirmed users on an approved domain become members of the
  -- mapped workspace with the configured role and no project access.
  insert into public.workspace_members (workspace_id, user_id, role)
  select rule.workspace_id, auth.uid(), rule.role
  from public.workspace_auto_join_domains rule
  where rule.domain = current_domain
    and not exists (
      select 1
      from public.workspace_members member_row
      where member_row.workspace_id = rule.workspace_id
        and member_row.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics auto_join_count = row_count;

  return grant_count + auto_join_count;
end;
$$;

-- Block account creation for emails outside the approved domains. Mirrors the
-- established on_auth_user_created_buildlogic_profile trigger pattern on auth.users.
create or replace function public.enforce_signup_domain()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  signup_domain text := split_part(lower(btrim(coalesce(new.email, ''))), '@', 2);
begin
  -- Accounts without an email (e.g. phone or anonymous auth) are out of scope.
  if coalesce(new.email, '') = '' then
    return new;
  end if;

  if not exists (
    select 1 from public.workspace_auto_join_domains rule
    where rule.domain = signup_domain
  ) then
    raise exception 'Sign-ups are restricted to approved work email domains.';
  end if;

  return new;
end;
$$;

drop trigger if exists before_auth_user_created_domain_check on auth.users;
create trigger before_auth_user_created_domain_check
before insert on auth.users
for each row execute function public.enforce_signup_domain();
