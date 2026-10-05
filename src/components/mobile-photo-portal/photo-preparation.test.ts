// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPhotoAttachment } from "./photo-preparation";

let dimensions: [number, number];
let imageFails: boolean;
let canvasSize: [number, number];
const revoke = vi.fn();
const draw = vi.fn();
const jpeg = vi.fn();
beforeEach(() => {
  dimensions = [2560, 1920]; imageFails = false;
  revoke.mockReset(); draw.mockReset(); jpeg.mockReset();
  vi.stubGlobal("Image", class {
    naturalWidth = dimensions[0]; naturalHeight = dimensions[1];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.()); }
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:prepared-photo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    canvasSize = [this.width, this.height];
    return { drawImage: draw } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
    jpeg(this.width, this.height, type, quality);
    callback(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// jsdom omits these browser methods; create configurable stubs for spyOn.
Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "" });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });

const photo = (name = "capture.png", type = "image/png") => new File(["source"], name, { type });

describe("mobile photo preparation contract", () => {
  it.each([
    [2560, 1920, 1280, 960], [1920, 2560, 960, 1280],
    [640, 480, 640, 480], [1280, 1280, 1280, 1280],
    [3000, 1, 1280, 1], [1, 3000, 1, 1280],
  ])("resizes %i × %i to %i × %i without upscaling", async (width, height, expectedWidth, expectedHeight) => {
    dimensions = [width, height];
    const result = await buildPhotoAttachment(photo());
    expect([result.width, result.height]).toEqual([expectedWidth, expectedHeight]);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, expectedWidth, expectedHeight);
    expect(jpeg).toHaveBeenCalledWith(expectedWidth, expectedHeight, "image/jpeg", 0.72);
  });

  it("returns the original filename, JPEG bytes, size and capture metadata", async () => {
    const result = await buildPhotoAttachment(photo());
    expect(result).toMatchObject({ name: "capture.png", dataUrl: "data:image/jpeg;base64,anBlZw==", contentType: "image/jpeg", sizeBytes: 4 });
    expect(result.id).toMatch(/^photo-\d+-[a-z0-9]+$/);
    expect(Number.isFinite(Date.parse(result.capturedAt))).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:prepared-photo");
  });

  it("keeps the existing fallback for an unnamed photo", async () => {
    expect((await buildPhotoAttachment(photo(""))).name).toBe("Step photo.jpg");
  });

  it("rejects a non-image before creating a browser resource", async () => {
    await expect(buildPhotoAttachment(photo("notes.txt", "text/plain"))).rejects.toThrow("notes.txt is not an image.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("revokes the object URL even when image decoding fails", async () => {
    imageFails = true;
    await expect(buildPhotoAttachment(photo())).rejects.toThrow("Unable to read capture.png.");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:prepared-photo");
    expect(jpeg).not.toHaveBeenCalled();
  });

  it("rejects a missing canvas context after releasing the decoded image URL", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(buildPhotoAttachment(photo())).rejects.toThrow("Unable to prepare photo compression.");
    expect(revoke).toHaveBeenCalledOnce();
    expect(jpeg).not.toHaveBeenCalled();
  });

  it("rejects a failed JPEG encoding with the existing message", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
    await expect(buildPhotoAttachment(photo())).rejects.toThrow("Unable to compress photo.");
    expect(canvasSize).toEqual([1280, 960]);
  });

  it("propagates FileReader failure without reporting a usable attachment", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => this.onerror?.(new ProgressEvent("error") as never));
    });
    await expect(buildPhotoAttachment(photo())).rejects.toThrow("Unable to read compressed photo.");
    expect(revoke).toHaveBeenCalledOnce();
  });
});
