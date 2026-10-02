-- Serialize account preparation and delivery across overlapping HTTP submissions.
create table public.sop_submission_locks (
 sop_id text primary key references public.sops(id) on delete cascade,
 token uuid not null,
 locked_at timestamptz not null default now()
);
alter table public.sop_submission_locks enable row level security;
revoke all on public.sop_submission_locks from public,anon,authenticated;
grant all on public.sop_submission_locks to service_role;
create function public.acquire_sop_submission_lock(p_sop_id text) returns uuid
language plpgsql security definer set search_path='' as $$
declare claimed uuid;
begin
 insert into public.sop_submission_locks as locks(sop_id,token)
 values(p_sop_id,gen_random_uuid())
 on conflict(sop_id) do update set token=excluded.token,locked_at=now()
 where locks.locked_at<now()-interval '10 minutes'
 returning token into claimed;
 return claimed;
end $$;
revoke all on function public.acquire_sop_submission_lock(text) from public,anon,authenticated;
grant execute on function public.acquire_sop_submission_lock(text) to service_role;
