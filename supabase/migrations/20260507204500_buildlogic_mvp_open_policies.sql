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
    execute format('drop policy if exists "mvp anon read %I" on %I', table_name, table_name);
    execute format('drop policy if exists "mvp anon insert %I" on %I', table_name, table_name);
    execute format('drop policy if exists "mvp anon update %I" on %I', table_name, table_name);
    execute format('drop policy if exists "mvp anon delete %I" on %I', table_name, table_name);

    execute format('create policy "mvp anon read %I" on %I for select to anon using (true)', table_name, table_name);
    execute format('create policy "mvp anon insert %I" on %I for insert to anon with check (true)', table_name, table_name);
    execute format('create policy "mvp anon update %I" on %I for update to anon using (true) with check (true)', table_name, table_name);
    execute format('create policy "mvp anon delete %I" on %I for delete to anon using (true)', table_name, table_name);
  end loop;
end $$;
