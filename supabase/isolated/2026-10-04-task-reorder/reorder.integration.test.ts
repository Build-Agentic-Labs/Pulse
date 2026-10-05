import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/database.types';
import { mapTask } from '@/lib/planner/row-mappers';
import { taskOrderPatch, taskReorderRequest } from '@/domain/task-reorder';
import { saveTasksToSupabase } from '@/lib/planner/task-store';
import { reorderTasksInSupabase } from '@/lib/planner/task-order-store';

const holder=vi.hoisted(()=>({client:undefined as SupabaseClient<Database>|undefined}));
vi.mock('@/lib/planner/client', async original=>({
 ...await original<typeof import('@/lib/planner/client')>(),plannerClient:()=>holder.client!,
}));
const api=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(api!=='http://127.0.0.1:56321') throw new Error('Isolated task-reorder pilot only.');
const pool=new pg.Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:56322/postgres'});
afterAll(()=>pool.end());
const admin=createClient(api,process.env.E2E_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
async function fixture() {
 const ws=`d-${randomUUID()}`, domain=`${randomUUID()}.test`,email=`pilot@${domain}`,password='Atomic-test-password-42!';
 await pool.query('insert into workspaces(id,name) values($1,$2)',[ws,'Task reorder pilot']);
 await pool.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2)',[domain,ws]);
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error) throw created.error;
 const user=created.data.user.id;
 await pool.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3)',[ws,user,'editor']);
 const requests:Array<{method:string;path:string;bytes:number}>=[];
 const client=createClient<Database>(api!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.pathname.startsWith('/rest/v1/')) requests.push({method:init?.method??'GET',path:url.pathname,bytes:Buffer.byteLength(typeof init?.body==='string'?init.body:'')});
 return fetch(input,init);
 }}});
 const signed=await client.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;
 const project=await client.rpc('create_project_with_starter_plan',{p_workspace_id:ws,p_name:'Atomic reorder pilot'});if(project.error)throw project.error;
 const projectId=project.data!;
 const scenario=(await pool.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1',[projectId])).rows[0].id;
 const station=`station-${scenario}-unzoned`;
 await pool.query('insert into stations(id,scenario_id,sequence,name) values($1,$2,1,$3)',[station,scenario,'Unzoned']);
 const ids=[0,1,2].map(()=>`d-task-${randomUUID()}`);
 for(let i=0;i<ids.length;i++) {
 const step=`step-${ids[i]}`;
 await pool.query(`insert into tasks(id,scenario_id,station_id,wbs,name,description,planned_start,planned_finish,custom_fields)
 values($1,$2,$3,$4,$5,'Keep field',now(),now(),$6)`,[ids[i],scenario,station,String(i+1),`Task ${i+1}`,JSON.stringify({stepToolLists:{[step]:['Wrench']}})]);
 await pool.query('insert into manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values($1,$2,1,$3,$4,1)',[step,ids[i],'Step','Keep instruction']);
 await pool.query('insert into step_tools(id,step_id,task_id,tool_name,sequence) values($1,$2,$3,$4,1)',[`tool-${step}-wrench`,step,ids[i],'Wrench']);
 }
 const read=async()=> {
 const tools=(await pool.query('select * from step_tools where task_id=any($1) order by sequence,id',[ids])).rows;
 return (await pool.query('select to_jsonb(t) row from tasks t where scenario_id=$1 order by id',[scenario])).rows.map(row=>{
 const task=mapTask(row.row); const stepToolLists:Record<string,string[]>={};
 for(const tool of tools.filter(tool=>tool.task_id===task.id)) (stepToolLists[tool.step_id]??=[]).push(tool.tool_name);
 return {...task,customFields:{...task.customFields,stepToolLists}};
 });
 };
 holder.client=client;
 return {projectId,scenario,user,client,requests,ids,read,domain};
}
const swap=<T extends {id:string;wbs:string}>(tasks:T[],ids:string[])=>tasks.map(t=>({...t,wbs:t.id===ids[0]?'2':t.id===ids[1]?'1':t.wbs}));
const restore=<T extends {id:string;wbs:string}>(tasks:T[],ids:string[])=>tasks.map(t=>({...t,wbs:ids.includes(t.id)?String(ids.indexOf(t.id)+1):t.wbs}));

