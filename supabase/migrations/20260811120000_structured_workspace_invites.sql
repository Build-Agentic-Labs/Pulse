-- A pending invitation now carries one reviewed entitlement snapshot. Redemption
-- applies that snapshot to the existing authorization tables in the same transaction:
-- workspace membership, Quality, Planning, projects, and department SOP duties.

alter table public.workspace_access_grants
  add column if not exists access_package text not null default 'custom',
  add column if not exists planning_access boolean not null default false,
  add column if not exists project_access jsonb not null default '[]'::jsonb,
  add column if not exists department_access jsonb not null default '[]'::jsonb;

alter table public.workspace_access_grants
  drop constraint if exists workspace_access_grants_access_package_known,
  add constraint workspace_access_grants_access_package_known check (
    access_package in ('custom', 'industrial_engineer', 'quality_reviewer', 'planner', 'production_operator')
  ),
  drop constraint if exists workspace_access_grants_project_access_array,
  add constraint workspace_access_grants_project_access_array check (jsonb_typeof(project_access) = 'array'),
  drop constraint if exists workspace_access_grants_department_access_array,
  add constraint workspace_access_grants_department_access_array check (jsonb_typeof(department_access) = 'array');

-- Quality access was historically keyed only by user_id, so access granted in one
-- organization leaked into every organization that user joined. Scope it the same
-- way as Planning and SOP data. Existing access is copied to each current membership
-- so this migration preserves today's effective permissions.
alter table public.org_tool_access
  add column if not exists workspace_id text references public.workspaces(id) on delete cascade;

-- This is a shape-preserving backfill, not a user access change. Keep the access
-- audit free of four synthetic update events while the legacy rows are re-keyed.
alter table public.org_tool_access disable trigger org_tool_access_audit;

update public.org_tool_access access_row
set workspace_id = membership.workspace_id
from (
  select user_id, min(workspace_id) as workspace_id
  from public.workspace_members
  group by user_id
) membership
where access_row.workspace_id is null
  and membership.user_id = access_row.user_id;

alter table public.org_tool_access
  drop constraint if exists org_tool_access_pkey;

insert into public.org_tool_access (workspace_id, user_id, level, granted_by, created_at, updated_at)
select
  membership.workspace_id,
  access_row.user_id,
  access_row.level,
  access_row.granted_by,
  access_row.created_at,
  access_row.updated_at
from public.org_tool_access access_row
join public.workspace_members membership on membership.user_id = access_row.user_id
where access_row.workspace_id is not null
  and not exists (
    select 1
    from public.org_tool_access existing
    where existing.workspace_id = membership.workspace_id
      and existing.user_id = access_row.user_id
  );

do $$
begin
  if exists (select 1 from public.org_tool_access where workspace_id is null) then
    raise exception 'Cannot scope Quality access: a user has no organization membership.';
  end if;
end;
$$;

alter table public.org_tool_access
  alter column workspace_id set not null,
  add constraint org_tool_access_pkey primary key (workspace_id, user_id);

alter table public.org_tool_access enable trigger org_tool_access_audit;

drop policy if exists "org_tool_access self or manager read" on public.org_tool_access;
create policy "org_tool_access self or manager read" on public.org_tool_access
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "org_tool_access manager write" on public.org_tool_access;
create policy "org_tool_access manager write" on public.org_tool_access
for all to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create or replace function public.has_org_tool_access(target_workspace_id text, min_level public.access_level)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_workspace_id is not null
    and (
      public.has_workspace_role(target_workspace_id, array['owner', 'admin']::public.workspace_role[])
      or (
        public.has_workspace_role(
          target_workspace_id,
          array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
        )
        and exists (
          select 1
          from public.org_tool_access access_row
          where access_row.workspace_id = target_workspace_id
            and access_row.user_id = auth.uid()
            and access_row.level >= min_level
        )
      )
    );
$$;

-- Admin is now an organization-level elevation, not a synonym for edit access.
-- Owners may create or change managers; admins can invite and manage Members only.
drop policy if exists "workspace_access_grants admin insert" on public.workspace_access_grants;
create policy "workspace_access_grants admin insert" on public.workspace_access_grants
for insert to authenticated
with check (
  email = lower(btrim(email))
  and role <> 'owner'::public.workspace_role
  and (
    role <> 'admin'::public.workspace_role
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  )
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "workspace_access_grants admin update" on public.workspace_access_grants;
create policy "workspace_access_grants admin update" on public.workspace_access_grants
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (
  email = lower(btrim(email))
  and role <> 'owner'::public.workspace_role
  and (
    role <> 'admin'::public.workspace_role
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  )
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "workspace_members admin insert" on public.workspace_members;
create policy "workspace_members admin insert" on public.workspace_members
for insert to authenticated
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (
    role not in ('owner'::public.workspace_role, 'admin'::public.workspace_role)
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  )
);

drop policy if exists "workspace_members admin update" on public.workspace_members;
create policy "workspace_members admin update" on public.workspace_members
for update to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (
    role not in ('owner'::public.workspace_role, 'admin'::public.workspace_role)
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  )
)
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (
    role not in ('owner'::public.workspace_role, 'admin'::public.workspace_role)
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  )
);

