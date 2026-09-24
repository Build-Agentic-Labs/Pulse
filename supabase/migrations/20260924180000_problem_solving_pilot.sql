-- Private pilot: only the verified rlopez account, within its own workspaces.
create or replace function public.is_problem_solving_pilot()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = '32b1ed97-d60c-4198-ae70-4a6786d8ad50'::uuid;
$$;
revoke all on function public.is_problem_solving_pilot() from public, anon;
grant execute on function public.is_problem_solving_pilot() to authenticated;

create table public.problem_cases (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  workspace_id text not null references public.workspaces(id),
  title text not null check (length(btrim(title)) between 1 and 200),
  source text not null default 'Internal',
  owner text not null default '',
  reported_on date not null default current_date,
  severity text not null default 'Medium' check (severity in ('Low','Medium','High','Critical')),
  stage text not null default 'define' check (stage in ('define','contain','investigate','correct','prevent','verify','closed')),
  problem text not null default '',
  expected text not null default '',
  affected text not null default '',
  containment text not null default '',
  root_cause text not null default '',
  cause_evidence text not null default '',
  prevention text not null default '',
  verification_plan text not null default '',
  verification_result text not null default '',
  verified_on date,
  created_by uuid not null default auth.uid() references auth.users(id),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index problem_cases_workspace on public.problem_cases(workspace_id, updated_at desc);

create or replace function public.can_access_problem_workspace(p_workspace text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.is_problem_solving_pilot(), false) and exists (
    select 1 from public.workspace_members where workspace_id = p_workspace and user_id = auth.uid()
  );
$$;
revoke all on function public.can_access_problem_workspace(text) from public, anon;
grant execute on function public.can_access_problem_workspace(text) to authenticated;

create table public.problem_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.problem_cases(id),
  kind text not null check (kind in ('containment','corrective','preventive')),
  description text not null check (length(btrim(description)) > 0),
  owner text not null check (length(btrim(owner)) > 0),
  due_on date not null,
  status text not null default 'open' check (status in ('open','done')),
  completion_evidence text not null default '',
  created_at timestamptz not null default now(),
  check (status <> 'done' or length(btrim(completion_evidence)) > 0)
);
create index problem_actions_case on public.problem_actions(case_id);
create table public.problem_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.problem_cases(id),
  section text not null check (section in ('define','contain','investigate','correct','prevent','verify')),
  file_name text not null,
  storage_path text not null unique,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index problem_evidence_case on public.problem_evidence(case_id);
create table public.problem_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.problem_cases(id),
  actor uuid not null default auth.uid(),
  entity text not null,
  event text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index problem_history_case on public.problem_history(case_id, created_at desc);

alter table public.problem_cases enable row level security;
alter table public.problem_actions enable row level security;
alter table public.problem_evidence enable row level security;
alter table public.problem_history enable row level security;
create policy "pilot case read" on public.problem_cases for select to authenticated
  using (public.can_access_problem_workspace(workspace_id));
create policy "pilot case insert" on public.problem_cases for insert to authenticated
  with check (public.can_access_problem_workspace(workspace_id) and created_by = auth.uid());
create policy "pilot case update" on public.problem_cases for update to authenticated
  using (public.can_access_problem_workspace(workspace_id)) with check (public.can_access_problem_workspace(workspace_id));
create policy "pilot actions read" on public.problem_actions for select to authenticated
  using (exists (select 1 from public.problem_cases c where c.id = case_id));
create policy "pilot actions insert" on public.problem_actions for insert to authenticated
  with check (exists (select 1 from public.problem_cases c where c.id = case_id));
create policy "pilot actions update" on public.problem_actions for update to authenticated
  using (exists (select 1 from public.problem_cases c where c.id = case_id))
  with check (exists (select 1 from public.problem_cases c where c.id = case_id));
create policy "pilot evidence read" on public.problem_evidence for select to authenticated
  using (exists (select 1 from public.problem_cases c where c.id = case_id));
create policy "pilot evidence insert" on public.problem_evidence for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.problem_cases c where c.id = case_id));
create policy "pilot history read" on public.problem_history for select to authenticated
  using (exists (select 1 from public.problem_cases c where c.id = case_id));
revoke all on public.problem_cases, public.problem_actions, public.problem_evidence, public.problem_history from anon, authenticated;
grant select, insert, update on public.problem_cases, public.problem_actions to authenticated;
grant select, insert on public.problem_evidence to authenticated;
grant select on public.problem_history to authenticated;
grant usage, select on sequence public.problem_cases_number_seq to authenticated;

