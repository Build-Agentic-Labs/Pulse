import { expect, it } from "vitest";
import { wiPreviewDocument } from "./revision-history";
import type { QualityWi, WiRevision } from "./schema";
import { blankGeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
const doc = { title: "Draft", steps: [], departmentCode: "PRO" } as unknown as QualityWi;
const revisions: WiRevision[] = [2, 1].map(index => ({ id: String(index), revisionIndex: index,
 publishedAt: "2026-10-07", changeDescription: `Change ${index}`, authorName: `Author ${index}`, steps: [],
 snapshot: { ...blankGeneralWorkInstruction(), revision: index === 1 ? "A" : "B", revisionDate: "10/07/2026" },
}));
it("sorts release history and does not include a new draft as a release", () => {
 expect(wiPreviewDocument(doc, revisions).revisionHistory?.map(row => row.authorName)).toEqual(["Author 1", "Author 2"]);
});
it("an older revision excludes later releases", () => {
 expect(wiPreviewDocument(doc, revisions, "1").revisionHistory).toHaveLength(1);
});
it("unpublished documents have empty history", () => {
 expect(wiPreviewDocument(doc, []).revisionHistory).toEqual([]);
});
