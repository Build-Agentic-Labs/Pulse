-- Preserve attribution at release time; never rewrite existing publication history.
create function private.snapshot_quality_wi_authors() returns trigger
language plpgsql set search_path='' as $$
begin
 new.snapshot := new.snapshot || jsonb_build_object(
  'revisionAuthorName',(select nullif(btrim(full_name),'') from public.profiles where id=new.published_by),
  'authorName',(select nullif(btrim(p.full_name),'') from public.quality_work_instructions w join public.profiles p on p.id=w.created_by where w.id=new.wi_id));
 return new;
end;
$$;
revoke all on function private.snapshot_quality_wi_authors() from public,anon,authenticated;
create trigger quality_wi_snapshot_authors before insert on public.quality_wi_revisions
for each row execute function private.snapshot_quality_wi_authors();