create or replace function public.guard_problem_case()
returns trigger language plpgsql set search_path = '' as $$
declare n integer; old_n integer;
begin
  if tg_op = 'INSERT' then
    if new.stage <> 'define' then raise exception 'New cases must start at Define.'; end if;
    new.created_by := auth.uid(); new.version := 1;
  else
    if old.stage = 'closed' then raise exception 'Closed cases are read-only.'; end if;
    if new.id <> old.id or new.workspace_id <> old.workspace_id or new.created_by <> old.created_by
       or new.number <> old.number or new.created_at <> old.created_at then
      raise exception 'Case identity cannot change.';
    end if;
    new.version := old.version + 1;
  end if;
  n := array_position(array['define','contain','investigate','correct','prevent','verify','closed'], new.stage);
  if tg_op = 'UPDATE' then
    old_n := array_position(array['define','contain','investigate','correct','prevent','verify','closed'], old.stage);
    if n > old_n + 1 then raise exception 'Complete each stage in order.'; end if;
  end if;
  if n >= 2 and (btrim(new.problem) = '' or btrim(new.expected) = '' or btrim(new.affected) = '' or btrim(new.owner) = '') then
    raise exception 'Describe the problem, expected condition, affected scope and owner first.';
  end if;
  if n >= 3 and (btrim(new.containment) = '' or not exists (
    select 1 from public.problem_actions where case_id = new.id and kind = 'containment' and status = 'done'
  )) then raise exception 'Record containment and complete its action with evidence first.'; end if;
  if n >= 4 and (btrim(new.root_cause) = '' or btrim(new.cause_evidence) = '') then
    raise exception 'Record a root cause and evidence supporting it first.';
  end if;
  if n >= 5 and not exists (select 1 from public.problem_actions where case_id = new.id and kind = 'corrective' and status = 'done') then
    raise exception 'Complete a corrective action with evidence first.';
  end if;
  if n >= 6 and (btrim(new.prevention) = '' or btrim(new.verification_plan) = '' or not exists (
    select 1 from public.problem_actions where case_id = new.id and kind = 'preventive' and status = 'done'
  )) then raise exception 'Record prevention, complete its action and define an effectiveness check first.'; end if;
  if new.stage = 'closed' then
    if btrim(new.verification_result) = '' or new.verified_on is null or new.verified_on > current_date
       or new.verified_on < new.reported_on or exists (select 1 from public.problem_actions where case_id = new.id and status <> 'done') then
      raise exception 'Record effectiveness results and a valid verification date, and complete every action before signing off.';
    end if;
    new.closed_at := now(); new.closed_by := auth.uid();
  else new.closed_at := null; new.closed_by := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger problem_case_guard before insert or update on public.problem_cases for each row execute function public.guard_problem_case();

create or replace function public.guard_problem_child()
returns trigger language plpgsql set search_path = '' as $$
declare c public.problem_cases;
begin
  select * into c from public.problem_cases where id = new.case_id for update;
  if c.id is null or c.stage = 'closed' then raise exception 'Case is unavailable or closed.'; end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.case_id <> old.case_id) then raise exception 'Record identity cannot change.'; end if;
  if tg_table_name = 'problem_evidence' then
    if new.storage_path not like c.workspace_id || '/' || c.id::text || '/' || new.section || '/%'
       or not exists (select 1 from storage.objects where bucket_id = 'problem-evidence' and name = new.storage_path) then
      raise exception 'Evidence must reference an uploaded file in this case and section.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'done' and new.status <> 'done' then raise exception 'Completed actions retain their evidence. Add a follow-up action instead.'; end if;
    if new.kind <> old.kind then raise exception 'Action type cannot change.'; end if;
  end if;
  return new;
end $$;
create trigger problem_action_guard before insert or update on public.problem_actions for each row execute function public.guard_problem_child();
create trigger problem_evidence_guard before insert on public.problem_evidence for each row execute function public.guard_problem_child();

create or replace function public.audit_problem_record()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.problem_history(case_id, actor, entity, event, snapshot)
  values (case when tg_table_name = 'problem_cases' then new.id else (to_jsonb(new)->>'case_id')::uuid end,
    auth.uid(), tg_table_name, lower(tg_op), to_jsonb(new));
  return new;
end $$;
create trigger problem_case_audit after insert or update on public.problem_cases for each row execute function public.audit_problem_record();
create trigger problem_action_audit after insert or update on public.problem_actions for each row execute function public.audit_problem_record();
create trigger problem_evidence_audit after insert on public.problem_evidence for each row execute function public.audit_problem_record();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('problem-evidence','problem-evidence',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy "pilot file read" on storage.objects for select to authenticated using (
  bucket_id = 'problem-evidence' and exists (select 1 from public.problem_cases c
    where c.workspace_id = (storage.foldername(name))[1] and c.id::text = (storage.foldername(name))[2])
);
create policy "pilot file insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'problem-evidence' and exists (select 1 from public.problem_cases c
    where c.workspace_id = (storage.foldername(name))[1] and c.id::text = (storage.foldername(name))[2] and c.stage <> 'closed')
);
-- Evidence is append-only; files cannot be overwritten or deleted by application users.
