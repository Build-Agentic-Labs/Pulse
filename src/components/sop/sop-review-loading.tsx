"use client";

import { QualitySkeleton } from "./quality-skeleton";
import { X } from "lucide-react";

/** Occupies only the document area; the app header and navigation remain mounted. */
export function SopReviewLoading({ label, error, onClose, inline = false }: { label: string; error?: string; onClose: () => void; inline?: boolean }) {
  return <section className={`${inline ? "relative min-h-0 flex-1" : "absolute inset-0 z-20"} flex flex-col overflow-hidden bg-surface-sunken lg:rounded-tl-2xl`} aria-label={label} aria-busy={!error}>
    <div className="sop-document-toolbar">
      {error ? <span className="text-xs text-ink-secondary">{label}</span> : (
        <span className="min-w-0 flex-1" aria-hidden="true" />
      )}
      <button type="button" className="ui-btn-ghost h-9 w-9 p-0" aria-label="Back to review queue" onClick={onClose}><X size={16} className="mx-auto" /></button>
    </div>
    {error ? <div role="alert" className="p-5 text-sm text-danger">{error}</div> : <div className="min-h-0 flex-1 overflow-hidden"><QualitySkeleton variant="document" label="Opening document" /></div>}
  </section>;
}
