import { describe, it, expect } from "vitest";
import { roleAtLeast, canAuthor, canSignReview, canDeptApprove, pickMemberDepartments, type Department } from "./departments";

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

function dept(id: string, code: string): Department {
  return { id, workspaceId: "ws", code, name: `${code} dept`, isQualityGate: false };
}

describe("pickMemberDepartments", () => {
  it("keeps only member departments, preserving input order", () => {
    const all = [dept("a", "QA"), dept("b", "OPS"), dept("c", "ENG")];
    const result = pickMemberDepartments(all, new Set(["c", "a"]));
    expect(result.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("returns empty when the user is a member of none", () => {
    expect(pickMemberDepartments([dept("a", "QA")], new Set())).toEqual([]);
  });
});
