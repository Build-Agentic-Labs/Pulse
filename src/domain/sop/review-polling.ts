import type { SopStatus } from "./schema";

export interface ReviewPollingInput {
  hasPersistedSop: boolean;
  status: SopStatus;
  hasReviewHistory: boolean;
}

/**
 * Review remarks only change while an SOP is in review or carries review history.
 * Unsaved SOPs (client-generated id), effective SOPs and drafts never sent for review
 * have nothing to poll for.
 */
export function shouldPollReviewAnnotations({
  hasPersistedSop,
  status,
  hasReviewHistory,
}: ReviewPollingInput): boolean {
  return hasPersistedSop && (status === "in_review" || hasReviewHistory);
}
