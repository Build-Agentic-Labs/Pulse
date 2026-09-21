import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { kickSopNotifications } from "./notify-kick";
import { listMySignaturesFor, moveSeat, reassignSeat } from "./review";
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: vi.fn() }));
vi.mock("./notify-kick", () => ({ kickSopNotifications: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function clientWith(result: { data: unknown; error: unknown }) {
 const query: Record<string, unknown> = {};
 for (const method of ["from", "select", "in", "eq", "update", "maybeSingle", "rpc"]) query[method] = vi.fn(() => query);
 query.then = (resolve: (value: typeof result) => void) => resolve(result);
 vi.mocked(createPlannerSupabaseClient).mockReturnValue(query as unknown as ReturnType<typeof createPlannerSupabaseClient>);
 return query;
}
describe("SOP routing store", () => {
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
