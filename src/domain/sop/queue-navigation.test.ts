import { describe, expect, it } from "vitest";
import { viaReviewQueue } from "./queue-navigation";

describe("viaReviewQueue", () => {
  it("adds the origin flag after existing query params, or as the first one", () => {
    expect(viaReviewQueue("/sops/s1?step=draft-review")).toBe("/sops/s1?step=draft-review&via=review");
    expect(viaReviewQueue("/sops/s1")).toBe("/sops/s1?via=review");
  });
});
