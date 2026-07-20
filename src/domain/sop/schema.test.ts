import { describe, expect, it } from "vitest";
import { createEmptySop, linkedSopLabel } from "./schema";

describe("linkedSopLabel", () => {
  it("joins number and title with an em dash", () => {
    expect(linkedSopLabel({ sopId: "x", sopNumber: "SOP-QA-001", title: "QMS" })).toBe("SOP-QA-001 — QMS");
  });

  it("degrades to whichever half exists", () => {
    expect(linkedSopLabel({ sopId: "x", sopNumber: "SOP-QA-001", title: "" })).toBe("SOP-QA-001");
    expect(linkedSopLabel({ sopId: "x", sopNumber: "", title: "QMS" })).toBe("QMS");
  });

  it("falls back to the id when both halves are blank (target deleted before snapshot)", () => {
    expect(linkedSopLabel({ sopId: "abc123", sopNumber: "", title: "" })).toBe("abc123");
  });
});

describe("createEmptySop", () => {
  it("seeds linkedSops and referenceDocs as empty lists", () => {
    const sop = createEmptySop("id", "2026-01-01T00:00:00.000Z");
    expect(sop.linkedSops).toEqual([]);
    expect(sop.referenceDocs).toEqual([]);
  });
});
