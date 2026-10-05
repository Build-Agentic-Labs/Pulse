-- ISOLATED PILOT ONLY. Production application requires separate release approval.
-- Additive objects only; existing rows, policies, constraints and functions stay intact.
create table public.task_reorder_receipts (
  actor_id uuid not null,
  operation_id uuid not null,
  project_id text not null,
  scenario_id text not null,
  request jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);
alter table public.task_reorder_receipts enable row level security;
revoke all on public.task_reorder_receipts from public, anon, authenticated;
grant select on public.task_reorder_receipts to authenticated;
create policy task_reorder_receipts_read on public.task_reorder_receipts for select to authenticated
  using (actor_id = auth.uid() and public.has_project_access(project_id, 'view'::public.access_level));

create function public.reorder_scenario_tasks(
  p_project_id text, p_scenario_id text, p_operation_id uuid,
  p_expected_versions jsonb, p_order jsonb, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_receipt jsonb;
  v_versions jsonb;
  v_order jsonb;
  v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_actor_id then
    raise exception 'Sign in to reorder tasks.' using errcode = '42501';
  end if;
  if p_project_id is null or p_scenario_id is null or p_operation_id is null
      or jsonb_typeof(p_expected_versions) is distinct from 'object'
      or jsonb_typeof(p_order) is distinct from 'array' then
    raise exception 'Incomplete task reorder payload.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_expected_versions) x
      where jsonb_typeof(x.value) <> 'number' or x.value::text !~ '^[1-9][0-9]*$')
      or exists (select 1 from jsonb_array_elements(p_order) x
      where jsonb_typeof(x) <> 'object'
        or not (x ?& array['id','wbs','zone_id','station_id'])
        or x - array['id','wbs','zone_id','station_id'] <> '{}'::jsonb
        or jsonb_typeof(x->'id') is distinct from 'string'
        or jsonb_typeof(x->'wbs') is distinct from 'string'
        or length(btrim(x->>'id')) = 0 or length(btrim(x->>'wbs')) = 0
        or x->>'wbs' like '~reorder~%'
        or jsonb_typeof(x->'zone_id') not in ('string','null')
        or jsonb_typeof(x->'station_id') not in ('string','null'))
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(p_order) x)
      or (select count(*) <> count(distinct x->>'wbs') from jsonb_array_elements(p_order) x) then
    raise exception 'Invalid task reorder fields.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) into v_order
    from jsonb_array_elements(p_order) x;
  v_request := jsonb_build_object('project',p_project_id,'scenario',p_scenario_id,
    'versions',p_expected_versions,'order',v_order);

  if public.scenario_project_id(p_scenario_id) is distinct from p_project_id
      or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to reorder these tasks.' using errcode = '42501';
  end if;

  -- Stable scope lock excludes task inserts (their FK key-share lock conflicts).
  -- Then acquire task locks by id, so two updated clients serialize deterministically.
  perform id from public.scenarios where id = p_scenario_id for update;
  perform id from public.products where id = (select product_id from public.scenarios where id=p_scenario_id) for share;
  if not found or public.scenario_project_id(p_scenario_id) is distinct from p_project_id
      or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to reorder these tasks.' using errcode = '42501';
  end if;
  perform id from public.tasks where scenario_id = p_scenario_id order by id for update;

  select request into v_receipt from public.task_reorder_receipts
    where actor_id = v_actor and operation_id = p_operation_id;
  if found then
    if v_receipt is distinct from v_request then
      raise exception 'Task reorder operation id was reused with different content.' using errcode = '22023';
    end if;
    -- Lost-response retries acknowledge without replaying an old order over a newer one.
  else
    select coalesce(jsonb_object_agg(id,version),'{}'::jsonb) into v_versions
      from public.tasks where scenario_id = p_scenario_id;
    if v_versions is distinct from p_expected_versions
        or exists (select 1 from jsonb_array_elements(v_order) x where not (v_versions ? (x->>'id'))) then
      raise exception 'Task reorder conflict. Reload before reordering again.' using errcode = '40001';
    end if;
    -- Placement parents cannot change scope while we validate and update their tasks.
    perform id from public.zones where id in (select x->>'zone_id' from jsonb_array_elements(v_order) x)
      order by id for share;
    perform id from public.stations where id in (select x->>'station_id' from jsonb_array_elements(v_order) x)
      order by id for share;
    if exists (select 1 from jsonb_to_recordset(v_order) as x(id text,wbs text,zone_id text,station_id text)
        where (x.zone_id is not null and not exists (select 1 from public.zones z
          where z.id=x.zone_id and z.scenario_id=p_scenario_id))
          or (x.station_id is not null and not exists (select 1 from public.stations s
            where s.id=x.station_id and s.scenario_id=p_scenario_id))) then
      raise exception 'Task placement must belong to this scenario.' using errcode = '22023';
    end if;
    -- Parking and final placement commit together. Existing version triggers run normally.
    update public.tasks t set wbs = '~reorder~' || p_operation_id::text || ':' || t.id
      from jsonb_to_recordset(v_order) as x(id text,wbs text,zone_id text,station_id text)
      where t.id=x.id and t.scenario_id=p_scenario_id
        and (t.wbs,t.zone_id,t.station_id) is distinct from (x.wbs,x.zone_id,x.station_id);
    update public.tasks t set wbs=x.wbs,zone_id=x.zone_id,station_id=x.station_id
      from jsonb_to_recordset(v_order) as x(id text,wbs text,zone_id text,station_id text)
      where t.id=x.id and t.scenario_id=p_scenario_id
        and (t.wbs,t.zone_id,t.station_id) is distinct from (x.wbs,x.zone_id,x.station_id);
    insert into public.task_reorder_receipts(actor_id,operation_id,project_id,scenario_id,request)
      values(v_actor,p_operation_id,p_project_id,p_scenario_id,v_request);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'wbs',wbs,'zone_id',zone_id,
    'station_id',station_id,'version',version,'updated_at',updated_at) order by id),'[]'::jsonb)
    into v_result from public.tasks where scenario_id=p_scenario_id
      and id in (select x->>'id' from jsonb_array_elements(v_order) x);
  return jsonb_build_object('operation_id',p_operation_id,'scenario_id',p_scenario_id,'tasks',v_result);
