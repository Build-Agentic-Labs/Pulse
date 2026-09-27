alter table public.sop_review_annotations
  add column if not exists author_response text not null default '',
  add column if not exists author_responded_at timestamptz;

create or replace function public.guard_sop_author_response()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if TG_OP = 'INSERT' then
    new.author_response := '';
    new.author_responded_at := null;
  elsif new.author_response is distinct from old.author_response
     or new.author_responded_at is distinct from old.author_responded_at then
    select created_by, status, review_cycle into s from public.sops where id = old.sop_id and deleted_at is null;
    if auth.uid() is null or s.created_by is distinct from auth.uid() then
      raise exception 'Only the SOP author may respond to feedback';
    end if;
    if s.status <> 'draft' or s.review_cycle <> old.review_cycle then
      raise exception 'Take back the current draft before responding';
    end if;
    if length(new.author_response) > 2000 then raise exception 'Response is too long'; end if;
    new.author_response := btrim(new.author_response);
    new.author_responded_at := case when new.author_response = '' then null else now() end;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_sop_author_response() from public, anon, authenticated;
drop trigger if exists guard_sop_author_response on public.sop_review_annotations;
create trigger guard_sop_author_response before insert or update on public.sop_review_annotations
for each row execute function public.guard_sop_author_response();
