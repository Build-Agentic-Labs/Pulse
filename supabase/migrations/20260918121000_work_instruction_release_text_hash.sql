-- A second, photo-free fingerprint for each work instruction release.
--
-- The planner loads a task's photos lazily (only once its procedure is opened), so the work
-- instruction LIST usually holds tasks without their photos. Comparing those against content_hash
-- (which covers photos) would flag every released instruction with photos as "modified". The list
-- compares text_hash instead; the preview and the release dialog load the photos and use
-- content_hash, so a photo-only change is still caught wherever the photos are actually known.
alter table public.work_instruction_releases
  add column text_hash text not null default '';
