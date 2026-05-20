do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'products',
    'scenarios',
    'stations',
    'zones',
    'tasks',
    'task_dependencies',
    'manufacturing_steps',
    'part_references',
    'actual_events',
    'custom_columns'
  ]
  loop
    execute format('alter table public.%I replica identity full', table_name);

    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then
        null;
      when undefined_object then
        null;
    end;
  end loop;
end $$;