-- Offboarding now removes every organization-scoped entitlement. Without this,
-- a later re-invite could reactivate stale Planning, Quality, or SOP duties.
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

  select member_row.role into target_role
  from public.workspace_members member_row
  where member_row.workspace_id = target_workspace_id
    and member_row.user_id = target_user_id;

  if target_role is null then
    raise exception 'That user is not a member of this organization.';
  end if;

  if target_role = 'owner' then
    if not public.has_workspace_role(target_workspace_id, array['owner']::public.workspace_role[]) then
      raise exception 'Only an owner can remove another owner.';
    end if;
  elsif not public.has_workspace_role(
    target_workspace_id,
    array['owner', 'admin']::public.workspace_role[]
  ) then
    raise exception 'Only owners and admins can remove members.';
  end if;

  select lower(btrim(coalesce(auth_user.email, ''))) into target_email
  from auth.users auth_user
  where auth_user.id = target_user_id;

  delete from public.workspace_members
  where workspace_id = target_workspace_id
    and user_id = target_user_id;

  delete from public.project_access project_grant
  using public.projects project_row
  where project_grant.project_id = project_row.id
    and project_row.workspace_id = target_workspace_id
    and project_grant.user_id = target_user_id;

  delete from public.space_access
  where workspace_id = target_workspace_id
    and user_id = target_user_id;

  delete from public.org_tool_access
  where workspace_id = target_workspace_id
    and user_id = target_user_id;

  delete from public.department_members department_grant
  using public.departments department_row
  where department_grant.department_id = department_row.id
    and department_row.workspace_id = target_workspace_id
    and department_grant.user_id = target_user_id;

  if target_email is not null and target_email <> '' then
    delete from public.workspace_access_grants
    where workspace_id = target_workspace_id
      and email = target_email;

    insert into public.workspace_revocations (workspace_id, email, revoked_by)
    values (target_workspace_id, target_email, auth.uid())
    on conflict (workspace_id, email) do update
      set revoked_by = excluded.revoked_by,
          created_at = now();
  end if;
end;
$$;

create or replace function public.redeem_workspace_access_grants()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  current_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
  current_domain text;
  grant_row public.workspace_access_grants%rowtype;
  inserted_count integer := 0;
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

  for grant_row in
    select grant_candidate.*
    from public.workspace_access_grants grant_candidate
    where grant_candidate.email = current_email
      and grant_candidate.expires_at > now()
      and grant_candidate.redeemed_at is null
      and not exists (
        select 1
        from public.workspace_revocations revocation
        where revocation.workspace_id = grant_candidate.workspace_id
          and revocation.email = current_email
      )
    order by grant_candidate.created_at
  loop
    insert into public.workspace_members (workspace_id, user_id, role, modules)
    values (grant_row.workspace_id, auth.uid(), grant_row.role, grant_row.modules)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role,
          modules = excluded.modules;

    get diagnostics inserted_count = row_count;
    grant_count := grant_count + inserted_count;

    if grant_row.quality_access = 'none'::public.access_level then
      delete from public.org_tool_access
      where workspace_id = grant_row.workspace_id
        and user_id = auth.uid();
    else
      insert into public.org_tool_access (workspace_id, user_id, level, granted_by)
      values (grant_row.workspace_id, auth.uid(), grant_row.quality_access, grant_row.granted_by)
      on conflict (workspace_id, user_id) do update
        set level = excluded.level,
            granted_by = excluded.granted_by,
            updated_at = now();
    end if;

    if grant_row.planning_access then
      insert into public.space_access (workspace_id, user_id, space, granted_by)
      values (grant_row.workspace_id, auth.uid(), 'planning', grant_row.granted_by)
      on conflict (workspace_id, user_id, space) do update
        set granted_by = excluded.granted_by;
    else
      delete from public.space_access
      where workspace_id = grant_row.workspace_id
        and user_id = auth.uid()
        and space = 'planning';
    end if;

    delete from public.project_access project_grant
    using public.projects project_row
    where project_grant.project_id = project_row.id
      and project_row.workspace_id = grant_row.workspace_id
      and project_grant.user_id = auth.uid();

    insert into public.project_access (project_id, user_id, level, granted_by)
    select
      project_row.id,
      auth.uid(),
      case access_row.level
        when 'edit' then 'edit'::public.access_level
        else 'view'::public.access_level
      end,
      grant_row.granted_by
    from jsonb_to_recordset(grant_row.project_access) as access_row(project_id text, level text)
    join public.projects project_row
      on project_row.id = access_row.project_id
     and project_row.workspace_id = grant_row.workspace_id
    where access_row.level in ('view', 'edit')
    on conflict (project_id, user_id) do update
      set level = excluded.level,
          granted_by = excluded.granted_by,
          updated_at = now();

    delete from public.department_members department_grant
    using public.departments department_row
    where department_grant.department_id = department_row.id
      and department_row.workspace_id = grant_row.workspace_id
      and department_grant.user_id = auth.uid();

    insert into public.department_members (department_id, user_id, dept_role, position_title, granted_by)
    select
      department_row.id,
      auth.uid(),
      case access_row.role
        when 'approver' then 'approver'::public.department_sop_role
        when 'reviewer' then 'reviewer'::public.department_sop_role
        else 'author'::public.department_sop_role
      end,
      coalesce(access_row.position_title, ''),
      grant_row.granted_by
    from jsonb_to_recordset(grant_row.department_access)
      as access_row(department_id text, role text, position_title text)
    join public.departments department_row
      on department_row.id = access_row.department_id
     and department_row.workspace_id = grant_row.workspace_id
    where access_row.role in ('author', 'reviewer', 'approver')
    on conflict (department_id, user_id) do update
      set dept_role = excluded.dept_role,
          position_title = excluded.position_title,
          granted_by = excluded.granted_by,
          updated_at = now();

    update public.workspace_access_grants
    set redeemed_by = auth.uid(),
        redeemed_at = now()
    where workspace_id = grant_row.workspace_id
      and email = current_email;
  end loop;

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
