-- Portfolio classification changes metadata only; planner identities stay intact.
alter table public.projects add column portfolio_category text
  check (portfolio_category in ('generators', 'compressors', 'hybrid', 'power-modules', 'trailers'));

-- Masters pin an immutable release. RESTRICT keeps linked revisions from disappearing.
create table public.awi_master_entries (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null unique references public.work_instruction_releases(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.awi_product_links (
  master_id uuid not null references public.awi_master_entries(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  primary key (master_id, project_id)
);
create index awi_product_links_project_idx on public.awi_product_links(project_id);
alter table public.awi_master_entries enable row level security;
alter table public.awi_product_links enable row level security;
grant select, insert, delete on public.awi_master_entries, public.awi_product_links to authenticated;
revoke all on public.awi_master_entries, public.awi_product_links from anon;

-- Preserve source instruction access; sharing never grants access to a private product.
create policy "awi masters read" on public.awi_master_entries for select to authenticated
using (exists (select 1 from public.work_instruction_releases r where r.id = release_id));
create policy "awi masters insert" on public.awi_master_entries for insert to authenticated
with check (exists (select 1 from public.work_instruction_releases r where r.id = release_id
  and public.has_project_access(r.project_id, 'edit'::public.access_level)));
create policy "awi masters delete" on public.awi_master_entries for delete to authenticated
using (exists (select 1 from public.work_instruction_releases r where r.id = release_id
  and public.has_project_access(r.project_id, 'edit'::public.access_level)));
create policy "awi product links read" on public.awi_product_links for select to authenticated
using (public.has_project_access(project_id, 'view'::public.access_level)
  and exists (select 1 from public.awi_master_entries m where m.id = master_id));
create policy "awi product links insert" on public.awi_product_links for insert to authenticated
with check (public.has_project_access(project_id, 'edit'::public.access_level)
  and exists (select 1 from public.awi_master_entries m
    join public.work_instruction_releases r on r.id = m.release_id
    join public.projects source on source.id = r.project_id
    join public.projects target on target.id = project_id
    where m.id = master_id and source.workspace_id = target.workspace_id));
create policy "awi product links delete" on public.awi_product_links for delete to authenticated
using (public.has_project_access(project_id, 'edit'::public.access_level)
  and exists (select 1 from public.awi_master_entries m where m.id = master_id));
