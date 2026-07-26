import { describe, it, expect } from "vitest";
import {
  GENERAL_RASIC_ROLES,
  canAuthor,
  canDeptApprove,
  canSignReview,
  normalizeRasicRoleName,
  pickMemberDepartments,
  rasicRoleOptions,
  roleAtLeast,
  standardPositionTitlesForDepartment,
  type Department,
} from "./departments";

describe("standardPositionTitlesForDepartment", () => {
  it("has a curated list for every roster code", () => {
    const roster = ["INS", "INV", "LOG", "MFG", "PLN", "PRO", "PUR", "QAS", "SVC"];
    for (const code of roster) {
      const titles = standardPositionTitlesForDepartment(code);
      expect(titles.length, code).toBeGreaterThan(0);
      expect(titles, code).not.toContain("Executive Vice President");
    }
  });

  it("keys the curated lists by the current codes, not the pre-2026-07 ones", () => {
    expect(standardPositionTitlesForDepartment("QAS")).toContain("VP Quality");
    expect(standardPositionTitlesForDepartment("MFG")).toContain("VP Manufacturing");
    expect(standardPositionTitlesForDepartment("INS")).toContain("Inside Sales Manager");
  });

  it("falls back to the generic ladder for unknown codes", () => {
    expect(standardPositionTitlesForDepartment("ZZZ")).toContain("Executive Vice President");
  });
});

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

describe("normalizeRasicRoleName", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeRasicRoleName("  Team   Leader ")).toBe("Team Leader");
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(normalizeRasicRoleName("")).toBeNull();
    expect(normalizeRasicRoleName("   \n ")).toBeNull();
  });

  it("leaves an already-clean name alone", () => {
    expect(normalizeRasicRoleName("Quality Inspector")).toBe("Quality Inspector");
  });
});

describe("rasicRoleOptions", () => {
  const eng = dept("d-eng", "PRO");
  const qa = dept("d-qa", "QAS");

  it("puts the owning department first, then the others, then General, then added", () => {
    const options = rasicRoleOptions("d-qa", [eng, qa], ["Line Auditor"]);
    const groups: string[] = [];
    for (const option of options) {
      if (option.group && option.group !== groups[groups.length - 1]) groups.push(option.group);
    }
    expect(groups[0]).toBe(qa.name);
    expect(groups[groups.length - 2]).toBe("General");
    expect(groups[groups.length - 1]).toBe("Added by your team");
  });

  // ThemedSelect renders a group heading whenever an option's group differs from the PREVIOUS
  // option's, so a group split across non-adjacent runs would print its heading twice.
  it("emits each group contiguously", () => {
    const options = rasicRoleOptions("d-qa", [eng, qa], ["Line Auditor"]);
    const seen = new Set<string>();
    let previous = "";
    for (const option of options) {
      const group = option.group ?? "";
      if (group !== previous) {
        expect(seen.has(group)).toBe(false);
        seen.add(group);
        previous = group;
      }
    }
  });

  it("includes every General role", () => {
    const values = rasicRoleOptions("d-qa", [qa], []).map((option) => option.value);
    for (const role of GENERAL_RASIC_ROLES) expect(values).toContain(role);
  });

  // First source in display order wins, so a typed duplicate never shadows a curated name.
  it("drops a workspace-added role that duplicates an earlier source, case-insensitively", () => {
    const options = rasicRoleOptions("d-qa", [qa], ["  operator  ", "Line Auditor"]);
    const operators = options.filter((option) => option.value.toLowerCase() === "operator");
    expect(operators).toHaveLength(1);
    expect(operators[0].group).toBe("General");
    expect(options.some((option) => option.value === "Line Auditor")).toBe(true);
  });

  it("keeps the two-department title disambiguation", () => {
    // Both PRO and QAS offer a "VP …" title; identical titles across departments must stay
    // distinguishable rather than collapsing into one another.
    const options = rasicRoleOptions("d-eng", [eng, qa], []);
    const values = options.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
