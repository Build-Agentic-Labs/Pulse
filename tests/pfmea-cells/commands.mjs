import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString='postgresql://postgres:pfmea-local-fixture@127.0.0.1:58522/pfmea_cell_test';
const admin=new pg.Client({connectionString});await admin.connect();
const a=new pg.Client({connectionString});await a.connect();await a.query('set role authenticated');await a.query("select set_config('request.jwt.claim.sub','a7300000-0000-0000-0000-000000000001',false)");
const row={id:'row',failureMode:'Cap removed under pressure',effect:'Coolant spray',cause:'Pressure not checked',severity:9,occurrence:3,detection:5,currentControls:'Cooling instruction',detectionActivity:'Gauge check',recommendedActions:'Add pressure check',actionOwner:'Fixture owner',targetDate:'2026-10-30',actionsTaken:'Added check',resultOccurrence:2,resultDetection:2,verificationNotes:'Trial check passed',actionStatus:'awaiting_verification'};
const original={id:'command-doc',productId:'command-product',version:2,settings:{highRpnThreshold:125,highSeverityThreshold:9},rows:[row]};
await admin.query("insert into products(id,project_id,custom_fields) values('command-product','fixture-project',$1) on conflict(id) do update set custom_fields=excluded.custom_fields",[{keep:'unchanged',productPfmeaDocument:original}]);
const command=async(base,document,id=randomUUID())=>(await a.query('select commit_pfmea_document_command($1,$2,$3,$4,$5,$6) as document',['command-product','fixture-project','command-doc',id,JSON.stringify(base),JSON.stringify(document)])).rows[0].document;
let passed=0;
try{
 let next=structuredClone(original);next.rows[0].actionStatus='closed';
 const id=randomUUID();let saved=await command(original,next,id);assert.equal(saved.rows[0].actionStatus,'closed');assert.ok(saved.rows[0].verifiedAt);passed++;
 assert.deepEqual(await command(original,next,id),saved);passed++;
 await assert.rejects(()=>command(original,next),/document conflict/);passed++;
 next=structuredClone(saved);next.rows[0].resultOccurrence=5;next.rows[0].resultDetection=5;
 await assert.rejects(()=>command(saved,next),/below the threshold/);passed++;
 next=structuredClone(saved);next.rows[0].verificationNotes='';await assert.rejects(()=>command(saved,next),/required PFMEA fields/);passed++;
 next=structuredClone(saved);next.rows.push({...row,id:'added'});saved=await command(saved,next);assert.equal(saved.rows.length,2);passed++;
 next=structuredClone(saved);next.settings.highRpnThreshold=150;saved=await command(saved,next);assert.equal(saved.settings.highRpnThreshold,150);passed++;
 next=structuredClone(saved);next.rows[0].actionStatus='awaiting_verification';next.rows[0].effect='Updated effect';saved=await command(saved,next);assert.equal(saved.rows[0].verifiedAt,undefined);passed++;
 assert.equal((await admin.query("select custom_fields->>'keep' as keep from products where id='command-product'")).rows[0].keep,'unchanged');passed++;
 console.log(JSON.stringify({passed,scope:'disposable local database only',checks:['verified completion','idempotent command retry','stale command rejection','threshold enforcement','required evidence','row addition','settings','reverification','unrelated fields preserved']}));
}finally{await a.end();await admin.end();}
