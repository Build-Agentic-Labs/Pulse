import type { SopStatus } from "./schema";

export type SopProcessState =
  | "draft"
  | "changes_requested"
  | "draft_review"
  | "final_approval"
  | "awaiting_quality"
  | "effective"
  | "retired";

export interface SopProcessStateInput {
  status: SopStatus;
  rejectedReason: string | null;
  contentHash: string | null;
  finalApprovalRequestedAt: string | null;
  finalApprovalContentHash: string | null;
}

export const SOP_PROCESS_STATE_LABELS: Record<SopProcessState, string> = {
  draft: "Draft",
  changes_requested: "Changes requested",
  draft_review: "Draft review",
  final_approval: "Final approval",
  awaiting_quality: "Awaiting Quality",
  effective: "Effective",
  retired: "Retired",
};

export function getSopProcessState(sop: SopProcessStateInput): SopProcessState {
  if (sop.status === "effective") return "effective";
  if (sop.status === "obsolete") return "retired";
  if (sop.status === "approved") return "awaiting_quality";

  if (sop.status === "in_review") {
    const finalApprovalIsCurrent =
      Boolean(sop.finalApprovalRequestedAt) &&
      Boolean(sop.contentHash) &&
      sop.finalApprovalContentHash === sop.contentHash;

    return finalApprovalIsCurrent ? "final_approval" : "draft_review";
  }

  return sop.rejectedReason ? "changes_requested" : "draft";
}
