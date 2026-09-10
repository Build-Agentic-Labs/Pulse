-- Author-nominated reviewers, 3/3: the ledger admits the author-side stall kind.
alter table public.sop_notifications drop constraint if exists sop_notifications_kind_check;
alter table public.sop_notifications add constraint sop_notifications_kind_check check (kind in (
  'review_requested',
  'final_approval_requested',
  'quality_release_requested',
  'sent_back',
  'review_complete',
  'released',
  'seat_assigned',
  'objection_raised',
  'objection_resolved',
  'remark_added',
  'stall_escalated',
  'reviewer_not_joined'
));
