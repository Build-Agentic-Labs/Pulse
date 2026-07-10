"use client";

import { Printer, X } from "lucide-react";
import { useEffect } from "react";
import type { Sop } from "@/domain/sop/schema";

/**
 * A print-ready preview of the finished SOP. The author sees exactly the document that will be
 * released, and "Save as PDF" hands off to the browser's print dialog — no PDF dependency, and
 * the same output whether they save a PDF or send it to a printer.
 *
 * The sheet is always a light paper page, independent of the app theme: a controlled document is
 * a white page with dark ink, and it must print that way from either theme. The scoped print CSS
 * hides the app chrome so only the sheet reaches the page.
 */

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

/** A document section that renders only when it has content, so the preview reflects real state. */
function DocSection({ title, children, show }: { title: string; children: React.ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <section className="sop-doc-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function SopPrintPreview({ sop, onClose }: { sop: Sop; onClose: () => void }) {
  // Close on Escape; a preview overlay should never trap the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { meta, procedure } = sop;
  const hasProcedure = procedure.activities.length > 0;

  return (
    <div className="sop-preview-overlay" role="dialog" aria-modal="true" aria-label="SOP document preview">
      <style>{`
        .sop-preview-overlay {
          position: fixed; inset: 0; z-index: 60;
          display: flex; flex-direction: column;
          background: rgba(15, 18, 21, 0.55);
        }
        .sop-preview-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 10px 16px; flex: none;
          background: var(--color-surface, #fff); border-bottom: 1px solid var(--color-line, #ddd);
        }
        .sop-preview-scroll { flex: 1; overflow: auto; padding: 24px 16px 64px; }
        .sop-print-sheet {
          max-width: 820px; margin: 0 auto; background: #fff; color: #14181c;
          padding: 40px 48px; border-radius: 3px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.25);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          line-height: 1.55;
        }
        .sop-doc-titleblock { border: 1px solid #14181c; }
        .sop-doc-titleblock-top {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; padding: 12px 16px; border-bottom: 1px solid #14181c;
        }
        .sop-doc-org { font-weight: 700; letter-spacing: 0.02em; font-size: 15px; }
        .sop-doc-num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; text-align: right; }
        .sop-doc-title { padding: 14px 16px; font-size: 20px; font-weight: 650; }
        .sop-doc-fields {
          display: grid; grid-template-columns: repeat(4, 1fr);
          border-top: 1px solid #14181c;
        }
        .sop-doc-fields > div { padding: 8px 12px; border-right: 1px solid #d5d9d7; }
        .sop-doc-fields > div:last-child { border-right: none; }
        .sop-doc-fieldlabel {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #6b7472;
        }
        .sop-doc-fieldvalue { margin-top: 3px; font-size: 13px; }
        .sop-doc-section { margin-top: 26px; }
        .sop-doc-section h2 {
          font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
          font-weight: 700; color: #1e4e5c; margin: 0 0 8px;
          border-bottom: 1px solid #d5d9d7; padding-bottom: 4px;
        }
        .sop-doc-section p { margin: 0; font-size: 14px; white-space: pre-wrap; }
        .sop-doc-list { margin: 0; padding-left: 20px; font-size: 14px; }
        .sop-doc-list li { margin: 2px 0; }
        .sop-doc-defs { display: grid; gap: 6px; }
        .sop-doc-def { display: grid; grid-template-columns: 160px 1fr; gap: 12px; font-size: 14px; }
        .sop-doc-def dt { font-weight: 600; }
        .sop-doc-def dd { margin: 0; }
        .sop-doc-step { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eceeed; }
        .sop-doc-step-n {
          flex: none; width: 24px; height: 24px; border: 1px solid #14181c; border-radius: 3px;
          display: flex; align-items: center; justify-content: center;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
        }
        .sop-doc-step-body { min-width: 0; }
        .sop-doc-step-desc { font-weight: 600; font-size: 14px; }
        .sop-doc-step-detail { font-size: 13px; color: #40484a; margin-top: 2px; white-space: pre-wrap; }
        .sop-doc-step-roles { font-size: 11px; color: #6b7472; margin-top: 4px; }
        .sop-doc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sop-doc-table th, .sop-doc-table td {
          border: 1px solid #d5d9d7; padding: 6px 9px; text-align: left; vertical-align: top;
        }
        .sop-doc-table th {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; background: #f3f5f4;
        }
        @media print {
          body { visibility: hidden !important; }
          .sop-preview-overlay { position: absolute; inset: 0; background: #fff; z-index: 0; }
          .sop-preview-overlay, .sop-print-sheet, .sop-print-sheet * { visibility: visible !important; }
          .sop-preview-bar, .sop-preview-scroll { padding: 0; background: #fff; }
          .sop-preview-noprint { display: none !important; }
          .sop-print-sheet { box-shadow: none; max-width: none; margin: 0; padding: 0; border-radius: 0; }
          .sop-doc-step, .sop-doc-section { break-inside: avoid; }
          @page { margin: 18mm 16mm; }
        }
      `}</style>

      <div className="sop-preview-bar sop-preview-noprint">
        <span className="ui-mono-label text-ink-tertiary">Document preview</span>
        <div className="flex items-center gap-2">
          <button type="button" className="ui-btn-primary inline-flex h-9 items-center gap-2 px-4" onClick={() => window.print()}>
            <Printer size={15} />
            Save as PDF
          </button>
          <button
            type="button"
            className="ui-btn-ghost h-9 w-9 px-0"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X size={16} className="mx-auto" />
          </button>
        </div>
      </div>

      <div className="sop-preview-scroll">
        <article className="sop-print-sheet">
          <div className="sop-doc-titleblock">
            <div className="sop-doc-titleblock-top">
              <span className="sop-doc-org">ANA INC.</span>
              <span className="sop-doc-num">
                {meta.sopNumber || "—"}
                <br />
                Rev {meta.version || "—"}
              </span>
            </div>
            <div className="sop-doc-title">{meta.title || "Untitled SOP"}</div>
            <div className="sop-doc-fields">
              <div>
                <div className="sop-doc-fieldlabel">Document no.</div>
                <div className="sop-doc-fieldvalue">{meta.sopNumber || "—"}</div>
              </div>
              <div>
                <div className="sop-doc-fieldlabel">Revision</div>
                <div className="sop-doc-fieldvalue">{meta.version || "—"}</div>
              </div>
              <div>
                <div className="sop-doc-fieldlabel">Revision date</div>
                <div className="sop-doc-fieldvalue">{formatDate(meta.revisionDate) || "—"}</div>
              </div>
              <div>
                <div className="sop-doc-fieldlabel">Effective date</div>
                <div className="sop-doc-fieldvalue">{formatDate(meta.effectiveDate) || "—"}</div>
              </div>
            </div>
          </div>

          <DocSection title="Purpose" show={Boolean(sop.purpose.trim())}>
            <p>{sop.purpose}</p>
          </DocSection>

          <DocSection title="Scope" show={Boolean(sop.scope.trim())}>
            <p>{sop.scope}</p>
          </DocSection>

          <DocSection title="Definitions" show={sop.definitions.length > 0}>
            <dl className="sop-doc-defs">
              {sop.definitions.map((def, index) => (
                <div key={index} className="sop-doc-def">
                  <dt>{def.term}</dt>
                  <dd>{def.definition}</dd>
                </div>
              ))}
            </dl>
          </DocSection>

          <DocSection title="Responsible persons" show={sop.responsiblePersons.length > 0}>
            <ul className="sop-doc-list">
              {sop.responsiblePersons.map((person, index) => (
                <li key={index}>{person}</li>
              ))}
            </ul>
          </DocSection>

          <DocSection title="References" show={sop.references.length > 0}>
            <ul className="sop-doc-list">
              {sop.references.map((ref, index) => (
                <li key={index}>{ref}</li>
              ))}
            </ul>
          </DocSection>

          <DocSection title="Procedure" show={hasProcedure}>
            {procedure.processFlowDescription.trim() ? (
              <p style={{ marginBottom: 10 }}>{procedure.processFlowDescription}</p>
            ) : null}
            {procedure.activities.map((activity) => {
              const roles = Object.entries(activity.assignments)
                .map(([role, code]) => `${role}: ${code}`)
                .join("   ");
              return (
                <div key={activity.id} className="sop-doc-step">
                  <span className="sop-doc-step-n">{activity.step}</span>
                  <div className="sop-doc-step-body">
                    <div className="sop-doc-step-desc">{activity.description}</div>
                    {activity.detail ? <div className="sop-doc-step-detail">{activity.detail}</div> : null}
                    {roles ? <div className="sop-doc-step-roles">{roles}</div> : null}
                  </div>
                </div>
              );
            })}
          </DocSection>

          <DocSection title="Annexes & forms" show={sop.annexes.length > 0}>
            <ul className="sop-doc-list">
              {sop.annexes.map((annex, index) => (
                <li key={index}>
                  <strong>{annex.label}</strong> — {annex.description}
                </li>
              ))}
            </ul>
          </DocSection>

          <DocSection title="Change history" show={sop.changeHistory.length > 0}>
            <table className="sop-doc-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Changes</th>
                  <th>Created by</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sop.changeHistory.map((entry, index) => (
                  <tr key={index}>
                    <td>{entry.version}</td>
                    <td>{entry.changes}</td>
                    <td>{entry.createdByName}</td>
                    <td>{formatDate(entry.createdByDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DocSection>

          <DocSection title="Change approvals" show={sop.approvals.some((a) => a.name || a.date)}>
            <table className="sop-doc-table">
              <thead>
                <tr>
                  <th>Approval</th>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sop.approvals.map((approval, index) => (
                  <tr key={index}>
                    <td>{approval.role}</td>
                    <td>{approval.name}</td>
                    <td>{approval.position}</td>
                    <td>{formatDate(approval.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DocSection>
        </article>
      </div>
    </div>
  );
}
