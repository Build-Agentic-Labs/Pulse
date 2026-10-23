import { describe, expect, it, vi } from "vitest";
import { listAwiMasters } from "./store";

function clientFixture(failAt?: number) {
  const records = Array.from({ length: 1203 }, (_, index) => ({ id: `awi-${index}` }));
  const range = vi.fn(async (from: number, to: number) => from === failAt
    ? { data: null, error: { message: "Connection lost" } }
    : { data: records.slice(from, to + 1), error: null });
  const order = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const client = { from: vi.fn(() => ({ select, eq, order, range })) };
  return { client, range, order, eq, records };
}

describe("AWI master collection reads", () => {
  it("reads all records beyond the API cap under the original workspace filter", async () => {
    const { client, records, range, order, eq } = clientFixture();
    expect(await listAwiMasters("workspace-a", client as never)).toEqual(records);
    expect(range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(eq.mock.calls).toEqual(Array(3).fill(["workspace_id", "workspace-a"]));
    expect(order.mock.calls).toEqual(Array.from({ length: 3 }, () => [["created_at", { ascending: false }], ["id"]]).flat());
  });

  it("rejects a failed later page instead of returning an incomplete list", async () => {
    const { client } = clientFixture(500);
    await expect(listAwiMasters("workspace-a", client as never)).rejects.toThrow("Connection lost");
  });
});

describe('AWI copy attachments', () => {
  it('creates separate storage objects and remaps attachments to copied steps', async () => {
    const { copyAwiMaster } = await import('./store');
    const source = { id: 'source', task_id: 'old-task', title: 'Original' } as import('./store').AwiMaster;
    const target = { id: 'copy', task_id: 'new-task', project_id: 'new-project', workspace_id: 'ws', title: 'Copy' };
    const inserts: {table:string;row: Record<string,unknown>}[] = [];
    const copies: string[][] = [];
    const client = {
      rpc: vi.fn(async () => ({data:'copy',error:null})),
      storage: {from: () => ({copy: async (from:string,to:string) => {copies.push([from,to]);return {data:{},error:null};}})},
      from: (table:string) => {
        let taskId = ''; let write = false;
        const result = () => ({error:null,data:write ? null : table === 'awi_masters' ? target : table === 'tasks' ? {custom_fields:{},version:1} : table === 'manufacturing_steps' ? [{id:taskId==='old-task'?'old-step':'new-step',sequence:1}] : table === 'step_photos' ? [{id:'old-photo',task_id:'old-task',step_id:'old-step',storage_path:'original/photo',thumbnail_storage_path:'original/thumb',file_name:'photo.png',public_url:''}] : []});
        const q = {select:()=>q,eq:(key:string,val:string)=>{if(key==='task_id')taskId=val;return q;},is:()=>q,order:()=>q,range:async()=>result(),maybeSingle:async()=>result(),single:async()=>result(),insert:(row:Record<string,unknown>)=>{write=true;inserts.push({table,row});return q;},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
        return q;
      },
    };
    await copyAwiMaster(source,'Copy',client as never);
    expect(copies).toHaveLength(2);
    expect(copies.every(([from,to])=>from!==to && to.startsWith('workspaces/ws/projects/new-project/'))).toBe(true);
    expect(inserts[0].row).toMatchObject({task_id:'new-task',step_id:'new-step'});
    expect(inserts[0].row.id).not.toBe('old-photo');
    expect(source.title).toBe('Original');
  });
});
