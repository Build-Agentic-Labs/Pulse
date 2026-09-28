create table public.sop_comment_replies (
 id uuid primary key default gen_random_uuid(),
 annotation_id text not null references public.sop_review_annotations(id) on delete cascade,
 created_by uuid not null default auth.uid() references auth.users(id),
 body text not null check(length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
alter table public.sop_comment_replies enable row level security;
grant select, insert on public.sop_comment_replies to authenticated;
create policy "Read SOP comment replies" on public.sop_comment_replies for select to authenticated
using (exists(select 1 from public.sop_review_annotations a where a.id=annotation_id and public.can_read_sop(a.sop_id)));
create policy "Reply to own review conversation" on public.sop_comment_replies for insert to authenticated
with check(created_by=auth.uid() and exists(
 select 1 from public.sop_review_annotations a join public.sops s on s.id=a.sop_id
 where a.id=annotation_id and s.deleted_at is null and s.review_cycle=a.review_cycle
 and s.status in ('draft','in_review') and s.final_approval_requested_at is null
 and public.can_read_sop(s.id) and auth.uid() in (a.created_by,s.created_by)
 and exists(select 1 from public.sop_review_submissions r where r.sop_id=s.id and r.review_cycle=s.review_cycle and r.reviewer_id=a.created_by)
));
create index sop_comment_replies_annotation_idx on public.sop_comment_replies(annotation_id,created_at);
create or replace function public.notify_sop_comment_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record;
begin
 select s.id,s.title,s.workspace_id,s.created_by as author_id,r.created_by as reviewer_id into a
 from public.sop_review_annotations r join public.sops s on s.id=r.sop_id where r.id=new.annotation_id;
 if auth.uid() is null or auth.uid() is distinct from new.created_by or new.created_by not in (a.author_id,a.reviewer_id) then raise exception 'Not a conversation participant'; end if;
 insert into public.notifications(recipient_id,workspace_id,source,kind,entity_type,entity_id,title,body,link)
 values(case when new.created_by=a.author_id then a.reviewer_id else a.author_id end,a.workspace_id,'sop','review_reply','sop',a.id,'New review reply',coalesce(a.title,'SOP') || ': ' || left(new.body,200),
 case when new.created_by=a.author_id then '/sops?tab=review&review=' || a.id else '/sops/' || a.id || '?step=draft-review&via=review' end);
 return new;
end;
$$;
revoke all on function public.notify_sop_comment_reply() from public,anon,authenticated;
create trigger notify_sop_comment_reply after insert on public.sop_comment_replies
for each row execute function public.notify_sop_comment_reply();
