-- Private forms/attachments linked to stable annex rows inside an SOP document.
-- Metadata is relational for policy enforcement; binary content lives in a private bucket.

create or replace function public.sop_workspace_id(p_sop text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.workspace_id from public.sops s where s.id = p_sop and s.deleted_at is null;
$$;

create or replace function public.can_edit_sop_content(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    where s.id = p_sop
      and s.status = 'draft'
      and s.deleted_at is null
      and public.has_org_tool_access(s.workspace_id, 'edit'::public.access_level)
      and (
        s.department_id is null
        or public.is_department_member(s.department_id)
        or not public.department_has_members(s.department_id)
      )
  );
$$;

revoke execute on function public.sop_workspace_id(text) from public, anon;
revoke execute on function public.can_edit_sop_content(text) from public, anon;
grant execute on function public.sop_workspace_id(text) to authenticated, service_role;
grant execute on function public.can_edit_sop_content(text) to authenticated, service_role;

create table public.sop_annex_files (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  sop_id        text not null references public.sops(id) on delete cascade,
  annex_id      text not null,
  storage_path  text not null unique,
  original_name text not null,
  content_type  text not null,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by   uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sop_annex_files_one_per_annex unique (sop_id, annex_id),
  constraint sop_annex_files_annex_id_present check (btrim(annex_id) <> ''),
  constraint sop_annex_files_name_present check (btrim(original_name) <> '')
);

create index sop_annex_files_workspace_idx on public.sop_annex_files(workspace_id);
create index sop_annex_files_sop_idx on public.sop_annex_files(sop_id);

create or replace function public.enforce_sop_annex_file_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace text;
begin
  select s.workspace_id into v_workspace
  from public.sops s
  where s.id = new.sop_id and s.deleted_at is null;

  if v_workspace is null or v_workspace <> new.workspace_id then
    raise exception 'Annex file workspace does not match its SOP';
  end if;

  if new.storage_path not like
     'workspaces/' || new.workspace_id || '/sops/' || new.sop_id || '/annexes/' || new.annex_id || '/%' then
    raise exception 'Annex file storage path does not match its SOP and annex';
  end if;

  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.workspace_id := old.workspace_id;
    new.sop_id := old.sop_id;
    new.annex_id := old.annex_id;
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger sop_annex_files_scope
before insert or update on public.sop_annex_files
for each row execute function public.enforce_sop_annex_file_scope();

alter table public.sop_annex_files enable row level security;
revoke all on public.sop_annex_files from anon;
grant select, insert, update, delete on public.sop_annex_files to authenticated;

create policy sop_annex_files_read on public.sop_annex_files
for select to authenticated
using (public.can_read_sop(sop_id));

create policy sop_annex_files_insert on public.sop_annex_files
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and workspace_id = public.sop_workspace_id(sop_id)
  and public.can_edit_sop_content(sop_id)
);

create policy sop_annex_files_update on public.sop_annex_files
for update to authenticated
using (public.can_edit_sop_content(sop_id))
with check (public.can_edit_sop_content(sop_id));

create policy sop_annex_files_delete on public.sop_annex_files
for delete to authenticated
using (public.can_edit_sop_content(sop_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-annexes',
  'sop-annexes',
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

create policy "sop annex uploads" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'sop-annexes'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'sops'
  and (storage.foldername(name))[5] = 'annexes'
  and public.sop_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]
  and public.can_edit_sop_content((storage.foldername(name))[4])
);

create policy "sop annex reads" on storage.objects
for select to authenticated
using (
  bucket_id = 'sop-annexes'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'sops'
  and (storage.foldername(name))[5] = 'annexes'
  and public.can_read_sop((storage.foldername(name))[4])
);

create policy "sop annex deletes" on storage.objects
for delete to authenticated
using (
  bucket_id = 'sop-annexes'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'sops'
  and (storage.foldername(name))[5] = 'annexes'
  and public.can_edit_sop_content((storage.foldername(name))[4])
);
