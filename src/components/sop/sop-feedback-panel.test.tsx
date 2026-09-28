// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SopRemarkCard } from "./sop-feedback-panel";
import { saveSopAuthorResponse, type SopReviewAnnotation } from "@/lib/sop/review-annotations";
vi.mock("@/lib/sop/review-annotations", () => ({ saveSopAuthorResponse: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const remark: SopReviewAnnotation = {id:"r1", sopId:"s1", reviewCycle:1, category:"annexes", pageNumber:null,xPercent:null,yPercent:null,body:"[Attachment:file-1] Form.pdf\nAdd signature",createdBy:"reviewer",authorName:"Reviewer One",createdAt:"2026-09-26T12:00:00Z",resolvedAt:null,resolvedBy:null};
function setup(addressed = false) {
  const onUndo = vi.fn(); const onOpenAttachment = vi.fn();
  render(<SopRemarkCard label="Forms" remarks={addressed ? [] : [remark]} addressedRemarks={addressed ? [{...remark, resolvedAt:"2026-09-26T13:00:00Z"}] : []} editor={null} editing={false} editable lockedReason="" resolvingId={null} onToggleEdit={vi.fn()} onOpenInBuilder={vi.fn()} onResolve={vi.fn()} onUndo={onUndo} onOpenAttachment={onOpenAttachment} />);
  return {onUndo,onOpenAttachment};
}
describe("minimal author feedback actions", () => {
  it("opens the referenced attachment by identity", () => {
    const {onOpenAttachment} = setup();
    fireEvent.click(screen.getByRole("button",{name:"Form.pdf"}));
    expect(onOpenAttachment).toHaveBeenCalledWith("file-1");
    expect(screen.getByText("Add signature")).toBeInTheDocument();
  });
  it("keeps addressed history collapsed and exposes Undo", () => {
    const {onUndo} = setup(true);
    const summary = screen.getByText("Addressed (1)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button",{name:"Undo"}));
    expect(onUndo).toHaveBeenCalledWith("r1");
  });
  it("saves a separate author reply without changing the reviewer text", async () => {
    setup();
    fireEvent.click(screen.getByRole("button",{name:"Reply"}));
    fireEvent.change(screen.getByLabelText("Author reply"),{target:{value:"Added the field."}});
    fireEvent.click(screen.getByLabelText("Save reply"));
    await waitFor(() => expect(saveSopAuthorResponse).toHaveBeenCalledWith("r1","Added the field."));
    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByText("Add signature")).toBeInTheDocument();
  });
});
