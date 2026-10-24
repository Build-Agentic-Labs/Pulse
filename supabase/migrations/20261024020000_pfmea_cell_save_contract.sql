-- Phase 1: opt-in cell save contract. No backfill and no changes to current records.
-- SECURITY INVOKER retains product RLS; explicit project edit access also gates entry.
create or replace function public.patch_pfmea_cells(
  p_product_id text, p_project_id text, p_document_id text,
  p_mutation_id uuid, p_changes jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_fields jsonb; v_doc jsonb; v_change jsonb; v_row jsonb;
  v_index integer; v_row_id text; v_field text; v_version bigint;
  v_cell jsonb; v_value jsonb; v_previous jsonb; v_current jsonb;
  v_seen text[] := '{}'; v_key text; v_touched integer[] := '{}'; v_reverify integer[] := '{}';
  v_now text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_previous_writer text;
begin
  if auth.uid() is null or not public.has_project_access(p_project_id, 'edit'::public.access_level) then
    raise exception using errcode = '42501', message = 'PFMEA project edit access required.';
  end if;
  if p_mutation_id is null or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 1000 then
    raise exception 'Provide a mutation ID and between 1 and 1000 cell changes.';
  end if;
  select custom_fields into v_fields from public.products
    where id = p_product_id and project_id = p_project_id for update;
  if not found then raise exception using errcode = '42501', message = 'PFMEA product unavailable.'; end if;
  v_now := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_doc := v_fields -> 'productPfmeaDocument';
  if v_doc ->> 'id' is distinct from p_document_id or v_doc ->> 'productId' is distinct from p_product_id
    or jsonb_typeof(v_doc -> 'rows') is distinct from 'array' then
    raise exception 'PFMEA document identity changed.';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_row_id := v_change ->> 'rowId'; v_field := v_change ->> 'field';
    if v_row_id is null or v_field is null or not (v_change ? 'value') or not (v_change ? 'previous')
      or jsonb_typeof(v_change -> 'expectedVersion') is distinct from 'number'
      or (v_change ->> 'expectedVersion') !~ '^[0-9]+$' then raise exception 'Malformed PFMEA cell change.'; end if;
    if v_field <> all(array['failureMode','effect','severity','cause','occurrence','currentControls','detection',
      'detectionActivity','recommendedActions','actionOwner','actionOwnerId','targetDate','actionsTaken',
      'resultOccurrence','resultDetection','verificationNotes','actionStatus','archivedAt']) then
      raise exception 'This PFMEA field requires a separate command.';
    end if;
    v_key := jsonb_build_array(v_row_id, v_field)::text;
    if v_key = any(v_seen) then raise exception 'Duplicate cell in PFMEA batch.'; end if;
    v_seen := array_append(v_seen, v_key);
    select (ordinality - 1)::integer, value into v_index, v_row
      from jsonb_array_elements(v_doc -> 'rows') with ordinality where value ->> 'id' = v_row_id;
    if not found then raise exception 'PFMEA row unavailable.'; end if;
    v_value := v_change -> 'value'; v_previous := v_change -> 'previous';
    if v_field = any(array['severity','occurrence','detection','resultOccurrence','resultDetection']) then
      if v_value <> 'null'::jsonb and (jsonb_typeof(v_value) <> 'number' or v_value::text !~ '^(10|[1-9])$') then
        raise exception 'PFMEA scores must be whole numbers from 1 to 10.';
      end if;
    elsif v_value <> 'null'::jsonb and jsonb_typeof(v_value) <> 'string' then raise exception 'PFMEA text must be a string.';
    end if;
    if v_field = 'actionStatus' and v_value <> 'null'::jsonb and (v_change ->> 'value') <> all(array['open','in_progress','awaiting_verification']) then
      raise exception 'Verification requires a separate PFMEA command.';
    end if;
    if v_field = 'targetDate' and v_value <> 'null'::jsonb and v_value <> '""'::jsonb then
      if (v_change ->> 'value') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Target date must be YYYY-MM-DD.'; end if;
      perform (v_change ->> 'value')::date;
    end if;
    v_cell := v_doc #> array['cellVersions', v_row_id, v_field];
    v_version := coalesce((v_cell ->> 'version')::bigint, 0);
    v_current := coalesce(v_row -> v_field, 'null'::jsonb);
    -- Exact retries succeed only for the same mutation, not merely the same value.
    if v_cell ->> 'mutationId' = p_mutation_id::text and v_current = v_value then continue; end if;
    if v_version <> (v_change ->> 'expectedVersion')::bigint or v_current is distinct from v_previous then
      raise exception using errcode = 'P0001', message = 'PFMEA cell conflict. Your pending edit was not applied.',
        detail = jsonb_build_object('rowId',v_row_id,'field',v_field,'current',v_current,'version',v_version)::text;
    end if;
    if v_field = 'archivedAt' and v_value <> 'null'::jsonb then
      perform (v_change ->> 'value')::timestamptz;
    end if;
    if v_value = 'null'::jsonb then v_row := v_row - v_field;
    else v_row := jsonb_set(v_row, array[v_field], v_value); end if;
    v_doc := jsonb_set(v_doc, array['rows',v_index::text], v_row);
    v_doc := jsonb_set(v_doc, '{cellVersions}', coalesce(v_doc -> 'cellVersions','{}'::jsonb));
    v_doc := jsonb_set(v_doc, array['cellVersions',v_row_id], coalesce(v_doc #> array['cellVersions',v_row_id],'{}'::jsonb));
    v_doc := jsonb_set(v_doc, array['cellVersions',v_row_id,v_field], jsonb_build_object('version',v_version+1,'mutationId',p_mutation_id));
    if v_field <> 'archivedAt' and not v_index = any(v_reverify) then v_reverify := array_append(v_reverify,v_index); end if;
    if not v_index = any(v_touched) then v_touched := array_append(v_touched,v_index); end if;
  end loop;
  if cardinality(v_touched) = 0 then return v_doc; end if;
  foreach v_index in array v_touched loop
    v_row := v_doc #> array['rows',v_index::text];
    if v_index = any(v_reverify) then
      if v_row ->> 'actionStatus' = 'closed' then
        v_row := v_row || jsonb_build_object('actionStatus','awaiting_verification');
        v_cell := v_doc #> array['cellVersions',v_row ->> 'id','actionStatus'];
        v_doc := jsonb_set(v_doc,array['cellVersions',v_row ->> 'id','actionStatus'],
          jsonb_build_object('version',coalesce((v_cell ->> 'version')::bigint,0)+1,'mutationId',p_mutation_id));
      end if;
      if v_row ? 'verifiedAt' then
        v_row := v_row - 'verifiedAt';
        v_doc := jsonb_set(v_doc,array['cellVersions',v_row ->> 'id','verifiedAt'],
          jsonb_build_object('version',coalesce((v_doc #>> array['cellVersions',v_row ->> 'id','verifiedAt','version'])::bigint,0)+1,'mutationId',p_mutation_id));
      end if;
    end if;
    v_row := v_row || jsonb_build_object('updatedAt',v_now);
    v_doc := jsonb_set(v_doc,array['rows',v_index::text],v_row);
  end loop;
  v_doc := v_doc || jsonb_build_object('updatedAt',v_now);
  v_previous_writer := current_setting('pulse.pfmea_cell_writer', true);
  perform set_config('pulse.pfmea_cell_writer', p_product_id, true);
  update public.products set custom_fields = jsonb_set(coalesce(v_fields,'{}'::jsonb),'{productPfmeaDocument}',v_doc)
    where id = p_product_id and project_id = p_project_id;
  if not found then raise exception using errcode='42501', message='PFMEA save was not authorized.'; end if;
  perform set_config('pulse.pfmea_cell_writer', coalesce(v_previous_writer,''), true);
  return v_doc;
end;
$$;
revoke all on function public.patch_pfmea_cells(text,text,text,uuid,jsonb) from public, anon;
grant execute on function public.patch_pfmea_cells(text,text,text,uuid,jsonb) to authenticated;

-- Old clients may still save unrelated product fields, but cannot replace a cell-managed document.
create or replace function public.guard_pfmea_cell_document() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.custom_fields -> 'productPfmeaDocument' ? 'cellVersions'
    and old.custom_fields -> 'productPfmeaDocument' is distinct from new.custom_fields -> 'productPfmeaDocument'
    and current_setting('pulse.pfmea_cell_writer', true) is distinct from new.id::text then
    raise exception 'This PFMEA requires cell-based saves. Reload before editing.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_pfmea_cell_document on public.products;
create trigger guard_pfmea_cell_document before update of custom_fields on public.products
for each row execute function public.guard_pfmea_cell_document();
