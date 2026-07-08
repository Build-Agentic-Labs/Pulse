import { describe, it, expect } from "vitest";
import { canTransitionSop, type TransitionContext } from "./lifecycle";

const base: TransitionContext = {
  from: "draft",
  to: "in_review",
  role: "approver",
  isSubmitter: false,
  isQualityApprover: false,
  hasDept: true,
  isManager: false,
};

describe("canTransitionSop", () => {
  it("allows a department member to submit for review", () => {
    expect(canTransitionSop({ ...base, role: "author", from: "draft", to: "in_review" }).ok).toBe(true);
  });

  it("blocks submitting without a department", () => {
    expect(canTransitionSop({ ...base, from: "draft", to: "in_review", hasDept: false }).ok).toBe(false);
  });

  it("blocks submitting when the user is not a department member (and not a manager)", () => {
    expect(canTransitionSop({ ...base, role: undefined, from: "draft", to: "in_review" }).ok).toBe(false);
  });

  it("lets a department approver approve", () => {
    expect(canTransitionSop({ ...base, from: "in_review", to: "approved" }).ok).toBe(true);
  });

  it("rejects self-approval (submitter cannot approve)", () => {
    expect(canTransitionSop({ ...base, from: "in_review", to: "approved", isSubmitter: true }).ok).toBe(false);
  });

  it("blocks a mere reviewer from approving", () => {
    expect(canTransitionSop({ ...base, role: "reviewer", from: "in_review", to: "approved" }).ok).toBe(false);
  });

  it("requires a Quality approver to make effective", () => {
    expect(canTransitionSop({ ...base, from: "approved", to: "effective" }).ok).toBe(false);
    expect(
      canTransitionSop({ ...base, from: "approved", to: "effective", isQualityApprover: true }).ok,
    ).toBe(true);
  });

  it("allows starting a revision from effective", () => {
    expect(canTransitionSop({ ...base, role: "author", from: "effective", to: "draft" }).ok).toBe(true);
  });

  it("allows reject/rework from in_review", () => {
    expect(canTransitionSop({ ...base, role: "reviewer", from: "in_review", to: "draft" }).ok).toBe(true);
  });

  it("rejects illegal edges", () => {
    expect(canTransitionSop({ ...base, from: "draft", to: "approved" }).ok).toBe(false);
    expect(canTransitionSop({ ...base, from: "effective", to: "approved" }).ok).toBe(false);
    expect(canTransitionSop({ ...base, from: "draft", to: "effective" }).ok).toBe(false);
  });

  it("treats a no-op transition as allowed", () => {
    expect(canTransitionSop({ ...base, from: "draft", to: "draft" }).ok).toBe(true);
  });

  it("lets a manager act on department-scoped steps without a dept role", () => {
    expect(
      canTransitionSop({ ...base, role: undefined, isManager: true, from: "in_review", to: "approved" }).ok,
    ).toBe(true);
  });
});
