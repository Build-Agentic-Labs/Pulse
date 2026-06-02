/**
 * Server-side preparation of uploaded legacy SOP files for conversion.
 *
 * Runs in the Node runtime (see the API route). `.docx` is converted to text with
 * mammoth; `.pdf` is handed to Claude as a base64 document block so the model reads
 * (and OCRs) the pages itself. We deliberately do NOT use pdf.js here: it references
 * `DOMMatrix`, a browser global that doesn't exist in Node, which crashed every PDF
 * conversion with "DOMMatrix is not defined". Letting Claude read the PDF also makes
 * scanned/image-only SOPs work, which pdf.js text extraction never could.
 */

/** Extract raw text from a .docx buffer. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

export type SopUploadKind = "docx" | "pdf";

export function detectUploadKind(fileName: string): SopUploadKind | null {
  if (/\.docx$/i.test(fileName)) return "docx";
  if (/\.pdf$/i.test(fileName)) return "pdf";
  return null;
}

/**
 * Upload content prepared for a Claude user message:
 * - `docx` → extracted text, sent inline
 * - `pdf`  → base64 of the original file, sent as a document block (Claude reads it)
 */
export type PreparedSopUpload =
  | { kind: "docx"; text: string }
  | { kind: "pdf"; base64: string };

export async function prepareSopUpload(file: File): Promise<PreparedSopUpload> {
  const kind = detectUploadKind(file.name);
  if (!kind) {
    throw new Error("Unsupported file type. Upload a .docx or .pdf SOP.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (kind === "docx") {
    const text = await extractDocxText(buffer);
    if (!text) {
      throw new Error("No readable text was found in the uploaded file.");
    }
    return { kind, text };
  }

  // PDFs go straight to Claude as a document block -- no server-side text extraction,
  // so scanned/image PDFs convert too.
  return { kind, base64: buffer.toString("base64") };
}
