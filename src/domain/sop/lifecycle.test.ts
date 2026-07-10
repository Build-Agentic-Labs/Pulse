import { describe, it, expect } from "vitest";
import { canTransitionSop, type TransitionContext } from "./lifecycle";

/** A draft with a complete, valid roster and a signed authorship declaration. */
const base: TransitionContext = {
  from: "draft",
  to: "in_review",
  role: "approver",
  isSubmitter: false,
  isAuthor: false,
  isQualityApprover: false,
  hasDept: true,
  isManager: false,
  hasResponsibleSeat: true,
  accountableSeatCount: 1,
  holdsBlockingSeat: false,
  holdsAnySeat: false,
  seatsStaffedCorrectly: true,
  authorshipSigned: true,
  quorumMet: false,
  hasOpenObjection: false,
  hasRevisionReason: false,
};

describe("canTransitionSop", () => {
  describe("Gate A — submit for review", () => {
    it("allows a department member to submit for review", () => {
      expect(canTransitionSop({ ...base, role: "author" }).ok).toBe(true);
    });

    it("blocks submitting without a department", () => {
      expect(canTransitionSop({ ...base, hasDept: false }).ok).toBe(false);
    });

    it("blocks submitting when the user is not a department member (and not a manager)", () => {
      expect(canTransitionSop({ ...base, role: undefined }).ok).toBe(false);
    });

    it("blocks submitting without a Responsible seat", () => {
      expect(canTransitionSop({ ...base, hasResponsibleSeat: false }).ok).toBe(false);
    });

    it("blocks submitting without exactly one Accountable seat", () => {
      expect(canTransitionSop({ ...base, accountableSeatCount: 0 }).ok).toBe(false);
      expect(canTransitionSop({ ...base, accountableSeatCount: 2 }).ok).toBe(false);
    });

    it("blocks submitting when a seat's reviewer does not belong to that department", () => {
      expect(canTransitionSop({ ...base, seatsStaffedCorrectly: false }).ok).toBe(false);
    });

    it("blocks the submitter from also holding a blocking seat (three-humans invariant)", () => {
      expect(canTransitionSop({ ...base, holdsBlockingSeat: true }).ok).toBe(false);
    });

    it("blocks submitting without an authorship signature", () => {
      expect(canTransitionSop({ ...base, authorshipSigned: false }).ok).toBe(false);
    });

    it("blocks resubmitting while an objection is open", () => {
      expect(canTransitionSop({ ...base, hasOpenObjection: true }).ok).toBe(false);
    });
  });

  describe("Gate B — department approval is a quorum", () => {
    it("allows the edge once every blocking seat has signed", () => {
      expect(canTransitionSop({ ...base, from: "in_review", to: "approved", quorumMet: true }).ok).toBe(true);
    });

    it("blocks the edge while the quorum is incomplete", () => {
      expect(canTransitionSop({ ...base, from: "in_review", to: "approved", quorumMet: false }).ok).toBe(false);
    });

    it("rejects self-approval (submitter cannot approve)", () => {
      expect(
        canTransitionSop({ ...base, from: "in_review", to: "approved", quorumMet: true, isSubmitter: true }).ok,
      ).toBe(false);
    });

    it("blocks approval while an objection is open, even at full quorum", () => {
      expect(
        canTransitionSop({
          ...base,
          from: "in_review",
          to: "approved",
          quorumMet: true,
          hasOpenObjection: true,
        }).ok,
      ).toBe(false);
    });

    it("does not let a manager approve on an unmet quorum", () => {
      expect(
        canTransitionSop({ ...base, role: undefined, isManager: true, from: "in_review", to: "approved" }).ok,
      ).toBe(false);
    });
  });

  describe("Gate C — Quality signs alone", () => {
    it("requires a Quality approver to make effective", () => {
      expect(canTransitionSop({ ...base, from: "approved", to: "effective" }).ok).toBe(false);
      expect(
        canTransitionSop({ ...base, from: "approved", to: "effective", isQualityApprover: true }).ok,
      ).toBe(true);
    });

    it("blocks a Quality approver who holds a seat on this SOP", () => {
      expect(
        canTransitionSop({
          ...base,
          from: "approved",
          to: "effective",
          isQualityApprover: true,
          holdsAnySeat: true,
        }).ok,
      ).toBe(false);
    });

    it("blocks a Quality approver who overruled an objection this cycle", () => {
      expect(
        canTransitionSop({
          ...base,
          from: "approved",
          to: "effective",
          isQualityApprover: true,
          overruledThisCycle: true,
        }).ok,
      ).toBe(false);
    });

    it("blocks a Quality approver who authored or submitted the SOP", () => {
      expect(
        canTransitionSop({ ...base, from: "approved", to: "effective", isQualityApprover: true, isAuthor: true })
          .ok,
      ).toBe(false);
      expect(
        canTransitionSop({
          ...base,
          from: "approved",
          to: "effective",
          isQualityApprover: true,
          isSubmitter: true,
        }).ok,
      ).toBe(false);
    });
  });

  describe("reject and recall", () => {
    it("lets a blocking seat holder send the SOP back once their rejection is signed", () => {
      expect(
        canTransitionSop({
          ...base,
          role: undefined,
          from: "in_review",
          to: "draft",
          holdsBlockingSeat: true,
          hasOwnRejection: true,
        }).ok,
      ).toBe(true);
    });

    it("blocks a bare transition to draft by a seat holder who has not signed a rejection", () => {
      // sign_sop performs this edge itself; a client-driven UPDATE without the signature is refused.
      expect(
        canTransitionSop({ ...base, role: undefined, from: "in_review", to: "draft", holdsBlockingSeat: true }).ok,
      ).toBe(false);
    });

    it("lets the submitter recall their own submission", () => {
      expect(canTransitionSop({ ...base, role: undefined, from: "in_review", to: "draft", isSubmitter: true }).ok).toBe(
        true,
      );
    });

    it("blocks everyone else from sending an in_review SOP back", () => {
      expect(canTransitionSop({ ...base, role: "reviewer", from: "in_review", to: "draft" }).ok).toBe(false);
    });
  });

  describe("Gate D — start a revision", () => {
    it("allows starting a revision from effective with a reason", () => {
      expect(
        canTransitionSop({ ...base, role: "author", from: "effective", to: "draft", hasRevisionReason: true }).ok,
      ).toBe(true);
    });

    it("blocks starting a revision without a reason", () => {
      expect(canTransitionSop({ ...base, role: "author", from: "effective", to: "draft" }).ok).toBe(false);
    });

    it("lets a manager start a revision without a dept role", () => {
      expect(
        canTransitionSop({
          ...base,
          role: undefined,
          isManager: true,
          from: "effective",
          to: "draft",
          hasRevisionReason: true,
        }).ok,
      ).toBe(true);
    });
  });

  describe("retire", () => {
    it("lets a department approver retire an SOP", () => {
      expect(canTransitionSop({ ...base, from: "effective", to: "obsolete" }).ok).toBe(true);
    });

    it("blocks a mere reviewer from retiring", () => {
      expect(canTransitionSop({ ...base, role: "reviewer", from: "effective", to: "obsolete" }).ok).toBe(false);
    });
  });

  it("rejects illegal edges", () => {
    expect(canTransitionSop({ ...base, from: "draft", to: "approved" }).ok).toBe(false);
    expect(canTransitionSop({ ...base, from: "effective", to: "approved" }).ok).toBe(false);
    expect(canTransitionSop({ ...base, from: "draft", to: "effective" }).ok).toBe(false);
  });

  it("treats a no-op transition as allowed", () => {
    expect(canTransitionSop({ ...base, from: "draft", to: "draft" }).ok).toBe(true);
  });
});
