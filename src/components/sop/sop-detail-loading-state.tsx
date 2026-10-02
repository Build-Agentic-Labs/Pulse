"use client";

import type { SopEditorInitialView } from "./sop-editor";
import { SopDetailLoadingSurface } from "./sop-detail-loading-surface";
import { canManage, useSopWorkspace } from "./sop-workspace-provider";
import { useReviewQueueCount } from "@/lib/sop/review-queue-count";

export function SopDetailLoadingState({ initialView, fromReviewQueue = false }: { initialView?: SopEditorInitialView; fromReviewQueue?: boolean }) {
  const { role, workspaceId } = useSopWorkspace();
  const reviewCount = useReviewQueueCount(workspaceId);
  return <SopDetailLoadingSurface initialView={initialView} fromReviewQueue={fromReviewQueue} manage={canManage(role)} reviewCount={reviewCount} />;
}
