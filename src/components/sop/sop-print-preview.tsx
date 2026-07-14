"use client";

import { Printer, X } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { rasicLegend, type Sop } from "@/domain/sop/schema";
import { buildProcedureSvgPages } from "@/lib/sop/procedure-flow-image";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getFullYear()}`;
}

function DocumentHeader({ sop }: { sop: Sop }) {
  return (
    <header className="sop-export-header">
      <div className="sop-export-header-main">
        <img src="/sop/ana-logo.png" alt="ANA Inc." />
        <div>{`${sop.meta.sopNumber || "SOP-QA-00X"}: ${sop.meta.title || ""}`.trim()}</div>
      </div>
      <div className="sop-export-header-info">
        <div>Version: {sop.meta.version || "1.0"}</div>
        <div>Revision date: {formatDate(sop.meta.revisionDate) || "MM/DD/YY"}</div>
        <div>Effective date: {formatDate(sop.meta.effectiveDate) || "MM/DD/YY"}</div>
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
}: {
  sop: Sop;
  page: number;
  total: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`sop-print-page ${className}`}>
      <DocumentHeader sop={sop} />
      <main className="sop-print-page-body">{children}</main>
      <DocumentFooter page={page} total={total} />
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sop-export-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function EmptyAwareText({ value }: { value: string }) {
  return <p className={value ? undefined : "sop-export-empty"}>{value || "—"}</p>;
}

export function SopPrintPreview({ sop, onClose }: { sop: Sop; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // This is the same SVG source that Export rasterizes and embeds in the Word document.
  // Reusing it here keeps flowchart shapes, pagination, columns, and RASIC assignments aligned.
  const flowPages = useMemo(
    () => (sop.procedure.activities.length ? buildProcedureSvgPages(sop) : []),
    [sop],
  );
  const totalPages = 2 + flowPages.length;
  const backMatterPage = totalPages;

  return (
    <div className="sop-preview-overlay" role="dialog" aria-modal="true" aria-label="SOP document preview">
      <style>{`
        .sop-preview-overlay {
          position: fixed; inset: 0; z-index: 60;
          display: flex; flex-direction: column;
          background: rgba(15, 18, 21, 0.62);
        }
        .sop-preview-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 10px 16px; flex: none;
          background: var(--color-surface, #fff); border-bottom: 1px solid var(--color-line, #ddd);
        }
        .sop-preview-scroll { flex: 1; overflow: auto; padding: 24px 16px 64px; }
        .sop-print-pages { display: grid; gap: 24px; justify-content: center; }
        .sop-print-page {
          box-sizing: border-box; width: 8.5in; min-height: 11in;
          display: flex; flex-direction: column;
          padding: 0.52in 0.75in 0.42in;
          background: #fff; color: #1a1a1a;
          box-shadow: 0 8px 40px rgba(0,0,0,0.25);
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10pt; line-height: 1.35;
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
          font: 700 12pt/1.3 Arial, Helvetica, sans-serif;
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
        .sop-export-annex { margin: 0 0 5px; }
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
        @media (max-width: 900px) {
          .sop-print-page { width: 100%; min-height: auto; padding: 28px 32px; }
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
          .sop-print-page:last-child { break-after: auto; page-break-after: auto; }
          @page { size: Letter portrait; margin: 0; }
        }
      `}</style>

      <div className="sop-preview-bar">
        <span className="ui-mono-label text-ink-tertiary">Export preview</span>
        <div className="flex items-center gap-2">
          <button type="button" className="ui-btn-primary inline-flex h-9 items-center gap-2 px-4" onClick={() => window.print()}>
            <Printer size={15} />
            Save as PDF
          </button>
          <button type="button" className="ui-btn-ghost h-9 w-9 px-0" onClick={onClose} aria-label="Close preview">
            <X size={16} className="mx-auto" />
          </button>
        </div>
      </div>

      <div className="sop-preview-scroll">
        <div className="sop-print-pages">
          <DocumentPage sop={sop} page={1} total={totalPages}>
            <Section title="Purpose"><EmptyAwareText value={sop.purpose} /></Section>
            <Section title="Scope"><EmptyAwareText value={sop.scope} /></Section>
            <Section title="Definitions">
              {sop.definitions.length ? (
                <table className="sop-export-table">
                  <colgroup><col style={{ width: "30%" }} /><col style={{ width: "70%" }} /></colgroup>
                  <thead><tr><th>Term</th><th>Definition</th></tr></thead>
                  <tbody>{sop.definitions.map((row, index) => <tr key={index}><td>{row.term}</td><td>{row.definition}</td></tr>)}</tbody>
                </table>
              ) : <EmptyAwareText value="" />}
            </Section>
            <Section title="Responsible Person(s)">
              {sop.responsiblePersons.length ? <ul className="sop-export-list">{sop.responsiblePersons.map((item, index) => <li key={index}>{item}</li>)}</ul> : <EmptyAwareText value="" />}
            </Section>
            <Section title="References">
              {sop.references.length ? <ul className="sop-export-list">{sop.references.map((item, index) => <li key={index}>{item}</li>)}</ul> : <EmptyAwareText value="" />}
            </Section>
            <Section title="Measurement">
              {sop.measurements.length ? <ul className="sop-export-list">{sop.measurements.map((item, index) => <li key={index}>{item}</li>)}</ul> : <EmptyAwareText value="" />}
            </Section>
            <Section title="Procedure"><EmptyAwareText value={sop.procedure.processFlowDescription} /></Section>
          </DocumentPage>

          {flowPages.map((flowPage, index) => (
            <DocumentPage key={index} sop={sop} page={index + 2} total={totalPages} className="sop-export-flow-page">
              <div className="sop-export-flow-svg" dangerouslySetInnerHTML={{ __html: flowPage.svg }} />
              <p className="sop-export-legend">{rasicLegend(".  ")}.</p>
            </DocumentPage>
          ))}

          <DocumentPage sop={sop} page={backMatterPage} total={totalPages}>
            <Section title="Annexes & Forms">
              {sop.annexes.length ? sop.annexes.map((annex, index) => (
                <p className="sop-export-annex" key={index}><strong>{annex.label}: </strong>{annex.description}</p>
              )) : <EmptyAwareText value="" />}
            </Section>
            <Section title="Change History">
              <table className="sop-export-table">
                <colgroup><col style={{ width: "14%" }} /><col style={{ width: "56%" }} /><col style={{ width: "30%" }} /></colgroup>
                <thead><tr><th>Version</th><th>Changes</th><th>Created By</th></tr></thead>
                <tbody>
                  {sop.changeHistory.map((entry, index) => (
                    <tr key={index}><td>{entry.version}</td><td>{entry.changes}</td><td>{[entry.createdByName, entry.createdByPosition, formatDate(entry.createdByDate)].filter(Boolean).join("\n")}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Change Approvals">
              <table className="sop-export-table">
                <colgroup><col style={{ width: "28%" }} /><col style={{ width: "26%" }} /><col style={{ width: "26%" }} /><col style={{ width: "20%" }} /></colgroup>
                <thead><tr><th>Approval</th><th>Name</th><th>Position</th><th>Date</th></tr></thead>
                <tbody>{sop.approvals.map((row, index) => <tr key={index}><td>{row.role}</td><td>{row.name}</td><td>{row.position}</td><td>{formatDate(row.date)}</td></tr>)}</tbody>
              </table>
            </Section>
          </DocumentPage>
        </div>
      </div>
    </div>
  );
}
