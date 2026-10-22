-- Only future review submissions are considered. No existing SOP data is updated.
-- Internal predicate: the same strict gate is checked by both routing and field authorization.
create or replace function public.sop_unanimous_review_ready(p_sop text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
   select 1 from public.sops s
   where s.id=p_sop and s.deleted_at is null and s.status='in_review'
   and s.final_approval_requested_at is null and coalesce(s.content_hash,'') <> ''
   and exists(select 1 from public.sop_review_seats st where st.sop_id=s.id and st.rasic='responsible')
   and not exists (
     select 1 from public.sop_review_seats st
     where st.sop_id=s.id and st.rasic='responsible' and (
       st.signer_id is null or st.signer_id=s.created_by or st.signer_id=s.submitted_by
       or not public.is_sop_approver_candidate(st.department_id,st.signer_id)
       or not exists(select 1 from public.workspace_members wm where wm.workspace_id=s.workspace_id and wm.user_id=st.signer_id)
       or not exists(select 1 from public.department_members dm join public.departments d on d.id=dm.department_id
         where dm.user_id=st.signer_id and d.workspace_id=s.workspace_id and dm.pending_invite_at is null)
       or not exists(select 1 from public.sop_review_submissions r
         where r.sop_id=s.id and r.review_cycle=s.review_cycle and r.reviewer_id=st.signer_id
         and r.no_changes is true and r.content_hash=s.content_hash)
     )
   )
   and not exists(select 1 from public.sop_review_annotations a
     where a.sop_id=s.id and a.review_cycle=s.review_cycle and a.resolved_at is null)
 );
$$;
revoke all on function public.sop_unanimous_review_ready(text) from public,anon,authenticated;

create or replace function public.enforce_sop_final_approval_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
declare automatic boolean;
begin
  if new.final_approval_requested_at is not distinct from old.final_approval_requested_at
     and new.final_approval_content_hash is not distinct from old.final_approval_content_hash
     and new.final_approval_requested_by is not distinct from old.final_approval_requested_by then
    return new;
  end if;

  if new.final_approval_requested_at is null then
    if old.final_approval_requested_at is not null
       and auth.uid() is distinct from old.created_by
       and auth.uid() is distinct from old.submitted_by
       and not public.has_workspace_role(old.workspace_id, array['owner','admin']::public.workspace_role[]) then
      raise exception 'Only the author, submitter or an admin can reset final approval';
    end if;
    new.final_approval_content_hash := null;
    new.final_approval_requested_by := null;
    return new;
  end if;

  if old.status <> 'in_review' or new.status <> 'in_review' then
    raise exception 'Final approval can only begin after draft review';
  end if;
  automatic := pg_trigger_depth() = 2
    and public.sop_unanimous_review_ready(old.id)
    and exists (select 1 from public.sop_review_submissions r
      where r.sop_id=old.id and r.review_cycle=old.review_cycle and r.reviewer_id=auth.uid()
      and r.no_changes is true and r.content_hash=old.content_hash);
  if (not automatic and (auth.uid() is distinct from old.created_by and auth.uid() is distinct from old.submitted_by))
     or not public.can_read_sop(old.id) then
    raise exception 'Only the SOP author or submitter can request final approval';
  end if;
  if old.content_hash is null or old.content_hash = '' then
    raise exception 'Save the SOP before requesting final approval';
  end if;
  if not exists (select 1 from public.sop_review_seats st where st.sop_id=old.id and st.rasic='responsible') then
    raise exception 'Assign at least one required departmental approver before requesting final approval';
  end if;
  if exists (
    select 1 from public.sop_review_seats st where st.sop_id=old.id and st.rasic='responsible'
    and (st.signer_id is null or not exists (
      select 1 from public.sop_review_submissions r
      where r.sop_id=old.id and r.review_cycle=old.review_cycle and r.reviewer_id=st.signer_id
    ))
  ) then
    raise exception 'Every required departmental approver must respond before final approval';
  end if;
  if exists (select 1 from public.sop_review_annotations a
    where a.sop_id=old.id and a.review_cycle=old.review_cycle and a.resolved_at is null) then
    raise exception 'Address every returned remark before requesting final approval';
  end if;
  new.final_approval_requested_at := now();
  new.final_approval_content_hash := old.content_hash;
  new.final_approval_requested_by := case when automatic then null else auth.uid() end;
  return new;
end;
$$;

revoke all on function public.enforce_sop_final_approval_fields() from public,anon,authenticated;

create or replace function public.auto_route_sop_unanimous_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- submit_sop_review locks this same row before inserting. The trigger also locks
  -- for trusted inserts, serializing the last two reviewers and preventing duplicate routes.
  perform 1 from public.sops where id=new.sop_id for update;
  if auth.uid() is not null and auth.uid()=new.reviewer_id
     and new.no_changes is true and public.sop_unanimous_review_ready(new.sop_id) then
    update public.sops set final_approval_requested_at=now(),
      final_approval_content_hash=content_hash,final_approval_requested_by=null
    where id=new.sop_id;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_route_sop_unanimous_review() from public,anon,authenticated;
create trigger route_sop_after_review after insert on public.sop_review_submissions
for each row execute function public.auto_route_sop_unanimous_review();

create or replace function public.log_sop_final_approval_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.final_approval_requested_at is not null
     and (new.final_approval_requested_at is distinct from old.final_approval_requested_at
       or new.final_approval_content_hash is distinct from old.final_approval_content_hash) then
    perform public.append_sop_event(new.id,'final_approval_requested',
      jsonb_build_object('content_hash',new.final_approval_content_hash,
        'automatic',new.final_approval_requested_by is null,
        'reason',case when new.final_approval_requested_by is null
          then 'All required approvers returned no comments on the current content' else null end));
  end if;
  return new;
end;
$$;
revoke all on function public.log_sop_final_approval_request() from public,anon,authenticated;

-- Mark only FUTURE Quality handoffs from the automatic route. Historical
-- approved events remain untouched and cannot generate a new author email.
create or replace function public.log_sop_status_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform public.append_sop_event(new.id,
      case
        when old.status='draft' and new.status='in_review' then 'review_sent'
        when old.status='in_review' and new.status='draft' then 'review_recalled'
        else 'status_changed'
      end,
      jsonb_build_object('from_status',old.status,'to_status',new.status,'content_hash',new.content_hash,
        'automatic_review_routing',new.status='approved' and new.final_approval_requested_by is null
          and exists(select 1 from public.sop_event_log e where e.sop_id=new.id
            and e.review_cycle=new.review_cycle and e.event_type='final_approval_requested'
            and e.details->>'automatic'='true' and e.details->>'content_hash'=new.content_hash)));
  end if;
  return new;
end;
$$;
revoke all on function public.log_sop_status_event() from public,anon,authenticated;

alter table public.sop_notifications drop constraint sop_notifications_kind_check;
alter table public.sop_notifications add constraint sop_notifications_kind_check check(kind in (
 'review_requested','final_approval_requested','quality_release_requested','sent_back','review_complete',
 'released','seat_assigned','objection_raised','objection_resolved','remark_added','stall_escalated',
 'reviewer_not_joined','reviewer_reminded','automatically_routed','awaiting_quality'
));
