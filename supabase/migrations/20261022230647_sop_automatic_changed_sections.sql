-- No backfill or SOP updates. Detection is read-only; confirmations record future results.
alter table public.sop_change_requests add column impact_files jsonb, add column quality_files jsonb;

create function public.sop_change_array(p_value jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)='array' then p_value else '[]'::jsonb end;
$$;
revoke all on function public.sop_change_array(jsonb) from public,anon,authenticated;

create function public.sop_change_procedure(p_value jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('description',coalesce(p_value->>'processFlowDescription',''),'image',coalesce(p_value->>'processFlowImageKey',''),
 'roles',public.sop_change_array(p_value->'roles'),'activities',coalesce((select jsonb_agg(jsonb_build_object(
 'id',item->>'id','step',coalesce(item->'step',to_jsonb(ord)),'shape',coalesce(item->>'shape','process'),
 'input',coalesce(item->>'input',''),'description',coalesce(item->>'description',''),'detail',coalesce(item->>'detail',''),'output',coalesce(item->>'output',''),
 'assignments',coalesce(item->'assignments','{}'),
 'branches',case when item->>'shape'='decision' then jsonb_build_object('yes',item#>'{decisionBranches,yesTargetActivityId}','no',item#>'{decisionBranches,noTargetActivityId}') else null end
 ) order by ord) from jsonb_array_elements(public.sop_change_array(p_value->'activities')) with ordinality as a(item,ord)),'[]'));
$$;
revoke all on function public.sop_change_procedure(jsonb) from public,anon,authenticated;

create function public.sop_change_files(p_sop text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'annex_id',annex_id,'path',storage_path,'name',original_name,'type',content_type,'size',size_bytes) order by id),'[]')
 from public.sop_annex_files where sop_id=p_sop;
$$;
revoke all on function public.sop_change_files(text) from public,anon,authenticated;

create function public.sop_detect_changed_sections(p_sop text,p_document jsonb default null) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare s public.sops; r public.sop_change_requests; base jsonb; draft jsonb; result text[]:='{}'; k text; label text; mode text;
 old_value jsonb; new_value jsonb; old_roster jsonb; new_roster jsonb; old_files jsonb; new_files jsonb; file_kind text;
begin
 select * into s from public.sops where id=p_sop and deleted_at is null;
 select * into r from public.sop_change_requests where sop_id=s.id and review_cycle=s.review_cycle and closed_at is null;
 if not found then raise exception 'No controlled change is open'; end if;
 select document into base from public.sop_revisions where id=r.base_revision_id;
 if not found then raise exception 'The released comparison document is unavailable'; end if;
 if jsonb_typeof(base) is distinct from 'object' then base:='{}'; end if;
 draft:=coalesce(p_document,s.document);
 if jsonb_typeof(draft) is distinct from 'object' then raise exception 'The draft document must be an object'; end if;
 if coalesce(base#>>'{meta,title}',s.title,'') is distinct from coalesce(draft#>>'{meta,title}',s.title,'') then result:=array_append(result,'Document details'); end if;
 for k,label,mode in select * from (values
 ('purpose','Purpose','text'),('scope','Scope','text'),('definitions','Definitions','array'),
 ('responsiblePersons','Responsible persons','array'),('references','References','array'),
 ('linkedSops','References','array'),('referenceDocs','References','array'),('measurements','Measurement','array'),
 ('procedure','Procedure','procedure'),('annexes','Annexes & forms','annex')) as fields(k,label,mode) loop
  if mode='text' then old_value:=to_jsonb(coalesce(base->>k,'')); new_value:=to_jsonb(coalesce(draft->>k,''));
  elsif mode='procedure' then old_value:=public.sop_change_procedure(base->k); new_value:=public.sop_change_procedure(draft->k);
  elsif mode='annex' then
   select coalesce(jsonb_agg(case when jsonb_typeof(item)='object' then item-'id' else item end order by ord),'[]') into old_value from jsonb_array_elements(public.sop_change_array(base->k)) with ordinality as a(item,ord);
   select coalesce(jsonb_agg(case when jsonb_typeof(item)='object' then item-'id' else item end order by ord),'[]') into new_value from jsonb_array_elements(public.sop_change_array(draft->k)) with ordinality as a(item,ord);
  else old_value:=public.sop_change_array(base->k); new_value:=public.sop_change_array(draft->k); end if;
  if old_value is distinct from new_value and not label=any(result) then result:=array_append(result,label); end if;
 end loop;
 -- Unknown custom body fields remain visible rather than being silently omitted.
 if (base-'{id,meta,purpose,scope,definitions,responsiblePersons,references,linkedSops,referenceDocs,measurements,procedure,annexes,approvals,changeHistory,source,status,createdAt,updatedAt}'::text[])
 is distinct from (draft-'{id,meta,purpose,scope,definitions,responsiblePersons,references,linkedSops,referenceDocs,measurements,procedure,annexes,approvals,changeHistory,source,status,createdAt,updatedAt}'::text[]) then result:=array_append(result,'Document content'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('department',item->>'department_id','signer',item->>'signer_id') order by item->>'department_id',item->>'signer_id'),'[]') into old_roster from jsonb_array_elements(r.original_roster) item;
 select coalesce(jsonb_agg(jsonb_build_object('department',department_id,'signer',signer_id) order by department_id,signer_id),'[]') into new_roster from public.sop_review_seats where sop_id=s.id and rasic='responsible';
 if old_roster is distinct from new_roster then result:=array_append(result,'Approvers'); end if;
 -- Each attachment is compared by identity, file content path, name, type and size.
 for file_kind in select unnest(array['References','Annexes & forms']) loop
  select coalesce(jsonb_agg(jsonb_build_object('id',f.file_id,'annex_id',f.metadata->>'annex_id','path',f.storage_path,'name',f.metadata->>'original_name','type',f.metadata->>'content_type','size',f.metadata->'size_bytes') order by f.file_id),'[]') into old_files
   from public.sop_release_files f where f.revision_id=r.base_revision_id and
    (exists(select 1 from jsonb_array_elements(public.sop_change_array(base->'referenceDocs')) ref where ref->>'id'=f.metadata->>'annex_id'))=(file_kind='References');
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'annex_id',f.annex_id,'path',f.storage_path,'name',f.original_name,'type',f.content_type,'size',f.size_bytes) order by f.id),'[]') into new_files
   from public.sop_annex_files f where f.sop_id=s.id and
    (exists(select 1 from jsonb_array_elements(public.sop_change_array(draft->'referenceDocs')) ref where ref->>'id'=f.annex_id))=(file_kind='References');
  if old_files is distinct from new_files and not file_kind=any(result) then result:=array_append(result,file_kind); end if;
 end loop;
 return result;
