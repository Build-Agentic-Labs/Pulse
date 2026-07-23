-- Lock ordering across the seat write paths. sign_sop already takes FOR UPDATE on the sops row
-- before it reads quorum and auto-advances status (draft -> in_review -> approved). Two sibling
-- paths read sops WITHOUT that lock and therefore do not serialize against it:
--
--   1. reassign_sop_seat reads sops.status and runs its seat / 'already signed' checks on an
--      unlocked row, so a reassignment can interleave with a sign_sop quorum auto-advance and
--      act on a status that has already moved.
--   2. enforce_seat_freeze (the roster DML trigger) reads sops.status unlocked, so a seat DELETE
--      racing a draft -> in_review submit can commit against a status Gate A already validated.
--
-- Both are re-created here to take FOR UPDATE on the sops row before their status-dependent
-- checks, matching sign_sop's ordering: every path locks the sops row FIRST, so they queue
-- behind one another instead of racing, and the consistent lock order rules out deadlock.
-- Function bodies are otherwise carried over verbatim from their latest definitions
-- (reassign_sop_seat: 20260710123500; enforce_seat_freeze: 20260710124000).

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
  -- Lock the sops row before any status-dependent check so this reassignment serializes
  -- against sign_sop's FOR UPDATE quorum auto-advance instead of racing it.
  select * into s from public.sops where id = p_sop and deleted_at is null for update;
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

-- ── enforce_seat_freeze: lock the parent before gating roster DML on its status ─────────────
create or replace function public.enforce_seat_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text; v_ws text; v_dept_ws text;
begin
  if tg_op <> 'DELETE' then
    select workspace_id into v_ws from public.sops where id = new.sop_id;
    select workspace_id into v_dept_ws from public.departments where id = new.department_id;
    if v_dept_ws is distinct from v_ws then
      raise exception 'A review seat must name a department in this SOP''s workspace';
    end if;
  end if;

  -- FOR UPDATE is load-bearing, not incidental: without it a seat INSERT/DELETE reads status on
  -- an unlocked row and can commit against a draft -> in_review submit that is auto-advancing
  -- concurrently, defeating the roster freeze. Locking the sops row here makes roster DML queue
  -- behind an in-flight submit. This matches the lock order taken by sign_sop and
  -- reassign_sop_seat (sops row FIRST), so the three paths cannot deadlock.
  select status into v_status from public.sops
    where id = coalesce(new.sop_id, old.sop_id) for update;

  if v_status = 'draft' then
    if tg_op = 'DELETE' then return old; end if;
    new.updated_at := now();
    if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
    return new;
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'The review roster is frozen once the SOP has been submitted';
  end if;

  if new.sop_id is distinct from old.sop_id
     or new.department_id is distinct from old.department_id
     or new.rasic is distinct from old.rasic then
    raise exception 'Only the designated reviewer may change once the SOP has been submitted';
  end if;

  new.updated_at := now();
  return new;
end $$;
