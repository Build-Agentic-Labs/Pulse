import { describe, expect, it } from "vitest";
import {
  buildConversionUploadPath,
  conversionContentType,
  conversionFailureMessage,
  parseConversionUploadPath,
} from "./conversion-upload";

describe("conversionContentType", () => {
  it("accepts .docx and .pdf regardless of case and rejects everything else", () => {
    expect(conversionContentType("SOP.DOCX")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(conversionContentType("scan.pdf")).toBe("application/pdf");
    expect(conversionContentType("legacy.doc")).toBeNull();
    expect(conversionContentType("notes.txt")).toBeNull();
  });
});

describe("buildConversionUploadPath", () => {
  it("keeps uid and workspace verbatim and sanitises only the file name", () => {
    expect(
      buildConversionUploadPath({
        userId: "b0000000-0000-0000-0000-000000000001",
        workspaceId: "ws_Alpha",
        uploadId: "u1",
        fileName: "ANA Delivery Photos SOP 1c.DOCX",
      }),
    ).toBe("users/b0000000-0000-0000-0000-000000000001/ws_Alpha/u1-ANA-Delivery-Photos-SOP-1c.docx");
  });

  it("keeps the extension when the stem is very long", () => {
    const path = buildConversionUploadPath({
      userId: "u",
      workspaceId: "w",
      uploadId: "id",
      fileName: `${"x".repeat(300)}.pdf`,
    });
    expect(path.endsWith(".pdf")).toBe(true);
    expect(path.length).toBeLessThan(140);
  });

  it("falls back to a stem when the name is only punctuation", () => {
    expect(
      buildConversionUploadPath({ userId: "u", workspaceId: "w", uploadId: "id", fileName: "***.docx" }),
    ).toBe("users/u/w/id-document.docx");
  });

  it("refuses ids that would add path segments", () => {
    expect(() =>
      buildConversionUploadPath({ userId: "u/x", workspaceId: "w", uploadId: "id", fileName: "a.pdf" }),
    ).toThrow(/user id/);
    expect(() =>
      buildConversionUploadPath({ userId: "u", workspaceId: "", uploadId: "id", fileName: "a.pdf" }),
    ).toThrow(/workspace id/);
  });

  it("round-trips through parseConversionUploadPath", () => {
    const path = buildConversionUploadPath({
      userId: "u1",
      workspaceId: "w1",
      uploadId: "id",
      fileName: "a b.pdf",
    });
    expect(parseConversionUploadPath(path)).toEqual({ userId: "u1", workspaceId: "w1", fileName: "id-a-b.pdf" });
  });
});

describe("parseConversionUploadPath", () => {
  it.each(["users/u1/w1", "users/u1/w1/x/y.pdf", "other/u1/w1/y.pdf", "users//w1/y.pdf", ""])(
    "rejects %j",
    (path) => {
      expect(parseConversionUploadPath(path)).toBeNull();
    },
  );
});

describe("conversionFailureMessage", () => {
  it("prefers the route's JSON error", () => {
    expect(conversionFailureMessage(422, JSON.stringify({ error: "No readable content." }))).toBe(
      "No readable content.",
    );
  });

  it("explains a plain-text 413 from the platform instead of a JSON parse error", () => {
    expect(conversionFailureMessage(413, "Request Entity Too Large")).toMatch(/too large.*20 MB/);
  });

  it("maps expired sessions and gateway timeouts", () => {
    expect(conversionFailureMessage(401, "")).toMatch(/session expired/i);
    expect(conversionFailureMessage(504, "")).toMatch(/timed out/i);
  });

  it("drops HTML bodies and keeps short text bodies", () => {
    expect(conversionFailureMessage(502, "<html><body>Bad Gateway</body></html>")).toBe(
      "Conversion failed (HTTP 502)",
    );
    expect(conversionFailureMessage(500, "boom")).toBe("Conversion failed (HTTP 500): boom");
  });

  it("falls back when the JSON has no usable error", () => {
    expect(conversionFailureMessage(500, "{}")).toBe("Conversion failed (HTTP 500): {}");
    expect(conversionFailureMessage(500, "{not json")).toBe("Conversion failed (HTTP 500): {not json");
  });
});