describe('real isolated task reorder',()=>{
 it('measures the actual old and new request/payload paths on the same fixture',async()=>{
 const f=await fixture();const samples=[];
 for(let i=0;i<5;i++) {
 let before=await f.read(),after=i%2===0?swap(before,f.ids):restore(before,f.ids);
 const changed=after.filter(t=>t.wbs!==before.find(b=>b.id===t.id)!.wbs);
 f.requests.length=0;let start=performance.now();
 await saveTasksToSupabase(changed.map((t,index)=>({...t,wbs:`tmp-pilot-${randomUUID()}-${index}`})),f.projectId);
 await saveTasksToSupabase(changed,f.projectId);
 samples.push({path:'old',iteration:i,ms:performance.now()-start,requests:structuredClone(f.requests)});
 }
 for(let i=0;i<5;i++) {
 const before=await f.read(),after=i%2===0?restore(before,f.ids):swap(before,f.ids);
 const childBefore=(await pool.query('select to_jsonb(t) row from step_tools t where task_id=any($1) order by id',[f.ids])).rows;
 f.requests.length=0;const start=performance.now();
 await reorderTasksInSupabase(f.projectId,f.scenario,before,after,f.client);
 samples.push({path:'new',iteration:i,ms:performance.now()-start,requests:structuredClone(f.requests)});
 expect((await f.read()).map(taskOrderPatch)).toEqual(after.map(taskOrderPatch));
 expect((await pool.query('select to_jsonb(t) row from step_tools t where task_id=any($1) order by id',[f.ids])).rows).toEqual(childBefore);
 expect(f.requests).toHaveLength(2);
 expect(f.requests.map(r=>r.path)).toEqual(['/rest/v1/rpc/load_task_reorder_baseline','/rest/v1/rpc/reorder_scenario_tasks']);
 }
 mkdirSync('scratch/task-reorder',{recursive:true});writeFileSync('scratch/task-reorder/request-measurements.json',JSON.stringify({fixture:{tasks:3,steps:3,tools:3,changedTasks:2},samples},null,2));
 console.log(samples.map(s=>`${s.path}: ${s.requests.length} requests, ${s.requests.reduce((n,r)=>n+r.bytes,0)} body bytes, ${s.ms.toFixed(1)} ms`).join('\n'));
 });
 it('measures the full-baseline cost for an adjacent move in a 1100-task scenario',async()=>{
 const f=await fixture(),stamp=randomUUID();
 await pool.query(`insert into tasks(id,scenario_id,station_id,wbs,name,planned_start,planned_finish)
 select 'd-stress-'||$1||'-'||i,$2,'station-'||$2||'-unzoned',i::text,'Stress '||i,now(),now()
 from generate_series(4,1100) i`,[stamp,f.scenario]);
 const samples=[];
 for(const path of ['old','new']) for(let i=0;i<5;i++) {
 const before=await f.read(),after=path==='old'?(i%2===0?swap(before,f.ids):restore(before,f.ids)):(i%2===0?restore(before,f.ids):swap(before,f.ids));
 const changed=after.filter(t=>t.wbs!==before.find(b=>b.id===t.id)!.wbs);
 f.requests.length=0;const start=performance.now();
 if(path==='old') {
 await saveTasksToSupabase(changed.map((t,index)=>({...t,wbs:`tmp-stress-${randomUUID()}-${index}`})),f.projectId);
 await saveTasksToSupabase(changed,f.projectId);
 } else {
 await reorderTasksInSupabase(f.projectId,f.scenario,before,after,f.client);
 expect(f.requests).toHaveLength(2);
 }
 samples.push({path,iteration:i,ms:performance.now()-start,requests:structuredClone(f.requests)});
 expect((await f.read()).map(taskOrderPatch)).toEqual(after.map(taskOrderPatch));
 }
 writeFileSync('scratch/task-reorder/stress-measurements.json',JSON.stringify({fixture:{tasks:1100,steps:3,tools:3,changedTasks:2},samples},null,2));
 });
 it('reproduces a two-call interruption leaving temporary numbering in the old path',async()=>{
 const f=await fixture(),before=await f.read(),after=swap(before,f.ids);
 const changed=after.filter(t=>t.wbs!==before.find(b=>b.id===t.id)!.wbs);
 await saveTasksToSupabase(changed.map((t,i)=>({...t,wbs:`tmp-old-repro-${randomUUID()}-${i}`})),f.projectId);
 const persisted=await f.read();expect(persisted.filter(t=>t.wbs.startsWith('tmp-old-repro-'))).toHaveLength(2);
 // Simulated lost network before the second call. Preserve fixture, repair its synthetic ordering via the pilot only.
 await reorderTasksInSupabase(f.projectId,f.scenario,persisted,restore(persisted,f.ids),f.client);
 });
 it('serializes two concurrent transactions; the stale second reorder changes nothing',async()=>{
 const f=await fixture(),before=await f.read();const remote=before.map(t=>({...taskOrderPatch(t),version:t.version!}));
 const request=taskReorderRequest(f.projectId,f.scenario,randomUUID(),before,swap(before,f.ids),remote);
 const a=await pool.connect(),b=await pool.connect();
 const other=randomUUID();
 await pool.query("insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)",[other,`${other}@${f.domain}`]);
 await pool.query("insert into workspace_members(workspace_id,user_id,role) select workspace_id,$1,'editor' from projects where id=$2",[other,f.projectId]);
 await pool.query("insert into project_access(project_id,user_id,level) values($1,$2,'edit')",[f.projectId,other]);
 const begin=async(c:pg.PoolClient,uid=f.user)=>{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await c.query('set local role authenticated');};
 const apply=(c:pg.PoolClient,op:string,actor=f.user)=>c.query('select reorder_scenario_tasks($1,$2,$3,$4,$5,$6)',[f.projectId,f.scenario,op,JSON.stringify(request.p_expected_versions),JSON.stringify(request.p_order),actor]);
 try {
 await begin(a);await begin(b,other);await apply(a,request.p_operation_id);
 let finished=false;const pending=apply(b,randomUUID(),other).then(()=>{finished=true;return null},error=>{finished=true;return error});
 await new Promise(resolve=>setTimeout(resolve,80));expect(finished).toBe(false);
 await a.query('commit');const error=await pending;expect(error?.code).toBe('40001');await b.query('rollback');
 expect((await f.read()).map(taskOrderPatch)).toEqual(swap(before,f.ids).map(taskOrderPatch));
 } finally {await a.query('rollback');await b.query('rollback');a.release();b.release();}
 });
 it('makes a task insert wait until the reorder commits, then preserves the new task',async()=>{
 const f=await fixture(),before=await f.read(),a=await pool.connect(),b=await pool.connect();
 const request=taskReorderRequest(f.projectId,f.scenario,randomUUID(),before,swap(before,f.ids),before.map(t=>({...taskOrderPatch(t),version:t.version!})));
 const id=`d-added-${randomUUID()}`;
 try {
 await a.query('begin');await b.query('begin');await a.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);await a.query('set local role authenticated');
 await a.query('select reorder_scenario_tasks($1,$2,$3,$4,$5,$6)',[f.projectId,f.scenario,request.p_operation_id,JSON.stringify(request.p_expected_versions),JSON.stringify(request.p_order),f.user]);
 let finished=false;const inserted=b.query('insert into tasks(id,scenario_id,wbs,name,planned_start,planned_finish) values($1,$2,\'4\',\'Added\',now(),now())',[id,f.scenario]).then(()=>{finished=true});
 await new Promise(resolve=>setTimeout(resolve,80));expect(finished).toBe(false);await a.query('commit');await inserted;await b.query('commit');
 expect((await f.read()).find(t=>t.id===id)?.wbs).toBe('4');
 } finally {await a.query('rollback');await b.query('rollback');a.release();b.release();}
 });
});
