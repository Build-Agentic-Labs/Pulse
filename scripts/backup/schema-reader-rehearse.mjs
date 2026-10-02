// Isolated synthetic permissions test. No host ports, production credentials, or files.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertSchemaReader} from './source.mjs';
const name='pulse-schema-fixture-'+randomUUID().slice(0,8);
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=q=>execFileSync('docker',['exec','-i',name,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const tables=['workspace_integrations','sop_approver_delivery_payloads','sop_submission_locks','push_subscriptions','transactional_emails','email_deliveries'];
let created=false;
try{
  docker(['run','-d','--network','none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.6.1.158']);created=true;
  for(let i=0;i<50;i++){
    try{sql('SELECT 1');await new Promise(r=>setTimeout(r,2000));sql('SELECT 1');break;}
    catch{await new Promise(r=>setTimeout(r,400));}
  }
  sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC;'+tables.map(t=>`CREATE TABLE public.${t}(id int,secret text); INSERT INTO public.${t} VALUES(1,'fixture-secret'); ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_public_read ON public.${t} FOR SELECT TO PUBLIC USING(true);`).join(''));
  sql(readFileSync('supabase/migrations/20261002184612_backup_schema_reader.sql','utf8'));
  for(const t of tables){
    assert.equal(sql(`SET ROLE pulse_backup_schema_reader; SELECT count(*) FROM public.${t};`).trim().split('\n').at(-1),'0');
    assert.throws(()=>sql(`SET ROLE pulse_backup_schema_reader; SET row_security=off; SELECT * FROM public.${t};`));
    assert.throws(()=>sql(`SET ROLE pulse_backup_schema_reader; DELETE FROM public.${t};`));
  }
  const observer={query:async(q,args)=>({rows:JSON.parse(sql(`SET ROLE pulse_backup_schema_reader; SELECT coalesce(json_agg(x),'[]') FROM (${q.replace('$1::text[]',args?'ARRAY['+args[0].map(t=>"'"+t+"'").join(',')+']::text[]':'$1::text[]')}) x;`).trim().replace(/^SET\n/,''))})};
  await assertSchemaReader(observer);
  sql(`CREATE SCHEMA private_auth_fixture; CREATE TABLE private_auth_fixture.users(id int,email text,created_at timestamptz,encrypted_password text); INSERT INTO private_auth_fixture.users VALUES(1,'fixture@example.test',now(),'excluded-secret'); GRANT SELECT(id,email,created_at) ON private_auth_fixture.users TO pulse_backup_schema_reader; CREATE SCHEMA pulse_backup; CREATE VIEW pulse_backup.auth_identities WITH(security_invoker=true) AS SELECT id,email,created_at FROM private_auth_fixture.users; GRANT USAGE ON SCHEMA pulse_backup TO pulse_backup_schema_reader; GRANT SELECT ON pulse_backup.auth_identities TO pulse_backup_schema_reader;`);
  assert.equal(sql('SET ROLE pulse_backup_schema_reader; SELECT count(*) FROM pulse_backup.auth_identities;').trim().split('\n').at(-1),'1');
  assert.throws(()=>sql('SET ROLE pulse_backup_schema_reader; SELECT encrypted_password FROM pulse_backup.auth_identities;'));
  assert.throws(()=>sql('SET ROLE pulse_backup_schema_reader; SELECT * FROM private_auth_fixture.users;'));
  const schema=docker(['exec',name,'pg_dump','-U','supabase_admin','--role=pulse_backup_schema_reader','--schema-only','--schema=public','--no-owner','postgres']);
  assert.ok(schema.includes('CREATE TABLE public.workspace_integrations'));assert.ok(!schema.includes('fixture-secret'));
  sql('ALTER POLICY pulse_backup_schema_denies_rows ON public.workspace_integrations USING (true);');
  await assert.rejects(assertSchemaReader(observer),/restrictive sensitive-row protection/);
  console.log('PASS: full schema-only dump; six sensitive tables unreadable even with PUBLIC policy or row_security=off; writes denied; weakened policy rejected.');
}finally{if(created)docker(['rm','-f',name]);}
