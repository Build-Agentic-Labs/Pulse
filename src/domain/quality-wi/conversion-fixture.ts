import type { ConversionDraft, ConversionEvidence } from "./conversion";
export const evidence: ConversionEvidence = {
  hash: "a".repeat(64),
  warnings: [],
  blocks: [
    { id: "p1", text: "Photograph the plate", imageIds: ["img1"] },
    { id: "p2", text: "Jaylynn Johnson, FIP-00001, C", imageIds: [] },
  ],
  assets: [
    {
      id: "img1",
      sourceId: "p1",
      name: "image1.png",
      width: 600,
      height: 400,
      available: true,
    },
  ],
};
export const result: ConversionDraft = {
  title: "Delivery Photos",
  purpose: "",
  responsibilities: "",
  metadata: {
    title: "",
    author: "Jaylynn Johnson",
    documentNumber: "FIP-00001",
    revision: "C",
    date: "",
    department: "",
    sourceIds: ["p2"],
  },
  steps: [
    {
      title: "Photograph the plate",
      instruction: "Capture a readable photo of the plate.",
      imageId: "img1",
      sourceIds: ["p1"],
    },
  ],
  images: [
    {
      imageId: "img1",
      description: "Equipment plate",
      disposition: "step",
      reason: "Plate evidence",
    },
  ],
  coverage: [
    { sourceId: "p1", stepNumbers: [1], reason: "Procedure" },
    { sourceId: "p2", stepNumbers: [], reason: "Metadata" },
  ],
  warnings: [],
};
