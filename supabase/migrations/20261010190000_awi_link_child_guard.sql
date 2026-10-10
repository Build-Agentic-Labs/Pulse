-- Object-valued master links own their instructions in the master AWI.
-- Guard new children and task reassignment while allowing legacy child cleanup.
create or replace function private.refuse_linked_awi_task_child()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.tasks
    where id = new.task_id
      and jsonb_typeof(custom_fields -> 'awiMasterLink') = 'object'
  ) then
    raise exception 'Edit these instructions in the linked master AWI.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.refuse_linked_awi_task_child() from public, anon, authenticated;

create trigger awi_link_child_guard
before insert or update of task_id on public.manufacturing_steps
for each row execute function private.refuse_linked_awi_task_child();

create trigger awi_link_child_guard
before insert or update of task_id on public.part_references
for each row execute function private.refuse_linked_awi_task_child();

create trigger awi_link_child_guard
before insert or update of task_id on public.step_tools
for each row execute function private.refuse_linked_awi_task_child();

create trigger awi_link_child_guard
before insert or update of task_id on public.step_photos
for each row execute function private.refuse_linked_awi_task_child();

create trigger awi_link_child_guard
before insert or update of task_id on public.step_exploded_views
for each row execute function private.refuse_linked_awi_task_child();

create trigger awi_link_child_guard
before insert or update of task_id on public.task_videos
for each row execute function private.refuse_linked_awi_task_child();
