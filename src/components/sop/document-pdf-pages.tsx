"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentPreviewStatus } from "./document-preview-status";

/** The SOP preview's continuous Letter-sheet presentation, for generated PDF bytes. */
export function DocumentPdfPages({ blob, name }: { blob: Blob; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    setPdf(null); setError("");
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setError("The document viewer took too long to load. Try again or download the PDF from the toolbar.");
      void task?.destroy();
    }, 45_000);
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      task = pdfjs.getDocument({ data });
      const document = await task.promise;
      if (active) { window.clearTimeout(timeout); setPdf(document); }
    })().catch(() => {
      if (active) {
        window.clearTimeout(timeout);
        setError("Could not display this PDF. Try again or download the PDF from the toolbar.");
      }
    });
    return () => { active = false; window.clearTimeout(timeout); void task?.destroy(); };
  }, [blob, retry]);
  return (
    <div className="document-preview-scroll" aria-label="Document pages">
      {error ? <div className="mx-auto max-w-xl rounded bg-white p-6 text-center text-ink">
        <p role="alert" className="text-sm">{error}</p>
        <button type="button" className="ui-btn-secondary mt-4 h-9 px-4" onClick={() => setRetry(value => value + 1)}>Retry document</button>
      </div> : null}
      {!pdf && !error ? <DocumentPreviewStatus detail="Opening the document viewer…" /> : null}
      <div className="document-preview-pages">
        {pdf ? Array.from({ length: pdf.numPages }, (_, index) => <PdfSheet key={`${retry}:${index}`} pdf={pdf} pageNumber={index + 1} name={name} />) : null}
      </div>
    </div>
  );
}

function PdfSheet({ pdf, pageNumber, name }: { pdf: PDFDocumentProxy; pageNumber: number; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber === 1);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (nearViewport) return;
    if (!sheetRef.current || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    // Render nearby pages rather than allocating every full-resolution canvas at once.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { root: sheetRef.current.closest(".document-preview-scroll"), rootMargin: "700px" });
    observer.observe(sheetRef.current);
    return () => observer.disconnect();
  }, [nearViewport]);
  useEffect(() => {
    if (!nearViewport) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setPhase("loading");
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      render?.cancel();
      setPhase("error");
    }, 45_000);
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
      if (active) { window.clearTimeout(timeout); setPhase("ready"); }
    })().catch(() => {
      if (active) { window.clearTimeout(timeout); setPhase("error"); }
    });
    const canvas = ref.current;
    return () => {
      active = false; window.clearTimeout(timeout); render?.cancel();
      // Defer release until cancellation has settled, before a retry renders again.
      void render?.promise.catch(() => {}).then(() => { if (canvas && !canvas.isConnected) { canvas.width = 0; canvas.height = 0; } });
    };
  }, [pdf, pageNumber, nearViewport, retry]);
  return <section ref={sheetRef} className="document-preview-pdf-sheet relative" aria-busy={phase === "loading" && nearViewport}>
    <canvas ref={ref} role={phase === "ready" ? "img" : undefined} aria-hidden={phase !== "ready"} aria-label={`${name}, page ${pageNumber} of ${pdf.numPages}`} className={`block h-auto w-full${phase !== "ready" ? " invisible" : ""}`} />
    {phase === "error" ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-ink">
      <p role="alert" className="text-sm">Page {pageNumber} could not be displayed.</p>
      <button type="button" className="ui-btn-secondary h-9 px-4" onClick={() => setRetry(value => value + 1)}>Retry page {pageNumber}</button>
    </div> : phase === "loading" ? <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-ink-secondary" role={nearViewport ? "status" : undefined}>
      {nearViewport ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {nearViewport ? `Rendering page ${pageNumber}…` : `Page ${pageNumber}`}
    </div> : null}
  </section>;
}
