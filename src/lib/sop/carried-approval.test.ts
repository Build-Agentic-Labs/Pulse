import { describe, expect, it } from "vitest";
import { hasSeatSigned, isSignatureCurrent, type SopControl, type SopSignature } from "./review";
describe("carried approval provenance", () => {
  const control = { reviewCycle: 2, contentHash: "new-hash" } as SopControl;
  const original = { id: "source", signerId: "person", seatDepartmentId: "d", meaning: "dept_approval", reviewCycle: 0,
    signedContentHash: "original-hash", carriedFromVersion: "1.0", carriedToCycle: 2, carriedToHash: "new-hash" } as SopSignature;
  it("recognizes an explicit carry without relabelling the original signature's hash or cycle", () => {
    expect(isSignatureCurrent(original, control)).toBe(true);
    expect(original.reviewCycle).toBe(0);
    expect(original.signedContentHash).toBe("original-hash");
    expect(hasSeatSigned({ sopId: "s", departmentId: "d", signerId: "person", rasic: "responsible" }, [original], control)).toBe(true);
  });
  it("does not transfer an old carry to a new cycle, a new hash, or a replacement approver", () => {
    expect(isSignatureCurrent(original, { ...control, reviewCycle: 3 })).toBe(false);
    expect(isSignatureCurrent(original, { ...control, contentHash: "other" })).toBe(false);
    expect(hasSeatSigned({ sopId: "s", departmentId: "d", signerId: "replacement", rasic: "responsible" }, [original], control)).toBe(false);
  });
  it("never carries a Quality signature", () => {
    expect(isSignatureCurrent({ ...original, meaning: "quality_approval" }, control)).toBe(false);
  });
});
