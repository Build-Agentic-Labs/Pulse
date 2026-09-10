import { describe, expect, it } from "vitest";
import { NO_ELIGIBLE_APPROVERS_VALUE, buildApproverOptions, type RosterOptionMember } from "./roster-options";

const NOW = new Date("2026-09-10T12:00:00Z");
const member = (over: Partial<RosterOptionMember>): RosterOptionMember => ({
  userId: "u",
  name: "Name",
  positionTitle: "Title",
  deptRole: "reviewer",
  pendingInviteAt: null,
  ...over,
});

describe("buildApproverOptions", () => {
  it("lists only reviewers and approvers, with position as the description", () => {
    const options = buildApproverOptions({
      members: [member({ userId: "a", name: "Author", deptRole: "author" }), member({ userId: "r", name: "Rev" }), member({ userId: "p", name: "App", deptRole: "approver" })],
      signerId: null,
      placeholder: "Choose an approver…",
      now: NOW,
    });
    expect(options.map((option) => option.value)).toEqual(["", "r", "p"]);
    expect(options[1]).toEqual({ value: "r", label: "Rev", description: "Title" });
  });

  it("tags a pending member and keeps them selectable; tags an expired one the same way", () => {
    const options = buildApproverOptions({
      members: [member({ userId: "p1", pendingInviteAt: "2026-09-01T00:00:00Z" }), member({ userId: "p2", pendingInviteAt: "2026-07-01T00:00:00Z" })],
      signerId: null,
      placeholder: "Choose an approver…",
      now: NOW,
    });
    expect(options[1]).toEqual({ value: "p1", label: "Name", description: "Invited · not yet joined" });
    expect(options[2]).toEqual({ value: "p2", label: "Name", description: "Invite expired · resend" });
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it("shows a signer who is no longer in the department as a disabled placeholder", () => {
    const options = buildApproverOptions({ members: [member({ userId: "r" })], signerId: "gone", placeholder: "Choose an approver…", now: NOW });
    expect(options[1]).toEqual({
      value: "gone",
      label: "No longer in department",
      description: "Choose another approver, or resend their invitation",
      disabled: true,
    });
  });

  it("keeps the existing ineligible-signer and empty-department rows", () => {
    const ineligible = buildApproverOptions({ members: [member({ userId: "a", deptRole: "author" })], signerId: "a", placeholder: "x", now: NOW });
    expect(ineligible[1]).toMatchObject({ value: "a", disabled: true, description: "Create access only — choose someone with Review or Approve access" });
    const empty = buildApproverOptions({ members: [], signerId: null, placeholder: "x", now: NOW });
    expect(empty[1]).toEqual({ value: NO_ELIGIBLE_APPROVERS_VALUE, label: "No reviewers or approvers assigned", disabled: true });
  });
});
