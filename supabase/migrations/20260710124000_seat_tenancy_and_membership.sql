-- Two authorization holes found by adversarial review of the shipped code, both reproduced
-- against a live database.
--
-- 1. TENANCY. sop_review_seats' write policy authorizes on can_edit_sop_roster(sop_id), which
--    validates the SOP's workspace but never checks that the SEAT'S DEPARTMENT belongs to it.
--    holds_sop_seat / sign_sop then authorize purely on seat identity. A workspace-A editor
--    could plant a seat naming a workspace-B department and a workspace-B user, who could then
--    read the SOP and sign a blocking approval — crossing the tenant boundary that
--    has_org_tool_access is supposed to hold. The check goes in the seat TRIGGER, not the RLS
--    policy, because a trigger fires for definer callers and raw PostgREST writes alike.
--
-- 2. MEMBERSHIP AT SIGN TIME. The design names this failure in reassign_sop_seat's rationale —
--    "seat identity alone would let a signer removed from the department mid-review still sign"
--    — but the mitigation was applied only there. Gate A checks membership at submit; nothing
--    re-checked it when the signature was actually made. Remove a signer from their department
--    after submit and they could still complete the quorum.
--
-- Also: Gate C trusted a stored quality_approval signature without re-checking that its signer
-- is still a Quality approver, and the change log's from_version fallback could record
-- from == to if the prior revision row ever went missing.

-- ── 1. a seat's department must live in the SOP's workspace ────────────────────────────────
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

  select status into v_status from public.sops where id = coalesce(new.sop_id, old.sop_id);

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

-- ── 2. re-check membership when the signature is actually made ─────────────────────────────
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
  select * into s from public.sops where id = p_sop and deleted_at is null for update;
  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_hash := s.content_hash;
  v_cycle := s.review_cycle;
  select full_name into v_name from public.profiles where id = auth.uid();

  if p_meaning = 'authorship' and s.status <> 'draft' then
    raise exception 'Authorship is declared on the draft, before it is submitted';
  elsif p_meaning in ('dept_approval', 'review', 'rejection') and s.status <> 'in_review' then
    raise exception 'This action is only available while the SOP is in review';
  elsif p_meaning = 'quality_approval' and s.status <> 'approved' then
    raise exception 'Quality approval is only available once every department has signed';
  elsif p_meaning in ('objection_withdrawn', 'objection_overruled') and s.status <> 'draft' then
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
    -- Membership is checked at Gate A, but people leave departments mid-review. A seat holder
    -- who is no longer a member of the department they speak for cannot speak for it.
    if not public.is_department_member(p_seat_department, auth.uid()) then
      raise exception 'You are no longer a member of that department and cannot sign for it';
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
        select * into v_acct from public.sop_review_seats st
          where st.sop_id = p_sop and st.rasic = 'accountable';
        if v_acct is null or v_acct.signer_id is distinct from auth.uid() then
          raise exception 'Only the Accountable department can overrule a Responsible objection';
        end if;
      elsif v_objseat.rasic = 'accountable' then
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

  if p_meaning = 'dept_approval' then
    if public.sop_quorum_met(p_sop) and not public.sop_has_open_objection(p_sop) then
      update public.sops set status = 'approved' where id = p_sop;
    end if;
  elsif p_meaning = 'rejection' then
    update public.sops set status = 'draft' where id = p_sop;
  end if;

  return v_id;
end $$;

-- ── 3. quorum must only count signers who still belong to their seat's department ───────────
create or replace function public.sop_quorum_met(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.sop_review_seats st
                 where st.sop_id = p_sop and st.rasic = 'responsible')
     and not exists (
    select 1
    from public.sop_review_seats st
    join public.sops s on s.id = st.sop_id
    where st.sop_id = p_sop
      and st.rasic in ('responsible', 'accountable')
      and (
        not public.is_department_member(st.department_id, st.signer_id)
        or not exists (
          select 1 from public.sop_signatures g
          where g.sop_id = st.sop_id
            and g.signer_id = st.signer_id
            and g.seat_department_id = st.department_id
            and g.meaning = 'dept_approval'
            and g.signed_content_hash = s.content_hash
            and g.review_cycle = s.review_cycle)));
$$;
