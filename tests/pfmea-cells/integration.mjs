// Runs ONLY against the disposable local test database created by bootstrap.sql.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString = 'postgresql://postgres:pfmea-local-fixture@127.0.0.1:58522/pfmea_cell_test';
const admin = new pg.Client({connectionString}); await admin.connect();
const alice='a7300000-0000-0000-0000-000000000001', bob='a7300000-0000-0000-0000-000000000002', viewer='a7300000-0000-0000-0000-000000000003';
const row = (id) => ({id,failureMode:'',effect:'',severity:5,occurrence:5,detection:5,verificationNotes:'',actionStatus:'open'});
const original = {id:'doc',productId:'fixture-product',version:2,rows:Array.from({length:242},(_,i)=>row(`row-${i}`))};
original.rows[5] = {...row('row-5'),actionStatus:'closed',verifiedAt:'2026-10-23T10:00:00Z'};
await admin.query('truncate products, fixture_access');
for (const [actor,level] of [[alice,'edit'],[bob,'edit'],[viewer,'view']]) await admin.query('insert into fixture_access values($1,$2,$3)',[actor,'fixture-project',level]);
await admin.query('insert into products values($1,$2,$3)', ['fixture-product','fixture-project',{keep:'unrelated',productPfmeaDocument:original}]);
await admin.query('insert into products values($1,$2,$3)', ['other-product','other-project',{productPfmeaDocument:{id:'other-doc',productId:'other-product',rows:[row('other-row')]}}]);
async function client(actor) { const client=new pg.Client({connectionString}); await client.connect(); await client.query('set role authenticated'); await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]); return client; }
const a=await client(alice), b=await client(bob), v=await client(viewer);
const change=(field,value,previous='',expectedVersion=0,rowId='row-0')=>({rowId,field,value,previous,expectedVersion});
const patch=async(client,changes,mutation=randomUUID(),product='fixture-product',project='fixture-project',document='doc')=>(await client.query('select patch_pfmea_cells($1,$2,$3,$4,$5) as document',[product,project,document,mutation,JSON.stringify(changes)])).rows[0].document;
const read=async()=> (await admin.query('select custom_fields from products where id=$1',['fixture-product'])).rows[0].custom_fields;
let checks=0;
try {
  await Promise.all([patch(a,[change('failureMode','Risk from Alice')]),patch(b,[change('effect','Effect from Bob')])]);
  let data=await read(); assert.equal(data.productPfmeaDocument.rows[0].failureMode,'Risk from Alice'); assert.equal(data.productPfmeaDocument.rows[0].effect,'Effect from Bob'); checks++;
  await Promise.all([patch(a,[change('severity',7,5,0,'row-1')]),patch(b,[change('occurrence',2,5,0,'row-241')])]);
  data=await read(); assert.equal(data.productPfmeaDocument.rows.length,242); assert.equal(data.productPfmeaDocument.rows[1].severity,7); assert.equal(data.productPfmeaDocument.rows[241].occurrence,2); assert.equal(data.keep,'unrelated'); checks++;
  const writes=await Promise.allSettled([patch(a,[change('severity',6,5,0,'row-2')]),patch(b,[change('severity',8,5,0,'row-2')])]);
  assert.equal(writes.filter(result=>result.status==='fulfilled').length,1); assert.match(writes.find(result=>result.status==='rejected').reason.message,/conflict/i); checks++;
  const mutation=randomUUID(); const receipt=await patch(a,[change('cause','Retry-safe',null,0,'row-3')],mutation); const retry=await patch(a,[change('cause','Retry-safe',null,0,'row-3')],mutation);
  assert.deepEqual(retry,receipt); assert.equal(retry.cellVersions['row-3'].cause.version,1); checks++;
  await patch(a,[change('cause','Next value','Retry-safe',1,'row-3')]);
  await assert.rejects(()=>patch(a,[change('cause','Retry-safe',null,0,'row-3')],mutation),/conflict/i); checks++;
  await assert.rejects(()=>patch(a,[change('effect','Should roll back','',0,'row-4'),change('failureMode','Conflicting','',0)]),/conflict/i);
  assert.equal((await read()).productPfmeaDocument.rows[4].effect,''); checks++;
  await assert.rejects(()=>patch(v,[change('effect','View-only edit','',0,'row-4')]),/access required/i); checks++;
  await assert.rejects(()=>patch(a,[change('effect','Wrong project','',0,'row-4')],undefined,'other-product','other-project','other-doc'),/access required/i); checks++;
  await assert.rejects(()=>patch(a,[change('severity',11,5,0,'row-4')]),/1 to 10/); checks++;
  await assert.rejects(()=>patch(a,[change('actionStatus','closed','open',0,'row-4')]),/separate PFMEA command/); checks++;
  await assert.rejects(()=>patch(a,[change('verifiedAt','2026-10-23',null,0,'row-4')]),/separate command/); checks++;
  await assert.rejects(()=>patch(a,[change('targetDate','2026-02-30',null,0,'row-4')]),/date\/time|out of range/i); checks++;
  const archived=await patch(a,[change('archivedAt','2026-10-23T11:00:00Z',null,0,'row-5')]);
  assert.equal(archived.rows[5].actionStatus,'closed'); assert.ok(archived.rows[5].verifiedAt); checks++;
  const revised=await patch(a,[change('effect','New analysis','',0,'row-5')]);
  assert.equal(revised.rows[5].actionStatus,'awaiting_verification'); assert.equal(revised.rows[5].verifiedAt,undefined); checks++;
  // ABA: returning to the same content must not make an old version current again.
  await patch(a,[change('effect','Intermediate','',0,'row-6')]); await patch(a,[change('effect','','Intermediate',1,'row-6')]);
  await assert.rejects(()=>patch(b,[change('effect','Old draft','',0,'row-6')]),/conflict/i); checks++;
  await assert.rejects(()=>patch(a,[change('effect','One','',0,'row-7'),change('effect','Two','',0,'row-7')]),/Duplicate cell/); checks++;
  assert.equal((await admin.query("select custom_fields->'productPfmeaDocument'->>'id' as id from products where id='other-product'")).rows[0].id,'other-doc'); checks++;
  await assert.rejects(()=>a.query("update products set custom_fields=jsonb_set(custom_fields,'{productPfmeaDocument,rows,0,effect}','\"Legacy overwrite\"') where id='fixture-product'"),/requires cell-based saves/i); checks++;
  await a.query("update products set custom_fields=jsonb_set(custom_fields,'{unrelated}','\"Updated safely\"') where id='fixture-product'");
  assert.equal((await read()).unrelated,'Updated safely'); checks++;
  console.log(JSON.stringify({passed:checks,rows:242,editors:2,scope:'disposable local database only',checks:['same-row different cells','different rows','same-cell conflict','exact retries','stale retry rejection','atomic batch rollback','view-only denial','project isolation','score validation','verification command separation','protected verification timestamp','date validation','archive preserves verification','analysis edit reopens verification','ABA version protection','duplicate-cell rejection','unrelated product preserved']},null,2));
} finally { await Promise.all([a.end(),b.end(),v.end(),admin.end()]); }
