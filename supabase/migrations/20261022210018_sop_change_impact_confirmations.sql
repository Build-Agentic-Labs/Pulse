-- Additive only: no existing SOPs or change requests are updated.
alter table public.sop_change_requests
 add column sections_affected text,
 add column impact_confirmed_by uuid references auth.users(id),
 add column impact_confirmed_at timestamptz,
 add column impact_content_hash text,
 add column impact_roster jsonb,
 add column process_owner_confirmed boolean not null default false,
 add column quality_confirmed_by uuid references auth.users(id),
 add column quality_confirmed_at timestamptz,
 add column quality_content_hash text,
 add column quality_roster jsonb;

create function public.sop_change_roster(p_sop text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('department',department_id,'user',signer_id,'role',rasic) order by department_id,signer_id,rasic),'[]')
 from public.sop_review_seats where sop_id=p_sop;
$$;
revoke all on function public.sop_change_roster(text) from public,anon,authenticated;

create function public.confirm_sop_change_impact(p_sop text,p_expected_hash text,p_expected_cycle integer,p_sections text,p_impact_confirmed boolean,p_process_owner_confirmed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s public.sops;
begin
 select * into s from public.sops where id=p_sop and deleted_at is null for update;
 if auth.uid() is null or s.created_by is distinct from auth.uid() or not public.can_read_sop(p_sop) then raise exception 'Only the SOP author can confirm this assessment'; end if;
 if s.status<>'draft' or s.content_hash is distinct from p_expected_hash or s.review_cycle is distinct from p_expected_cycle then raise exception 'The SOP changed. Reload and confirm again'; end if;
 if p_impact_confirmed is distinct from true or coalesce(btrim(p_sections),'')='' then raise exception 'Confirm the impact assessment and identify the sections affected'; end if;
 if s.change_significance='MINOR' and p_process_owner_confirmed is distinct from true then raise exception 'The process owner must confirm no operational impact for a minor revision'; end if;
 update public.sop_change_requests set sections_affected=btrim(p_sections),impact_confirmed_by=auth.uid(),impact_confirmed_at=now(),
 impact_content_hash=s.content_hash,impact_roster=public.sop_change_roster(s.id),process_owner_confirmed=(s.change_significance='MINOR' and p_process_owner_confirmed),
 quality_confirmed_by=null,quality_confirmed_at=null,quality_content_hash=null,quality_roster=null
 where sop_id=s.id and review_cycle=s.review_cycle and closed_at is null and released_at is null;
 if not found then raise exception 'No controlled change is open'; end if;
 perform public.append_sop_event(s.id,'change_impact_confirmed',jsonb_build_object('sections_affected',btrim(p_sections),'kind',s.change_significance,'content_hash',s.content_hash,'review_cycle',s.review_cycle,'process_owner_confirmed',s.change_significance='MINOR' and p_process_owner_confirmed));
end;
$$;
revoke all on function public.confirm_sop_change_impact(text,text,integer,text,boolean,boolean) from public,anon;
grant execute on function public.confirm_sop_change_impact(text,text,integer,text,boolean,boolean) to authenticated;

create function public.confirm_sop_change_quality(p_sop text,p_expected_hash text,p_expected_cycle integer,p_classification_confirmed boolean,p_document_verified boolean,p_history_verified boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s public.sops;
begin
 select * into s from public.sops where id=p_sop and deleted_at is null for update;
 if auth.uid() is null or not public.can_read_sop(p_sop) or not public.is_quality_approver(s.workspace_id)
 or s.created_by=auth.uid() or exists(select 1 from public.sop_review_seats st where st.sop_id=p_sop and st.signer_id=auth.uid()) then raise exception 'Only independent Quality acting as Document Control can confirm release'; end if;
 if s.status<>'approved' or s.content_hash is distinct from p_expected_hash or s.review_cycle is distinct from p_expected_cycle then raise exception 'The SOP changed. Reload and verify again'; end if;
 if p_classification_confirmed is distinct from true or p_document_verified is distinct from true or p_history_verified is distinct from true then raise exception 'Confirm the classification, document verification and change history'; end if;
 update public.sop_change_requests set quality_confirmed_by=auth.uid(),quality_confirmed_at=now(),quality_content_hash=s.content_hash,quality_roster=public.sop_change_roster(s.id)
 where sop_id=s.id and review_cycle=s.review_cycle and closed_at is null and released_at is null
 and impact_confirmed_by is not null and coalesce(btrim(sections_affected),'')<>'';
 if not found then raise exception 'The change assessment is missing'; end if;
 perform public.append_sop_event(s.id,'change_quality_confirmed',jsonb_build_object('kind',s.change_significance,'content_hash',s.content_hash,'review_cycle',s.review_cycle,'classification_confirmed',true,'document_verified',true,'history_verified',true,'capacity','Quality / Document Control'));
end;
$$;
revoke all on function public.confirm_sop_change_quality(text,text,integer,boolean,boolean,boolean) from public,anon;
grant execute on function public.confirm_sop_change_quality(text,text,integer,boolean,boolean,boolean) to authenticated;

create function public.enforce_sop_change_confirmations() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.sop_change_requests;
begin
 if old.status=new.status then return new; end if;
 select * into r from public.sop_change_requests where sop_id=old.id and review_cycle=old.review_cycle and closed_at is null;
 -- Existing first releases and SOPs outside the controlled-change path retain their workflow.
 if not found then return new; end if;
 if old.status='draft' and new.status='in_review' then
  if r.impact_confirmed_by is distinct from old.created_by or r.impact_content_hash is distinct from old.content_hash
   or r.impact_roster is distinct from public.sop_change_roster(old.id) or coalesce(btrim(r.sections_affected),'')=''
   or (r.kind='MINOR' and not r.process_owner_confirmed) then raise exception 'Confirm the current impact assessment, process ownership and sections affected before submission'; end if;
 end if;
 if old.status='approved' and new.status='effective' then
  if r.quality_confirmed_by is distinct from auth.uid() or r.quality_content_hash is distinct from old.content_hash
   or r.quality_roster is distinct from public.sop_change_roster(old.id) then raise exception 'Quality must confirm the current classification, document and change history before release'; end if;
 end if;
 return new;
end;
$$;
revoke all on function public.enforce_sop_change_confirmations() from public,anon,authenticated;
create trigger enforce_sop_change_confirmations before update of status on public.sops for each row execute function public.enforce_sop_change_confirmations();

-- Resolve the actual confirming actors; a returned request can have been opened by Quality.
do $patch$
declare d text; a text;
begin
 d:=pg_get_functiondef('public.list_sop_controlled_changes(text)'::regprocedure);
 -- Insert fields at the start of the existing object without changing read permissions.
 a:='jsonb_build_object(';
 if position(a in d)=0 then raise exception 'Controlled history definition changed'; end if;
 d:=overlay(d placing 'jsonb_build_object(''impact_confirmed_by_name'',(select p.full_name from public.profiles p where p.id=r.impact_confirmed_by),''quality_confirmed_by_name'',(select p.full_name from public.profiles p where p.id=r.quality_confirmed_by),' from position(a in d) for length(a));
 execute d;
end $patch$;
