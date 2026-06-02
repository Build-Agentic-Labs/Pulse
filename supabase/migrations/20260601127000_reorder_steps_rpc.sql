-- Atomic, single-round-trip manufacturing-step reordering.
--
-- reorderProcedureSteps previously issued 2N PostgREST updates per reorder: a "bump to high
-- temporary sequences" pass followed by a "set final 1..N" pass, to dodge the
-- UNIQUE(task_id, sequence) constraint. That is 2N round-trips AND non-atomic -- a partial
-- failure leaves a task's steps with mixed or duplicate sequence numbers (visible corruption +
-- N spurious realtime re-renders).
--
-- This function performs the same two-phase swap inside ONE transaction (the function body),
-- so it is atomic and a single round-trip. SECURITY INVOKER (the default) means the caller's
-- RLS still applies: the manufacturing_steps UPDATE policy requires has_project_access('edit'),
-- so cross-project reordering remains impossible. search_path is locked to '' with fully
-- qualified references for hardening.

create or replace function public.reorder_manufacturing_steps(p_task_id text, p_step_ids text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base int;
begin
  if p_step_ids is null or array_length(p_step_ids, 1) is null then
    return;
  end if;

  -- Park the affected rows above every existing sequence for this task so the two-phase swap
  -- never transiently collides with the non-deferrable UNIQUE(task_id, sequence) constraint.
  select greatest(100000, coalesce(max(ms.sequence), 0)) + array_length(p_step_ids, 1) + 1
    into v_base
  from public.manufacturing_steps ms
  where ms.task_id = p_task_id;

  update public.manufacturing_steps ms
  set sequence = v_base + s.ord::int
  from unnest(p_step_ids) with ordinality as s(id, ord)
  where ms.id = s.id and ms.task_id = p_task_id;

  -- Assign the final order: each step's sequence becomes its 1-based position in p_step_ids.
  update public.manufacturing_steps ms
  set sequence = s.ord::int
  from unnest(p_step_ids) with ordinality as s(id, ord)
  where ms.id = s.id and ms.task_id = p_task_id;
end;
$$;

-- Drop the redundant duplicate index: the UNIQUE constraint
-- manufacturing_steps_task_id_sequence_key already provides a btree on (task_id, sequence);
-- the separate non-unique _idx is dead weight that only slows writes.
drop index if exists public.manufacturing_steps_task_id_sequence_idx;
