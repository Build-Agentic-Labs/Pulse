-- Work instruction document control: releases (frozen revisions) and reference documents.
-- Spec: docs/superpowers/specs/2026-09-18-work-instruction-release-design.md
--
-- A work instruction is generated live from a planner task, so until now it had no revision of
-- its own, no effective date, and an always-empty revision history. A RELEASE freezes the built
-- document as an immutable snapshot with its own revision letter (A, B, ... Z, AA, ...). The
-- revision history on the sheet is derived from these rows; nobody types it.
--
-- RLS in one sentence: anyone with 'view' access to the task's project can read its releases and
-- references; anyone with 'edit' access can release and manage references; a release can never
-- be updated or deleted, and its revision, releaser and timestamp are set by the database, not
-- the client.
--
-- Neither table hangs off tasks with a cascading FK. The planner's full-state save hard-deletes
-- task rows that are absent from memory, and a controlled document must not vanish with them.
-- Each row carries its own project_id (stamped from the task at insert) so RLS keeps working
-- after the task is gone; the rows go only when the project itself is deleted.

-- 1 -> A, 26 -> Z, 27 -> AA (bijective base-26, the same sequence spreadsheet columns use).
create or replace function public.work_instruction_revision_letter(p_index integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_index integer := p_index;
  v_letters text := '';
begin
  if v_index is null or v_index < 1 then
    raise exception 'Revision index must be 1 or greater.';
  end if;
  while v_index > 0 loop
    v_index := v_index - 1;
    v_letters := chr(65 + (v_index % 26)) || v_letters;
    v_index := v_index / 26;
  end loop;
  return v_letters;
end;
$$;

create table public.work_instruction_releases (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null references public.projects(id) on delete cascade,
  task_id            text not null,
  -- Defaults exist only so the client may omit them; the stamp trigger overwrites all three.
  revision_index     integer not null default 1 check (revision_index >= 1),
  revision           text not null default '',
  document_number    text not null default '',
  title              text not null default '',
  change_description text not null check (btrim(change_description) <> '' and char_length(change_description) <= 500),
  effective_date     date not null,
  -- The built WorkInstruction (default layout) at release time, photos re-pointed at frozen copies.
  content            jsonb not null check (jsonb_typeof(content) = 'object'),
  -- Layout- and URL-independent fingerprint of the content; drift detection only, not security.
  content_hash       text not null check (btrim(content_hash) <> ''),
  released_by        uuid not null default auth.uid() references auth.users(id),
  released_by_name   text not null default '',
  released_at        timestamptz not null default now(),
  constraint work_instruction_releases_one_per_revision unique (task_id, revision_index)
);

create index work_instruction_releases_project_idx on public.work_instruction_releases(project_id);
create index work_instruction_releases_task_idx on public.work_instruction_releases(task_id, revision_index desc);

-- The client supplies the task, the content and the change note. Everything that makes the row a
-- controlled record is decided here, so a crafted insert cannot pick its own revision or author.
create or replace function public.stamp_work_instruction_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project text;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before releasing a work instruction.';
  end if;

  v_project := public.task_project_id(new.task_id);
  if v_project is null then
    raise exception 'That task does not exist or has no project.';
  end if;

  -- Two people releasing the same instruction at once must not both become Rev B.
  perform pg_advisory_xact_lock(hashtext('wi-release:' || new.task_id));

  select coalesce(max(r.revision_index), 0) + 1 into v_next
    from public.work_instruction_releases r
   where r.task_id = new.task_id;

  new.project_id := v_project;
  new.revision_index := v_next;
  new.revision := public.work_instruction_revision_letter(v_next);
  new.released_by := auth.uid();
  new.released_at := now();
  new.released_by_name := coalesce(
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()),
    (select u.email from auth.users u where u.id = auth.uid()),
    ''
  );
  new.change_description := btrim(new.change_description);
  return new;
end;
$$;

create trigger work_instruction_releases_stamp
before insert on public.work_instruction_releases
for each row execute function public.stamp_work_instruction_release();

