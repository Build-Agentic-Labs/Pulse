-- Uploaded files on work instruction references.
-- Spec: docs/superpowers/specs/2026-09-18-work-instruction-release-design.md ("Reference files")
--
-- A reference could only point at a link or name a document number. It can now carry the file
-- itself: metadata on the reference row (so policy enforcement stays relational), the bytes in a
-- private bucket opened through short-lived signed URLs.
--
-- RLS in one sentence: a reference file lives under its own project's prefix; anyone with 'view'
-- access to that project can read it, anyone with 'edit' access can upload or remove it, and a
-- reference row may only name a file stored under its own project and task.
--
-- Object path: workspaces/<workspace>/projects/<project>/wi-references/<task>/<upload-id>-<name>
-- (the same workspaces/<ws>/projects/<project>/ convention the step-photos bucket uses).

alter table public.work_instruction_references
  add column storage_path text unique,
  add column file_name    text not null default '' check (char_length(file_name) <= 260),
  add column content_type text not null default '',
  add column size_bytes   bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 20971520)),
  add constraint work_instruction_references_file_complete
    check ((storage_path is null and size_bytes is null) or (storage_path is not null and size_bytes is not null and btrim(file_name) <> ''));

-- Extends the stamp trigger (an ordinary function owned by this feature, not one of the
-- live-patched SOP functions): a row may only claim a file under its own project and task.
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

  if new.storage_path is not null and new.storage_path not like
     'workspaces/' || public.project_workspace_id(new.project_id) || '/projects/' || new.project_id
       || '/wi-references/' || new.task_id || '/%' then
    raise exception 'That file is not stored under this work instruction.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wi-reference-files',
  'wi-reference-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "wi reference file uploads" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'wi-reference-files'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'projects'
  and (storage.foldername(name))[5] = 'wi-references'
  and public.project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]
  and public.has_project_access((storage.foldername(name))[4], 'edit'::public.access_level)
);

create policy "wi reference file reads" on storage.objects
for select to authenticated
using (
  bucket_id = 'wi-reference-files'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'projects'
  and (storage.foldername(name))[5] = 'wi-references'
  and public.has_project_access((storage.foldername(name))[4], 'view'::public.access_level)
);

create policy "wi reference file deletes" on storage.objects
for delete to authenticated
using (
  bucket_id = 'wi-reference-files'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'projects'
  and (storage.foldername(name))[5] = 'wi-references'
  and public.has_project_access((storage.foldername(name))[4], 'edit'::public.access_level)
);
