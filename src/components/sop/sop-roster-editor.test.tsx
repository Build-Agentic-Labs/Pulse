// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Department } from "@/domain/departments";
import { listProfileNames, type SopReviewSeat } from "@/lib/sop/review";
import { listMembersForDepartments } from "@/lib/departments/store";
import { SopRosterEditor } from "./sop-roster-editor";

vi.mock("@/lib/departments/store", () => ({
  listMembersForDepartments: vi.fn(),
}));

vi.mock("@/lib/sop/review", () => ({
  isBlockingSeat: (rasic: string) => rasic === "responsible" || rasic === "accountable",
  listProfileNames: vi.fn(async () => new Map()),
  removeSeat: vi.fn(),
  upsertSeat: vi.fn(),
}));

const departments: Department[] = [
  {
    id: "dept-mfg",
    workspaceId: "workspace",
    code: "MFG",
    name: "Manufacturing/Production",
    isQualityGate: false,
  },
  {
    id: "dept-quality",
    workspaceId: "workspace",
    code: "QAS",
    name: "Quality",
    isQualityGate: true,
  },
];

const qualitySeat: SopReviewSeat = {
  sopId: "sop-1",
  departmentId: "dept-quality",
  rasic: "responsible",
  signerId: "quality-reviewer",
};

const manufacturingSeat: SopReviewSeat = {
  sopId: "sop-1",
  departmentId: "dept-mfg",
  rasic: "responsible",
  signerId: "reviewer-member",
};

describe("SopRosterEditor", () => {
  beforeEach(() => {
    vi.mocked(listMembersForDepartments).mockReset();
    vi.mocked(listMembersForDepartments).mockResolvedValue([]);
    vi.mocked(listProfileNames).mockReset();
    vi.mocked(listProfileNames).mockResolvedValue(new Map());
  });

  it("offers Quality as an additional normal-loop reviewer", () => {
    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[]}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Department to add" }));

    expect(
      screen.getByRole("option", { name: "QAS · Quality · Additional reviewer" }),
    ).toBeTruthy();
    expect(screen.getByText("Final approver")).toBeTruthy();
  });

  it("shows a Quality review seat separately from the locked final approver", async () => {
    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[qualitySeat]}
        onChanged={() => {}}
      />,
    );

    await waitFor(() =>
      expect(listMembersForDepartments).toHaveBeenCalledWith(["dept-quality"]),
    );
    expect(
      screen.getByRole("button", { name: "Department for the Quality approval" }),
    ).toHaveTextContent("Quality · Additional reviewer");
    expect(
      screen.getByText(
        "Normal review loop. A different Quality approver completes final approval.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Final approver")).toBeTruthy();
  });

  it("offers only Reviewer and Approver members for an approval seat", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      {
        departmentId: "dept-mfg",
        userId: "author-member",
        deptRole: "author",
        positionTitle: "Process Engineer",
      },
      {
        departmentId: "dept-mfg",
        userId: "reviewer-member",
        deptRole: "reviewer",
        positionTitle: "Manufacturing Manager",
      },
      {
        departmentId: "dept-mfg",
        userId: "approver-member",
        deptRole: "approver",
        positionTitle: "VP Manufacturing",
      },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(
      new Map([
        ["author-member", "Author Member"],
        ["reviewer-member", "Reviewer Member"],
        ["approver-member", "Approver Member"],
      ]),
    );

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[manufacturingSeat]}
        onChanged={() => {}}
      />,
    );

    await waitFor(() =>
      expect(listMembersForDepartments).toHaveBeenCalledWith(["dept-mfg"]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Required approver for MFG" }),
    );

    expect(screen.queryByRole("option", { name: /Author Member/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Reviewer Member/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Approver Member/ })).toBeTruthy();
  });

  it("marks an existing Author-only assignment as ineligible until it is replaced", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      {
        departmentId: "dept-mfg",
        userId: "author-member",
        deptRole: "author",
        positionTitle: "Process Engineer",
      },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(
      new Map([["author-member", "Author Member"]]),
    );

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[{ ...manufacturingSeat, signerId: "author-member" }]}
        onChanged={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Required approver for MFG" }),
      ).toHaveTextContent(
        "Author Member — Author access only — choose a reviewer or approver",
      ),
    );
  });
});
