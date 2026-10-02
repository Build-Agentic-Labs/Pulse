/** Destructive operations exist ONLY inside a new owned Docker container. No .env loading. */
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {assertReadOnly} from './source.mjs';
import {recoveryMetadata,metadataRestoreSql,sequenceState} from './recovery-metadata.mjs';
const name=`pulse-recovery-fixture-${randomUUID().slice(0,8)}`;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:32e6});
const sql=(db,text)=>execFileSync('docker',['exec','-i',name,'psql','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',maxBuffer:32e6,stdio:['pipe','pipe','pipe']});
const client=db=>({query:async q=>({rows:JSON.parse(sql(db,`SELECT coalesce(json_agg(x),'[]') FROM (${q}) x;`))})});
const report={performedAt:new Date().toISOString(),productionConnected:false,environment:'New isolated Supabase PostgreSQL 17 container; two synthetic databases; no network or host ports',checks:[],fullRecoveryValidated:false};
let created=false;
try {
 docker(['run','-d','--network','none','--name',name,'-e','POSTGRES_PASSWORD=fixture-only','public.ecr.aws/supabase/postgres:17.6.1.158']);created=true;
 for(let i=0;i<40;i++){try{sql('postgres','SELECT 1;');await new Promise(resolve=>setTimeout(resolve,2000));sql('postgres','SELECT 1;');break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
 sql('postgres',`CREATE DATABASE fixture_source; CREATE DATABASE fixture_target; CREATE ROLE fixture_author NOLOGIN; CREATE ROLE fixture_user NOLOGIN; CREATE ROLE fixture_outsider NOLOGIN; CREATE ROLE fixture_reader NOLOGIN BYPASSRLS;`);
 sql('fixture_source',`CREATE TABLE public.documents(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id text NOT NULL,title text NOT NULL); ALTER TABLE public.documents OWNER TO fixture_author; ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY; CREATE POLICY own_documents ON public.documents TO fixture_user USING(user_id=current_setting('request.jwt.claim.sub',true)) WITH CHECK(user_id=current_setting('request.jwt.claim.sub',true)); GRANT SELECT,INSERT ON public.documents TO fixture_user; GRANT USAGE ON SCHEMA public TO fixture_user,fixture_outsider; GRANT USAGE ON SEQUENCE public.documents_id_seq TO fixture_user; REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SEQUENCE public.unused_counter START 9007199254740993; INSERT INTO public.documents(user_id,title) VALUES('fixture-owner','Synthetic SOP'),('other-owner','Other synthetic SOP'); SELECT setval('public.documents_id_seq',40,true); CREATE FUNCTION public.read_document_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.documents'; ALTER FUNCTION public.read_document_count() OWNER TO fixture_author; REVOKE ALL ON FUNCTION public.read_document_count() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.read_document_count() TO fixture_user; ALTER DEFAULT PRIVILEGES FOR ROLE fixture_author IN SCHEMA public GRANT SELECT ON TABLES TO fixture_user; GRANT USAGE ON SCHEMA public TO fixture_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_reader; GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_reader;`);
 sql('fixture_source',`CREATE TYPE public.fixture_status AS ENUM ('draft','effective'); ALTER TYPE public.fixture_status OWNER TO fixture_author; CREATE DOMAIN public.fixture_label AS text CHECK(length(value)>0); ALTER DOMAIN public.fixture_label OWNER TO fixture_author; CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.fixture_hook_target(id int); CREATE FUNCTION public.fixture_hook() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'; CREATE TRIGGER fixture_disabled BEFORE INSERT ON auth.fixture_hook_target FOR EACH ROW EXECUTE FUNCTION public.fixture_hook(); ALTER TABLE auth.fixture_hook_target DISABLE TRIGGER fixture_disabled; CREATE TRIGGER fixture_replica BEFORE INSERT ON auth.fixture_hook_target FOR EACH ROW EXECUTE FUNCTION public.fixture_hook(); ALTER TABLE auth.fixture_hook_target ENABLE REPLICA TRIGGER fixture_replica;`);
 sql('fixture_target',`CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.fixture_hook_target(id int);`);
 const source=client('fixture_source');const metadata=await recoveryMetadata(source);
 const dump=docker(['exec',name,'pg_dump','-U','supabase_admin','-d','fixture_source','--schema-only','--schema=public','--no-owner']).replace(/^\\(?:un)?restrict.*$/gm,'');
 sql('fixture_target',`DROP SCHEMA public CASCADE;${dump}`);
 const rows=JSON.parse(sql('fixture_source',`SELECT json_agg(documents) FROM public.documents;`));
 sql('fixture_target',rows.map(r=>`INSERT INTO public.documents OVERRIDING SYSTEM VALUE VALUES(${r.id},'${r.user_id}','${r.title}');`).join('\n')+metadataRestoreSql(metadata));
 assert.deepEqual(await recoveryMetadata(client('fixture_target')),metadata);report.checks.push('Owners, enum/domain ownership, disabled/replica hook state, SECURITY DEFINER ownership and exact sequence state match');
 const acls=`select c.relname,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname`;
 assert.equal(sql('fixture_target',acls),sql('fixture_source',acls));
 const defaults=`select defaclrole::regrole::text,defaclobjtype,defaclacl::text from pg_default_acl order by 1,2`;
 assert.equal(sql('fixture_target',defaults),sql('fixture_source',defaults));report.checks.push('Table/sequence ACLs and default privileges match');
 assert.equal(sql('fixture_target',`SET ROLE fixture_user; SET request.jwt.claim.sub='fixture-owner'; SELECT count(*) FROM public.documents;`).trim().split('\n').at(-1),'1');
 assert.throws(()=>sql('fixture_target',`SET ROLE fixture_outsider; SELECT * FROM public.documents;`),/permission denied/);
 assert.throws(()=>sql('fixture_target',`SET ROLE fixture_user; SET request.jwt.claim.sub='fixture-owner'; INSERT INTO public.documents(user_id,title) VALUES('other-owner','must fail');`),/row-level security/);
 assert.throws(()=>sql('fixture_target',`SET ROLE fixture_outsider; SELECT public.read_document_count();`),/permission denied/);report.checks.push('Restored authorization allows owner, hides other rows and denies outsider/function access');
 assert.equal(sql('fixture_target',`SELECT nextval('public.documents_id_seq');`).trim(),'42'); // failed RLS insert consumed 41
 assert.equal(sql('fixture_target',`SELECT nextval('public.unused_counter');`).trim(),'9007199254740993');report.checks.push('Called and unused sequence counters resume correctly above JavaScript safe integer range');
 const before=await sequenceState(source);assert.deepEqual(before,metadata.sequences);
 assert.throws(()=>sql('fixture_source',`SET ROLE fixture_reader; SELECT nextval('public.documents_id_seq');`),/permission denied/);
 assert.deepEqual(await sequenceState(source),before);report.checks.push('Source counters unchanged; SELECT-only reader cannot advance them');
 sql('fixture_source',`CREATE ROLE fixture_column_writer NOLOGIN; GRANT USAGE ON SCHEMA public TO fixture_column_writer; GRANT SELECT, UPDATE(title) ON public.documents TO fixture_column_writer;`);
 const roleClient=role=>({query:async q=>({rows:JSON.parse(sql('fixture_source',`SET ROLE ${role}; SELECT coalesce(json_agg(x),'[]') FROM (${q}) x;`).trim().split('\n').at(-1))})});
 await assertReadOnly(roleClient('fixture_reader'));
 await assert.rejects(assertReadOnly(roleClient('fixture_column_writer')),/write privileges/);
 report.checks.push('Read-only audit accepts SELECT-only role and refuses column-only UPDATE grants');
 sql('fixture_source',`CREATE FUNCTION public.fixture_privileged_write() RETURNS void LANGUAGE sql SECURITY DEFINER AS 'UPDATE public.documents SET title=title';`);
 const documentsBefore=sql('fixture_source','SELECT json_agg(documents ORDER BY id) FROM public.documents;');
 await assert.rejects(assertReadOnly(roleClient('fixture_reader')),/privileged routines/);
 assert.equal(sql('fixture_source','SELECT json_agg(documents ORDER BY id) FROM public.documents;'),documentsBefore);
 report.checks.push('Inherited PUBLIC execution of a privileged writer is refused by catalog audit without invoking it or changing source rows');
 report.passed=true;
} catch(e){report.passed=false;report.failure=e.message;process.exitCode=1;}finally{if(created)docker(['rm','-fv',name]);writeFileSync(new URL('../../docs/local-backup-recovery-metadata-report.json',import.meta.url),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
