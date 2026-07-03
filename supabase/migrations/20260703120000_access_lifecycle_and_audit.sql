-- Access lifecycle & audit hardening (Sprint 1-2 of the access-model gap plan,
-- docs/access-model-gap-analysis.md).
--
--   1. audit_log — immutable trail of every membership / grant / access-level change,
--      written by triggers so direct PostgREST writes are captured too (gap #8).
--   2. workspace_access_grants.expires_at — invites expire after 30 days; expired
--      grants no longer mint memberships (gap #11).
--   3. workspace_revocations — a removed user STAYS removed: revoked emails are
--      skipped by both the explicit-grant and domain-auto-join paths of
--      redeem_workspace_access_grants, closing the silent re-join hole (gap #3).
--   4. remove_workspace_member() — the offboarding RPC the Members UI calls: deletes
--      the membership, per-project grants, pending invites, and records a revocation
--      in one transaction (gap #2).
--   5. profiles.email — managers see member emails in the roster; kept in sync with
--      auth.users on signup and email change (gap #16).
--   6. Last-owner protection — a workspace can never lose its final owner through a
--      role change or member removal.
--   7. Domain gating single-sourced — the hardcoded '%@anacorp.com' CHECK constraints
--      on workspace_access_grants and platform_admins are replaced with a trigger that
--      validates against workspace_auto_join_domains. Anacorp-only access stays fully
--      enforced; the approved domain now lives in exactly one table (gap #10).
--      NOTE for fresh environments: seed the workspace_auto_join_domains rule BEFORE
--      seeding platform_admins / grants (scripts/seed-workspace-defaults.mjs already
--      runs in that order).

-- ---------------------------------------------------------------------------
-- 5. profiles.email (do this first: later objects reference it in comments only,
--    but the backfill is independent of everything else).
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists email text;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    lower(btrim(coalesce(new.email, '')))
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- Keep profiles.email in sync when an account's email changes (the domain re-check on
-- email change lives in 20260701124000 and runs before this).
create or replace function public.handle_auth_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.profiles
  set email = lower(btrim(coalesce(new.email, '')))
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_sync_profile on auth.users;
create trigger on_auth_user_email_sync_profile
after update of email on auth.users
for each row execute function public.handle_auth_user_email_sync();

update public.profiles p
set email = lower(btrim(u.email))
from auth.users u
where u.id = p.id
  and p.email is distinct from lower(btrim(u.email));

-- profiles.email is a mirror of auth.users.email, not user data: silently ignore
-- client attempts to change it (the "profiles own update" policy is column-blind).
-- The signup/email-change sync triggers run as the function owner and pass through.
create or replace function public.protect_profile_email()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.email is distinct from old.email and current_user in ('authenticated', 'anon') then
    new.email := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_email on profiles;
create trigger profiles_protect_email
before update on profiles
for each row execute function public.protect_profile_email();

-- ---------------------------------------------------------------------------
-- 1. audit_log. Rows are written ONLY by the security definer trigger function
--    below (the table owner bypasses RLS); clients get read-only manager access
--    and no insert/update/delete policies exist, so the log is immutable to them.
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  workspace_id text,
  actor_id uuid,
  actor_email text,
  action text not null,       -- '<table>.<insert|update|delete>'
  target_type text not null,  -- source table name
  target_id text,             -- affected user id or email when the row has one
  details jsonb,              -- old/new row snapshots
  created_at timestamptz not null default now()
);

create index if not exists audit_log_workspace_created_idx on audit_log (workspace_id, created_at desc);

alter table audit_log enable row level security;

drop policy if exists "audit_log manager read" on audit_log;
create policy "audit_log manager read" on audit_log
for select to authenticated
using (
  case
    when workspace_id is not null then
      public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
    else
      -- Org-wide entries (org_tool_access, platform_admins) mirror the
      -- org_tool_access management gate: superadmin or any workspace manager.
      public.is_super_admin()
      or exists (
        select 1 from public.workspace_members wm
        where wm.user_id = auth.uid() and wm.role in ('owner', 'admin')
      )
  end
);

create or replace function public.audit_access_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  row_data jsonb := coalesce(new_row, old_row);
  ws_id text := row_data->>'workspace_id';
begin
  if ws_id is null and row_data ? 'project_id' then
    ws_id := public.project_workspace_id(row_data->>'project_id');
  end if;

  insert into public.audit_log (workspace_id, actor_id, actor_email, action, target_type, target_id, details)
  values (
    ws_id,
    auth.uid(),
    nullif(lower(btrim(coalesce(auth.jwt()->>'email', ''))), ''),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(row_data->>'user_id', row_data->>'email'),
    jsonb_strip_nulls(jsonb_build_object('old', old_row, 'new', new_row))
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_members',
    'workspace_access_grants',
    'project_access',
    'org_tool_access',
    'workspace_auto_join_domains',
    'platform_admins'
  ]
  loop
    execute format('drop trigger if exists %I on %I', table_name || '_audit', table_name);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function public.audit_access_change()',
      table_name || '_audit',
      table_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Invite expiry. Existing (and legacy already-redeemed) grants get a 30-day
--    window from now; redemption below only honors unexpired grants. "Resend"
--    in the Members UI re-upserts the grant, which refreshes expires_at.
-- ---------------------------------------------------------------------------
alter table workspace_access_grants
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days');

-- ---------------------------------------------------------------------------
-- 3. Revocations. One row per (workspace, email) that managers have removed.
--    redeem_workspace_access_grants skips revoked emails entirely, so neither a
--    stale grant nor domain auto-join can silently re-mint the membership.
--    Re-inviting from the Members UI deletes the revocation first.
-- ---------------------------------------------------------------------------
create table if not exists workspace_revocations (
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, email),
  constraint workspace_revocations_email_normalized check (email = lower(btrim(email)))
);

alter table workspace_revocations enable row level security;

drop policy if exists "workspace_revocations manager read" on workspace_revocations;
create policy "workspace_revocations manager read" on workspace_revocations
for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

drop policy if exists "workspace_revocations manager insert" on workspace_revocations;
create policy "workspace_revocations manager insert" on workspace_revocations
for insert to authenticated
with check (
  email = lower(btrim(email))
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);

drop policy if exists "workspace_revocations manager delete" on workspace_revocations;
create policy "workspace_revocations manager delete" on workspace_revocations
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

drop trigger if exists workspace_revocations_audit on workspace_revocations;
create trigger workspace_revocations_audit
after insert or update or delete on workspace_revocations
for each row execute function public.audit_access_change();

-- Redeem v4: body mirrors 20260612120000 and adds the expiry check on grants and the
-- revocation guard on both membership-minting paths.
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

  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    return 0;
  end if;

  current_domain := split_part(current_email, '@', 2);

  -- Explicit invites first: grant role/modules take precedence over domain defaults.
  -- Expired or revoked grants no longer mint memberships.
  insert into public.workspace_members (workspace_id, user_id, role, modules)
  select grant_row.workspace_id, auth.uid(), grant_row.role, grant_row.modules
  from public.workspace_access_grants grant_row
  where grant_row.email = current_email
    and grant_row.expires_at > now()
    and not exists (
      select 1
      from public.workspace_revocations revocation
      where revocation.workspace_id = grant_row.workspace_id
        and revocation.email = current_email
    )
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
  where email = current_email
    and redeemed_at is null
    and expires_at > now();

  -- Domain auto-join: confirmed users on an approved domain become members of the
  -- mapped workspace with the configured role and no project access — unless a
  -- manager revoked them from that workspace.
  insert into public.workspace_members (workspace_id, user_id, role)
  select rule.workspace_id, auth.uid(), rule.role
  from public.workspace_auto_join_domains rule
  where rule.domain = current_domain
    and not exists (
      select 1
      from public.workspace_revocations revocation
      where revocation.workspace_id = rule.workspace_id
        and revocation.email = current_email
    )
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

-- ---------------------------------------------------------------------------
-- 6. Last-owner protection. Fires before the offboarding RPC's delete and before
--    any role downgrade, so a workspace can never end up ownerless. Skipped when
--    the parent workspace row is already gone (workspace-delete cascade).
-- ---------------------------------------------------------------------------
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id) then
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id)
      and not exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = old.workspace_id
          and wm.role = 'owner'
          and wm.user_id <> old.user_id
      )
    then
      raise exception 'An organization must keep at least one owner. Promote another owner first.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists workspace_members_protect_last_owner on workspace_members;
