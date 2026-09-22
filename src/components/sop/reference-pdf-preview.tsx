"use client";

import { ArrowLeft, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Shared by reference links in the editor and the SOP print preview. */
export function ReferencePdfPreview({ name, url, onClose }: {
  name: string;
  url: string;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const backRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(1000);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const changeZoom = useCallback((requested: number, pointer?: { x: number; y: number }) => {
    const next = Math.min(4, Math.max(0.5, requested));
    const container = scrollRef.current;
    const canvas = canvasRef.current;
    if (container && canvas && canvas.style.width) {
      const view = container.getBoundingClientRect();
      const before = canvas.getBoundingClientRect();
      const x = pointer?.x ?? view.left + container.clientWidth / 2;
      const y = pointer?.y ?? view.top + container.clientHeight / 2;
      const fractionX = (x - before.left) / before.width;
      const fractionY = (y - before.top) / before.height;
      const ratio = next / zoomRef.current;
      // Immediate visual feedback while PDF.js redraws the vector content.
      canvas.style.width = `${before.width * ratio}px`;
      canvas.style.height = `${before.height * ratio}px`;
      const after = canvas.getBoundingClientRect();
      container.scrollLeft += after.left + fractionX * after.width - x;
      container.scrollTop += after.top + fractionY * after.height - y;
    }
    zoomRef.current = next;
    setZoom(next);
  }, []);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => {
      // Zoom directly over the document. Shift+wheel remains available for
      // scrolling; trackpad pinch (Ctrl+wheel) uses the same anchored zoom.
      if (event.shiftKey) return;
      event.preventDefault();
      if (!event.deltaY) return;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1);
      changeZoom(zoomRef.current * Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.002), { x: event.clientX, y: event.clientY });
    };
    container.addEventListener("wheel", wheel, { passive: false });
    return () => container.removeEventListener("wheel", wheel);
  }, [changeZoom]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setAvailableWidth(Math.max(160, container.clientWidth - 32)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setPdf(null);
    setPageNumber(1);
    setZoom(1);
    zoomRef.current = 1;
    setError("");
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load this PDF. Close the preview and reopen it to try again.");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        task = pdfjs.getDocument({ data });
        const document = await task.promise;
        if (active) setPdf(document);
      } catch {
        if (active) {
          setError("Could not display this PDF. Close the preview and reopen it to try again.");
          setLoading(false);
        }
      }
    })();
    return () => { active = false; controller.abort(); void task?.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (!active || !canvasRef.current) return;
        // Render offscreen so a cancelled zoom cannot overwrite the newer page.
        const canvas = document.createElement("canvas");
        const base = page.getViewport({ scale: 1 });
        const display = page.getViewport({ scale: availableWidth * zoom / base.width });
        // Supersample text and vectors, including on high-DPI displays. Bound
        // memory for very large engineering sheets rather than exhausting it.
        const density = Math.min(
          Math.max(2, window.devicePixelRatio || 1),
          8192 / Math.max(display.width, display.height),
          Math.sqrt(32_000_000 / (display.width * display.height)),
        );
        const viewport = page.getViewport({ scale: display.scale * density });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        render = page.render({ canvas, viewport });
        await render.promise;
        if (active && canvasRef.current) {
          const visible = canvasRef.current;
          visible.width = canvas.width;
          visible.height = canvas.height;
          visible.style.width = `${display.width}px`;
          visible.style.height = `${display.height}px`;
          visible.getContext("2d")?.drawImage(canvas, 0, 0);
          setLoading(false);
        }
      } catch {
        if (active) { setError("Could not render this page."); setLoading(false); }
      }
    })();
    return () => { active = false; render?.cancel(); };
  }, [pdf, pageNumber, zoom, availableWidth]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    backRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 print:hidden" role="dialog" aria-modal="true" aria-label={`Referenced document ${name}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex h-full max-h-[960px] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2">
          <button ref={backRef} type="button" className="ui-btn-ghost inline-flex h-9 items-center gap-1.5 px-3" onClick={onClose}>
            <ArrowLeft size={15} /> Back
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={name}>{name}</span>
          <div className="flex items-center gap-1 rounded-md border border-line bg-surface-muted px-1 text-xs text-ink" role="group" aria-label="PDF zoom" title="Scroll over the PDF to zoom. Shift + scroll to move around the page.">
            <button type="button" className="ui-btn-ghost inline-flex h-9 items-center gap-1.5 px-2" aria-label="Zoom out" disabled={!pdf || zoom <= 0.5} onClick={() => changeZoom(zoomRef.current / 1.25)}><Minus size={16} /> Zoom out</button>
            <span className="w-12 text-center tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="ui-btn-ghost inline-flex h-9 items-center gap-1.5 px-2" aria-label="Zoom in" disabled={!pdf || zoom >= 4} onClick={() => changeZoom(zoomRef.current * 1.25)}><Plus size={16} /> Zoom in</button>
            <button type="button" className="ui-btn-ghost h-9 px-2" disabled={!pdf} onClick={() => { changeZoom(1); scrollRef.current?.scrollTo({ top: 0, left: 0 }); }}>Fit width</button>
          </div>
          {pdf ? <div className="flex items-center gap-2 text-xs text-ink-secondary">
            <button type="button" className="ui-btn-ghost h-9 px-2" disabled={loading || pageNumber === 1} onClick={() => setPageNumber((page) => page - 1)} aria-label="Previous PDF page">Previous</button>
            <span aria-live="polite">{pageNumber} / {pdf.numPages}</span>
            <button type="button" className="ui-btn-ghost h-9 px-2" disabled={loading || pageNumber === pdf.numPages} onClick={() => setPageNumber((page) => page + 1)} aria-label="Next PDF page">Next</button>
          </div> : null}
          <button type="button" className="ui-btn-ghost h-9 w-9 px-0" onClick={onClose} aria-label="Close referenced document">
            <X size={16} className="mx-auto" />
          </button>
        </header>
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-surface-muted p-4" aria-busy={loading}>
          {loading ? <p role="status" className="pointer-events-none absolute left-4 top-4 rounded bg-surface px-3 py-2 text-sm text-ink-secondary shadow">Loading PDF…</p> : null}
          {error ? <p role="alert" className="py-4 text-center text-sm text-danger">{error}</p> : null}
          <canvas ref={canvasRef} aria-label={`${name}, page ${pageNumber}`} className={`mx-auto max-w-none bg-white shadow ${error ? "hidden" : "block"}`} />
        </div>
      </section>
    </div>
  );
}
