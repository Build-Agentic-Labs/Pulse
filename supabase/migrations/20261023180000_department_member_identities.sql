-- Read-only identity lookup for department settings, including pending invitations.
-- Does not alter memberships, SOPs, signatures or assignments.
create function public.list_department_member_identities(p_workspace text)
returns table(user_id uuid,full_name text,email text)
language sql stable security definer set search_path='' as $$
 select distinct p.id,p.full_name,p.email
 from public.department_members m
 join public.departments d on d.id=m.department_id
 join public.profiles p on p.id=m.user_id
 where d.workspace_id=p_workspace and auth.uid() is not null
 and (public.has_workspace_role(p_workspace,array['owner','admin']::public.workspace_role[]) or public.is_super_admin());
$$;
revoke all on function public.list_department_member_identities(text) from public,anon;
grant execute on function public.list_department_member_identities(text) to authenticated;
