-- Local-only until user acceptance; fixtures and injected failures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(56);
insert into public.workspaces(id,name) values('wi-test-ws','WI tests'),('wi-test-other','Other organization');
insert into public.workspace_auto_join_domains(domain,workspace_id) values('wi-test.local','wi-test-ws'),('wi-other.local','wi-test-other');
insert into auth.users(id,aud,role,email) values
 ('e7100000-0000-0000-0000-000000000001','authenticated','authenticated','author@wi-test.local'),
 ('e7100000-0000-0000-0000-000000000002','authenticated','authenticated','viewer@wi-test.local'),
 ('e7100000-0000-0000-0000-000000000003','authenticated','authenticated','other-dept@wi-test.local'),
 ('e7100000-0000-0000-0000-000000000004','authenticated','authenticated','outsider@wi-other.local');
update public.profiles set full_name='Original Author' where id='e7100000-0000-0000-0000-000000000001';
insert into public.workspace_members(workspace_id,user_id,role) values
 ('wi-test-ws','e7100000-0000-0000-0000-000000000001','editor'),('wi-test-ws','e7100000-0000-0000-0000-000000000002','viewer'),
 ('wi-test-ws','e7100000-0000-0000-0000-000000000003','editor'),('wi-test-other','e7100000-0000-0000-0000-000000000004','editor')
 on conflict(workspace_id,user_id) do update set role=excluded.role;
insert into public.org_tool_access(workspace_id,user_id,level) values
 ('wi-test-ws','e7100000-0000-0000-0000-000000000001','edit'),('wi-test-ws','e7100000-0000-0000-0000-000000000002','view'),
 ('wi-test-ws','e7100000-0000-0000-0000-000000000003','edit'),('wi-test-other','e7100000-0000-0000-0000-000000000004','edit') on conflict(workspace_id,user_id) do update set level=excluded.level;
insert into public.departments(id,workspace_id,code,name) values('wi-test-pro','wi-test-ws','WIP','WI process'),('wi-test-pur','wi-test-ws','WIB','WI purchasing');
insert into public.department_members(department_id,user_id) values('wi-test-pro','e7100000-0000-0000-0000-000000000001'),('wi-test-pro','e7100000-0000-0000-0000-000000000002'),('wi-test-pur','e7100000-0000-0000-0000-000000000003');
create function public.wi_test_actor(n integer) returns void language plpgsql as $$ begin
 execute 'reset role';
 perform set_config('request.jwt.claims',case when n=0 then '{}' else jsonb_build_object('sub','e7100000-0000-0000-0000-'||lpad(n::text,12,'0'),'role','authenticated')::text end,true);
 if n>0 then execute 'set local role authenticated'; end if;
