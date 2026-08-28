import { describe, expect, it } from "vitest";

import { clipboardImageFiles } from "./clipboard-images";

function dataTransfer(items: unknown[], files: unknown[]) {
  return { items, files } as unknown as DataTransfer;
}

describe("clipboardImageFiles", () => {
  it("returns image files from clipboard items", () => {
    const image = new File(["bytes"], "shot.png", { type: "image/png" });
    const result = clipboardImageFiles(
      dataTransfer([{ kind: "file", type: "image/png", getAsFile: () => image }], []),
    );

    expect(result).toEqual([image]);
  });

  it("falls back to files when items carry nothing usable", () => {
    const image = new File(["bytes"], "shot.png", { type: "image/png" });
    const result = clipboardImageFiles(dataTransfer([], [image]));

    expect(result).toEqual([image]);
  });

  it("ignores non-image content", () => {
    const result = clipboardImageFiles(
      dataTransfer([{ kind: "string", type: "text/plain", getAsFile: () => null }], []),
    );

    expect(result).toEqual([]);
  });

  it("returns an empty list for a null DataTransfer", () => {
    expect(clipboardImageFiles(null)).toEqual([]);
  });
});
