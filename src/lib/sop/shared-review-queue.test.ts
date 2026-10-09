// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { EMPTY_QUEUE, fetchReviewQueueData, type QueueData } from "./review-queue-data";
import { fetchSharedReviewQueue, invalidateSharedReviewQueue } from "./shared-review-queue";

vi.mock("./review-queue-data", () => ({ EMPTY_QUEUE: {}, fetchReviewQueueData: vi.fn() }));

const client = () => ({}) as SupabaseClient<Database>;
function deferred() {
  let resolve!: (value: QueueData) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<QueueData>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.mocked(fetchReviewQueueData).mockReset());

describe("shared review queue reads", () => {
  it("shares concurrent reads and fetches again after they settle", async () => {
    const db = client();
    const first = deferred();
    vi.mocked(fetchReviewQueueData).mockReturnValueOnce(first.promise).mockResolvedValue(EMPTY_QUEUE);
    const bell = fetchSharedReviewQueue("ws", "user", db);
    const queue = fetchSharedReviewQueue("ws", "user", db);
    expect(bell).toBe(queue);
    expect(fetchReviewQueueData).toHaveBeenCalledOnce();
    first.resolve(EMPTY_QUEUE);
    await bell;
    await fetchSharedReviewQueue("ws", "user", db);
    expect(fetchReviewQueueData).toHaveBeenCalledTimes(2);
  });

  it("isolates workspace, user, and client", async () => {
    const db = client();
    vi.mocked(fetchReviewQueueData).mockResolvedValue(EMPTY_QUEUE);
    await Promise.all([
      fetchSharedReviewQueue("one", "a", db),
      fetchSharedReviewQueue("two", "a", db),
      fetchSharedReviewQueue("one", "b", db),
      fetchSharedReviewQueue("one", "a", client()),
    ]);
    expect(fetchReviewQueueData).toHaveBeenCalledTimes(4);
  });

  it("returns a fresh trailing read to every consumer after an in-flight mutation", async () => {
    const db = client();
    const first = deferred();
    const fresh = { ...EMPTY_QUEUE, authorNames: { author: "Current" } };
    vi.mocked(fetchReviewQueueData).mockReturnValueOnce(first.promise).mockResolvedValueOnce(fresh);
    const bell = fetchSharedReviewQueue("ws", "user", db);
    invalidateSharedReviewQueue();
    const queue = fetchSharedReviewQueue("ws", "user", db);
    first.resolve(EMPTY_QUEUE);
    expect(await bell).toBe(fresh);
    expect(await queue).toBe(fresh);
    expect(fetchReviewQueueData).toHaveBeenCalledTimes(2);
  });

  it("releases failed reads so subsequent refreshes can recover", async () => {
    const db = client();
    vi.mocked(fetchReviewQueueData).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(EMPTY_QUEUE);
    await expect(fetchSharedReviewQueue("ws", "user", db)).rejects.toThrow("offline");
    expect(await fetchSharedReviewQueue("ws", "user", db)).toBe(EMPTY_QUEUE);
    expect(fetchReviewQueueData).toHaveBeenCalledTimes(2);
  });
});
