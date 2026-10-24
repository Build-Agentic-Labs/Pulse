-- PFMEA-only structural/metadata/verification commands. Existing records are not rewritten.
create or replace function public.commit_pfmea_document_command(
 p_product_id text, p_project_id text, p_document_id text, p_mutation_id uuid,
 p_base jsonb, p_document jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_fields jsonb; v_doc jsonb; v_next jsonb; v_row jsonb; v_before jsonb; v_cell jsonb;
 v_field text; v_index integer; v_threshold integer; v_score integer; v_seen text[] := '{}';
 v_now text; v_previous_writer text; v_receipts jsonb;
begin
 if auth.uid() is null or not public.has_project_access(p_project_id,'edit'::public.access_level) then
  raise exception using errcode='42501',message='PFMEA project edit access required.';
 end if;
 select custom_fields into v_fields from public.products where id=p_product_id and project_id=p_project_id for update;
 if not found then raise exception using errcode='42501',message='PFMEA product unavailable.'; end if;
 v_doc:=v_fields->'productPfmeaDocument';
 if p_mutation_id is null or (v_doc is not null and v_doc->>'id' is distinct from p_document_id) or p_document->>'id' is distinct from p_document_id
  or p_document->>'productId' is distinct from p_product_id or (v_doc is not null and p_base->>'id' is distinct from p_document_id) then raise exception 'PFMEA document identity changed.'; end if;
 if coalesce(v_doc->'commandReceipts','[]'::jsonb) ? p_mutation_id::text then return v_doc; end if;
 if (v_doc is null and p_base is not null and p_base<>'null'::jsonb) or (v_doc is not null and (v_doc - array['cellVersions','updatedAt','commandReceipts']) is distinct from (p_base - array['cellVersions','updatedAt','commandReceipts'])) then
  raise exception 'PFMEA document conflict. Retained changes were not applied.';
 end if;
 if jsonb_typeof(p_document->'rows') is distinct from 'array' or jsonb_array_length(p_document->'rows')>10000
  or jsonb_typeof(p_document->'settings') is distinct from 'object' then raise exception 'Invalid PFMEA document command.'; end if;
 if p_document#>'{settings,highRpnThreshold}' <> 'null'::jsonb then
  if (p_document#>>'{settings,highRpnThreshold}') !~ '^[0-9]+$' then raise exception 'Invalid RPN threshold.'; end if;
  v_threshold:=(p_document#>>'{settings,highRpnThreshold}')::integer;
  if v_threshold not between 1 and 1000 then raise exception 'Invalid RPN threshold.'; end if;
 end if;
 v_now:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 v_next:=p_document || jsonb_build_object('cellVersions',coalesce(v_doc->'cellVersions','{}'::jsonb),'updatedAt',v_now);
 for v_row,v_index in select value,(ordinality-1)::integer from jsonb_array_elements(p_document->'rows') with ordinality loop
  if jsonb_typeof(v_row) is distinct from 'object' or coalesce(v_row->>'id','')='' or v_row->>'id'=any(v_seen) then raise exception 'PFMEA rows require unique IDs.'; end if;
  v_seen:=array_append(v_seen,v_row->>'id');
  select value into v_before from jsonb_array_elements(v_doc->'rows') where value->>'id'=v_row->>'id';
  foreach v_field in array array['severity','occurrence','detection','resultOccurrence','resultDetection'] loop
   if v_row ? v_field and v_row->v_field <> 'null'::jsonb and (jsonb_typeof(v_row->v_field)<>'number' or (v_row->>v_field)!~'^(10|[1-9])$') then raise exception 'PFMEA scores must be whole numbers from 1 to 10.'; end if;
  end loop;
  if coalesce(v_row->>'targetDate','')<>'' then
   if (v_row->>'targetDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid PFMEA target date.'; end if;
   perform (v_row->>'targetDate')::date;
  end if;
  if v_row->>'actionStatus'='closed' and (v_before is null or v_row - array['updatedAt','archivedAt'] is distinct from v_before - array['updatedAt','archivedAt']) then
   foreach v_field in array array['failureMode','effect','cause','currentControls','detectionActivity','recommendedActions','actionOwner','targetDate','actionsTaken','verificationNotes'] loop
    if btrim(coalesce(v_row->>v_field,''))='' then raise exception 'Complete required PFMEA fields before verification: %',v_field; end if;
   end loop;
   foreach v_field in array array['severity','occurrence','detection','resultOccurrence','resultDetection'] loop
    if v_row->>v_field is null then raise exception 'Complete PFMEA scores before verification.'; end if;
   end loop;
   v_score:=(v_row->>'severity')::integer*(v_row->>'resultOccurrence')::integer*(v_row->>'resultDetection')::integer;
   if v_threshold is not null and v_score>=v_threshold then raise exception 'Final RPN must be below the threshold.'; end if;
   v_row:=v_row||jsonb_build_object('verifiedAt',v_now);
  elsif v_row->>'actionStatus' is distinct from 'closed' then v_row:=v_row-'verifiedAt';
  end if;
  if v_before is distinct from v_row then v_row:=v_row||jsonb_build_object('updatedAt',v_now); end if;
  v_next:=jsonb_set(v_next,array['rows',v_index::text],v_row);
  v_next:=jsonb_set(v_next,array['cellVersions',v_row->>'id'],coalesce(v_next#>array['cellVersions',v_row->>'id'],'{}'::jsonb));
  foreach v_field in array array['failureMode','effect','severity','cause','occurrence','currentControls','detection','detectionActivity','recommendedActions','actionOwner','actionOwnerId','targetDate','actionsTaken','resultOccurrence','resultDetection','verificationNotes','actionStatus','archivedAt','verifiedAt'] loop
   if coalesce(v_before->v_field,'null'::jsonb) is distinct from coalesce(v_row->v_field,'null'::jsonb) then
    v_cell:=v_next#>array['cellVersions',v_row->>'id',v_field];
    v_next:=jsonb_set(v_next,array['cellVersions',v_row->>'id',v_field],jsonb_build_object('version',coalesce((v_cell->>'version')::bigint,0)+1,'mutationId',p_mutation_id));
   end if;
  end loop;
 end loop;
 select coalesce(jsonb_agg(value),'[]'::jsonb) into v_receipts from (select value from jsonb_array_elements(coalesce(v_doc->'commandReceipts','[]'::jsonb)) with ordinality where ordinality>greatest(jsonb_array_length(coalesce(v_doc->'commandReceipts','[]'::jsonb))-99,0)) recent;
 v_next:=v_next||jsonb_build_object('commandReceipts',v_receipts||jsonb_build_array(p_mutation_id::text));
 v_previous_writer:=current_setting('pulse.pfmea_cell_writer',true);
 perform set_config('pulse.pfmea_cell_writer',p_product_id,true);
 update public.products set custom_fields=jsonb_set(v_fields,'{productPfmeaDocument}',v_next) where id=p_product_id and project_id=p_project_id;
 if not found then raise exception using errcode='42501',message='PFMEA save was not authorized.'; end if;
 perform set_config('pulse.pfmea_cell_writer',coalesce(v_previous_writer,''),true);
 return v_next;
end;
$$;
revoke all on function public.commit_pfmea_document_command(text,text,text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.commit_pfmea_document_command(text,text,text,uuid,jsonb,jsonb) to authenticated;
