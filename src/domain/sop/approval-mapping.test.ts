import { describe, expect, it } from "vitest";
import type { Department } from "@/domain/departments";
import { mapApprovalsToDepartments, signerAfterDepartmentChange } from "./approval-mapping";
import type { SopApproval } from "./schema";

function dept(id: string, code: string, name: string, isQualityGate = false): Department {
  return { id, workspaceId: "ws", code, name, isQualityGate };
}

const DEPARTMENTS = [
  dept("d-mfg", "MFG", "Manufacturing/Production"),
  dept("d-pro", "PRO", "Process Engineering"),
  dept("d-qas", "QAS", "Quality", true),
];

function row(over: Partial<SopApproval> = {}): SopApproval {
  return { role: "Reviewed By", name: "J. Smith", position: "", date: "", ...over };
}

describe("mapApprovalsToDepartments", () => {
  it("matches a department by code", () => {
    const [result] = mapApprovalsToDepartments([row({ departmentCode: "MFG" })], DEPARTMENTS);
    expect(result.outcome).toBe("mapped");
    expect(result.department?.id).toBe("d-mfg");
  });

  it("matches by department name, case-insensitively", () => {
    const [result] = mapApprovalsToDepartments(
      [row({ departmentCode: "process engineering" })],
      DEPARTMENTS,
    );
    expect(result.department?.id).toBe("d-pro");
  });

  // The converter's hint is a suggestion, never an instruction: a department that does not exist
  // in this workspace must not create a seat.
  it("discards a hint that matches no real department", () => {
    const [result] = mapApprovalsToDepartments([row({ departmentCode: "Legal" })], DEPARTMENTS);
    expect(result.outcome).toBe("unmapped");
    expect(result.department).toBeUndefined();
  });

  it("falls back to the position title when there is no usable hint", () => {
    const [result] = mapApprovalsToDepartments(
      [row({ position: "Production Manager" })],
      DEPARTMENTS,
    );
    expect(result.department?.id).toBe("d-mfg");
  });

  // Quality signs the release gate, and the transition guard forbids it holding a seat. A legacy
  // "Quality Approval" row that became a seat would convert cleanly and never be releasable.
  it("skips the quality gate instead of mapping it to a seat", () => {
    const [result] = mapApprovalsToDepartments(
      [row({ role: "Quality Approval", departmentCode: "QAS" })],
      DEPARTMENTS,
    );
    expect(result.outcome).toBe("quality-gate");
    expect(result.department?.id).toBe("d-qas");
  });

  // Detected by the isQualityGate flag, not by the word "Quality": a workspace may rename the
  // department, but the flag is what the database enforces against.
  it("recognises the quality gate under a different name", () => {
    const renamed = [dept("d-qa2", "QCT", "Conformity Control", true), dept("d-mfg", "MFG", "Manufacturing/Production")];
    const [result] = mapApprovalsToDepartments([row({ departmentCode: "QCT" })], renamed);
    expect(result.outcome).toBe("quality-gate");
  });

  it("reports a row it cannot place at all", () => {
    const [result] = mapApprovalsToDepartments(
      [row({ position: "Regional Ombudsman" })],
      DEPARTMENTS,
    );
    expect(result.outcome).toBe("unmapped");
  });

  it("keeps one result per input row, in order", () => {
    const results = mapApprovalsToDepartments(
      [row({ departmentCode: "MFG" }), row({ departmentCode: "QAS" }), row({ position: "???" })],
      DEPARTMENTS,
    );
    expect(results.map((entry) => entry.outcome)).toEqual(["mapped", "quality-gate", "unmapped"]);
  });

  // Two rows naming the same department must not produce two seats for it.
  it("exposes the distinct departments that need seats", () => {
    const results = mapApprovalsToDepartments(
      [row({ departmentCode: "MFG" }), row({ departmentCode: "Manufacturing/Production" }), row({ departmentCode: "QAS" })],
      DEPARTMENTS,
    );
    const seatable = [...new Set(results.filter((r) => r.outcome === "mapped").map((r) => r.department!.id))];
    expect(seatable).toEqual(["d-mfg"]);
  });

  // The property the converted-approver picker rests on: the author's chosen
  // department is stored as departmentCode, and code resolution runs BEFORE the
  // position-title fallback. Without this, a mapped row would keep rendering
  // "No match" forever.
  it("resolves by departmentCode even when the position title matches nothing", () => {
    const unmatchable = { role: "Approved By", name: "R. Miller", position: "IC Manager", date: "" };

    const before = mapApprovalsToDepartments([unmatchable], DEPARTMENTS);
    expect(before[0].outcome).toBe("unmapped");

    const after = mapApprovalsToDepartments([{ ...unmatchable, departmentCode: "MFG" }], DEPARTMENTS);
    expect(after[0].outcome).toBe("mapped");
    expect(after[0].department?.code).toBe("MFG");
  });

  it("prefers departmentCode over a position title that would match a different department", () => {
    const conflicting = {
      role: "Approved By",
      name: "R. Miller",
      position: "Manufacturing/Production Manager",
      date: "",
      departmentCode: "QAS",
    };
    const [mapping] = mapApprovalsToDepartments([conflicting], DEPARTMENTS);
    // QAS is the quality gate in the fixture, so the outcome proves which input won.
    expect(mapping.outcome).toBe("quality-gate");
  });
});

describe("signerAfterDepartmentChange", () => {
  it("keeps a signer who also belongs to the destination", () => {
    expect(signerAfterDepartmentChange("u1", ["u1", "u2"])).toBe("u1");
  });

  // The whole point: an outside signer would pass the roster UI and fail Gate A at submission.
  it("drops a signer who does not belong to the destination", () => {
    expect(signerAfterDepartmentChange("u1", ["u2", "u3"])).toBeNull();
  });

  it("stays empty when the seat had no signer", () => {
    expect(signerAfterDepartmentChange(null, ["u1"])).toBeNull();
    expect(signerAfterDepartmentChange(undefined, ["u1"])).toBeNull();
  });

  it("drops the signer when the destination has no members at all", () => {
    expect(signerAfterDepartmentChange("u1", [])).toBeNull();
  });
});
