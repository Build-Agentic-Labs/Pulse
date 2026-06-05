-- delete_scenario(id): delete a scenario and all its data, with a DB-level guard that refuses to
-- delete the canonical "Main" scenario (the product's earliest-created scenario) or the only scenario.
-- This is defense-in-depth: the UI also hides delete for Main, but the guard lives here too so Main
-- can never be removed regardless of caller. Children cascade via the existing ON DELETE CASCADE FKs
-- (stations/zones/components/tasks -> steps/tools/photos/deps/parts). SECURITY DEFINER, search_path=''.

create or replace function public.delete_scenario(p_scenario_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id text;
  v_earliest_id text;
  v_count integer;
begin
  select product_id into v_product_id from public.scenarios where id = p_scenario_id;
  if v_product_id is null then
    raise exception 'delete_scenario: scenario % not found', p_scenario_id;
  end if;

  select count(*) into v_count from public.scenarios where product_id = v_product_id;
  if v_count <= 1 then
    raise exception 'delete_scenario: refusing to delete the only scenario for the product';
  end if;

  select id into v_earliest_id
  from public.scenarios
  where product_id = v_product_id
  order by created_at asc
  limit 1;

  if p_scenario_id = v_earliest_id then
    raise exception 'delete_scenario: refusing to delete the Main (earliest) scenario';
  end if;

  delete from public.scenarios where id = p_scenario_id;
end;
$$;
