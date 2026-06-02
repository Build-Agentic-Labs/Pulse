-- Atomic replacement of a task set's child rows (dependencies, steps, parts, actual events).
--
-- savePlannerStateToSupabase previously did this as ~9 separate PostgREST calls: delete all
-- task_dependencies / manufacturing_steps / part_references / actual_events for the tasks, THEN
-- insert the new ones. A failure in that gap permanently loses work-instruction steps and BOM
-- parts (the audit's #2 corruption window). It also can't use upsert-first because
-- manufacturing_steps has a UNIQUE(task_id, sequence) constraint that collides on renumber.
--
-- This function does the delete + insert inside ONE transaction (its body), so there is never a
-- visible window where the children are missing, and the unique constraint is satisfied because
-- the old rows are gone before the new ones land -- all atomically.
--
-- Faithfulness: each insert lists exactly the columns the TypeScript row-mappers emit
-- (dependencyRow / manufacturingStepRow / partReferenceRows / actualEventRow). Columns omitted
-- here (created_at, updated_at, version) keep their database DEFAULTs, matching the prior
-- PostgREST insert behavior. jsonb_to_recordset keeps the camelCase->snake_case mapping in TS as
-- the single source of truth -- this function never re-implements it.
--
-- SECURITY INVOKER (default): the caller's RLS still gates every delete/insert via
-- has_project_access('edit'), so cross-project writes remain impossible. search_path locked to ''.

create or replace function public.replace_task_children(
  p_task_ids text[],
  p_dependencies jsonb,
  p_steps jsonb,
  p_parts jsonb,
  p_actual_events jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_task_ids is null or array_length(p_task_ids, 1) is null then
    return;
  end if;

  delete from public.task_dependencies
   where predecessor_task_id = any(p_task_ids) or successor_task_id = any(p_task_ids);
  delete from public.manufacturing_steps where task_id = any(p_task_ids);
  delete from public.part_references where task_id = any(p_task_ids);
  delete from public.actual_events where task_id = any(p_task_ids);

  insert into public.task_dependencies (id, predecessor_task_id, successor_task_id, type, lag_minutes, constraint_type)
  select id, predecessor_task_id, successor_task_id, type, lag_minutes, constraint_type
  from jsonb_to_recordset(coalesce(p_dependencies, '[]'::jsonb))
    as x(id text, predecessor_task_id text, successor_task_id text,
         type public.dependency_type, lag_minutes numeric, constraint_type public.constraint_type);

  insert into public.manufacturing_steps (id, task_id, sequence, name, instruction, duration_minutes, quality_check, dependency_ids)
  select id, task_id, sequence, name, instruction, duration_minutes, quality_check, dependency_ids
  from jsonb_to_recordset(coalesce(p_steps, '[]'::jsonb))
    as x(id text, task_id text, sequence int, name text, instruction text,
         duration_minutes numeric, quality_check text, dependency_ids text[]);

  insert into public.part_references (id, task_id, part_number, description, quantity, disposition)
  select id, task_id, part_number, description, quantity, disposition
  from jsonb_to_recordset(coalesce(p_parts, '[]'::jsonb))
    as x(id text, task_id text, part_number text, description text, quantity numeric, disposition text);

  insert into public.actual_events (id, task_id, event_type, "timestamp", user_id, notes, reason_code)
  select id, task_id, event_type, "timestamp", user_id, notes, reason_code
  from jsonb_to_recordset(coalesce(p_actual_events, '[]'::jsonb))
    as x(id text, task_id text, event_type public.actual_event_type,
         "timestamp" timestamptz, user_id text, notes text, reason_code text);
end;
$$;
