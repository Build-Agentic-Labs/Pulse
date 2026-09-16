-- Cross-department reviewer nominations from the SOP roster.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md (addendum 2026-09-16)
--
-- Until now an author could nominate a reviewer only into their OWN department, so a seat for
-- any other department waited on an admin. This widens the rule in one narrow way and changes
-- nothing else about what a nomination grants:
--
-- RLS statement: an author editing a draft SOP may create a reviewer-level membership or invite
-- in any non-Quality department that holds a seat on that SOP; a department member may still do
-- so for their own department; the Quality-gate department and every other role remain
-- owner/admin-only.
--
-- The nominee always lands in the TARGET department (the seat's), never the author's: every write
-- below keys on v_department, which is the p_department_id the seat belongs to. The SOP id is an
-- authorization input, not just audit — it must be a draft the caller can edit
-- (can_edit_sop_content: org-tool edit + owning-department membership) in the same workspace, and
-- the target department must be seated on it.
--
-- nominate_department_reviewer is NOT one of the live-patched functions (no migration reads it
-- via pg_get_functiondef), so a full replace from this file is safe. The signature gains a
-- defaulted fourth argument, which means the old 3-arg overload must be dropped first or the
-- database would keep both.

drop function if exists public.nominate_department_reviewer(text, text, text);

create or replace function public.nominate_department_reviewer(
  p_department_id text,
  p_email text,
  p_position_title text,
  p_sop_id text default null
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
  v_sop_id text := nullif(btrim(coalesce(p_sop_id, '')), '');
  v_authorized boolean := false;
  v_user_id uuid;
  v_is_member boolean;
  v_current_role public.department_sop_role;
  v_entry jsonb;
  v_grant public.workspace_access_grants%rowtype;
  v_keep_approver boolean := false;
  v_dept_access jsonb;
  v_row_role public.department_sop_role := 'reviewer';
begin
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_department from public.departments where id = p_department_id;
  if v_department.id is null then
    raise exception 'That department does not exist.';
  end if;

  -- Authorization, widest to narrowest: owners/admins; members of the target department; and an
  -- author of a draft SOP in this workspace for a department seated on that SOP.
  v_authorized := public.has_workspace_role(v_department.workspace_id, array['owner', 'admin']::public.workspace_role[])
    or public.is_department_member(v_department.id, v_caller);

  if not v_authorized and v_sop_id is not null then
    if exists (
         select 1 from public.sops s
          where s.id = v_sop_id
            and s.workspace_id = v_department.workspace_id
            and s.deleted_at is null
       )
       and public.can_edit_sop_content(v_sop_id) then
      if not exists (
        select 1 from public.sop_review_seats st
         where st.sop_id = v_sop_id and st.department_id = v_department.id
      ) then
        raise exception 'Add % to this SOP''s roster before inviting a reviewer for it.', v_department.name;
      end if;
      v_authorized := true;
    end if;
  end if;

  if not v_authorized then
    raise exception 'You can only invite reviewers into your own department, or for a department seated on a draft SOP you are editing.';
  end if;

  if v_department.is_quality_gate then
    raise exception 'Quality approvers are managed by an admin.';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a work email address.';
  end if;

  -- Two authors nominating the same address into the same department at once would otherwise race
  -- the read-then-merge below. Serialize on (department, normalized email) for the transaction.
  perform pg_advisory_xact_lock(hashtext(p_department_id || ':' || v_email));

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

  if char_length(v_title) > 120 then
    raise exception 'Position title is too long (120 characters max).';
  end if;

  if exists (
    select 1 from public.workspace_revocations r
    where r.workspace_id = v_department.workspace_id and r.email = v_email
  ) then
    raise exception 'That address was removed by an admin. Ask an admin to re-invite them.';
  end if;

  select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = v_email limit 1;

  -- Self-nomination would let any department author lift their own role to reviewer.
  if v_user_id = v_caller then
    raise exception 'You cannot nominate yourself.';
  end if;

  v_is_member := v_user_id is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = v_department.workspace_id and m.user_id = v_user_id
  );

  if v_is_member then
    select dept_role into v_current_role
      from public.department_members
     where department_id = v_department.id and user_id = v_user_id;

    -- A membership that arrived by another path (domain auto-join after the invite expired, an
    -- admin adding them directly) can leave the provisional marker behind; a membership is never pending.
    update public.department_members
       set pending_invite_at = null
     where department_id = v_department.id and user_id = v_user_id and pending_invite_at is not null;

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
    -- An admin who already invited this person AS AN APPROVER for this department keeps that
    -- entry untouched — a nomination is never a downgrade. Only the expiry is refreshed.
    v_keep_approver := exists (
      select 1
        from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
       where entry->>'department_id' = v_department.id
         and entry->>'role' = 'approver'
    );

    if v_keep_approver then
      v_row_role := 'approver';
      v_dept_access := coalesce(v_grant.department_access, '[]'::jsonb);
    else
      select coalesce(jsonb_agg(entry), '[]'::jsonb) into v_dept_access
        from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
       where entry->>'department_id' <> v_department.id;
      v_dept_access := v_dept_access || jsonb_build_array(v_entry);
    end if;

    update public.workspace_access_grants
       set department_access = v_dept_access,
           expires_at = now() + interval '30 days',
           redeemed_by = null,
           redeemed_at = null
     where workspace_id = v_department.workspace_id and email = v_email;
  end if;

  if v_user_id is not null then
    insert into public.department_members as dm
      (department_id, user_id, dept_role, position_title, granted_by, pending_invite_at)
    values (v_department.id, v_user_id, v_row_role, v_title, v_caller, now())
    on conflict (department_id, user_id) do update
      set position_title = excluded.position_title,
          granted_by = excluded.granted_by,
          pending_invite_at = now()
      where dm.pending_invite_at is not null;
  end if;

  return jsonb_build_object('mode', 'invite', 'user_id', v_user_id);
end;
$$;

revoke execute on function public.nominate_department_reviewer(text, text, text, text) from anon, public;
grant execute on function public.nominate_department_reviewer(text, text, text, text) to authenticated;
