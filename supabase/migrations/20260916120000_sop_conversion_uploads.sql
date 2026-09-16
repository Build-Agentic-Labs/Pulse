-- Legacy-document conversion sources relayed through Storage.
--
-- The SOP conversion route used to receive the .docx/.pdf as multipart form data. Vercel
-- rejects function request bodies over 4.5 MB with a plain-text 413 before the route runs,
-- so photo-heavy legacy SOPs failed with "Unexpected token 'R', 'Request En'... is not
-- valid JSON". The browser now uploads the source straight to this private bucket and
-- hands the route only a storage path; the route downloads it, deletes it, and converts.
--
-- RLS in one sentence: a user may write, read, and delete conversion sources only under
-- their own uid prefix, and may write one only for a workspace where they hold org-tool
-- edit access (the same gate the route applies before spending LLM tokens).
--
-- Object path: users/<auth.uid()>/<workspace_id>/<upload-id>-<file-name>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-conversion-uploads',
  'sop-conversion-uploads',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "sop conversion source uploads" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'sop-conversion-uploads'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.has_org_tool_access((storage.foldername(name))[3], 'edit'::public.access_level)
);

create policy "sop conversion source reads" on storage.objects
for select to authenticated
using (
  bucket_id = 'sop-conversion-uploads'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "sop conversion source deletes" on storage.objects
for delete to authenticated
using (
  bucket_id = 'sop-conversion-uploads'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);
