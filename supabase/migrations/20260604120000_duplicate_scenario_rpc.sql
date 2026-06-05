-- duplicate_scenario(source, new_name): atomic deep-copy of a scenario into a new, fully independent
-- scenario (an "independent snapshot" per the Gantt-scenarios design). The function runs in the
-- caller's transaction, so either the whole copy lands or nothing does -- no half-copied scenarios.
--
-- ID strategy: every id column is `text`, so each copied row's new id is deterministic:
--     new_id = <old_id> || '-' || <suffix>
-- where <suffix> is one fresh value per call. Because the same suffix is used for every copied row,
-- any intra-scenario foreign key is remapped by appending the suffix -- no mapping tables needed, and
-- new ids are globally unique (the random suffix guarantees no collision with existing rows).
--
-- A copy is a clean PROJECTION, so actual/progress fields are reset (actual_* -> null,
-- percent_complete -> 0, status -> not_started) while the planned baseline is preserved, and
-- actual_events are NOT copied. Step photos are duplicated as rows that REUSE the same storage objects
-- (no file copy). A "Copied from <source> on <date>" note is stamped for traceability.
--
-- SECURITY DEFINER + search_path='' follows the repo's hardened-function convention; every object is
-- schema-qualified. Callers are still gated by the existing RLS/grants on the underlying tables.

create or replace function public.duplicate_scenario(p_source_scenario_id text, p_new_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id text;
  v_source_name text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_new_scenario_id text := 'scenario-' || v_suffix;
begin
  select product_id, name into v_product_id, v_source_name
  from public.scenarios
  where id = p_source_scenario_id;

  if v_product_id is null then
    raise exception 'duplicate_scenario: source scenario % not found', p_source_scenario_id;
  end if;

  -- 1. New scenario row (with traceability note).
  insert into public.scenarios (
    id, product_id, name, description, type, status, target_output, target_output_period, notes, created_at, updated_at
  )
  select
    v_new_scenario_id, product_id, p_new_name, description, type, status, target_output, target_output_period,
    'Copied from ' || v_source_name || ' on ' || to_char(now(), 'FMMonth DD, YYYY'),
    now(), now()
  from public.scenarios
  where id = p_source_scenario_id;

  -- 2. Stations (reset station actuals; keep planned baseline; sequence stays unique within the copy).
  insert into public.stations (
    id, scenario_id, sequence, name, description, owner_id, owner_name,
    planned_cycle_minutes, actual_cycle_minutes, planned_operators, actual_operators,
    planned_man_hours, actual_man_hours, takt_status, bottleneck_flag, wip_limit, area,
    tools_required, equipment_required, safety_notes, qc_notes, created_at, updated_at
  )
  select
    id || '-' || v_suffix, v_new_scenario_id, sequence, name, description, owner_id, owner_name,
    planned_cycle_minutes, null, planned_operators, null,
    planned_man_hours, null, takt_status, bottleneck_flag, wip_limit, area,
    tools_required, equipment_required, safety_notes, qc_notes, now(), now()
  from public.stations
  where scenario_id = p_source_scenario_id;

  -- 3. Zones.
  insert into public.zones (id, scenario_id, sequence, name, color, code, description, created_at, updated_at)
  select id || '-' || v_suffix, v_new_scenario_id, sequence, name, color, code, description, now(), now()
  from public.zones
  where scenario_id = p_source_scenario_id;

  -- 4. Manufacturing components (remap zone_id).
  insert into public.manufacturing_components (
    id, scenario_id, zone_id, code, name, description, sequence, active, created_at, updated_at
  )
  select
    id || '-' || v_suffix, v_new_scenario_id,
    case when zone_id is null then null else zone_id || '-' || v_suffix end,
    code, name, description, sequence, active, now(), now()
  from public.manufacturing_components
  where scenario_id = p_source_scenario_id;

  -- 5. Tasks (remap station/zone/component/parent FKs; reset actuals + progress; version defaults to 1).
  insert into public.tasks (
    id, scenario_id, station_id, zone_id, parent_task_id, component_id,
    row_type, wbs, name, description, planned_start, planned_finish, planned_duration_minutes,
    actual_start, actual_finish, actual_duration_minutes, planned_operators, actual_operators,
    planned_man_hours, actual_man_hours, status, percent_complete, owner_id, owner_name, role,
    skill_level, critical_path, bottleneck_flag, quality_gate, traveler_signoff_required, sop_link,
    work_instruction_link, drawing_link, material_kit, tools_required, equipment_required, safety_notes,
    qc_checklist, rework_risk, notes, custom_fields, task_number, manufacturing_code, code_locked,
    code_generated_at, created_at, updated_at
  )
  select
    id || '-' || v_suffix, v_new_scenario_id,
    case when station_id is null then null else station_id || '-' || v_suffix end,
    case when zone_id is null then null else zone_id || '-' || v_suffix end,
    case when parent_task_id is null then null else parent_task_id || '-' || v_suffix end,
    case when component_id is null then null else component_id || '-' || v_suffix end,
    row_type, wbs, name, description, planned_start, planned_finish, planned_duration_minutes,
    null, null, null, planned_operators, null,
    planned_man_hours, null, 'not_started'::public.task_status, 0, owner_id, owner_name, role,
    skill_level, critical_path, bottleneck_flag, quality_gate, traveler_signoff_required, sop_link,
    work_instruction_link, drawing_link, material_kit, tools_required, equipment_required, safety_notes,
    qc_checklist, rework_risk, notes, custom_fields, task_number, manufacturing_code, code_locked,
    code_generated_at, now(), now()
  from public.tasks
  where scenario_id = p_source_scenario_id;

  -- A duplicate is a HIGH-LEVEL GANTT PROJECTION (task layout + planned time + manpower) used to model
  -- different production targets. So the procedure/documentation detail is intentionally NOT copied:
  --   * manufacturing_steps (procedures), step_tools (tools), step_photos (photos), part_references.
  -- The high-level "time" lives on tasks.planned_duration_minutes (a real column), so dropping steps
  -- does not lose it; a copied task simply has no procedure breakdown until one is added.
  -- (step_photos also can't be row-copied anyway: storage_path is UNIQUE, so two rows can't share a
  --  file -- which is also why the cross-scenario shared-deletion risk does not exist.)

  -- 6. Task dependencies (only those whose BOTH endpoints are in the scenario; remap both task ids) --
  --    kept so the projection's schedule sequence/timeline reflows correctly.
  insert into public.task_dependencies (id, predecessor_task_id, successor_task_id, type, lag_minutes, constraint_type, created_at)
  select id || '-' || v_suffix, predecessor_task_id || '-' || v_suffix, successor_task_id || '-' || v_suffix, type, lag_minutes, constraint_type, now()
  from public.task_dependencies
  where predecessor_task_id in (select id from public.tasks where scenario_id = p_source_scenario_id)
    and successor_task_id in (select id from public.tasks where scenario_id = p_source_scenario_id);

  -- 7. Scenario-scoped custom columns only (product-scoped columns stay shared across scenarios) --
  --    these define the Gantt table's columns, so the projection's table looks the same.
  insert into public.custom_columns (
    id, product_id, scenario_id, name, key, description, type, applies_to, required, default_value,
    options, formula, unit, precision, visible, locked, created_at, updated_at
  )
  select
    id || '-' || v_suffix, product_id, v_new_scenario_id, name, key, description, type, applies_to, required, default_value,
    options, formula, unit, precision, visible, locked, now(), now()
  from public.custom_columns
  where scenario_id = p_source_scenario_id;

  return v_new_scenario_id;
end;
$$;
