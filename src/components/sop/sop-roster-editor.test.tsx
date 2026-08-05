// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Department } from "@/domain/departments";
import { listProfileNames, removeSeat, upsertSeat, type SopReviewSeat } from "@/lib/sop/review";
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
    sopTarget: 0,
  },
  {
    id: "dept-quality",
    workspaceId: "workspace",
    code: "QAS",
    name: "Quality",
    isQualityGate: true,
    sopTarget: 0,
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

describe("SopRosterEditor — seating a converted approval", () => {
  beforeEach(() => {
    vi.mocked(upsertSeat).mockReset();
    vi.mocked(removeSeat).mockReset();
  });

  it("writes the approval row before creating the seat", async () => {
    const order: string[] = [];
    vi.mocked(upsertSeat).mockImplementation(async () => {
      order.push("seat");
    });

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={[
          { id: "d-eng", workspaceId: "ws", code: "ENG", name: "Engineering", isQualityGate: false, sopTarget: 0 },
        ]}
        seats={[]}
        convertedApprovals={[{ role: "Approved By", name: "R. Miller", position: "IC Manager", date: "" }]}
        onMapApproval={async () => {
          order.push("document");
        }}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Department for the Approved By approval (row 1)" }));
    fireEvent.click(screen.getByRole("option", { name: /ENG/ }));

    await waitFor(() => expect(order).toEqual(["document", "seat"]));
  });

  // FIX 2: re-upserting an already-seated department with signerId: null would wipe any
  // reviewer already assigned to that seat. The document write must still happen — it is what
  // makes the row resolve — but the seat write must be skipped entirely.
  it("does not call upsertSeat when the chosen department is already seated, but still writes the document", async () => {
    vi.mocked(upsertSeat).mockResolvedValue(undefined);
    const documentWrites: Array<[number, string]> = [];

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={[
          { id: "dept-mfg", workspaceId: "workspace", code: "MFG", name: "Manufacturing/Production", isQualityGate: false, sopTarget: 0 },
        ]}
        seats={[manufacturingSeat]}
        convertedApprovals={[{ role: "Approved By", name: "R. Miller", position: "IC Manager", date: "" }]}
        onMapApproval={async (index, code) => {
          documentWrites.push([index, code]);
        }}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Department for the Approved By approval (row 1)" }));
    fireEvent.click(screen.getByRole("option", { name: /MFG/ }));

    await waitFor(() => expect(documentWrites).toEqual([[0, "MFG"]]));
    expect(upsertSeat).not.toHaveBeenCalled();
  });

  // FIX 3: the roster's shared busy lock (`busy !== null`) must reach the notice's pickers too,
  // not just each row's own pending key — otherwise a second row's trigger stays clickable while
  // an unrelated roster write is in flight.
  it("disables the converted-approval picker while another roster action is busy", async () => {
    let resolveRemove: () => void = () => {};
    vi.mocked(removeSeat).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={[
          { id: "dept-mfg", workspaceId: "workspace", code: "MFG", name: "Manufacturing/Production", isQualityGate: false, sopTarget: 0 },
        ]}
        seats={[manufacturingSeat]}
        convertedApprovals={[{ role: "Approved By", name: "R. Miller", position: "IC Manager", date: "" }]}
        onMapApproval={async () => {}}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove MFG from the roster" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Department for the Approved By approval (row 1)" }),
      ).toBeDisabled(),
    );

    resolveRemove();
    await waitFor(() => expect(removeSeat).toHaveBeenCalled());
  });
});
