"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { Download } from "lucide-react";
import { createPortal } from "react-dom";
import { DocumentPdfPages } from "@/components/sop/document-pdf-pages";
import { DocumentPreviewToolbar } from "@/components/sop/document-preview-toolbar";
import type { QualityWi, WiRevision } from "@/domain/quality-wi/schema";
import { wiPreviewDocument } from "@/domain/quality-wi/revision-history";
import { listWiRevisions, signWiImages } from "@/lib/quality-wi/read-store";

import { ThemedSelect } from "@/components/themed-select";
export function WiPreview({
  document,
  onClose,
}: {
  document: QualityWi;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const [revisions, setRevisions] = useState<WiRevision[]>([]);
  const [revisionDocumentId, setRevisionDocumentId] = useState<string | null>(null);
  const [selected, setSelected] = useState("draft");
  const [displayed, setDisplayed] = useState(document);
  const [displayedRevision, setDisplayedRevision] = useState("draft");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (document.publishedRevisionId)
      void listWiRevisions(document)
        .then((value) => {
          if (active) { setRevisions(value); setRevisionDocumentId(document.id); }
        })
        .catch((error) => {
          if (active) setMessage(error.message);
        });
    return () => {
      active = false;
    };
  }, [document]);
  useEffect(() => {
    let active = true;
    const revision = revisions.find((item) => item.id === selected);
    if (!revision) {
      setDisplayed(document);
      setDisplayedRevision("draft");
      return;
    }
    void signWiImages({
      ...document,
      ...revision.snapshot,
      steps: revision.steps,
    })
      .then((value) => {
        if (active) {
          setDisplayed(value);
          setDisplayedRevision(selected);
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [document, revisions, selected]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const model = useMemo(
    () => wiPreviewDocument(document, revisions, selected),
    [revisions, selected, document],
  );
  const ready = (!document.publishedRevisionId || revisionDocumentId === document.id) &&
    (selected === "draft" || displayedRevision === selected);
  const shown = selected === "draft" ? document : displayed;
  const missingImage =
    ready && shown.steps.some((step) => step.image && !step.image.url);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBlob, setPdfBlob] = useState<Blob | undefined>();
  const [pdfVersion, setPdfVersion] = useState("");
  const [pdfError, setPdfError] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    setPdfUrl("");
    setPdfBlob(undefined);
    setPdfError("");
    if (ready && !missingImage) {
      void import("@/lib/quality-wi/export-pdf")
        .then(({ buildQualityWiPdf }) => buildQualityWiPdf(model, shown.steps))
        .then((blob) => {
          if (!active) return;
          url = URL.createObjectURL(blob);
          setPdfBlob(blob);
          setPdfVersion(selected);
          setPdfUrl(url);
        })
        .catch((error) => {
          if (active)
            setPdfError(
              error instanceof Error
                ? error.message
                : "Could not prepare this PDF.",
            );
        });
    }
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [model, shown.steps, ready, missingImage, selected]);
  const currentPdf = ready && pdfVersion === selected ? pdfUrl : "";
  function downloadPdf() {
    if (!currentPdf) return;
    const link = window.document.createElement("a");
    link.href = currentPdf;
    link.download = `${model.documentNumber.replace(/[^a-zA-Z0-9-]/g, "-")}${model.isDraft ? "-DRAFT" : ""}.pdf`;
    link.click();
  }
  async function exportWord() {
    setBusy(true);
    setMessage("");
    try {
      const { exportQualityWiWord } =
        await import("@/lib/quality-wi/export-word");
      await exportQualityWiWord(model, shown.steps);
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
        <ThemedSelect
          ariaLabel="Preview version"
          value={selected}
          onChange={setSelected}
          options={[
            { value: "draft", label: "Working draft" },
            ...revisions.map((item) => ({
              value: item.id,
              label: `Published revision ${item.snapshot.revision}`,
            })),
          ]}
        />
        <button
          className="ui-btn-ghost h-8 gap-1.5 px-3"
          disabled={busy || !ready || missingImage}
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
      {missingImage ? (
        <p role="alert" className="ui-notice ui-notice-warn p-3">
          A saved image is unavailable. Reopen the preview to retry before
          exporting.
        </p>
      ) : null}
      {!ready ? (
        <p role="status" className="p-3">
          Loading published images…
        </p>
      ) : null}
      {message ? (
        <p className="ui-notice ui-notice-warn p-3" role="alert">
          {message}
        </p>
      ) : null}
      {pdfError ? (
        <p role="alert" className="ui-notice ui-notice-warn p-3">
          {pdfError}
        </p>
      ) : null}
      {!currentPdf && ready && !missingImage && !pdfError ? (
        <p role="status" className="p-3">
          Preparing PDF…
        </p>
      ) : null}
      {currentPdf && pdfBlob ? <DocumentPdfPages key={currentPdf} blob={pdfBlob} name={model.title || "Untitled work instruction"} /> : null}
    </dialog>,
    window.document.body,
  );
}
