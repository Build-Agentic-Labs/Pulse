// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Department } from "@/domain/departments";
import type { SopApproval } from "@/domain/sop/schema";
import { ConvertedApprovalsNotice } from "./converted-approvals-notice";

function dept(id: string, code: string, name: string, isQualityGate = false): Department {
  return { id, workspaceId: "ws", code, name, isQualityGate };
}

const DEPARTMENTS = [
  dept("d-mfg", "MFG", "Manufacturing/Production"),
  dept("d-qas", "QAS", "Quality", true),
];

function row(over: Partial<SopApproval> = {}): SopApproval {
  return { role: "Reviewed By", name: "J. Smith", position: "", date: "", ...over };
}

describe("ConvertedApprovalsNotice", () => {
  it("says nothing when the original document had no approval table", () => {
    const { container } = render(
      <ConvertedApprovalsNotice approvals={[]} departments={DEPARTMENTS} seatedDepartmentIds={new Set()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms a row whose seat exists", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ departmentCode: "MFG" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set(["d-mfg"])}
      />,
    );
    expect(screen.getByText(/Manufacturing\/Production — seat added/)).toBeTruthy();
    expect(screen.getByText(/every row was placed/)).toBeTruthy();
  });

  // The legacy name is transcribed text with no account behind it; showing it next to real
  // approver pickers invites the reader to treat it as someone in the system.
  it("never shows the person named in the original document", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ name: "M. Alvarez", position: "Production Manager", departmentCode: "MFG" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set(["d-mfg"])}
      />,
    );
    expect(container.textContent).not.toContain("Alvarez");
    // The position stays: it is the evidence for why this row mapped where it did.
    expect(container.textContent).toContain("Production Manager");
    expect(screen.getByText(/Reviewed By/)).toBeTruthy();
  });

  // The row must not read as silently dropped: it was skipped for a reason the author can't see
  // anywhere else, and mapping it to a seat would make the SOP unreleasable.
  it("explains that the Quality row is the release gate, not a seat", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Quality Approval", departmentCode: "QAS" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(screen.getByText(/Quality signs the final release/)).toBeTruthy();
  });

  it("flags a row it could not place", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Approved By", departmentCode: "Legal" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(screen.getByText(/No matching department/)).toBeTruthy();
    expect(screen.getByText(/some rows still need a department/)).toBeTruthy();
  });

  // Removing the seat afterwards should reopen the question rather than stay ticked.
  it("reopens a mapped row whose seat was removed", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ departmentCode: "MFG" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(screen.getByText(/the seat was removed/)).toBeTruthy();
  });
});
