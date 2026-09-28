-- Author replies are delivered atomically to the original reviewer's in-app inbox.
create or replace function public.notify_sop_author_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if auth.uid() is null or new.author_response = '' or
    new.author_response is not distinct from old.author_response then return new; end if;
  select id, title, workspace_id, created_by, review_cycle into s
    from public.sops where id = new.sop_id and deleted_at is null;
  if s.created_by is distinct from auth.uid() or s.review_cycle <> new.review_cycle
    or new.created_by = auth.uid() then return new; end if;
  insert into public.notifications(recipient_id, workspace_id, source, kind, entity_type, entity_id, title, body, link)
  values(new.created_by, s.workspace_id, 'sop', 'author_replied', 'sop', s.id,
    'Author replied', coalesce(s.title, 'SOP') || ': ' || left(new.author_response, 200),
    '/sops?tab=review&review=' || s.id);
  return new;
end;
$$;
revoke all on function public.notify_sop_author_reply() from public, anon, authenticated;
create trigger notify_sop_author_reply after update of author_response on public.sop_review_annotations
for each row execute function public.notify_sop_author_reply();
