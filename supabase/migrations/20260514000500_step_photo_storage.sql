insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'step-photos',
  'step-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mvp anon read step photos" on storage.objects;
drop policy if exists "mvp anon insert step photos" on storage.objects;
drop policy if exists "mvp anon update step photos" on storage.objects;
drop policy if exists "mvp anon delete step photos" on storage.objects;

create policy "mvp anon read step photos"
on storage.objects for select to anon
using (bucket_id = 'step-photos');

create policy "mvp anon insert step photos"
on storage.objects for insert to anon
with check (bucket_id = 'step-photos');

create policy "mvp anon update step photos"
on storage.objects for update to anon
using (bucket_id = 'step-photos')
with check (bucket_id = 'step-photos');

create policy "mvp anon delete step photos"
on storage.objects for delete to anon
using (bucket_id = 'step-photos');
