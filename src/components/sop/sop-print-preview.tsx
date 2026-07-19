"use client";

import { Printer, X } from "lucide-react";
import { formatDateControlled, formatDateTime } from "@/domain/formatting";
import NextImage from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { rasicLegend, type Sop } from "@/domain/sop/schema";
import {
  SIGNATURE_VIEWBOX_HEIGHT,
  SIGNATURE_VIEWBOX_WIDTH,
  signatureStrokePath,
  type SignatureStrokes,
} from "@/domain/sop/signature";
import { listDepartments, listMembersForDepartments } from "@/lib/departments/store";
import { createSopAnnexFileUrl, type SopAnnexFile } from "@/lib/sop/annex-files";
import { buildProcedureSvgPages } from "@/lib/sop/procedure-flow-image";
import {
  isBlockingSeat,
  isSignatureCurrent,
  listProfileNames,
  listSeats,
  listSignatures,
  getSopAuthorDisplayName,
  getSopControl,
  type SopRasic,
} from "@/lib/sop/review";
import type { SopReviewAnnotation } from "@/lib/sop/review-annotations";

interface RenderedAnnexPage {
  fileId: string;
  annexId: string;
  fileName: string;
  sourcePage: number;
  sourcePageCount: number;
  url: string;
}

interface AnnexPreviewState {
  loading: boolean;
  pages: RenderedAnnexPage[];
  errors: Record<string, string>;
}

interface ApprovalSignatureEntry {
  key: string;
  approval: string;
  name: string;
  position: string;
  signedAt: string | null;
  signatureStrokes: SignatureStrokes;
}

const APPROVAL_RASIC_LABELS: Record<SopRasic, string> = {
  responsible: "Responsible department approval",
  accountable: "Accountable department approval",
  support: "Support review",
  consulted: "Consulted review",
  informed: "Information only",
};

function isPdf(file: SopAnnexFile): boolean {
  return file.contentType === "application/pdf" || file.originalName.toLowerCase().endsWith(".pdf");
}

function isImage(file: SopAnnexFile): boolean {
  return file.contentType.startsWith("image/");
}


function DocumentHeader({ sop, reviewCategory }: { sop: Sop; reviewCategory?: string }) {
  return (
    <header className="sop-export-header" data-review-category={reviewCategory}>
      <div className="sop-export-header-main">
        <NextImage src="/sop/ana-logo.png" alt="ANA Inc." width={150} height={42} />
        <div>{`${sop.meta.sopNumber || "SOP-QA-00X"}: ${sop.meta.title || ""}`.trim()}</div>
      </div>
      <div className="sop-export-header-info">
        <div>Version: {sop.meta.version || "1.0"}</div>
        <div>Revision date: {formatDateControlled(sop.meta.revisionDate) || "MM/DD/YY"}</div>
        <div>Effective date: {formatDateControlled(sop.meta.effectiveDate) || "MM/DD/YY"}</div>
      </div>
    </header>
  );
}

function DocumentFooter({ page, total }: { page: number; total: number }) {
  return (
    <footer className="sop-export-footer">
      <div>Page {page} / {total}</div>
      <div>ANA INC. CONFIDENTIAL: This copyrighted work and all information is the property of ANA INC. All rights reserved</div>
    </footer>
  );
}

function DocumentPage({
  sop,
  page,
  total,
  children,
  className = "",
  annotations = [],
  onAnnotate,
  onSelectAnnotation,
  headerReviewCategory,
}: {
  sop: Sop;
  page: number;
  total: number;
  children: ReactNode;
  className?: string;
  annotations?: SopReviewAnnotation[];
  onAnnotate?: (pageNumber: number, xPercent: number, yPercent: number) => void;
  onSelectAnnotation?: (annotationId: string) => void;
  headerReviewCategory?: string;
}) {
  return (
    <article
      className={`sop-print-page ${onAnnotate ? "sop-print-page-annotatable" : ""} ${className}`}
      onClick={(event) => {
        if (!onAnnotate || (event.target as HTMLElement).closest("[data-annotation-marker]")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onAnnotate(
          page,
          Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
          Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
        );
      }}
    >
      <DocumentHeader sop={sop} reviewCategory={headerReviewCategory} />
      <main className="sop-print-page-body">{children}</main>
      <DocumentFooter page={page} total={total} />
      {annotations.map((annotation, index) => (
        <button
          key={annotation.id}
          type="button"
          data-annotation-marker
          className="sop-annotation-marker"
          style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }}
          onClick={(event) => {
            event.stopPropagation();
            onSelectAnnotation?.(annotation.id);
          }}
          aria-label={`Open annotation ${index + 1} on page ${page}`}
        >
          {index + 1}
        </button>
      ))}
    </article>
  );
}


