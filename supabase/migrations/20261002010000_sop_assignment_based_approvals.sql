-- Department roles remain stored for compatibility with current users and pending invitations.
-- All members can author; only Quality's existing 'approver' designation controls final release.
-- Cross-department sign-off depends on the SOP seat and active membership in its workspace.
create or replace function public.is_sop_approver_candidate(p_department text, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.departments target
    join public.departments home on home.workspace_id = target.workspace_id
    join public.department_members member on member.department_id = home.id and member.user_id = p_user
    where target.id = p_department and (
      exists (select 1 from public.workspace_members wm where wm.workspace_id = target.workspace_id and wm.user_id = p_user)
      or (auth.uid() is distinct from p_user and member.pending_invite_at is not null)
    )
  );
$$;
revoke all on function public.is_sop_approver_candidate(text, uuid) from public, anon;
grant execute on function public.is_sop_approver_candidate(text, uuid) to authenticated;

-- Surgical edits retain live workflow hardening, signatures, hashes and independent Quality gates.
-- Fail closed when an expected guard has drifted instead of installing a partial permission model.
do $$
declare v_oid oid; v_name text; v_definition text; v_original text;
begin
  foreach v_name in array array['sign_sop', 'submit_sop_review', 'reassign_sop_seat', 'sop_quorum_met', 'enforce_sop_transition'] loop
    select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=v_name;
    v_original := pg_get_functiondef(v_oid);
    v_definition := replace(v_original, 'public.is_department_member(st.department_id, st.signer_id)', 'public.is_sop_approver_candidate(st.department_id, st.signer_id)');
    v_definition := replace(v_definition, 'public.is_department_member(seat.department_id, auth.uid())', 'public.is_sop_approver_candidate(seat.department_id, auth.uid())');
    v_definition := replace(v_definition, 'public.is_department_member(p_seat_department, auth.uid())', 'public.is_sop_approver_candidate(p_seat_department, auth.uid())');
    v_definition := replace(v_definition, 'public.is_department_member(p_department, p_new_signer)', 'public.is_sop_approver_candidate(p_department, p_new_signer)');
    if v_definition = v_original then raise exception 'Missing assignment membership guard in %', v_name; end if;
    v_definition := replace(v_definition, 'Every seat''s reviewer must belong to that seat''''s department', 'Every assigned approver must be an SOP member in this workspace');
    v_definition := replace(v_definition, 'The new reviewer must be a member of that seat''''s department', 'The new approver must be an SOP member in this workspace');
    v_definition := replace(v_definition, 'You are no longer a member of that department and cannot sign for it', 'You are no longer an SOP member in this workspace');
    v_definition := replace(v_definition, 'Only the designated reviewer for this department can sign its seat', 'Only the assigned approver for this department can sign');
    if v_name = 'sign_sop' then
      v_definition := replace(v_definition, 'auth.uid() is not distinct from coalesce(s.submitted_by, s.created_by)', '(auth.uid() is not distinct from s.created_by or auth.uid() is not distinct from s.submitted_by)');
    end if;
    execute v_definition;
  end loop;
end $$;

-- A departed member must lose access through their seat as well as their ability to sign.
create or replace function public.holds_sop_seat(p_sop text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sop_review_seats seat
    join public.sops doc on doc.id=seat.sop_id
    join public.workspace_members wm on wm.workspace_id=doc.workspace_id and wm.user_id=seat.signer_id
    where seat.sop_id=p_sop and seat.signer_id=auth.uid()
      and public.is_sop_approver_candidate(seat.department_id, auth.uid())
  );
$$;

-- Validate assignments on write, including cross-workspace and self-approval boundaries.
do $$
declare v_definition text; v_anchor text;
begin
  v_definition := pg_get_functiondef('public.enforce_seat_freeze()'::regprocedure);
  v_anchor := $anchor$  if v_status = 'draft' then$anchor$;
  if position(v_anchor in v_definition)=0 then raise exception 'Missing seat-freeze guard'; end if;
  v_definition := replace(v_definition, v_anchor, $replacement$
  if tg_op <> 'DELETE' and new.signer_id is not null
     and (tg_op = 'INSERT' or new.signer_id is distinct from old.signer_id
          or new.department_id is distinct from old.department_id) then
    if not public.is_sop_approver_candidate(new.department_id, new.signer_id) then
      raise exception 'Choose an SOP member from this workspace';
    end if;
    if not public.sop_self_review_test_active(new.sop_id) and exists (
      select 1 from public.sops doc where doc.id=new.sop_id
        and (new.signer_id=doc.created_by or new.signer_id=doc.submitted_by)
    ) then
      raise exception 'The author or submitter cannot approve their own SOP';
    end if;
  end if;
  if v_status = 'draft' then$replacement$);
  execute v_definition;
end $$;
