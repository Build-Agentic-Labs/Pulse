/**
 * Server-side text extraction from uploaded legacy SOP files.
 *
 * Runs in the Node runtime (see the API route) so pdf.js and mammoth don't have
 * to ship to the browser and we avoid pdf.js worker setup on the client.
 */

/** Extract raw text from a .docx buffer. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

/** Extract text from a PDF, one page per block. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  // Legacy build runs in Node without a separate worker thread.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;

  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        pages.push(text);
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join("\n\n");
}

export type SopUploadKind = "docx" | "pdf";

export function detectUploadKind(fileName: string): SopUploadKind | null {
  if (/\.docx$/i.test(fileName)) return "docx";
  if (/\.pdf$/i.test(fileName)) return "pdf";
  return null;
}

/** Extract text from an uploaded file based on its extension. */
export async function extractUploadText(file: File): Promise<{ kind: SopUploadKind; text: string }> {
  const kind = detectUploadKind(file.name);
  if (!kind) {
    throw new Error("Unsupported file type. Upload a .docx or .pdf SOP.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = kind === "docx" ? await extractDocxText(buffer) : await extractPdfText(new Uint8Array(buffer));
  if (!text) {
    throw new Error("No readable text was found in the uploaded file.");
  }
  return { kind, text };
}
