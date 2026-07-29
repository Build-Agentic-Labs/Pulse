export type SopEditorInitialView = "pdf" | "draft-review" | "final-approval" | "quality-approval";

export function requestedSopEditorStepId(
  initialView: SopEditorInitialView | undefined,
): string | null {
  return initialView === "draft-review"
    ? "draftReview"
    : initialView === "final-approval"
      ? "finalApproval"
      : initialView === "quality-approval"
        ? "qualityApproval"
        : null;
}

export function initialSopEditorStepIndex(
  steps: ReadonlyArray<{ id: string }>,
  initialView: SopEditorInitialView | undefined,
): number {
  const requestedStepId = requestedSopEditorStepId(initialView);
  if (!requestedStepId) return 0;
  const requestedStepIndex = steps.findIndex((step) => step.id === requestedStepId);
  return requestedStepIndex >= 0 ? requestedStepIndex : 0;
}
