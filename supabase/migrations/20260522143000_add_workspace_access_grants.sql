create table if not exists workspace_access_grants (
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role workspace_role not null default 'editor',
  granted_by uuid references auth.users(id) on delete set null,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, email),
  constraint workspace_access_grants_email_normalized check (email = lower(btrim(email))),
  constraint workspace_access_grants_anacorp_email check (email like '%@anacorp.com')
);

create index if not exists workspace_access_grants_email_idx on workspace_access_grants(email);

drop trigger if exists workspace_access_grants_set_updated_at on workspace_access_grants;
create trigger workspace_access_grants_set_updated_at
before update on workspace_access_grants
for each row execute function set_updated_at();

create or replace function public.redeem_workspace_access_grants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
  inserted_count integer := 0;
begin
  if auth.uid() is null or current_email = '' or current_email not like '%@anacorp.com' then
    return 0;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select grant_row.workspace_id, auth.uid(), grant_row.role
  from public.workspace_access_grants grant_row
  where grant_row.email = current_email
    and not exists (
      select 1
      from public.workspace_members member_row
      where member_row.workspace_id = grant_row.workspace_id
        and member_row.user_id = auth.uid()
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  update public.workspace_access_grants
  set redeemed_by = coalesce(redeemed_by, auth.uid()),
      redeemed_at = coalesce(redeemed_at, now())
  where email = current_email;

  return inserted_count;
end;
$$;

alter table workspace_access_grants enable row level security;

drop policy if exists "workspace_access_grants member or self read" on workspace_access_grants;
drop policy if exists "workspace_access_grants admin insert" on workspace_access_grants;
drop policy if exists "workspace_access_grants admin update" on workspace_access_grants;
drop policy if exists "workspace_access_grants admin delete" on workspace_access_grants;

create policy "workspace_access_grants member or self read" on workspace_access_grants
for select to authenticated
using (
  email = lower(btrim(coalesce(auth.jwt()->>'email', '')))
  or public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);

create policy "workspace_access_grants admin insert" on workspace_access_grants
for insert to authenticated
with check (
  email = lower(btrim(email))
  and email like '%@anacorp.com'
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);

create policy "workspace_access_grants admin update" on workspace_access_grants
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]))
with check (
  email = lower(btrim(email))
  and email like '%@anacorp.com'
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);

create policy "workspace_access_grants admin delete" on workspace_access_grants
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

insert into workspace_access_grants (workspace_id, email, role, granted_by)
values ('workspace-default', 'rlopez@anacorp.com', 'owner', null)
on conflict (workspace_id, email) do update
set role = excluded.role;
