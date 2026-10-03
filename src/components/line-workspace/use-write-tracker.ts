"use client";

import { useMemo, useSyncExternalStore } from "react";
import { WorkspaceWriteTracker } from "@/domain/workspace-save-status";

/** Per-project instances prevent old async completions from affecting another workspace. */
export function useWriteTracker(projectId: string | undefined) {
  const tracker = useMemo(() => new WorkspaceWriteTracker(projectId), [projectId]);
  const snapshot = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
  return { tracker, snapshot };
}
