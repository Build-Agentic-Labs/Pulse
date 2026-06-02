-- Harden every SECURITY DEFINER function to search_path = '' (audit #8).
--
-- A SECURITY DEFINER function runs with the definer's privileges and bypasses RLS, so an
-- attacker-controllable search_path could let a planted object in an earlier schema shadow an
-- unqualified reference. search_path = '' forces every reference to be schema-qualified, closing
-- that vector. All bodies were audited and are already fully public.-qualified EXCEPT one cast
-- in has_project_access, which is fixed below.
--
-- For the 17 already-qualified functions we ALTER only the search_path setting, leaving the body
-- byte-for-byte untouched (no transcription risk). Each is then smoke-called by the applier under
-- the new search_path = '' to prove its references still resolve.

alter function public.can_view_member_profile(uuid) set search_path = '';
alter function public.custom_column_project_id(text, text) set search_path = '';
alter function public.custom_column_workspace_id(text, text) set search_path = '';
alter function public.document_type_code_project_id(text, text) set search_path = '';
alter function public.handle_new_user_profile() set search_path = '';
alter function public.has_workspace_role(text, public.workspace_role[]) set search_path = '';
alter function public.is_super_admin() set search_path = '';
alter function public.product_project_id(text) set search_path = '';
alter function public.product_workspace_id(text) set search_path = '';
alter function public.project_workspace(text) set search_path = '';
alter function public.project_workspace_id(text) set search_path = '';
alter function public.redeem_workspace_access_grants() set search_path = '';
alter function public.scenario_project_id(text) set search_path = '';
alter function public.scenario_workspace_id(text) set search_path = '';
alter function public.task_project_id(text) set search_path = '';
alter function public.task_workspace_id(text) set search_path = '';
alter function public.workspace_has_members(text) set search_path = '';

-- has_project_access: qualify the workspace_role[] cast (was bare ::workspace_role[]) so the body
-- resolves under search_path = ''. Body otherwise identical to 20260601124000.
create or replace function public.has_project_access(target_project_id text, min_level public.access_level)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    target_project_id is not null
    and (
      public.has_workspace_role(
        public.project_workspace_id(target_project_id),
        array['owner', 'admin']::public.workspace_role[]
      )
      or exists (
        select 1
        from public.project_access pa
        where pa.project_id = target_project_id
          and pa.user_id = auth.uid()
          and pa.level >= min_level
      )
    );
$$;
