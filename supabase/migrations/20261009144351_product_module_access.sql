-- Product is one organization-wide permission. Existing project grants remain
-- available to legacy consumers; they never authorize Product content after cutover.
create table public.product_module_access (
  workspace_id text not null,
  user_id uuid not null,
  level public.access_level not null default 'none',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,user_id),
  foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create index product_module_access_user_idx on public.product_module_access(user_id,workspace_id);
alter table public.product_module_access enable row level security;
revoke all on public.product_module_access from public,anon,authenticated;
grant select,insert,update,delete on public.product_module_access to authenticated;
grant all on public.product_module_access to service_role;
create policy "Product access read" on public.product_module_access for select to authenticated
using (user_id=(select auth.uid()) or public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));
create policy "Product access manage" on public.product_module_access for all to authenticated
using (public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));
create trigger product_module_access_updated before update on public.product_module_access
for each row execute function public.set_updated_at();
create trigger product_module_access_audit after insert or update or delete on public.product_module_access
for each row execute function public.audit_access_change();

-- This narrow lookup is intentionally a caller-scoped public RPC: it returns only
-- the current user's effective level and cannot look up another user's permission.
-- SECURITY DEFINER avoids recursive RLS when project policies resolve membership.
create function public.product_access_level(p_workspace_id text)
returns public.access_level language sql stable security definer set search_path='' as $$
  select case
    when auth.uid() is null or p_workspace_id is null then 'none'::public.access_level
    when public.has_workspace_role(p_workspace_id,array['owner','admin']::public.workspace_role[])
      then 'edit'::public.access_level
    else coalesce((select a.level from public.product_module_access a
      join public.workspace_members m using(workspace_id,user_id)
      where a.workspace_id=p_workspace_id and a.user_id=auth.uid()),'none'::public.access_level)
  end;
$$;
create function public.has_product_access(p_workspace_id text,min_level public.access_level)
returns boolean language sql stable security invoker set search_path='' as $$
  select min_level in ('view'::public.access_level,'edit'::public.access_level)
    and public.product_access_level(p_workspace_id)>=min_level;
$$;
create function public.has_product_project_access(target_project_id text,min_level public.access_level)
returns boolean language sql stable security invoker set search_path='' as $$
  select target_project_id is not null and public.has_product_access(public.project_workspace_id(target_project_id),min_level);
$$;
revoke all on function public.product_access_level(text),public.has_product_access(text,public.access_level),public.has_product_project_access(text,public.access_level) from public,anon;
grant execute on function public.product_access_level(text),public.has_product_access(text,public.access_level),public.has_product_project_access(text,public.access_level) to authenticated,service_role;

-- One-time conversion, not a fallback: later revocation cannot resurrect old grants.
insert into public.product_module_access(workspace_id,user_id,level)
select m.workspace_id,m.user_id,max(a.level)
from public.workspace_members m join public.projects p on p.workspace_id=m.workspace_id
join public.project_access a on a.project_id=p.id and a.user_id=m.user_id
where m.role not in ('owner','admin') and a.level in ('view','edit')
group by m.workspace_id,m.user_id;

alter table public.workspace_access_grants add column product_access public.access_level not null default 'none';
update public.workspace_access_grants g set product_access=coalesce((
  select max(case a.level when 'edit' then 'edit'::public.access_level else 'view'::public.access_level end)
  from jsonb_to_recordset(g.project_access) a(project_id text,level text)
  join public.projects p on p.id=a.project_id and p.workspace_id=g.workspace_id
  where a.level in ('view','edit')),'none'::public.access_level)
where g.redeemed_at is null;

