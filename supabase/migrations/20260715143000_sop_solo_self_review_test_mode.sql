-- TEMPORARY FLOW-TEST SUPPORT
--
-- A draft can opt into solo self-review only when its author is the sole Responsible
-- reviewer and it has no Accountable seat. Normal rosters retain every segregation rule.
-- The flag is locked once the draft enters review and is intentionally visible in control data.

alter table public.sops
  add column if not exists self_review_test boolean not null default false;

create or replace function public.sop_self_review_test_active(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.self_review_test, false)
     and s.created_by = auth.uid()
     and (select count(*) from public.sop_review_seats st
          where st.sop_id = s.id and st.rasic = 'responsible'
            and st.signer_id = auth.uid()) = 1
     and not exists (select 1 from public.sop_review_seats st
                     where st.sop_id = s.id and st.rasic = 'responsible'
                       and st.signer_id is distinct from auth.uid())
     and not exists (select 1 from public.sop_review_seats st
                     where st.sop_id = s.id and st.rasic = 'accountable')
  from public.sops s
  where s.id = p_sop and s.deleted_at is null;
$$;

create or replace function public.enable_sop_self_review_test(p_sop text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
begin
  select * into s from public.sops where id = p_sop and deleted_at is null for update;
  if s is null then raise exception 'SOP % not found', p_sop; end if;
  if s.status <> 'draft' then raise exception 'Solo test mode can only be enabled on a draft'; end if;
  if s.created_by is distinct from auth.uid() then
    raise exception 'Only the SOP author can enable solo test mode';
  end if;
  if (select count(*) from public.sop_review_seats st
      where st.sop_id = p_sop and st.rasic = 'responsible'
        and st.signer_id = auth.uid()) <> 1
     or exists (select 1 from public.sop_review_seats st
                where st.sop_id = p_sop and st.rasic = 'responsible'
                  and st.signer_id is distinct from auth.uid())
     or exists (select 1 from public.sop_review_seats st
                where st.sop_id = p_sop and st.rasic = 'accountable') then
    raise exception 'Solo test mode requires the author to be the sole Responsible reviewer with no Accountable seat';
  end if;

  update public.sops set self_review_test = true where id = p_sop;
  return true;
end;
$$;

revoke execute on function public.sop_self_review_test_active(text) from public, anon;
grant execute on function public.sop_self_review_test_active(text) to authenticated;
revoke execute on function public.enable_sop_self_review_test(text) from public, anon;
grant execute on function public.enable_sop_self_review_test(text) to authenticated;

-- Patch the current hardened transition guard in place. Each replacement asserts its source
-- text exists so a future function revision fails this migration instead of silently weakening
-- the wrong code path.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.enforce_sop_transition()'::regprocedure) into v_definition;

  if position($from$  is_manager boolean;
  v_reason text;$from$ in v_definition) = 0 then raise exception 'Transition guard declaration changed'; end if;
  v_definition := replace(v_definition, $from$  is_manager boolean;
  v_reason text;$from$, $to$  is_manager boolean;
  test_self boolean;
  v_reason text;$to$);

  if position($from$  v_reason := new.rejected_reason;$from$ in v_definition) = 0 then raise exception 'Transition guard setup changed'; end if;
  v_definition := replace(v_definition, $from$  v_reason := new.rejected_reason;$from$, $to$  test_self := public.sop_self_review_test_active(old.id);
  v_reason := new.rejected_reason;$to$);

  if position($from$       or new.review_interval_months is distinct from old.review_interval_months then$from$ in v_definition) = 0 then raise exception 'Transition guard content lock changed'; end if;
  v_definition := replace(v_definition, $from$       or new.review_interval_months is distinct from old.review_interval_months then$from$, $to$       or new.review_interval_months is distinct from old.review_interval_months
       or new.self_review_test is distinct from old.self_review_test then$to$);

  if position($from$      if (select count(*) from public.sop_review_seats st
          where st.sop_id = old.id and st.rasic = 'accountable') <> 1 then$from$ in v_definition) = 0 then raise exception 'Transition guard Accountable gate changed'; end if;
  v_definition := replace(v_definition, $from$      if (select count(*) from public.sop_review_seats st
          where st.sop_id = old.id and st.rasic = 'accountable') <> 1 then$from$, $to$      if not test_self and (select count(*) from public.sop_review_seats st
          where st.sop_id = old.id and st.rasic = 'accountable') <> 1 then$to$);

  if position($from$      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id
                   and st.rasic in ('responsible', 'accountable')
                   and st.signer_id = auth.uid()) then$from$ in v_definition) = 0 then raise exception 'Transition guard self-seat gate changed'; end if;
  v_definition := replace(v_definition, $from$      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id
                   and st.rasic in ('responsible', 'accountable')
                   and st.signer_id = auth.uid()) then$from$, $to$      if not test_self and exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id
                   and st.rasic in ('responsible', 'accountable')
                   and st.signer_id = auth.uid()) then$to$);

  if position($from$      if auth.uid() is not distinct from old.submitted_by then
        raise exception 'You cannot approve an SOP you submitted for review';$from$ in v_definition) = 0 then raise exception 'Transition guard self-approval gate changed'; end if;
  v_definition := replace(v_definition, $from$      if auth.uid() is not distinct from old.submitted_by then
        raise exception 'You cannot approve an SOP you submitted for review';$from$, $to$      if not test_self and auth.uid() is not distinct from old.submitted_by then
        raise exception 'You cannot approve an SOP you submitted for review';$to$);

  if position($from$      if not public.is_quality_approver(old.workspace_id) then$from$ in v_definition) = 0 then raise exception 'Transition guard Quality role gate changed'; end if;
  v_definition := replace(v_definition, $from$      if not public.is_quality_approver(old.workspace_id) then$from$, $to$      if not test_self and not public.is_quality_approver(old.workspace_id) then$to$);

  if position($from$      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id and st.signer_id = auth.uid()) then$from$ in v_definition) = 0 then raise exception 'Transition guard Quality seat gate changed'; end if;
  v_definition := replace(v_definition, $from$      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id and st.signer_id = auth.uid()) then$from$, $to$      if not test_self and exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id and st.signer_id = auth.uid()) then$to$);

  if position($from$      if auth.uid() is not distinct from old.created_by
         or auth.uid() is not distinct from old.submitted_by then$from$ in v_definition) = 0 then raise exception 'Transition guard Quality author gate changed'; end if;
  v_definition := replace(v_definition, $from$      if auth.uid() is not distinct from old.created_by
         or auth.uid() is not distinct from old.submitted_by then$from$, $to$      if not test_self and (auth.uid() is not distinct from old.created_by
         or auth.uid() is not distinct from old.submitted_by) then$to$);

  if position($from$      if exists (select 1 from public.sop_signatures sg
                 where sg.sop_id = old.id and sg.meaning = 'objection_overruled'$from$ in v_definition) = 0 then raise exception 'Transition guard overrule gate changed'; end if;
  v_definition := replace(v_definition, $from$      if exists (select 1 from public.sop_signatures sg
                 where sg.sop_id = old.id and sg.meaning = 'objection_overruled'$from$, $to$      if not test_self and exists (select 1 from public.sop_signatures sg
                 where sg.sop_id = old.id and sg.meaning = 'objection_overruled'$to$);

  execute v_definition;
end;
$migration$;

-- Apply the same narrow exception inside the signature authority function.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.sign_sop(text,text,text,text,text)'::regprocedure) into v_definition;

  if position($from$  v_hash text; v_cycle int; v_name text; v_id text; v_existing text;$from$ in v_definition) = 0 then raise exception 'sign_sop declaration changed'; end if;
  v_definition := replace(v_definition, $from$  v_hash text; v_cycle int; v_name text; v_id text; v_existing text;$from$, $to$  v_hash text; v_cycle int; v_name text; v_id text; v_existing text;
  v_test_self boolean;$to$);

  if position($from$  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_hash := s.content_hash;$from$ in v_definition) = 0 then raise exception 'sign_sop setup changed'; end if;
  v_definition := replace(v_definition, $from$  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_hash := s.content_hash;$from$, $to$  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_test_self := public.sop_self_review_test_active(p_sop);
  v_hash := s.content_hash;$to$);

  if position($from$    if auth.uid() is not distinct from coalesce(s.submitted_by, s.created_by) then$from$ in v_definition) = 0 then raise exception 'sign_sop self-sign gate changed'; end if;
  v_definition := replace(v_definition, $from$    if auth.uid() is not distinct from coalesce(s.submitted_by, s.created_by) then$from$, $to$    if not v_test_self and auth.uid() is not distinct from coalesce(s.submitted_by, s.created_by) then$to$);

  if position($from$    if not public.is_quality_approver(s.workspace_id) then$from$ in v_definition) = 0 then raise exception 'sign_sop Quality role gate changed'; end if;
  v_definition := replace(v_definition, $from$    if not public.is_quality_approver(s.workspace_id) then$from$, $to$    if not v_test_self and not public.is_quality_approver(s.workspace_id) then$to$);

  if position($from$    if exists (select 1 from public.sop_review_seats st
               where st.sop_id = p_sop and st.signer_id = auth.uid()) then$from$ in v_definition) = 0 then raise exception 'sign_sop Quality seat gate changed'; end if;
  v_definition := replace(v_definition, $from$    if exists (select 1 from public.sop_review_seats st
               where st.sop_id = p_sop and st.signer_id = auth.uid()) then$from$, $to$    if not v_test_self and exists (select 1 from public.sop_review_seats st
               where st.sop_id = p_sop and st.signer_id = auth.uid()) then$to$);

  if position($from$    if auth.uid() is not distinct from s.created_by
       or auth.uid() is not distinct from s.submitted_by then$from$ in v_definition) = 0 then raise exception 'sign_sop Quality author gate changed'; end if;
  v_definition := replace(v_definition, $from$    if auth.uid() is not distinct from s.created_by
       or auth.uid() is not distinct from s.submitted_by then$from$, $to$    if not v_test_self and (auth.uid() is not distinct from s.created_by
       or auth.uid() is not distinct from s.submitted_by) then$to$);

  execute v_definition;
end;
$migration$;