-- Belt and braces: no policy grants UPDATE, and this also stops the service role from quietly
-- rewriting a released document. (DELETE is left to the project cascade.)
create or replace function public.refuse_work_instruction_release_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A released work instruction is immutable. Release a new revision instead.';
end;
$$;

create trigger work_instruction_releases_immutable
before update on public.work_instruction_releases
for each row execute function public.refuse_work_instruction_release_update();

alter table public.work_instruction_releases enable row level security;
revoke all on public.work_instruction_releases from anon;
grant select, insert on public.work_instruction_releases to authenticated;

create policy work_instruction_releases_read on public.work_instruction_releases
for select to authenticated
using (public.has_project_access(project_id, 'view'::public.access_level));

-- Evaluated AFTER the stamp trigger, so project_id here is the task's real project.
create policy work_instruction_releases_insert on public.work_instruction_releases
for insert to authenticated
with check (public.has_project_access(project_id, 'edit'::public.access_level));

-- ---------------------------------------------------------------------------
-- Reference documents linked to a work instruction.
-- ---------------------------------------------------------------------------
create table public.work_instruction_references (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null references public.projects(id) on delete cascade,
  task_id         text not null,
  kind            text not null check (kind in ('sop', 'drawing', 'document', 'link')),
  -- Set for kind = 'sop'. The sheet shows that SOP's CURRENT number, title and version.
  sop_id          text references public.sops(id) on delete set null,
  document_number text not null default '' check (char_length(document_number) <= 80),
  title           text not null default '' check (char_length(title) <= 200),
  url             text not null default '' check (char_length(url) <= 2000),
  position        integer not null default 0,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Holds even after an SOP reference loses its sop_id (on delete set null): the stamp trigger
  -- copies the SOP's number and title onto the row whenever they are blank.
  constraint work_instruction_references_has_label check (btrim(title) <> '' or btrim(document_number) <> '')
);

create index work_instruction_references_project_idx on public.work_instruction_references(project_id);
create index work_instruction_references_task_idx on public.work_instruction_references(task_id, position);

create or replace function public.stamp_work_instruction_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project text;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.project_id := old.project_id;
    new.task_id := old.task_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    v_project := public.task_project_id(new.task_id);
    if v_project is null then
      raise exception 'That task does not exist or has no project.';
    end if;
    new.project_id := v_project;
  end if;

  -- An SOP reference must point inside the project's own workspace.
  if new.sop_id is not null and not exists (
    select 1 from public.sops s
     where s.id = new.sop_id
       and s.workspace_id = public.project_workspace_id(new.project_id)
  ) then
    raise exception 'That SOP does not belong to this project''s organization.';
  end if;

  -- Keep a readable label on the row itself, so the reference survives the SOP being removed.
  if new.sop_id is not null and btrim(new.title) = '' and btrim(new.document_number) = '' then
    select coalesce(s.sop_number, ''), coalesce(nullif(btrim(s.title), ''), 'Untitled SOP')
      into new.document_number, new.title
      from public.sops s where s.id = new.sop_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger work_instruction_references_stamp
before insert or update on public.work_instruction_references
for each row execute function public.stamp_work_instruction_reference();

alter table public.work_instruction_references enable row level security;
revoke all on public.work_instruction_references from anon;
grant select, insert, update, delete on public.work_instruction_references to authenticated;

create policy work_instruction_references_read on public.work_instruction_references
for select to authenticated
using (public.has_project_access(project_id, 'view'::public.access_level));

create policy work_instruction_references_insert on public.work_instruction_references
for insert to authenticated
with check (public.has_project_access(project_id, 'edit'::public.access_level));

create policy work_instruction_references_update on public.work_instruction_references
for update to authenticated
using (public.has_project_access(project_id, 'edit'::public.access_level))
with check (public.has_project_access(project_id, 'edit'::public.access_level));

create policy work_instruction_references_delete on public.work_instruction_references
for delete to authenticated
using (public.has_project_access(project_id, 'edit'::public.access_level));