-- Product graph policies are replaced, not OR-ed with old project grants.
alter policy "awi author create" on public.awi_masters with check ((public.has_product_project_access(project_id, 'edit'::access_level) AND (published_at IS NULL) AND (published_release_id IS NULL) AND (task_project_id(task_id) = project_id) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = awi_masters.project_id) AND (p.workspace_id = awi_masters.workspace_id) AND p.is_awi_master)))));
alter policy "awi author read" on public.awi_masters using (public.has_product_project_access(project_id, 'view'::access_level));
alter policy "custom_columns workspace delete" on public.custom_columns using (public.has_product_project_access(custom_column_project_id(product_id, scenario_id), 'edit'::access_level));
alter policy "custom_columns workspace insert" on public.custom_columns with check (public.has_product_project_access(custom_column_project_id(product_id, scenario_id), 'edit'::access_level));
alter policy "custom_columns workspace read" on public.custom_columns using (public.has_product_project_access(custom_column_project_id(product_id, scenario_id), 'view'::access_level));
alter policy "custom_columns workspace update" on public.custom_columns using (public.has_product_project_access(custom_column_project_id(product_id, scenario_id), 'edit'::access_level)) with check (public.has_product_project_access(custom_column_project_id(product_id, scenario_id), 'edit'::access_level));
alter policy "document_type_codes workspace delete" on public.document_type_codes using (public.has_product_project_access(document_type_code_project_id(project_id, product_id), 'edit'::access_level));
alter policy "document_type_codes workspace insert" on public.document_type_codes with check (public.has_product_project_access(document_type_code_project_id(project_id, product_id), 'edit'::access_level));
alter policy "document_type_codes workspace read" on public.document_type_codes using (public.has_product_project_access(document_type_code_project_id(project_id, product_id), 'view'::access_level));
alter policy "document_type_codes workspace update" on public.document_type_codes using (public.has_product_project_access(document_type_code_project_id(project_id, product_id), 'edit'::access_level)) with check (public.has_product_project_access(document_type_code_project_id(project_id, product_id), 'edit'::access_level));
alter policy "manufacturing_components workspace delete" on public.manufacturing_components using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "manufacturing_components workspace insert" on public.manufacturing_components with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "manufacturing_components workspace read" on public.manufacturing_components using (public.has_product_project_access(scenario_project_id(scenario_id), 'view'::access_level));
alter policy "manufacturing_components workspace update" on public.manufacturing_components using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level)) with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "manufacturing_steps workspace delete" on public.manufacturing_steps using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "manufacturing_steps workspace insert" on public.manufacturing_steps with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "manufacturing_steps workspace read" on public.manufacturing_steps using (public.has_product_project_access(task_project_id(task_id), 'view'::access_level));
alter policy "manufacturing_steps workspace update" on public.manufacturing_steps using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level)) with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "part_references workspace delete" on public.part_references using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "part_references workspace insert" on public.part_references with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "part_references workspace read" on public.part_references using (public.has_product_project_access(task_project_id(task_id), 'view'::access_level));
alter policy "part_references workspace update" on public.part_references using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level)) with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "products workspace delete" on public.products using (public.has_product_project_access(project_id, 'edit'::access_level));
alter policy "products workspace insert" on public.products with check (((project_id IS NOT NULL) AND public.has_product_project_access(project_id, 'edit'::access_level)));
alter policy "products workspace read" on public.products using (public.has_product_project_access(project_id, 'view'::access_level));
alter policy "products workspace update" on public.products using (public.has_product_project_access(project_id, 'edit'::access_level)) with check (public.has_product_project_access(project_id, 'edit'::access_level));
alter policy "projects editor update" on public.projects using (public.has_product_project_access(id, 'edit'::access_level)) with check (public.has_product_project_access(id, 'edit'::access_level));
alter policy "projects member read" on public.projects using (public.has_product_project_access(id, 'view'::access_level));
alter policy "scenarios workspace delete" on public.scenarios using (public.has_product_project_access(product_project_id(product_id), 'edit'::access_level));
alter policy "scenarios workspace insert" on public.scenarios with check (public.has_product_project_access(product_project_id(product_id), 'edit'::access_level));
alter policy "scenarios workspace read" on public.scenarios using (public.has_product_project_access(product_project_id(product_id), 'view'::access_level));
alter policy "scenarios workspace update" on public.scenarios using (public.has_product_project_access(product_project_id(product_id), 'edit'::access_level)) with check (public.has_product_project_access(product_project_id(product_id), 'edit'::access_level));
alter policy "stations workspace delete" on public.stations using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "stations workspace insert" on public.stations with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "stations workspace read" on public.stations using (public.has_product_project_access(scenario_project_id(scenario_id), 'view'::access_level));
alter policy "stations workspace update" on public.stations using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level)) with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "step_exploded_views workspace delete" on public.step_exploded_views using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_exploded_views workspace insert" on public.step_exploded_views with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_exploded_views workspace read" on public.step_exploded_views using (public.has_product_project_access(task_project_id(task_id), 'view'::access_level));
alter policy "step_exploded_views workspace update" on public.step_exploded_views using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level)) with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_photos workspace delete" on public.step_photos using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_photos workspace insert" on public.step_photos with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_photos workspace read" on public.step_photos using (public.has_product_project_access(task_project_id(task_id), 'view'::access_level));
alter policy "step_photos workspace update" on public.step_photos using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level)) with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_tools workspace delete" on public.step_tools using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_tools workspace insert" on public.step_tools with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "step_tools workspace read" on public.step_tools using (public.has_product_project_access(task_project_id(task_id), 'view'::access_level));
alter policy "step_tools workspace update" on public.step_tools using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level)) with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "task_dependencies workspace delete" on public.task_dependencies using (public.has_product_project_access(task_project_id(successor_task_id), 'edit'::access_level));
alter policy "task_dependencies workspace insert" on public.task_dependencies with check ((public.has_product_project_access(task_project_id(successor_task_id), 'edit'::access_level) AND public.has_product_project_access(task_project_id(predecessor_task_id), 'edit'::access_level)));
alter policy "task_dependencies workspace read" on public.task_dependencies using (public.has_product_project_access(task_project_id(successor_task_id), 'view'::access_level));
alter policy "task_dependencies workspace update" on public.task_dependencies using (public.has_product_project_access(task_project_id(successor_task_id), 'edit'::access_level)) with check ((public.has_product_project_access(task_project_id(successor_task_id), 'edit'::access_level) AND public.has_product_project_access(task_project_id(predecessor_task_id), 'edit'::access_level)));
alter policy "task_reorder_receipts_read" on public.task_reorder_receipts using (((actor_id = auth.uid()) AND public.has_product_project_access(project_id, 'view'::access_level)));
alter policy "task_videos workspace delete" on public.task_videos using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "task_videos workspace insert" on public.task_videos with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "task_videos workspace read" on public.task_videos using (public.has_product_project_access(task_project_id(task_id), 'view'::access_level));
alter policy "task_videos workspace update" on public.task_videos using (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level)) with check (public.has_product_project_access(task_project_id(task_id), 'edit'::access_level));
alter policy "tasks workspace delete" on public.tasks using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "tasks workspace insert" on public.tasks with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "tasks workspace read" on public.tasks using (public.has_product_project_access(scenario_project_id(scenario_id), 'view'::access_level));
alter policy "tasks workspace update" on public.tasks using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level)) with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "tool_library workspace read" on public.tool_library using (public.has_product_project_access(project_id, 'view'::access_level));
alter policy "work_instruction_references_delete" on public.work_instruction_references using (public.has_product_project_access(project_id, 'edit'::access_level));
alter policy "work_instruction_references_insert" on public.work_instruction_references with check (public.has_product_project_access(project_id, 'edit'::access_level));
alter policy "work_instruction_references_read" on public.work_instruction_references using (public.has_product_project_access(project_id, 'view'::access_level));
alter policy "work_instruction_references_update" on public.work_instruction_references using (public.has_product_project_access(project_id, 'edit'::access_level)) with check (public.has_product_project_access(project_id, 'edit'::access_level));
alter policy "work_instruction_releases_insert" on public.work_instruction_releases with check (public.has_product_project_access(project_id, 'edit'::access_level));
alter policy "work_instruction_releases_read" on public.work_instruction_releases using (public.has_product_project_access(project_id, 'view'::access_level));
alter policy "zones workspace delete" on public.zones using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "zones workspace insert" on public.zones with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "zones workspace read" on public.zones using (public.has_product_project_access(scenario_project_id(scenario_id), 'view'::access_level));
alter policy "zones workspace update" on public.zones using (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level)) with check (public.has_product_project_access(scenario_project_id(scenario_id), 'edit'::access_level));
alter policy "task video deletes" on storage.objects using ((((bucket_id = 'task-videos'::text) AND (name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "task video reads" on storage.objects using ((((bucket_id = 'task-videos'::text) AND (name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'view'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "task video uploads" on storage.objects with check ((((bucket_id = 'task-videos'::text) AND (name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND ((storage.foldername(name))[3] = 'projects'::text) AND (project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "wi reference file deletes" on storage.objects using ((((bucket_id = 'wi-reference-files'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND ((storage.foldername(name))[3] = 'projects'::text) AND ((storage.foldername(name))[5] = 'wi-references'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "wi reference file reads" on storage.objects using ((((bucket_id = 'wi-reference-files'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND ((storage.foldername(name))[3] = 'projects'::text) AND ((storage.foldername(name))[5] = 'wi-references'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'view'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "wi reference file uploads" on storage.objects with check ((((bucket_id = 'wi-reference-files'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND ((storage.foldername(name))[3] = 'projects'::text) AND ((storage.foldername(name))[5] = 'wi-references'::text) AND (project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "workspace scoped step photo deletes" on storage.objects using ((((bucket_id = 'step-photos'::text) AND (((name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level)) OR (EXISTS ( SELECT 1
   FROM step_photos sp
  WHERE (((sp.storage_path = objects.name) OR (sp.thumbnail_storage_path = objects.name)) AND public.has_product_project_access(task_project_id(sp.task_id), 'edit'::access_level)))) OR (EXISTS ( SELECT 1
   FROM tool_library tl
  WHERE ((tl.storage_path = objects.name) AND public.has_product_project_access(tl.project_id, 'edit'::access_level))))))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "workspace scoped step photo reads" on storage.objects using ((((bucket_id = 'step-photos'::text) AND (((name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'view'::access_level)) OR (EXISTS ( SELECT 1
   FROM step_photos sp
  WHERE ((sp.deleted_at IS NULL) AND ((sp.storage_path = objects.name) OR (sp.thumbnail_storage_path = objects.name)) AND public.has_product_project_access(task_project_id(sp.task_id), 'view'::access_level)))) OR (EXISTS ( SELECT 1
   FROM tool_library tl
  WHERE ((tl.storage_path = objects.name) AND public.has_product_project_access(tl.project_id, 'view'::access_level))))))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "workspace scoped step photo updates" on storage.objects using ((((bucket_id = 'step-photos'::text) AND (((name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level)) OR (EXISTS ( SELECT 1
   FROM step_photos sp
  WHERE (((sp.storage_path = objects.name) OR (sp.thumbnail_storage_path = objects.name)) AND public.has_product_project_access(task_project_id(sp.task_id), 'edit'::access_level)))) OR (EXISTS ( SELECT 1
   FROM tool_library tl
  WHERE ((tl.storage_path = objects.name) AND public.has_product_project_access(tl.project_id, 'edit'::access_level))))))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2]))) with check ((((bucket_id = 'step-photos'::text) AND (name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));
alter policy "workspace scoped step photo uploads" on storage.objects with check ((((bucket_id = 'step-photos'::text) AND (name ~~ 'workspaces/%/projects/%'::text) AND ((storage.foldername(name))[1] = 'workspaces'::text) AND ((storage.foldername(name))[3] = 'projects'::text) AND (project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]) AND public.has_product_project_access((storage.foldername(name))[4], 'edit'::access_level))) and (name not like 'workspaces/%/projects/%' or ((storage.foldername(name))[3]='projects' and public.project_workspace_id((storage.foldername(name))[4])=(storage.foldername(name))[2])));

-- Production actuals retain their existing write boundary. Product dashboards
-- can read actuals for their Product projects, without acquiring Production access.
create policy "Product actuals read" on public.actual_events for select to authenticated
using(public.has_product_project_access(public.task_project_id(task_id),'view'));
alter policy "projects editor insert" on public.projects
with check(public.has_product_access(workspace_id,'edit'));
-- The catalog still had organization-role write policies for the tool library.
alter policy "tool_library workspace insert" on public.tool_library
with check(public.has_product_project_access(project_id,'edit'));
alter policy "tool_library workspace update" on public.tool_library
using(public.has_product_project_access(project_id,'edit')) with check(public.has_product_project_access(project_id,'edit'));
alter policy "tool_library workspace delete" on public.tool_library
using(public.has_product_project_access(project_id,'edit'));

-- Patch only the named Product RPCs, preserving current concurrency/lifecycle logic.
do $migration$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.save_awi_procedure(text,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'public.update_awi_metadata(uuid,text,text,text,text)',
    'public.reorder_scenario_tasks(text,text,uuid,jsonb,jsonb,uuid)',
    'public.load_task_reorder_baseline(text,text,uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('public.has_project_access(' in definition)=0 then raise exception 'Product access anchor missing: %',signature; end if;
    execute replace(definition,'public.has_project_access(','public.has_product_project_access(');
  end loop;
  foreach signature in array array['public.create_awi_master(text,text,text)','public.next_awi_document_number(text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position($anchor$public.has_workspace_role(p_workspace_id,array['owner','admin','editor']::public.workspace_role[])$anchor$ in definition)=0 then
      raise exception 'Product creation anchor missing: %',signature;
    end if;
    execute replace(definition,$anchor$public.has_workspace_role(p_workspace_id,array['owner','admin','editor']::public.workspace_role[])$anchor$,
      $replacement$public.has_product_access(p_workspace_id,'edit'::public.access_level)$replacement$);
  end loop;
  definition:=pg_get_functiondef('public.create_project_with_starter_plan(text,text)'::regprocedure);
  if position($anchor$public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin', 'editor']::public.workspace_role[]
  )$anchor$ in definition)=0 then raise exception 'Project factory permission anchor missing'; end if;
  definition:=replace(definition,$anchor$public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin', 'editor']::public.workspace_role[]
  )$anchor$,$replacement$public.has_product_access(p_workspace_id,'edit'::public.access_level)$replacement$);
  if position($anchor$  -- Establish access before any project-scoped child rows are created.$anchor$ in definition)=0
     or position($anchor$  -- Match createEmptyPlannerStateForProject()$anchor$ in definition)=0 then raise exception 'Project factory creator grant anchors missing'; end if;
  definition:=substring(definition from 1 for position($anchor$  -- Establish access before any project-scoped child rows are created.$anchor$ in definition)-1)
    || substring(definition from position($anchor$  -- Match createEmptyPlannerStateForProject()$anchor$ in definition));
  execute definition;

  definition:=pg_get_functiondef('public.redeem_workspace_access_grants()'::regprocedure);
  if position($anchor$    if grant_row.planning_access then$anchor$ in definition)=0 then raise exception 'Invite Product anchor missing'; end if;
  definition:=replace(definition,$anchor$    if grant_row.planning_access then$anchor$,$replacement$
    -- Managers inherit access; don't mint a grant that survives a future demotion.
    if exists(select 1 from public.workspace_members where workspace_id=grant_row.workspace_id
      and user_id=auth.uid() and role not in ('owner','admin')) then
      insert into public.product_module_access(workspace_id,user_id,level,granted_by)
      values(grant_row.workspace_id,auth.uid(),grant_row.product_access,grant_row.granted_by)
      on conflict(workspace_id,user_id) do update set level=excluded.level,granted_by=excluded.granted_by,updated_at=now();
    end if;
    if grant_row.planning_access then$replacement$);
  execute definition;
end $migration$;

-- Include the new entitlement in the existing manager-invitation protection.
drop trigger workspace_access_grants_protect_managers on public.workspace_access_grants;
create trigger workspace_access_grants_protect_managers
before insert or update of workspace_id,email,role,quality_access,product_access,planning_access,project_access,department_access,modules,expires_at,granted_by or delete
on public.workspace_access_grants for each row execute function public.protect_manager_invitation();
