"use client";

import { FileText, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS, type Sop, type SopStatus } from "@/domain/sop/schema";

/**
 * The always-on title block for the SOP being authored — the header of a controlled document.
 * It sits above every editing step so the author never loses sight of what they are making, its
 * control number, its lifecycle state, and how far along it is. It also carries the two things
 * that used to be buried: a preview of the finished document, and the way into the approval flow.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

interface SopMastheadProps {
  sop: Sop;
  department?: Department;
  saveState: SaveState;
  dirty: boolean;
  /** True until the SOP has been persisted once; the approval flow needs a saved row. */
  isNew: boolean;
  /** Completed vs total authoring sections, for the progress readout. */
  sectionsComplete: number;
  sectionsTotal: number;
  onPreview: () => void;
  /** Save first, then go to the control page — used before the SOP has ever been saved. */
  onStartApproval: () => void;
}

function statusStyle(status: SopStatus): { className: string; style?: CSSProperties } {
  switch (status) {
    case "approved":
      return { className: "border-accent text-accent" };
    case "obsolete":
      return { className: "border-danger text-danger" };
    case "in_review":
      return { className: "", style: { color: "var(--color-warn)", borderColor: "var(--color-warn)" } };
    case "effective":
      return { className: "", style: { color: "var(--color-success)", borderColor: "var(--color-success)" } };
    default:
      return { className: "" };
  }
}

function SaveDot({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 ui-mono-label text-ink-tertiary">
        <Loader2 size={12} className="animate-spin" />
        Saving
      </span>
    );
  }
  const label = state === "error" ? "Save failed" : dirty ? "Unsaved" : state === "saved" ? "Saved" : "Up to date";
  const color =
    state === "error" ? "var(--color-danger)" : dirty ? "var(--color-warn)" : "var(--color-success)";
  return (
    <span className="inline-flex items-center gap-1.5 ui-mono-label" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** One labelled cell in the title block's field strip. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="ui-mono-label text-ink-tertiary">{label}</div>
      <div className="mt-1 truncate text-sm text-ink">{children}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function SopMasthead({
  sop,
  department,
  saveState,
  dirty,
  isNew,
  sectionsComplete,
  sectionsTotal,
  onPreview,
  onStartApproval,
}: SopMastheadProps) {
  const badge = statusStyle(sop.status);
  const progressPct = sectionsTotal > 0 ? Math.round((sectionsComplete / sectionsTotal) * 100) : 0;

  return (
    <section className="ui-panel overflow-hidden">
      {/* eyebrow: what this block is, and the live save state */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <span className="inline-flex items-center gap-1.5 ui-mono-label text-ink-tertiary">
          <FileText size={12} />
          Document control
        </span>
        <SaveDot state={saveState} dirty={dirty} />
      </div>

      {/* identity: number, status, version, then the title */}
      <div className="px-4 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-chip-accent font-mono">{sop.meta.sopNumber || "Number on save"}</span>
          <span className={`ui-chip ${badge.className}`} style={badge.style}>
            {SOP_STATUS_LABELS[sop.status]}
          </span>
          <span className="ui-mono-label text-ink-tertiary">Rev {sop.meta.version || "—"}</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-tight text-ink">
          {sop.meta.title || <span className="text-ink-tertiary">Untitled SOP</span>}
        </h1>
      </div>

      {/* title-block field strip */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-4">
        <Cell label="Owner">{department ? `${department.code} · ${department.name}` : "Unassigned"}</Cell>
        <Cell label="Effective">{formatDate(sop.meta.effectiveDate) || "On approval"}</Cell>
        <Cell label="Revision date">{formatDate(sop.meta.revisionDate) || "—"}</Cell>
        <div className="min-w-0">
          <div className="ui-mono-label text-ink-tertiary">Sections</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-ink tabular-nums">
              {sectionsComplete}/{sectionsTotal}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-surface-hover" aria-hidden>
              <span
                className="block h-full rounded-sm"
                style={{ width: `${progressPct}%`, backgroundColor: "var(--color-success)" }}
              />
            </span>
          </div>
        </div>
      </div>

      {/* actions: preview the finished document, and enter the approval flow */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <button type="button" className="ui-btn-ghost h-9 gap-2 px-3" onClick={onPreview}>
          <FileText size={15} />
          Preview PDF
        </button>
        {isNew ? (
          <button type="button" className="ui-btn-ghost h-9 gap-2 px-3" onClick={onStartApproval} title="Saves first, then opens the approval flow">
            <ShieldCheck size={15} />
            Save to start approval
          </button>
        ) : (
          <Link href={`/sops/${sop.id}/control`} className="ui-btn-primary inline-flex h-9 items-center gap-2 px-4">
            <ShieldCheck size={15} />
            Review &amp; approve
          </Link>
        )}
      </div>
    </section>
  );
}
