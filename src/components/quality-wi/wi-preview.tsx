"use client";
import { useEffect, useState, useRef } from "react";
import { Download } from "lucide-react";
import { createPortal } from "react-dom";
import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
import { DocumentPreviewStatus } from "@/components/sop/document-preview-status";
import { DocumentPdfPages } from "@/components/sop/document-pdf-pages";
import { DocumentPreviewToolbar } from "@/components/sop/document-preview-toolbar";
import type { QualityWi, WiRevision } from "@/domain/quality-wi/schema";
import { wiPreviewDocument } from "@/domain/quality-wi/revision-history";
import { listWiRevisions, signWiImages } from "@/lib/quality-wi/read-store";

import { ThemedSelect } from "@/components/themed-select";
export function WiPreview({
  document,
  onClose,
  publishedOnly = false,
  onEdit,
}: {
  document: QualityWi;
  onClose: () => void;
  publishedOnly?: boolean;
  onEdit?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const [selected, setSelected] = useState(publishedOnly ? document.publishedRevisionId ?? "" : "draft");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{
    source: QualityWi;
    selected: string;
    attempt: number;
    phase: "loading" | "ready" | "error";
    detail: string;
    revisions: WiRevision[];
    model?: GeneralWorkInstruction;
    steps?: QualityWi["steps"];
    blob?: Blob;
    url?: string;
  }>({ source: document, selected, attempt: 0, phase: "loading", detail: "Preparing the document…", revisions: [] });

  useEffect(() => {
    let active = true;
    let url = "";
    const start = { source: document, selected, attempt: retry, revisions: [] as WiRevision[] };
    setPreview(current => ({ ...start, revisions: current.source === document ? current.revisions : [], phase: "loading", detail: document.publishedRevisionId ? "Loading published revisions…" : "Loading document images…" }));
    setMessage("");
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setPreview(current => ({ ...current, phase: "error", detail: "The preview took too long to load. Check your connection and try again." }));
    }, 120_000);
    void (async () => {
      const revisions = document.publishedRevisionId ? await listWiRevisions(document) : [];
      if (!active) return;
      const revision = revisions.find(item => item.id === selected);
      if (selected !== "draft" && !revision)
        throw new Error("This published revision is unavailable. Try again or ask the document owner to check it.");
      setPreview({ ...start, revisions, phase: "loading", detail: "Loading document images…" });
      // Refresh private image links even for a draft left open past their expiry.
      const shown = await signWiImages(revision ? { ...document, ...revision.snapshot, steps: revision.steps } : document);
      if (!active) return;
      if (shown.steps.some(step => step.showPhoto !== false && step.image && !step.image.url))
        throw new Error("A saved image is unavailable. Try again before exporting this document.");
      const model = wiPreviewDocument(document, revisions, selected);
      setPreview({ ...start, revisions, model, steps: shown.steps, phase: "loading", detail: "Preparing document pages…" });
      const { buildQualityWiPdf } = await import("@/lib/quality-wi/export-pdf");
      if (!active) return;
      const blob = await buildQualityWiPdf(model, shown.steps);
      if (!active) return;
      url = URL.createObjectURL(blob);
      window.clearTimeout(timeout);
      setPreview({ ...start, revisions, phase: "ready", detail: "", model, steps: shown.steps, blob, url });
    })().catch(error => {
      if (!active) return;
      window.clearTimeout(timeout);
      setPreview(current => ({ ...current, phase: "error", detail: error instanceof Error ? error.message : "Could not load this work instruction preview." }));
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (url) URL.revokeObjectURL(url);
    };
  }, [document, selected, retry]);
  const current = preview.source === document && preview.selected === selected && preview.attempt === retry;
  const ready = current && preview.phase === "ready";
  const canExportWord = current && !!preview.model && !!preview.steps;
  const model = current && preview.model ? preview.model : wiPreviewDocument(document, [], selected);
  const revisions = preview.source === document ? preview.revisions : [];
  const currentPdf = ready ? preview.url ?? "" : "";
  function downloadPdf() {
    if (!currentPdf) return;
    const link = window.document.createElement("a");
    link.href = currentPdf;
    link.download = `${model.documentNumber.replace(/[^a-zA-Z0-9-]/g, "-")}${model.isDraft ? "-DRAFT" : ""}.pdf`;
    link.click();
  }
  async function exportWord() {
    if (!canExportWord) return;
    setBusy(true);
    setMessage("");
    try {
      const { exportQualityWiWord } =
        await import("@/lib/quality-wi/export-word");
      await exportQualityWiWord(model, preview.steps ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not export the document.",
      );
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="quality-wi-preview fixed inset-0 m-0 h-[100dvh] w-screen max-h-none max-w-none border-0 flex flex-col bg-[#696b6d] p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Work instruction preview"
    >
      <DocumentPreviewToolbar onClose={onClose} actions={<>
        {onEdit ? <button type="button" className="ui-btn-ghost h-8 px-3" onClick={onEdit}>Open builder</button> : null}
        <ThemedSelect
          ariaLabel="Preview version"
          value={selected}
          onChange={setSelected}
          options={[
            ...(!publishedOnly ? [{ value: "draft", label: "Working draft" }] : []),
            ...revisions.map((item) => ({
              value: item.id,
              label: `Published revision ${item.snapshot.revision}`,
            })),
          ]}
        />
        <button
          className="ui-btn-ghost h-8 gap-1.5 px-3"
          disabled={busy || !canExportWord}
          onClick={() => void exportWord()}
        >
          <Download size={14} /> {busy ? "Preparing…" : "Word"}
        </button>
        <button
          type="button"
          className="ui-btn-ghost h-8 gap-1.5 px-3"
          disabled={!currentPdf}
          onClick={downloadPdf}
        >
          <Download size={14} /> PDF
        </button>
      </>}>
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink" title={`${model.documentNumber} — ${model.title}`}>
          {model.documentNumber} — {model.title || "Untitled work instruction"}
        </span>
      </DocumentPreviewToolbar>
      {message ? <p className="ui-notice ui-notice-warn p-3" role="alert">{message}</p> : null}
      {current && preview.phase === "error" ? (
        <div className="mx-auto my-12 max-w-xl rounded bg-white p-6 text-center text-ink">
          <p role="alert" className="text-sm">{preview.detail}</p>
          <button type="button" className="ui-btn-secondary mt-4 h-9 px-4" onClick={() => setRetry(value => value + 1)}>Retry preview</button>
        </div>
      ) : !ready ? <DocumentPreviewStatus detail={current ? preview.detail : "Preparing the document…"} /> : null}
      {ready && preview.blob ? <DocumentPdfPages key={currentPdf} blob={preview.blob} name={model.title || "Untitled work instruction"} /> : null}
    </dialog>,
    window.document.body,
  );
}
