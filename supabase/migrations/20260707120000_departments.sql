-- Departments: first-class owning entity for SOPs, admin-managed. A person may belong
-- to many departments with a different role in each. Exactly one department per workspace
-- may be flagged is_quality_gate — its approvers are the independent cross-department gate.
create table if not exists public.departments (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  code          text not null,
  name          text not null,
  is_quality_gate boolean not null default false,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One active code per workspace (code is used in DEPT-TYPE-NNN numbering; treated as
-- immutable once a number is minted — enforced in the app).
create unique index if not exists departments_ws_code_uidx
  on public.departments (workspace_id, lower(btrim(code)));
-- At most one Quality gate per workspace.
create unique index if not exists departments_one_quality_gate_uidx
  on public.departments (workspace_id) where is_quality_gate;
create index if not exists departments_workspace_id_idx on public.departments (workspace_id);

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
before update on public.departments
for each row execute function set_updated_at();

do $$ begin
  if not exists (select 1 from pg_type where typname = 'department_sop_role') then
    create type public.department_sop_role as enum ('author', 'reviewer', 'approver');
  end if;
end $$;

-- Membership: cumulative role (approver >= reviewer >= author) per department.
create table if not exists public.department_members (
  department_id text not null references public.departments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  dept_role     public.department_sop_role not null default 'author',
  granted_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  primary key (department_id, user_id)
);
create index if not exists department_members_user_idx on public.department_members (user_id);

drop trigger if exists department_members_set_updated_at on public.department_members;
create trigger department_members_set_updated_at
before update on public.department_members
for each row execute function set_updated_at();

-- Does auth.uid() hold >= any of `roles` in this department, OR act as an org-wide
-- Quality approver (approver in a is_quality_gate dept of the same workspace)? Workspace
-- managers/superadmin fold in via has_workspace_role for dept-scoped convenience — but the
-- Quality branch does NOT fold managers in, so the independent gate needs real membership.
create or replace function public.has_department_role(
  dept_id text,
  roles public.department_sop_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select workspace_id from public.departments where id = dept_id)
  select dept_id is not null and (
    exists (
      select 1 from public.department_members m
      where m.department_id = dept_id
        and m.user_id = auth.uid()
        and m.dept_role = any(roles)
    )
    or (
      'approver' = any(roles) and exists (
        select 1
        from public.department_members m
        join public.departments q on q.id = m.department_id
        where m.user_id = auth.uid()
          and m.dept_role = 'approver'
          and q.is_quality_gate
          and q.workspace_id = (select workspace_id from d)
      )
    )
    or public.has_workspace_role(
      (select workspace_id from d),
      array['owner', 'admin']::public.workspace_role[]
    )
  );
$$;

alter table public.departments enable row level security;
alter table public.department_members enable row level security;

drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments
for select using (public.has_org_tool_access(workspace_id, 'view'::public.access_level));

drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
for all
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists department_members_read on public.department_members;
create policy department_members_read on public.department_members
for select using (
  user_id = auth.uid()
  or exists (
    select 1 from public.departments d
    where d.id = department_id
      and public.has_workspace_role(d.workspace_id, array['owner', 'admin']::public.workspace_role[])
  )
);

drop policy if exists department_members_write on public.department_members;
create policy department_members_write on public.department_members
for all
using (exists (
  select 1 from public.departments d
  where d.id = department_id
    and public.has_workspace_role(d.workspace_id, array['owner', 'admin']::public.workspace_role[])
))
with check (exists (
  select 1 from public.departments d
  where d.id = department_id
    and public.has_workspace_role(d.workspace_id, array['owner', 'admin']::public.workspace_role[])
));
