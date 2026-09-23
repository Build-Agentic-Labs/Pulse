import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReviewQueueData } from "./review-queue-data";
import * as review from "./review";
import * as annotations from "./review-annotations";
import * as departments from "@/lib/departments/store";
import { listSops, type SopListItem } from "./store";
vi.mock("./review", () => ({ listMySeats: vi.fn(), listMySignaturesFor: vi.fn(), listSeatsForSops: vi.fn(), listSopAuthorDisplayNames: vi.fn(), isBlockingSeat: (r: string) => r === "responsible" }));
vi.mock("./review-annotations", () => ({ listSopReviewSubmissions: vi.fn(), listOpenSopReviewAnnotationsFor: vi.fn(), hasSubmittedSopReview: () => false }));
vi.mock("@/lib/departments/store", () => ({ listDepartments: vi.fn(), fetchMyDeptRoles: vi.fn() }));
vi.mock("./store", () => ({ listSops: vi.fn() }));
const sop = (id: string, overrides: Partial<SopListItem> = {}): SopListItem => ({
 id, title: id, sopNumber: "", version: "", source: "authored", status: "approved", updatedAt: "", departmentId: "dept",
 departmentCode: "D", effectiveDate: null, nextReviewDate: null, createdBy: "author", submittedBy: "submitter",
 rejectedReason: null, reviewCycle: 1, contentHash: "same-hash", finalApprovalRequestedAt: "2026-09-21", finalApprovalContentHash: "same-hash", ...overrides,
});
const seat = (sopId: string, status: "approved" | "in_review" = "in_review"): review.MySeatItem => ({
 sopId, departmentId: "dept", sopDepartmentId: "dept", rasic: "responsible", title: sopId, sopNumber: "", version: "", status,
 contentHash: "same-hash", finalApprovalRequestedAt: "2026-09-21", finalApprovalContentHash: "same-hash", reviewCycle: 1, updatedAt: "",
});
const signature = (sopId: string, meaning: review.SignatureMeaning = "dept_approval") => ({
 sopId, id: "sig", signerId: "viewer", signerName: "Viewer", meaning, rejectedReason: null, signedAt: "", seatDepartmentId: "dept",
 reviewCycle: 1, resolvesSignatureId: null, signedContentHash: "same-hash", signatureStrokes: [],
});
beforeEach(() => {
 vi.mocked(review.listMySeats).mockResolvedValue([]);
 vi.mocked(review.listMySignaturesFor).mockResolvedValue([]);
 vi.mocked(review.listSeatsForSops).mockResolvedValue([]);
 vi.mocked(review.listSopAuthorDisplayNames).mockResolvedValue({});
 vi.mocked(annotations.listSopReviewSubmissions).mockResolvedValue([]);
 vi.mocked(annotations.listOpenSopReviewAnnotationsFor).mockResolvedValue([]);
 vi.mocked(departments.listDepartments).mockResolvedValue([{ id: "quality", workspaceId: "ws", code: "Q", name: "Quality", isQualityGate: true, sopTarget: 0 }]);
 vi.mocked(departments.fetchMyDeptRoles).mockResolvedValue(new Map([["quality", "approver"]]));
 vi.mocked(listSops).mockResolvedValue([]);
});
describe("review queue routing", () => {
 it("does not let a signature on one SOP hide approval of another with identical content", async () => {
  vi.mocked(review.listMySeats).mockResolvedValue([seat("one"), seat("two")]);
  vi.mocked(review.listMySignaturesFor).mockResolvedValue([signature("one")]);
  const queue = await fetchReviewQueueData("ws", "viewer");
  expect(queue.finalApprovals.map((s) => s.sopId)).toEqual(["two"]);
 });
 it("routes Quality release only to a signer independent of author, submitter, seats and overrules", async () => {
  vi.mocked(listSops).mockResolvedValue([sop("own", { createdBy: "viewer" }), sop("submitted", { submittedBy: "viewer" }), sop("seated"), sop("overruled"), sop("eligible")]);
  vi.mocked(review.listMySeats).mockResolvedValue([seat("seated", "approved")]);
  vi.mocked(review.listMySignaturesFor).mockResolvedValue([signature("overruled", "objection_overruled")]);
  const queue = await fetchReviewQueueData("ws", "viewer");
  expect(queue.awaitingQuality.map((s) => s.id)).toEqual(["eligible"]);
  expect(queue.allInFlight).toHaveLength(5);
 });
 it("names the author of each SOP waiting on the viewer", async () => {
  vi.mocked(review.listMySeats).mockResolvedValue([seat("one"), seat("done", "approved")]);
  vi.mocked(review.listSopAuthorDisplayNames).mockResolvedValue({ one: "Jennifer Li" });
  const queue = await fetchReviewQueueData("ws", "viewer");
  expect(review.listSopAuthorDisplayNames).toHaveBeenCalledWith(["one"], undefined);
  expect(queue.authorNames).toEqual({ one: "Jennifer Li" });
 });
});
