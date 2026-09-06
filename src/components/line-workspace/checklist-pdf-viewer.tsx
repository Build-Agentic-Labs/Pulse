"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Minus, Plus, X } from "lucide-react";

export function ChecklistPdfViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitZoom, setFitZoom] = useState(75);
  const displayZoom = zoom ?? fitZoom;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      setFitZoom(Math.max(10, Math.min(100, Math.floor(Math.min((viewport.clientWidth - 48) / 816, (viewport.clientHeight - 48) / 1056) * 100))));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const controller = new AbortController();
    async function render() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("PDF unavailable");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ data });
        destroy = () => { void task.destroy(); };
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        if (cancelled || !canvas.current) return;
        const viewport = page.getViewport({ scale: 2.5 });
        const target = canvas.current;
        target.width = viewport.width; target.height = viewport.height;
        await page.render({ canvas: target, viewport }).promise;
        if (!cancelled) setReady(true);
      } catch { if (!cancelled) setError(true); }
    }
    void render();
    return () => { cancelled = true; controller.abort(); destroy?.(); };
  }, [url]);
  return createPortal(
    <dialog ref={dialog} onCancel={onClose} aria-label={`${title} document preview`} className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-canvas p-0 text-ink backdrop:bg-ink/30">
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-5 py-3">
          <div><h2 className="text-sm font-medium">{title}</h2><p className="mt-0.5 text-[11px] text-ink-tertiary">ANA · Draft template · Letter 8.5 × 11 in · Page 1 of 1</p></div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Zoom out" className="ui-btn-ghost h-8 w-8 p-0" disabled={displayZoom <= 20} onClick={() => setZoom(Math.max(20, displayZoom - 10))}><Minus size={14} /></button>
            <span className="w-10 text-center text-xs tabular-nums">{displayZoom}%</span>
            <button type="button" aria-label="Zoom in" className="ui-btn-ghost h-8 w-8 p-0" disabled={displayZoom >= 160} onClick={() => setZoom(Math.min(160, displayZoom + 10))}><Plus size={14} /></button>
            <button type="button" className="ui-btn-ghost h-8 px-2 text-xs" onClick={() => setZoom(null)}>Fit page</button>
            <a href={url} download className="ui-btn-ghost h-8 gap-2 px-3 text-xs"><Download size={14} />Download PDF</a>
            <button type="button" aria-label="Close preview" className="ui-btn-ghost h-8 w-8 p-0" onClick={onClose}><X size={18} /></button>
          </div>
        </header>
        <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6">
          {error ? <p role="alert" className="text-center text-sm">Preview could not load. You can still download the PDF above.</p> : <>
            {!ready ? <p role="status" className="text-center text-xs text-ink-secondary">Loading document…</p> : null}
            <div style={{ width: `${displayZoom * 8.16}px` }} className="mx-auto bg-white shadow-lg">
              <canvas ref={canvas} role="img" aria-label={`${title}, blank ANA checklist with operator and QC signature columns`} className="block h-auto w-full" style={{ display: ready ? "block" : "none" }} />
            </div>
          </>}
        </div>
      </div>
    </dialog>, document.body,
  );
}
