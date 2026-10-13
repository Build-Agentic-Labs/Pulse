import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { kickSopNotifications } from "./notify-kick";
import { listMySignaturesFor, listSeats, moveSeat, reassignSeat, removeSeat, upsertSeat, submitSopWithApproverInvitations } from "./review";
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: vi.fn() }));
vi.mock("./notify-kick", () => ({ kickSopNotifications: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function clientWith(result: { data: unknown; error: unknown }) {
 const query: Record<string, unknown> = {};
 for (const method of ["from", "select", "in", "eq", "update", "insert", "delete", "maybeSingle", "rpc"]) query[method] = vi.fn(() => query);
 query.then = (resolve: (value: typeof result) => void) => resolve(result);
 vi.mocked(createPlannerSupabaseClient).mockReturnValue(query as unknown as ReturnType<typeof createPlannerSupabaseClient>);
 return query;
}
describe("SOP routing store", () => {
 it("inserts a new person without overwriting an existing department assignment", async () => {
  const client = clientWith({ data: null, error: null });
  await upsertSeat({ sopId: "sop", departmentId: "mfg", signerId: "second-manager", rasic: "responsible" });
  expect(client.insert).toHaveBeenCalledWith({ sop_id: "sop", department_id: "mfg", signer_id: "second-manager", rasic: "responsible" });
  expect(client.update).not.toHaveBeenCalled();
 });
 it("updates and removes only the individual assignment id", async () => {
  const client = clientWith({ data: { id: "second-seat" }, error: null });
  await upsertSeat({ id: "second-seat", sopId: "sop", departmentId: "mfg", signerId: "second-manager", rasic: "responsible" });
  expect(client.eq).toHaveBeenCalledWith("id", "second-seat");
  expect(client.eq).not.toHaveBeenCalledWith("department_id", "mfg");
  await removeSeat("sop", "second-seat");
  expect(client.delete).toHaveBeenCalledOnce();
  expect(client.eq).toHaveBeenCalledWith("id", "second-seat");
 });
 it("keeps two nominations from the same department attached to their own assignments", async () => {
  const seats = [{ id: "one", sop_id: "sop", department_id: "mfg", rasic: "responsible", signer_id: null },
   { id: "two", sop_id: "sop", department_id: "mfg", rasic: "responsible", signer_id: null }];
  const nominations = [{ seat_id: "two", email: "two@example.com", position_title: "Plant Manager", delivered_at: null },
   { seat_id: "one", email: "one@example.com", position_title: "Plant Manager", delivered_at: null }];
  let table = "";
  const client = clientWith({ data: null, error: null });
  client.from = vi.fn((name: string) => { table = name; return client; });
  client.then = (resolve: (value: unknown) => void) => resolve({ data: table === "sop_review_seats" ? seats : nominations, error: null });
  const result = await listSeats("sop");
  expect(result.map(seat => [seat.id, seat.nomination?.email])).toEqual([["one", "one@example.com"], ["two", "two@example.com"]]);
 });
 it("preserves the source SOP identity on batched signatures", async () => {
  clientWith({ data: [{ id: "sig", sop_id: "signed-sop", signer_id: "reviewer", meaning: "dept_approval", signed_content_hash: "hash", review_cycle: 1 }], error: null });
  expect(await listMySignaturesFor(["signed-sop", "unsigned-sop"], "reviewer"))
    .toEqual([expect.objectContaining({ sopId: "signed-sop", signerId: "reviewer" })]);
 });
 it("reports a refused department move without a delete/insert fallback", async () => {
  const client = clientWith({ data: null, error: { message: "The review roster is frozen" } });
  await expect(moveSeat("sop", "old", "new", "reviewer")).rejects.toThrow("frozen");
  expect(client.update).toHaveBeenCalledWith({ department_id: "new", signer_id: "reviewer" });
 });
 it("immediately kicks delivery after successful reassignment", async () => {
  clientWith({ data: null, error: null });
  await reassignSeat("sop", "department", "replacement");
  expect(kickSopNotifications).toHaveBeenCalledOnce();
 });
 it("does not kick delivery after a rejected reassignment", async () => {
  clientWith({ data: null, error: { message: "That seat has already signed" } });
  await expect(reassignSeat("sop", "department", "replacement")).rejects.toThrow("already signed");
  expect(kickSopNotifications).not.toHaveBeenCalled();
 });
});

describe("submission notifications", () => {
 it("kicks review alerts even if invitation delivery fails after review starts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ submitted:true,error:"Invitation delivery failed" }), {status:200})));
  await expect(submitSopWithApproverInvitations("sop","version")).rejects.toThrow("Invitation delivery failed");
  expect(kickSopNotifications).toHaveBeenCalledOnce(); vi.unstubAllGlobals();
 });
 it("kicks review alerts after a post-transition server error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ submitted:true,error:"Ledger unavailable" }), {status:400})));
  await expect(submitSopWithApproverInvitations("sop","version")).rejects.toThrow("Ledger unavailable");
  expect(kickSopNotifications).toHaveBeenCalledOnce(); vi.unstubAllGlobals();
 });
 it("does not notify when submission never started", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ submitted:false,error:"Roster invalid" }), {status:400})));
  await expect(submitSopWithApproverInvitations("sop","version")).rejects.toThrow("Roster invalid");
  expect(kickSopNotifications).not.toHaveBeenCalled(); vi.unstubAllGlobals();
 });
});
