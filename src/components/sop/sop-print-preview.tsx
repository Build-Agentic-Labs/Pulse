"use client";

import { ArrowLeft, Printer, X } from "lucide-react";
import Link from "next/link";
import { formatDateControlled, formatDateTime } from "@/domain/formatting";
import NextImage from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { DEFAULT_DOC_TYPE, documentNumberLabel } from "@/domain/sop/authoring";
import type { PagePlan } from "@/domain/sop/pagination";
import { linkedSopLabel, rasicLegend, type Sop } from "@/domain/sop/schema";
import {
  SIGNATURE_VIEWBOX_HEIGHT,
  SIGNATURE_VIEWBOX_WIDTH,
  signatureStrokePath,
} from "@/domain/sop/signature";
import { buildApprovalEntries, type ApprovalSignatureEntry } from "@/lib/sop/approval-entries";
import { createSopAnnexFileUrl, openSopAnnexFile, type SopAnnexFile } from "@/lib/sop/annex-files";
import { buildProcedureSvgPages } from "@/lib/sop/procedure-flow-image";
import type { SopReviewAnnotation } from "@/lib/sop/review-annotations";
import { buildPrintBlocks, type PrintBlock, type PrintBlockExtras } from "./print-blocks";
import { usePaginatedPages } from "./use-paginated-pages";

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
        <div>{`${sop.meta.sopNumber || "SOP-QAS-00X"}: ${sop.meta.title || ""}`.trim()}</div>
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

/** One entry per line, sharing EmptyAwareText's em-dash empty state. */
function LinesOrDash({ values }: { values: readonly string[] }) {
  const entries = values.filter(Boolean);
  if (entries.length === 0) return <EmptyAwareText value="" />;
  return (
    <>
      {entries.map((entry, index) => (
        <p key={`${entry}-${index}`}>{entry}</p>
      ))}
    </>
  );
}

