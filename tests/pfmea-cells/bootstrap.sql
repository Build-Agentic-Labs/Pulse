-- Minimal disposable database only; never run against a project database.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
create type public.access_level as enum ('view','edit');
create table public.fixture_access(actor uuid,project_id text,level public.access_level);
create function public.has_project_access(p_project text,p_level public.access_level) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fixture_access where actor=auth.uid() and project_id=p_project
    and (level='edit' or p_level='view'));
$$;
create table public.products(id text primary key,project_id text not null,custom_fields jsonb);
alter table public.products enable row level security;
create policy product_read on public.products for select to authenticated using(public.has_project_access(project_id,'view'));
create policy product_write on public.products for update to authenticated using(public.has_project_access(project_id,'edit')) with check(public.has_project_access(project_id,'edit'));
grant usage on schema auth to authenticated,anon;
grant select,update on public.products to authenticated;
