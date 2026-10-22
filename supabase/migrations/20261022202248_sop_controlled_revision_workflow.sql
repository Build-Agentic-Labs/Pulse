-- No existing SOP rows are updated. New change requests are created only on future effective -> draft transitions.
create table public.sop_change_requests (
 sop_id text references public.sops(id) on delete cascade,
 review_cycle integer not null, base_revision_id text not null references public.sop_revisions(id),
 kind text not null check(kind in ('MINOR','MAJOR')),
 from_version text not null,to_version text not null,reason text not null,
 requested_by uuid not null references auth.users(id),requested_at timestamptz not null default now(),
 original_roster jsonb not null, released_at timestamptz,released_by uuid references auth.users(id),
 release_roster jsonb, approval_handling jsonb, closed_at timestamptz, closed_reason text,
 primary key(sop_id,review_cycle)
);
create table public.sop_approval_carry_forwards (
 sop_id text not null, review_cycle integer not null,
 department_id text not null,signer_id uuid not null references auth.users(id),
 source_signature_id text not null references public.sop_signatures(id),
 source_version text not null,primary key(sop_id,review_cycle,department_id,signer_id),
 foreign key(sop_id,review_cycle) references public.sop_change_requests(sop_id,review_cycle)
);
alter table public.sop_change_requests enable row level security;
alter table public.sop_approval_carry_forwards enable row level security;
revoke all on public.sop_change_requests,public.sop_approval_carry_forwards from anon,authenticated;
grant select on public.sop_change_requests,public.sop_approval_carry_forwards to authenticated;
create policy change_requests_read on public.sop_change_requests for select to authenticated using(public.can_read_sop(sop_id));
create policy carried_approvals_read on public.sop_approval_carry_forwards for select to authenticated using(public.can_read_sop(sop_id));

create function public.sop_seat_approval_carried(p_sop text,p_department text,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sops s
 join public.sop_approval_carry_forwards c on c.sop_id=s.id and c.review_cycle=s.review_cycle
 join public.sop_signatures g on g.id=c.source_signature_id
 join public.sop_review_seats st on st.sop_id=s.id and st.department_id=c.department_id and st.signer_id=c.signer_id
 where s.id=p_sop and s.change_significance='MINOR' and c.department_id=p_department and c.signer_id=p_user
 and st.rasic='responsible' and g.meaning='dept_approval' and g.signer_id=p_user and g.seat_department_id=p_department
 and public.is_sop_approver_candidate(p_department,p_user)
 and exists(select 1 from public.workspace_members wm where wm.workspace_id=s.workspace_id and wm.user_id=p_user)
 and exists(select 1 from public.department_members dm join public.departments d on d.id=dm.department_id
   where dm.user_id=p_user and d.workspace_id=s.workspace_id and dm.pending_invite_at is null));
$$;
revoke all on function public.sop_seat_approval_carried(text,text,uuid) from public,anon,authenticated;

create table public.sop_release_files (
 revision_id text not null references public.sop_revisions(id), file_id text not null,
 sop_id text not null references public.sops(id), storage_path text not null, metadata jsonb not null,
 primary key(revision_id,file_id)
);
alter table public.sop_release_files enable row level security;
revoke all on public.sop_release_files from public,anon,authenticated;
create function public.sop_file_is_released(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sop_release_files f join public.sops s on s.id=f.sop_id
 where f.storage_path=p_path and public.can_read_sop(s.id));
$$;
revoke all on function public.sop_file_is_released(text) from public,anon;
grant execute on function public.sop_file_is_released(text) to authenticated;
create function public.sop_released_file_readable(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sop_release_files f join public.sops s on s.id=f.sop_id
 where f.storage_path=p_path and f.revision_id=s.effective_revision_id and s.deleted_at is null and s.status<>'obsolete'
 and exists(select 1 from public.workspace_members wm where wm.workspace_id=s.workspace_id and wm.user_id=auth.uid()));
