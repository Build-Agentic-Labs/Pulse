-- Bind review completions to the exact draft content and add an immutable,
-- SOP-readable event stream for workflow auditing.

alter table public.sop_review_submissions
  add column if not exists content_hash text;

update public.sop_review_submissions submission
set content_hash = coalesce(sop.content_hash, '')
from public.sops sop
where sop.id = submission.sop_id
  and submission.content_hash is null;

alter table public.sop_review_submissions
  alter column content_hash set default '',
  alter column content_hash set not null;

alter table public.sop_review_submissions
  drop constraint if exists sop_review_submissions_sop_id_review_cycle_reviewer_id_key;

create unique index if not exists sop_review_submissions_content_reviewer_key
  on public.sop_review_submissions(sop_id, review_cycle, reviewer_id, content_hash);

create table if not exists public.sop_event_log (
  id            bigint generated always as identity primary key,
  sop_id        text not null references public.sops(id) on delete cascade,
  workspace_id  text not null,
  review_cycle  integer not null,
  event_type    text not null,
  actor_id      uuid references auth.users(id),
  actor_name    text not null default '',
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists sop_event_log_sop_created_idx
  on public.sop_event_log(sop_id, created_at desc);

alter table public.sop_event_log enable row level security;

drop policy if exists sop_event_log_read on public.sop_event_log;
create policy sop_event_log_read on public.sop_event_log
for select to authenticated using (public.can_read_sop(sop_id));

revoke insert, update, delete on public.sop_event_log from anon, authenticated;
grant select on public.sop_event_log to authenticated;

create or replace function public.append_sop_event(
  p_sop text,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
begin
  select workspace_id, review_cycle into s
  from public.sops
  where id = p_sop;

  if s is null then return; end if;

  insert into public.sop_event_log (
    sop_id,
    workspace_id,
    review_cycle,
    event_type,
    actor_id,
    actor_name,
    details
  ) values (
    p_sop,
    s.workspace_id,
    s.review_cycle,
    p_event_type,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.append_sop_event(text, text, jsonb) from public, anon, authenticated;

create or replace function public.log_sop_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.append_sop_event(
      new.id,
      case
        when old.status = 'draft' and new.status = 'in_review' then 'review_sent'
        when old.status = 'in_review' and new.status = 'draft' then 'review_recalled'
        else 'status_changed'
      end,
      jsonb_build_object(
        'from_status', old.status,
        'to_status', new.status,
        'content_hash', new.content_hash
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_sop_status_event on public.sops;
create trigger log_sop_status_event
after update of status on public.sops
for each row execute function public.log_sop_status_event();

create or replace function public.log_sop_review_annotation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare row_data public.sop_review_annotations%rowtype;
declare event_name text;
begin
  if tg_op = 'DELETE' then
    row_data := old;
  else
    row_data := new;
  end if;
  event_name := case
    when tg_op = 'INSERT' then 'remark_added'
    when tg_op = 'DELETE' then 'remark_deleted'
    when new.resolved_at is distinct from old.resolved_at and new.resolved_at is not null then 'remark_resolved'
    when new.body is distinct from old.body then 'remark_updated'
    else null
  end;

  if event_name is not null then
    perform public.append_sop_event(
      row_data.sop_id,
      event_name,
      jsonb_build_object(
        'annotation_id', row_data.id,
        'category', row_data.category,
        'reviewer_name', row_data.author_name
      )
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists log_sop_review_annotation_event on public.sop_review_annotations;
create trigger log_sop_review_annotation_event
after insert or update or delete on public.sop_review_annotations
for each row execute function public.log_sop_review_annotation_event();

create or replace function public.log_sop_review_submission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_sop_event(
    new.sop_id,
    'review_returned',
    jsonb_build_object(
      'reviewer_id', new.reviewer_id,
      'reviewer_name', new.reviewer_name,
      'no_changes', new.no_changes,
      'content_hash', new.content_hash
    )
  );
  return new;
end;
$$;

drop trigger if exists log_sop_review_submission_event on public.sop_review_submissions;
create trigger log_sop_review_submission_event
after insert on public.sop_review_submissions
for each row execute function public.log_sop_review_submission_event();

create or replace function public.resolve_sop_review_annotation(
  p_annotation text,
  p_resolved boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare annotation record;
begin
  if auth.uid() is null then
    raise exception 'Sign in before updating review remarks';
  end if;

  select a.*, s.created_by as sop_author
  into annotation
  from public.sop_review_annotations a
  join public.sops s on s.id = a.sop_id
  where a.id = p_annotation;

  if annotation is null then raise exception 'Review remark not found'; end if;
  if annotation.sop_author is distinct from auth.uid() then
    raise exception 'Only the SOP author can mark a returned remark addressed';
  end if;

  update public.sop_review_annotations
  set resolved_at = case when p_resolved then now() else null end,
      resolved_by = case when p_resolved then auth.uid() else null end
  where id = p_annotation;
end;
$$;

revoke execute on function public.resolve_sop_review_annotation(text, boolean) from public, anon;
grant execute on function public.resolve_sop_review_annotation(text, boolean) to authenticated;

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
      and submission.content_hash = coalesce(s.content_hash, '')
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
