/**
 * The Review queue's actionable count, shared between whoever last fetched the
 * queue (the header bell every minute, the queue page on each refresh) and the
 * sidebar badge — so the badge costs no queries of its own.
 *
 * Module-level state, but browser-only by construction: publish is a no-op on
 * the server and the server snapshot is always null, so nothing can leak from
 * one user's render into another's.
 */

import { useSyncExternalStore } from "react";

interface Snapshot {
  workspaceId: string;
  count: number;
}

let latest: Snapshot | null = null;
const listeners = new Set<() => void>();

export function publishReviewQueueCount(workspaceId: string, count: number): void {
  if (typeof window === "undefined") return;
  if (latest && latest.workspaceId === workspaceId && latest.count === count) return;
  latest = { workspaceId, count };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last published count for this workspace, or null when none is known yet. */
export function useReviewQueueCount(workspaceId: string | null | undefined): number | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => latest,
    () => null,
  );
  if (!snapshot || !workspaceId || snapshot.workspaceId !== workspaceId) return null;
  return snapshot.count;
}
