alter table step_photos
add column if not exists thumbnail_url text,
add column if not exists thumbnail_storage_path text;

create unique index if not exists step_photos_thumbnail_storage_path_idx
on step_photos(thumbnail_storage_path)
where thumbnail_storage_path is not null;
