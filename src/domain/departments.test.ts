import { describe, it, expect } from "vitest";
import { roleAtLeast, canAuthor, canSignReview, canDeptApprove } from "./departments";

describe("dept role capabilities (cumulative)", () => {
  it("author can author but not sign", () => {
    expect(canAuthor("author")).toBe(true);
    expect(canSignReview("author")).toBe(false);
    expect(canDeptApprove("author")).toBe(false);
  });

  it("reviewer can author + review, not approve", () => {
    expect(canAuthor("reviewer")).toBe(true);
    expect(canSignReview("reviewer")).toBe(true);
    expect(canDeptApprove("reviewer")).toBe(false);
  });

  it("approver can do all", () => {
    expect(canAuthor("approver")).toBe(true);
    expect(canSignReview("approver")).toBe(true);
    expect(canDeptApprove("approver")).toBe(true);
  });

  it("roleAtLeast orders author < reviewer < approver", () => {
    expect(roleAtLeast("approver", "reviewer")).toBe(true);
    expect(roleAtLeast("reviewer", "reviewer")).toBe(true);
    expect(roleAtLeast("author", "reviewer")).toBe(false);
  });
});
