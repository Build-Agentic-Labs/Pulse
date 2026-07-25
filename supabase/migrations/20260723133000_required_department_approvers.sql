-- Department approval routing contains only people whose approval is required.
--
-- Procedure RASIC remains part of the SOP document. It no longer doubles as the
-- document-control routing model. The legacy `rasic` column stays in place for
-- compatibility, but every approval seat is normalized to `responsible`, which
-- now means "required departmental approver" internally.

-- Normalize existing rosters without letting the draft-only freeze trigger
-- reject changes to SOPs that are already in review.
alter table public.sop_review_seats disable trigger sop_review_seats_freeze;

delete from public.sop_review_seats
where rasic in ('support', 'consulted', 'informed')
   or signer_id is null;

update public.sop_review_seats
set rasic = 'responsible'
where rasic = 'accountable';

alter table public.sop_review_seats enable trigger sop_review_seats_freeze;

drop index if exists public.sop_review_seats_one_accountable;

alter table public.sop_review_seats
  drop constraint if exists sop_review_seats_required_approver;
alter table public.sop_review_seats
  add constraint sop_review_seats_required_approver
  check (rasic = 'responsible');

comment on column public.sop_review_seats.rasic is
  'Legacy compatibility field. Approval routing stores required departmental approvers as responsible; procedure RASIC is stored in the SOP document.';

-- The temporary solo-author test path conflicts with segregation of duties:
-- an author may submit, but may not be one of the required approvers.
--
-- Same hazard the seat normalization above guards against, one table over: 20260715143000
-- added self_review_test to the transition guard's draft-only content-freeze list, so clearing
-- it on an SOP that has already left draft is rejected with "This SOP is in_review; start a
-- revision before editing its content". Suspending the seat trigger alone was not enough --
-- this statement is on public.sops, which sops_enforce_transition guards.
alter table public.sops disable trigger sops_enforce_transition;
update public.sops set self_review_test = false where self_review_test;
alter table public.sops enable trigger sops_enforce_transition;

create or replace function public.sop_self_review_test_active(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

create or replace function public.enable_sop_self_review_test(p_sop text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Solo self-review is no longer available; assign a required departmental approver';
end;
$$;

-- Remove the former "exactly one Accountable" gate and update the remaining
-- required-approver messages in the live transition function. The database
-- remains the authoritative gate after the UI enables the button.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.enforce_sop_transition()'::regprocedure)
  into v_definition;

  if position($from$      if not test_self and (select count(*) from public.sop_review_seats st
          where st.sop_id = old.id and st.rasic = 'accountable') <> 1 then
        raise exception 'Name exactly one Accountable department before submitting';
      end if;
$from$ in v_definition) = 0 then
    raise exception 'Transition guard Accountable gate changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$      if not test_self and (select count(*) from public.sop_review_seats st
          where st.sop_id = old.id and st.rasic = 'accountable') <> 1 then
        raise exception 'Name exactly one Accountable department before submitting';
      end if;
$from$,
    $to$      -- Every roster row is now a required departmental approver.
$to$
  );

  v_definition := replace(
    v_definition,
    $from$Name at least one Responsible department before submitting$from$,
    $to$Assign at least one required departmental approver before submitting$to$
  );
  v_definition := replace(
    v_definition,
    $from$You hold a blocking seat on this SOP; someone else must submit it$from$,
    $to$You are a required approver on this SOP; someone else must submit it$to$
  );
  v_definition := replace(
    v_definition,
    $from$Every Responsible and Accountable department must sign before Quality review$from$,
    $to$Every required departmental approver must sign before Quality review$to$
  );

  execute v_definition;
end;
$migration$;

