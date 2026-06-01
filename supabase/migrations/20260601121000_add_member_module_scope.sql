-- Per-member feature/module scoping.
-- An optional list of planner module ids a member may use (dashboard, setup, gantt,
-- procedure, work-instructions, balance, reports). NULL or an empty array means "all
-- modules", so existing members and grants are unaffected and keep full access.
-- This is a UI-level access control; row read/write is still governed by workspace_role + RLS.

alter table workspace_members
  add column if not exists modules text[];

alter table workspace_access_grants
  add column if not exists modules text[];

-- Carry the module scope from an access grant onto the membership it creates on first login.
-- Mirrors the existing redeem function but also copies modules.
create or replace function public.redeem_workspace_access_grants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
  inserted_count integer := 0;
begin
  if auth.uid() is null or current_email = '' or current_email not like '%@anacorp.com' then
    return 0;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, modules)
  select grant_row.workspace_id, auth.uid(), grant_row.role, grant_row.modules
  from public.workspace_access_grants grant_row
  where grant_row.email = current_email
    and not exists (
      select 1
      from public.workspace_members member_row
      where member_row.workspace_id = grant_row.workspace_id
        and member_row.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  update public.workspace_access_grants
  set redeemed_by = coalesce(redeemed_by, auth.uid()),
      redeemed_at = coalesce(redeemed_at, now())
  where email = current_email;

  return inserted_count;
end;
$$;
