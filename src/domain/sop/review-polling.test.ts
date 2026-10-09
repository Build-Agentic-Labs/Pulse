import { describe, expect, it } from "vitest";
import { shouldPollReviewAnnotations } from "./review-polling";

describe("shouldPollReviewAnnotations", () => {
  it("never polls an SOP that has not been persisted", () => {
    expect(
      shouldPollReviewAnnotations({ hasPersistedSop: false, status: "in_review", hasReviewHistory: true }),
    ).toBe(false);
  });

  it("polls a persisted SOP that is in review", () => {
    expect(
      shouldPollReviewAnnotations({ hasPersistedSop: true, status: "in_review", hasReviewHistory: false }),
    ).toBe(true);
  });

  it("polls a persisted SOP with review history after it leaves review", () => {
    expect(
      shouldPollReviewAnnotations({ hasPersistedSop: true, status: "draft", hasReviewHistory: true }),
    ).toBe(true);
  });

  it("does not poll a draft that was never sent for review", () => {
    expect(
      shouldPollReviewAnnotations({ hasPersistedSop: true, status: "draft", hasReviewHistory: false }),
    ).toBe(false);
  });

  it("does not poll an effective SOP without review history", () => {
    expect(
      shouldPollReviewAnnotations({ hasPersistedSop: true, status: "effective", hasReviewHistory: false }),
    ).toBe(false);
  });
});
