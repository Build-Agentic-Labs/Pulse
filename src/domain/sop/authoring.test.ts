import { describe, it, expect } from "vitest";
import type { Department } from "@/domain/departments";
import { authoringMode, previewSopNumber, effectiveSopNumber, DEFAULT_DOC_TYPE } from "./authoring";

function dept(id: string, code: string): Department {
  return { id, workspaceId: "ws", code, name: `${code} dept`, isQualityGate: false };
}

describe("authoringMode", () => {
  it("blocks a user in no department", () => {
    expect(authoringMode([])).toEqual({ kind: "blocked" });
  });

  it("returns a fixed single department", () => {
    const d = dept("a", "QA");
    expect(authoringMode([d])).toEqual({ kind: "single", department: d });
  });

  it("offers a choice for several departments", () => {
    const list = [dept("a", "QA"), dept("b", "OPS")];
    expect(authoringMode(list)).toEqual({ kind: "choose", departments: list });
  });
});

describe("previewSopNumber", () => {
  it("formats TYPE-CODE-### uppercased", () => {
    expect(previewSopNumber("qas", DEFAULT_DOC_TYPE)).toBe("SOP-QAS-###");
  });
});

describe("effectiveSopNumber", () => {
  it("prefers the column number when present", () => {
    expect(effectiveSopNumber("QA-SOP-007", "STALE")).toBe("QA-SOP-007");
  });

  it("falls back to the document number when the column is blank or null", () => {
    expect(effectiveSopNumber(null, "DOC-1")).toBe("DOC-1");
    expect(effectiveSopNumber("   ", "DOC-1")).toBe("DOC-1");
  });
});