end;
$$;
revoke all on function public.reorder_scenario_tasks(text,text,uuid,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.reorder_scenario_tasks(text,text,uuid,jsonb,jsonb,uuid) to authenticated;

-- One authorized narrow baseline, without evaluating task RLS separately for every row.
-- Scalar JSON aggregation is complete across PostgREST's row cap; the client checks membership too.
create function public.load_task_reorder_baseline(p_project_id text,p_scenario_id text,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'Sign in to reorder tasks.' using errcode = '42501';
  end if;
  if public.scenario_project_id(p_scenario_id) is distinct from p_project_id
      or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to reorder these tasks.' using errcode = '42501';
  end if;
  perform id from public.scenarios where id=p_scenario_id for share;
  perform id from public.products where id=(select product_id from public.scenarios where id=p_scenario_id) for share;
  if public.scenario_project_id(p_scenario_id) is distinct from p_project_id
      or not public.has_project_access(p_project_id,'edit'::public.access_level) then
    raise exception 'You do not have permission to reorder these tasks.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'wbs',wbs,'zone_id',zone_id,
    'station_id',station_id,'version',version) order by id),'[]'::jsonb)
    into v_rows from public.tasks where scenario_id=p_scenario_id;
  return v_rows;
end;
$$;
revoke all on function public.load_task_reorder_baseline(text,text,uuid) from public,anon;
grant execute on function public.load_task_reorder_baseline(text,text,uuid) to authenticated;
