-- Seat reassignment: one signer per department is clean, and it is also a single point of
-- failure. An admin may move the seat when its reviewer is unavailable.
--
-- The governing principle: ADMINS MOVE PEOPLE, ADMINS NEVER SIGN. The moment an admin can do
-- both, reassignment becomes a path to self-approval — reassign the seat to yourself, sign it,
-- done. Hence: not to yourself, only within the same department, and never a seat that has
-- already signed.
--
-- Recorded in the existing generic audit_log; no new audit table.

create or replace function public.reassign_sop_seat(
  p_sop        text,
  p_department text,
  p_new_signer uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record; st record; v_email text; v_old uuid;
begin
  select * into s from public.sops where id = p_sop and deleted_at is null;
  if s is null then raise exception 'SOP % not found', p_sop; end if;

  if not public.has_workspace_role(
       s.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Only a workspace admin can reassign a review seat';
  end if;

  if s.status not in ('draft', 'in_review') then
    raise exception 'A seat can only be reassigned before the SOP is approved';
  end if;

  select * into st from public.sop_review_seats
    where sop_id = p_sop and department_id = p_department;
  if st is null then raise exception 'That department holds no seat on this SOP'; end if;

  -- Reassignment must never be a route to signing.
  if p_new_signer is not distinct from auth.uid() then
    raise exception 'An admin cannot reassign a seat to themselves';
  end if;

  if not public.is_department_member(p_department, p_new_signer) then
    raise exception 'The new reviewer must be a member of that seat''s department';
  end if;

  -- A seat that has signed is closed. You do not retroactively swap out a signatory.
  if exists (
    select 1 from public.sop_signatures g
    where g.sop_id = p_sop
      and g.seat_department_id = p_department
      and g.signer_id = st.signer_id
      and g.meaning in ('dept_approval', 'review')
      and g.signed_content_hash = s.content_hash
      and g.review_cycle = s.review_cycle) then
    raise exception 'That seat has already signed; its signature stands';
  end if;

  v_old := st.signer_id;
  update public.sop_review_seats
     set signer_id = p_new_signer
   where sop_id = p_sop and department_id = p_department;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.audit_log
    (workspace_id, actor_id, actor_email, action, target_type, target_id, details)
  values (s.workspace_id, auth.uid(), coalesce(v_email, ''), 'reassign_seat',
          'sop_review_seat', p_sop,
          jsonb_build_object('department_id', p_department,
                             'from_signer', v_old,
                             'to_signer', p_new_signer));
end $$;

revoke execute on function public.reassign_sop_seat(text, text, uuid) from public, anon;
grant execute on function public.reassign_sop_seat(text, text, uuid) to authenticated;
