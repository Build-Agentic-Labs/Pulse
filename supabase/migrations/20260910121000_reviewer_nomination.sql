-- Author-nominated reviewers, 2/3: the RPCs and the grant sync trigger.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
--
-- RLS statement: a department member may create a reviewer-level membership or invite for their
-- own department only; the Quality-gate department and every other role remain owner/admin-only.

create or replace function public.nominate_department_reviewer(
  p_department_id text,
  p_email text,
  p_position_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_title text := btrim(coalesce(p_position_title, ''));
  v_department public.departments%rowtype;
  v_user_id uuid;
  v_is_member boolean;
  v_current_role public.department_sop_role;
  v_entry jsonb;
  v_grant public.workspace_access_grants%rowtype;
begin
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_department from public.departments where id = p_department_id;
  if v_department.id is null then
    raise exception 'That department does not exist.';
  end if;

  if not public.is_department_member(v_department.id, v_caller)
     and not public.has_workspace_role(v_department.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'You can only invite reviewers into your own department.';
  end if;

  if v_department.is_quality_gate then
    raise exception 'Quality approvers are managed by an admin.';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Enter a work email address.';
  end if;

  if not exists (
    select 1 from public.workspace_auto_join_domains rule
    where rule.workspace_id = v_department.workspace_id
      and rule.domain = split_part(v_email, '@', 2)
  ) then
    raise exception 'That email domain is not approved for this organization.';
  end if;

  if v_title = '' then
    raise exception 'Enter the position title.';
  end if;

  if exists (
    select 1 from public.workspace_revocations r
    where r.workspace_id = v_department.workspace_id and r.email = v_email
  ) then
    raise exception 'That address was removed by an admin. Ask an admin to re-invite them.';
  end if;

  select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = v_email limit 1;

  v_is_member := v_user_id is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = v_department.workspace_id and m.user_id = v_user_id
  );

  if v_is_member then
    select dept_role into v_current_role
      from public.department_members
     where department_id = v_department.id and user_id = v_user_id;

    if v_current_role is null then
      insert into public.department_members (department_id, user_id, dept_role, position_title, granted_by)
      values (v_department.id, v_user_id, 'reviewer', v_title, v_caller);
      return jsonb_build_object('mode', 'added', 'user_id', v_user_id);
    elsif v_current_role = 'author' then
      update public.department_members
         set dept_role = 'reviewer', granted_by = v_caller
       where department_id = v_department.id and user_id = v_user_id;
      return jsonb_build_object('mode', 'lifted', 'user_id', v_user_id);
    else
      return jsonb_build_object('mode', 'already_eligible', 'user_id', v_user_id);
    end if;
  end if;

  -- Not a member: write (or merge into) the grant. The package is fixed; nothing here comes from
  -- the caller except the department (already authorized) and the position title.
  v_entry := jsonb_build_object('department_id', v_department.id, 'role', 'reviewer', 'position_title', v_title);

  select * into v_grant
    from public.workspace_access_grants g
   where g.workspace_id = v_department.workspace_id and g.email = v_email
   for update;

  if v_grant.workspace_id is null then
    insert into public.workspace_access_grants
      (workspace_id, email, role, quality_access, access_package, planning_access, project_access,
       department_access, granted_by, expires_at, redeemed_by, redeemed_at)
    values
      (v_department.workspace_id, v_email, 'editor', 'edit', 'custom', false, '[]'::jsonb,
       jsonb_build_array(v_entry), v_caller, now() + interval '30 days', null, null);
  else
    -- Merge: replace only this department's entry; every other field stays as the admin set it.
    update public.workspace_access_grants
       set department_access = (
             select coalesce(jsonb_agg(entry), '[]'::jsonb)
               from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
              where entry->>'department_id' <> v_department.id
           ) || jsonb_build_array(v_entry),
           expires_at = now() + interval '30 days',
           redeemed_by = null,
           redeemed_at = null
     where workspace_id = v_department.workspace_id and email = v_email;
  end if;

  if v_user_id is not null then
    insert into public.department_members as dm
      (department_id, user_id, dept_role, position_title, granted_by, pending_invite_at)
    values (v_department.id, v_user_id, 'reviewer', v_title, v_caller, now())
    on conflict (department_id, user_id) do update
      set position_title = excluded.position_title,
          granted_by = excluded.granted_by,
          pending_invite_at = now()
      where dm.pending_invite_at is not null;
  end if;

  return jsonb_build_object('mode', 'invite', 'user_id', v_user_id);
end;
$$;

create or replace function public.mint_pending_department_reviewer(p_department_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_department public.departments%rowtype;
  v_email text;
  v_grant public.workspace_access_grants%rowtype;
  v_title text;
begin
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_department from public.departments where id = p_department_id;
  if v_department.id is null then
    raise exception 'That department does not exist.';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'That user does not exist.';
  end if;

  -- The row can only be minted against an unexpired, unredeemed grant the CALLER wrote — the
  -- enforcement stays in the database even though the route holds the service-role key.
  select * into v_grant
    from public.workspace_access_grants g
   where g.workspace_id = v_department.workspace_id
     and g.email = v_email
     and g.redeemed_at is null
     and g.expires_at > now()
     and g.granted_by = v_caller;
  if v_grant.workspace_id is null then
    raise exception 'No matching invitation from you for that person.';
  end if;

  select entry->>'position_title' into v_title
    from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
   where entry->>'department_id' = v_department.id and entry->>'role' = 'reviewer';
  if v_title is null then
    raise exception 'That invitation does not name this department.';
  end if;

  insert into public.department_members as dm
    (department_id, user_id, dept_role, position_title, granted_by, pending_invite_at)
  values (v_department.id, p_user_id, 'reviewer', v_title, v_caller, now())
  on conflict (department_id, user_id) do update
    set position_title = excluded.position_title,
        granted_by = excluded.granted_by,
        pending_invite_at = now()
    where dm.pending_invite_at is not null;
end;
$$;

revoke execute on function public.nominate_department_reviewer(text, text, text) from anon, public;
revoke execute on function public.mint_pending_department_reviewer(text, uuid) from anon, public;
grant execute on function public.nominate_department_reviewer(text, text, text) to authenticated;
grant execute on function public.mint_pending_department_reviewer(text, uuid) to authenticated;

-- Deleting a pending invitation deletes the provisional rows it minted (seats are never touched).
-- An admin resend refreshes expires_at; mirror it onto the marker so the roster's derived expiry
-- stays aligned without a cross-table read.
create or replace function public.sync_pending_department_reviewers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = old.email limit 1;
    if v_user_id is not null then
      delete from public.department_members dm
       using public.departments d
       where dm.department_id = d.id
         and d.workspace_id = old.workspace_id
         and dm.user_id = v_user_id
         and dm.pending_invite_at is not null;
    end if;
    return old;
  end if;

  if new.expires_at is distinct from old.expires_at and new.redeemed_at is null then
    select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = new.email limit 1;
    if v_user_id is not null then
      update public.department_members dm
         set pending_invite_at = now()
        from public.departments d
       where dm.department_id = d.id
         and d.workspace_id = new.workspace_id
         and dm.user_id = v_user_id
         and dm.pending_invite_at is not null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_access_grants_sync_pending_reviewers on public.workspace_access_grants;
create trigger workspace_access_grants_sync_pending_reviewers
after delete or update of expires_at on public.workspace_access_grants
for each row execute function public.sync_pending_department_reviewers();
