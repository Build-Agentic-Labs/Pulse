/**
 * The approver dropdown's rows, derived from a department's members. Pure so the roster editor's
 * seven option cases (placeholder, ineligible current signer, absent signer, pending/expired
 * invitees, eligible members, empty department) are testable without the DOM.
 */

import { canSignReview, type DeptRole } from "@/domain/departments";
import { pendingInviteLabel, pendingInviteState } from "@/domain/workspace/reviewer-nomination";

export interface RosterOptionMember {
  userId: string;
  name: string;
  positionTitle: string;
  deptRole: DeptRole;
  pendingInviteAt?: string | null;
}

export interface RosterOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export const NO_ELIGIBLE_APPROVERS_VALUE = "__no-eligible-approvers__";

export function buildApproverOptions(input: {
  members: readonly RosterOptionMember[];
  signerId: string | null;
  placeholder: string;
  now: Date;
}): RosterOption[] {
  const eligible = input.members.filter((member) => canSignReview(member.deptRole));
  const absentSignerId =
    input.signerId && !input.members.some((member) => member.userId === input.signerId) ? input.signerId : null;

  return [
    { value: "", label: input.placeholder },
    ...(absentSignerId
      ? [{
          value: absentSignerId,
          label: "No longer an SOP member",
          description: "Choose another approver, or resend their invitation",
          disabled: true,
        }]
      : []),
    ...eligible.map((member) => {
      const state = pendingInviteState(member.pendingInviteAt, input.now);
      return {
        value: member.userId,
        label: member.name,
        description: state === "none" ? member.positionTitle || "Position not assigned" : pendingInviteLabel(state),
      };
    }),
    ...(eligible.length === 0
      ? [{ value: NO_ELIGIBLE_APPROVERS_VALUE, label: "No SOP members available", disabled: true }]
      : []),
  ];
}
