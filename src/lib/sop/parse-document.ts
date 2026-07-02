/**
 * Server-side preparation of uploaded legacy SOP files for conversion.
 *
 * Runs in the Node runtime (see the API route). `.docx` is converted to HTML with
 * mammoth (HTML preserves table/list structure that raw text flattens) and its
 * embedded images — usually THE process flowchart in legacy SOPs — are collected
 * as base64 blocks to ride along in the Claude message. `.pdf` is handed to Claude
 * as a base64 document block so the model reads (and OCRs) the pages itself. We
 * deliberately do NOT use pdf.js here: it references `DOMMatrix`, a browser global
 * that doesn't exist in Node, which crashed every PDF conversion with "DOMMatrix is
 * not defined". Letting Claude read the PDF also makes scanned/image-only SOPs work,
 * which pdf.js text extraction never could.
 */

/** Image content types the Claude API accepts as image blocks. */
export type DocxImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SUPPORTED_IMAGE_TYPES: readonly DocxImageMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

/** At most this many embedded images are attached to the Claude message. */
const MAX_DOCX_IMAGES = 6;

/** Combined base64 budget across all attached images (~15 MB of payload). */
const MAX_IMAGE_PAYLOAD_CHARS = 15 * 1024 * 1024;

/** One embedded image lifted out of the .docx, ready for a Claude image block. */
export interface DocxEmbeddedImage {
  mediaType: DocxImageMediaType;
  base64: string;
}

/** What happened to the document's embedded images (surfaced instead of console noise). */
export interface DocxImageMeta {
  /** Images attached to the Claude message. */
  attached: number;
  /** Images dropped because the API doesn't accept their content type (e.g. EMF/TIFF). */
  skippedUnsupportedType: number;
  /** Images dropped by the count or combined-payload caps. */
  skippedOverBudget: number;
}

export interface DocxContent {
  /** HTML rendering of the document body (tables/lists preserved; Claude reads HTML fine). */
  html: string;
  images: DocxEmbeddedImage[];
  imageMeta: DocxImageMeta;
}

/**
 * Convert a .docx buffer to HTML and collect its embedded images. The images are NOT
 * inlined as data URIs — each `<img>` keeps a small placeholder `src` marking where it
 * sat in the document, and the binary rides separately as base64 for image blocks.
 */
export async function extractDocxContent(buffer: Buffer): Promise<DocxContent> {
  const mammoth = await import("mammoth");

  const images: DocxEmbeddedImage[] = [];
  let skippedUnsupportedType = 0;
  let skippedOverBudget = 0;
  let payloadChars = 0;

  const { value } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const mediaType = SUPPORTED_IMAGE_TYPES.find((type) => type === image.contentType);
        if (!mediaType) {
          skippedUnsupportedType += 1;
          return { src: "embedded-image-unsupported" };
        }
        const base64 = await image.readAsBase64String();
        if (images.length >= MAX_DOCX_IMAGES || payloadChars + base64.length > MAX_IMAGE_PAYLOAD_CHARS) {
          skippedOverBudget += 1;
          return { src: "embedded-image-omitted" };
        }
        payloadChars += base64.length;
        images.push({ mediaType, base64 });
        return { src: `embedded-image-${images.length}` };
      }),
    },
  );

  return {
    html: value.trim(),
    images,
    imageMeta: { attached: images.length, skippedUnsupportedType, skippedOverBudget },
  };
}

export type SopUploadKind = "docx" | "pdf";

export function detectUploadKind(fileName: string): SopUploadKind | null {
  if (/\.docx$/i.test(fileName)) return "docx";
  if (/\.pdf$/i.test(fileName)) return "pdf";
  return null;
}

/**
 * Upload content prepared for a Claude user message:
 * - `docx` → HTML text sent inline, plus embedded images for image blocks
 * - `pdf`  → base64 of the original file, sent as a document block (Claude reads it)
 */
export type PreparedSopUpload =
  | { kind: "docx"; text: string; images: DocxEmbeddedImage[]; imageMeta: DocxImageMeta }
  | { kind: "pdf"; base64: string };

export async function prepareSopUpload(file: File): Promise<PreparedSopUpload> {
  const kind = detectUploadKind(file.name);
  if (!kind) {
    throw new Error("Unsupported file type. Upload a .docx or .pdf SOP.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (kind === "docx") {
    const { html, images, imageMeta } = await extractDocxContent(buffer);
    if (!html && images.length === 0) {
      throw new Error("No readable content was found in the uploaded file.");
    }
    return { kind, text: html, images, imageMeta };
  }

  // PDFs go straight to Claude as a document block -- no server-side text extraction,
  // so scanned/image PDFs convert too.
  return { kind, base64: buffer.toString("base64") };
}
