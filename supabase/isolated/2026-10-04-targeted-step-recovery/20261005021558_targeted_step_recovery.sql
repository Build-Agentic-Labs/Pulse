-- ISOLATED ONLY. Production application and client release require separate approval.
-- Self-contained targeted recovery. No shared writer replacement, catalog fence, file deletion,
-- expiry or cleanup. Applying this migration changes no existing rows or permissions.
create table public.task_step_recovery_records (
  id uuid primary key,
  actor_id uuid not null,
  project_id text not null,
  task_id text not null,
  step_id text not null,
  expected_version integer not null,
  step jsonb not null,
  tools jsonb not null,
  photos jsonb not null,
  exploded_views jsonb not null,
  step_custom_fields jsonb not null,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid
);
alter table public.task_step_recovery_records enable row level security;
revoke all on public.task_step_recovery_records from public,anon,authenticated;
grant select on public.task_step_recovery_records to authenticated;
create policy task_step_recovery_read on public.task_step_recovery_records for select to authenticated
  using (public.has_project_access(project_id,'view'::public.access_level));

create function private.recovery_step_positions(p_task_id text) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',sequence,'version',version) order by sequence,id),'[]'::jsonb)
    from public.manufacturing_steps where task_id=p_task_id;
$$;
revoke all on function private.recovery_step_positions(text) from public,anon,authenticated;

create function private.recovery_shift_steps(p_task_id text,p_from integer,p_delta integer) returns void
language plpgsql set search_path='' as $$
declare v_id text;
begin
  for v_id in select id from public.manufacturing_steps where task_id=p_task_id and sequence>=p_from
    order by case when p_delta>0 then -sequence else sequence end,id
  loop
    update public.manufacturing_steps set sequence=sequence+p_delta where id=v_id and task_id=p_task_id;
  end loop;
end;
$$;
revoke all on function private.recovery_shift_steps(text,integer,integer) from public,anon,authenticated;

create function private.recovery_update_task(p_task_id text) returns void
language plpgsql set search_path='' as $$
declare v_duration numeric;
begin
  select coalesce(sum(greatest(coalesce(duration_minutes,0),0)),0) into v_duration
    from public.manufacturing_steps where task_id=p_task_id;
  update public.tasks set planned_duration_minutes=v_duration,
    planned_finish=planned_start+v_duration*interval '1 minute' where id=p_task_id;
end;
$$;
revoke all on function private.recovery_update_task(text) from public,anon,authenticated;

create function public.delete_task_step_atomic(p_project_id text,p_task_id text,p_step_id text,
  p_expected_version integer,p_operation_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_step public.manufacturing_steps;
  v_record public.task_step_recovery_records;
  v_fields jsonb;
  v_scenario_id text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'Sign in to delete a step.' using errcode='42501';
  end if;
  if p_operation_id is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'Reload before deleting this step.' using errcode='22023';
  end if;
  if public.task_project_id(p_task_id) is distinct from p_project_id
    or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to delete this step.' using errcode='42501';
  end if;
  -- Match task-reorder lock order: scenario, product, then task, then steps.
  select scenario_id into v_scenario_id from public.tasks where id=p_task_id;
  perform id from public.scenarios where id=v_scenario_id for share;
  perform id from public.products where id=(select product_id from public.scenarios where id=v_scenario_id) for share;
  -- Parent lock excludes inserts into the step set, including a previously empty set.
  perform id from public.tasks where id=p_task_id and scenario_id=v_scenario_id for update;
  if not found or public.task_project_id(p_task_id) is distinct from p_project_id
    or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to delete this step.' using errcode='42501';
  end if;
  select * into v_record from public.task_step_recovery_records where id=p_operation_id;
  if found then
    if (v_record.actor_id,v_record.project_id,v_record.task_id,v_record.step_id,v_record.expected_version)
      is distinct from (p_actor_id,p_project_id,p_task_id,p_step_id,p_expected_version) then
      raise exception 'Step delete operation id was reused with different content.' using errcode='22023';
    end if;
    return jsonb_build_object('record_id',v_record.id,'task_id',p_task_id,'step_id',p_step_id,
      'already_deleted',true,'steps',private.recovery_step_positions(p_task_id));
  end if;
  perform id from public.manufacturing_steps where task_id=p_task_id order by id for update;
  select * into v_step from public.manufacturing_steps where id=p_step_id and task_id=p_task_id;
  if not found then raise exception 'This step no longer exists.' using errcode='P0002'; end if;
  if v_step.version<>p_expected_version then
    raise exception 'This step changed on another device. Reload and try again.' using errcode='40001';
  end if;
  perform id from public.step_tools where step_id=p_step_id order by id for update;
  perform id from public.step_photos where step_id=p_step_id order by id for update;
  perform id from public.step_exploded_views where step_id=p_step_id order by id for update;
  select coalesce(jsonb_object_agg(key,value->p_step_id),'{}'::jsonb) into v_fields
    from public.tasks t,jsonb_each(coalesce(t.custom_fields,'{}'::jsonb))
    where t.id=p_task_id and key in ('stepPartMentions','stepPhotoAttachments','stepToolLists')
      and jsonb_typeof(value)='object' and value ? p_step_id;
  insert into public.task_step_recovery_records(id,actor_id,project_id,task_id,step_id,expected_version,
    step,tools,photos,exploded_views,step_custom_fields) values
    (p_operation_id,p_actor_id,p_project_id,p_task_id,p_step_id,p_expected_version,to_jsonb(v_step),
      coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.step_tools x where step_id=p_step_id),'[]'),
      coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.step_photos x where step_id=p_step_id),'[]'),
      coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.step_exploded_views x where step_id=p_step_id),'[]'),v_fields);
  delete from public.manufacturing_steps where id=p_step_id and task_id=p_task_id;
  perform private.recovery_shift_steps(p_task_id,v_step.sequence+1,-1);
  update public.tasks t set custom_fields=(
    select coalesce(jsonb_object_agg(key,case when key in ('stepPartMentions','stepPhotoAttachments','stepToolLists')
      and jsonb_typeof(value)='object' then value-p_step_id else value end),'{}'::jsonb)
    from jsonb_each(coalesce(t.custom_fields,'{}'::jsonb))) where t.id=p_task_id;
  perform private.recovery_update_task(p_task_id);
  return jsonb_build_object('record_id',p_operation_id,'task_id',p_task_id,'step_id',p_step_id,
    'already_deleted',false,'steps',private.recovery_step_positions(p_task_id));
