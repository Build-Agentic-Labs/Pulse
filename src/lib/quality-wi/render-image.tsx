import { dataUrlToBlob } from "@/lib/planner/media-storage";
import { nativeSvgText } from "./svg-text";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WiImage } from "@/domain/quality-wi/schema";
import { WiImageView } from "@/components/quality-wi/wi-image-view";
import { readBlobAsDataUrl } from "@/components/mobile-photo-portal/recovery-draft-store";
export async function fetchWiImageBlob(url: string) {
  if (url.startsWith("data:image/")) return dataUrlToBlob(url);
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      "A document image could not be loaded. Try opening the preview again.",
    );
  return response.blob();
}
/** Render the same annotation scene used by the preview into real PNG bytes for Word. */
export async function wiImageToPng(image: WiImage) {
  if (!image.url) throw new Error("A document image is unavailable.");
  const url = await readBlobAsDataUrl(await fetchWiImageBlob(image.url));
  const svg = nativeSvgText(
    renderToStaticMarkup(
      createElement(WiImageView, { image: { ...image, url } }),
    ),
  );
  const source = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml" }),
  );
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("Could not render a document image."));
      img.src = source;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image export is unavailable in this browser.");
    context.drawImage(element, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Could not export the image.")),
        "image/png",
      ),
    );
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width: image.width,
      height: image.height,
    };
  } finally {
    URL.revokeObjectURL(source);
  }
}
