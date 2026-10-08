import { describe, expect, it } from "vitest";
import {
  applyWiEdit,
  isWiEdit,
  wiPublishProblems,
  wiTemplateDocument,
  type QualityWi,
} from "./schema";
const base: QualityWi = {
  id: "wi",
  workspaceId: "w",
  departmentId: "d",
  departmentCode: "PRO",
  departmentName: "Process Engineering",
  title: "Fit",
  purpose: "Scope",
  responsibilities: "Engineer",
  documentNumber: null,
  version: 3,
  hasChanges: true,
  publishedRevisionId: null,
  updatedAt: "",
  steps: [
    {
      id: "a",
      title: "Open",
      instruction: "Open file",
      position: 1,
      image: null,
    },
    {
      id: "b",
      title: "Save",
      instruction: "Save it",
      position: 2,
      image: null,
    },
  ],
};
describe("general WI intent", () => {
  it("never assigns a number while applying draft edits", () => {
    const next = applyWiEdit(base, {
      kind: "details",
      payload: { title: "Changed" },
    });
    expect(next.documentNumber).toBeNull();
    expect(next.version).toBe(3);
    expect(base.title).toBe("Fit");
  });
  it("edits only the selected step", () => {
    const next = applyWiEdit(base, {
      kind: "step",
      payload: { id: "a", instruction: "Correction" },
    });
    expect(next.steps[1]).toEqual(base.steps[1]);
    expect(next.steps[0].title).toBe("Open");
    expect(base.steps[0].instruction).toBe("Open file");
  });
  it("reorders only a complete unique set", () => {
    expect(
      applyWiEdit(base, {
        kind: "reorder",
        payload: { ids: ["b", "a"] },
      }).steps.map((s) => [s.id, s.position]),
    ).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
    expect(() =>
      applyWiEdit(base, { kind: "reorder", payload: { ids: ["a", "a"] } }),
    ).toThrow();
    expect(() =>
      applyWiEdit(base, { kind: "reorder", payload: { ids: ["a"] } }),
    ).toThrow();
  });
  it("does not require a production image or assembly fields to publish", () => {
    expect(wiPublishProblems(base)).toEqual([]);
  });
  it("identifies incomplete document and step content", () => {
    expect(
      wiPublishProblems({
        ...base,
        title: " ",
        purpose: "",
        responsibilities: "",
        steps: [{ ...base.steps[0], instruction: "" }],
      }),
    ).toHaveLength(4);
    expect(wiPublishProblems({ ...base, steps: [] })).toEqual([
      "Add at least one step.",
    ]);
  });
  it("uses the existing template fields and leaves drafts unnumbered", () => {
    expect(wiTemplateDocument(base)).toMatchObject({
      documentNumber: "WI-PRO-###",
      revision: "",
      purpose: "Scope",
    });
    expect(
      wiTemplateDocument(
        { ...base, documentNumber: "WI-PRO-001" },
        2,
        "10/06/2026",
        "Correction",
      ),
    ).toMatchObject({
      documentNumber: "WI-PRO-001",
      revision: "B",
      revisionDescription: "Correction",
    });
  });
});

it("published preview uses a controlled date and is not labeled as a draft", () => {
  const output = wiTemplateDocument(
    { ...base, documentNumber: "WI-PRO-001" },
    1,
    "2026-10-06",
    "Initial",
  );
  expect(output).toMatchObject({ revisionDate: "10/06/2026", isDraft: false });
  expect(wiTemplateDocument(base).isDraft).toBe(true);
});

it("carries the original author into draft and revision previews", () => {
  const document = { ...base, authorName: "Jordan Smith" };
  expect(wiTemplateDocument(document).authorName).toBe("Jordan Smith");
  expect(wiTemplateDocument(document, 2, "2026-10-07", "Correction").authorName).toBe("Jordan Smith");
  expect(wiTemplateDocument(base).authorName).toBeUndefined();
});

it("hides a photo without discarding it and restores its template mapping", () => {
 const image = { id: "photo", name: "reference.jpg", storagePath: "path", width: 100, height: 100 };
 const doc = { ...base, steps: [{ ...base.steps[0], image }] };
 const hidden = applyWiEdit(doc, { kind: "step", payload: { id: "a", showPhoto: false } });
 expect(hidden.steps[0].image).toEqual(image);
 expect(wiTemplateDocument(hidden).steps[0]).toMatchObject({ showPhoto: false });
 expect(wiTemplateDocument(hidden).steps[0].image).toBeUndefined();
 const restored = applyWiEdit(hidden, { kind: "step", payload: { id: "a", showPhoto: true } });
 expect(wiTemplateDocument(restored).steps[0].image).toBe("photo");
 expect(wiTemplateDocument(doc).steps[0].showPhoto).toBe(true);
 expect(isWiEdit({ kind: "step", payload: { id: "a", showPhoto: false } })).toBe(true);
 expect(isWiEdit({ kind: "step", payload: { id: "a", showPhoto: "false" } })).toBe(false);
});

it("inserts after a stable step id, renumbers and preserves existing content", () => {
 const next = applyWiEdit(base, { kind: "add_step", payload: { id: "middle", afterId: "a" } });
 expect(next.steps.map(step => step.id)).toEqual(["a", "middle", "b"]);
 expect(next.steps.map(step => step.position)).toEqual([1, 2, 3]);
 expect(next.steps[2].instruction).toBe(base.steps[1].instruction);
 expect(base.steps.map(step => step.id)).toEqual(["a", "b"]);
 expect(applyWiEdit(base, { kind: "add_step", payload: { id: "last" } }).steps.at(-1)?.id).toBe("last");
 expect(() => applyWiEdit(base, { kind: "add_step", payload: { id: "new", afterId: "removed" } })).toThrow("no longer in the draft");
 expect(isWiEdit({kind:"add_step",payload:{id:"new",afterId:"a"}})).toBe(true);
 expect(isWiEdit({kind:"add_step",payload:{id:"new",afterId:7}})).toBe(false);
 expect(isWiEdit({kind:"add_step",payload:{id:"new",afterId:""}})).toBe(false);
});
