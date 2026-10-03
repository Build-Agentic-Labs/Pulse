-- The current scope is directory structure only. Remove the unused empty linking tables.
do $$ begin
  if exists (select 1 from public.awi_product_links) or exists (select 1 from public.awi_master_entries) then
    raise exception 'AWI tables contain data; cannot defer';
  end if;
end $$;
drop table public.awi_product_links;
drop table public.awi_master_entries;
