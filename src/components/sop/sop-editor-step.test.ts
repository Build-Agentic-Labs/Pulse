import { describe, expect, it } from "vitest";
import {
  initialSopEditorStepIndex,
  requestedSopEditorStepId,
} from "./sop-editor-step";

describe("SOP editor initial workflow step", () => {
  const creatorSteps = [
    { id: "document" },
    { id: "overview" },
    { id: "procedure" },
    { id: "annexes" },
    { id: "approvals" },
  ];

  it("selects a deep-linked review step on the first render", () => {
    const steps = [
      ...creatorSteps,
      { id: "draftReview" },
      { id: "finalApproval" },
      { id: "qualityApproval" },
    ];

    expect(initialSopEditorStepIndex(steps, "draft-review")).toBe(5);
    expect(initialSopEditorStepIndex(steps, "final-approval")).toBe(6);
    expect(initialSopEditorStepIndex(steps, "quality-approval")).toBe(7);
  });

  it("uses the rendered position when earlier review steps are unavailable", () => {
    const steps = [...creatorSteps, { id: "finalApproval" }];

    expect(initialSopEditorStepIndex(steps, "final-approval")).toBe(5);
  });

  it("falls back to Document when the requested step is unavailable", () => {
    expect(initialSopEditorStepIndex(creatorSteps, "draft-review")).toBe(0);
    expect(initialSopEditorStepIndex(creatorSteps, "pdf")).toBe(0);
    expect(requestedSopEditorStepId(undefined)).toBeNull();
  });
});
