-- pgTAP: SOP conversion sources relayed through the private sop-conversion-uploads bucket.
-- Migration: 20260916120000_sop_conversion_uploads.sql
--
-- Pins:
--   * the bucket is private
--   * an org-tool editor can write under users/<own uid>/<workspace>/
--   * nobody can write under another user's prefix, even with edit access
--   * an org-tool viewer cannot write at all
--   * another user cannot read the editor's source; the editor can
--
-- The delete policy is NOT pinned here: Supabase installs a trigger on storage.objects that
-- raises "Direct deletion from storage tables is not allowed" for SQL deletes, so the only way
-- to exercise it is through the Storage API, which the route does (see route.test.ts).

begin;
select plan(6);

insert into public.workspaces (id, name) values ('ws_cu', 'Conversion Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('cu.dev', 'ws_cu');

insert into auth.users (id, aud, role, email)
values
  ('e0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cu-editor@cu.dev'),
  ('e0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cu-viewer@cu.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_cu', 'e0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_cu', 'e0000000-0000-0000-0000-000000000002', 'viewer');

insert into public.org_tool_access (workspace_id, user_id, level) values
  ('ws_cu', 'e0000000-0000-0000-0000-000000000001', 'edit'),
  ('ws_cu', 'e0000000-0000-0000-0000-000000000002', 'view');

create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select is(
  (select public from storage.buckets where id = 'sop-conversion-uploads'),
  false,
  'the conversion-uploads bucket is private'
);

-- 1. The editor writes under their own prefix for a workspace they can edit.
select test_as('e0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('sop-conversion-uploads', 'users/e0000000-0000-0000-0000-000000000001/ws_cu/u1-legacy.docx')$$,
  'an org-tool editor can upload a conversion source under their own uid'
);

-- 2. Even the editor cannot write under someone else's prefix.
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('sop-conversion-uploads', 'users/e0000000-0000-0000-0000-000000000002/ws_cu/u1-spoof.docx')$$,
  '42501',
  null,
  'a user cannot upload under another user''s prefix'
);

-- 3. A viewer holds no org-tool edit access and cannot upload at all.
select test_as('e0000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('sop-conversion-uploads', 'users/e0000000-0000-0000-0000-000000000002/ws_cu/u2-legacy.docx')$$,
  '42501',
  null,
  'an org-tool viewer cannot upload a conversion source'
);

-- 4. The viewer cannot see the editor's source.
select is(
  (select count(*) from storage.objects
   where bucket_id = 'sop-conversion-uploads'
     and name = 'users/e0000000-0000-0000-0000-000000000001/ws_cu/u1-legacy.docx'),
  0::bigint,
  'another user cannot read a conversion source they did not upload'
);

-- 5. The editor reads their own source.
select test_as('e0000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from storage.objects
   where bucket_id = 'sop-conversion-uploads'
     and name = 'users/e0000000-0000-0000-0000-000000000001/ws_cu/u1-legacy.docx'),
  1::bigint,
  'the uploader can read their own conversion source'
);

select * from finish();
rollback;
