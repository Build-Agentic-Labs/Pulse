-- Department SOP demand targets power the Quality dashboard's completion math.
-- Existing department RLS remains the complete policy: every Quality viewer can
-- read targets, while only workspace owners/admins can change a department row.

alter table public.departments
  add column if not exists sop_target integer not null default 0;

alter table public.departments
  add constraint departments_sop_target_range
  check (sop_target between 0 and 100000);

comment on column public.departments.sop_target is
  'Required SOP count for this department. Effective SOPs divided by this target produces dashboard completion.';
