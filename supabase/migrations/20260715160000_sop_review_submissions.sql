-- One completion result per reviewer and review cycle. Remarks remain in
-- sop_review_annotations; this table records that the reviewer finished and whether
-- they explicitly found no changes were needed.

create table if not exists public.sop_review_submissions (
  id             text primary key default gen_random_uuid()::text,
  sop_id         text not null references public.sops(id) on delete cascade,
  review_cycle   integer not null,
  reviewer_id    uuid not null references auth.users(id),
  reviewer_name  text not null default '',
  no_changes     boolean not null,
  submitted_at   timestamptz not null default now(),
  unique (sop_id, review_cycle, reviewer_id)
);

create index if not exists sop_review_submissions_sop_cycle_idx
  on public.sop_review_submissions(sop_id, review_cycle, submitted_at);

alter table public.sop_review_submissions enable row level security;

drop policy if exists sop_review_submissions_read on public.sop_review_submissions;
create policy sop_review_submissions_read on public.sop_review_submissions
for select to authenticated using (public.can_read_sop(sop_id));

revoke insert, update, delete on public.sop_review_submissions from anon, authenticated;
grant select on public.sop_review_submissions to authenticated;

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

  select status, review_cycle
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
    no_changes
  ) values (
    p_sop,
    s.review_cycle,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    p_no_changes
  )
  returning id into result_id;

  return result_id;
end;
$$;

revoke execute on function public.submit_sop_review(text, boolean) from public, anon;
grant execute on function public.submit_sop_review(text, boolean) to authenticated;