end $$;
create function public.wi_test_edit(k text,p jsonb,o uuid default gen_random_uuid(),v integer default null) returns jsonb language sql as $$
 select public.edit_quality_wi('e7200000-0000-0000-0000-000000000001',coalesce(v,(select version from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001')),o,k,p,auth.uid());
$$;
create function public.wi_test_publish(o uuid default gen_random_uuid(),v integer default null) returns jsonb language sql as $$
 select public.publish_quality_wi('e7200000-0000-0000-0000-000000000001',coalesce(v,(select version from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001')),o,'Release',auth.uid());
$$;
select public.wi_test_actor(2);
select throws_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws','wi-test-pro',auth.uid())$$,'42501',null,'viewer cannot create');
select public.wi_test_actor(3);
select throws_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws','wi-test-pro',auth.uid())$$,'42501',null,'another department cannot create here');
select public.wi_test_actor(1);
select throws_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-other','wi-test-pro',auth.uid())$$,'42501',null,'department cannot be placed in another workspace');
select lives_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws','wi-test-pro',auth.uid())$$,'member creates an unnumbered draft');
select lives_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws','wi-test-pro',auth.uid())$$,'create response loss retries same id');
select is((select document_number from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'),null::text,'draft has no controlled number');
select throws_ok($$update public.quality_work_instructions set document_number='WI-WIP-001'$$,'42501',null,'client cannot assign a number');
select throws_ok($$select public.wi_test_publish()$$,'22023',null,'incomplete publish refused');
select public.wi_test_actor(0);
select is((select count(*)::int from public.doc_number_counter where department_id='wi-test-pro' and doc_type='WI'),0,'failed publish allocates no counter');
select public.wi_test_actor(4);
select is((select count(*)::int from public.quality_work_instructions where workspace_id='wi-test-ws'),0,'other workspace cannot read');
select public.wi_test_actor(3);
select throws_ok($$select public.wi_test_edit('details','{"title":"Wrong department"}')$$,'42501',null,'another department cannot edit');
select public.wi_test_actor(1);
select lives_ok($$select public.wi_test_edit('details','{"title":"Open file","purpose":"Process scope","responsibilities":"Engineer"}')$$,'details patch saves');
select throws_ok($$select public.wi_test_edit('details','{"document_number":"Forged"}')$$,'22023',null,'controlled fields cannot be patched');
select throws_ok($$select public.wi_test_edit('details','{"title":"Stale"}',gen_random_uuid(),999)$$,'PT409',null,'stale version refuses rather than overwrites');
select lives_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000001","title":"Open","instruction":"Open the file"}')$$,'step creation saves');
select lives_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000002","title":"Save","instruction":"Save the file"}','e7400000-0000-0000-0000-000000000001',3)$$,'second step saves');
select lives_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000002","title":"Save","instruction":"Save the file"}','e7400000-0000-0000-0000-000000000001',3)$$,'edit response loss retries exact operation');
select is((select version from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'),4,'retry does not increment version twice');
select throws_ok($$select public.wi_test_edit('details','{"title":"Reused"}','e7400000-0000-0000-0000-000000000001',3)$$,'22023',null,'operation id cannot be reused');
select throws_ok($$select public.wi_test_edit('reorder','{"ids":["e7300000-0000-0000-0000-000000000001","e7300000-0000-0000-0000-000000000001"]}')$$,'PT409',null,'duplicate reorder refuses');
select lives_ok($$select public.wi_test_edit('reorder','{"ids":["e7300000-0000-0000-0000-000000000002","e7300000-0000-0000-0000-000000000001"]}')$$,'complete step reorder commits');
select throws_ok($$select public.wi_test_edit('image','{"id":"e7300000-0000-0000-0000-000000000001","image":{"id":"fake","width":100,"height":100,"storagePath":"forged/path"}}')$$,'22023',null,'uncommitted or foreign image refuses');
select lives_ok($$select public.wi_test_publish('e7500000-0000-0000-0000-000000000001',5)$$,'member publishes directly with no review flow');
select is((select document_number from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'),'WI-WIP-001','first successful publish gets department number');
select lives_ok($$select public.wi_test_publish('e7500000-0000-0000-0000-000000000001',5)$$,'publish response loss replays');
select is((select count(*)::int from public.quality_wi_revisions where wi_id='e7200000-0000-0000-0000-000000000001'),1,'repeat publish creates no duplicate revision');
select public.wi_test_actor(0);
select throws_ok($$update public.quality_wi_revisions set change_description='tampered'$$,'42501',null,'published revision immutable even through privileged SQL');
select public.wi_test_actor(1);
select lives_ok($$select public.wi_test_edit('details','{"title":"New draft"}')$$,'published document can have a separate new draft');
select is((select snapshot->>'title' from public.quality_wi_revisions where id='e7500000-0000-0000-0000-000000000001'),'Open file','old published snapshot stays unchanged');
select lives_ok($$select public.wi_test_publish()$$,'new draft publishes another revision');
select is((select document_number from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'),'WI-WIP-001','revisions retain number');
select lives_ok($$select public.wi_test_edit('remove_step','{"id":"e7300000-0000-0000-0000-000000000001"}')$$,'step removal is scoped and recoverable');
select is((select count(*)::int from public.quality_wi_steps where id='e7300000-0000-0000-0000-000000000001' and removed_at is not null),1,'removed step record remains stored');
select public.wi_test_actor(0);
update public.doc_number_counter set next_seq=1000 where department_id='wi-test-pro' and doc_type='WI';
select public.wi_test_actor(1);
select public.create_quality_wi('e7200000-0000-0000-0000-000000000002','wi-test-ws','wi-test-pro',auth.uid());
select public.edit_quality_wi('e7200000-0000-0000-0000-000000000002',1,gen_random_uuid(),'details','{"title":"Other","purpose":"Scope","responsibilities":"Author"}',auth.uid());
select public.edit_quality_wi('e7200000-0000-0000-0000-000000000002',2,gen_random_uuid(),'add_step','{"id":"e7300000-0000-0000-0000-000000000003","title":"Act","instruction":"Act now"}',auth.uid());
select lives_ok($$select public.publish_quality_wi('e7200000-0000-0000-0000-000000000002',3,gen_random_uuid(),'Initial',auth.uid())$$,'numbers above 999 publish');
select is((select document_number from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000002'),'WI-WIP-1000','number sequence is not truncated');
select public.wi_test_actor(0);
set local role anon;
select throws_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000003','wi-test-ws','wi-test-pro',auth.uid())$$,'42501',null,'anonymous cannot call privileged create');
reset role;
select public.wi_test_actor(0);
update public.profiles set full_name='Original Author' where id='e7100000-0000-0000-0000-000000000001';
select public.wi_test_actor(2);
select is(public.quality_wi_author_display_name('e7200000-0000-0000-0000-000000000001'),'Original Author','viewer sees creator name, not their own');
select is(public.load_quality_wi_document('e7200000-0000-0000-0000-000000000001','wi-test-ws')->>'author_name','Original Author','document includes creator name');
select public.wi_test_actor(4);
select is(public.quality_wi_author_display_name('e7200000-0000-0000-0000-000000000001'),null::text,'outsider cannot read author name');
select public.wi_test_actor(0);
update public.profiles set full_name='Renamed User' where id='e7100000-0000-0000-0000-000000000001';
select is((select snapshot->>'revisionAuthorName' from public.quality_wi_revisions where wi_id='e7200000-0000-0000-0000-000000000002'),'Original Author','release author is preserved after profile rename');
select is((select snapshot->>'authorName' from public.quality_wi_revisions where wi_id='e7200000-0000-0000-0000-000000000002'),'Original Author','original creator is snapshotted');
update public.profiles set full_name=' ' where id='e7100000-0000-0000-0000-000000000001';
select public.wi_test_actor(1);
select is(public.quality_wi_author_display_name('e7200000-0000-0000-0000-000000000001'),null::text,'missing name does not expose an email or invent an author');
select public.wi_test_actor(0);
set local role anon;
select throws_ok($$select public.quality_wi_author_display_name('e7200000-0000-0000-0000-000000000001')$$,'42501',null,'anonymous cannot request author name');
reset role;
select public.wi_test_actor(1);
select lives_ok($$select public.wi_test_edit('step','{"id":"e7300000-0000-0000-0000-000000000002","showPhoto":false}')$$,'photo visibility saves with existing edit RPC');
select is((select show_photo from public.quality_wi_steps where id='e7300000-0000-0000-0000-000000000002'),false,'visibility persists');
select throws_ok($$select public.wi_test_edit('step','{"id":"e7300000-0000-0000-0000-000000000002","showPhoto":"false"}')$$,'22023',null,'non boolean visibility rejected');
select lives_ok($$select public.wi_test_publish()$$,'hidden photo step publishes');
select is((select snapshot->'steps'->0->>'showPhoto' from public.quality_wi_revisions where wi_id='e7200000-0000-0000-0000-000000000001' order by revision_index desc limit 1),'false','revision preserves hidden photo layout');
select public.wi_test_actor(2);
select throws_ok($$select public.wi_test_edit('step','{"id":"e7300000-0000-0000-0000-000000000002","showPhoto":true}')$$,'42501',null,'viewer cannot change photo visibility');
select public.wi_test_actor(1);
select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000004","title":"Last","instruction":"Last instruction"}');
select lives_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000005","afterId":"e7300000-0000-0000-0000-000000000002","title":"Middle","instruction":"Middle instruction"}','e7400000-0000-0000-0000-000000000005')$$,'insertion shifts following steps atomically');
select is((select string_agg(title,',' order by position) from public.quality_wi_steps where wi_id='e7200000-0000-0000-0000-000000000001' and removed_at is null),'Save,Middle,Last','inserted step is between the original steps');
select lives_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000005","afterId":"e7300000-0000-0000-0000-000000000002","title":"Middle","instruction":"Middle instruction"}','e7400000-0000-0000-0000-000000000005',(select version-1 from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'))$$,'insertion response loss retries the same operation');
select is((select count(*)::int from public.quality_wi_steps where wi_id='e7200000-0000-0000-0000-000000000001' and removed_at is null),3,'retry does not duplicate inserted step');
select throws_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000006","afterId":"e7300000-0000-0000-0000-000000000001"}')$$,'PT409',null,'removed insertion anchor is not silently appended');
select throws_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000006","afterId":"e7300000-0000-0000-0000-000000000003"}')$$,'PT409',null,'insertion anchor must belong to this document');
select is((select string_agg(position::text,',' order by position) from public.quality_wi_steps where wi_id='e7200000-0000-0000-0000-000000000001' and removed_at is null),'1,2,3','failed insertions leave positions unchanged');
select * from finish();
rollback;
