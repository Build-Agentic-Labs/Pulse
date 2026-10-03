import type { SaveState } from "./supabase-planner";

export type WriteSnapshot = {
  pending: number;
  failures: readonly { key: string; message: string }[];
};

/** A failed member must not leave sibling uploads running after the batch settles. */
export async function settleWriteBatch<T>(writes: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(writes);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

/** Tracks independent writes; a different successful write cannot clear a failure. */
export class WorkspaceWriteTracker {
  constructor(readonly projectId?: string) {}

  private sequence = 0;
  private active = new Set<number>();
  private failures = new Map<string, { sequence: number; message: string }>();
  private confirmed = new Map<string, number>();
  private listeners = new Set<() => void>();
  private snapshot: WriteSnapshot = { pending: 0, failures: [] };

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  begin(key: string) {
    const sequence = ++this.sequence;
    this.active.add(sequence);
    this.publish();
    return (error?: unknown) => {
      // Completion can be called in both catch and finally; settle only once.
      if (!this.active.delete(sequence)) return;
      if (error !== undefined) {
        if ((this.confirmed.get(key) ?? 0) < sequence && (this.failures.get(key)?.sequence ?? 0) < sequence) {
          this.failures.set(key, { sequence, message: error instanceof Error ? error.message : "Unable to save this change." });
        }
      } else {
        this.confirmed.set(key, Math.max(sequence, this.confirmed.get(key) ?? 0));
        if ((this.failures.get(key)?.sequence ?? 0) <= sequence) this.failures.delete(key);
      }
      this.publish();
    };
  }

  private publish() {
    this.snapshot = {
      pending: this.active.size,
      failures: [...this.failures].map(([key, failure]) => ({ key, message: failure.message })),
    };
    this.listeners.forEach((listener) => listener());
  }
}

type ProcedureSaveActivity = {
  state: string;
  pending: boolean;
  inFlight: boolean;
  lastError?: unknown;
};

/** A retry may resolve its own failure, but must still wait for or block on other work. */
export function workspaceSaveBarrier(
  reportedState: SaveState,
  reportedError: string | undefined,
  writes: WriteSnapshot,
  procedures: readonly ProcedureSaveActivity[],
  pendingWork: boolean,
  retryingKey?: string,
): "ready" | "waiting" | "blocked" {
  const ownFailure = writes.failures.find((failure) => failure.key === retryingKey);
  if (writes.failures.some((failure) => failure.key !== retryingKey) ||
      procedures.some((queue) => queue.lastError !== undefined)) return "blocked";
  // Only bypass the reported error belonging to this operation. A separate
  // load/save error or conflict still requires resolution before starting.
  if ((reportedState === "error" || reportedState === "conflict") &&
      (!ownFailure || reportedError !== ownFailure.message)) return "blocked";
  if (writes.pending || pendingWork || procedures.some((queue) => queue.pending || queue.inFlight)) return "waiting";
  return "ready";
}

/** Derive one status from all writes and queues, including debounced/retrying work. */
export function workspaceSaveStatus(
  reportedState: SaveState,
  reportedError: string | undefined,
  writes: WriteSnapshot,
  procedures: readonly ProcedureSaveActivity[],
  queuedWork: boolean,
): { state: SaveState; error?: string } {
  if (reportedState === "loading") return { state: "loading", error: reportedError };
  if (writes.failures.length) return { state: "error", error: writes.failures[0].message };
  const failed = procedures.find((queue) => queue.lastError !== undefined);
  if (failed) {
    const message = failed.lastError instanceof Error ? failed.lastError.message : "Unable to save procedure changes.";
    return { state: message.toLowerCase().includes("conflict") ? "error" : "retrying", error: message };
  }
  if (reportedState === "error" || reportedState === "conflict") return { state: reportedState, error: reportedError };
  if (writes.pending || procedures.some((queue) => queue.inFlight)) return { state: "saving" };
  if (queuedWork || procedures.some((queue) => queue.pending)) return { state: "draft" };
  return { state: reportedState, error: reportedError };
}
