"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** The SOP preview's continuous Letter-sheet presentation, for generated PDF bytes. */
export function DocumentPdfPages({ blob, name }: { blob: Blob; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    setPdf(null); setError("");
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      task = pdfjs.getDocument({ data });
      const document = await task.promise;
      if (active) setPdf(document);
    })().catch(() => { if (active) setError("Could not display this PDF. Close the preview and reopen it to retry."); });
    return () => { active = false; void task?.destroy(); };
  }, [blob]);
  return (
    <div className="document-preview-scroll" aria-label="Document pages">
      {error ? <p role="alert" className="mx-auto max-w-3xl bg-white p-4 text-danger">{error}</p> : null}
      {!pdf && !error ? <p role="status" className="text-center text-white">Preparing document…</p> : null}
      <div className="document-preview-pages">
        {pdf ? Array.from({ length: pdf.numPages }, (_, index) => <PdfSheet key={index} pdf={pdf} pageNumber={index + 1} name={name} />) : null}
      </div>
    </div>
  );
}

function PdfSheet({ pdf, pageNumber, name }: { pdf: PDFDocumentProxy; pageNumber: number; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (!active || !ref.current) return;
      const canvas = ref.current;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const viewport = page.getViewport({ scale: 8 / 3 });
      canvas.width = viewport.width; canvas.height = viewport.height;
      render = page.render({ canvas, canvasContext: context, viewport });
      await render.promise;
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; render?.cancel(); };
  }, [pdf, pageNumber]);
  return error ? <p role="alert" className="bg-white p-4 text-danger">Page {pageNumber} could not be displayed. Reopen the preview to retry.</p> :
    <canvas ref={ref} role="img" aria-label={`${name}, page ${pageNumber} of ${pdf.numPages}`} className="document-preview-pdf-sheet" />;
}