function Section({ title, children, reviewCategory }: { title: string; children: ReactNode; reviewCategory?: string }) {
  return (
    <section className="sop-export-section" data-review-category={reviewCategory}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function EmptyAwareText({ value }: { value: string }) {
  return <p className={value ? undefined : "sop-export-empty"}>{value || "—"}</p>;
}

function ApprovalTable({
  sop,
  entries,
  revealSignatureId,
}: {
  sop: Sop;
  entries: ApprovalSignatureEntry[] | null;
  revealSignatureId?: string | null;
}) {
  const rows = entries?.length
    ? entries
    : sop.approvals.map((row, index) => ({
        key: `legacy-${index}`,
        approval: row.role,
        name: row.name,
        position: row.position,
        signedAt: null,
        signatureStrokes: [],
      }));

  return (
    <table className="sop-export-table">
      <colgroup>
        <col style={{ width: "26%" }} />
        <col style={{ width: "22%" }} />
        <col style={{ width: "24%" }} />
        <col style={{ width: "28%" }} />
      </colgroup>
      <thead><tr><th>Approval</th><th>Name</th><th>Position</th><th>Signature</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            data-signature-id={row.key}
            className={row.key === revealSignatureId ? "sop-signature-reveal" : undefined}
          >
            <td>{row.approval}</td>
            <td>{row.name}</td>
            <td>{row.position}</td>
            <td>
              {row.signedAt ? (
                <span className="sop-digital-signature">
                  {row.signatureStrokes.length ? (
                    <svg
                      className="sop-handwritten-signature"
                      viewBox={`0 0 ${SIGNATURE_VIEWBOX_WIDTH} ${SIGNATURE_VIEWBOX_HEIGHT}`}
                      role="img"
                      aria-label={`${row.name} handwritten signature`}
                    >
                      {row.signatureStrokes.map((stroke, index) => (
                        <path
                          key={index}
                          d={signatureStrokePath(stroke)}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pathLength="1"
                        />
                      ))}
                    </svg>
                  ) : null}
                  <span>{formatDateTime(row.signedAt)}</span>
                </span>
              ) : (
                <span className="sop-signature-pending">Pending signature</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SopPrintPreview({
  sop,
  annexFiles,
  onClose,
  mode = "export",
  annotations = [],
  onAnnotate,
  onSelectAnnotation,
  reviewPanel,
  onReviewCategoryChange,
  approvalRefreshKey = 0,
  revealSignatureId,
}: {
  sop: Sop;
  annexFiles: SopAnnexFile[];
  onClose: () => void;
  mode?: "export" | "review" | "approval";
  annotations?: SopReviewAnnotation[];
  onAnnotate?: (pageNumber: number, xPercent: number, yPercent: number) => void;
  onSelectAnnotation?: (annotationId: string) => void;
  reviewPanel?: ReactNode;
  onReviewCategoryChange?: (category: string) => void;
  approvalRefreshKey?: number;
  revealSignatureId?: string | null;
}) {
  const [annexPreview, setAnnexPreview] = useState<AnnexPreviewState>({ loading: false, pages: [], errors: {} });
  const [approvalEntries, setApprovalEntries] = useState<ApprovalSignatureEntry[] | null>(null);
  const [systemAuthorName, setSystemAuthorName] = useState("System author");
  const reviewScrollFrame = useRef<number | null>(null);
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const canDownloadPdf = mode === "export" && sop.status === "effective";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (reviewScrollFrame.current !== null) window.cancelAnimationFrame(reviewScrollFrame.current);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      getSopControl(sop.id),
      listSeats(sop.id),
      listSignatures(sop.id),
      getSopAuthorDisplayName(sop.id),
    ])
      .then(async ([control, seats, signatures, authorDisplayName]) => {
        if (!control) return;
        const departments = await listDepartments(control.workspaceId);
        // One batched query for all departments' members instead of one per department.
        const allMembers = await listMembersForDepartments(departments.map((department) => department.id));
        const memberPositionByDepartmentAndUser = new Map<string, string>();
        allMembers.forEach((member) => {
          memberPositionByDepartmentAndUser.set(
            `${member.departmentId}:${member.userId}`,
            member.positionTitle,
          );
        });
        const profileIds = seats.flatMap((seat) => seat.signerId ? [seat.signerId] : []);
        const authorId = control.createdBy ?? control.submittedBy ?? control.finalApprovalRequestedBy;
        if (authorId) profileIds.push(authorId);
        const names = await listProfileNames(profileIds);
        const departmentById = new Map(departments.map((department) => [department.id, department]));
        const entries: ApprovalSignatureEntry[] = [];
        for (const seat of seats.filter((item) => isBlockingSeat(item.rasic))) {
          const department = departmentById.get(seat.departmentId);
          const signature = signatures.find(
            (item) =>
              item.meaning === "dept_approval" &&
              item.seatDepartmentId === seat.departmentId &&
              item.signerId === seat.signerId &&
              isSignatureCurrent(item, control),
          );
          entries.push({
            key: `seat-${seat.departmentId}`,
            approval: APPROVAL_RASIC_LABELS[seat.rasic],
            name: signature?.signerName || (seat.signerId ? names.get(seat.signerId) : "") || "Assigned approver",
            position:
              (seat.signerId
                ? memberPositionByDepartmentAndUser.get(`${seat.departmentId}:${seat.signerId}`)
                : "") ||
              (department ? `${department.code} · ${department.name}` : "Department approver"),
            signedAt: signature?.signedAt ?? null,
            signatureStrokes: signature?.signatureStrokes ?? [],
          });
        }
        const qualityApproval = signatures.find(
          (signature) => signature.meaning === "quality_approval" && isSignatureCurrent(signature, control),
        );
        const authorshipSignature = signatures.find(
          (signature) => signature.meaning === "authorship",
        );
        if (qualityApproval) {
          entries.push({
            key: qualityApproval.id,
            approval: "Quality approval",
            name: qualityApproval.signerName || "Quality approver",
            position:
              departments
                .filter((department) => department.isQualityGate)
                .map((department) => memberPositionByDepartmentAndUser.get(`${department.id}:${qualityApproval.signerId}`))
                .find(Boolean) || "Quality release",
            signedAt: qualityApproval.signedAt,
            signatureStrokes: qualityApproval.signatureStrokes,
          });
        }
        if (active) {
          setApprovalEntries(entries);
          setSystemAuthorName(
            authorDisplayName ||
              (authorId ? names.get(authorId)?.trim() : "") ||
              authorshipSignature?.signerName.trim() ||
              "System author",
          );
        }
      })
      .catch(() => {
        if (active) setApprovalEntries(null);
      });
    return () => {
      active = false;
    };
  }, [approvalRefreshKey, sop.id]);

  useEffect(() => {
    if (!revealSignatureId || !approvalEntries?.some((entry) => entry.key === revealSignatureId)) return;
    const frame = window.requestAnimationFrame(() => {
      previewRootRef.current
        ?.querySelector<HTMLElement>(`[data-signature-id="${revealSignatureId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [approvalEntries, revealSignatureId]);

  // This is the same SVG source that Export rasterizes and embeds in the Word document.
  // Reusing it here keeps flowchart shapes, pagination, columns, and RASIC assignments aligned.
  const flowPages = useMemo(
    () => (sop.procedure.activities.length ? buildProcedureSvgPages(sop) : []),
    [sop],
  );
  const annexById = useMemo(
    () => new Map(sop.annexes.flatMap((annex) => (annex.id ? [[annex.id, annex] as const] : []))),
    [sop.annexes],
  );
  const hasAttachedForms = annexFiles.length > 0;
  const totalPages = (hasAttachedForms ? 3 : 2) + flowPages.length;
  const annexSummaryPage = flowPages.length + 2;
  const controlPage = totalPages;
  const annotationsForPage = (pageNumber: number) =>
    annotations.filter((annotation) => annotation.pageNumber === pageNumber && !annotation.resolvedAt);

  function handleReviewScroll(event: UIEvent<HTMLDivElement>) {
    if (mode !== "review" || !onReviewCategoryChange) return;
    const scrollArea = event.currentTarget;
    if (reviewScrollFrame.current !== null) return;
    reviewScrollFrame.current = window.requestAnimationFrame(() => {
      reviewScrollFrame.current = null;
      const panel = document.querySelector<HTMLElement>(".sop-review-panel");
      const panelScroller = panel?.querySelector<HTMLElement>("[data-review-panel-scroll]");
      if (scrollArea.scrollTop <= 2) {
        onReviewCategoryChange("document");
        if (panel && panelScroller && panel.dataset.scrollSyncPaused !== "true") panelScroller.scrollTop = 0;
        return;
      }
      const targetLine = scrollArea.getBoundingClientRect().top + 170;
      const anchors = Array.from(
        scrollArea.querySelectorAll<HTMLElement>("[data-review-category]"),
      ).filter((anchor, index, all) =>
        index === 0 || anchor.dataset.reviewCategory !== all[index - 1]?.dataset.reviewCategory,
      );
      let activeIndex = 0;
      for (let index = 0; index < anchors.length; index += 1) {
        if (anchors[index].getBoundingClientRect().top <= targetLine) activeIndex = index;
        else break;
      }
      const active = anchors[activeIndex];
      const category = active?.dataset.reviewCategory;
      if (category) onReviewCategoryChange(category);

      if (!panel || !panelScroller || panel.dataset.scrollSyncPaused === "true" || !active || !category) return;
      const next = anchors[activeIndex + 1];
      const nextCategory = next?.dataset.reviewCategory;
      const activeField = panel.querySelector<HTMLElement>(`[data-review-field="${category}"]`);
      const nextField = nextCategory
        ? panel.querySelector<HTMLElement>(`[data-review-field="${nextCategory}"]`)
        : null;
      if (!activeField) return;

      const activeTop = active.getBoundingClientRect().top;
      const nextTop = next?.getBoundingClientRect().top ?? activeTop;
      const progress = nextTop > activeTop
        ? Math.max(0, Math.min(1, (targetLine - activeTop) / (nextTop - activeTop)))
        : 0;
      const panelRect = panelScroller.getBoundingClientRect();
      const fieldContentTop = (field: HTMLElement) =>
        panelScroller.scrollTop + field.getBoundingClientRect().top - panelRect.top;
      const start = fieldContentTop(activeField);
      const end = nextField ? fieldContentTop(nextField) : start;
      const desiredTop = start + ((end - start) * progress) - 16;
      const maximum = Math.max(0, panelScroller.scrollHeight - panelScroller.clientHeight);
      panelScroller.scrollTop = Math.max(0, Math.min(maximum, desiredTop));
    });
  }

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];

    async function renderAttachments() {
      if (!annexFiles.length) {
        setAnnexPreview({ loading: false, pages: [], errors: {} });
        return;
      }

      setAnnexPreview({ loading: true, pages: [], errors: {} });
      const pages: RenderedAnnexPage[] = [];
      const errors: Record<string, string> = {};

      for (const file of annexFiles) {
        try {
          const signedUrl = await createSopAnnexFileUrl(file);
          if (isImage(file)) {
            pages.push({
              fileId: file.id,
              annexId: file.annexId,
              fileName: file.originalName,
              sourcePage: 1,
              sourcePageCount: 1,
              url: signedUrl,
            });
            continue;
          }
          if (!isPdf(file)) {
            errors[file.id] = "This file type is attached but cannot be rendered in the PDF preview.";
            continue;
          }

          const response = await fetch(signedUrl);
          if (!response.ok) throw new Error("The attached PDF could not be downloaded for preview.");
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
          const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
          const document = await loadingTask.promise;

          try {
            for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
              const page = await document.getPage(pageNumber);
              const baseViewport = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: 1200 / baseViewport.width });
              const canvas = window.document.createElement("canvas");
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              const canvasContext = canvas.getContext("2d");
              if (!canvasContext) throw new Error("The attached PDF could not be rendered.");
              await page.render({ canvas, canvasContext, viewport }).promise;
              const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                  (value) => value ? resolve(value) : reject(new Error("The attached PDF page could not be prepared.")),
                  "image/jpeg",
                  0.92,
                ),
              );
              const objectUrl = URL.createObjectURL(blob);
              objectUrls.push(objectUrl);
              pages.push({
                fileId: file.id,
                annexId: file.annexId,
                fileName: file.originalName,
                sourcePage: pageNumber,
                sourcePageCount: document.numPages,
                url: objectUrl,
              });
              page.cleanup();
            }
          } finally {
            await loadingTask.destroy();
          }
        } catch (error) {
          errors[file.id] = error instanceof Error ? error.message : "The attached form could not be rendered.";
        }
      }

      if (active) setAnnexPreview({ loading: false, pages, errors });
    }

    void renderAttachments();
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [annexFiles]);

  return (
    <div ref={previewRootRef} className="sop-preview-overlay" role="dialog" aria-modal="true" aria-label="SOP document preview">
      <style>{`
        .sop-preview-overlay {
          position: fixed; inset: 0; z-index: 60;
          display: flex; flex-direction: column;
          background: rgba(15, 18, 21, 0.62);
          font-family: var(--font-ui-family);
        }
        .sop-preview-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 10px 16px; flex: none;
          background: var(--color-surface, #fff); border-bottom: 1px solid var(--color-line, #ddd);
        }
        .sop-preview-bar .ui-mono-label,
        .sop-review-panel .ui-mono-label {
          font-family: inherit; font-weight: 500; letter-spacing: 0; text-transform: none;
        }
        .sop-preview-overlay .ui-btn-primary,
        .sop-preview-overlay .ui-btn-ghost,
        .sop-preview-overlay .ui-chip {
          border-radius: 4px; font-family: inherit; letter-spacing: 0; text-transform: none;
        }
        .sop-preview-content { display: flex; flex: 1; min-height: 0; }
        .sop-preview-scroll { flex: 1; min-width: 0; overflow: auto; padding: 24px 16px 64px; }
        .sop-review-panel {
          width: clamp(520px, 38vw, 680px); flex: none; overflow: hidden;
          background: var(--color-surface, #fff); border-left: 1px solid var(--color-line, #ddd);
        }
        .sop-print-pages { display: grid; gap: 24px; justify-content: center; }
        .sop-print-page {
          box-sizing: border-box; width: 8.5in; min-height: 11in;
          display: flex; flex-direction: column;
          padding: 0.52in 0.75in 0.42in;
          background: #fff; color: #1a1a1a;
          box-shadow: 0 8px 40px rgba(0,0,0,0.25);
          font-family: var(--font-ui-family);
          font-size: 10pt; line-height: 1.35;
        }
        .sop-print-page-annotatable { cursor: crosshair; }
        .sop-annotation-marker {
          position: absolute; z-index: 4; width: 25px; height: 25px;
          transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 999px;
          background: #111; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.32);
          font-family: var(--font-ui-family); font-size: 10px; font-weight: 700; line-height: 21px; text-align: center; cursor: pointer;
        }
        .sop-export-header {
          flex: none; display: grid; grid-template-columns: 75% 25%;
          min-height: 1.12in; border: 1px solid #666;
        }
        .sop-export-header-main {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 7px; padding: 7px 10px; border-right: 1px solid #666;
          text-align: center; font-size: 11pt; font-weight: 700;
        }
        .sop-export-header-main img { width: 150px; height: 42px; object-fit: contain; }
        .sop-export-header-info { display: grid; grid-template-rows: repeat(3, 1fr); font-size: 8pt; }
        .sop-export-header-info > div {
          display: flex; align-items: center; padding: 3px 8px; border-bottom: 1px solid #666;
        }
        .sop-export-header-info > div:last-child { border-bottom: 0; }
        .sop-print-page-body { flex: 1; padding-top: 12px; }
        .sop-export-section { margin-top: 12px; break-inside: avoid; }
        .sop-export-section:first-child { margin-top: 0; }
        .sop-export-section h2 {
          margin: 0 0 4px; color: #1a1a1a;
          font-family: var(--font-ui-family); font-size: 12pt; font-weight: 700; line-height: 1.3;
        }
        .sop-export-section p { margin: 0 0 4px; white-space: pre-wrap; }
        .sop-export-empty { color: #666; }
        .sop-export-list { margin: 0; padding-left: 20px; }
        .sop-export-list li { margin: 0 0 2px; }
        .sop-export-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .sop-export-table th, .sop-export-table td {
          border: 1px solid #ccc; padding: 5px 7px; text-align: left; vertical-align: top;
          overflow-wrap: anywhere; white-space: pre-wrap;
        }
        .sop-export-table th { background: #f0f0f0; font-weight: 700; }
        .sop-digital-signature { display: grid; gap: 2px; color: #1d5132; }
        .sop-handwritten-signature { display: block; width: 100%; height: 56px; color: #111827; }
        .sop-signature-reveal td { animation: sop-signature-cell-reveal 1.8s ease-out both; }
        .sop-signature-reveal .sop-handwritten-signature path {
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          animation: sop-signature-draw 1.35s .2s ease-out forwards;
        }
        .sop-signature-reveal .sop-digital-signature > span {
          opacity: 0;
          animation: sop-signature-meta-reveal .35s 1.25s ease-out forwards;
        }
        .sop-digital-signature span { color: #555; font-size: 7.5pt; font-variant-numeric: tabular-nums; }
        .sop-signature-pending { color: #777; font-size: 8pt; font-style: italic; }
        @keyframes sop-signature-draw { to { stroke-dashoffset: 0; } }
        @keyframes sop-signature-meta-reveal { to { opacity: 1; } }
        @keyframes sop-signature-cell-reveal {
          0% { background: #dcfce7; }
          55% { background: #f0fdf4; }
          100% { background: transparent; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sop-signature-reveal td,
          .sop-signature-reveal .sop-handwritten-signature path,
          .sop-signature-reveal .sop-digital-signature > span { animation: none; opacity: 1; stroke-dashoffset: 0; }
        }
        .sop-export-annex { margin: 0 0 5px; }
        .sop-export-annex-file { margin: -1px 0 7px 14px; color: #666; font-size: 8pt; }
        .sop-export-annex-file-error { color: #a52a2a; }
        .sop-print-page.sop-export-attachment-page {
          position: relative; display: block; overflow: hidden; padding: 0;
        }
        .sop-export-attachment-image {
          display: block; width: 100%; height: 11in;
          object-fit: contain; object-position: center;
        }
        .sop-export-attachment-label {
          position: absolute; right: 0.14in; bottom: 0.1in;
          padding: 3px 7px;
          border: 1px solid rgba(0, 0, 0, 0.24); border-radius: 3px;
          background: rgba(255, 255, 255, 0.94); color: #333;
          font-family: var(--font-ui-family); font-size: 7pt; font-weight: 600; line-height: 1.2;
          letter-spacing: 0.03em; text-transform: uppercase;
        }
        .sop-export-flow-page .sop-print-page-body {
          display: flex; flex-direction: column; justify-content: flex-start;
        }
        .sop-export-flow-svg { width: 100%; }
        .sop-export-flow-svg svg { display: block; width: 100%; height: auto; }
        .sop-export-legend { margin: 8px 0 0; color: #666; font-size: 8pt; font-style: italic; }
        .sop-export-footer {
          flex: none; margin-top: 12px; color: #666; text-align: center; font-size: 7pt; line-height: 1.35;
        }
        .sop-export-footer > div:first-child { font-size: 8pt; margin-bottom: 2px; }
        @media (max-width: 1100px) {
          .sop-preview-content { display: block; overflow: auto; }
          .sop-preview-scroll { overflow: visible; }
          .sop-review-panel { width: 100%; border-left: 0; border-top: 1px solid var(--color-line, #ddd); }
          .sop-print-page { width: 100%; min-height: auto; padding: 28px 32px; }
          .sop-print-page.sop-export-attachment-page {
            aspect-ratio: 8.5 / 11; min-height: auto; padding: 0;
          }
          .sop-export-attachment-image { height: 100%; }
        }
        @media print {
          body { visibility: hidden !important; margin: 0 !important; }
          .sop-preview-overlay { position: absolute; inset: 0; display: block; background: #fff; z-index: 0; }
          .sop-preview-overlay, .sop-print-pages, .sop-print-page, .sop-print-page * { visibility: visible !important; }
          .sop-preview-bar { display: none !important; }
          .sop-preview-scroll { overflow: visible; padding: 0; }
          .sop-print-pages { display: block; }
          .sop-print-page {
            width: 8.5in; height: 11in; min-height: 11in; margin: 0;
            padding: 0.52in 0.75in 0.42in; box-shadow: none;
            break-after: page; page-break-after: always;
          }
          .sop-print-page.sop-export-attachment-page { padding: 0; }
          .sop-print-page:last-child { break-after: auto; page-break-after: auto; }
          @page { size: Letter portrait; margin: 0; }
        }
      `}</style>

      <div className="sop-preview-bar">
        {mode === "review" || mode === "approval" ? (
          <span className="ui-mono-label text-ink-tertiary">
            {mode === "review"
              ? "Draft PDF review · add section remarks in the review panel"
              : "Final approval · review the controlled PDF and add your digital signature"}
          </span>
        ) : <span />}
        <div className="flex items-center gap-2">
          {canDownloadPdf ? (
            <button type="button" className="ui-btn-primary inline-flex h-9 items-center gap-2 px-4" onClick={() => window.print()}>
              <Printer size={15} />
              Save as PDF
            </button>
          ) : null}
          <button type="button" className="ui-btn-ghost h-9 w-9 px-0" onClick={onClose} aria-label="Close preview">
            <X size={16} className="mx-auto" />
          </button>
        </div>
      </div>

      <div className="sop-preview-content">
        <div className="sop-preview-scroll" onScroll={handleReviewScroll}>
          <div className="sop-print-pages">
          <DocumentPage sop={sop} page={1} total={totalPages} annotations={annotationsForPage(1)} onAnnotate={onAnnotate} onSelectAnnotation={onSelectAnnotation} headerReviewCategory={mode === "review" ? "document" : undefined}>
            <Section title="Purpose" reviewCategory="purpose"><EmptyAwareText value={sop.purpose} /></Section>
            <Section title="Scope" reviewCategory="scope"><EmptyAwareText value={sop.scope} /></Section>
            <Section title="Definitions" reviewCategory="definitions">
              {sop.definitions.length ? (
                <table className="sop-export-table">
                  <colgroup><col style={{ width: "30%" }} /><col style={{ width: "70%" }} /></colgroup>
                  <thead><tr><th>Term</th><th>Definition</th></tr></thead>
                  <tbody>{sop.definitions.map((row, index) => <tr key={index}><td>{row.term}</td><td>{row.definition}</td></tr>)}</tbody>
                </table>
              ) : <EmptyAwareText value="" />}
            </Section>
            <Section title="Responsible Person(s)" reviewCategory="responsible">
              <EmptyAwareText value={sop.responsiblePersons.filter(Boolean).join("; ")} />
            </Section>
            <Section title="References" reviewCategory="references">
              {sop.references.length ? <ul className="sop-export-list">{sop.references.map((item, index) => <li key={index}>{item}</li>)}</ul> : <EmptyAwareText value="" />}
            </Section>
            <Section title="Measurement" reviewCategory="measurements">
              {sop.measurements.length ? <ul className="sop-export-list">{sop.measurements.map((item, index) => <li key={index}>{item}</li>)}</ul> : <EmptyAwareText value="" />}
            </Section>
            <Section title="Procedure" reviewCategory="procedure"><EmptyAwareText value={sop.procedure.processFlowDescription} /></Section>
          </DocumentPage>

          {flowPages.map((flowPage, index) => (
            <DocumentPage key={index} sop={sop} page={index + 2} total={totalPages} className="sop-export-flow-page" annotations={annotationsForPage(index + 2)} onAnnotate={onAnnotate} onSelectAnnotation={onSelectAnnotation}>
              <div className="sop-export-flow-svg" data-review-category="procedure" dangerouslySetInnerHTML={{ __html: flowPage.svg }} />
              <p className="sop-export-legend">{rasicLegend(".  ")}.</p>
            </DocumentPage>
          ))}

          <DocumentPage sop={sop} page={annexSummaryPage} total={totalPages} annotations={annotationsForPage(annexSummaryPage)} onAnnotate={onAnnotate} onSelectAnnotation={onSelectAnnotation}>
            <Section title="Annexes & Forms" reviewCategory="annexes">
              {sop.annexes.length ? sop.annexes.map((annex, index) => {
                const file = annexFiles.find((item) => item.annexId === annex.id);
                const error = file ? annexPreview.errors[file.id] : "";
                return (
                  <div key={annex.id ?? index}>
                    <p className="sop-export-annex"><strong>{annex.label}: </strong>{annex.description}</p>
                    {file ? (
                      <p className={`sop-export-annex-file ${error ? "sop-export-annex-file-error" : ""}`}>
                        Attached form: {file.originalName}{error ? ` - ${error}` : ""}
                      </p>
                    ) : null}
                  </div>
                );
              }) : <EmptyAwareText value="" />}
              {annexPreview.loading ? <p className="sop-export-annex-file">Rendering attached forms…</p> : null}
            </Section>
            {!hasAttachedForms ? (
              <>
                <Section title="Change History" reviewCategory="history">
                  <table className="sop-export-table">
                    <colgroup><col style={{ width: "14%" }} /><col style={{ width: "56%" }} /><col style={{ width: "30%" }} /></colgroup>
                    <thead><tr><th>Version</th><th>Changes</th><th>Author</th></tr></thead>
                    <tbody>
                      {sop.changeHistory.map((entry, index) => (
                        <tr key={index}><td>{entry.version}</td><td>{entry.changes}</td><td>{[systemAuthorName, formatDateControlled(entry.createdByDate)].filter(Boolean).join("\n")}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
                <Section title="Change Approvals">
                  <ApprovalTable sop={sop} entries={approvalEntries} revealSignatureId={revealSignatureId} />
                </Section>
              </>
            ) : null}
          </DocumentPage>

          {hasAttachedForms ? (
            <DocumentPage sop={sop} page={controlPage} total={totalPages} annotations={annotationsForPage(controlPage)} onAnnotate={onAnnotate} onSelectAnnotation={onSelectAnnotation}>
            <Section title="Change History" reviewCategory="history">
              <table className="sop-export-table">
                <colgroup><col style={{ width: "14%" }} /><col style={{ width: "56%" }} /><col style={{ width: "30%" }} /></colgroup>
                <thead><tr><th>Version</th><th>Changes</th><th>Author</th></tr></thead>
                <tbody>
                  {sop.changeHistory.map((entry, index) => (
                    <tr key={index}><td>{entry.version}</td><td>{entry.changes}</td><td>{[systemAuthorName, formatDateControlled(entry.createdByDate)].filter(Boolean).join("\n")}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Change Approvals">
              <ApprovalTable sop={sop} entries={approvalEntries} revealSignatureId={revealSignatureId} />
            </Section>
            </DocumentPage>
          ) : null}

          {annexPreview.pages.map((attachment, attachmentIndex) => {
            const annex = annexById.get(attachment.annexId);
            const annexIndex = sop.annexes.findIndex((item) => item.id === attachment.annexId);
            const annotationPage = totalPages + attachmentIndex + 1;
            const attachmentAnnotations = annotationsForPage(annotationPage);
            const appendixReference = /^appendix\b/i.test(annex?.label.trim() || "")
              ? annex!.label.trim()
              : `Appendix ${String.fromCharCode(65 + Math.max(annexIndex, 0))}`;
            return (
              <article
                key={`${attachment.fileId}-${attachment.sourcePage}`}
                className={`sop-print-page sop-export-attachment-page ${onAnnotate ? "sop-print-page-annotatable" : ""}`}
                data-review-category="annexes"
                aria-label={`${annex?.label || "Attached form"}, page ${attachment.sourcePage} of ${attachment.sourcePageCount}`}
                onClick={(event) => {
                  if (!onAnnotate || (event.target as HTMLElement).closest("[data-annotation-marker]")) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  onAnnotate(
                    annotationPage,
                    Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
                    Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
                  );
                }}
              >
                <NextImage
                  className="sop-export-attachment-image"
                  src={attachment.url}
                  alt={`${annex?.label || "Attached form"}, page ${attachment.sourcePage}`}
                  width={816}
                  height={1056}
                  unoptimized
                />
                <div className="sop-export-attachment-label">
                  {appendixReference} &middot; Page {attachment.sourcePage} of {attachment.sourcePageCount}
                </div>
                {attachmentAnnotations.map((annotation, index) => (
                  <button
                    key={annotation.id}
                    type="button"
                    data-annotation-marker
                    className="sop-annotation-marker"
                    style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectAnnotation?.(annotation.id);
                    }}
                    aria-label={`Open annotation ${index + 1} on page ${annotationPage}`}
                  >
                    {index + 1}
                  </button>
                ))}
              </article>
            );
          })}
          {mode === "review" ? <div data-review-category="overall" className="h-px" /> : null}
          </div>
        </div>
        {reviewPanel ? <aside className="sop-review-panel">{reviewPanel}</aside> : null}
      </div>
    </div>
  );
}
