alter table public.projects add column is_awi_master boolean not null default false;
create table public.awi_masters (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id),
  project_id text not null unique references public.projects(id) on delete cascade,
  task_id text not null unique references public.tasks(id) on delete cascade,
  document_number text not null check (length(btrim(document_number)) between 1 and 64),
  title text not null check (length(btrim(title)) between 1 and 200),
  draft_updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_release_id uuid references public.work_instruction_releases(id),
  created_at timestamptz not null default now()
);
create unique index awi_master_document_number_unique on public.awi_masters(workspace_id, lower(document_number));
alter table public.awi_masters enable row level security;
revoke all on public.awi_masters from anon;
grant select, insert on public.awi_masters to authenticated;
create policy "awi author read" on public.awi_masters for select to authenticated
using (public.has_project_access(project_id, 'view'::public.access_level));
create policy "awi author create" on public.awi_masters for insert to authenticated
with check (public.has_project_access(project_id, 'edit'::public.access_level)
  and published_at is null and published_release_id is null
  and public.task_project_id(task_id) = project_id
  and exists (select 1 from public.projects p where p.id=project_id and p.workspace_id=workspace_id and p.is_awi_master));

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
    select coalesce(max(substring(document_number from '[0-9]+$')::bigint),0)+1 into v_next
      from public.awi_masters where workspace_id=p_workspace_id and document_number ~ '^AWI-[0-9]{1,9}$';
    v_number := 'AWI-' || lpad(v_next::text, greatest(4,length(v_next::text)), '0');
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

create schema if not exists private;
create or replace function private.awi_mark_draft() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_task text;
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'updated_at'-'version')=(to_jsonb(old)-'updated_at'-'version') then return new; end if;
  if tg_table_name='tasks' then v_task := coalesce(new.id,old.id); else v_task := coalesce(new.task_id,old.task_id); end if;
  update public.awi_masters set draft_updated_at=clock_timestamp() where task_id=v_task;
  if tg_table_name='tasks' and tg_op='UPDATE' and new.name<>old.name then
    update public.awi_masters set title=new.name where task_id=v_task;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.awi_mark_draft() from public,anon,authenticated;
create trigger awi_task_draft after update on public.tasks for each row execute function private.awi_mark_draft();
create trigger awi_step_draft after insert or update or delete on public.manufacturing_steps for each row execute function private.awi_mark_draft();

create or replace function private.awi_publish_release() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.awi_masters set published_at=new.released_at,published_release_id=new.id
    where task_id=new.task_id and project_id=new.project_id;
  return new;
end $$;
revoke all on function private.awi_publish_release() from public,anon,authenticated;
create trigger awi_publish_release after insert on public.work_instruction_releases for each row execute function private.awi_publish_release();
