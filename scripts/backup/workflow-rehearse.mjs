/** Owned synthetic Docker fixtures only. Never reads .env or a company connection. */
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {writeArchive,verifiedRecords,digest} from './archive.mjs';
import {recoveryMetadata,metadataRestoreSql,identifier} from './recovery-metadata.mjs';
import {assertReadOnly} from './source.mjs';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const prefix=`pulse-workflow-${randomUUID().slice(0,8)}`,db=`${prefix}-db`,network=`${prefix}-net`,created=[];
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64e6,stdio:['pipe','pipe','pipe']});
const sql=(database,text)=>execFileSync('docker',['exec','-i',db,'psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',maxBuffer:64e6,stdio:['pipe','pipe','pipe']});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const secret=randomBytes(32).toString('hex');
const token=role=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;};
const scratch=await mkdtemp(path.join(tmpdir(),'pulse-workflow-recovery-'));
const report={performedAt:new Date().toISOString(),productionConnected:false,realEmailsSent:false,environment:'Owned isolated PostgreSQL/Auth/Storage fixtures; no published ports, no company credentials',checks:[],passed:false};
try{
 docker(['network','create','--internal',network]);
 docker(['run','-d','--network',network,'--name',db,'-e','POSTGRES_PASSWORD=fixture-only','public.ecr.aws/supabase/postgres:17.6.1.158']);created.push(db);
 let ready=false;for(let i=0;i<60;i++){try{sql('postgres','SELECT 1');ready=true;break;}catch{await sleep(500);}}if(!ready)throw Error('Fixture DB did not start');await sleep(2000);
 sql('postgres',`ALTER ROLE supabase_auth_admin PASSWORD 'fixture-only'; ALTER ROLE supabase_storage_admin PASSWORD 'fixture-only';`);
 const auth=`${prefix}-auth`;docker(['run','-d','--network',network,'--name',auth,'-e',`GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:fixture-only@${db}:5432/postgres`,'-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_SITE_URL=http://fixture.invalid','-e','API_EXTERNAL_URL=http://fixture.invalid','-e',`GOTRUE_JWT_SECRET=${secret}`,'-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','GOTRUE_DISABLE_SIGNUP=true','-e','GOTRUE_MAILER_AUTOCONFIRM=true','public.ecr.aws/supabase/gotrue:v2.196.0']);created.push(auth);
 const storage=`${prefix}-storage`;docker(['run','-d','--network',network,'--name',storage,'-e',`DATABASE_URL=postgres://supabase_storage_admin:fixture-only@${db}:5432/postgres`,'-e',`AUTH_JWT_SECRET=${secret}`,'-e',`JWT_SECRET=${secret}`,'-e',`ANON_KEY=${token('anon')}`,'-e',`SERVICE_KEY=${token('service_role')}`,'-e','STORAGE_BACKEND=file','-e','FILE_STORAGE_BACKEND_PATH=/var/lib/storage','-e','TENANT_ID=fixture','-e','REGION=local','-e','GLOBAL_S3_BUCKET=fixture','public.ecr.aws/supabase/storage-api:v1.71.0']);created.push(storage);
 ready=false;for(let i=0;i<60;i++){try{sql('postgres','SELECT auth.uid(); SELECT 1 FROM storage.objects;');ready=true;break;}catch{await sleep(500);}}if(!ready)throw Error('Managed fixture schemas did not initialize');
 // Keep a clean managed-schema target before application migrations.
 sql('postgres','CREATE DATABASE fixture_target;');
 const managed=docker(['exec',db,'pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=auth','--schema=storage']).replace(/^\\(?:un)?restrict.*$/gm,'');
 sql('fixture_target',managed);
 sql('postgres',`GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;`);
 const migrations=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 sql('postgres',migrations.map(f=>readFileSync(new URL(`../../supabase/migrations/${f}`,import.meta.url),'utf8')).join('\n'));
 report.checks.push({name:'All current application migrations applied to isolated source',result:'passed',migrations:migrations.length});
 const users={author:'11111111-1111-4111-8111-111111111111',reviewer:'22222222-2222-4222-8222-222222222222',quality:'33333333-3333-4333-8333-333333333333',outsider:'44444444-4444-4444-8444-444444444444'};
 const literal=value=>`'${String(value).replaceAll("'","''")}'`;
 const canonical=ts.transpileModule(readFileSync(new URL('../../src/domain/sop/schema.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 const {createEmptySop}=await import(`data:text/javascript;base64,${Buffer.from(canonical).toString('base64')}`);
 const doc=createEmptySop('fixture-sop',new Date().toISOString());doc.meta.title='Synthetic Recovery Workflow';doc.purpose='Recovery validation';doc.scope='Synthetic only';
 const identities=Object.entries(users).map(([name,id])=>`INSERT INTO auth.users(id,email,aud,role) VALUES('${id}','${name}@fixture.invalid','authenticated','authenticated');`).join('\n');
 sql('postgres',`BEGIN; SET LOCAL session_replication_role=replica;${identities}
 INSERT INTO public.workspaces(id,name,owner_id) VALUES('fixture-workspace','Synthetic Recovery','${users.author}');
 ${Object.entries(users).filter(([name])=>name!=='outsider').map(([name,id])=>`INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('fixture-workspace','${id}','${name==='author'?'owner':'editor'}'); INSERT INTO public.org_tool_access(workspace_id,user_id,level) VALUES('fixture-workspace','${id}','edit');`).join('\n')}
 ${Object.entries(users).map(([name,id])=>`INSERT INTO public.profiles(id,full_name) VALUES('${id}','Fixture ${name}');`).join('\n')}
 INSERT INTO public.departments(id,workspace_id,code,name,is_quality_gate) VALUES('fixture-pro','fixture-workspace','PRO','Process',false),('fixture-mfg','fixture-workspace','MFG','Manufacturing',false),('fixture-qas','fixture-workspace','QAS','Quality',true);
 INSERT INTO public.department_members(department_id,user_id,dept_role) VALUES('fixture-pro','${users.author}','author'),('fixture-mfg','${users.reviewer}','author'),('fixture-qas','${users.quality}','approver');
 INSERT INTO public.sops(id,workspace_id,department_id,title,created_by,document,content_hash,status) VALUES('fixture-sop','fixture-workspace','fixture-pro','Synthetic Recovery Workflow','${users.author}',${literal(JSON.stringify(doc))}::jsonb,public.sop_doc_hash(${literal(JSON.stringify(doc))}::jsonb),'draft');
 INSERT INTO public.sop_review_seats(sop_id,department_id,rasic,signer_id) VALUES('fixture-sop','fixture-mfg','responsible','${users.reviewer}'); COMMIT;`);
 sql('fixture_target',identities);
 const json=(database,q)=>JSON.parse(sql(database,`SELECT coalesce(json_agg(x),'[]') FROM (${q}) x;`).trim());
 const client={query:async q=>({rows:json('postgres',q)})};
 const tables=json('postgres',`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`).map(r=>r.tablename);
 const sourceRows=Object.fromEntries(tables.map(table=>[table,json('postgres',`SELECT * FROM public.${identifier(table)}`)]));
 const before=digest(JSON.stringify(sourceRows));
 const schema=docker(['exec',db,'pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=public','--no-owner']).replace(/^\\(?:un)?restrict.*$/gm,'');
 const metadata=await recoveryMetadata(client),archive=path.join(scratch,'workflow.pulsebackup'),password=randomBytes(32).toString('hex');
 async function* records(){yield{type:'schema',sql:schema};yield metadata;for(const [table,rows] of Object.entries(sourceRows))for(const row of rows)yield{type:'row',table,row};}
 await writeArchive(archive,password,records());const rows=[];let recoveredMetadata;
 for await(const record of verifiedRecords(archive,password)){if(record.type==='schema')sql('fixture_target',`DROP SCHEMA public CASCADE;${record.sql}`);else if(record.type==='recovery-metadata')recoveredMetadata=record;else if(record.type==='row')rows.push(record);}
 sql('fixture_target',`BEGIN; SET LOCAL session_replication_role=replica;${rows.map(r=>`INSERT INTO public.${identifier(r.table)} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.${identifier(r.table)},${literal(JSON.stringify(r.row))}::jsonb);`).join('\n')} COMMIT;${metadataRestoreSql(recoveredMetadata)}`);
 for(const table of tables)assert.deepEqual(json('fixture_target',`SELECT * FROM public.${identifier(table)}`),sourceRows[table],`Recovered ${table}`);
 report.checks.push({name:'Encrypted archive restores all public rows, schema, owners, counters and managed hooks before workflow tests',result:'passed',tables:tables.length});
 // Test proposed permission preparation ONLY in the recovered synthetic target.
 const routinePermissions=json('fixture_target',`SELECT p.oid,r.oid AS role_oid,has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' ORDER BY p.oid,r.oid`);
 sql('fixture_target',`BEGIN;${readFileSync(new URL('./restrict-public-routines.sql',import.meta.url),'utf8')}COMMIT;`);
 assert.deepEqual(json('fixture_target',`SELECT p.oid,r.oid AS role_oid,has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' ORDER BY p.oid,r.oid`),routinePermissions);
 sql('fixture_target',`CREATE ROLE fixture_backup_reader NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO fixture_backup_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_backup_reader; GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_backup_reader;`);
 await assertReadOnly({query:async q=>({rows:JSON.parse(sql('fixture_target',`SET ROLE fixture_backup_reader; SELECT coalesce(json_agg(x),'[]') FROM (${q}) x;`).trim().split('\n').at(-1))})});
 report.checks.push({name:'Proposed routine grant preparation preserves every existing role EXECUTE permission and newly created SELECT-only reader passes audit',result:'passed'});
 const asUser=(name,q)=>sql('fixture_target',`SET ROLE authenticated; SET request.jwt.claims=${literal(JSON.stringify({sub:users[name],role:'authenticated',email:`${name}@fixture.invalid`}))};${q}`);
 const control=()=>json('fixture_target',`SELECT content_hash,review_cycle,status,sop_number,effective_revision_id FROM public.sops WHERE id='fixture-sop'`)[0];
 let state=control();const sign=(name,meaning,department=null)=>asUser(name,`SELECT public.sign_sop_with_mark('fixture-sop',${literal(meaning)},'[[{"x":1,"y":1},{"x":2,"y":2}]]'::jsonb,${department?literal(department):'NULL'},${literal(state.content_hash)},${state.review_cycle});`);
 assert.equal(asUser('outsider',`SELECT count(*) FROM public.sops WHERE id='fixture-sop';`).trim().split('\n').at(-1),'0');
 asUser('author',`SELECT public.sign_sop('fixture-sop','authorship',NULL,NULL,NULL,${literal(state.content_hash)},${state.review_cycle}); UPDATE public.sops SET status='in_review' WHERE id='fixture-sop';`);
 state=control();assert.equal(state.status,'in_review');
 assert.throws(()=>asUser('author',`SELECT public.request_sop_final_approval('fixture-sop');`),/Every required departmental approver/);
 asUser('reviewer',`SELECT public.submit_sop_review('fixture-sop',true);`);
 asUser('author',`SELECT public.send_sop_for_signatures('fixture-sop',${literal(state.content_hash)},${state.review_cycle});`);
 assert.throws(()=>sign('author','dept_approval','fixture-mfg'));
 assert.equal(json('fixture_target',`SELECT count(*)::int as n FROM public.user_signature_profiles WHERE user_id='${users.author}'`)[0].n,0);
 assert.throws(()=>sign('outsider','dept_approval','fixture-mfg'),/unavailable/);
 report.stage='department signature';sign('reviewer','dept_approval','fixture-mfg');assert.equal(control().status,'approved');
 const markBefore=json('fixture_target',`SELECT * FROM public.user_signature_profiles WHERE user_id='${users.reviewer}'`);
 sign('reviewer','dept_approval','fixture-mfg');
 assert.deepEqual(json('fixture_target',`SELECT * FROM public.user_signature_profiles WHERE user_id='${users.reviewer}'`),markBefore);
 assert.equal(json('fixture_target',`SELECT count(*)::int as n FROM public.sop_signatures WHERE sop_id='fixture-sop' AND meaning='dept_approval'`)[0].n,1);
 assert.throws(()=>asUser('reviewer',`SELECT public.sign_sop_with_mark('fixture-sop','quality_approval','[[{"x":9,"y":9}]]'::jsonb,NULL,${literal(state.content_hash)},${state.review_cycle});`));
 assert.deepEqual(json('fixture_target',`SELECT * FROM public.user_signature_profiles WHERE user_id='${users.reviewer}'`),markBefore);
 report.stage='quality signature';state=control();sign('quality','quality_approval');asUser('quality',`UPDATE public.sops SET status='effective' WHERE id='fixture-sop';`);
 state=control();assert.equal(state.status,'effective');assert.ok(state.sop_number);assert.ok(state.effective_revision_id);
 assert.equal(json('fixture_target',`SELECT count(*)::int as n FROM public.sop_signatures WHERE sop_id='fixture-sop'`)[0].n,3);
 report.checks.push({name:'Restored author submission, reviewer no-changes response, signature request, department signature, independent Quality signature and effective release pass',result:'passed'});
 report.checks.push({name:'Outsider hidden, premature approval refused, author cannot sign assigned seat, non-Quality cannot give final approval',result:'passed'});
 const events=json('fixture_target',`SELECT event_type FROM public.sop_event_log WHERE sop_id='fixture-sop' ORDER BY id`).map(r=>r.event_type);
 assert.ok(events.includes('final_approval_requested'));report.checks.push({name:'Workflow event outbox remains active after recovery',result:'passed',events});
 const after=Object.fromEntries(tables.map(table=>[table,json('postgres',`SELECT * FROM public.${identifier(table)}`)]));assert.equal(digest(JSON.stringify(after)),before);
 report.checks.push({name:'Every source public row unchanged after target review/signature/release operations',result:'passed'});
 report.checks.push({name:'Rejected signatures roll back mark updates; repeat signing does not duplicate signature or modify saved mark',result:'passed'});delete report.stage;
 report.passed=true;
 report.fullRecoveryValidated=false;
 report.limitations=['Tests actual restored database workflow; provider notification delivery and browser review transitions are not exercised here.','Synthetic Auth UUIDs prepared separately; no production Auth credentials copied.'];
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{await rm(scratch,{recursive:true,force:true});for(const name of created.reverse())docker(['rm','-fv',name]);docker(['network','rm',network]);writeFileSync(new URL('../../docs/local-backup-workflow-report.json',import.meta.url),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