end;
$$;
revoke all on function public.sop_detect_changed_sections(text,jsonb) from public,anon,authenticated;

create function public.get_sop_detected_changes(p_sop text,p_document jsonb default null) returns text[]
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.can_read_sop(p_sop) then raise exception 'You cannot read this SOP'; end if;
 return public.sop_detect_changed_sections(p_sop,p_document);
end;
$$;
revoke all on function public.get_sop_detected_changes(text,jsonb) from public,anon;
grant execute on function public.get_sop_detected_changes(text,jsonb) to authenticated;

-- Keep the existing signature for rollout compatibility; the submitted label is never trusted.
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.confirm_sop_change_impact(text,text,integer,text,boolean,boolean)'::regprocedure);
 if position('declare s public.sops;' in d)=0 or position($old$ if p_impact_confirmed is distinct from true or coalesce(btrim(p_sections),'')='' then$old$ in d)=0 or position('impact_content_hash=s.content_hash,impact_roster=' in d)=0 then raise exception 'Impact confirmation definition changed'; end if;
 d:=replace(d,'declare s public.sops;','declare s public.sops; detected text[];');
 d:=replace(d,$old$ if p_impact_confirmed is distinct from true or coalesce(btrim(p_sections),'')='' then$old$,E' detected:=public.sop_detect_changed_sections(p_sop);\n if cardinality(detected)=0 then raise exception ''No changes detected. Edit the SOP or approvers before submitting''; end if;\n p_sections:=array_to_string(detected,''; '');\n if p_impact_confirmed is distinct from true then');
 d:=replace(d,'impact_content_hash=s.content_hash,impact_roster=', 'impact_files=public.sop_change_files(s.id),impact_content_hash=s.content_hash,impact_roster=');
 d:=replace(d,'Confirm the impact assessment and identify the sections affected','Confirm the change impact assessment');
 execute d;
 d:=pg_get_functiondef('public.confirm_sop_change_quality(text,text,integer,boolean,boolean,boolean)'::regprocedure);
 if position('set quality_confirmed_by=' in d)=0 then raise exception 'Quality confirmation definition changed'; end if;
 d:=replace(d,'set quality_confirmed_by=', 'set quality_files=public.sop_change_files(s.id),quality_confirmed_by='); execute d;
 d:=pg_get_functiondef('public.enforce_sop_change_confirmations()'::regprocedure);
 if position('or r.impact_roster is distinct from' in d)=0 or position('or r.quality_roster is distinct from' in d)=0 then raise exception 'Confirmation enforcement definition changed'; end if;
 d:=replace(d,'or r.impact_roster is distinct from', 'or r.impact_files is distinct from public.sop_change_files(old.id) or r.impact_roster is distinct from');
 d:=replace(d,'or r.quality_roster is distinct from', 'or r.quality_files is distinct from public.sop_change_files(old.id) or r.quality_roster is distinct from'); execute d;
end $patch$;
