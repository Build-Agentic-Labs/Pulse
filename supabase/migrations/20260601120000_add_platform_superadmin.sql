-- Platform-wide superadmin support.
-- A superadmin sits above all workspaces: full access to every workspace through
-- has_workspace_role(), and may create new workspaces. Membership is email-based so it
-- can be seeded before the user account exists, mirroring workspace_access_grants.

create table if not exists platform_admins (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint platform_admins_email_normalized check (email = lower(btrim(email))),
  constraint platform_admins_anacorp_email check (email like '%@anacorp.com')
);

alter table platform_admins enable row level security;

-- True when the authenticated user's email is on the platform admin list.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.email = lower(btrim(coalesce(auth.jwt()->>'email', '')))
  );
$$;

-- Only superadmins can see the admin list. The list itself is managed through migrations
-- or the service role, never via end-user writes (no insert/update/delete policies).
drop policy if exists "platform_admins superadmin read" on platform_admins;
create policy "platform_admins superadmin read" on platform_admins
for select to authenticated
using (public.is_super_admin());

-- Fold superadmin into the central role check. Every existing RLS policy that calls
-- has_workspace_role() now grants superadmins full access across all workspaces, with no
-- per-table policy changes required.
create or replace function public.has_workspace_role(target_workspace_id text, allowed_roles workspace_role[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = auth.uid()
        and wm.role = any(allowed_roles)
    )
    or (
      'owner' = any(allowed_roles)
      and exists (
        select 1
        from public.workspaces w
        where w.id = target_workspace_id
          and w.owner_id = auth.uid()
      )
    );
$$;

-- Keep workspace creation locked. There is no UI for creating workspaces in this app
-- (Pulse serves one company with a fixed workspace), so direct inserts stay disabled.
-- Superadmins still get full read/update/delete everywhere via has_workspace_role().
drop policy if exists "workspaces superadmin insert" on workspaces;
drop policy if exists "workspaces admin controlled insert" on workspaces;
create policy "workspaces admin controlled insert" on workspaces
for insert to authenticated
with check (false);

-- Seeding is environment-specific and lives outside migration history (audit #5):
-- run scripts/seed-workspace-defaults.mjs to add the founding superadmin.
