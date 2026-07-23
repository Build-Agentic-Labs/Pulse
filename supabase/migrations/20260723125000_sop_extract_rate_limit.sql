-- Cross-instance spend gate for POST /api/sops/extract. The route's in-memory
-- token bucket only bounds a single serverless instance; N warm/cold instances
-- each allowed 5/min/user, and this endpoint is the only gate on the Anthropic
-- key. This table records each conversion attempt so the route can count a
-- caller's attempts in the trailing window across ALL instances.
--
-- Service-role only, both directions (mirrors sop_notifications, 20260721170000):
-- the route reaches it with the service-role client and users never touch it.
-- Rows are pruned to the window on every insert, so the table stays tiny.

create table if not exists public.sop_extraction_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Trailing-window count scan: rows for one caller, newest first.
create index if not exists sop_extraction_requests_user_created_idx
  on public.sop_extraction_requests(user_id, created_at desc);

alter table public.sop_extraction_requests enable row level security;
revoke all on public.sop_extraction_requests from anon, authenticated;
