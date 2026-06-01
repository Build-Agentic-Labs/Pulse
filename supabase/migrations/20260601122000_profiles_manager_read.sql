-- Let workspace owners/admins (and platform superadmins) read the profiles of fellow
-- workspace members, so member names/emails show in the account UI. Previously profiles
-- were readable only by their owner (id = auth.uid()), so managers saw raw user ids
-- instead of names. Additive: the existing "profiles own read" policy still applies (OR).

create or replace function public.can_view_member_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.workspace_members target_m
      join public.workspace_members viewer_m
        on viewer_m.workspace_id = target_m.workspace_id
      where target_m.user_id = target_user_id
        and viewer_m.user_id = auth.uid()
        and viewer_m.role in ('owner', 'admin')
    );
$$;

drop policy if exists "profiles workspace manager read" on profiles;
create policy "profiles workspace manager read" on profiles
for select to authenticated
using (public.can_view_member_profile(id));