end;
$$;
revoke all on function public.delete_task_step_atomic(text,text,text,integer,uuid,uuid) from public,anon;
grant execute on function public.delete_task_step_atomic(text,text,text,integer,uuid,uuid) to authenticated;

create function public.restore_task_step_atomic(p_project_id text,p_task_id text,p_record_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_record public.task_step_recovery_records;
  v_target integer;
  v_max integer;
  v_field record;
  v_scenario_id text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id
    or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to restore this step.' using errcode='42501';
  end if;
  select scenario_id into v_scenario_id from public.tasks where id=p_task_id;
  perform id from public.scenarios where id=v_scenario_id for share;
  perform id from public.products where id=(select product_id from public.scenarios where id=v_scenario_id) for share;
  perform id from public.tasks where id=p_task_id and scenario_id=v_scenario_id for update;
  if not found or public.task_project_id(p_task_id) is distinct from p_project_id then
    raise exception 'This process was deleted, so the step cannot be restored.' using errcode='P0002';
  end if;
  if not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to restore this step.' using errcode='42501';
  end if;
  select * into v_record from public.task_step_recovery_records where id=p_record_id for update;
  if not found or (v_record.project_id,v_record.task_id) is distinct from (p_project_id,p_task_id) then
    raise exception 'There is nothing to restore.' using errcode='P0002';
  end if;
  if v_record.restored_at is not null then
    return jsonb_build_object('record_id',p_record_id,'task_id',p_task_id,'step_id',v_record.step_id,
      'already_restored',true,'steps',private.recovery_step_positions(p_task_id));
  end if;
  perform id from public.manufacturing_steps where task_id=p_task_id order by id for update;
  if exists (select 1 from public.manufacturing_steps where id=v_record.step_id) then
    raise exception 'The original step id is occupied. Nothing was restored.' using errcode='40001';
  end if;
  -- Refuse id collisions atomically rather than overwriting media belonging to another operation.
  if exists(select 1 from jsonb_array_elements(v_record.tools) x join public.step_tools t on t.id=x->>'id')
    or exists(select 1 from jsonb_array_elements(v_record.photos) x join public.step_photos t on t.id=x->>'id')
    or exists(select 1 from jsonb_array_elements(v_record.exploded_views) x join public.step_exploded_views t on t.id=x->>'id') then
    raise exception 'A saved step attachment id is occupied. Nothing was restored.' using errcode='40001';
  end if;
  if exists(select 1 from public.tasks t, jsonb_each(v_record.step_custom_fields) f
    where t.id=p_task_id and t.custom_fields ? f.key
      and jsonb_typeof(t.custom_fields->f.key)<>'object') then
    raise exception 'The saved step fields changed shape. Nothing was restored.' using errcode='40001';
  end if;
  select coalesce(max(sequence),0) into v_max from public.manufacturing_steps where task_id=p_task_id;
  v_target:=least((v_record.step->>'sequence')::integer,v_max+1);
  perform private.recovery_shift_steps(p_task_id,v_target,1);
  insert into public.manufacturing_steps select * from jsonb_populate_record(null::public.manufacturing_steps,
    v_record.step||jsonb_build_object('sequence',v_target,'version',(v_record.step->>'version')::integer+1));
  insert into public.step_tools select * from jsonb_populate_recordset(null::public.step_tools,v_record.tools);
  insert into public.step_photos select * from jsonb_populate_recordset(null::public.step_photos,v_record.photos);
  insert into public.step_exploded_views select * from jsonb_populate_recordset(null::public.step_exploded_views,v_record.exploded_views);
  for v_field in select * from jsonb_each(v_record.step_custom_fields) loop
    update public.tasks t set custom_fields=jsonb_set(coalesce(t.custom_fields,'{}'),array[v_field.key],
      coalesce(t.custom_fields->v_field.key,'{}')||jsonb_build_object(v_record.step_id,v_field.value))
      where t.id=p_task_id and (t.custom_fields->v_field.key->v_record.step_id) is null;
  end loop;
  perform private.recovery_update_task(p_task_id);
  update public.task_step_recovery_records set restored_at=now(),restored_by=p_actor_id where id=p_record_id;
  return jsonb_build_object('record_id',p_record_id,'task_id',p_task_id,'step_id',v_record.step_id,
    'already_restored',false,'steps',private.recovery_step_positions(p_task_id));
end;
$$;
revoke all on function public.restore_task_step_atomic(text,text,uuid,uuid) from public,anon;
grant execute on function public.restore_task_step_atomic(text,text,uuid,uuid) to authenticated;
