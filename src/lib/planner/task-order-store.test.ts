import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/domain/types";
import { taskOrderPatch } from "@/domain/task-reorder";
import { reorderTasksInSupabase } from "./task-order-store";
const before = [{ id:"a",scenarioId:"s",wbs:"1",stationId:"st",name:"A",customFields:{} },
 { id:"b",scenarioId:"s",wbs:"2",stationId:"st",name:"B",customFields:{} }] as Task[];
const after=before.map(task=>({...task,wbs:task.id==='a'?'2':'1'}));
function server(tasks=before){
 const rows=tasks.map(task=>({...taskOrderPatch(task),version:3}));
 const read=vi.fn().mockResolvedValue({data:rows,error:null,status:200});
 const write=vi.fn().mockImplementation(async(args)=>({data:{operation_id:args.p_operation_id,scenario_id:args.p_scenario_id,
 tasks:args.p_order.map((row:object)=>({...row,version:5}))},error:null,status:200}));
 const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'author'}}}})},from:vi.fn(),
 rpc:vi.fn().mockImplementation((name,args)=>name==='load_task_reorder_baseline'?read(args):write(args))};
 return {client,read,write};
}
describe('atomic task reorder store',()=>{
 it('uses the injected client for a scoped baseline and one atomic write, without table queries',async()=>{
 const {client,read,write}=server();const result=await reorderTasksInSupabase('p','s',before,after,client as never);
 expect(read).toHaveBeenCalledExactlyOnceWith({p_project_id:'p',p_scenario_id:'s',p_actor_id:'author'});
 expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({p_project_id:'p',p_scenario_id:'s',p_actor_id:'author',p_expected_versions:{a:3,b:3},p_order:after.map(taskOrderPatch)}));
 expect(client.from).not.toHaveBeenCalled();expect(client.rpc.mock.calls.map(call=>call[0])).toEqual(['load_task_reorder_baseline','reorder_scenario_tasks']);
 expect(result.map(row=>row.wbs)).toEqual(['2','1']);
 });
 it('keeps the identical operation token and content after a lost response',async()=>{
 const {client,write}=server();write.mockRejectedValueOnce(new Error('Network disconnected'));
 await reorderTasksInSupabase('p','s',before,after,client as never);expect(write).toHaveBeenCalledTimes(2);
 expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
 });
 it('also retries the status-zero fetch error supabase-js returns',async()=>{
 const {client,write}=server();write.mockResolvedValueOnce({data:null,error:{message:'Failed to fetch',code:''},status:0});
 await reorderTasksInSupabase('p','s',before,after,client as never);expect(write).toHaveBeenCalledTimes(2);
 expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
 });
 it.each(['40001','42501','22023'])('never retries database error %s',async code=>{
 const {client,write}=server();write.mockResolvedValue({data:null,error:{code,message:'Rejected'},status:400});
 await expect(reorderTasksInSupabase('p','s',before,after,client as never)).rejects.toThrow(code==='40001'?'Task reorder conflict':'Rejected');
 expect(write).toHaveBeenCalledTimes(1);
 });
 it('refuses a changed scope between baseline and write',async()=>{
 const {client,read,write}=server();let current=true;read.mockImplementationOnce(async()=>{current=false;return {data:before.map(task=>({...taskOrderPatch(task),version:3})),error:null};});
 await expect(reorderTasksInSupabase('p','s',before,after,client as never,()=>{if(!current)throw new Error('Scope changed');})).rejects.toThrow('Scope changed');
 expect(write).not.toHaveBeenCalled();
 });
 it('refuses a scope change before retrying a lost response',async()=>{
 const {client,write}=server();let current=true;write.mockImplementationOnce(async()=>{current=false;throw new Error('Lost response');});
 await expect(reorderTasksInSupabase('p','s',before,after,client as never,()=>{if(!current)throw new Error('Scope changed');})).rejects.toThrow('Scope changed');
 expect(write).toHaveBeenCalledTimes(1);
 });
 it('accepts a complete scalar-JSON baseline beyond the API row cap while sending two changed rows',async()=>{
 const tasks=Array.from({length:1100},(_,i)=>({...before[0],id:`task-${i}`,wbs:String(i+1)}));
 const reordered=tasks.map((task,i)=>({...task,wbs:i===0?'2':i===1?'1':task.wbs}));const {client,write}=server(tasks);
 await reorderTasksInSupabase('p','s',tasks,reordered,client as never);
 expect(Object.keys(write.mock.calls[0][0].p_expected_versions)).toHaveLength(1100);
 expect(write.mock.calls[0][0].p_order).toHaveLength(2);expect(client.rpc).toHaveBeenCalledTimes(2);
 });
 it('does not submit under a different account after reading the baseline',async()=>{
 const {client,read,write}=server();read.mockImplementationOnce(async()=>{client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'}}}});
 return {data:before.map(task=>({...taskOrderPatch(task),version:3})),error:null};});
 await expect(reorderTasksInSupabase('p','s',before,after,client as never)).rejects.toThrow('account changed');expect(write).not.toHaveBeenCalled();
 });
 it('does not read or write without a signed-in account',async()=>{
 const {client}=server();client.auth.getSession.mockResolvedValue({data:{session:null}} as never);
 await expect(reorderTasksInSupabase('p','s',before,after,client as never)).rejects.toThrow('Sign in to reorder');expect(client.rpc).not.toHaveBeenCalled();
 });
 it('does not submit unchanged ordering',async()=>{
 const {client,write}=server();expect(await reorderTasksInSupabase('p','s',before,before,client as never)).toHaveLength(2);expect(write).not.toHaveBeenCalled();
 });
});
