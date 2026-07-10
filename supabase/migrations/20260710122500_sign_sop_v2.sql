-- sign_sop v2 — seat-identity authorization, and the transitions that a signature IMPLIES.
--
-- Two things move into this function:
--   * Signing the last blocking seat advances in_review -> approved. Nobody clicks "Approve".
--     The gate opens because it is satisfied. This also means no cross-department signer needs
--     UPDATE on sops (a definer function bypasses RLS), and no SOP can sit at full quorum
--     waiting for someone to notice.
--   * Signing a rejection sends the SOP back to draft in the same call, so an objection cannot
--     exist without the transition that follows it.
--
-- Authorization is by SEAT IDENTITY (auth.uid() = seat.signer_id), not by role. has_department_role
-- folds in workspace owners/admins AND every Quality-gate approver, so a role check would let both
-- sign a department approval for a department they do not belong to. The seat names the person;
-- an admin who does not hold it has nothing to satisfy.

/** Strict department membership. No fold-ins, any dept_role. */
create or replace function public.is_department_member(dept_id text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select dept_id is not null and p_user is not null and exists (
    select 1 from public.department_members m
    where m.department_id = dept_id and m.user_id = p_user);
$$;
revoke execute on function public.is_department_member(text, uuid) from public, anon;
grant execute on function public.is_department_member(text, uuid) to authenticated;

/** Is this user an approver in the workspace's Quality-gate department? Strict: no fold-ins. */
create or replace function public.is_quality_approver(p_workspace text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.department_members m
    join public.departments q on q.id = m.department_id
    where m.user_id = p_user and m.dept_role = 'approver'
      and q.is_quality_gate and q.workspace_id = p_workspace);
$$;
revoke execute on function public.is_quality_approver(text, uuid) from public, anon;
grant execute on function public.is_quality_approver(text, uuid) to authenticated;

-- The v1 signature must go, or the two coexist as OVERLOADS and every 2-arg call becomes
-- ambiguous ("function sign_sop(unknown, unknown) is not unique"). The v2 signature is a strict
-- superset: existing 3-arg call sites keep working through the defaults.
drop function if exists public.sign_sop(text, text, text);

create or replace function public.sign_sop(
  p_sop             text,
  p_meaning         text,
  p_reason          text default null,
  p_seat_department text default null,
  p_resolves        text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record; v_seat record; v_acct record; v_obj record; v_objseat record;
  v_hash text; v_cycle int; v_name text; v_id text; v_existing text;
begin
  -- The row lock serializes the concurrent-last-signature race: the second caller waits, then
  -- re-reads the committed row and finds the status already moved.
  select * into s from public.sops where id = p_sop and deleted_at is null for update;
  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_hash := s.content_hash;
  v_cycle := s.review_cycle;
  select full_name into v_name from public.profiles where id = auth.uid();

  -- A signature only makes sense in the state its action acts on.
  if p_meaning = 'authorship' and s.status <> 'draft' then
    raise exception 'Authorship is declared on the draft, before it is submitted';
  elsif p_meaning in ('dept_approval', 'review', 'rejection') and s.status <> 'in_review' then
    raise exception 'This action is only available while the SOP is in review';
  elsif p_meaning = 'quality_approval' and s.status <> 'approved' then
    raise exception 'Quality approval is only available once every department has signed';
  elsif p_meaning in ('objection_withdrawn', 'objection_overruled') and s.status <> 'draft' then
    -- A rejection forces the SOP back to draft, so that is where objections are dispositioned.
    raise exception 'An objection is closed while the SOP is back in draft';
  end if;

  if p_meaning = 'authorship' then
    if not public.is_department_member(s.department_id) then
      raise exception 'Only a member of the owning department can author this SOP';
    end if;

  elsif p_meaning in ('dept_approval', 'review', 'rejection') then
    if p_seat_department is null then
      raise exception 'Name the department seat you are signing for';
    end if;
    select * into v_seat from public.sop_review_seats st
      where st.sop_id = p_sop and st.department_id = p_seat_department;
    if v_seat is null then
      raise exception 'That department holds no seat on this SOP';
    end if;
    if v_seat.signer_id is distinct from auth.uid() then
      raise exception 'Only the designated reviewer for this department can sign its seat';
    end if;
    if auth.uid() is not distinct from coalesce(s.submitted_by, s.created_by) then
      raise exception 'You cannot sign off on an SOP you submitted';
    end if;

    if p_meaning = 'dept_approval' and v_seat.rasic not in ('responsible', 'accountable') then
      raise exception 'Support and Consulted seats sign a review, not a department approval';
    end if;
    if p_meaning = 'review' and v_seat.rasic in ('responsible', 'accountable') then
      raise exception 'Responsible and Accountable seats sign the department approval';
    end if;
    if p_meaning = 'rejection' then
      if v_seat.rasic not in ('responsible', 'accountable') then
        raise exception 'Support and Consulted departments comment; they cannot block a release';
      end if;
      if p_reason is null or btrim(p_reason) = '' then
        raise exception 'A rejection needs a reason';
      end if;
    end if;

  elsif p_meaning = 'quality_approval' then
    if not public.is_quality_approver(s.workspace_id) then
      raise exception 'Only a Quality approver can sign the quality approval';
    end if;
    if exists (select 1 from public.sop_review_seats st
               where st.sop_id = p_sop and st.signer_id = auth.uid()) then
      raise exception 'The Quality approver must not hold a review seat on this SOP';
    end if;
    if auth.uid() is not distinct from s.created_by
       or auth.uid() is not distinct from s.submitted_by then
      raise exception 'The Quality approver must differ from the author';
    end if;

  elsif p_meaning in ('objection_withdrawn', 'objection_overruled') then
    if p_resolves is null then
      raise exception 'Name the objection being closed';
    end if;
    select * into v_obj from public.sop_signatures o
      where o.id = p_resolves and o.sop_id = p_sop and o.meaning = 'rejection';
    if v_obj is null then
      raise exception 'That is not an objection on this SOP';
    end if;
    if exists (select 1 from public.sop_signatures r where r.resolves_signature_id = v_obj.id) then
      raise exception 'That objection has already been closed';
    end if;

    if p_meaning = 'objection_withdrawn' then
      if auth.uid() is distinct from v_obj.signer_id then
        raise exception 'Only the reviewer who raised the objection can withdraw it';
      end if;
    else
      if p_reason is null or btrim(p_reason) = '' then
        raise exception 'An overrule needs a written justification';
      end if;
      select * into v_objseat from public.sop_review_seats st
        where st.sop_id = p_sop and st.department_id = v_obj.seat_department_id;
      if v_objseat.rasic = 'responsible' then
        -- The Accountable department owns the outcome; it decides.
        select * into v_acct from public.sop_review_seats st
          where st.sop_id = p_sop and st.rasic = 'accountable';
        if v_acct is null or v_acct.signer_id is distinct from auth.uid() then
          raise exception 'Only the Accountable department can overrule a Responsible objection';
        end if;
      elsif v_objseat.rasic = 'accountable' then
        -- Nobody in the department outranks Accountable, so it escalates to the independent gate.
        if not public.is_quality_approver(s.workspace_id) then
          raise exception 'Only a Quality approver can overrule an Accountable objection';
        end if;
      else
        raise exception 'Only Responsible and Accountable seats can raise an objection';
      end if;
    end if;

  elsif p_meaning = 'objection_sustained' then
    raise exception 'A sustained objection is recorded by the system when the author edits';

  else
    raise exception 'Unknown signature meaning %', p_meaning;
  end if;

  -- Idempotent on a retried sign — but a CLOSED signature is not a match, so an objector who
  -- withdrew may raise the same objection again at the same hash and cycle.
  select sg.id into v_existing from public.sop_signatures sg
   where sg.sop_id = p_sop
     and sg.signer_id = auth.uid()
     and sg.meaning = p_meaning
     and sg.signed_content_hash = v_hash
     and sg.review_cycle = v_cycle
     and sg.seat_department_id is not distinct from p_seat_department
     and sg.resolves_signature_id is not distinct from p_resolves
     and not exists (select 1 from public.sop_signatures r where r.resolves_signature_id = sg.id)
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_id := gen_random_uuid()::text;
  insert into public.sop_signatures
    (id, sop_id, signer_id, meaning, signer_printed_name, signed_content_hash,
     rejected_reason, seat_department_id, review_cycle, resolves_signature_id)
  values (v_id, p_sop, auth.uid(), p_meaning, coalesce(v_name, ''), v_hash,
          p_reason, p_seat_department, v_cycle, p_resolves);

  -- The transitions a signature implies. Gate B is not a button.
  if p_meaning = 'dept_approval' then
    if public.sop_quorum_met(p_sop) and not public.sop_has_open_objection(p_sop) then
      update public.sops set status = 'approved' where id = p_sop;
    end if;
  elsif p_meaning = 'rejection' then
    update public.sops set status = 'draft' where id = p_sop;
  end if;

  return v_id;
end $$;
