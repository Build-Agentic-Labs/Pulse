-- Link SOPs to their owning department. Nullable during migration; existing rows are
-- backfilled to a seeded per-workspace "Unassigned" department so they remain governable
-- (a dept with no members resolves to managers-only via has_department_role).
alter table public.sops add column if not exists department_id text references public.departments(id);
create index if not exists sops_department_id_idx on public.sops (department_id);

do $$
declare ws record; dept_id text;
begin
  for ws in select distinct workspace_id from public.sops where department_id is null loop
    select id into dept_id from public.departments
      where workspace_id = ws.workspace_id and lower(btrim(code)) = 'una' limit 1;
    if dept_id is null then
      dept_id := gen_random_uuid()::text;
      insert into public.departments (id, workspace_id, code, name, is_quality_gate)
      values (dept_id, ws.workspace_id, 'UNA', 'Unassigned', false)
      on conflict do nothing;
      -- re-read in case of a concurrent/conflicting insert
      select id into dept_id from public.departments
        where workspace_id = ws.workspace_id and lower(btrim(code)) = 'una' limit 1;
    end if;
    update public.sops set department_id = dept_id
      where workspace_id = ws.workspace_id and department_id is null;
  end loop;
end $$;
