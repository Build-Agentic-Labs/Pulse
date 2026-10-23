-- Authorized department-label correction. No UI rename control is added.
-- Retains MFG numbering, memberships, SOP ownership and approval assignments.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';
lock table public.departments, public.department_members, public.sops,
 public.sop_review_seats, public.sop_signatures, public.sop_revisions in share row exclusive mode;
create temporary table rename_before(name text primary key, digest text) on commit drop;
do $snapshot$
declare t text;
begin
 foreach t in array array['sops','sop_review_seats','sop_signatures','sop_revisions','department_members'] loop
  execute format('insert into rename_before select %L,md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from public.%I x',t,t);
 end loop;
 if not exists(select 1 from public.departments where id='a1f2e770-70da-4ff6-8ed7-78655174e25c'
  and workspace_id='workspace-default' and code='MFG' and name in ('Manufacturing/Production','Operations')) then
  raise exception 'Expected department not found; rename aborted';
 end if;
 if exists(select 1 from public.departments where workspace_id='workspace-default' and lower(btrim(name))='operations'
  and id<>'a1f2e770-70da-4ff6-8ed7-78655174e25c') then raise exception 'Another Operations department exists'; end if;
end $snapshot$;
update public.departments set name='Operations'
 where id='a1f2e770-70da-4ff6-8ed7-78655174e25c' and workspace_id='workspace-default' and name='Manufacturing/Production';
do $verify$
declare t text; actual text; expected text;
begin
 foreach t in array array['sops','sop_review_seats','sop_signatures','sop_revisions','department_members'] loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from public.%I x',t) into actual;
  select digest into expected from rename_before where name=t;
  if actual is distinct from expected then raise exception 'Unexpected changes to %; rename aborted',t; end if;
 end loop;
end $verify$;
commit;
select id,name,code from public.departments where id='a1f2e770-70da-4ff6-8ed7-78655174e25c';
