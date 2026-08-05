import { describe, it, expect } from "vitest";
import type { Department } from "@/domain/departments";
import {
  authoringMode,
  documentNumberLabel,
  listNumberLabel,
  effectiveSopNumber,
  DEFAULT_DOC_TYPE,
} from "./authoring";

function dept(id: string, code: string): Department {
  return { id, workspaceId: "ws", code, name: `${code} dept`, isQualityGate: false, sopTarget: 0 };
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

describe("documentNumberLabel", () => {
  it("shows the real number once the document has earned one", () => {
    expect(documentNumberLabel("SOP-QAS-014", "QAS", DEFAULT_DOC_TYPE)).toBe("SOP-QAS-014");
  });

  it("formats an unearned number as TYPE-CODE-### uppercased", () => {
    expect(documentNumberLabel("", "qas", DEFAULT_DOC_TYPE)).toBe("SOP-QAS-###");
    expect(documentNumberLabel("   ", "qas", DEFAULT_DOC_TYPE)).toBe("SOP-QAS-###");
  });

  it("treats the converter's <UNKNOWN> placeholder as unnumbered", () => {
    expect(documentNumberLabel("<UNKNOWN>", "PRO", DEFAULT_DOC_TYPE)).toBe("SOP-PRO-###");
  });

  it("omits the department segment when no department is chosen yet", () => {
    expect(documentNumberLabel("", "", DEFAULT_DOC_TYPE)).toBe("SOP-###");
  });
});

describe("listNumberLabel", () => {
  it("shows the real number once the document has earned one", () => {
    expect(listNumberLabel("SOP-PRO-007", "PRO")).toBe("SOP-PRO-007");
  });

  it("stands in the department code while the document is unnumbered", () => {
    expect(listNumberLabel("", "pro")).toBe("PRO");
    expect(listNumberLabel(null, "PRO")).toBe("PRO");
    expect(listNumberLabel("<UNKNOWN>", "PRO")).toBe("PRO");
  });

  it("falls back to a dash when there is no number and no department", () => {
    expect(listNumberLabel("", "")).toBe("—");
    expect(listNumberLabel(null, null)).toBe("—");
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
