import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "./types";
import { saveTaskPhotoAnnotationsToSupabase } from "./supabase-planner";
const arrow={id:"a",type:"arrow" as const,color:"red",strokeWidth:3,x1:0,y1:0,x2:1,y2:1};
const base={p:{version:2 as const,items:[arrow]}};
const local={p:{version:2 as const,items:[{...arrow,color:"blue"}]}};
function fixture(conflicts=0, fail=false) {
 const writes: Record<string,unknown>[]=[]; const versions: unknown[]=[];
 let revision=7;
 const fields={unrelated:"preserved",stepPhotoAnnotations:{p:{version:2,items:[arrow,{...arrow,id:"remote"}]}}};
 class Query {
  update(patch:Record<string,unknown>){writes.push(patch);return this;}
  select(){return this;}
  eq(column:string,value:unknown){if(column==="version")versions.push(value);return this;}
  single(){return Promise.resolve({data:{custom_fields:fields,version:revision},error:null});}
  maybeSingle(){if(fail)return Promise.resolve({data:null,error:new Error("offline")});return Promise.resolve({data:conflicts-- > 0 ? (revision++,null) : {version:++revision},error:null});}
 }
 return {writes,versions,client:{from(table:string){expect(table).toBe("tasks");return new Query();}} as unknown as SupabaseClient};
}
describe("annotation-only persistence",()=>{
 it("preserves unrelated metadata and remote marks without writing procedure tables",async()=>{
  const f=fixture(1);
  const task={id:"t",customFields:{stepPhotoAnnotations:local},manufacturingSteps:[]} as unknown as Task;
  const saved=await saveTaskPhotoAnnotationsToSupabase(task,base,undefined,f.client);
  expect(f.versions).toEqual([7,8]);expect(f.writes).toHaveLength(2);
  expect(f.writes[1]).toMatchObject({custom_fields:{unrelated:"preserved",stepPhotoAnnotations:{p:{items:[{...arrow,color:"blue"},{...arrow,id:"remote"}]}}}});
  expect(saved.version).toBe(9);
 });
 it("reports a failed write instead of acknowledging it",async()=>{
  const f=fixture(0,true);
  await expect(saveTaskPhotoAnnotationsToSupabase({id:"t",customFields:{stepPhotoAnnotations:local}} as unknown as Task,base,undefined,f.client)).rejects.toThrow("offline");
 });
});
