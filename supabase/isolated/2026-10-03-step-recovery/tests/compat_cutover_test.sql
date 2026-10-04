-- Design characterization for the client-compatibility cutover (docs/tool-catalog-consistency-design.md §5b).
-- Old clients save in several requests; a cutover can land between them. The guard, telemetry and
-- non-destructive replace_task_children below are PROTOTYPES defined inside this rolled-back
-- transaction. Nothing is installed, and replace_task_children's real definition is untouched.
begin;
select plan(16);

insert into public.workspaces(id,name) values ('ws_cut_ci','Cutover CI'), ('ws_cut_other','Other org');
insert into public.workspace_auto_join_domains(domain,workspace_id) values ('cut-ci.test','ws_cut_ci'), ('cut-other.test','ws_cut_other')
 on conflict (domain) do update set workspace_id = excluded.workspace_id;
insert into auth.users(id,aud,role,email) values
 ('a8200000-0000-0000-0000-000000000001','authenticated','authenticated','editor@cut-ci.test'),
 ('a8200000-0000-0000-0000-000000000002','authenticated','authenticated','teammate@cut-ci.test'),
 ('a8200000-0000-0000-0000-000000000003','authenticated','authenticated','viewer@cut-ci.test'),
 ('a8200000-0000-0000-0000-000000000004','authenticated','authenticated','outsider@cut-other.test');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('ws_cut_ci','a8200000-0000-0000-0000-000000000001','editor'),
 ('ws_cut_ci','a8200000-0000-0000-0000-000000000002','editor'),
 ('ws_cut_ci','a8200000-0000-0000-0000-000000000003','viewer'),
 ('ws_cut_other','a8200000-0000-0000-0000-000000000004','owner')
on conflict (workspace_id,user_id) do update set role = excluded.role;

-- A request as an old client (no protocol header) or a new one (header present).
create function public.test_cut_as(p_uid text, p_protocol text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  perform set_config('request.headers', case when p_protocol is null then '{}' else json_build_object('x-pulse-write-protocol',p_protocol)::text end, true);
  execute 'set local role authenticated';
end $$;
create function public.test_cut_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '{}', true);
end $$;
create temporary table cut(name text primary key, val jsonb);
grant all on cut to authenticated;

