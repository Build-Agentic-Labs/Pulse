-- Membership rows are the authority for organization roles. Resource grants and
-- historical review seats cannot outlive organization membership.
-- No existing memberships, grants, review history, or business data are changed.

CREATE OR REPLACE FUNCTION public.has_workspace_role(target_workspace_id text, allowed_roles workspace_role[])
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = auth.uid()
        and wm.role = any(allowed_roles)
    );
$function$;

CREATE OR REPLACE FUNCTION public.has_project_access(target_project_id text, min_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    target_project_id is not null
    and (
      public.has_workspace_role(
        public.project_workspace_id(target_project_id),
        array['owner', 'admin']::public.workspace_role[]
      )
      or exists (
        select 1
        from public.project_access pa
        join public.projects p on p.id = pa.project_id
        join public.workspace_members wm
          on wm.workspace_id = p.workspace_id and wm.user_id = pa.user_id
        where pa.project_id = target_project_id
          and pa.user_id = auth.uid()
          and pa.level >= min_level
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.holds_sop_seat(p_sop text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.sop_review_seats s
    join public.sops doc on doc.id = s.sop_id
    join public.workspace_members wm
      on wm.workspace_id = doc.workspace_id and wm.user_id = s.signer_id
    where s.sop_id = p_sop and s.signer_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_department_member(dept_id text, p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select dept_id is not null and p_user is not null and exists (
    select 1 from public.department_members m
    join public.departments d on d.id = m.department_id
    join public.workspace_members wm on wm.workspace_id = d.workspace_id and wm.user_id = m.user_id
    where m.department_id = dept_id and m.user_id = p_user);
$function$;

CREATE OR REPLACE FUNCTION public.is_quality_approver(p_workspace text, p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.department_members m
    join public.departments q on q.id = m.department_id
    join public.workspace_members wm on wm.workspace_id = q.workspace_id and wm.user_id = m.user_id
    where m.user_id = p_user and m.dept_role = 'approver'
      and q.is_quality_gate and q.workspace_id = p_workspace);
$function$;

CREATE OR REPLACE FUNCTION public.has_department_role(dept_id text, roles department_sop_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with d as (select workspace_id from public.departments where id = dept_id)
  select dept_id is not null
  and public.has_workspace_role(
    (select workspace_id from d),
    array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
  ) and (
    exists (
      select 1 from public.department_members m
      where m.department_id = dept_id
        and m.user_id = auth.uid()
        and m.dept_role = any(roles)
    )
    or (
      'approver' = any(roles) and exists (
        select 1
        from public.department_members m
        join public.departments q on q.id = m.department_id
        where m.user_id = auth.uid()
          and m.dept_role = 'approver'
          and q.is_quality_gate
          and q.workspace_id = (select workspace_id from d)
      )
    )
    or public.has_workspace_role(
      (select workspace_id from d),
      array['owner', 'admin']::public.workspace_role[]
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(target_workspace_id text, target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if target_role in ('owner', 'admin') then
    if not public.has_workspace_role(target_workspace_id, array['owner']::public.workspace_role[]) then
      raise exception 'Only an owner can remove an owner or admin.';
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
$function$;

-- Offboarding must go through the RPC so revocations and every grant are removed
-- atomically. A direct membership DELETE would let domain auto-join revive access.
drop policy if exists "workspace_members owner delete" on public.workspace_members;
create policy "workspace_members owner delete" on public.workspace_members
for delete to authenticated using (false);

-- A project view grant must not become metadata-write permission just because
-- the member's organization role is the legacy "editor" role.
drop policy if exists "projects editor update" on public.projects;
create policy "projects editor update" on public.projects
for update to authenticated
using (public.has_project_access(id, 'edit'::public.access_level))
with check (public.has_project_access(id, 'edit'::public.access_level));

-- Tenant/identity columns cannot be moved to route around grants or the last-owner guard.
create or replace function public.protect_access_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'workspace_members' then
    if new.workspace_id is distinct from old.workspace_id or new.user_id is distinct from old.user_id then
      raise exception 'Membership identity cannot be changed; remove and add the membership instead.';
    end if;
  elsif new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id then
    raise exception 'Project identity and organization cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_protect_identity on public.workspace_members;
create trigger workspace_members_protect_identity
before update on public.workspace_members
for each row execute function public.protect_access_identity();
drop trigger if exists projects_protect_identity on public.projects;
create trigger projects_protect_identity
before update on public.projects
for each row execute function public.protect_access_identity();

-- Serialize owner changes across different membership rows in the same organization.

CREATE OR REPLACE FUNCTION public.protect_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id) then
    perform 1 from public.workspaces where id = old.workspace_id for update;
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
$function$;

-- An admin cannot use an invitation to rewrite an existing manager's access.
-- Check the target membership, not just the role proposed on the invitation.
create or replace function public.protect_manager_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace text := case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end;
  target_email text := case when tg_op = 'DELETE' then old.email else new.email end;
begin
  if auth.uid() is not null
     and not public.has_workspace_role(target_workspace, array['owner']::public.workspace_role[])
     and (
       exists (
         select 1 from public.workspace_members m
         join auth.users u on u.id = m.user_id
         where m.workspace_id = target_workspace
           and lower(btrim(u.email)) = target_email
           and m.role in ('owner', 'admin')
       )
       or (tg_op <> 'INSERT' and old.role in ('owner', 'admin'))
     ) then
    raise exception 'Only an owner can manage invitations for an owner or admin.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists workspace_access_grants_protect_managers on public.workspace_access_grants;
create trigger workspace_access_grants_protect_managers
before insert or update of workspace_id, email, role, quality_access, planning_access, project_access, department_access, modules, expires_at, granted_by or delete on public.workspace_access_grants
for each row execute function public.protect_manager_invitation();

CREATE OR REPLACE FUNCTION public.redeem_workspace_access_grants()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    for update of grant_candidate
  loop
    insert into public.workspace_members (workspace_id, user_id, role, modules)
    values (grant_row.workspace_id, auth.uid(), grant_row.role, grant_row.modules)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role,
          modules = excluded.modules
      where public.workspace_members.role not in ('owner', 'admin');

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
$function$;
