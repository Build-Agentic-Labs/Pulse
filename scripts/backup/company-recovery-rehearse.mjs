// Offline company-archive rehearsal. Only an owned, isolated Docker target is writable.
// No .env loading, provider credentials, published ports, or production connection.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,open,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHmac,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {verifiedRecords,digest} from './archive.mjs';
import {metadataRestoreSql,identifier} from './recovery-metadata.mjs';
const [archive,keyFile,reportFile]=process.argv.slice(2);
if(!archive||!keyFile||!reportFile)throw Error('Archive, private key file, and local report paths required.');
if((await stat(keyFile)).mode & 0o077)throw Error('Recovery key file must have private permissions.');
const password=(await readFile(keyFile,'utf8')).trim();
const prefix='pulse-company-recovery-'+randomUUID().slice(0,8),db=prefix+'-db',network=prefix+'-net';
const created=[],scratch=await mkdtemp(path.join(tmpdir(),prefix+'-'));
const report={performedAt:new Date().toISOString(),archive:path.basename(archive),productionConnected:false,realEmailsSent:false,network:'Owned internal Docker network; no published ports; no company provider credentials',passed:false,checks:[],limitations:['Identity IDs/emails are restored; live passwords, sessions, integrations and excluded operational rows are intentionally not cloned.','This validates schema, records, constraints and original file recovery; it does not prove provider email delivery or a complete browser workflow.']};
let networkCreated=false,phase='authenticate archive',fileHandle;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64e6,stdio:['pipe','pipe','pipe']});
const sql=q=>execFileSync('docker',['exec','-i',db,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:64e6,stdio:['pipe','pipe','pipe']});
const json=q=>JSON.parse(sql(`SELECT coalesce(json_agg(x),'[]') FROM (${q}) x;`).trim());
const literal=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const rowDigest=rows=>digest(rows.map(r=>JSON.stringify(canonical(r))).sort().join('\n'));
const rows=new Map(),identities=[],tableCounts=new Map();let schema,metadata,buckets,currentFile,fileHash,files=0,bytes=0;
try{
  // verifiedRecords authenticates the complete archive before yielding any company data.
  for await(const r of verifiedRecords(archive,password)){
    if(r.type==='schema')schema=r.sql;
    else if(r.type==='recovery-metadata')metadata=r;
    else if(r.type==='row'){if(!rows.has(r.table))rows.set(r.table,[]);rows.get(r.table).push(r.row);}
    else if(r.type==='table')tableCounts.set(r.name,r.rows);
    else if(r.type==='identity')identities.push(r.identity);
    else if(r.type==='buckets')buckets=r.buckets;
    else if(r.type==='file-start'){
      const root=path.join(scratch,'objects'),target=path.resolve(root,r.bucket,r.path);
      if(!target.startsWith(root+path.sep)||r.bucket.includes('/')||r.bucket==='..')throw Error('Unsafe file recovery path');
      await mkdir(path.dirname(target),{recursive:true,mode:0o700});fileHandle=await open(target,'wx',0o600);currentFile=target;fileHash=createHash('sha256');
    }else if(r.type==='file-chunk'){const chunk=Buffer.from(r.data,'base64');fileHash.update(chunk);await fileHandle.writeFile(chunk);bytes+=chunk.length;}
    else if(r.type==='file-end'){await fileHandle.close();fileHandle=null;assert.equal((await stat(currentFile)).size,r.bytes);assert.equal(fileHash.digest('hex'),r.sha256);const stored=createHash('sha256');for await(const chunk of createReadStream(currentFile))stored.update(chunk);assert.equal(stored.digest('hex'),r.sha256);files++;}
  }
  if(!schema||!metadata||!buckets||!tableCounts.size)throw Error('Required recovery records missing');
  for(const [table,count] of tableCounts)assert.equal((rows.get(table)||[]).length,count);
  report.checks.push({name:'Authenticated archive and recovered original file sizes/hashes',files,bytes});
  phase='initialize isolated managed schemas';console.log('Archive authenticated; original files recovered. Initializing isolated database.');
  docker(['network','create','--internal',network]);networkCreated=true;
  docker(['run','-d','--network',network,'--name',db,'-e','POSTGRES_PASSWORD=fixture-only','public.ecr.aws/supabase/postgres:17.6.1.158']);created.push(db);
  for(let i=0;i<60;i++){try{sql('SELECT 1');await new Promise(r=>setTimeout(r,2000));sql('SELECT 1');break;}catch{await new Promise(r=>setTimeout(r,500));}}
  sql("ALTER ROLE supabase_auth_admin PASSWORD 'fixture-only'; ALTER ROLE supabase_storage_admin PASSWORD 'fixture-only';");
  const secret=randomBytes(32).toString('hex');
  const token=role=>{const body=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,iss:'supabase',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
  const auth=prefix+'-auth';docker(['run','-d','--network',network,'--name',auth,'-e',`GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:fixture-only@${db}:5432/postgres`,'-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_SITE_URL=http://fixture.invalid','-e','API_EXTERNAL_URL=http://fixture.invalid','-e',`GOTRUE_JWT_SECRET=${secret}`,'-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','GOTRUE_DISABLE_SIGNUP=true','-e','GOTRUE_MAILER_AUTOCONFIRM=true','public.ecr.aws/supabase/gotrue:v2.196.0']);created.push(auth);
  const storage=prefix+'-storage';docker(['run','-d','--network',network,'--name',storage,'-e',`DATABASE_URL=postgres://supabase_storage_admin:fixture-only@${db}:5432/postgres`,'-e',`AUTH_JWT_SECRET=${secret}`,'-e',`JWT_SECRET=${secret}`,'-e',`ANON_KEY=${token('anon')}`,'-e',`SERVICE_KEY=${token('service_role')}`,'-e','STORAGE_BACKEND=file','-e','FILE_STORAGE_BACKEND_PATH=/var/lib/storage','-e','TENANT_ID=fixture','-e','REGION=local','-e','GLOBAL_S3_BUCKET=fixture','public.ecr.aws/supabase/storage-api:v1.71.0']);created.push(storage);
  let ready=false;for(let i=0;i<60;i++){try{sql('SELECT auth.uid(); SELECT 1 FROM storage.objects;');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!ready)throw Error('Managed schemas failed to initialize');
  // Stop services before loading company identities; nothing can send invitations.
  docker(['stop',auth,storage]);
  phase='restore schema';
  const roles=new Set(['pulse_backup_reader','pulse_backup_schema_reader','pulse_backup_storage_reader',metadata.schemaOwner,...metadata.owners.map(x=>x.owner),...metadata.routines.map(x=>x.owner),...(metadata.typeOwners||[]).map(x=>x.owner),...(metadata.storagePolicies||[]).flatMap(x=>x.roles)]);
  for(const match of schema.matchAll(/^GRANT [^\n]* TO ([^;\n]+);$/gm))for(const r of match[1].split(','))roles.add(r.trim().replace(/^"|"$/g,''));
  const existing=new Set(json('SELECT rolname FROM pg_roles').map(x=>x.rolname));
  for(const role of roles){if(role==='public'||role==='PUBLIC'||existing.has(role))continue;if(!/^[a-z][a-z0-9_]*$/.test(role))throw Error('Unexpected recovery role');sql(`CREATE ROLE ${identifier(role)} NOLOGIN;`);}
  sql(schema.replace(/^\\(?:un)?restrict.*$/gm,''));
  const triggers=json(`SELECT c.relname AS table,t.tgname AS name,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`);
  const publicTables=json(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
  sql(publicTables.map(t=>`ALTER TABLE public.${identifier(t.tablename)} DISABLE TRIGGER ALL;`).join('\n'));
  // Temporarily remove FKs in this owned target, then restore and validate all of them.
  const fks=json(`SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname='public' ORDER BY c.relname,k.conname`);
  sql(fks.map(k=>`ALTER TABLE ${identifier(k.schema)}.${identifier(k.table)} DROP CONSTRAINT ${identifier(k.name)};`).join('\n'));
  phase='restore identities and rows';
  sql(`BEGIN; SET LOCAL session_replication_role=replica;${identities.map(i=>`INSERT INTO auth.users(id,email,created_at,aud,role) VALUES(${literal(i.id)},${literal(i.email)},${literal(i.created_at)},'authenticated','authenticated');`).join('\n')}COMMIT;`);
  for(const [table,count] of tableCounts){
    if(count===0)continue;
    const values=rows.get(table),columns=json(`SELECT attname FROM pg_attribute WHERE attrelid=${literal('public.'+identifier(table))}::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='' ORDER BY attnum`).map(x=>x.attname);
    for(let offset=0;offset<values.length;offset+=250){
      sql(`BEGIN; SET LOCAL session_replication_role=replica; INSERT INTO public.${identifier(table)}(${columns.map(identifier).join(',')}) OVERRIDING SYSTEM VALUE SELECT ${columns.map(identifier).join(',')} FROM jsonb_populate_recordset(NULL::public.${identifier(table)},${literal(JSON.stringify(values.slice(offset,offset+250)))}::jsonb); COMMIT;`);
    }
  }
  phase='validate recovered records and constraints';
  for(const [table,count] of tableCounts){const recovered=json(`SELECT * FROM public.${identifier(table)}`);assert.equal(recovered.length,count);assert.equal(rowDigest(recovered),rowDigest(rows.get(table)||[]));}
  sql(fks.map(k=>`ALTER TABLE ${identifier(k.schema)}.${identifier(k.table)} ADD CONSTRAINT ${identifier(k.name)} ${k.definition};`).join('\n'));
  sql(triggers.map(t=>`ALTER TABLE public.${identifier(t.table)} ${{O:'ENABLE',D:'DISABLE',R:'ENABLE REPLICA',A:'ENABLE ALWAYS'}[t.enabled]} TRIGGER ${identifier(t.name)};`).join('\n'));
  sql(metadataRestoreSql(metadata));
  const sequences=json(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname`);
  for(const s of sequences){const actual=json(`SELECT last_value::text AS value,is_called FROM public.${identifier(s.name)}`)[0];assert.deepEqual(actual,metadata.sequences.find(x=>x.name===s.name)&&{value:metadata.sequences.find(x=>x.name===s.name).value,is_called:metadata.sequences.find(x=>x.name===s.name).is_called});}
  report.checks.push({name:'Public schema and every included row match authenticated archive',tables:tableCounts.size,rows:[...tableCounts.values()].reduce((a,b)=>a+b,0),identities:identities.length});
  report.checks.push({name:'Foreign keys restored and validated; owners, policies, hooks and counters restored',foreignKeys:fks.length,sequences:sequences.length});
  report.passed=true;console.log('PASS: isolated company schema, records, constraints, metadata and original files recovered.');
}catch{report.failedPhase=phase;process.exitCode=1;console.error('Recovery validation stopped in phase: '+phase+'. No production connection or changes.');}
finally{
  await fileHandle?.close().catch(()=>{});
  for(const name of created.reverse())try{docker(['rm','-f','-v',name]);}catch{report.cleanupFailure=true;}
  if(networkCreated)try{docker(['network','rm',network]);}catch{report.cleanupFailure=true;}
  await rm(scratch,{recursive:true,force:true}); // Only the newly owned test copy; archive/key are preserved.
  await writeFile(reportFile,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
}
