-- Page-pinned comments for the draft PDF review workspace.

create table if not exists public.sop_review_annotations (
  id              text primary key default gen_random_uuid()::text,
  sop_id          text not null references public.sops(id) on delete cascade,
  review_cycle    integer not null,
  page_number     integer not null check (page_number > 0),
  x_percent       numeric(6,3) not null check (x_percent between 0 and 100),
  y_percent       numeric(6,3) not null check (y_percent between 0 and 100),
  body            text not null check (length(btrim(body)) between 1 and 2000),
  created_by      uuid not null references auth.users(id),
  author_name     text not null default '',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id)
);

create index if not exists sop_review_annotations_sop_cycle_idx
  on public.sop_review_annotations(sop_id, review_cycle, created_at);

create or replace function public.stamp_sop_review_annotation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
begin
  select status, review_cycle into s from public.sops where id = new.sop_id and deleted_at is null;
  if s is null then raise exception 'SOP % not found', new.sop_id; end if;
  if s.status <> 'in_review' then raise exception 'Annotations can only be added during draft review'; end if;
  if not exists (select 1 from public.sop_review_seats st
                 where st.sop_id = new.sop_id and st.signer_id = auth.uid()) then
    raise exception 'Only an assigned reviewer can annotate this SOP';
  end if;

  new.created_by := auth.uid();
  new.review_cycle := s.review_cycle;
  new.author_name := coalesce(
    (select full_name from public.profiles where id = auth.uid()),
    ''
  );
  return new;
end;
$$;

drop trigger if exists stamp_sop_review_annotation on public.sop_review_annotations;
create trigger stamp_sop_review_annotation
before insert on public.sop_review_annotations
for each row execute function public.stamp_sop_review_annotation();

alter table public.sop_review_annotations enable row level security;

drop policy if exists sop_review_annotations_read on public.sop_review_annotations;
create policy sop_review_annotations_read on public.sop_review_annotations
for select to authenticated using (public.can_read_sop(sop_id));

drop policy if exists sop_review_annotations_insert on public.sop_review_annotations;
create policy sop_review_annotations_insert on public.sop_review_annotations
for insert to authenticated with check (
  exists (select 1 from public.sop_review_seats st
          where st.sop_id = sop_id and st.signer_id = auth.uid())
);

drop policy if exists sop_review_annotations_update on public.sop_review_annotations;
create policy sop_review_annotations_update on public.sop_review_annotations
for update to authenticated
using (
  created_by = auth.uid()
  or exists (select 1 from public.sops s where s.id = sop_id and s.created_by = auth.uid())
)
with check (
  created_by = auth.uid()
  or exists (select 1 from public.sops s where s.id = sop_id and s.created_by = auth.uid())
);

drop policy if exists sop_review_annotations_delete on public.sop_review_annotations;
create policy sop_review_annotations_delete on public.sop_review_annotations
for delete to authenticated using (created_by = auth.uid());

revoke execute on function public.stamp_sop_review_annotation() from public, anon, authenticated;
