import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import type { SopListItem } from "@/lib/sop/store";
import { listProfileNames, listSeatsForSops } from "@/lib/sop/review";
import { listSopReviewSubmissions } from "@/lib/sop/review-annotations";
import { fetchSopListReviewData } from "./list-review-data";

vi.mock("@/lib/sop/review", () => ({
  listProfileNames: vi.fn(),
  listSeatsForSops: vi.fn(),
}));

vi.mock("@/lib/sop/review-annotations", () => ({
  listSopReviewSubmissions: vi.fn(),
}));

const client = {} as SupabaseClient<Database>;

function sop(
  id: string,
  createdBy: string,
  status: SopListItem["status"] = "in_review",
): SopListItem {
  return {
    id,
    sopNumber: "",
    title: id,
    version: "1.0",
    source: "authored",
    status,
    updatedAt: "",
    departmentId: `dept-${id}`,
    departmentCode: id.toUpperCase(),
    effectiveDate: null,
    nextReviewDate: null,
    createdBy,
    rejectedReason: null,
    reviewCycle: 1,
    contentHash: "hash",
    finalApprovalRequestedAt: null,
    finalApprovalContentHash: null,
  };
}

describe("fetchSopListReviewData", () => {
  beforeEach(() => {
    vi.mocked(listProfileNames).mockReset();
    vi.mocked(listSeatsForSops).mockReset();
    vi.mocked(listSopReviewSubmissions).mockReset();
  });

  it("loads review progress for visible SOPs from every department and author", async () => {
    const sops = [
      sop("mine", "current-user"),
      sop("other-department", "another-author"),
      sop("draft", "another-author", "draft"),
    ];
    vi.mocked(listSeatsForSops).mockResolvedValue([
      {
        sopId: "mine",
        departmentId: "dept-mine",
        rasic: "responsible",
        signerId: "reviewer-1",
      },
      {
        sopId: "other-department",
        departmentId: "dept-other",
        rasic: "responsible",
        signerId: "reviewer-2",
      },
    ]);
    vi.mocked(listSopReviewSubmissions).mockResolvedValue([
      {
        id: "submission-2",
        sopId: "other-department",
        reviewCycle: 1,
        reviewerId: "reviewer-2",
        reviewerName: "Other Reviewer",
        noChanges: true,
        contentHash: "hash",
        submittedAt: "",
      },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(
      new Map([
        ["reviewer-1", "First Reviewer"],
        ["reviewer-2", "Other Reviewer"],
      ]),
    );

    const result = await fetchSopListReviewData(sops, "current-user", client);

    expect(listSeatsForSops).toHaveBeenCalledWith(
      ["mine", "other-department"],
      client,
    );
    expect(result.participantGroups).toEqual([
      {
        sopId: "mine",
        participants: [{ userId: "reviewer-1", name: "First Reviewer" }],
      },
      {
        sopId: "other-department",
        participants: [{ userId: "reviewer-2", name: "Other Reviewer" }],
      },
    ]);
    expect(result.submissions).toHaveLength(1);
  });

  it("uses the submitted reviewer name when profile visibility is limited", async () => {
    vi.mocked(listSeatsForSops).mockResolvedValue([
      {
        sopId: "other-department",
        departmentId: "dept-other",
        rasic: "responsible",
        signerId: "reviewer-2",
      },
    ]);
    vi.mocked(listSopReviewSubmissions).mockResolvedValue([
      {
        id: "submission-2",
        sopId: "other-department",
        reviewCycle: 1,
        reviewerId: "reviewer-2",
        reviewerName: "Visible From Submission",
        noChanges: false,
        contentHash: "hash",
        submittedAt: "",
      },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map());

    const result = await fetchSopListReviewData(
      [sop("other-department", "another-author")],
      "current-user",
      client,
    );

    expect(result.participantGroups[0]?.participants[0]?.name).toBe(
      "Visible From Submission",
    );
  });
});
