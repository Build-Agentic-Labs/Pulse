-- Transactional DEPT-TYPE-NNN numbering. A per-(workspace,department,doc_type) counter,
-- minted only through the SECURITY DEFINER function (which internally authorizes the caller
-- and skips any value that would collide with an existing sop_number).
create table if not exists public.doc_number_counter (
  workspace_id  text not null,
  department_id text not null references public.departments(id) on delete cascade,
  doc_type      text not null,
  next_seq      int  not null default 1,
  primary key (workspace_id, department_id, doc_type)
);

alter table public.doc_number_counter enable row level security;
-- No policies: the table is reachable only through next_sop_number() (definer).

create or replace function public.next_sop_number(
  p_workspace text,
  p_department text,
  p_doc_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_seq  int;
  v_candidate text;
begin
  -- Authorize: caller must hold any department role (managers/superadmin fold in) and the
  -- department must belong to the workspace.
  if not public.has_department_role(
       p_department,
       array['author', 'reviewer', 'approver']::public.department_sop_role[]) then
    raise exception 'Not authorized to mint numbers for this department';
  end if;

  select code into v_code from public.departments
    where id = p_department and workspace_id = p_workspace;
  if v_code is null then
    raise exception 'Department % not in workspace %', p_department, p_workspace;
  end if;

  -- Atomic bump (race-safe including first mint), then skip any candidate that collides with
  -- an existing (non-deleted) sop_number so legacy/free-text numbers can never clash.
  loop
    insert into public.doc_number_counter (workspace_id, department_id, doc_type, next_seq)
      values (p_workspace, p_department, p_doc_type, 2)
    on conflict (workspace_id, department_id, doc_type)
      do update set next_seq = public.doc_number_counter.next_seq + 1
    returning next_seq - 1 into v_seq;

    v_candidate := upper(v_code) || '-' || upper(p_doc_type) || '-' || lpad(v_seq::text, 3, '0');

    exit when not exists (
      select 1 from public.sops
      where workspace_id = p_workspace
        and deleted_at is null
        and lower(btrim(sop_number)) = lower(v_candidate)
    );
  end loop;

  return v_candidate;
end $$;
