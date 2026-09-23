-- Manual "Remind" from the SOP review-status panel.
--
-- RLS in one sentence: only the SOP's author may remind a seated reviewer who has
-- not returned their draft review this cycle, at most once per 24 hours per
-- reviewer — enforced here, not by the button.
--
-- A reminder is an sop_event_log row ('reviewer_reminded', details.reviewer_id),
-- delivered by the ordinary drain as its own notification kind. It deliberately
-- does NOT write an event_id-null ledger row: that key belongs to the automatic
-- 3-day ladder, and borrowing a slot would reset its timer and pull the manager
-- escalation forward.

-- 1) The ledger admits the new kind.
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
  'reviewer_not_joined',
  'reviewer_reminded'
));

-- 2) The cooldown lookup.
create index if not exists sop_event_log_reviewer_reminded_idx
  on public.sop_event_log (sop_id, (details ->> 'reviewer_id'), created_at desc)
  where event_type = 'reviewer_reminded';

-- 3) The only way to write a reminder. Returns when the next one is allowed.
create or replace function public.remind_sop_reviewer(p_sop text, p_reviewer uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cooldown constant interval := interval '24 hours';
  s record;
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'Sign in to send a reminder' using errcode = '42501';
  end if;

  -- Two clicks (or two tabs) racing past the cooldown check would both insert.
  perform pg_advisory_xact_lock(hashtextextended('sop_remind:' || p_sop || ':' || p_reviewer::text, 0));

  select id, created_by, status, review_cycle, content_hash,
         final_approval_requested_at, final_approval_content_hash, deleted_at
    into s
    from public.sops
   where id = p_sop;

  if not found or s.deleted_at is not null then
    raise exception 'SOP not found' using errcode = 'P0002';
  end if;
  if s.created_by is distinct from v_uid then
    raise exception 'Only the author of this SOP can send reminders' using errcode = '42501';
  end if;
  if s.status <> 'in_review'
     or (s.final_approval_requested_at is not null
         and s.final_approval_content_hash is not distinct from s.content_hash) then
    raise exception 'Reminders are only for SOPs in draft review' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.sop_review_seats st
     where st.sop_id = p_sop
       and st.signer_id = p_reviewer
       and st.rasic in ('responsible', 'accountable')
  ) then
    raise exception 'This person is not a reviewer on this SOP' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.sop_review_seats st
      join public.department_members dm
        on dm.department_id = st.department_id and dm.user_id = st.signer_id
     where st.sop_id = p_sop
       and st.signer_id = p_reviewer
       and dm.pending_invite_at is not null
  ) then
    raise exception 'This reviewer has not joined Pulse yet' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.sop_review_submissions sub
     where sub.sop_id = p_sop
       and sub.reviewer_id = p_reviewer
       and sub.review_cycle = s.review_cycle
  ) then
    raise exception 'This reviewer has already returned their review' using errcode = 'P0001';
  end if;

  select max(ev.created_at) into v_last
    from public.sop_event_log ev
   where ev.sop_id = p_sop
     and ev.event_type = 'reviewer_reminded'
     and ev.details ->> 'reviewer_id' = p_reviewer::text;

  if v_last is not null and v_last > now() - v_cooldown then
    -- DETAIL carries the next-allowed instant so the client can say when.
    raise exception 'reminder_cooldown'
      using errcode = 'P0001',
            detail = to_char((v_last + v_cooldown) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  perform public.append_sop_event(p_sop, 'reviewer_reminded', jsonb_build_object('reviewer_id', p_reviewer));
  return now() + v_cooldown;
end;
$$;

revoke all on function public.remind_sop_reviewer(text, uuid) from public, anon;
grant execute on function public.remind_sop_reviewer(text, uuid) to authenticated;
