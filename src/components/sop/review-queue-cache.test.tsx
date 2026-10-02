// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewQueue } from "./review-queue";
import { EMPTY_QUEUE, fetchReviewQueueData } from "@/lib/sop/review-queue-data";
vi.mock("./sop-workspace-provider", () => ({ useSopWorkspace: () => ({ workspaceId: "workspace" }) }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: vi.fn(), getUserFromSession: async () => ({ data: { user: { id: "reviewer" } } }) }));
vi.mock("@/lib/sop/review-queue-data", async (original) => ({ ...await original<object>(), fetchReviewQueueData: vi.fn() }));
vi.mock("./sop-review-workspace", () => ({ SopReviewWorkspace: ({ onSubmitted }: { onSubmitted: () => void }) => <button onClick={onSubmitted}>Submit review</button> }));
vi.mock("./sop-final-approval-workspace", () => ({ SopFinalApprovalWorkspace: () => null }));
vi.mock("@/lib/sop/review-queue-count", () => ({ publishReviewQueueCount: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
it("coalesces focus and visibility refreshes while a queue request is pending", async () => {
  let resolve!: (value: typeof EMPTY_QUEUE) => void;
  vi.mocked(fetchReviewQueueData).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<ReviewQueue initialQueue={EMPTY_QUEUE} initialWorkspaceId="workspace" />);
  await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledOnce());
  act(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetchReviewQueueData).toHaveBeenCalledOnce();
  await act(async () => resolve(EMPTY_QUEUE));
});
it("reuses fresh queue data when switching away and back", async () => {
  vi.mocked(fetchReviewQueueData).mockResolvedValue(EMPTY_QUEUE);
  const view = render(<ReviewQueue active />);
  await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledOnce());
  await act(async () => {});
  view.rerender(<ReviewQueue active={false} />);
  view.rerender(<ReviewQueue active />);
  expect(fetchReviewQueueData).toHaveBeenCalledOnce();
});
it("refreshes a retained queue once its freshness window expires", async () => {
  vi.mocked(fetchReviewQueueData).mockResolvedValue(EMPTY_QUEUE);
  const view = render(<ReviewQueue active />);
  await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledOnce());
  await act(async () => {});
  view.rerender(<ReviewQueue active={false} />);
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16_000);
  view.rerender(<ReviewQueue active />);
  await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledTimes(2));
  now.mockRestore();
});

it("workflow completion forces a refresh even during an older pending request", async () => {
  let resolveOld!: (value: typeof EMPTY_QUEUE) => void;
  vi.mocked(fetchReviewQueueData)
    .mockReturnValueOnce(new Promise((done) => { resolveOld = done; }))
    .mockResolvedValue(EMPTY_QUEUE);
  render(<ReviewQueue openReviewId="sop" />);
  await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld(EMPTY_QUEUE));
});

it("refreshes fresh cached data immediately after a workflow mutation", async () => {
 vi.mocked(fetchReviewQueueData).mockResolvedValue(EMPTY_QUEUE);
 render(<ReviewQueue active />);
 await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledOnce());
 window.dispatchEvent(new Event("pulse:sop-notifications-refresh"));
 await waitFor(() => expect(fetchReviewQueueData).toHaveBeenCalledTimes(2));
});
