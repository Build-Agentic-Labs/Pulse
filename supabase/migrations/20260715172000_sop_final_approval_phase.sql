-- A formal approval round begins only after every routed draft reviewer has
-- returned the current content with "No changes needed".

alter table public.sops
  add column if not exists final_approval_requested_at timestamptz,
  add column if not exists final_approval_content_hash text,
  add column if not exists final_approval_requested_by uuid references auth.users(id);

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
    where seat.sop_id = p_sop and seat.rasic <> 'informed'
  ) then
    raise exception 'Assign at least one reviewer before requesting final approval';
  end if;
  if exists (
    select 1
    from public.sop_review_seats seat
    where seat.sop_id = p_sop
      and seat.rasic <> 'informed'
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
    raise exception 'Every assigned reviewer must return No changes needed before final approval';
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

create or replace function public.clear_stale_sop_final_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.document is distinct from old.document
     or (old.status = 'in_review' and new.status = 'draft') then
    new.final_approval_requested_at := null;
    new.final_approval_content_hash := null;
    new.final_approval_requested_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_stale_sop_final_approval on public.sops;
create trigger clear_stale_sop_final_approval
before update on public.sops
for each row execute function public.clear_stale_sop_final_approval();

-- Department signatures belong only to the formal phase. Keep draft feedback in
-- sop_review_submissions and prevent the older control surface from bypassing it.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.sign_sop(text,text,text,text,text)'::regprocedure)
  into v_definition;

  if position($from$  if p_meaning = 'authorship' then$from$ in v_definition) = 0 then
    raise exception 'sign_sop authorization block changed';
  end if;

  v_definition := replace(
    v_definition,
    $from$  if p_meaning = 'authorship' then$from$,
    $to$  if p_meaning in ('dept_approval', 'review')
     and (s.final_approval_requested_at is null
          or s.final_approval_content_hash is distinct from s.content_hash) then
    raise exception 'The author has not sent this SOP for final approval';
  end if;

  if p_meaning = 'authorship' then$to$
  );

  execute v_definition;
end;
$migration$;
