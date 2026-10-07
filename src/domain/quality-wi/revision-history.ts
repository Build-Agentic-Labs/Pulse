import type { QualityWi, WiRevision } from "./schema";
import { wiTemplateDocument } from "./schema";
import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";

/** Older revisions cannot include later releases; drafts include only actual releases. */
export function wiPreviewDocument(document: QualityWi, revisions: WiRevision[], selected = "draft"): GeneralWorkInstruction {
  const revision = revisions.find(item => item.id === selected);
  return {
    ...(revision?.snapshot ?? wiTemplateDocument(document)),
    revisionHistory: revisions
      .filter(item => !revision || item.revisionIndex <= revision.revisionIndex)
      .toSorted((a, b) => a.revisionIndex - b.revisionIndex)
      .map(item => ({ revision: item.snapshot.revision, releaseDate: item.snapshot.revisionDate,
        description: item.changeDescription, authorName: item.authorName || "Not recorded" })),
  };
}
