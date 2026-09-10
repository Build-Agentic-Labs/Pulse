import { describe, expect, it } from "vitest";
import {
  nominatedReviewerEntitlements,
  nominationOutcomeMessage,
  parseNominationBody,
  parseNominationOutcome,
  pendingInviteLabel,
  pendingInviteState,
} from "./reviewer-nomination";

const NOW = new Date("2026-09-10T12:00:00Z");

describe("parseNominationBody", () => {
  it("normalizes email and title and keeps the ids", () => {
    expect(
      parseNominationBody({ sopId: " sop-1 ", departmentId: "dept-1", email: " Jane.Doe@AnaCorp.com ", positionTitle: "  Line   Lead " }),
    ).toEqual({ sopId: "sop-1", departmentId: "dept-1", email: "jane.doe@anacorp.com", positionTitle: "Line Lead" });
  });

  it.each([
    ["missing email", { sopId: "s", departmentId: "d", positionTitle: "Lead" }],
    ["malformed email", { sopId: "s", departmentId: "d", email: "not-an-email", positionTitle: "Lead" }],
    ["empty title", { sopId: "s", departmentId: "d", email: "a@b.co", positionTitle: "   " }],
    ["title with a line break", { sopId: "s", departmentId: "d", email: "a@b.co", positionTitle: "Lead\nManager" }],
    ["missing department", { sopId: "s", email: "a@b.co", positionTitle: "Lead" }],
    ["not an object", "nope"],
  ])("rejects %s", (_label, raw) => {
    expect(parseNominationBody(raw)).toBeNull();
  });
});

describe("parseNominationOutcome", () => {
  it("accepts the four modes with a user id or null", () => {
    expect(parseNominationOutcome({ mode: "invite", user_id: null })).toEqual({ mode: "invite", userId: null });
    expect(parseNominationOutcome({ mode: "added", user_id: "u-1" })).toEqual({ mode: "added", userId: "u-1" });
  });
  it("rejects unknown modes and shapes", () => {
    expect(parseNominationOutcome({ mode: "promoted", user_id: "u-1" })).toBeNull();
    expect(parseNominationOutcome(null)).toBeNull();
  });
});

describe("nominatedReviewerEntitlements", () => {
  it("is the fixed reviewer package", () => {
    expect(nominatedReviewerEntitlements("dept-1", "Line Lead")).toEqual({
      organizationRole: "member",
      accessPackage: "custom",
      qualityAccess: "edit",
      planningAccess: false,
      projectAccess: [],
      departmentAccess: [{ departmentId: "dept-1", role: "reviewer", positionTitle: "Line Lead" }],
    });
  });
});

describe("pendingInviteState", () => {
  it("is none without a marker", () => {
    expect(pendingInviteState(null, NOW)).toBe("none");
    expect(pendingInviteState(undefined, NOW)).toBe("none");
  });
  it("is pending inside the 30-day window and expired after it", () => {
    expect(pendingInviteState("2026-08-12T12:00:00Z", NOW)).toBe("pending");
    expect(pendingInviteState("2026-08-10T12:00:00Z", NOW)).toBe("expired");
  });
  it("labels the two live states", () => {
    expect(pendingInviteLabel("pending")).toBe("Invited · not yet joined");
    expect(pendingInviteLabel("expired")).toBe("Invite expired · resend");
    expect(pendingInviteLabel("none")).toBe("");
  });
});

describe("nominationOutcomeMessage", () => {
  const base = { userId: "u-1", emailSent: false, seated: true } as const;
  it("describes each mode", () => {
    expect(nominationOutcomeMessage({ ...base, mode: "added" }, "a@anacorp.com")).toBe("a@anacorp.com can now be selected as the approver.");
    expect(nominationOutcomeMessage({ ...base, mode: "lifted" }, "a@anacorp.com")).toBe("a@anacorp.com now has Review access and can be selected as the approver.");
    expect(nominationOutcomeMessage({ ...base, mode: "already_eligible" }, "a@anacorp.com")).toBe("a@anacorp.com can already be selected as the approver.");
    expect(nominationOutcomeMessage({ ...base, mode: "invite", emailSent: true }, "a@anacorp.com")).toBe(
      "Invitation sent to a@anacorp.com. You can seat them now; the review will be waiting when they join.",
    );
  });
  it("says when the email did not go out or the seat could not be prepared", () => {
    expect(nominationOutcomeMessage({ mode: "invite", userId: "u-1", emailSent: false, seated: true, error: "boom" }, "a@anacorp.com")).toBe(
      "Added, but the invitation email didn't send — use Resend. (boom)",
    );
    expect(nominationOutcomeMessage({ mode: "invite", userId: null, emailSent: true, seated: false }, "a@anacorp.com")).toBe(
      "Invitation sent to a@anacorp.com, but they can't be seated yet — try Resend in a moment.",
    );
  });
});
