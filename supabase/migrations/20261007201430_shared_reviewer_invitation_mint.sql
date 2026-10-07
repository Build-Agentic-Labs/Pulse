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
  v_role_text text;
  v_dept_role public.department_sop_role;
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

  -- Invitations belong to the workspace, and may be reused by multiple SOP authors.
  -- Authorize the caller independently of the original invitation creator.
  if not public.has_workspace_role(v_department.workspace_id, array['owner', 'admin']::public.workspace_role[])
     and not public.is_department_member(v_department.id, v_caller)
     and not exists (
       select 1
         from public.sop_approver_nominations n
         join public.sops s on s.id = n.sop_id
         join public.sop_review_seats st on st.sop_id = s.id and st.department_id = n.department_id
        where n.department_id = v_department.id
          and lower(btrim(n.email)) = v_email
          and s.workspace_id = v_department.workspace_id
          and s.deleted_at is null
          and s.status = 'draft'
          and public.can_edit_sop_content(s.id)
     ) then
    raise exception 'You cannot prepare reviewers for this department.';
  end if;

  if v_department.is_quality_gate then
    raise exception 'Quality approvers are managed by an admin.';
  end if;

  if p_user_id = v_caller then
    raise exception 'You cannot nominate yourself.';
  end if;

  if exists (
    select 1 from public.workspace_revocations r
     where r.workspace_id = v_department.workspace_id and r.email = v_email
  ) then
    raise exception 'That address was removed by an admin. Ask an admin to re-invite them.';
  end if;

  -- An active invitation must still explicitly grant signing access to this department.
  select * into v_grant
    from public.workspace_access_grants g
   where g.workspace_id = v_department.workspace_id
     and g.email = v_email
     and g.redeemed_at is null
     and g.expires_at > now();
  if v_grant.workspace_id is null then
    raise exception 'No matching invitation for that person.';
  end if;

  -- An admin's approver entry for this department is honoured as-is; the provisional row mirrors
  -- whatever signing role the invitation actually carries.
  select entry->>'position_title', entry->>'role'
    into v_title, v_role_text
    from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
   where entry->>'department_id' = v_department.id
     and entry->>'role' in ('reviewer', 'approver')
   limit 1;
  if v_role_text is null then
    raise exception 'That invitation does not name this department.';
  end if;
  v_dept_role := (case when v_role_text = 'approver' then 'approver' else 'reviewer' end)::public.department_sop_role;

  insert into public.department_members as dm
    (department_id, user_id, dept_role, position_title, granted_by, pending_invite_at)
  values (v_department.id, p_user_id, v_dept_role, coalesce(v_title, ''), v_caller, now())
  on conflict (department_id, user_id) do update
    set position_title = excluded.position_title,
        granted_by = excluded.granted_by,
        pending_invite_at = now()
    where dm.pending_invite_at is not null;
end;
$$;

revoke execute on function public.mint_pending_department_reviewer(text, uuid) from anon, public;
grant execute on function public.mint_pending_department_reviewer(text, uuid) to authenticated;
