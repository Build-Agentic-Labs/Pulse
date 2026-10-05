import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {test,expect,type BrowserContext,type Page} from '@playwright/test';
const api='http://127.0.0.1:56321';
const pool=new pg.Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:56322/postgres'});
const admin=createClient(api,process.env.E2E_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
test.afterAll(()=>pool.end());
async function fixture(context:BrowserContext){
 const ws=`d-browser-${randomUUID()}`,domain=`${randomUUID()}.test`,email=`pilot@${domain}`,password='Atomic-browser-password-42!';
 await pool.query('insert into workspaces(id,name) values($1,$2)',[ws,'Atomic browser']);
 await pool.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2)',[domain,ws]);
 const made=await admin.auth.admin.createUser({email,password,email_confirm:true});if(made.error)throw made.error;
 const user=made.data.user.id;
 await pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'editor')",[ws,user]);
 const client=createServerClient(api,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>[],setAll:async cookies=>{
 await context.addCookies(cookies.map(({name,value})=>({name,value,domain:'127.0.0.1',path:'/',sameSite:'Lax' as const})));}}});
 const signed=await client.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;
 const created=await client.rpc('create_project_with_starter_plan',{p_workspace_id:ws,p_name:'Atomic reorder product'});if(created.error)throw created.error;
 const project=created.data;
 const scenario=(await pool.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1',[project])).rows[0].id;
 const station=`station-${scenario}-unzoned`;
 await pool.query('insert into stations(id,scenario_id,sequence,name) values($1,$2,1,$3)',[station,scenario,'Unzoned']);
 const ids=[0,1,2].map(()=>`d-task-${randomUUID()}`);
 for(let index=0;index<3;index++) await pool.query(`insert into tasks(id,scenario_id,station_id,wbs,name,description,planned_start,planned_finish,planned_duration_minutes)
 values($1,$2,$3,$4,$5,'Keep field',now(),now()+interval '5 minutes',5)`,[ids[index],scenario,station,String(index+1),`Process ${index+1}`]);
 const snapshot=async()=>(await pool.query('select to_jsonb(t) row from tasks t where scenario_id=$1 order by id',[scenario])).rows.map(r=>r.row);
 return {project,scenario,ids,snapshot};
}
async function mobileDrag(page:Page,sourceName:string,targetId:string){
 const source=page.getByRole('button',{name:`Drag ${sourceName} to reorder`});
 const target=page.locator(`[data-mobile-task-id="${targetId}"]`).filter({has:page.locator('button[aria-label^="Drag "]')});
 const from=await source.boundingBox(),to=await target.boundingBox();expect(from).not.toBeNull();expect(to).not.toBeNull();
 await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);await page.mouse.down();
 await page.mouse.move(to!.x+30,to!.y+10);
 // The existing drop placeholder shifts the target card. Follow its rendered bounds.
 for(let index=0;index<3;index++) {
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
 const bounds=await target.boundingBox();
 await page.mouse.move(bounds!.x+30,bounds!.y+bounds!.height-10);
 }
 await page.mouse.up();
}
function reorderRequests(page:Page){
 const requests:Array<{method:string;path:string}>=[];
 page.on('request',request=>{const path=new URL(request.url()).pathname;
 if(path==='/rest/v1/rpc/reorder_scenario_tasks'||path==='/rest/v1/tasks'&&request.method()!=='GET'||path==='/rest/v1/step_tools'&&request.method()!=='GET') requests.push({method:request.method(),path});
 });return requests;
}
test('mobile drag commits narrow ordering and rolls it back after a refused save',async({page,context})=>{
 await page.setViewportSize({width:430,height:900});const f=await fixture(context);
 await page.goto(`/projects/${f.project}/mobile-photos`);
 await expect(page.getByRole('button',{name:'Drag Process 1 to reorder'})).toBeEnabled();
 const before=await f.snapshot(),requests=reorderRequests(page);
 await mobileDrag(page,'Process 1',f.ids[1]);
 await expect.poll(async()=>(await f.snapshot()).find(t=>t.id===f.ids[0]).wbs).toBe('2');
 await expect(page.getByRole('button',{name:'Drag Process 1 to reorder'})).toBeEnabled();
 expect(requests).toEqual([{method:'POST',path:'/rest/v1/rpc/reorder_scenario_tasks'}]);
 const after=await f.snapshot();
 const strip=(rows:Record<string,unknown>[])=>rows.map(({wbs: _wbs,version: _version,updated_at: _updated_at,...other})=>other);
 expect(strip(after)).toEqual(strip(before));
 await page.route('**/rest/v1/rpc/reorder_scenario_tasks',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Conflict'})}));
 await mobileDrag(page,'Process 2',f.ids[0]);
 await expect(page.getByText('Task reorder conflict. Reload before reordering again.',{exact:true})).toBeVisible();
 expect(await f.snapshot()).toEqual(after);
 // UI order returns to the confirmed order after failure.
 const names=await page.locator('[data-mobile-task-id] button[aria-label^="Drag "]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
 expect(names).toEqual(['Drag Process 2 to reorder','Drag Process 1 to reorder','Drag Process 3 to reorder']);
 await page.reload();await expect(page.getByRole('button',{name:'Drag Process 1 to reorder'})).toBeVisible();
 expect(await f.snapshot()).toEqual(after);
});
test('desktop drag uses the same single atomic write and survives a reload',async({page,context})=>{
 const f=await fixture(context);await page.goto(`/projects/${f.project}/planner?view=gantt`);
 const source=page.locator('[draggable="true"]').filter({hasText:'Process 1'});
 const target=page.locator('[draggable="true"]').filter({hasText:'Process 2'});
 await expect(source).toBeVisible();await expect(target).toBeVisible();
 const before=await f.snapshot(),requests=reorderRequests(page);
 await source.dragTo(target,{targetPosition:{x:50,y:45}});
 await expect.poll(async()=>(await f.snapshot()).find(t=>t.id===f.ids[0]).wbs).toBe('2');
 expect(requests).toEqual([{method:'POST',path:'/rest/v1/rpc/reorder_scenario_tasks'}]);
 const after=await f.snapshot();
 expect(after.map(({wbs: _wbs,version: _version,updated_at: _updated_at,...rest})=>rest)).toEqual(before.map(({wbs: _wbs,version: _version,updated_at: _updated_at,...rest})=>rest));
 await page.reload();await expect(page.locator('[draggable="true"]').filter({hasText:'Process 1'})).toBeVisible();
 expect(await f.snapshot()).toEqual(after);
});
