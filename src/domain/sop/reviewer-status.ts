import { getSopProcessState, type SopProcessStateInput } from "./process-state";

export type ReviewerStatus = "reviewing" | "changes_requested" | "review_complete" | "awaiting_signature" | "signed";

export const REVIEWER_STATUS_LABELS: Record<ReviewerStatus, string> = {
  reviewing: "Still reviewing",
  changes_requested: "Unresolved feedback",
  review_complete: "Review complete",
  awaiting_signature: "Awaiting signature",
  signed: "Signed",
};

export function reviewerStatus(input: {
  sop: SopProcessStateInput;
  returned: boolean;
  hasOpenComments: boolean;
  allSeatsSigned: boolean;
}): ReviewerStatus {
  if (input.allSeatsSigned) return "signed";
  if (getSopProcessState(input.sop) === "final_approval" || input.sop.status === "approved") return "awaiting_signature";
  if (!input.returned) return "reviewing";
  return input.hasOpenComments ? "changes_requested" : "review_complete";
}
