import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ require:vi.fn(), from:vi.fn(), rpc:vi.fn(), link:vi.fn(), deliver:vi.fn(), send:vi.fn(), calls:[] as string[], status:"draft", transitionError:false, nomination:{ sop_id:"sop",department_id:"dept",email:"new@anacorp.com",position_title:"Engineer",delivery_id:"delivery",delivered_at:null as string | null,delivery_started_at:null,created_by:"author" } }));
vi.mock("@/lib/api-auth",()=>({ requireApiUser:mocks.require,createApiRateLimiter:()=>()=>true }));
vi.mock("@supabase/supabase-js",()=>({ createClient:()=>({ from:mocks.from,rpc:mocks.rpc }) }));
vi.mock("@/lib/workspace/invite-delivery",()=>({ generateSetupLink:mocks.link,deliverInvitationEmail:mocks.deliver,inviteRedirectTarget:()=>"https://pulse.example/invite" }));
vi.mock("@/lib/notifications/sender-from-env",()=>({ createEmailSenderFromEnv:()=>({ send:mocks.send }) }));
import { POST } from "./route";
function request(){ return new Request("https://pulse.example/api/sops/approvers/submit",{ method:"POST",body:JSON.stringify({ sopId:"sop",expectedUpdatedAt:"version" }) }); }
beforeEach(()=>{
 vi.clearAllMocks(); mocks.calls.length=0; mocks.status="draft";mocks.transitionError=false;mocks.nomination.delivered_at=null;
 vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://supabase.example");
 mocks.require.mockResolvedValue({ userId:"author",failure:null,supabase:{ from:mocks.from,rpc:mocks.rpc } });
 mocks.rpc.mockImplementation(async(name:string)=>({ data:name==="acquire_sop_submission_lock"?"lock-token":name==="can_edit_sop_content"?true:{ mode:"invite",user_id:"new-user" },error:null }));
 mocks.link.mockResolvedValue({ kind:"link",tokenHash:"secret-test-token",type:"invite",userId:"new-user" });
 mocks.deliver.mockImplementation(async()=>{mocks.calls.push("email");return true;});
 mocks.from.mockImplementation((table:string)=>{
   let operation="select";let values:Record<string,unknown>={};
   const query: Record<string, unknown> = {};
   for(const method of ["select","eq","is","in","or","delete"]){ query[method]=()=>query; }
   query.update=(value:Record<string,unknown>)=>{operation="update";values=value;return query;};query.insert=()=>{operation="insert";return query;};
   const result=()=>{
     if(table==="sops"){
       if(operation==="update"){mocks.calls.push("transition");return mocks.transitionError?{data:null,error:{message:"Roster invalid"}}:{data:{id:"sop"},error:null};}
       return {data:{ id:"sop",workspace_id:"workspace",status:mocks.status,created_by:"author",submitted_by:"author",updated_at:"version" },error:null};
     }
     if(table==="sop_approver_nominations")return operation==="select"?{data:[{...mocks.nomination}],error:null}:{data:values.delivery_started_at?{delivery_id:"delivery"}:null,error:null};
     if(table==="sop_review_seats")return {data:{department_id:"dept"},error:null};
     if(table==="sop_approver_delivery_payloads")return {data:operation==="select"?{content:{subject:"Saved",html:"same-link",text:"same-link"}}:null,error:null};
     return {data:{name:"Organization"},error:null};
   };
   query.single=query.maybeSingle=async()=>result();query.then=(resolve:(result:unknown)=>unknown)=>Promise.resolve(result()).then(resolve);return query;
 });
});
describe("deferred approver submission",()=>{
 it("refuses overlapping account preparation before minting links", async()=>{
  const original = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation((name:string,...args:unknown[])=>name==="acquire_sop_submission_lock"?Promise.resolve({data:null,error:null}):original(name,...args));
  const result = await(await POST(request())).json();expect(result.error).toContain("already running");expect(mocks.link).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
 });
 it("starts review before delivering the invitation",async()=>{
  expect((await POST(request())).status).toBe(200);expect(mocks.calls).toEqual(["transition","email"]);
  expect(mocks.deliver.mock.calls[0][3]).toMatchObject({idempotencyKey:"sop-approver:delivery"});
 });
 it("does not email when the database refuses submission",async()=>{
  mocks.transitionError=true;expect((await POST(request())).status).toBe(400);expect(mocks.deliver).not.toHaveBeenCalled();
 });
 it("does not resend a delivered invitation",async()=>{
  mocks.status="in_review";mocks.nomination.delivered_at="sent";expect((await POST(request())).status).toBe(200);expect(mocks.deliver).not.toHaveBeenCalled();expect(mocks.link).not.toHaveBeenCalled();
 });
 it("retries delivery after review starts without restarting or minting a new link",async()=>{
  mocks.status="in_review";await POST(request());expect(mocks.calls).toEqual(["email"]);expect(mocks.link).not.toHaveBeenCalled();
 });
 it("reports an email failure without claiming the review failed",async()=>{
  mocks.deliver.mockResolvedValue(false);const result=await(await POST(request())).json();expect(result.submitted).toBe(true);expect(result.error).toContain("Review started");
 });
 it("rejects an unauthorized author before creating accounts or emailing",async()=>{
  mocks.rpc.mockResolvedValue({data:false,error:null});expect((await POST(request())).status).toBe(400);expect(mocks.link).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
 });
});
