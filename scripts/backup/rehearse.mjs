/** Fixture-only rehearsal: in-memory databases, no connection strings or live endpoints. */
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CRITICAL, assertReadOnly, productionRecords } from './source.mjs';
import { writeArchive, verifyArchive, digest } from './archive.mjs';

const runtime = process.argv[2], reportPath = process.argv[3];
if (!runtime || !reportPath) throw new Error('Usage: node scripts/backup/rehearse.mjs TEMP_RUNTIME REPORT_JSON');
const { PGlite } = await import(pathToFileURL(path.join(runtime, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
// No network can be reached by this process. Provider gets an explicit fixture fetch.
globalThis.fetch = async () => { throw new Error('Network disabled during recovery rehearsal.'); };
const source = await PGlite.create(), target = await PGlite.create();
const scratch = await mkdtemp(path.join(tmpdir(), 'pulse-backup-rehearsal-'));
const report = { performedAt: new Date().toISOString(), environment: 'Two disposable in-memory PGlite PostgreSQL databases plus a temporary file directory', productionConnected: false, limitations: ['Real pg_dump/snapshot sharing was substituted with the known fixture schema.', 'This is not a full Supabase schema/auth/policy/application recovery rehearsal.', 'Production exports remain locked.'], checks: [] };
const check = (name, detail = 'passed') => report.checks.push({ name, result: detail });
const quote = (name) => `"${name.replaceAll('"','""')}"`;
const overrides = {
  projects: 'id text primary key, name text not null',
  tasks: 'id text primary key, project_id text references projects(id), name text, position integer',
  manufacturing_steps: 'id text primary key, task_id text references tasks(id), name text, position integer, duration numeric, checks jsonb',
  manufacturing_components: 'id text primary key, step_id text references manufacturing_steps(id), part_number text, quantity numeric',
  step_photos: 'id text primary key, step_id text references manufacturing_steps(id), task_id text references tasks(id), storage_path text, thumbnail_storage_path text, caption text, deleted_at text',
  sops: 'id text primary key, title text, status text, doc jsonb',
  sop_revisions: 'id text primary key, sop_id text references sops(id), revision integer, content jsonb',
  sop_signatures: 'id text primary key, sop_id text references sops(id), signer_id text, meaning text, strokes jsonb',
  sop_review_annotations: 'id text primary key, sop_id text references sops(id), comment text',
  work_instruction_releases: 'id text primary key, task_id text references tasks(id), revision text, content jsonb',
};
const order = ['projects','tasks','manufacturing_steps','manufacturing_components','step_photos','sops','sop_revisions','sop_signatures','sop_review_annotations','work_instruction_releases', ...CRITICAL.filter((name) => !overrides[name])];
const schema = order.map((name) => `CREATE TABLE public.${quote(name)} (${overrides[name] || 'id text primary key, payload jsonb'});`).join('\n');
const photo = randomBytes(1000), thumbnail = randomBytes(111);
let inventory = [{ bucket_id:'step-photos', name:'fixture/photo.png', updated_at:'2026-10-02', metadata:{size:photo.length} }, { bucket_id:'step-photos', name:'fixture/thumb.png', updated_at:'2026-10-02', metadata:{size:thumbnail.length} }];
const originals = new Map([['step-photos/fixture/photo.png',photo],['step-photos/fixture/thumb.png',thumbnail]]);
let scenario = 'normal';
const password = randomBytes(32).toString('hex');
const archive = path.join(scratch,'fixture.pulsebackup');
try {
  await source.exec(schema);
  await source.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id text primary key,email text,created_at text); CREATE SCHEMA storage; CREATE TABLE storage.objects(bucket_id text,name text,updated_at text,metadata jsonb); CREATE TABLE storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const seed = {
    projects:[{id:'project-1',name:'Fixture product'}],
    tasks:[{id:'task-1',project_id:'project-1',name:'Assembly',position:1}],
    manufacturing_steps:[{id:'step-2',task_id:'task-1',name:'Tighten bolt',position:2,duration:5,checks:{torque:true}},{id:'step-1',task_id:'task-1',name:'Fit bracket',position:1,duration:3,checks:{qc:true}}],
    manufacturing_components:[{id:'bom-1',step_id:'step-1',part_number:'BRACKET-001',quantity:2}],
    step_photos:[{id:'photo-1',step_id:'step-1',task_id:'task-1',storage_path:'fixture/photo.png',thumbnail_storage_path:'fixture/thumb.png',caption:'Original fixture',deleted_at:null}],
    sops:[{id:'sop-1',title:'Fixture quality document',status:'effective',doc:{purpose:'Keep quality consistent',activities:[{id:'activity-1',title:'Inspect',next:'activity-2'},{id:'activity-2',title:'Release'}]}}],
    sop_revisions:[{id:'rev-1',sop_id:'sop-1',revision:1,content:{title:'Previous fixture revision'}}],
    sop_signatures:[{id:'sig-1',sop_id:'sop-1',signer_id:'user-1',meaning:'approval',strokes:[[1,2],[3,4]]}],
    sop_review_annotations:[{id:'comment-1',sop_id:'sop-1',comment:'Fixture review feedback'}],
    work_instruction_releases:[{id:'release-1',task_id:'task-1',revision:'A',content:{steps:['step-1','step-2']}}],
  };
  for(const table of order) {
    for(const row of seed[table] || [{id:`${table}-fixture`,payload:{fixture:true}}]) {
      const columns=Object.keys(row); await source.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
    }
  }
  await source.query('INSERT INTO auth.users VALUES ($1,$2,$3)',['user-1','fixture@example.test','2026-10-02']);
  await source.exec("INSERT INTO storage.buckets VALUES ('step-photos','step-photos',false,null,null)");
  for(const item of inventory) await source.query('INSERT INTO storage.objects VALUES ($1,$2,$3,$4)',Object.values(item));
  await source.exec('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE fixture_reader BYPASSRLS; GRANT USAGE ON SCHEMA public,auth,storage TO fixture_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public,storage TO fixture_reader; GRANT SELECT(id,email,created_at) ON auth.users TO fixture_reader; SET ROLE fixture_reader;');
  const adapter = {
    syntheticSource:true,
    Client:class { async connect(){} async end(){ await source.exec('ROLLBACK'); } async query(sql,params){ if(sql.includes('pg_export_snapshot')) return {rows:[{id:'fixture-snapshot'}]}; const result = await source.query(sql,params);
      if(sql === 'COMMIT' && scenario === 'changed') { await source.exec("RESET ROLE; UPDATE storage.objects SET updated_at='changed-during-export'; SET ROLE fixture_reader;"); }
      return result; } },
    dumpSchema:async()=>({stdout:schema}),
    fetch:async(url,options)=>{assert.equal(options.method,'GET');const key=decodeURIComponent(new URL(url).pathname.split('/authenticated/')[1]);if(scenario === 'unavailable') return new Response(null,{status:503});
      if(scenario === 'interrupted') throw new Error('Fixture download interrupted');
      const data=originals.get(key);return data ? new Response(data) : new Response(null,{status:404});},
  };
  const config={databaseUrl:'postgres://fixture_reader:unused@localhost/disposable',storageUrl:'https://fixture.invalid',storageReadToken:'fixture-read-only',anonKey:'fixture-only',pgDump:'fixture-schema'};
  await assertReadOnly({query:(sql,params)=>source.query(sql,params)});
  await assert.rejects(source.query("UPDATE sops SET title='must never change'"),/permission denied/); check('Read-only role rejects direct updates');
  const before={}; for(const table of order) before[table]=(await source.query(`SELECT * FROM ${quote(table)} ORDER BY id`)).rows;
  await writeArchive(archive,password,productionRecords(config,()=>{},adapter));
  check('Actual PostgreSQL fixture rows exported in a read-only transaction');
  const records=[]; await verifyArchive(archive,password,(record)=>records.push(record));
  // The target has no network URL; it can only ever be this new in-memory database.
  await target.exec(schema); await target.exec('BEGIN');
  for(const table of order) for(const record of records.filter((item)=>item.type==='row' && item.table===table)) {
    const columns=Object.keys(record.row); await target.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(record.row));
  }
  await target.exec('COMMIT');
  let rows=0;for(const table of order){const restored=(await target.query(`SELECT * FROM ${quote(table)} ORDER BY id`)).rows;assert.deepEqual(restored,before[table]);rows+=restored.length;}
  check('All records, SOP revisions, signatures, comments and work-instruction releases match',`${rows} rows across ${order.length} tables`);
  assert.deepEqual((await target.query('SELECT id FROM manufacturing_steps ORDER BY position')).rows,[{id:'step-1'},{id:'step-2'}]);check('Step order and BOM quantities retained');
  await assert.rejects(target.query("INSERT INTO manufacturing_components VALUES ('bad','missing-step','BAD',1)"),/foreign key/);check('Restored foreign-key constraints reject broken references');
  const restoredRoot=path.join(scratch,'restored-files');await mkdir(restoredRoot);
  let current,chunks=[];for(const record of records){if(record.type==='file-start'){current=`${record.bucket}/${record.path}`;chunks=[];}if(record.type==='file-chunk')chunks.push(Buffer.from(record.data,'base64'));if(record.type==='file-end'){const bytes=Buffer.concat(chunks);assert.equal(digest(bytes),digest(originals.get(current)));const file=path.join(restoredRoot,current);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);assert.deepEqual(await readFile(file),originals.get(current));}}
  check('Original media and thumbnail bytes match',`${originals.size} files`);
  for(const table of order) assert.deepEqual((await source.query(`SELECT * FROM ${quote(table)} ORDER BY id`)).rows,before[table]);check('Source fixture records unchanged after export and recovery');
  let callbacks=0;const encrypted=await readFile(archive),tampered=Buffer.from(encrypted);tampered[tampered.length-1]^=1;const bad=path.join(scratch,'tampered.pulsebackup');await writeFile(bad,tampered);
  await assert.rejects(verifyArchive(bad,password,()=>{callbacks++;}));assert.equal(callbacks,0);check('Invalid authentication tag causes zero recovery callbacks');
  await assert.rejects(verifyArchive(archive,'wrong-password-fixture'));check('Wrong password rejected');
  const truncated=path.join(scratch,'truncated.pulsebackup');await writeFile(truncated,encrypted.subarray(0,encrypted.length-20));await assert.rejects(verifyArchive(truncated,password));check('Truncated export rejected');
  await assert.rejects(writeArchive(archive,password,productionRecords(config,()=>{},adapter)));assert.deepEqual(await readFile(archive),encrypted);check('Existing verified archive preserved on collision');
  for(const mode of ['unavailable','interrupted','changed']) {
    scenario=mode; const failed=path.join(scratch,`${mode}.pulsebackup`);
    await assert.rejects(writeArchive(failed,password,productionRecords(config,()=>{},adapter)));
    await assert.rejects(readFile(failed)); check(`${mode} storage export never produces a verified archive`);
  }
  scenario='normal';
  await source.exec("RESET ROLE; DELETE FROM storage.objects WHERE name='fixture/photo.png'; SET ROLE fixture_reader;");
  const missing=path.join(scratch,'missing.pulsebackup');
  await assert.rejects(writeArchive(missing,password,productionRecords(config,()=>{},adapter)),/missing storage file/);
  await assert.rejects(readFile(missing));check('Missing referenced photo refuses completion');
  for(const table of order) assert.deepEqual((await source.query(`SELECT * FROM ${quote(table)} ORDER BY id`)).rows,before[table]);
  check('All business fixture rows unchanged after every failure simulation');
  report.passed=true;
} catch(error){report.passed=false;report.failure=String(error.message);throw error;}
finally{await source.close();await target.close();await rm(scratch,{recursive:true,force:true});await writeFile(reportPath,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
