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

/** Every body row as [document role, document position, mapped to, status]. */
function bodyRows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("th,td")].map((cell) => (cell.textContent ?? "").trim()),
  );
}

describe("ConvertedApprovalsNotice", () => {
  it("says nothing when the original document had no approval table", () => {
    const { container } = render(
      <ConvertedApprovalsNotice approvals={[]} departments={DEPARTMENTS} seatedDepartmentIds={new Set()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("puts each fact in its own column", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ position: "Production Manager", departmentCode: "MFG" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set(["d-mfg"])}
      />,
    );
    expect(bodyRows(container)).toEqual([
      ["Reviewed By", "Production Manager", "Manufacturing/Production", "Seat added"],
    ]);
    expect(screen.getByText(/every row was placed/)).toBeTruthy();
  });

  it("falls back to a dash rather than an empty cell", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "", position: "", departmentCode: "Legal" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(bodyRows(container)).toEqual([["Approval row", "—", "—", "No match"]]);
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
  });

  // The row must not read as silently dropped: it was skipped for a reason the author can't see
  // anywhere else, and mapping it to a seat would make the SOP unreleasable.
  it("explains that the Quality row is the release gate, not a seat", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Quality Approval", departmentCode: "QAS" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(bodyRows(container)).toEqual([["Quality Approval", "—", "Quality", "Final release"]]);
    expect(screen.getByText(/Quality signs the final release/)).toBeTruthy();
  });

  it("flags a row it could not place", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Approved By", departmentCode: "Legal" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(bodyRows(container)[0]?.[3]).toBe("No match");
    expect(screen.getByText(/some rows still need a department/)).toBeTruthy();
    expect(screen.getByText(/Add the department above/)).toBeTruthy();
  });

  // Removing the seat afterwards should reopen the question rather than stay ticked.
  it("reopens a mapped row whose seat was removed", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ departmentCode: "MFG" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(bodyRows(container)[0]?.[3]).toBe("Seat removed");
    expect(screen.getByText(/Add it back above/)).toBeTruthy();
  });

  // The panel should get quieter as the roster gets right, not carry standing boilerplate.
  it("drops a footnote once no row needs it", () => {
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ departmentCode: "MFG" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set(["d-mfg"])}
      />,
    );
    expect(container.textContent).not.toContain("Add it back above");
    expect(container.textContent).not.toContain("Add the department above");
    expect(container.textContent).not.toContain("Quality signs the final release");
  });
});