function ApprovalTable({
  entries,
  revealSignatureId,
}: {
  entries: ApprovalSignatureEntry[] | null;
  revealSignatureId?: string | null;
}) {
  const rows = entries ?? [];

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

/** 8.5in page width at 96dpi — the fixed layout width pages are scaled against. */
const PAGE_WIDTH_PX = 816;

/**
 * A plan page's body: any "(cont.)" headings this page opens with, then its
 * placed blocks stacked in order. Blocks are self-contained (their own
 * `render()` includes the section shell), so this needs no grouping logic —
 * it exists only to avoid repeating the same map between section and
 * trailing pages.
 */
function PlanPageBody({ page, blockById }: { page: PagePlan; blockById: Map<string, PrintBlock> }) {
  return (
    <>
      {page.continuedSections.map((section) => (
        <section
          key={section.category}
          className="sop-export-section"
          style={{ marginTop: 0 }}
          data-review-category={section.category}
        >
          <h2>{section.title} (cont.)</h2>
        </section>
      ))}
      {page.blocks.map((placed) => {
        const block = blockById.get(placed.blockId);
        if (!block) return null;
        return (
          <Fragment key={placed.blockId + (placed.lineRange ? `@${placed.lineRange.startLine}` : "")}>
            {block.render(placed.lineRange)}
          </Fragment>
        );
      })}
    </>
  );
}

export function SopPrintPreview({
  sop: sopProp,
  departmentCode,
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
  backLink,
}: {
  sop: Sop;
  /**
   * Owning department code, used to render `SOP-PRO-###` while the SOP has not earned a number.
   * Resolved here rather than at each call site so no print or export path can leak a blank
   * number onto a controlled copy. Idempotent: a real number is passed through untouched.
   */
  departmentCode?: string | null;
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
  /** Rendered as a "← Back to …" toolbar button when this preview was reached from another SOP. */
  backLink?: { href: string; label: string };
}) {
  // Resolve the displayed number once, here, so every page of this document -- masthead, running
  // header, toolbar -- agrees. Shadowing `sop` means no render path below can reach the raw prop
  // and print a blank number onto a controlled copy.
  const sop = useMemo<Sop>(
    () => ({
      ...sopProp,
      meta: {
        ...sopProp.meta,
        // Doc type is SOP-only in v1 (see DEFAULT_DOC_TYPE); revisit when others are exposed.
        sopNumber: documentNumberLabel(sopProp.meta.sopNumber, departmentCode, DEFAULT_DOC_TYPE),
      },
    }),
    [sopProp, departmentCode],
  );

  // Reference-doc uploads share the annex-file table; they belong to the References
  // list (rendered by name), not to the attached-forms appendix pages, so strip them
  // before any page-count or appendix logic sees them.
  const formFiles = useMemo(() => {
    const referenceDocIds = new Set((sop.referenceDocs ?? []).map((doc) => doc.id));
    return annexFiles.filter((file) => !referenceDocIds.has(file.annexId));
  }, [annexFiles, sop.referenceDocs]);
  const [annexPreview, setAnnexPreview] = useState<AnnexPreviewState>({ loading: false, pages: [], errors: {} });
  const [referenceOpenError, setReferenceOpenError] = useState("");
  // Referenced PDF opened inline over this preview (signed URL in an iframe).
  const [inlineDoc, setInlineDoc] = useState<{ name: string; url: string } | null>(null);
  const [approvalEntries, setApprovalEntries] = useState<ApprovalSignatureEntry[] | null>(null);
  const [systemAuthorName, setSystemAuthorName] = useState("System author");
  const reviewScrollFrame = useRef<number | null>(null);
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pageScale, setPageScale] = useState(1);
  // Block ids already warned about this mount — re-measures (debounced edits,
  // resize) repeat the same overflowing block on every pass otherwise.
  const warnedOverflowBlockIds = useRef<Set<string>>(new Set());
  const canDownloadPdf = mode === "export" && sop.status === "effective";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An inline referenced document sits on top: Escape peels that layer
      // first and returns to the SOP, a second Escape closes the preview.
      setInlineDoc((current) => {
        if (current) return null;
        onClose();
        return current;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (reviewScrollFrame.current !== null) window.cancelAnimationFrame(reviewScrollFrame.current);
  }, []);

  useEffect(() => {
    let active = true;
    // Shared with the Word export so the two documents cannot disagree about who approved.
    buildApprovalEntries(sop.id)
      .then(({ entries, systemAuthorName: authorName }) => {
        if (!active) return;
        setApprovalEntries(entries);
        setSystemAuthorName(authorName);
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
      // Scoped to the visible pages: the offscreen measurement tree renders the
      // same ApprovalTable to measure it, and its clone must never be able to
      // steal this scrollIntoView.
      previewRootRef.current
        ?.querySelector<HTMLElement>(`.sop-print-pages [data-signature-id="${revealSignatureId}"]`)
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
  const hasAttachedForms = formFiles.length > 0;

  // "Attached form: …" annotations under annex rows, keyed by annex id — mirrors
  // the lookup the hand-assigned annex summary page does inline (:798-812 today).
  const annexFileLines = useMemo(() => {
    const map = new Map<string, { name: string; error?: string }>();
    for (const annex of sop.annexes) {
      if (!annex.id) continue;
      const file = formFiles.find((item) => item.annexId === annex.id);
      if (!file) continue;
      const error = annexPreview.errors[file.id];
      map.set(annex.id, { name: file.originalName, error: error || undefined });
    }
    return map;
  }, [sop.annexes, formFiles, annexPreview.errors]);

  // Preview-owned state (approvals node, annex file lines, reference renderers)
  // injected into the otherwise-pure print-block builder. Memoized so `segments`
  // below stays referentially stable across unrelated re-renders.
  const extras = useMemo<PrintBlockExtras>(
    () => ({
      renderLinkedSop: (link) => (
        <Link
          className="sop-export-link"
          href={`/sops/${link.sopId}?preview=pdf&from=${encodeURIComponent(sop.id)}`}
          title="Open this SOP's document preview"
        >
          {linkedSopLabel(link)}
        </Link>
      ),
      renderReferenceDoc: (doc) => {
        // The binary sits in the annex-file table keyed by this doc's id.
        // Storage URLs are short-lived signed URLs, so mint one on click.
        const file = annexFiles.find((item) => item.annexId === doc.id);
        if (!file) return doc.name;
        return (
          <button
            type="button"
            className="sop-export-link"
            onClick={() => {
              setReferenceOpenError("");
              // PDFs stay inside the app: an inline viewer over this preview
              // with a Back button. Other types download.
              const openTask = file.contentType === "application/pdf"
                ? createSopAnnexFileUrl(file, 600).then((url) => setInlineDoc({ name: doc.name, url }))
                : openSopAnnexFile(file);
              openTask.catch((error: unknown) => {
                setReferenceOpenError(
                  error instanceof Error ? error.message : "The referenced file could not be opened.",
                );
              });
            }}
            title="Open the referenced file"
          >
            {doc.name}
          </button>
        );
      },
      changeAuthor: (entry) =>
        [systemAuthorName, formatDateControlled(entry.createdByDate)].filter(Boolean).join("\n"),
      approvalsTable: approvalEntries?.length ? (
        <ApprovalTable entries={approvalEntries} revealSignatureId={revealSignatureId} />
      ) : undefined,
      annexFileLines,
      annexLoading: annexPreview.loading,
    }),
    [sop, annexFiles, systemAuthorName, approvalEntries, revealSignatureId, annexFileLines, annexPreview.loading],
  );

  // `buildPrintBlocks` stays pure of preview UI state (see PrintBlockExtras),
  // so the reference-open error — transient click feedback, not a document
  // field — is spliced in here rather than threaded through that builder. It
  // lands as its own trailing block right after the references section's last
  // block, so it is measured and paginated exactly like everything else
  // instead of risking a silent clip under `.sop-print-page`'s new
  // `overflow: hidden`.
  const segments = useMemo(() => {
    const built = buildPrintBlocks(sop, extras);
    if (!referenceOpenError) return built;
    const lastReferenceIndex = built.sections.reduce(
      (found, block, index) => (block.category === "references" ? index : found),
      -1,
    );
    if (lastReferenceIndex === -1) return built;
    const errorBlock: PrintBlock = {
      id: "references-open-error",
      category: "references",
      sectionTitle: "References",
      render: () => (
        <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category="references">
          <p className="sop-export-annex-file-error">{referenceOpenError}</p>
        </section>
      ),
    };
    return {
      ...built,
      sections: [
        ...built.sections.slice(0, lastReferenceIndex + 1),
        errorBlock,
        ...built.sections.slice(lastReferenceIndex + 1),
      ],
    };
  }, [sop, extras, referenceOpenError]);

  // `measuring` is intentionally not destructured: the fallback below no longer
  // conditions on it (see the comment there for why), and nothing else in this
  // component reads it.
  const { sectionPages, trailingPages, failed, offscreenRef } = usePaginatedPages(segments);

  // Blocks are self-contained (Task 2), so lookup by id is all rendering needs.
  // Ids that no longer resolve are skipped at render time (below) — during the
  // debounce window after an edit, the plan is one render behind the blocks.
  const blockById = useMemo(
    () => new Map([...segments.sections, ...segments.trailing].map((b) => [b.id, b] as const)),
    [segments],
  );

  // Scaled-sheet responsive strategy: pages keep true 8.5in geometry (and thus
  // the same line wrapping the offscreen tree measured) at every viewport;
  // only their rendered size shrinks, via `zoom` on the pages wrapper below.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const updateScale = () => {
      // Floored at 0.1: a clientWidth at or below the 32px padding allowance
      // (e.g. a collapsed/hidden container mid-layout) would otherwise divide
      // out to zero or negative, and `zoom: 0` collapses the pages entirely.
      setPageScale(Math.max(0.1, Math.min(1, (scrollEl.clientWidth - 32) / PAGE_WIDTH_PX)));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, []);

  // A page the packer could not split anything on gets flagged rather than
  // silently clipped (see `.sop-print-page-overflowing` below); this is the
  // author-facing signal that a block needs to be shortened. Warned once per
  // block id per mount — sectionPages/trailingPages change on every debounced
  // re-measure (an edit, a resize), and the same oversized block would
  // otherwise re-warn on every one of those passes.
  useEffect(() => {
    for (const page of [...sectionPages, ...trailingPages]) {
      if (!page.overflowing) continue;
      const blockId = page.blocks[page.blocks.length - 1]?.blockId ?? "unknown";
      if (warnedOverflowBlockIds.current.has(blockId)) continue;
      warnedOverflowBlockIds.current.add(blockId);
      console.warn(
        `SOP ${sop.meta.sopNumber || sop.id}: block "${blockId}" is taller than one page and cannot be split; it will overflow its sheet.`,
      );
    }
  }, [sectionPages, trailingPages, sop]);

  // Dropped the `measuring` conjunct on purpose: `sectionPages.length === 0` alone
  // covers first paint before fonts settle AND any later moment the plan comes
  // back empty (e.g. a re-measure that lands mid print-styling, when the
  // offscreen tree is momentarily display:none and usableHeight reads 0) — the
  // plan branch renders nothing in that state regardless of `measuring`, so
  // gating on `measuring` too just delayed the fallback into a blank page
  // instead of preventing it. `failed` covers a measurement throw. Either way,
  // one long hand-assigned page beats no document — this component gates
  // approvals.
  const fallback = failed || sectionPages.length === 0;
  const fallbackTotalPages = (hasAttachedForms ? 3 : 2) + flowPages.length;
  // Attachment sheets stay outside the count in both branches — they carry
  // their own "Appendix · Page x of y" label and no document footer.
  const totalPages = fallback
    ? fallbackTotalPages
    : sectionPages.length + flowPages.length + trailingPages.length;
  const annexSummaryPage = flowPages.length + 2;
  const controlPage = fallbackTotalPages;
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
      if (!formFiles.length) {
        setAnnexPreview({ loading: false, pages: [], errors: {} });
        return;
      }

      setAnnexPreview({ loading: true, pages: [], errors: {} });
      const pages: RenderedAnnexPage[] = [];
      const errors: Record<string, string> = {};

      for (const file of formFiles) {
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
  }, [formFiles]);

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
        .sop-preview-doc-id {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 13px; font-weight: 600; color: var(--color-ink, #1a1a1a);
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
        .sop-inline-doc {
          position: fixed; inset: 0; z-index: 70;
          display: flex; flex-direction: column;
          background: rgba(15, 18, 21, 0.62);
        }
        .sop-inline-doc-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 10px 16px; flex: none;
          background: var(--color-surface, #fff); border-bottom: 1px solid var(--color-line, #ddd);
        }
        .sop-inline-doc-name {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 13px; color: var(--color-ink-secondary, #555);
        }
        .sop-inline-doc-frame { flex: 1; width: 100%; border: 0; background: #525659; }
        @media print { .sop-inline-doc { display: none !important; } }
        /* The offscreen measurement tree must be display:none in print, not just
           hidden — the main print block below forces
           ".sop-print-page, .sop-print-page * { visibility: visible !important }"
           so it can un-hide the real pages, and that same rule would re-reveal the
           probe article and both segment containers too (they share the
           .sop-print-page class for typography). visibility alone still lets a
           hidden box fragment across printed pages; display:none removes it from
           layout entirely, so it can never contribute extra printed sheets. */
        @media print { .sop-print-measure { display: none !important; } }
        .sop-preview-scroll { flex: 1; min-width: 0; overflow: auto; padding: 24px 16px 64px; }
        .sop-review-panel {
          width: clamp(520px, 38vw, 680px); flex: none; overflow: hidden;
          background: var(--color-surface, #fff); border-left: 1px solid var(--color-line, #ddd);
        }
        .sop-print-pages { display: grid; gap: 24px; justify-content: center; }
        .sop-print-page {
          box-sizing: border-box; width: 8.5in; height: 11in; overflow: hidden;
          display: flex; flex-direction: column;
          padding: 0.52in 0.75in 0.42in;
          background: #fff; color: #1a1a1a;
          box-shadow: 0 8px 40px rgba(0,0,0,0.25);
          font-family: var(--font-ui-family);
          font-size: 10pt; line-height: 1.35;
        }
        /* The single sanctioned exception: applied only when a PagePlan's
           overflowing flag is set, so a block too tall to split is visibly
           broken in the preview rather than silently clipped. */
        .sop-print-page-overflowing { height: auto; min-height: 11in; overflow: visible; }
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
        .sop-export-link {
          margin: 0; padding: 0; border: 0; background: none; cursor: pointer;
          font: inherit; color: #1d4ed8; text-align: left;
          text-decoration: underline; text-underline-offset: 2px;
        }
        .sop-export-link:hover { color: #1e40af; }
        @media print { .sop-export-link { color: inherit; text-decoration: none; } }
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
          /* No fluid reflow override here any more: pages keep true 8.5in
             geometry (and thus the same 7in content column the offscreen tree
             measured) at every viewport — only the rendered size shrinks, via
             zoom on .sop-print-pages. A narrower fixed padding here would
             desync the visible content width from the measured width and
             reintroduce the wrap-mismatch bug this feature exists to fix. */
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
          /* zoom:1 !important beats the screen-only inline "zoom: pageScale" —
             inline styles normally win over stylesheet rules, but an author
             !important declaration outranks even an inline style without one.
             Without this, a review-mode window narrower than ~1360px prints
             every page shrunk by whatever scale the screen last computed. */
          .sop-print-pages { display: block; zoom: 1 !important; }
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
        <div className="flex min-w-0 items-center gap-3">
          {backLink ? (
            <Link href={backLink.href} className="ui-btn-ghost inline-flex h-9 shrink-0 items-center gap-1.5 px-3">
              <ArrowLeft size={15} />
              {backLink.label}
            </Link>
          ) : null}
          <span className="sop-preview-doc-id" title={[sop.meta.sopNumber, sop.meta.title].filter(Boolean).join(" — ")}>
            {[sop.meta.sopNumber, sop.meta.title].filter(Boolean).join(" — ") || "Untitled SOP"}
          </span>
          {mode === "review" || mode === "approval" ? (
            <span className="ui-mono-label shrink-0 text-ink-tertiary">
              {mode === "review"
                ? "Draft PDF review · add section remarks in the review panel"
                : "Final approval · review the controlled PDF and add your digital signature"}
            </span>
          ) : null}
        </div>
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
        <div className="sop-preview-scroll" ref={scrollRef} onScroll={handleReviewScroll}>
          <div className="sop-print-pages" style={{ zoom: pageScale }}>
          {fallback ? (
            <>
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
                  <LinesOrDash values={sop.responsiblePersons} />
                </Section>
                <Section title="References" reviewCategory="references">
                  {sop.linkedSops.length || (sop.referenceDocs ?? []).length || sop.references.length ? (
                    <ul className="sop-export-list">
                      {sop.linkedSops.map((link) => (
                        <li key={link.sopId}>
                          <Link
                            className="sop-export-link"
                            href={`/sops/${link.sopId}?preview=pdf&from=${encodeURIComponent(sop.id)}`}
                            title="Open this SOP's document preview"
                          >
                            {linkedSopLabel(link)}
                          </Link>
                        </li>
                      ))}
                      {(sop.referenceDocs ?? []).map((doc) => {
                        // The binary sits in the annex-file table keyed by this doc's id.
                        // Storage URLs are short-lived signed URLs, so mint one on click.
                        const file = annexFiles.find((item) => item.annexId === doc.id);
                        return (
                          <li key={doc.id}>
                            {file ? (
                              <button
                                type="button"
                                className="sop-export-link"
                                onClick={() => {
                                  setReferenceOpenError("");
                                  // PDFs stay inside the app: an inline viewer over this
                                  // preview with a Back button. Other types download.
                                  const openTask = file.contentType === "application/pdf"
                                    ? createSopAnnexFileUrl(file, 600).then((url) =>
                                        setInlineDoc({ name: doc.name, url }),
                                      )
                                    : openSopAnnexFile(file);
                                  openTask.catch((error: unknown) => {
                                    setReferenceOpenError(
                                      error instanceof Error ? error.message : "The referenced file could not be opened.",
                                    );
                                  });
                                }}
                                title="Open the referenced file"
                              >
                                {doc.name}
                              </button>
                            ) : (
                              doc.name
                            )}
                          </li>
                        );
                      })}
                      {sop.references.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  ) : <EmptyAwareText value="" />}
                  {referenceOpenError ? <p className="sop-export-annex-file-error">{referenceOpenError}</p> : null}
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
                    const file = formFiles.find((item) => item.annexId === annex.id);
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
                    {approvalEntries?.length ? (
                      <Section title="Change Approvals">
                        <ApprovalTable entries={approvalEntries} revealSignatureId={revealSignatureId} />
                      </Section>
                    ) : null}
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
                  {approvalEntries?.length ? (
                    <Section title="Change Approvals">
                      <ApprovalTable entries={approvalEntries} revealSignatureId={revealSignatureId} />
                    </Section>
                  ) : null}
                </DocumentPage>
              ) : null}
            </>
          ) : (
            <>
              {sectionPages.map((page, pageIndex) => (
                <DocumentPage
                  key={`section-${pageIndex}`}
                  sop={sop}
                  page={pageIndex + 1}
                  total={totalPages}
                  className={page.overflowing ? "sop-print-page-overflowing" : undefined}
                  annotations={annotationsForPage(pageIndex + 1)}
                  onAnnotate={onAnnotate}
                  onSelectAnnotation={onSelectAnnotation}
                  headerReviewCategory={pageIndex === 0 && mode === "review" ? "document" : undefined}
                >
                  <PlanPageBody page={page} blockById={blockById} />
                </DocumentPage>
              ))}

              {flowPages.map((flowPage, index) => {
                const pageNumber = sectionPages.length + index + 1;
                return (
                  <DocumentPage
                    key={`flow-${index}`}
                    sop={sop}
                    page={pageNumber}
                    total={totalPages}
                    className="sop-export-flow-page"
                    annotations={annotationsForPage(pageNumber)}
                    onAnnotate={onAnnotate}
                    onSelectAnnotation={onSelectAnnotation}
                  >
                    <div className="sop-export-flow-svg" data-review-category="procedure" dangerouslySetInnerHTML={{ __html: flowPage.svg }} />
                    <p className="sop-export-legend">{rasicLegend(".  ")}.</p>
                  </DocumentPage>
                );
              })}

              {trailingPages.map((page, pageIndex) => {
                const pageNumber = sectionPages.length + flowPages.length + pageIndex + 1;
                return (
                  <DocumentPage
                    key={`trailing-${pageIndex}`}
                    sop={sop}
                    page={pageNumber}
                    total={totalPages}
                    className={page.overflowing ? "sop-print-page-overflowing" : undefined}
                    annotations={annotationsForPage(pageNumber)}
                    onAnnotate={onAnnotate}
                    onSelectAnnotation={onSelectAnnotation}
                  >
                    <PlanPageBody page={page} blockById={blockById} />
                  </DocumentPage>
                );
              })}
            </>
          )}

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

      {/* Offscreen measurement tree. Renders unconditionally on every path,
          including the fallback branch above — if this ever moved inside a
          conditional, a null offscreenRef on the effect's first run would
          leave `measuring` stuck true with no ResizeObserver ever attached,
          and the preview would be stuck blank. Placed after
          .sop-preview-content and outside .sop-preview-scroll so
          handleReviewScroll (which reads data-review-category only inside the
          scroll container) and the signature-reveal effect above (scoped to
          .sop-print-pages) never see these duplicate anchors. On screen, hidden
          with position/visibility (never display:none — that would collapse
          layout to 0×0 and every measurement would silently read zero). In
          print, the opposite is required: the .sop-print-measure class forces
          display:none there (see the CSS above), because the main print
          block's ".sop-print-page, .sop-print-page * { visibility: visible
          !important }" would otherwise re-reveal this whole tree — it shares
          the .sop-print-page class for typography — and a merely-hidden box
          still fragments across printed pages. */}
      <div
        ref={offscreenRef}
        aria-hidden
        className="sop-print-measure"
        style={{ position: "absolute", left: -99999, top: 0, visibility: "hidden", pointerEvents: "none" }}
      >
        <article className="sop-print-page" data-measure-page>
          <DocumentHeader sop={sop} />
          <main className="sop-print-page-body" data-measure-body />
          <DocumentFooter page={1} total={1} />
        </article>
        <div style={{ position: "relative" }}>
          {/* Invariant: the continuation-heading budget below is measured from
              this fixed string, not from each section's real title. "Procedure"
              is short enough to sit on one line at the 7in content width used
              throughout; the longest real section title today,
              "Responsible Person(s)", also fits on one line. If a future
              section title were long enough to wrap at 7in, its "(cont.)"
              heading would be taller than this probe measures, and every
              continuation page would under-budget by that extra line. */}
          <section className="sop-export-section" style={{ marginTop: 0 }}>
            <h2>Procedure (cont.)</h2>
          </section>
          <div data-measure-cont-end />
        </div>
        {(["sections", "trailing"] as const).map((name) => (
          <div
            key={name}
            data-segment={name}
            className="sop-print-page"
            style={{
              position: "relative",
              display: "block",
              width: "7in",
              height: "auto",
              minHeight: 0,
              overflow: "visible",
              padding: 0,
              boxShadow: "none",
            }}
          >
            {segments[name].map((block) => (
              <div key={block.id} data-block-id={block.id}>{block.render()}</div>
            ))}
          </div>
        ))}
      </div>
      {inlineDoc ? (
        <div className="sop-inline-doc" role="dialog" aria-label={`Referenced document ${inlineDoc.name}`}>
          <div className="sop-inline-doc-bar">
            <button
              type="button"
              className="ui-btn-ghost inline-flex h-9 items-center gap-1.5 px-3"
              onClick={() => setInlineDoc(null)}
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <span className="sop-inline-doc-name">{inlineDoc.name}</span>
            <button
              type="button"
              className="ui-btn-ghost h-9 w-9 px-0"
              onClick={() => setInlineDoc(null)}
              aria-label="Close referenced document"
            >
              <X size={16} className="mx-auto" />
            </button>
          </div>
          <iframe className="sop-inline-doc-frame" src={inlineDoc.url} title={inlineDoc.name} />
        </div>
      ) : null}
    </div>
  );
}
