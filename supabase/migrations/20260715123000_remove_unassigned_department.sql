-- New and converted SOPs now require an explicit owning department. Remove the legacy
-- Unassigned bucket once it has no active documents; soft-deleted legacy rows no longer need
-- to retain that placeholder foreign key.
update public.sops s
set department_id = null
from public.departments d
where s.department_id = d.id
  and s.deleted_at is not null
  and upper(btrim(d.code)) = 'UNA'
  and lower(btrim(d.name)) = 'unassigned';

delete from public.departments d
where upper(btrim(d.code)) = 'UNA'
  and lower(btrim(d.name)) = 'unassigned'
  and not exists (
    select 1 from public.sops s where s.department_id = d.id
  );
