import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { createEmptySop } from "@/domain/sop/schema";
import { SopDocumentSection } from "./document-section";
import { SopQualitySection } from "./quality-section";
import { SopApprovalsSection } from "./approvals-section";

function documentProps(): ComponentProps<typeof SopDocumentSection> {
  return {
    sop: createEmptySop("local", "2026-10-08"),
    canEdit: true,
    authMode: null,
    persistedUpdatedAt: undefined,
    deptId: "",
    setDeptId: vi.fn(),
    selectedDept: null,
    displaySopNumber: "SOP-PRO-###",
    controlledVersion: "1.0",
    approvalReviewCycle: 0,
    builderHasFeedback: false,
    builderFeedback: () => null,
    reviewCategoriesNeedingAttention: new Set(),
    update: vi.fn(),
    navigation: <button>Next section</button>,
  };
}
function qualityProps(): ComponentProps<typeof SopQualitySection> {
  return {
    sop: { ...createEmptySop("local", "2026-10-08"), status: "effective" },
    qualitySignature: undefined,
    isCurrentUserAuthor: true,
    canEditPermission: true,
    controlledChangeKind: "MINOR",
    setControlledChangeKind: vi.fn(),
    handleStartControlledChange: vi.fn().mockResolvedValue(undefined),
    controlledChangeReason: "Clarify",
    setControlledChangeReason: vi.fn(),
    startingControlledChange: false,
    setPreviewing: vi.fn(),
    isCurrentUserQualityApprover: false,
    setQualityApprovalOpen: vi.fn(),
  };
}
describe("SOP section boundaries", () => {
  it("patches the title without dropping other document metadata", () => {
    const props = documentProps();
    render(<SopDocumentSection {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Updated" },
    });
    expect(props.update).toHaveBeenCalledExactlyOnceWith({
      meta: { ...props.sop.meta, title: "Updated" },
    });
    expect(screen.getByRole("button", { name: "Next section" })).toBeVisible();
  });
  it("keeps read-only document fields disabled and review attention visible", () => {
    render(
      <SopDocumentSection
        {...documentProps()}
        canEdit={false}
        reviewCategoriesNeedingAttention={new Set(["overall"])}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "Document" }).closest("section"),
    ).toHaveAttribute("data-review-attention", "true");
  });
  it("does not expose controlled changes to someone other than the author", () => {
    render(
      <SopQualitySection {...qualityProps()} isCurrentUserAuthor={false} />,
    );
    expect(
      screen.queryByRole("textbox", { name: "Reason for change" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start amendment" }),
    ).not.toBeInTheDocument();
  });
  it("delegates a controlled change without enabling duplicate submits while busy", () => {
    const props = qualityProps();
    const view = render(<SopQualitySection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Start amendment" }));
    expect(props.handleStartControlledChange).toHaveBeenCalledOnce();
    view.rerender(<SopQualitySection {...props} startingControlledChange />);
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  });
  it("exposes Quality release only to the Quality approver of an approved SOP", () => {
    const props = qualityProps();
    render(
      <SopQualitySection
        {...props}
        sop={{ ...props.sop, status: "approved" }}
        isCurrentUserQualityApprover
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review, sign & release" }),
    );
    expect(props.setQualityApprovalOpen).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("keeps unsaved approval routing informational", () => {
    render(
      <SopApprovalsSection
        sop={createEmptySop("local", "2026-10-08")}
        approvalRoutingError=""
        approvalRoutingLoading={false}
        hasPersistedSop={false}
        canEdit
        approvalAuthorId={null}
        approvalDepartments={[]}
        approvalSeats={[]}
        approvalMyDeptRoles={new Map()}
        selectedDepartmentId=""
        handleMapApproval={vi.fn()}
        refreshApprovalRouting={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Save the draft to configure department routing."),
    ).toBeVisible();
  });
});
