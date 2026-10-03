-- Local-only platform compatibility. Never applied to the hosted project.
-- Older tables relied on hosted default DML grants instead of explicit migrations.
-- Limit compatibility grants to those legacy tables. New tables and explicit
-- revokes must retain their migration permissions; a blanket GRANT ALL would
-- silently re-enable writes to immutable releases and private delivery payloads.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select, insert, update, delete on
  public.actual_events,
  public.audit_log,
  public.custom_columns,
  public.department_members,
  public.departments,
  public.doc_number_counter,
  public.document_type_codes,
  public.manufacturing_components,
  public.manufacturing_steps,
  public.notification_preferences,
  public.org_tool_access,
  public.part_references,
  public.planning_item_master,
  public.platform_admins,
  public.products,
  public.profiles,
  public.project_access,
  public.projects,
  public.push_subscriptions,
  public.sales_order_lines,
  public.sales_orders,
  public.scenarios,
  public.schedule_imports,
  public.sop_job_titles,
  public.sop_rasic_roles,
  public.sop_review_annotations,
  public.sop_review_seats,
  public.space_access,
  public.stations,
  public.step_exploded_views,
  public.step_photos,
  public.step_tools,
  public.task_dependencies,
  public.task_videos,
  public.tasks,
  public.tool_library,
  public.trailer_configs,
  public.work_order_lines,
  public.work_order_template_lines,
  public.work_order_templates,
  public.work_orders,
  public.workspace_access_grants,
  public.workspace_auto_join_domains,
  public.workspace_integrations,
  public.workspace_members,
  public.workspace_revocations,
  public.workspaces,
  public.zones
to authenticated;
-- Legacy SOP tables have explicit write revokes but assumed default read/create grants.
grant select, insert, update on public.sops to authenticated;
grant select, insert on public.sop_revisions, public.sop_signatures to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Test helper: drive an in_review SOP to the point where its seats may sign.
--
-- The SOP lifecycle grew two preconditions that every pgTAP suite predates, and eight of them
-- rotted because each encoded the old flow inline:
--   * 20260715172000 — a seat cannot sign `dept_approval` until the author has requested final
--     approval, which itself requires every required approver to have returned "no changes"
--     against the SOP's CURRENT content_hash and review_cycle.
--   * 20260715190000 — a signer needs a saved handwritten signature before `dept_approval` or
--     `quality_approval`.
--
-- Living here rather than being pasted into each suite means the next lifecycle change is one
-- edit, not eight. Local only: seed.sql is never applied to the hosted project.
create or replace function public.test_ready_for_approval(p_sop text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sop    record;
  v_claims text;
begin
  select * into v_sop from public.sops where id = p_sop;
  if v_sop is null then raise exception 'test_ready_for_approval: SOP % not found', p_sop; end if;

  -- Every fixture user can sign. Cheaper than making each suite seed its own profiles, and the
  -- gate under test is never "did the signer draw a signature".
  insert into public.user_signature_profiles (user_id, signature_strokes)
  select u.id, '[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb
    from auth.users u
   where not exists (
     select 1 from public.user_signature_profiles p where p.user_id = u.id);

  -- One "no changes" draft review per required approver, bound to the CURRENT hash and cycle:
  -- a revision moves both, so this is re-runnable per cycle rather than once per SOP.
  insert into public.sop_review_submissions
    (sop_id, review_cycle, reviewer_id, reviewer_name, no_changes, content_hash)
  -- distinct: one signer may hold two seats on the same SOP, and the unique index over
  -- (sop_id, review_cycle, reviewer_id, content_hash) would reject the duplicate row. The NOT
  -- EXISTS below cannot catch it either -- it does not see rows inserted by its own statement.
  select distinct p_sop, v_sop.review_cycle, st.signer_id, 'Reviewer', true, v_sop.content_hash
    from public.sop_review_seats st
   where st.sop_id = p_sop
     and st.signer_id is not null
     and not exists (
       select 1 from public.sop_review_submissions s
        where s.sop_id = p_sop
          and s.reviewer_id = st.signer_id
          and s.review_cycle = v_sop.review_cycle
          and s.content_hash = v_sop.content_hash);

  -- request_sop_final_approval reads auth.uid() and admits only the author or submitter, so
  -- borrow that identity and hand the caller's own back afterwards.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', coalesce(v_sop.submitted_by, v_sop.created_by)::text,
      'role', 'authenticated')::text,
    true);
  perform public.request_sop_final_approval(p_sop);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;

-- Deliberately NOT granting on functions. Postgres already grants EXECUTE to PUBLIC by default,
-- and several migrations revoke it again on purpose -- `next_sop_number`,
-- `mint_sop_number_internal`, and `snapshot_sop_revision` must stay unreachable by
-- `authenticated`, since a client that can mint a number can reopen the numbering gaps that
-- deferred numbering closed. A blanket `grant all on all functions` here would silently undo
-- those revokes and make the security assertions in sops_enforcement_test pass vacuously.
