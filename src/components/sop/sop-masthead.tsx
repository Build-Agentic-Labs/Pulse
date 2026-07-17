"use client";

import { FileText, Loader2, ShieldCheck } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS, type Sop, type SopStatus } from "@/domain/sop/schema";

type SaveState = "idle" | "saving" | "saved" | "error";

interface SopMastheadProps {
  sop: Sop;
  department?: Department;
  /** Vertical composition for the editor's persistent right-side summary. */
  variant?: "banner" | "sidebar";
  saveState: SaveState;
  dirty: boolean;
  /** True until the SOP has been persisted once; the approval flow needs a saved row. */
  isNew: boolean;
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
  const color = state === "error" ? "var(--color-danger)" : dirty ? "var(--color-warn)" : "var(--color-success)";
  return (
    <span className="inline-flex items-center gap-1.5 ui-mono-label" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
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
  variant = "banner",
  saveState,
  dirty,
  isNew,
  onStartApproval,
}: SopMastheadProps) {
  const badge = statusStyle(sop.status);
  const sidebar = variant === "sidebar";
  const rawNumber = sop.meta.sopNumber.trim();
  const displayNumber =
    !rawNumber || /^<unknown>$/i.test(rawNumber)
      ? isNew
        ? "Number on save"
        : "Unnumbered"
      : rawNumber;

  return (
    <section className="ui-panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 ui-mono-label text-ink-tertiary">
          <FileText size={12} />
          Document control
        </span>
        <SaveDot state={saveState} dirty={dirty} />
      </div>

      <div className={sidebar ? "px-4 pb-1 pt-4" : "px-4 pt-3.5"}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-chip-accent font-mono">{displayNumber}</span>
          <span className={`ui-chip ${badge.className}`} style={badge.style}>
            {SOP_STATUS_LABELS[sop.status]}
          </span>
          <span className="ui-mono-label text-ink-tertiary">Rev {sop.meta.version || "—"}</span>
        </div>
        <h1 className={`mt-2 font-semibold leading-snug text-ink ${sidebar ? "text-lg" : "text-xl"}`}>
          {sop.meta.title || <span className="text-ink-tertiary">Untitled SOP</span>}
        </h1>
      </div>

      <div
        className={`mt-3.5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line px-4 py-3 ${
          sidebar ? "sm:grid-cols-3 xl:grid-cols-2" : "sm:grid-cols-3 sm:gap-x-6 sm:gap-y-3"
        }`}
      >
        <Cell label="Owning department" className={sidebar ? "col-span-2 sm:col-span-1 xl:col-span-2" : ""}>
          {department ? `${department.code} · ${department.name}` : "Unassigned"}
        </Cell>
        <Cell label="Effective">{formatDate(sop.meta.effectiveDate) || "On approval"}</Cell>
        <Cell label="Revision date">{formatDate(sop.meta.revisionDate) || "—"}</Cell>
      </div>

      {isNew ? (
        <div
          className={`gap-2 border-t border-line px-3 py-3 ${
            sidebar ? "grid sm:flex sm:items-center sm:justify-between xl:grid" : "flex flex-wrap items-center justify-between"
          }`}
        >
          <button
            type="button"
            className={`ui-btn-ghost h-9 gap-2 px-3 ${sidebar ? "w-full border border-line sm:w-auto xl:w-full" : ""}`}
            onClick={onStartApproval}
            title="Saves first, then begins review"
          >
            <ShieldCheck size={15} />
            Save to start review
          </button>
        </div>
      ) : null}
    </section>
  );
}
