-- Single draft-review round per release cycle.
--
-- Before: the draft review looped — any author edit changed content_hash, which
-- invalidated every submission and silently reopened the round, and final
-- approval required a fresh all-"no changes" pass on the exact current hash.
--
-- After: each reviewer submits exactly ONCE per review_cycle. When every
-- assigned reviewer has responded and the returned remarks are resolved, the
-- SOP moves to the signature phase (final approval → quality), never back into
-- another draft-review round. Content integrity is still enforced where it
-- matters: dept_approval and quality_approval signatures bind to the exact
-- content_hash the approver saw, and the transition guard freezes content
-- outside draft status.

-- 1) One submission per reviewer per cycle (was: per cycle + content hash,
--    which re-asked every reviewer after any author edit).
create or replace function public.submit_sop_review(p_sop text, p_no_changes boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  result_id text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting a review';
  end if;

  select status, review_cycle, content_hash
  into s
  from public.sops
  where id = p_sop and deleted_at is null;

  if s is null then raise exception 'SOP % not found', p_sop; end if;
  if s.status <> 'in_review' then
    raise exception 'Reviews can only be submitted while the SOP is in review';
  end if;
  if not exists (
    select 1 from public.sop_review_seats seat
    where seat.sop_id = p_sop
      and seat.signer_id = auth.uid()
      and seat.rasic <> 'informed'
  ) then
    raise exception 'Only an assigned reviewer can submit this review';
  end if;
  if exists (
    select 1 from public.sop_review_submissions submission
    where submission.sop_id = p_sop
      and submission.review_cycle = s.review_cycle
      and submission.reviewer_id = auth.uid()
  ) then
    raise exception 'You already sent this review back to the author';
  end if;

  if p_no_changes and exists (
    select 1 from public.sop_review_annotations annotation
    where annotation.sop_id = p_sop
      and annotation.review_cycle = s.review_cycle
      and annotation.created_by = auth.uid()
      and annotation.resolved_at is null
      and btrim(annotation.body) <> ''
  ) then
    raise exception 'Remove your remarks before selecting No changes needed';
  end if;

  if not p_no_changes and not exists (
    select 1 from public.sop_review_annotations annotation
    where annotation.sop_id = p_sop
      and annotation.review_cycle = s.review_cycle
      and annotation.created_by = auth.uid()
      and annotation.resolved_at is null
      and btrim(annotation.body) <> ''
  ) then
    raise exception 'Add at least one remark or select No changes needed';
  end if;

  insert into public.sop_review_submissions (
    sop_id,
    review_cycle,
    reviewer_id,
    reviewer_name,
    no_changes,
    content_hash
  ) values (
    p_sop,
    s.review_cycle,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    p_no_changes,
    coalesce(s.content_hash, '')
  )
  returning id into result_id;

  return result_id;
end;
$$;

revoke execute on function public.submit_sop_review(text, boolean) from public, anon;
grant execute on function public.submit_sop_review(text, boolean) to authenticated;

-- 2) Final approval opens once the round is COMPLETE (every non-informed seat
--    responded this cycle) and every returned remark is resolved — no longer
--    requiring a unanimous "no changes" pass against the current hash.
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
        )
      )
  ) then
    raise exception 'Every assigned reviewer must respond to the draft review before final approval';
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
