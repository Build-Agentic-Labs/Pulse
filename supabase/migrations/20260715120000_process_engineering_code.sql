-- Correct the Process Engineering department code. Department codes drive future
-- DEPT-TYPE-NNN document numbers, so the existing draft number is corrected in the same
-- transaction. Released document identities remain untouched.
do $$
declare
  dept record;
begin
  for dept in
    select id, workspace_id
    from public.departments
    where upper(btrim(code)) = 'PEN'
      and lower(btrim(name)) = 'process engineering'
  loop
    if exists (
      select 1
      from public.departments
      where workspace_id = dept.workspace_id
        and id <> dept.id
        and upper(btrim(code)) = 'PRO'
    ) then
      raise exception 'Cannot rename Process Engineering to PRO: that code already exists';
    end if;

    update public.sops
    set sop_number = 'PRO-' || substring(sop_number from 5),
        document = jsonb_set(
          document,
          '{meta,sopNumber}',
          to_jsonb(('PRO-' || substring(sop_number from 5))::text),
          true
        )
    where department_id = dept.id
      and status = 'draft'
      and upper(sop_number) like 'PEN-%';

    update public.departments
    set code = 'PRO'
    where id = dept.id;
  end loop;
end $$;
