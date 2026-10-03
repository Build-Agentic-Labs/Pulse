-- Give existing products a stable order, retaining their original creation sequence.
alter table public.projects add column portfolio_position double precision;
with ordered as (
  select id, row_number() over (partition by workspace_id, portfolio_category order by created_at, id) * 1024 as position
  from public.projects
)
update public.projects p set portfolio_position = ordered.position from ordered where p.id = ordered.id;
alter table public.projects alter column portfolio_position set default (extract(epoch from now()) * 1000);
alter table public.projects alter column portfolio_position set not null;
alter table public.projects add constraint projects_portfolio_position_finite
  check (portfolio_position > '-Infinity'::double precision and portfolio_position < 'Infinity'::double precision);
