import { beforeEach, expect, it, vi } from "vitest";
import { buildApprovalEntries } from "./approval-entries";
import * as review from "./review";
import * as departments from "@/lib/departments/store";
vi.mock("./review", () => ({ getSopControl: vi.fn(), listSeats: vi.fn(), listSignatures: vi.fn(), getSopAuthorDisplayName: vi.fn(), listProfileNames: vi.fn(), listSopApproverNames: vi.fn(), isBlockingSeat: () => true, isSignatureCurrent: (s: { current?: boolean }) => s.current !== false }));
vi.mock("@/lib/departments/store", () => ({ listDepartments: vi.fn(), listMembersForDepartments: vi.fn() }));
beforeEach(() => {
  vi.mocked(review.getSopControl).mockResolvedValue({ workspaceId: "ws", createdBy: "author", submittedBy: "submitter", reviewCycle: 1 } as never);
  vi.mocked(review.listSeats).mockResolvedValue([{ departmentId: "sales", signerId: "reviewer" }] as never);
  vi.mocked(review.listSignatures).mockResolvedValue([]);
  vi.mocked(review.getSopAuthorDisplayName).mockResolvedValue("Author");
  vi.mocked(review.listSopApproverNames).mockResolvedValue(new Map([["reviewer", "Reviewer"]]));
  vi.mocked(review.listProfileNames).mockResolvedValue(new Map([["quality", "Jane Quality"], ["reviewer", "Reviewer"]]));
  vi.mocked(departments.listDepartments).mockResolvedValue([{ id: "q", isQualityGate: true }] as never);
  vi.mocked(departments.listMembersForDepartments).mockResolvedValue(["quality", "author", "submitter", "reviewer"].map(userId => ({ userId, departmentId: "q", deptRole: "approver", positionTitle: "Quality Manager" })) as never);
});
it("always ends with the eligible Quality approver before signing", async () => {
  const { entries } = await buildApprovalEntries("sop");
  expect(entries).toHaveLength(2);
  expect(entries.at(-1)).toMatchObject({ approval: "Quality final approval", name: "Jane Quality", position: "Quality Manager", signedAt: null, signatureStrokes: [] });
});
it("keeps the actual signed Quality approver last", async () => {
  vi.mocked(review.listSignatures).mockResolvedValue([{ id: "signed", meaning: "quality_approval", signerId: "former", signerName: "Actual signer", signedAt: "2026-10-21", signatureStrokes: [] }] as never);
  const { entries } = await buildApprovalEntries("sop");
  expect(entries).toHaveLength(2);
  expect(entries.at(-1)).toMatchObject({ key: "signed", name: "Actual signer", signedAt: "2026-10-21" });
});
it("shows the final gate even when no eligible approver exists", async () => {
  vi.mocked(departments.listMembersForDepartments).mockResolvedValue([]);
  expect((await buildApprovalEntries("sop")).entries.at(-1)?.name).toBe("No eligible Quality approver assigned");
});
