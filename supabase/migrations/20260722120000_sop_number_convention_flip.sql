-- SOP numbering convention flip: DEPT-TYPE-NNN -> TYPE-DEPT-NNN (QA-SOP-014 -> SOP-QAS-014).
-- Owner-approved 2026-07-22, docs/superpowers/specs/2026-07-22-sop-numbering-convention-design.md.
--   1. next_sop_number() now builds TYPE-CODE-NNN. Same auth, same race-safe counter (keyed by
--      department id, so renames below do not reset sequences), same collision-skip loop.
--   2. Department code renames to the approved roster: SAL->INS, PRD->MFG, QA->QAS.
--   3. OPS (scope now Manufacturing) and PRC (scope now Purchasing) are removed — verified empty;
--      every guard below re-verifies rather than trusting that snapshot.
--   4. Every existing old-style number is rewritten in place, released documents included (owner
--      decision). Both sops.sop_number and the jsonb meta copy move: the save path syncs the
--      column FROM meta.sopNumber, so a column-only rewrite would revert on the next edit.
--      sops_aa_set_content_hash stays enabled so row hashes track the edited jsonb; the one
--      in-flight review's authorship signature goes stale by design (re-sign via draft).
--      sop_revisions snapshots and sop_signatures are deliberately untouched — signatures bind
--      to snapshot content hashes, and the historical record keeps the number it was signed under.

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

    v_candidate := upper(p_doc_type) || '-' || upper(v_code) || '-' || lpad(v_seq::text, 3, '0');

    exit when not exists (
      select 1 from public.sops
      where workspace_id = p_workspace
        and deleted_at is null
        and lower(btrim(sop_number)) = lower(v_candidate)
    );
  end loop;

  return v_candidate;
end $$;

do $$
declare
  dept record;
  ren  record;
  v_renumbered int;
begin
  -- Old code per department id, captured before any rename so the renumber step can still
  -- recognize numbers minted under the old code.
  create temp table _dept_old_code on commit drop as
    select id, workspace_id, upper(btrim(code)) as old_code from public.departments;

  -- 2. Renames, matched by code + name exactly like the earlier PEN->PRO migration. The
  -- (workspace, lower(code)) unique index is the last line of defense; guard first for a
  -- readable error.
  for ren in
    select * from (values
      ('SAL', 'inside sales',             'INS'),
      ('PRD', 'manufacturing/production', 'MFG'),
      ('QA',  'quality',                  'QAS')
    ) as t(old_code, dept_name, new_code)
  loop
    for dept in
      select id, workspace_id from public.departments
      where upper(btrim(code)) = ren.old_code
        and lower(btrim(name)) = ren.dept_name
    loop
      if exists (
        select 1 from public.departments
        where workspace_id = dept.workspace_id
          and id <> dept.id
          and upper(btrim(code)) = ren.new_code
      ) then
        raise exception 'Cannot rename % to %: that code already exists in workspace %',
          ren.old_code, ren.new_code, dept.workspace_id;
      end if;
      update public.departments set code = ren.new_code where id = dept.id;
    end loop;
  end loop;

  -- 3. Remove OPS and PRC. sops.department_id and sop_review_seats FKs would block a delete,
  -- but department_members and doc_number_counter cascade — so verify true emptiness first.
  for dept in
    select d.id, d.code, d.workspace_id from public.departments d
    where (upper(btrim(d.code)) = 'OPS' and lower(btrim(d.name)) = 'operations')
       or (upper(btrim(d.code)) = 'PRC' and lower(btrim(d.name)) = 'procurement')
  loop
    if exists (select 1 from public.sops where department_id = dept.id)
       or exists (select 1 from public.department_members where department_id = dept.id)
       or exists (select 1 from public.doc_number_counter where department_id = dept.id)
       or exists (select 1 from public.sop_review_seats where department_id = dept.id)
       or exists (select 1 from public.sop_signatures where seat_department_id = dept.id) then
      raise exception 'Department % is not empty; refusing to delete it', dept.code;
    end if;
    delete from public.departments where id = dept.id;
  end loop;

  -- 4. Renumber. The transition guard rightly blocks sop_number changes on non-draft rows for
  -- every application caller; this identity migration is the one sanctioned exception.
  alter table public.sops disable trigger sops_enforce_transition;

  with renum as (
    select s.id,
           m.parts[1] || '-' || upper(btrim(d.code)) || '-' || m.parts[2] as new_number
    from public.sops s
    join _dept_old_code o on o.id = s.department_id
    join public.departments d on d.id = s.department_id
    cross join lateral regexp_match(
      upper(btrim(s.sop_number)),
      '^' || o.old_code || '-([A-Z0-9]+)-([0-9]+)$'
    ) as m(parts)
    where s.deleted_at is null
      and s.sop_number is not null
  )
  update public.sops s
  set sop_number = renum.new_number,
      document = case
        when s.document #>> '{meta,sopNumber}' is not null
          then jsonb_set(s.document, '{meta,sopNumber}', to_jsonb(renum.new_number), true)
        else s.document
      end
  from renum
  where s.id = renum.id;

  get diagnostics v_renumbered = row_count;
  raise notice 'Renumbered % SOP(s) to TYPE-DEPT-NNN', v_renumbered;

  alter table public.sops enable trigger sops_enforce_transition;

  -- Post-condition: every structured number now leads with its doc_type. Placeholder /
  -- free-text numbers (e.g. <UNKNOWN>) do not match the shape and are exempt.
  if exists (
    select 1 from public.sops
    where deleted_at is null
      and sop_number ~ '^[A-Za-z0-9]+-[A-Za-z0-9]+-[0-9]+$'
      and upper(split_part(sop_number, '-', 1)) <> upper(doc_type)
  ) then
    raise exception 'Old-style DEPT-TYPE-NNN numbers remain after renumbering';
  end if;
end $$;
