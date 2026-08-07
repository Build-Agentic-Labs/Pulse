-- Store the selected Quality Module access on a pending invitation and apply it
-- automatically when the invited user confirms their email and first enters Pulse.

alter table public.workspace_access_grants
  add column if not exists quality_access public.access_level not null default 'none';

create or replace function public.redeem_workspace_access_grants()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  current_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
  current_domain text;
  grant_count integer := 0;
  auto_join_count integer := 0;
begin
  if auth.uid() is null or current_email = '' or position('@' in current_email) = 0 then
    return 0;
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    return 0;
  end if;

  current_domain := split_part(current_email, '@', 2);

  insert into public.workspace_members (workspace_id, user_id, role, modules)
  select grant_row.workspace_id, auth.uid(), grant_row.role, grant_row.modules
  from public.workspace_access_grants grant_row
  where grant_row.email = current_email
    and grant_row.expires_at > now()
    and not exists (
      select 1
      from public.workspace_revocations revocation
      where revocation.workspace_id = grant_row.workspace_id
        and revocation.email = current_email
    )
    and not exists (
      select 1
      from public.workspace_members member_row
      where member_row.workspace_id = grant_row.workspace_id
        and member_row.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics grant_count = row_count;

  -- org_tool_access is currently user-scoped. The newest highest-access valid
  -- invitation wins when one address has invitations to more than one workspace.
  insert into public.org_tool_access (user_id, level, granted_by)
  select auth.uid(), grant_row.quality_access, grant_row.granted_by
  from public.workspace_access_grants grant_row
  where grant_row.email = current_email
    and grant_row.expires_at > now()
    and grant_row.redeemed_at is null
    and grant_row.quality_access <> 'none'::public.access_level
    and not exists (
      select 1
      from public.workspace_revocations revocation
      where revocation.workspace_id = grant_row.workspace_id
        and revocation.email = current_email
    )
  order by grant_row.quality_access desc, grant_row.updated_at desc
  limit 1
  on conflict (user_id) do update
    set level = excluded.level,
        granted_by = excluded.granted_by,
        updated_at = now();

  update public.workspace_access_grants
  set redeemed_by = coalesce(redeemed_by, auth.uid()),
      redeemed_at = coalesce(redeemed_at, now())
  where email = current_email
    and redeemed_at is null
    and expires_at > now();

  insert into public.workspace_members (workspace_id, user_id, role)
  select rule.workspace_id, auth.uid(), rule.role
  from public.workspace_auto_join_domains rule
  where rule.domain = current_domain
    and not exists (
      select 1
      from public.workspace_revocations revocation
      where revocation.workspace_id = rule.workspace_id
        and revocation.email = current_email
    )
    and not exists (
      select 1
      from public.workspace_members member_row
      where member_row.workspace_id = rule.workspace_id
        and member_row.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics auto_join_count = row_count;

  return grant_count + auto_join_count;
end;
$$;
