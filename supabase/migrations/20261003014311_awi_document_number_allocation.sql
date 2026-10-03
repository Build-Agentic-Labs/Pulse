-- Allocate across all organization masters, including documents hidden by project access.
-- This helper reveals only an available number after checking organization edit permission.
create or replace function public.next_awi_document_number(p_workspace_id text)
returns text language plpgsql security definer set search_path='' as $$
declare v_next bigint;
begin
  if auth.uid() is null or not public.has_workspace_role(p_workspace_id,array['owner','admin','editor']::public.workspace_role[]) then
    raise exception 'You do not have permission to create AWIs in this organization.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('awi-number:'||p_workspace_id,0));
  select coalesce(max(substring(document_number from '[0-9]+$')::bigint),0)+1 into v_next
    from public.awi_masters where workspace_id=p_workspace_id and document_number ~ '^AWI-[0-9]{1,9}$';
  return 'AWI-' || lpad(v_next::text,greatest(4,length(v_next::text)),'0');
end $$;
revoke all on function public.next_awi_document_number(text) from public,anon;
grant execute on function public.next_awi_document_number(text) to authenticated;

create or replace function public.create_awi_master(p_workspace_id text, p_title text, p_document_number text default '')
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_project text; v_scenario text; v_station text := 'awi-station-' || gen_random_uuid()::text;
  v_task text := 'awi-task-' || gen_random_uuid()::text; v_id uuid;
  v_number text := upper(btrim(coalesce(p_document_number,'')));
  v_title text := btrim(coalesce(p_title,'')); v_next bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to create an AWI.'; end if;
  if length(v_title) not between 1 and 200 then raise exception 'Enter an AWI title (up to 200 characters).'; end if;
  if not public.has_workspace_role(p_workspace_id,array['owner','admin','editor']::public.workspace_role[]) then
    raise exception 'You do not have permission to create AWIs in this organization.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('awi-number:'||p_workspace_id,0));
  if v_number='' then
    v_number := public.next_awi_document_number(p_workspace_id);
  end if;
  if length(v_number)>64 then raise exception 'Document number must be at most 64 characters.'; end if;
  -- The existing transactional factory establishes creator access and the complete editor backing state.
  v_project := public.create_project_with_starter_plan(p_workspace_id, v_title || ' ' || v_number);
  update public.projects set is_awi_master=true, name=v_title where id=v_project;
  select s.id into strict v_scenario from public.scenarios s join public.products p on p.id=s.product_id where p.project_id=v_project;
  insert into public.stations(id,scenario_id,sequence,name) values(v_station,v_scenario,1,v_title);
  insert into public.tasks(id,scenario_id,station_id,wbs,name,planned_start,planned_finish,manufacturing_code,code_locked,custom_fields)
    values(v_task,v_scenario,v_station,'1',v_title,now(),now(),v_number,true,jsonb_build_object('awiDocumentNumber',v_number));
  insert into public.manufacturing_steps(task_id,sequence,instruction) values(v_task,10,'');
  insert into public.awi_masters(workspace_id,project_id,task_id,document_number,title)
    values(p_workspace_id,v_project,v_task,v_number,v_title) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_awi_master(text,text,text) from public, anon;
grant execute on function public.create_awi_master(text,text,text) to authenticated;
