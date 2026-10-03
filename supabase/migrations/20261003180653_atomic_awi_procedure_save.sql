-- Add a master-only save entry point. No existing rows, policies, or functions are replaced.
-- RLS still enforces project edit access for every write. The complete read baseline prevents
-- an incomplete/stale browser snapshot from interpreting unseen steps or parts as removals.
create function public.save_awi_procedure(
  p_task_id text,
  p_project_id text,
  p_expected_version integer,
  p_expected_step_versions jsonb,
  p_expected_parts jsonb,
  p_task_patch jsonb,
  p_steps jsonb,
  p_parts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_project text;
  v_number text;
  v_current_steps jsonb;
  v_current_parts jsonb;
  v_versions jsonb;
  v_steps jsonb;
  v_parts jsonb;
  v_expected_parts jsonb;
  v_current_patch jsonb;
  v_park_base bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to save an AWI.' using errcode = '42501';
  end if;
  v_project := public.task_project_id(p_task_id);
  if v_project is null or (p_project_id is not null and v_project <> p_project_id)
      or not public.has_project_access(v_project, 'edit'::public.access_level) then
    raise exception 'You do not have permission to save this AWI.' using errcode = '42501';
  end if;
  select document_number into v_number from public.awi_masters
    where task_id = p_task_id and project_id = v_project;
  if not found then
    raise exception 'This save is only available for a master AWI.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_task_patch) is distinct from 'object'
      or jsonb_typeof(p_expected_step_versions) is distinct from 'object'
      or jsonb_typeof(p_steps) is distinct from 'array'
      or jsonb_typeof(p_parts) is distinct from 'array'
      or jsonb_typeof(p_expected_parts) is distinct from 'array' then
    raise exception 'Incomplete AWI save payload.' using errcode = '22023';
  end if;
  if not (p_task_patch ?& array['name','description','safety_notes','planned_duration_minutes','custom_fields'])
      or p_task_patch - array['name','description','safety_notes','planned_duration_minutes','custom_fields'] <> '{}'::jsonb
      or jsonb_typeof(p_task_patch->'custom_fields') is distinct from 'object'
      or p_task_patch->'custom_fields'->>'awiDocumentNumber' is distinct from v_number
      or length(btrim(coalesce(p_task_patch->>'name',''))) not between 1 and 200 then
    raise exception 'Invalid AWI procedure fields.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_steps) x
      where jsonb_typeof(x) <> 'object' or x->>'task_id' is distinct from p_task_id
        or coalesce(x->>'id','') = '')
      or exists (select 1 from jsonb_array_elements(p_parts) x
      where jsonb_typeof(x) <> 'object' or x->>'task_id' is distinct from p_task_id
        or coalesce(x->>'id','') = '')
      or exists (select 1 from jsonb_array_elements(p_expected_parts) x
      where jsonb_typeof(x) <> 'object' or x->>'task_id' is distinct from p_task_id
        or coalesce(x->>'id','') = '') then
    raise exception 'AWI child rows must belong to this task.' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(p_steps) x)
      or (select count(*) <> count(distinct x->>'sequence') from jsonb_array_elements(p_steps) x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(p_parts) x) then
    raise exception 'Duplicate AWI step, sequence, or part.' using errcode = '22023';
  end if;

  -- Serialize saves to this draft. Lock children in a stable order before inspecting versions;
  -- all network activity stays outside this transaction. Existing media and tools are untouched.
  select * into strict v_task from public.tasks where id = p_task_id for update;
  perform id from public.manufacturing_steps where task_id = p_task_id order by id for update;
  perform id from public.part_references where task_id = p_task_id order by id for update;

  select coalesce(jsonb_agg(to_jsonb(s) - array['created_at','updated_at','version'] order by s.id),'[]'::jsonb),
    coalesce(jsonb_object_agg(s.id,s.version),'{}'::jsonb)
    into v_current_steps,v_versions from public.manufacturing_steps s where task_id = p_task_id;
  select coalesce(jsonb_agg(to_jsonb(p) - array['created_at','updated_at'] order by p.id),'[]'::jsonb)
    into v_current_parts from public.part_references p where task_id = p_task_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into v_steps
    from jsonb_to_recordset(p_steps) as x(id text,task_id text,sequence integer,name text,
      instruction text,duration_minutes numeric,quality_check text,dependency_ids text[]);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into v_parts
    from jsonb_to_recordset(p_parts) as x(id text,task_id text,part_number text,description text,
      quantity numeric,disposition text);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into v_expected_parts
    from jsonb_to_recordset(p_expected_parts) as x(id text,task_id text,part_number text,description text,
      quantity numeric,disposition text);
  v_current_patch := jsonb_build_object('name',v_task.name,'description',v_task.description,
    'safety_notes',v_task.safety_notes,'planned_duration_minutes',v_task.planned_duration_minutes,
    'custom_fields',v_task.custom_fields - array['stepPhotoAttachments','taskExplodedViews','taskVideos','stepToolLists']);

  -- A committed save whose response was lost can be retried without changing versions or
  -- draft timestamps. Never rebase stale versions to overwrite a different committed edit.
  if v_current_patch = p_task_patch and v_current_steps = v_steps and v_current_parts = v_parts then
    return jsonb_build_object('task',to_jsonb(v_task),
      'steps',(select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence),'[]'::jsonb)
        from public.manufacturing_steps s where s.task_id = p_task_id),
      'parts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb)
        from public.part_references p where p.task_id = p_task_id));
  end if;
  if p_expected_version is distinct from v_task.version or p_expected_step_versions <> v_versions
      or v_expected_parts <> v_current_parts then
    raise exception 'AWI save conflict. Your local draft is preserved; reload this AWI before saving again.'
      using errcode = '40001';
  end if;

  -- Only removals explicitly represented against the confirmed baseline are applied.
  delete from public.manufacturing_steps s where s.task_id = p_task_id
    and not exists (select 1 from jsonb_array_elements(v_steps) x where x->>'id' = s.id);
  delete from public.part_references p where p.task_id = p_task_id
    and not exists (select 1 from jsonb_array_elements(v_parts) x where x->>'id' = p.id);

  -- Park only reordered rows above every current/desired sequence, so the immediate UNIQUE
  -- constraint is satisfied without deleting/recreating steps and cascading their attachments.
  select greatest(coalesce(max(s.sequence),0),
    coalesce((select max(x.sequence) from jsonb_to_recordset(v_steps) as x(sequence integer)),0))::bigint + 1
    into v_park_base from public.manufacturing_steps s where s.task_id = p_task_id;
  if v_park_base + jsonb_array_length(v_steps) > 2147483647 then
    raise exception 'AWI sequence is out of range.' using errcode = '22023';
  end if;
  with moved as (
    select s.id,row_number() over (order by s.id) as n from public.manufacturing_steps s
      join jsonb_to_recordset(v_steps) as x(id text,sequence integer) on x.id = s.id
      where s.task_id = p_task_id and s.sequence is distinct from x.sequence
  )
  update public.manufacturing_steps s set sequence = (v_park_base + moved.n)::integer
    from moved where s.id = moved.id;

  update public.manufacturing_steps s set sequence = x.sequence,name = x.name,instruction = x.instruction,
      duration_minutes = x.duration_minutes,quality_check = x.quality_check,dependency_ids = x.dependency_ids
    from jsonb_to_recordset(v_steps) as x(id text,task_id text,sequence integer,name text,
      instruction text,duration_minutes numeric,quality_check text,dependency_ids text[])
    where s.id = x.id and s.task_id = p_task_id
      and (to_jsonb(s) - array['created_at','updated_at','version']) is distinct from to_jsonb(x);
  insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes,quality_check,dependency_ids)
    select x.id,x.task_id,x.sequence,x.name,x.instruction,x.duration_minutes,x.quality_check,x.dependency_ids
    from jsonb_to_recordset(v_steps) as x(id text,task_id text,sequence integer,name text,
      instruction text,duration_minutes numeric,quality_check text,dependency_ids text[])
    where not exists (select 1 from public.manufacturing_steps s where s.id = x.id and s.task_id = p_task_id);
  update public.part_references p set part_number = x.part_number,description = x.description,
      quantity = x.quantity,disposition = x.disposition
    from jsonb_to_recordset(v_parts) as x(id text,task_id text,part_number text,description text,
      quantity numeric,disposition text)
    where p.id = x.id and p.task_id = p_task_id
      and (to_jsonb(p) - array['created_at','updated_at']) is distinct from to_jsonb(x);
  insert into public.part_references(id,task_id,part_number,description,quantity,disposition)
    select x.id,x.task_id,x.part_number,x.description,x.quantity,x.disposition
    from jsonb_to_recordset(v_parts) as x(id text,task_id text,part_number text,description text,
      quantity numeric,disposition text)
    where not exists (select 1 from public.part_references p where p.id = x.id and p.task_id = p_task_id);

  -- Advance the draft version once for any content change, including a step-only edit.
  update public.tasks set name = p_task_patch->>'name',description = p_task_patch->>'description',
      safety_notes = p_task_patch->>'safety_notes',
      planned_duration_minutes = (p_task_patch->>'planned_duration_minutes')::numeric,
      custom_fields = p_task_patch->'custom_fields'
    where id = p_task_id;
  if not found then
    raise exception 'AWI save access changed.' using errcode = '42501';
  end if;
  return jsonb_build_object('task',(select to_jsonb(t) from public.tasks t where t.id = p_task_id),
    'steps',(select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence),'[]'::jsonb)
      from public.manufacturing_steps s where s.task_id = p_task_id),
    'parts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb)
      from public.part_references p where p.task_id = p_task_id));
end;
$$;
revoke all on function public.save_awi_procedure(text,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_awi_procedure(text,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Part-only changes also make the master a draft. This private trigger can update only the
-- matching master timestamp; clients cannot execute it. No existing trigger is rewritten.
create function private.awi_mark_part_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;
  update public.awi_masters set draft_updated_at = clock_timestamp()
    where task_id = case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.awi_mark_part_draft() from public,anon,authenticated;
create trigger awi_part_draft after insert or update or delete on public.part_references
  for each row execute function private.awi_mark_part_draft();
