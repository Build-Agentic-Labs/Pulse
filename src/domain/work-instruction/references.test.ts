import { describe, expect, it } from "vitest";
import {
  buildReferenceFilePath,
  normalizeReferenceInput,
  referenceDownloadName,
  referenceFileContentType,
  referenceFileProblem,
  referenceKindAcceptsFile,
  referenceLine,
  referencesForSetup,
  type WorkInstructionReferenceRecord,
} from "./references";

function record(overrides: Partial<WorkInstructionReferenceRecord> = {}): WorkInstructionReferenceRecord {
  return { id: "ref-1", taskId: "task-1", kind: "document", sopId: null, documentNumber: "FRM-010", title: "Torque log", url: "", position: 0, ...overrides };
}

describe("normalizeReferenceInput", () => {
  it("trims and keeps a plain document reference", () => {
    expect(normalizeReferenceInput({ kind: "drawing", documentNumber: " DWG-1140 ", title: " Frame ", url: "" })).toEqual({
      value: { kind: "drawing", sopId: null, documentNumber: "DWG-1140", title: "Frame", url: "" },
    });
  });

  it("keeps the SOP id only for SOP references", () => {
    expect(normalizeReferenceInput({ kind: "sop", sopId: " sop-1 " })).toEqual({
      value: { kind: "sop", sopId: "sop-1", documentNumber: "", title: "", url: "" },
    });
    expect(normalizeReferenceInput({ kind: "link", sopId: "sop-1", title: "Wiki", url: "https://wiki.example/x" })).toMatchObject({
      value: { sopId: null },
    });
  });

  it.each([
    ["an SOP with nothing picked", { kind: "sop" as const }, /Choose the SOP/],
    ["a document with no label", { kind: "document" as const, url: "https://x.example" }, /document number or a title/],
    ["a link with no address", { kind: "link" as const, title: "Wiki" }, /link address/],
    ["a non-http link", { kind: "link" as const, title: "Wiki", url: "javascript:alert(1)" }, /http/],
    ["a file path as a link", { kind: "drawing" as const, title: "Frame", url: "C:\\drawings\\frame.pdf" }, /http/],
  ])("refuses %s", (_label, input, message) => {
    expect(normalizeReferenceInput(input)).toEqual({ error: expect.stringMatching(message) });
  });
});

describe("referencesForSetup", () => {
  it("lists the legacy links first, a URL as a link and other text as a document number", () => {
    expect(referencesForSetup({ drawingLink: "https://pdm.example/1140.pdf", sopLink: " SOP-MFG-014 " }, [])).toEqual([
      { kind: "drawing", documentNumber: "", title: "", url: "https://pdm.example/1140.pdf" },
      { kind: "sop", documentNumber: "SOP-MFG-014", title: "", url: "" },
    ]);
    expect(referencesForSetup({}, [])).toEqual([]);
  });

  it("orders managed references by position and shows an SOP's current number, title and version", () => {
    const docs = referencesForSetup({}, [
      record({ id: "b", position: 2 }),
      record({
        id: "a",
        position: 1,
        kind: "sop",
        sopId: "sop-1",
        documentNumber: "OLD-NUMBER",
        title: "Old title",
        sop: { number: "QAS-SOP-004", title: "Document & Records Control", version: "2.0", status: "effective" },
      }),
    ]);
    expect(docs).toEqual([
      { kind: "sop", documentNumber: "QAS-SOP-004", title: "Document & Records Control", version: "2.0", url: "" },
      { kind: "document", documentNumber: "FRM-010", title: "Torque log", url: "" },
    ]);
  });

  it("falls back to the label stored on the row when the SOP is no longer readable", () => {
    expect(referencesForSetup({}, [record({ kind: "sop", sopId: null, documentNumber: "QAS-SOP-004", title: "Records" })])).toEqual([
      { kind: "sop", documentNumber: "QAS-SOP-004", title: "Records", url: "" },
    ]);
  });
});

describe("referenceLine", () => {
  it("joins number, version and title, and falls back to the URL", () => {
    expect(referenceLine({ kind: "sop", documentNumber: "QAS-SOP-004", version: "2.0", title: "Records", url: "" })).toBe("QAS-SOP-004 v2.0 · Records");
    expect(referenceLine({ kind: "sop", documentNumber: "QAS-SOP-004", version: "v3", title: "", url: "" })).toBe("QAS-SOP-004 v3");
    expect(referenceLine({ kind: "link", documentNumber: "", title: "", url: "https://wiki.example/x" })).toBe("https://wiki.example/x");
  });
});

describe("reference files", () => {
  it("labels an untitled upload by its file name, and only drawings and documents take files", () => {
    expect(normalizeReferenceInput({ kind: "drawing", fileName: "Frame 1140 rev C.pdf" })).toEqual({
      value: { kind: "drawing", sopId: null, documentNumber: "", title: "Frame 1140 rev C.pdf", url: "" },
    });
    expect(normalizeReferenceInput({ kind: "document", documentNumber: "FRM-010", fileName: "log.xlsx" })).toMatchObject({
      value: { documentNumber: "FRM-010", title: "" },
    });
    expect(normalizeReferenceInput({ kind: "link", title: "Wiki", url: "https://w.example", fileName: "a.pdf" })).toEqual({
      error: expect.stringMatching(/drawing or a document/),
    });
    expect(referenceKindAcceptsFile("sop")).toBe(false);
    expect(referenceKindAcceptsFile("document")).toBe(true);
  });

  it("judges the content type by extension and refuses what the bucket would refuse", () => {
    expect(referenceFileContentType("Drawing.PDF")).toBe("application/pdf");
    expect(referenceFileContentType("log.xlsx")).toMatch(/spreadsheetml/);
    expect(referenceFileContentType("model.step")).toBeNull();
    expect(referenceFileContentType("README")).toBeNull();
    expect(referenceFileProblem({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(referenceFileProblem({ name: "a.pdf", size: 21 * 1024 * 1024 })).toMatch(/20 MB/);
    expect(referenceFileProblem({ name: "a.exe", size: 10 })).toMatch(/PDF, Word/);
    expect(referenceFileProblem({ name: "a.pdf", size: 10 })).toBeNull();
  });

  it("builds a project-scoped path, sanitising only the file name", () => {
    expect(
      buildReferenceFilePath({
        workspaceId: "ws_1",
        projectId: "project-flexboost",
        taskId: "task-flexboost-1",
        uploadId: "u1",
        fileName: "Frame 1140 (rev C).PDF",
      }),
    ).toBe("workspaces/ws_1/projects/project-flexboost/wi-references/task-flexboost-1/u1-Frame-1140-rev-C.pdf");
    expect(() =>
      buildReferenceFilePath({ workspaceId: "ws/1", projectId: "p", taskId: "t", uploadId: "u", fileName: "a.pdf" }),
    ).toThrow(/workspace id/);
  });

  it("carries the file name onto the sheet reference, so swapping a file counts as a change", () => {
    const docs = referencesForSetup({}, [
      record({ file: { storagePath: "x", name: "log.xlsx", contentType: "application/vnd.ms-excel", sizeBytes: 10 } }),
    ]);
    expect(docs[0].fileName).toBe("log.xlsx");
  });

  it("opens PDFs and images inline and downloads the rest under their own name", () => {
    expect(referenceDownloadName({ contentType: "application/pdf", name: "a.pdf" })).toBeUndefined();
    expect(referenceDownloadName({ contentType: "image/png", name: "a.png" })).toBeUndefined();
    expect(referenceDownloadName({ contentType: "text/csv", name: "log.csv" })).toBe("log.csv");
  });
});