-- A departmental objection now escalates directly to the independent Quality
-- final approver. Another departmental approver cannot overrule a peer.
--
-- The $from$ blocks below carry `not v_test_self and` because that is what is actually in the
-- live function: 20260715143000 patched this same line when it added the solo self-review
-- bypass, and it applied first. Anchoring on the unprefixed text made this block raise
-- 'sign_sop objection hierarchy changed'. The $to$ drops the bypass deliberately -- this
-- migration retires self-review test mode above (sop_self_review_test_active now returns
-- false), so v_test_self is constant-false from here on and the prefix would be inert.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.sign_sop(text,text,text,text,text,text,integer)'::regprocedure
  )
  into v_definition;

  if position($from$      if v_objseat.rasic = 'responsible' then
        select * into v_acct from public.sop_review_seats st
          where st.sop_id = p_sop and st.rasic = 'accountable';
        if v_acct is null or v_acct.signer_id is distinct from auth.uid() then
          raise exception 'Only the Accountable department can overrule a Responsible objection';
        end if;
      elsif v_objseat.rasic = 'accountable' then
        if not v_test_self and not public.is_quality_approver(s.workspace_id) then
          raise exception 'Only a Quality approver can overrule an Accountable objection';
        end if;
      else
        raise exception 'Only Responsible and Accountable seats can raise an objection';
      end if;
$from$ in v_definition) = 0 then
    raise exception 'sign_sop objection hierarchy changed';
  end if;

  v_definition := replace(
    v_definition,
    $from$      if v_objseat.rasic = 'responsible' then
        select * into v_acct from public.sop_review_seats st
          where st.sop_id = p_sop and st.rasic = 'accountable';
        if v_acct is null or v_acct.signer_id is distinct from auth.uid() then
          raise exception 'Only the Accountable department can overrule a Responsible objection';
        end if;
      elsif v_objseat.rasic = 'accountable' then
        if not v_test_self and not public.is_quality_approver(s.workspace_id) then
          raise exception 'Only a Quality approver can overrule an Accountable objection';
        end if;
      else
        raise exception 'Only Responsible and Accountable seats can raise an objection';
      end if;
$from$,
    $to$      if v_objseat.rasic = 'responsible' then
        if not public.is_quality_approver(s.workspace_id) then
          raise exception 'Only a Quality final approver can overrule a departmental objection';
        end if;
      else
        raise exception 'Only a required departmental approver can raise an objection';
      end if;
$to$
  );

  execute v_definition;
end;
$migration$;

-- Formal approval can begin only after every required departmental approver
-- has returned the draft with no changes needed.
create or replace function public.request_sop_final_approval(p_sop text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
begin
  if auth.uid() is null then
    raise exception 'Sign in before requesting final approval';
  end if;

  select * into s
  from public.sops
  where id = p_sop and deleted_at is null
  for update;

  if s is null then raise exception 'SOP % not found', p_sop; end if;
  if s.status <> 'in_review' then
    raise exception 'Final approval can only begin after draft review';
  end if;
  if auth.uid() is distinct from s.created_by
     and auth.uid() is distinct from s.submitted_by then
    raise exception 'Only the SOP author or submitter can request final approval';
  end if;
  if s.content_hash is null or s.content_hash = '' then
    raise exception 'Save the SOP before requesting final approval';
  end if;
  if not exists (
    select 1 from public.sop_review_seats seat
    where seat.sop_id = p_sop and seat.rasic = 'responsible'
  ) then
    raise exception 'Assign at least one required departmental approver before requesting final approval';
  end if;
  if exists (
    select 1
    from public.sop_review_seats seat
    where seat.sop_id = p_sop
      and seat.rasic = 'responsible'
      and (
        seat.signer_id is null
        or not exists (
          select 1
          from public.sop_review_submissions submission
          where submission.sop_id = p_sop
            and submission.review_cycle = s.review_cycle
            and submission.reviewer_id = seat.signer_id
            and submission.content_hash = s.content_hash
            and submission.no_changes = true
        )
      )
  ) then
    raise exception 'Every required departmental approver must return No changes needed before final approval';
  end if;
  if exists (
    select 1 from public.sop_review_annotations annotation
    where annotation.sop_id = p_sop
      and annotation.review_cycle = s.review_cycle
      and annotation.resolved_at is null
  ) then
    raise exception 'Address every returned remark before requesting final approval';
  end if;

  if s.final_approval_requested_at is not null
     and s.final_approval_content_hash = s.content_hash then
    return;
  end if;

  update public.sops
  set final_approval_requested_at = now(),
      final_approval_content_hash = s.content_hash,
      final_approval_requested_by = auth.uid()
  where id = p_sop;

  perform public.append_sop_event(
    p_sop,
    'final_approval_requested',
    jsonb_build_object('content_hash', s.content_hash)
  );
end;
$$;

revoke execute on function public.request_sop_final_approval(text) from public, anon;
grant execute on function public.request_sop_final_approval(text) to authenticated;
