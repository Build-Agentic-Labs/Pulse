-- Seed the new audit timeline from review records that predate the event log.

insert into public.sop_event_log (
  sop_id,
  workspace_id,
  review_cycle,
  event_type,
  actor_id,
  actor_name,
  details,
  created_at
)
select
  submission.sop_id,
  sop.workspace_id,
  submission.review_cycle,
  'review_returned',
  submission.reviewer_id,
  submission.reviewer_name,
  jsonb_build_object(
    'reviewer_id', submission.reviewer_id,
    'reviewer_name', submission.reviewer_name,
    'no_changes', submission.no_changes,
    'content_hash', submission.content_hash,
    'backfilled', true
  ),
  submission.submitted_at
from public.sop_review_submissions submission
join public.sops sop on sop.id = submission.sop_id;

insert into public.sop_event_log (
  sop_id,
  workspace_id,
  review_cycle,
  event_type,
  actor_id,
  actor_name,
  details,
  created_at
)
select
  annotation.sop_id,
  sop.workspace_id,
  annotation.review_cycle,
  'remark_added',
  annotation.created_by,
  annotation.author_name,
  jsonb_build_object(
    'annotation_id', annotation.id,
    'category', annotation.category,
    'reviewer_name', annotation.author_name,
    'backfilled', true
  ),
  annotation.created_at
from public.sop_review_annotations annotation
join public.sops sop on sop.id = annotation.sop_id;

insert into public.sop_event_log (
  sop_id,
  workspace_id,
  review_cycle,
  event_type,
  actor_id,
  actor_name,
  details,
  created_at
)
select
  sop.id,
  sop.workspace_id,
  sop.review_cycle,
  'review_sent',
  sop.submitted_by,
  coalesce(profile.full_name, ''),
  jsonb_build_object(
    'from_status', 'draft',
    'to_status', sop.status,
    'content_hash', sop.content_hash,
    'backfilled', true
  ),
  sop.updated_at
from public.sops sop
left join public.profiles profile on profile.id = sop.submitted_by
where sop.status in ('in_review', 'approved', 'effective')
  and not exists (
    select 1 from public.sop_event_log event
    where event.sop_id = sop.id
      and event.review_cycle = sop.review_cycle
      and event.event_type = 'review_sent'
  );