$$;
revoke all on function public.sop_released_file_readable(text) from public,anon;
grant execute on function public.sop_released_file_readable(text) to authenticated;
create policy released_annex_reads on storage.objects for select to authenticated
 using(bucket_id='sop-annexes' and public.sop_released_file_readable(name));
create policy preserve_released_annexes on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'sop-annexes' or not public.sop_file_is_released(name));
create policy preserve_released_annex_updates on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'sop-annexes' or not public.sop_file_is_released(name));

create function public.capture_sop_controlled_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='effective' and new.status='draft' then
  if old.effective_revision_id is null then raise exception 'Released snapshot is missing; contact Quality before starting a change'; end if;
  insert into public.sop_release_files(revision_id,file_id,sop_id,storage_path,metadata)
   select old.effective_revision_id,f.id,old.id,f.storage_path,to_jsonb(f) from public.sop_annex_files f where f.sop_id=old.id
   on conflict do nothing;
  insert into public.sop_change_requests(sop_id,review_cycle,base_revision_id,kind,from_version,to_version,reason,requested_by,original_roster)
  values(new.id,new.review_cycle,old.effective_revision_id,new.change_significance,old.version,new.version,new.revision_reason,auth.uid(),
   coalesce((select jsonb_agg(jsonb_build_object('department_id',st.department_id,'signer_id',st.signer_id)) from public.sop_review_seats st where st.sop_id=new.id and st.rasic='responsible'),'[]'));
  if new.change_significance='MINOR' then
   insert into public.sop_approval_carry_forwards(sop_id,review_cycle,department_id,signer_id,source_signature_id,source_version)
   select new.id,new.review_cycle,st.department_id,st.signer_id,coalesce(g.id,c.source_signature_id),
     case when g.id is not null then old.version else c.source_version end
   from public.sop_review_seats st
   left join public.sop_signatures g on g.sop_id=old.id and g.review_cycle=old.review_cycle
     and g.signed_content_hash=old.content_hash and g.meaning='dept_approval' and g.signer_id=st.signer_id and g.seat_department_id=st.department_id
   left join public.sop_approval_carry_forwards c on c.sop_id=old.id and c.review_cycle=old.review_cycle and c.department_id=st.department_id and c.signer_id=st.signer_id
   where st.sop_id=new.id and st.rasic='responsible' and coalesce(g.id,c.source_signature_id) is not null;
  end if;
  perform public.append_sop_event(new.id,'controlled_change_started',jsonb_build_object('kind',new.change_significance,
    'from_version',old.version,'to_version',new.version,'reason',new.revision_reason,'status','Pending release'));
 elsif old.status='approved' and new.status='draft' and old.change_significance='MINOR' then
  update public.sop_change_requests set closed_at=now(),closed_reason=new.rejected_reason
   where sop_id=old.id and review_cycle=old.review_cycle;
  insert into public.sop_change_requests(sop_id,review_cycle,base_revision_id,kind,from_version,to_version,reason,requested_by,original_roster)
   select new.id,new.review_cycle,r.base_revision_id,new.change_significance,r.from_version,new.version,new.revision_reason,auth.uid(),r.original_roster
   from public.sop_change_requests r where r.sop_id=old.id and r.review_cycle=old.review_cycle;
  if new.change_significance='MINOR' then
   insert into public.sop_approval_carry_forwards select sop_id,new.review_cycle,department_id,signer_id,source_signature_id,source_version
   from public.sop_approval_carry_forwards where sop_id=old.id and review_cycle=old.review_cycle;
  end if;
  perform public.append_sop_event(new.id,'controlled_change_returned',jsonb_build_object('reason',new.rejected_reason,
    'kind',new.change_significance,'from_version',old.version,'to_version',new.version));
 elsif old.status='approved' and new.status='effective' then
  insert into public.sop_release_files(revision_id,file_id,sop_id,storage_path,metadata)
   select new.effective_revision_id,f.id,new.id,f.storage_path,to_jsonb(f) from public.sop_annex_files f where f.sop_id=new.id
   on conflict do nothing;
  update public.sop_change_requests r set released_at=now(),released_by=auth.uid(),
   release_roster=coalesce((select jsonb_agg(jsonb_build_object('department_id',st.department_id,'signer_id',st.signer_id))
    from public.sop_review_seats st where st.sop_id=new.id and st.rasic='responsible'),'[]'),
   approval_handling=coalesce((select jsonb_agg(jsonb_build_object('department_id',st.department_id,'signer_id',st.signer_id,
     'carried_forward',public.sop_seat_approval_carried(new.id,st.department_id,st.signer_id)))
    from public.sop_review_seats st where st.sop_id=new.id and st.rasic='responsible'),'[]')
   where r.sop_id=new.id and r.review_cycle=new.review_cycle;
 end if;
 return new;
