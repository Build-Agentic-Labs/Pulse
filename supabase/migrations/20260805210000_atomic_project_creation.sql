-- Create the complete starter project in one database transaction.
--
-- Project creation used to happen as a sequence of browser writes: projects first,
-- planner rows second, and creator access last. After per-project RLS was enabled,
-- an editor could insert the project row but not the first product row. The attempted
-- browser rollback was also denied, leaving an active, empty project behind.
--
-- This RPC is SECURITY DEFINER so the transaction can establish the creator's access
-- before inserting project-scoped rows. Authorization is still explicit: only a
-- workspace owner/admin/editor (or the existing superadmin bypass inside
-- has_workspace_role) may call it.

create or replace function public.create_project_with_starter_plan(
  p_workspace_id text,
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_name_key text;
  v_suffix text := gen_random_uuid()::text;
  v_project_id text := 'project-' || v_suffix;
  v_product_id text := 'product-' || v_suffix;
  v_scenario_id text := 'scenario-' || v_suffix;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Sign in to create a project.';
  end if;

  if v_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Project name is required.';
  end if;

  v_name_key := lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  if v_name_key = '' then
    raise exception using
      errcode = '22023',
      message = 'Project name must contain a letter or number.';
  end if;

  if not public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin', 'editor']::public.workspace_role[]
  ) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to create projects in this organization.';
  end if;

  -- Serialize same-name creates inside one workspace. This closes the small window
  -- where two browser submissions could both pass the existence check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id || ':' || v_name_key, 0)
  );

  if exists (
    select 1
    from public.projects p
    where p.workspace_id = p_workspace_id
      and p.status = 'active'::public.project_status
      and lower(regexp_replace(btrim(p.name), '[^[:alnum:]]+', '', 'g')) = v_name_key
  ) then
    raise exception using
      errcode = '23505',
      message = 'An active project with the same name already exists.';
  end if;

  insert into public.projects (
    id, workspace_id, name, status, created_by, created_at, updated_at
  ) values (
    v_project_id, p_workspace_id, v_name, 'active', v_user_id, v_now, v_now
  );

  -- Establish access before any project-scoped child rows are created.
  insert into public.project_access (
    project_id, user_id, level, granted_by, created_at, updated_at
  ) values (
    v_project_id, v_user_id, 'edit', v_user_id, v_now, v_now
  );

  -- Match createEmptyPlannerStateForProject() exactly: one draft product with
  -- the standard shift calendar and its calculated availability/takt values.
  insert into public.products (
    id, project_id, name, revision, owner_name, status,
    target_man_hours, demand_quantity, demand_period,
    gross_available_minutes, break_minutes, lunch_minutes, meeting_minutes,
    planned_downtime_minutes, work_days_per_week, work_weeks_per_month,
    available_work_days_per_month, net_available_minutes,
    weekly_available_minutes, monthly_available_minutes,
    calculated_takt_minutes, manual_takt_minutes, active_takt_minutes,
    custom_fields, created_at, updated_at
  ) values (
    v_product_id, v_project_id, v_name, '', '', 'draft',
    0, 1, 'day',
    540, 30, 60, 15,
    15, 5, 4.33,
    21.65, 420,
    2100, 9093,
    420, null, 420,
    '{}'::jsonb, v_now, v_now
  );

  insert into public.scenarios (
    id, product_id, name, type, status,
    target_output, target_output_period, created_at, updated_at
  ) values (
    v_scenario_id, v_product_id, 'Current State', 'current_state', 'draft',
    1, 'day', v_now, v_now
  );

  insert into public.document_type_codes (
    id, product_id, code, name, active, created_at, updated_at
  ) values
    ('document-type-' || v_product_id || '-wi',  v_product_id, 'WI',  'Work Instruction', true, v_now, v_now),
    ('document-type-' || v_product_id || '-qc',  v_product_id, 'QC',  'Quality Check',    true, v_now, v_now),
    ('document-type-' || v_product_id || '-mat', v_product_id, 'MAT', 'Material List',    true, v_now, v_now),
    ('document-type-' || v_product_id || '-trv', v_product_id, 'TRV', 'Traveler',         true, v_now, v_now);

  return v_project_id;
end;
$$;

revoke all on function public.create_project_with_starter_plan(text, text) from public, anon;
grant execute on function public.create_project_with_starter_plan(text, text) to authenticated, service_role;
