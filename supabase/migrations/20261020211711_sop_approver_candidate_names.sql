-- Candidate names are available only to callers who can edit or reassign this roster.
-- Keep profile RLS intact; this projection exposes no email or other profile fields.
create or replace function public.sop_approver_candidate_names(p_sop text)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select distinct member.user_id, nullif(btrim(profile.full_name), '')
  from public.sops sop
  join public.departments department on department.workspace_id = sop.workspace_id
  join public.department_members member on member.department_id = department.id
  join public.profiles profile on profile.id = member.user_id
  where sop.id = p_sop and sop.deleted_at is null and auth.uid() is not null
    and sop.status in ('draft', 'in_review')
    and (public.can_edit_sop_roster(sop.id) or public.has_workspace_role(
      sop.workspace_id, array['owner','admin']::public.workspace_role[]))
    and public.is_sop_approver_candidate(department.id, member.user_id);
$$;
revoke all on function public.sop_approver_candidate_names(text) from public, anon;
grant execute on function public.sop_approver_candidate_names(text) to authenticated;
