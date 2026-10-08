import { describe, expect, it } from "vitest";
import {
  buildWiConversion,
  conversionImageName,
  readConversionSource,
  validateWiConversion,
  type ConversionDraft,
} from "./conversion";
import { evidence, result } from "./conversion-fixture";
describe("source-backed WI conversion", () => {
  it("preserves exact names and original identifiers without assigning identities or release numbers", () => {
    let n = 0;
    const draft = validateWiConversion(result, evidence);
    const prepared = buildWiConversion(
      draft,
      evidence,
      {
        id: "wi",
        workspaceId: "workspace",
        fileName: "Original.docx",
        model: "test",
        now: "2026-10-08",
      },
      () => `id-${++n}`,
    );
    expect(prepared.source.metadata).toMatchObject({
      author: "Jaylynn Johnson",
      documentNumber: "FIP-00001",
      revision: "C",
    });
    expect(prepared).not.toHaveProperty("createdBy");
    expect(prepared).not.toHaveProperty("documentNumber");
    expect(prepared.steps[0].image?.name).toBe("Photograph the plate.jpg");
    expect(prepared.uploads[0].storagePath).toBe("workspace/wi/id-1/id-2.jpg");
  });
  it.each([
    [
      "invented source",
      (d: ConversionDraft) => {
        d.steps[0].sourceIds = ["invented"];
      },
    ],
    [
      "missing image",
      (d: ConversionDraft) => {
        d.images = [];
      },
    ],
    [
      "wrong image",
      (d: ConversionDraft) => {
        d.steps[0].imageId = "other";
      },
    ],
    [
      "conflicting image disposition",
      (d: ConversionDraft) => {
        d.images[0].disposition = "reference";
      },
    ],
    [
      "missing block",
      (d: ConversionDraft) => {
        d.coverage.pop();
      },
    ],
    [
      "duplicate block",
      (d: ConversionDraft) => {
        d.coverage[1] = d.coverage[0];
      },
    ],
    [
      "broken step reference",
      (d: ConversionDraft) => {
        d.coverage[0].stepNumbers = [2];
      },
    ],
    [
      "missing reverse coverage",
      (d: ConversionDraft) => {
        d.coverage[0].stepNumbers = [];
      },
    ],
    [
      "empty procedure",
      (d: ConversionDraft) => {
        d.steps = [];
      },
    ],
  ] as const)("rejects %s", (_label, edit) => {
    const copy = structuredClone(result);
    edit(copy);
    expect(() => validateWiConversion(copy, evidence)).toThrow();
  });
  it("keeps unassigned source images for review instead of silently discarding them", () => {
    const copy = structuredClone(result);
    copy.steps[0].imageId = null;
    copy.images[0].disposition = "reference";
    let n = 0;
    const prepared = buildWiConversion(
      validateWiConversion(copy, evidence),
      evidence,
      {
        id: "wi",
        workspaceId: "w",
        fileName: "f.docx",
        model: "m",
        now: "today",
      },
      () => `${++n}`,
    );
    expect(prepared.steps[0].image).toBeNull();
    expect(prepared.uploads).toHaveLength(1);
    expect(prepared.uploads[0].stepId).not.toBe(prepared.steps[0].id);
  });
  it("does not permit undecodable images in steps", () => {
    expect(() =>
      validateWiConversion(result, {
        ...evidence,
        assets: [{ ...evidence.assets[0], available: false }],
      }),
    ).toThrow("unavailable");
  });
  it("sanitizes image filenames while preserving readable labels", () => {
    expect(conversionImageName("Engine: plate / photo?", "image.png")).toBe(
      "Engine plate photo.jpg",
    );
  });
  it("malformed historical metadata cannot crash a shared editor", () => {
    expect(readConversionSource({ metadata: null })).toBeUndefined();
  });
});

it("computes consistent coverage from canonical step and metadata references", async () => {
  const { normalizeWiExtraction } = await import("./conversion");
  const normalized = normalizeWiExtraction(
    { ...result, excludedBlocks: [], detailSourceIds: [] },
    evidence,
  );
  expect(normalized.coverage).toEqual([
    { sourceId: "p1", stepNumbers: [1], reason: "Used in procedure steps" },
    { sourceId: "p2", stepNumbers: [], reason: "Original document metadata" },
  ]);
});
it("refuses to silently drop an unreferenced source requirement", async () => {
  const { normalizeWiExtraction } = await import("./conversion");
  expect(() =>
    normalizeWiExtraction(
      { ...result, excludedBlocks: [], detailSourceIds: [] },
      {
        ...evidence,
        blocks: [
          ...evidence.blocks,
          { id: "p3", text: "Inspect the unit before photos", imageIds: [] },
        ],
      },
    ),
  ).toThrow("p3");
});

it("accounts for purpose and responsibilities separately from original metadata", async () => {
  const { normalizeWiExtraction } = await import("./conversion");
  const next = {
    ...evidence,
    blocks: [
      ...evidence.blocks,
      { id: "p3", text: "Purpose: inspect deliveries", imageIds: [] },
    ],
  };
  expect(
    normalizeWiExtraction(
      { ...result, excludedBlocks: [], detailSourceIds: ["p3"] },
      next,
    ).coverage.at(-1),
  ).toEqual({
    sourceId: "p3",
    stepNumbers: [],
    reason: "Purpose, scope or responsibilities",
  });
});

it("derives image usage from the actual steps while retaining all source assets", async () => {
  const { normalizeWiExtraction } = await import("./conversion");
  const raw = {
    ...result,
    images: [{ ...result.images[0], disposition: "reference" }],
    excludedBlocks: [],
    detailSourceIds: [],
  };
  expect(normalizeWiExtraction(raw, evidence).images[0].disposition).toBe(
    "step",
  );
});
it("rejects a source author name that was invented or respelled", () => {
  const copy = structuredClone(result);
  copy.metadata.author = "Jaylen Johnson";
  expect(() => validateWiConversion(copy, evidence)).toThrow("original author");
});
it("corrections cannot silently change identity or target nonexistent steps", async () => {
  const { applyWiConversionCorrection } = await import("./conversion");
  const correction = {
    stepEdits: [],
    imageEdits: [],
    replacementSteps: null,
    details: null,
    metadata: null,
    excludedBlocks: null,
    warnings: [],
  };
  expect(() =>
    applyWiConversionCorrection(result, {
      ...correction,
      details: { createdBy: "other" },
    }),
  ).toThrow("details");
  expect(() =>
    applyWiConversionCorrection(result, {
      ...correction,
      stepEdits: [{ stepNumber: 9, step: result.steps[0] }],
    }),
  ).toThrow("step number");
});
