-- Fix planner seed inserts for newly created projects.
-- Workspace owners should pass role checks even if membership rows are missing,
-- and child-table insert policies should resolve access through project joins directly.

create or replace function public.has_workspace_role(target_workspace_id text, allowed_roles workspace_role[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = auth.uid()
        and wm.role = any(allowed_roles)
    )
    or (
      'owner' = any(allowed_roles)
      and exists (
        select 1
        from public.workspaces w
        where w.id = target_workspace_id
          and w.owner_id = auth.uid()
      )
    );
$$;

drop policy if exists "products workspace insert" on products;
create policy "products workspace insert" on products
for insert to authenticated
with check (
  project_id is not null
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "scenarios workspace insert" on scenarios;
create policy "scenarios workspace insert" on scenarios
for insert to authenticated
with check (
  exists (
    select 1
    from public.products pr
    inner join public.projects p on p.id = pr.project_id
    where pr.id = product_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "stations workspace insert" on stations;
create policy "stations workspace insert" on stations
for insert to authenticated
with check (
  exists (
    select 1
    from public.scenarios s
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where s.id = scenario_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "zones workspace insert" on zones;
create policy "zones workspace insert" on zones
for insert to authenticated
with check (
  exists (
    select 1
    from public.scenarios s
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where s.id = scenario_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "tasks workspace insert" on tasks;
create policy "tasks workspace insert" on tasks
for insert to authenticated
with check (
  exists (
    select 1
    from public.scenarios s
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where s.id = scenario_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "task_dependencies workspace insert" on task_dependencies;
create policy "task_dependencies workspace insert" on task_dependencies
for insert to authenticated
with check (
  exists (
    select 1
    from public.tasks successor
    inner join public.scenarios s on s.id = successor.scenario_id
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where successor.id = successor_task_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
  and exists (
    select 1
    from public.tasks predecessor
    inner join public.scenarios s on s.id = predecessor.scenario_id
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where predecessor.id = predecessor_task_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "manufacturing_steps workspace insert" on manufacturing_steps;
create policy "manufacturing_steps workspace insert" on manufacturing_steps
for insert to authenticated
with check (
  exists (
    select 1
    from public.tasks t
    inner join public.scenarios s on s.id = t.scenario_id
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where t.id = task_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);

drop policy if exists "part_references workspace insert" on part_references;
create policy "part_references workspace insert" on part_references
for insert to authenticated
with check (
  exists (
    select 1
    from public.tasks t
    inner join public.scenarios s on s.id = t.scenario_id
    inner join public.products pr on pr.id = s.product_id
    inner join public.projects p on p.id = pr.project_id
    where t.id = task_id
      and public.has_workspace_role(p.workspace_id, array['owner', 'admin', 'editor']::workspace_role[])
  )
);