end;
$$;
revoke all on function public.capture_sop_controlled_change() from public,anon,authenticated;
create trigger capture_sop_controlled_change after update of status on public.sops for each row execute function public.capture_sop_controlled_change();

-- Extend the existing gates, retaining their membership, hash, authorship and Quality separation checks.
do $patch$
declare d text; anchor text;
begin
 d:=pg_get_functiondef('public.sop_quorum_met(text)'::regprocedure);
 anchor:='and g.review_cycle = s.review_cycle)))';
 if position(anchor in d)=0 then raise exception 'Quorum guard changed'; end if;
 d:=replace(d,anchor,'and g.review_cycle = s.review_cycle) and not public.sop_seat_approval_carried(st.sop_id,st.department_id,st.signer_id)))');
 execute d;
 -- Both the request RPC and column-level gate must accept preserved approvals as completion,
 -- without inserting fabricated review responses or signatures.
 d:=pg_get_functiondef('public.enforce_sop_final_approval_fields()'::regprocedure);
 anchor:='and (st.signer_id is null or not exists (';
 if position(anchor in d)=0 then raise exception 'Final approval gate changed'; end if;
 d:=replace(d,anchor,'and not public.sop_seat_approval_carried(old.id,st.department_id,st.signer_id) '||anchor);
 execute d;
 d:=pg_get_functiondef('public.request_sop_final_approval(text)'::regprocedure);
 anchor:='and not exists (';
 -- Apply below with the exact submission guard found in the current function.
 anchor:='and (';
 -- Only exempt the missing-response check, never the required-roster existence check.
 anchor:=E'and seat.rasic = ''responsible''
      and (';
 if position(anchor in d)=0 then raise exception 'Request response guard changed'; end if;
 d:=replace(d,anchor,E'and seat.rasic = ''responsible''
      and not public.sop_seat_approval_carried(p_sop,seat.department_id,seat.signer_id)
      and (');
 execute d;
 d:=pg_get_functiondef('public.sop_unanimous_review_ready(text)'::regprocedure);
 anchor:='or not exists(select 1 from public.sop_review_submissions r';
 if position(anchor in d)=0 then raise exception 'Unanimous review gate changed'; end if;
 d:=replace(d,anchor,'or (not public.sop_seat_approval_carried(s.id,st.department_id,st.signer_id) and not exists(select 1 from public.sop_review_submissions r');
 d:=replace(d,'and r.no_changes is true and r.content_hash=s.content_hash)','and r.no_changes is true and r.content_hash=s.content_hash))');
 execute d;
 d:=pg_get_functiondef('public.enforce_sop_transition()'::regprocedure);
 d:=replace(d,'if old.status = ''effective'' then','if old.status = ''effective'' or old.effective_revision_id is not null then');
 d:=replace(d,'when ''approved->obsolete'', ''draft->obsolete'' then',
 'when ''approved->obsolete'', ''draft->obsolete'' then if old.effective_revision_id is not null then raise exception ''A working change cannot retire the still-effective release''; end if;');

 anchor:='new.review_cycle := old.review_cycle + 1;';
 if position(anchor in d)=0 then raise exception 'Controlled cycle guard changed'; end if;
 d:=replace(d,anchor,anchor||' new.final_approval_requested_at:=null; new.final_approval_content_hash:=null; new.final_approval_requested_by:=null;');

 anchor:='if not test_self and auth.uid() is not distinct from old.submitted_by then';
 if position(anchor in d)=0 then raise exception 'Approval transition guard changed'; end if;
 d:=replace(d,anchor,'if not test_self and auth.uid() is not distinct from old.submitted_by and not (old.change_significance=''MINOR'' and old.final_approval_requested_at is not null and old.final_approval_content_hash=old.content_hash and public.sop_quorum_met(old.id)) then');
 anchor:='when ''approved->effective'' then';
 d:=replace(d,anchor,anchor||E'
      if old.change_significance=''MINOR'' and not public.sop_quorum_met(old.id) then raise exception ''A preserved approver is no longer eligible; return this revision to its author''; end if;');
 -- A Quality rejection reopens only a controlled revision; the original release remains in force.
 anchor:='when ''in_review->draft'' then';
 d:=replace(d,anchor,E'when ''approved->draft'' then
      if old.change_significance is distinct from ''MINOR'' or not public.is_quality_approver(old.workspace_id) or auth.uid()=old.created_by or exists(select 1 from public.sop_review_seats st where st.sop_id=old.id and st.signer_id=auth.uid()) then raise exception ''Only independent Quality can return a minor revision''; end if;
      if v_revision_reason is null or btrim(v_revision_reason)='''' then raise exception ''Explain why this revision is being returned''; end if;
      new.rejected_reason:=btrim(v_revision_reason); new.rejected_by:=auth.uid(); new.submitted_by:=null; new.approved_at:=null; new.approved_by:=null; new.review_cycle:=old.review_cycle+1; new.final_approval_requested_at:=null; new.final_approval_content_hash:=null; new.final_approval_requested_by:=null;
      if v_change_significance=''MAJOR'' then new.change_significance:=''MAJOR''; new.major_version:=old.major_version+1; new.minor_version:=0; new.version:=new.major_version::text||''.0''; new.requires_retraining:=true; end if;
      new.revision_reason:=old.revision_reason||'' · Quality returned: ''||btrim(v_revision_reason);
      new.document:=jsonb_set(new.document,''{changeHistory}'',(case when jsonb_array_length(v_history)>0 then v_history-(jsonb_array_length(v_history)-1) else ''[]''::jsonb end)||jsonb_build_array(jsonb_build_object(''version'',new.version,''changes'',new.revision_reason,''createdByName'',''Quality review'',''createdByPosition'',''Quality'',''createdByDate'',current_date::text)),true);
      new.content_hash:=public.sop_doc_hash(new.document);
    '||anchor);
 execute d;
end $patch$;

-- Author submits through the original authorship + review workflow. Only a MINOR change
-- whose entire roster is preserved goes directly to Quality.
create function public.submit_sop_controlled_draft(p_sop text,p_expected_hash text,p_expected_cycle integer)
returns void language plpgsql security definer set search_path='' as $$
declare s public.sops;
begin
 select * into s from public.sops where id=p_sop and deleted_at is null for update;
 if auth.uid() is null or auth.uid() is distinct from s.created_by then raise exception 'Only the SOP author can submit this change'; end if;
 if s.status<>'draft' or s.content_hash is distinct from p_expected_hash or s.review_cycle is distinct from p_expected_cycle then raise exception 'The SOP changed. Reload before submitting'; end if;
 if not exists(select 1 from public.sop_change_requests r where r.sop_id=s.id and r.review_cycle=s.review_cycle) then raise exception 'No controlled change is open'; end if;
 perform public.sign_sop(p_sop,'authorship',null,null,null,p_expected_hash,p_expected_cycle);
 update public.sops set status='in_review' where id=p_sop;
 if s.change_significance='MINOR' and not exists(select 1 from public.sop_review_seats st
   where st.sop_id=p_sop and st.rasic='responsible' and not public.sop_seat_approval_carried(p_sop,st.department_id,st.signer_id)
   and not exists(select 1 from public.sop_review_submissions r where r.sop_id=p_sop and r.review_cycle=s.review_cycle and r.reviewer_id=st.signer_id))
   and not exists(select 1 from public.sop_review_annotations a where a.sop_id=p_sop and a.review_cycle=s.review_cycle and a.resolved_at is null) then
  perform public.request_sop_final_approval(p_sop);
  if public.sop_quorum_met(p_sop) then update public.sops set status='approved' where id=p_sop; end if;
 end if;
end;
$$;
revoke all on function public.submit_sop_controlled_draft(text,text,integer) from public,anon;
grant execute on function public.submit_sop_controlled_draft(text,text,integer) to authenticated;

create function public.return_sop_controlled_change(p_sop text,p_reason text,p_expected_hash text,p_require_full_review boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s public.sops;
begin
 select * into s from public.sops where id=p_sop and deleted_at is null for update;
 if auth.uid() is null or s.id is null or s.status<>'approved' or s.change_significance is distinct from 'MINOR'
  or not public.is_quality_approver(s.workspace_id) or auth.uid()=s.created_by
  or exists(select 1 from public.sop_review_seats st where st.sop_id=p_sop and st.signer_id=auth.uid()) then
  raise exception 'Only independent Quality can return a minor revision';
 end if;
 if p_expected_hash is null or s.content_hash is distinct from p_expected_hash then raise exception 'The SOP changed. Reload before returning'; end if;
 if coalesce(btrim(p_reason),'')='' then raise exception 'Explain why the revision needs changes'; end if;
 update public.sops set status='draft',revision_reason=btrim(p_reason),
  change_significance=case when p_require_full_review then 'MAJOR' else 'MINOR' end where id=p_sop;
end;
$$;
revoke all on function public.return_sop_controlled_change(text,text,text,boolean) from public,anon;
grant execute on function public.return_sop_controlled_change(text,text,text,boolean) to authenticated;

create function public.list_sop_carried_approvals(p_sops text[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('carried_to_cycle',c.review_cycle,'source_version',c.source_version,
   'carried_to_hash',s.content_hash)),'[]') from public.sop_approval_carry_forwards c
 join public.sops s on s.id=c.sop_id and s.review_cycle=c.review_cycle
 join public.sop_signatures g on g.id=c.source_signature_id
 where s.id=any(p_sops) and (auth.jwt()->>'role'='service_role' or public.can_read_sop(s.id))
 and public.sop_seat_approval_carried(c.sop_id,c.department_id,c.signer_id)
 and not exists(select 1 from public.sop_signatures fresh where fresh.sop_id=s.id and fresh.review_cycle=s.review_cycle
   and fresh.signed_content_hash=s.content_hash and fresh.meaning='dept_approval' and fresh.signer_id=c.signer_id and fresh.seat_department_id=c.department_id);
$$;
revoke all on function public.list_sop_carried_approvals(text[]) from public,anon;
grant execute on function public.list_sop_carried_approvals(text[]) to authenticated,service_role;

create function public.list_sop_controlled_changes(p_sop text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
  'requested_by_name',coalesce((select p.full_name from public.profiles p where p.id=r.requested_by),'SOP author'),
  'released_by_name',coalesce((select p.full_name from public.profiles p where p.id=r.released_by),'Quality approver'),
  'original_roster',(select jsonb_agg(jsonb_build_object('userId',item->>'signer_id','departmentId',item->>'department_id',
    'name',coalesce(p.full_name,'Assigned approver'),'department',d.name)) from jsonb_array_elements(r.original_roster) item
    left join public.profiles p on p.id::text=item->>'signer_id' left join public.departments d on d.id=item->>'department_id'),
  'release_roster',(select jsonb_agg(jsonb_build_object('userId',item->>'signer_id','departmentId',item->>'department_id',
    'name',coalesce(p.full_name,'Assigned approver'),'department',d.name)) from jsonb_array_elements(coalesce(r.release_roster,case when r.released_at is null and r.closed_at is null then (select jsonb_agg(jsonb_build_object('signer_id',st.signer_id,'department_id',st.department_id)) from public.sop_review_seats st where st.sop_id=r.sop_id) else null end)) item
    left join public.profiles p on p.id::text=item->>'signer_id' left join public.departments d on d.id=item->>'department_id'),
  'approval_handling',(select jsonb_agg(jsonb_build_object('name',coalesce(p.full_name,'Assigned approver'),'department',d.name,
    'carriedForward',(item->>'carried_forward')::boolean,'sourceVersion',c.source_version))
    from jsonb_array_elements(coalesce(r.approval_handling,case when r.released_at is null and r.closed_at is null then (select jsonb_agg(jsonb_build_object('signer_id',st.signer_id,'department_id',st.department_id,'carried_forward',public.sop_seat_approval_carried(r.sop_id,st.department_id,st.signer_id))) from public.sop_review_seats st where st.sop_id=r.sop_id) else null end)) item
    left join public.profiles p on p.id::text=item->>'signer_id' left join public.departments d on d.id=item->>'department_id'
    left join public.sop_approval_carry_forwards c on c.sop_id=r.sop_id and c.review_cycle=r.review_cycle
     and c.signer_id::text=item->>'signer_id' and c.department_id=item->>'department_id')
 ) order by r.review_cycle desc),'[]') from public.sop_change_requests r where r.sop_id=p_sop and (public.can_read_sop(p_sop)
 or (r.released_at is not null and exists(select 1 from public.sops s join public.workspace_members wm on wm.workspace_id=s.workspace_id
   where s.id=p_sop and s.deleted_at is null and wm.user_id=auth.uid())));
$$;
revoke all on function public.list_sop_controlled_changes(text) from public,anon;
grant execute on function public.list_sop_controlled_changes(text) to authenticated;


alter table public.sop_revisions add column release_review_cycle integer;
alter table public.sop_revisions add column approval_snapshot jsonb;
create function public.capture_sop_release_approvals()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.sops;
begin
 select * into s from public.sops where id=new.sop_id;
 new.release_review_cycle:=s.review_cycle;
 select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('carried_from_version',c.source_version,'department_name',(select name from public.departments d where d.id=g.seat_department_id))),'[]')
 into new.approval_snapshot
 from public.sop_signatures g
 left join public.sop_approval_carry_forwards c on c.sop_id=s.id and c.review_cycle=s.review_cycle and c.source_signature_id=g.id
 where g.sop_id=s.id and g.meaning in ('dept_approval','quality_approval')
 and ((g.review_cycle=s.review_cycle and g.signed_content_hash=s.content_hash)
   or (c.source_signature_id is not null and public.sop_seat_approval_carried(s.id,c.department_id,c.signer_id)
   and not exists(select 1 from public.sop_signatures fresh where fresh.sop_id=s.id and fresh.review_cycle=s.review_cycle
     and fresh.signed_content_hash=s.content_hash and fresh.meaning='dept_approval' and fresh.signer_id=c.signer_id and fresh.seat_department_id=c.department_id)));
 return new;
end;
$$;
revoke all on function public.capture_sop_release_approvals() from public,anon,authenticated;
create trigger capture_sop_release_approvals before insert on public.sop_revisions for each row execute function public.capture_sop_release_approvals();

-- The public release endpoint never accepts a revision id: retired releases cannot be downloaded through it.
create function public.get_sop_effective_release(p_sop text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('document',r.document,'version',r.version_label,'released_at',r.created_at,
  'sop_number',s.sop_number,'sop_id',s.id,'title',s.title,
  'author_name',(select full_name from public.profiles p where p.id=s.created_by),
  'files',coalesce((select jsonb_agg(f.metadata) from public.sop_release_files f where f.revision_id=r.id),
    (select jsonb_agg(to_jsonb(f)) from public.sop_annex_files f where f.sop_id=s.id),'[]'),
  'approvals',coalesce(r.approval_snapshot,(select jsonb_agg(to_jsonb(g)||jsonb_build_object('department_name',(select name from public.departments d where d.id=g.seat_department_id))) from public.sop_signatures g
    where g.sop_id=s.id and g.signed_content_hash=r.content_hash and g.meaning in ('dept_approval','quality_approval')
    and g.review_cycle=coalesce((select min(c.review_cycle)-1 from public.sop_change_requests c where c.base_revision_id=r.id),s.review_cycle))))
 from public.sops s join public.sop_revisions r on r.id=s.effective_revision_id
 where s.id=p_sop and s.deleted_at is null and s.status<>'obsolete'
 and exists(select 1 from public.workspace_members wm where wm.workspace_id=s.workspace_id and wm.user_id=auth.uid());
$$;
revoke all on function public.get_sop_effective_release(text) from public,anon;
grant execute on function public.get_sop_effective_release(text) to authenticated;

create function public.list_sop_effective_library(p_workspace text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'sopNumber',s.sop_number,
 'title',coalesce(r.document->'meta'->>'title',s.title),'version',r.version_label,'status','effective',
 'updatedAt',r.created_at,'departmentId',s.department_id,'createdBy',s.created_by,
 'hasWorkingDraft',s.status<>'effective','workingVersion',s.version,'supportsControlledChanges',true)),'[]')
 from public.sops s join public.sop_revisions r on r.id=s.effective_revision_id
 where s.workspace_id=p_workspace and s.deleted_at is null and s.status<>'obsolete'
 and exists(select 1 from public.workspace_members wm where wm.workspace_id=s.workspace_id and wm.user_id=auth.uid());
$$;
revoke all on function public.list_sop_effective_library(text) from public,anon;
grant execute on function public.list_sop_effective_library(text) to authenticated;

do $$ declare d text; a text;
begin
 d:=pg_get_functiondef('public.log_sop_status_event()'::regprocedure);
 a:='new.final_approval_requested_by is null';
 if position(a in d)=0 then raise exception 'Quality event provenance guard changed'; end if;
 d:=replace(d,a,'(new.final_approval_requested_by is null or new.change_significance=''MINOR'')');
 -- Minor revisions are recorded in the controlled request table, not necessarily an automatic signature event.
 d:=replace(d,'and exists(select 1 from public.sop_event_log e where e.sop_id=new.id',
 'and (exists(select 1 from public.sop_event_log e where e.sop_id=new.id');
 d:=replace(d,'e.details->>''content_hash''=new.content_hash)', 'e.details->>''content_hash''=new.content_hash) or exists(select 1 from public.sop_change_requests r where r.sop_id=new.id and r.review_cycle=new.review_cycle and r.kind=''MINOR''))');
 execute d;
end $$;

-- Historical releases expose metadata only. The controlled release RPC serves the current
-- effective document, and does not accept an arbitrary historical revision identifier.
revoke select on public.sop_revisions from public,anon,authenticated;
grant select(id,sop_id,workspace_id,version_label,content_hash,created_by,created_at) on public.sop_revisions to authenticated;
create policy restrict_retired_annex_downloads on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'sop-annexes' or not public.sop_file_is_released(name)
   or public.sop_released_file_readable(name)
   or exists(select 1 from public.sop_annex_files f where f.storage_path=name and public.can_read_sop(f.sop_id)));
