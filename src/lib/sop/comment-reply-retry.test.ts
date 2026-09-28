import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ upsert: vi.fn(), single: vi.fn() }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: () => ({ from: () => ({ upsert: mock.upsert, select: () => ({ eq: () => ({ single: mock.single }) }) }) }) }));
import { addSopCommentReply } from "./review-annotations";
describe("reply retries", () => {
 it("uses the same insert identity after a response is lost", async () => {
  mock.upsert.mockResolvedValue({ error: null });
  mock.single.mockResolvedValueOnce({ error: { message: "Connection lost" }, data: null }).mockResolvedValueOnce({ error: null, data: { id: "request", created_by: "reviewer", body: "Reply", created_at: "today" } });
  await expect(addSopCommentReply("annotation", "Reply", "request")).rejects.toThrow("Connection lost");
  expect((await addSopCommentReply("annotation", "Reply", "request")).id).toBe("request");
  expect(mock.upsert).toHaveBeenNthCalledWith(1, { id: "request", annotation_id: "annotation", body: "Reply" }, { onConflict: "id", ignoreDuplicates: true });
  expect(mock.upsert).toHaveBeenNthCalledWith(2, { id: "request", annotation_id: "annotation", body: "Reply" }, { onConflict: "id", ignoreDuplicates: true });
 });
});
