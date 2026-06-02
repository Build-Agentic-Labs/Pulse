-- Per-project RLS isolation, part 2: manufacturing_components & document_type_codes.
--
-- These two tables were introduced in 20260527193000 AFTER the v1 user-access model, so the
-- per-project rewrite in 20260601124000 never touched them. They still gated reads/writes on
-- bare workspace membership (any member of the workspace, any role for reads), which means a
-- member explicitly granted 'none' on a project via project_access could still read/write that
-- project's components and document-type codes by calling PostgREST directly -- the exact gap
-- 124000 was written to close for the other 13 data tables.
--
-- This migration closes it the same way, reusing has_project_access() and the existing
-- *_project_id resolvers. Access tiers match 124000 (access_level: none < view < edit):
--   read -> 'view', insert/update/delete -> 'edit'. Managers (owner/admin), the workspace
-- owner, and superadmins remain unrestricted via has_workspace_role inside has_project_access.
--
-- Additive & non-destructive: only replaces policy bodies and adds one resolver function.
-- No table, column, or row is touched, so the 123000 backfill (edit/view on every current
-- project for every current member) means existing members keep exactly their current access.

-- ---------------------------------------------------------------------------
-- Resolver: a document_type_code is scoped to a project directly (project_id) OR via a
-- product (product_id). Prefer the explicit project_id; fall back to the product's project.
-- Mirrors custom_column_project_id from 124000. SECURITY DEFINER + STABLE so it bypasses RLS
-- on the joined tables (no recursion) and is cached per distinct argument within a statement.
-- ---------------------------------------------------------------------------
create or replace function public.document_type_code_project_id(target_project_id text, target_product_id text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    target_project_id,
    case when target_product_id is not null then public.product_project_id(target_product_id) end
  );
$$;

-- ===========================================================================
-- manufacturing_components (resolve project via scenario_id).
-- ===========================================================================
drop policy if exists "manufacturing_components workspace read" on manufacturing_components;
create policy "manufacturing_components workspace read" on manufacturing_components
for select to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'view'::access_level));

drop policy if exists "manufacturing_components workspace insert" on manufacturing_components;
create policy "manufacturing_components workspace insert" on manufacturing_components
for insert to authenticated
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "manufacturing_components workspace update" on manufacturing_components;
create policy "manufacturing_components workspace update" on manufacturing_components
for update to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level))
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "manufacturing_components workspace delete" on manufacturing_components;
create policy "manufacturing_components workspace delete" on manufacturing_components
for delete to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

-- ===========================================================================
-- document_type_codes (resolve project via project_id or product_id).
-- ===========================================================================
drop policy if exists "document_type_codes workspace read" on document_type_codes;
create policy "document_type_codes workspace read" on document_type_codes
for select to authenticated
using (public.has_project_access(public.document_type_code_project_id(project_id, product_id), 'view'::access_level));

drop policy if exists "document_type_codes workspace insert" on document_type_codes;
create policy "document_type_codes workspace insert" on document_type_codes
for insert to authenticated
with check (public.has_project_access(public.document_type_code_project_id(project_id, product_id), 'edit'::access_level));

drop policy if exists "document_type_codes workspace update" on document_type_codes;
create policy "document_type_codes workspace update" on document_type_codes
for update to authenticated
using (public.has_project_access(public.document_type_code_project_id(project_id, product_id), 'edit'::access_level))
with check (public.has_project_access(public.document_type_code_project_id(project_id, product_id), 'edit'::access_level));

drop policy if exists "document_type_codes workspace delete" on document_type_codes;
create policy "document_type_codes workspace delete" on document_type_codes
for delete to authenticated
using (public.has_project_access(public.document_type_code_project_id(project_id, product_id), 'edit'::access_level));