select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
insert into cut values ('project', to_jsonb(public.create_project_with_starter_plan('ws_cut_ci','Cutover product')));
select public.test_cut_owner();
insert into public.project_access(project_id,user_id,level) values
 ((select val#>>'{}' from cut where name='project'),'a8200000-0000-0000-0000-000000000002','edit'),
 ((select val#>>'{}' from cut where name='project'),'a8200000-0000-0000-0000-000000000003','view')
on conflict (project_id,user_id) do update set level = excluded.level;
insert into cut values ('scenario', to_jsonb((select s.id from public.scenarios s join public.products p on p.id=s.product_id
  where p.project_id=(select val#>>'{}' from cut where name='project'))));
insert into public.tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators)
select id, (select val#>>'{}' from cut where name='scenario'), name, wbs, now(), now(), 10, 1
from (values ('cut-task-1','First','1'), ('cut-task-2','Second','2'), ('cut-task-R','Restore task','3')) v(id,name,wbs);
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values
 ('cut-R1','cut-task-R',1,'R1','Do R1',5), ('cut-R2','cut-task-R',2,'R2','Do R2',5), ('cut-R3','cut-task-R',3,'R3','Do R3',5);
insert into public.step_tools(id,task_id,step_id,tool_name,sequence)
 select 'tool-'||id||'-wrench', task_id, id, 'Wrench', 1 from public.manufacturing_steps where task_id='cut-task-R';
insert into public.step_exploded_views(id,task_id,step_id,storage_path,public_url,file_name)
 select 'view-'||id, task_id, id, 'cut-ci/'||id||'.png', 'cut-ci/'||id||'.png', id||'.png' from public.manufacturing_steps where task_id='cut-task-R';

-- The old Gantt reorder's request sequence (saveTasksToSupabase twice): first every changed task with a
-- temporary WBS, then the real WBS. Each statement here is one HTTP request, i.e. its own transaction.
create function public.test_cut_reorder_request(p_first text, p_second text) returns void language sql as $$
  insert into public.tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators)
  select t.id, t.scenario_id, t.name, v.wbs, t.planned_start, t.planned_finish, t.planned_duration_minutes, t.planned_operators
    from public.tasks t join (values ('cut-task-1', p_first), ('cut-task-2', p_second)) v(id,wbs) on v.id = t.id
  on conflict (id) do update set wbs = excluded.wbs;
$$;

-- 1. Why a REFUSING guard cannot be activated safely: the old reorder's first request commits before
--    activation; the refusal then stops its second request and the temporary WBS values stay stored.
select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
select lives_ok($$select public.test_cut_reorder_request('tmp-x-1','tmp-x-2')$$, 'old reorder: request 1 (temporary WBS) commits before activation');
select public.test_cut_owner();
create function public.test_cut_refusing_gate() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and coalesce(current_setting('request.headers', true)::jsonb->>'x-pulse-write-protocol','') = '' then
    raise exception 'This page is out of date. Reload to keep editing.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger test_cut_refusing_gate before insert or update or delete on public.tasks for each row execute function public.test_cut_refusing_gate();
select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_cut_reorder_request('2','1')$$, '42501', null, 'activated between requests, a refusing guard stops request 2');
select public.test_cut_owner();
select is((select array_agg(wbs order by id) from public.tasks where id in ('cut-task-1','cut-task-2')), array['tmp-x-1','tmp-x-2'],
  'and leaves the temporary WBS values stored: a refusing cutover is not safe for old multi-request saves');
drop trigger test_cut_refusing_gate on public.tasks;
update public.tasks set wbs = case id when 'cut-task-1' then '1' else '2' end where id in ('cut-task-1','cut-task-2');

-- 2. The proposed cutover for old clients: observe, never refuse. Activating telemetry between the
--    same two requests lets the old save finish exactly as it would have.
create table public.test_cut_observations(table_name text, operation text, user_id text, protocol text);
create function public.test_cut_observe() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_protocol text := current_setting('request.headers', true)::jsonb->>'x-pulse-write-protocol';
begin
  if v_protocol is null then
    insert into public.test_cut_observations values (tg_table_name, tg_op, auth.uid()::text, v_protocol);
  end if;
  return null;
end $$;
select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
select lives_ok($$select public.test_cut_reorder_request('tmp-y-1','tmp-y-2')$$, 'old reorder: request 1 commits before activation');
select public.test_cut_owner();
create trigger test_cut_observe after insert or update or delete on public.tasks for each statement execute function public.test_cut_observe();
select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
select lives_ok($$select public.test_cut_reorder_request('2','1')$$, 'activated between requests, telemetry lets request 2 through');
select public.test_cut_owner();
select is((select array_agg(wbs order by id) from public.tasks where id in ('cut-task-1','cut-task-2')), array['2','1'],
  'the old reorder finishes with real WBS values');
insert into cut values ('observed', to_jsonb((select count(*)::int from public.test_cut_observations)));
select ok((select val::int from cut where name='observed') > 0
  and (select bool_and(user_id='a8200000-0000-0000-0000-000000000001' and protocol is null) from public.test_cut_observations),
  'and the old client is recorded for the rollout decision');
select public.test_cut_as('a8200000-0000-0000-0000-000000000001', '2');
update public.tasks set name = 'First (new client)' where id = 'cut-task-1';
select public.test_cut_owner();
select is((select count(*)::int from public.test_cut_observations), (select val::int from cut where name='observed'), 'a new client (header present) is not recorded');

-- 3. The old phone's Restore across the activation of a non-destructive replace_task_children.
--    Snapshot as the phone held it, then a teammate adds a step with a tool and edits another step.
insert into cut values ('snapshot', (select jsonb_build_object(
  'steps', jsonb_agg(jsonb_build_object('id',s.id,'task_id',s.task_id,'sequence',s.sequence,'name',s.name,'instruction',s.instruction,
                                         'duration_minutes',s.duration_minutes,'quality_check',s.quality_check,'dependency_ids',s.dependency_ids) order by s.sequence))
  from public.manufacturing_steps s where s.task_id='cut-task-R'));
select public.test_cut_as('a8200000-0000-0000-0000-000000000002');
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values ('cut-R4','cut-task-R',4,'R4','Teammate step',5);
select public.apply_step_tool_changes('cut-task-R','cut-R4', array['Teammate Tool'], null);
update public.manufacturing_steps set instruction = 'Teammate edit' where id = 'cut-R3';
-- The phone (old client) deletes R2 the old way, then presses Restore. Its task-row upsert lands
-- before activation; its replace_task_children call lands after.
select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
delete from public.manufacturing_steps where id = 'cut-R2';
update public.tasks set name = 'Restore task' where id = 'cut-task-R';
select public.test_cut_owner();
create or replace function public.replace_task_children(p_task_ids text[], p_dependencies jsonb, p_steps jsonb, p_parts jsonb, p_actual_events jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
-- Non-destructive: never deletes or overwrites an existing child row (so nothing cascades); only
-- inserts rows that are missing, appending a step whose position is now taken.
begin
  if p_task_ids is null or array_length(p_task_ids, 1) is null then return; end if;
  insert into public.manufacturing_steps (id, task_id, sequence, name, instruction, duration_minutes, quality_check, dependency_ids)
  select x.id, x.task_id,
         case when exists (select 1 from public.manufacturing_steps s where s.task_id = x.task_id and s.sequence = x.sequence)
              then (select coalesce(max(s.sequence), 0) from public.manufacturing_steps s where s.task_id = x.task_id)
                   + row_number() over (partition by x.task_id order by x.sequence)
              else x.sequence end,
         x.name, x.instruction, x.duration_minutes, x.quality_check, x.dependency_ids
    from jsonb_to_recordset(coalesce(p_steps, '[]'::jsonb))
      as x(id text, task_id text, sequence int, name text, instruction text, duration_minutes numeric, quality_check text, dependency_ids text[])
   where x.task_id = any(p_task_ids)
     and not exists (select 1 from public.manufacturing_steps s where s.id = x.id);
end $$;
insert into cut values ('before_restore_call', (select jsonb_build_object(
  'tools', (select jsonb_agg(to_jsonb(t) order by t.id) from public.step_tools t where t.task_id='cut-task-R'),
  'views', (select jsonb_agg(to_jsonb(v) order by v.id) from public.step_exploded_views v where v.task_id='cut-task-R'),
  'steps', (select jsonb_agg(to_jsonb(s) order by s.id) from public.manufacturing_steps s where s.task_id='cut-task-R'))));
select public.test_cut_as('a8200000-0000-0000-0000-000000000001');
select lives_ok($$select public.replace_task_children(array['cut-task-R'], '[]'::jsonb, (select val->'steps' from cut where name='snapshot'), '[]'::jsonb, '[]'::jsonb)$$,
  'the old Restore call succeeds against the non-destructive function');
select public.test_cut_owner();
select is((select count(*)::int from public.manufacturing_steps where id='cut-R2'), 1, 'the deleted step comes back (as a row)');
select is((select jsonb_agg(to_jsonb(t) order by t.id) from public.step_tools t where t.task_id='cut-task-R'),
  (select val->'tools' from cut where name='before_restore_call'), 'no tool assignment is removed, including the teammate''s');
select is((select jsonb_agg(to_jsonb(v) order by v.id) from public.step_exploded_views v where v.task_id='cut-task-R'),
  (select val->'views' from cut where name='before_restore_call'), 'no exploded view is removed');
select is((select jsonb_agg(to_jsonb(s) order by s.id) from public.manufacturing_steps s where s.task_id='cut-task-R' and s.id <> 'cut-R2'),
  (select val->'steps' from cut where name='before_restore_call'), 'every other step, including the teammate''s new step and edit, is unchanged');

-- 4. The protocol header identifies compatible clients; it never grants anything.
select public.test_cut_as('a8200000-0000-0000-0000-000000000003', '2');
select throws_ok($$select public.apply_step_tool_changes('cut-task-R','cut-R1', array['X'], null)$$, '42501', null, 'a viewer with the header is still refused');
select throws_ok($$insert into public.step_tools(id,task_id,step_id,tool_name,sequence) values ('tool-cut-R1-x','cut-task-R','cut-R1','X',9)$$, '42501', null,
  'and row-level security still refuses their direct write');
select public.test_cut_as('a8200000-0000-0000-0000-000000000004', '2');
select throws_ok($$select public.delete_manufacturing_step('cut-R1', null)$$, '42501', null, 'another organization with the header is still refused');

select * from finish();
rollback;
