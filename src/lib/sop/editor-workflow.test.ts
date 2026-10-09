import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserFromSession } from "@/domain/supabase-planner";
import {
  getSopControl,
  listSignatures,
  sendSopForSignatures,
  signSop,
  transitionSop,
  type SopControl,
} from "./review";
import { submitEditorDraft } from "./editor-workflow";
vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: vi.fn(),
  getUserFromSession: vi.fn(),
}));
vi.mock("@/lib/departments/store", () => ({
  fetchMyDeptRoles: vi.fn(),
  listDepartments: vi.fn(),
}));
vi.mock("./review", () => ({
  getSopControl: vi.fn(),
  isSignatureCurrent: vi.fn(),
  listProfileNames: vi.fn(),
  listSeats: vi.fn(),
  listSignatures: vi.fn(),
  sendSopForSignatures: vi.fn(),
  signSop: vi.fn(),
  submitSopWithApproverInvitations: vi.fn(),
  transitionSop: vi.fn(),
}));
const control: SopControl = {
  id: "test",
  workspaceId: "local",
  departmentId: "department",
  status: "draft",
  sopNumber: "",
  docType: "SOP",
  version: "1.0",
  submittedBy: null,
  approvedBy: null,
  approvedAt: null,
  effectiveDate: null,
  nextReviewDate: null,
  effectiveRevisionId: null,
  rejectedReason: null,
  createdBy: "author",
  updatedAt: "saved",
  contentHash: "hash",
  reviewCycle: 1,
  revisionReason: null,
  changeSignificance: null,
  selfReviewTest: false,
  finalApprovalRequestedAt: null,
  finalApprovalContentHash: null,
  finalApprovalRequestedBy: null,
};
beforeEach(() => {
  vi.resetAllMocks();
});
describe("SOP editor approval orchestration", () => {
  it("does not sign or submit when the draft cannot save", async () => {
    expect(
      await submitEditorDraft({
        sopId: "test",
        persist: async () => false,
        seats: [],
        readyForSignatures: false,
      }),
    ).toBeNull();
    expect(getSopControl).not.toHaveBeenCalled();
    expect(signSop).not.toHaveBeenCalled();
    expect(transitionSop).not.toHaveBeenCalled();
  });
  it("uses the token after authorship signing for the review transition", async () => {
    vi.mocked(getSopControl)
      .mockResolvedValueOnce(control)
      .mockResolvedValueOnce({ ...control, updatedAt: "signed" });
    vi.mocked(getUserFromSession).mockResolvedValue({
      data: { user: { id: "author" } },
      error: null,
    } as Awaited<ReturnType<typeof getUserFromSession>>);
    vi.mocked(listSignatures).mockResolvedValue([]);
    vi.mocked(transitionSop).mockResolvedValue({
      ...control,
      status: "in_review",
      updatedAt: "submitted",
    });
    const result = await submitEditorDraft({
      sopId: "test",
      persist: async () => true,
      seats: [],
      readyForSignatures: false,
    });
    expect(signSop).toHaveBeenCalledWith("test", "authorship");
    expect(transitionSop).toHaveBeenCalledWith("test", "in_review", "signed");
    expect(result?.control.updatedAt).toBe("submitted");
    expect(result?.destination).toBe("draft-review");
  });
  it("routes a completed review to signatures using the saved content hash", async () => {
    vi.mocked(getSopControl)
      .mockResolvedValueOnce(control)
      .mockResolvedValueOnce({
        ...control,
        finalApprovalRequestedAt: "now",
        updatedAt: "requested",
      });
    const result = await submitEditorDraft({
      sopId: "test",
      persist: async () => true,
      seats: [],
      readyForSignatures: true,
    });
    expect(sendSopForSignatures).toHaveBeenCalledWith("test", "hash", 1);
    expect(signSop).not.toHaveBeenCalled();
    expect(result?.destination).toBe("final-approval");
    expect(result?.control.updatedAt).toBe("requested");
  });
  it("adopts an already-submitted document without signing or transitioning again", async () => {
    vi.mocked(getSopControl).mockResolvedValue({
      ...control,
      status: "in_review",
    });
    const result = await submitEditorDraft({
      sopId: "test",
      persist: async () => true,
      seats: [],
      readyForSignatures: false,
    });
    expect(signSop).not.toHaveBeenCalled();
    expect(transitionSop).not.toHaveBeenCalled();
    expect(result?.refresh).toBe(false);
  });
});
