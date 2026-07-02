-- Audit 2026-07-01 remediation (#14): is_super_admin() matched the raw JWT email claim
-- with no confirmation check. If Supabase's "Confirm email" were ever disabled, whoever
-- registered a seeded-but-unregistered platform_admins email first would get full
-- cross-workspace access. Now the check resolves the caller's email from auth.users and
-- requires email_confirmed_at — same standard redeem_workspace_access_grants already
-- applies (20260612120000).

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    join auth.users u on u.id = auth.uid()
    where u.email_confirmed_at is not null
      and pa.email = lower(btrim(coalesce(u.email, '')))
  );
$$;
