import { describe, expect, it } from "vitest";
import { annexDownloadName } from "./annex-files";

describe("annexDownloadName", () => {
  it("keeps browser-viewable types inline (no forced download)", () => {
    expect(annexDownloadName("application/pdf", "spec.pdf")).toBeUndefined();
    expect(annexDownloadName("image/png", "photo.png")).toBeUndefined();
    expect(annexDownloadName("image/jpeg", "photo.jpg")).toBeUndefined();
  });

  it("forces the original file name for types the browser downloads", () => {
    expect(
      annexDownloadName(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "MTS Work Orders Master - DEC - CYP.xlsx",
      ),
    ).toBe("MTS Work Orders Master - DEC - CYP.xlsx");
    expect(annexDownloadName("text/csv", "export.csv")).toBe("export.csv");
    expect(annexDownloadName("application/msword", "form.doc")).toBe("form.doc");
  });

  it("falls back to a generic name when the original is blank", () => {
    expect(annexDownloadName("text/csv", "")).toBe("download");
  });
});
