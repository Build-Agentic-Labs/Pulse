// @vitest-environment jsdom

import { fireEvent, within, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Department, DeptRole } from "@/domain/departments";
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
  moveSeat: vi.fn(),
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives the department from the selected person without a department picker", async () => {
    vi.mocked(upsertSeat).mockClear();
    vi.mocked(listMembersForDepartments).mockResolvedValue([{ departmentId: "dept-mfg", userId: "member", deptRole: "author", positionTitle: "Engineer" }]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["member", "Alex"]]));
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[]} onChanged={() => {}} />);
    await waitFor(() => expect(listProfileNames).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    expect(screen.queryByRole("button", { name: "Department to add" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Required departmental approver" }));
    fireEvent.click(await screen.findByRole("option", { name: /Alex/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add departmental approver" }));
    await waitFor(() => expect(upsertSeat).toHaveBeenCalledWith({ sopId: "sop-1", departmentId: "dept-mfg", rasic: "responsible", signerId: "member" }));
  });

  it("filters people by name and keeps adding an approver available for a missing name", async () => {
    vi.mocked(upsertSeat).mockClear();
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      { departmentId: "dept-mfg", userId: "alex", deptRole: "author", positionTitle: "Engineer" },
      { departmentId: "dept-mfg", userId: "sam", deptRole: "author", positionTitle: "Manager" },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["alex", "Alex Rivera"], ["sam", "Sam Lee"]]));
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[]} myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"]])} onChanged={() => {}} />);
    await waitFor(() => expect(listProfileNames).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Required departmental approver" }));
    const search = screen.getByRole("textbox", { name: "Required departmental approver — search" });
    fireEvent.change(search, { target: { value: "rivera" } });
    expect(screen.getByRole("option", { name: /Alex Rivera/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Sam Lee/ })).toBeNull();
    fireEvent.change(search, { target: { value: "No matching person" } });
    expect(screen.queryByRole("option", { name: /Alex Rivera/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Add an approver/ }));
    expect(screen.getByRole("form", { name: "Add an approver" })).toBeTruthy();
    expect(upsertSeat).not.toHaveBeenCalled();
  });

  it("excludes the author and deduplicates members linked to multiple departments", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      { departmentId: "dept-mfg", userId: "self", deptRole: "author", positionTitle: "Engineer" },
      { departmentId: "dept-mfg", userId: "member", deptRole: "author", positionTitle: "Engineer" },
      { departmentId: "dept-quality", userId: "member", deptRole: "author", positionTitle: "Engineer" },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["self", "SOP Author"], ["member", "Alex"]]));
    render(<SopRosterEditor sopId="sop-1" authorId="self" departments={departments} seats={[]} onChanged={() => {}} />);
    await waitFor(() => expect(listProfileNames).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Required departmental approver" }));
    expect(await screen.findAllByRole("option", { name: /Alex/ })).toHaveLength(1);
    expect(screen.queryByRole("option", { name: /SOP Author/ })).toBeNull();
  });

  it("offers a Quality member as a normal approver independently of final Quality approval", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([{ departmentId: "dept-quality", userId: "quality-reviewer", deptRole: "author", positionTitle: "Technician" }]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["quality-reviewer", "Quality Member"]]));
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[]} onChanged={() => {}} />);
    await waitFor(() => expect(listProfileNames).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Required departmental approver" }));
    expect(await screen.findByRole("option", { name: /Quality Member/ })).toHaveTextContent("Quality");
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
      expect(listMembersForDepartments).toHaveBeenCalledWith(expect.arrayContaining(["dept-quality"])),
    );
    expect(screen.queryByRole("button", { name: "Department for the Quality approval" })).toBeNull();
    expect(
      screen.getByText(
        "Normal review loop. A different Quality approver completes final approval.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Final approver")).toBeTruthy();
  });

  it("offers members with every legacy role for an approval seat", async () => {
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
        seats={[{ ...manufacturingSeat, signerId: null }]}
        onChanged={() => {}}
      />,
    );

    await waitFor(() =>
      expect(listMembersForDepartments).toHaveBeenCalledWith(expect.arrayContaining(["dept-mfg"])),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Required approver for MFG" }),
    );

    expect(screen.getByRole("option", { name: /Author Member/ })).not.toBeDisabled();
    expect(screen.getByRole("option", { name: /Reviewer Member/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Approver Member/ })).toBeTruthy();
  });

  it("preserves an existing author assignment as eligible", async () => {
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
        screen.getByLabelText("Saved approver for MFG"),
      ).toHaveTextContent(
        "Author Member",
      ),
    );
  });

  it("tags an invited-but-not-joined member and keeps them selectable", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      { departmentId: "dept-mfg", userId: "pending-member", deptRole: "reviewer", positionTitle: "Line Lead", pendingInviteAt: new Date().toISOString() },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["pending-member", "pending@anacorp.com"]]));

    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[{ ...manufacturingSeat, signerId: null }]} onChanged={() => {}} />);

    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalledWith(expect.arrayContaining(["dept-mfg"])));
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    const option = screen.getByRole("option", { name: /pending@anacorp.com/ });
    expect(option).toHaveTextContent("Invited · not yet joined");
    expect(option).not.toBeDisabled();
  });

  it("offers invitation inside the person dropdown, except for Quality", async () => {
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[{ ...manufacturingSeat, signerId: null }, { ...qualitySeat, signerId: null }]} myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"], ["dept-quality", "approver"]])} onChanged={() => {}} />);
    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Required approver for QAS" }));
    expect(screen.queryByRole("option", { name: /Add an approver/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    fireEvent.click(screen.getByRole("option", { name: /Add an approver/ }));
    expect(screen.getByRole("form", { name: "Add an approver" })).toBeTruthy();
  });

  it("hides invitation when the caller cannot nominate into that department", async () => {
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[{ ...manufacturingSeat, signerId: null }]} myDeptRoles={new Map()} onChanged={() => {}} />);
    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    expect(screen.queryByRole("option", { name: /Add an approver/ })).toBeNull();
  });

  it("opens invitation from the new-person dropdown without creating an empty seat", async () => {
    vi.mocked(upsertSeat).mockClear();
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[]} myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"]])} owningDepartmentId="dept-mfg" onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Required departmental approver" }));
    fireEvent.click(screen.getByRole("option", { name: /Add an approver/ }));
    fireEvent.click(screen.getByRole("button", { name: "New approver department" }));
    fireEvent.click(screen.getByRole("option", { name: "Manufacturing/Production" }));
    const form = await screen.findByRole("form", { name: "Add an approver" });
    expect(screen.queryByRole("button", { name: "Required departmental approver" })).toBeNull();
    expect(within(form).getByRole("button", { name: "New approver department" })).toBeTruthy();
    expect(upsertSeat).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Approver email" })).toBeEnabled();
  });

  it("shows saved approvers as text with removal available, without a replacement picker", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([{ departmentId: "dept-mfg", userId: "reviewer-member", deptRole: "author", positionTitle: "Engineer" }]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["reviewer-member", "Alex"]]));
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[manufacturingSeat]} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Saved approver for MFG")).toHaveTextContent("Alex"));
    expect(screen.queryByRole("button", { name: "Required approver for MFG" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove MFG from the roster" })).toBeInTheDocument();
  });

  it("shows a saved signer who left as text so they can be removed", async () => {
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[manufacturingSeat]} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Saved approver for MFG")).toHaveTextContent("No longer an SOP member"));
    expect(screen.queryByRole("button", { name: "Required approver for MFG" })).toBeNull();
  });

  it("seats the nominee after a successful invite and reloads the department's members", async () => {
    vi.mocked(upsertSeat).mockClear();
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ mode: "invite", userId: "u-new", emailSent: true, seated: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[{ ...manufacturingSeat, signerId: null }]}
        myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"]])}
        onChanged={() => {}}
      />,
    );

    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalledWith(expect.arrayContaining(["dept-mfg"])));
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    fireEvent.click(screen.getByRole("option", { name: /Add an approver/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Approver email" }), { target: { value: "new@anacorp.com" } });
    fireEvent.click(within(screen.getByRole("form", { name: "Add an approver" })).getByRole("button", { name: "Add approver" }));

    await waitFor(() =>
      expect(upsertSeat).toHaveBeenCalledWith({ ...manufacturingSeat, rasic: "responsible", signerId: "u-new" }),
    );
    // Once on mount, once more after the nomination seats the nominee.
    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalledTimes(2));
  });

  it("finishes a new invitation by showing the saved approver and closing the add row", async () => {
    let savedSeat: SopReviewSeat | undefined;
    vi.mocked(upsertSeat).mockImplementation(async (seat) => { savedSeat = seat; });
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      { departmentId: "dept-mfg", userId: "u-new", deptRole: "author", positionTitle: "Line Lead", pendingInviteAt: new Date().toISOString() },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["u-new", "new@anacorp.com"]]));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ mode: "invite", userId: "u-new", emailSent: true, seated: true }), { status: 200 })));
    function Harness() {
      const [seats, setSeats] = useState<SopReviewSeat[]>([]);
      return <SopRosterEditor sopId="sop-1" departments={departments} seats={seats}
        myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"]])}
        onChanged={() => { if (savedSeat) setSeats([savedSeat]); }} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Required departmental approver" }));
    fireEvent.click(screen.getByRole("option", { name: /Add an approver/ }));
    fireEvent.click(screen.getByRole("button", { name: "New approver department" }));
    fireEvent.click(screen.getByRole("option", { name: "Manufacturing/Production" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Approver email" }), { target: { value: "new@anacorp.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add an approver" })).toBeNull());
    expect(screen.getByLabelText("Saved approver for MFG")).toHaveTextContent("new@anacorp.com");
    expect(screen.getByRole("button", { name: "Add approver" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add departmental approver" })).toBeNull();
    expect(savedSeat?.signerId).toBe("u-new");
  });

  it("does not seat the nominee when the invite response reports them not yet seatable", async () => {
    vi.mocked(upsertSeat).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(
          new Response(JSON.stringify({ mode: "invite", userId: "u-new", emailSent: true, seated: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[{ ...manufacturingSeat, signerId: null }]}
        myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"]])}
        onChanged={() => {}}
      />,
    );

    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalledWith(expect.arrayContaining(["dept-mfg"])));
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    fireEvent.click(screen.getByRole("option", { name: /Add an approver/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Approver email" }), { target: { value: "new@anacorp.com" } });
    fireEvent.click(within(screen.getByRole("form", { name: "Add an approver" })).getByRole("button", { name: "Add approver" }));

    await waitFor(() => expect(screen.getByText(/Invitation sent to new@anacorp.com/)).toBeTruthy());
    expect(upsertSeat).not.toHaveBeenCalled();
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
        seats={[{ ...manufacturingSeat, signerId: null }]}
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
        seats={[{ ...manufacturingSeat, signerId: null }]}
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