create trigger workspace_members_protect_last_owner
before update or delete on workspace_members
for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------------------
-- 4. Offboarding RPC. SECURITY DEFINER with explicit caller checks (mirrors the
--    role-ceiling rules from 20260701122000): admins remove non-owners, only
--    owners remove owners, nobody removes themselves. Cleans up the membership,
--    per-project grants, pending invites, and records the revocation atomically.
-- ---------------------------------------------------------------------------
create or replace function public.remove_workspace_member(target_workspace_id text, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  target_role public.workspace_role;
  target_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'You cannot remove your own membership.';
  end if;

  select wm.role into target_role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;

  if target_role is null then
    raise exception 'That user is not a member of this organization.';
  end if;

  if target_role = 'owner' then
    if not public.has_workspace_role(target_workspace_id, array['owner']::public.workspace_role[]) then
      raise exception 'Only an owner can remove another owner.';
    end if;
  elsif not public.has_workspace_role(target_workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Only owners and admins can remove members.';
  end if;

  select lower(btrim(coalesce(u.email, ''))) into target_email
  from auth.users u
  where u.id = target_user_id;

  -- protect_last_owner (above) blocks this delete if it would orphan the workspace.
  delete from public.workspace_members
  where workspace_id = target_workspace_id and user_id = target_user_id;

  delete from public.project_access pa
  using public.projects p
  where pa.project_id = p.id
    and p.workspace_id = target_workspace_id
    and pa.user_id = target_user_id;

  -- Org tools access is org-wide: drop it only when no memberships remain anywhere.
  if not exists (
    select 1 from public.workspace_members wm where wm.user_id = target_user_id
  ) then
    delete from public.org_tool_access where user_id = target_user_id;
  end if;

  if target_email is not null and target_email <> '' then
    delete from public.workspace_access_grants
    where workspace_id = target_workspace_id and email = target_email;

    insert into public.workspace_revocations (workspace_id, email, revoked_by)
    values (target_workspace_id, target_email, auth.uid())
    on conflict (workspace_id, email) do update
      set revoked_by = excluded.revoked_by,
          created_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Single-source the approved-domain gate. workspace_auto_join_domains is already
--    the source of truth for signups (enforce_signup_domain) and email changes
--    (20260701124000); grants and platform admins now validate against the same
--    table instead of a hardcoded company constraint.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_approved_email_domain()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  email_domain text := split_part(lower(btrim(coalesce(new.email, ''))), '@', 2);
begin
  if email_domain = '' or not exists (
    select 1 from public.workspace_auto_join_domains rule
    where rule.domain = email_domain
  ) then
    raise exception 'Only approved work email domains can be granted access.';
  end if;

  return new;
end;
$$;

alter table workspace_access_grants drop constraint if exists workspace_access_grants_anacorp_email;
alter table platform_admins drop constraint if exists platform_admins_anacorp_email;

drop trigger if exists workspace_access_grants_domain_check on workspace_access_grants;
create trigger workspace_access_grants_domain_check
before insert or update of email on workspace_access_grants
for each row execute function public.enforce_approved_email_domain();

drop trigger if exists platform_admins_domain_check on platform_admins;
create trigger platform_admins_domain_check
before insert or update of email on platform_admins
for each row execute function public.enforce_approved_email_domain();

-- The grant write policies carried the same hardcoded check; re-create them with the
-- domain validation delegated to the trigger above (normalization stays inline).
drop policy if exists "workspace_access_grants admin insert" on workspace_access_grants;
create policy "workspace_access_grants admin insert" on workspace_access_grants
for insert to authenticated
with check (
  email = lower(btrim(email))
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);

drop policy if exists "workspace_access_grants admin update" on workspace_access_grants;
create policy "workspace_access_grants admin update" on workspace_access_grants
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]))
with check (
  email = lower(btrim(email))
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);
