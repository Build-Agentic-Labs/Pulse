import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchReviewQueueData, type QueueData } from "./review-queue-data";
import { reviewQueueMutationGeneration } from "./review-queue-invalidation";
export { invalidateSharedReviewQueue } from "./review-queue-invalidation";

// Only concurrent browser reads are shared. Keeping no settled snapshot means
// permission changes and ordinary refreshes still read the current database.
const pendingByClient = new WeakMap<SupabaseClient<Database>, Map<string, Promise<QueueData>>>();

export function fetchSharedReviewQueue(
  workspaceId: string,
  userId: string,
  client: SupabaseClient<Database>,
): Promise<QueueData> {
  if (typeof window === "undefined") return fetchReviewQueueData(workspaceId, userId, client);
  let pending = pendingByClient.get(client);
  if (!pending) {
    pending = new Map();
    pendingByClient.set(client, pending);
  }
  const key = JSON.stringify([workspaceId, userId]);
  const existing = pending.get(key);
  if (existing) return existing;

  const read = async (): Promise<QueueData> => {
    for (;;) {
      const generation = reviewQueueMutationGeneration();
      try {
        const queue = await fetchReviewQueueData(workspaceId, userId, client);
        if (generation === reviewQueueMutationGeneration()) return queue;
      } catch (error) {
        if (generation === reviewQueueMutationGeneration()) throw error;
      }
      // A mutation during a read needs one more pass. Every waiting consumer
      // receives the post-mutation result instead of the obsolete first read.
    }
  };
  const promise = read().finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}
