"use client";

import { Check, CircleCheck, ExternalLink, Loader2, PencilLine } from "lucide-react";
import type { ReactNode } from "react";
import { formatDate } from "@/domain/formatting";
import type { SopReviewAnnotation } from "@/lib/sop/review-annotations";

/**
 * One section's returned remarks, pinned in the document margin beside that section: who said
 * what, and — while the author holds the draft — edit the section right here and mark each
 * remark addressed. Sections too large for a card (the process flow, annexes) open the builder.
 */
export function SopRemarkCard({
  label,
  remarks,
  editor,
  editing,
  editable,
  lockedReason,
  resolvingId,
  onToggleEdit,
  onOpenInBuilder,
  onResolve,
}: {
  label: string;
  remarks: SopReviewAnnotation[];
  /** The section's own editor, or null when it only edits in the builder. */
  editor: ReactNode | null;
  editing: boolean;
  /** The author holds the draft and may change it. */
  editable: boolean;
  /** Why editing is unavailable, shown when not editable. */
  lockedReason: string;
  resolvingId: string | null;
  onToggleEdit: () => void;
  onOpenInBuilder: () => void;
  onResolve: (annotationId: string) => void;
}) {
  return (
    <section
      className={`rounded-md border bg-canvas shadow-sm transition-shadow ${editing ? "border-ink shadow-md" : "border-line"}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-xs font-semibold text-ink">{label}</span>
        {editable ? (
          editor ? (
            <button type="button" className="ui-btn-ghost h-7 gap-1 px-2 text-[11px]" onClick={onToggleEdit}>
              {editing ? <Check size={12} /> : <PencilLine size={12} />}
              {editing ? "Done" : "Edit"}
            </button>
          ) : (
            <button type="button" className="ui-btn-ghost h-7 gap-1 px-2 text-[11px]" onClick={onOpenInBuilder}>
              <ExternalLink size={12} />
              Edit in builder
            </button>
          )
        ) : null}
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        {remarks.map((remark) => (
          <div key={remark.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-ink">{remark.authorName}</span>
              <span className="shrink-0 text-[10px] text-ink-tertiary">{formatDate(remark.createdAt)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-ink-secondary">{remark.body}</p>
            {editable ? (
              <button
                type="button"
                className="ui-btn-ghost mt-1 h-7 gap-1 px-2 text-[11px] text-emerald-700 disabled:opacity-50"
                disabled={resolvingId !== null}
                onClick={() => onResolve(remark.id)}
              >
                {resolvingId === remark.id ? <Loader2 size={12} className="animate-spin" /> : <CircleCheck size={12} />}
                Mark addressed
              </button>
            ) : null}
          </div>
        ))}
        {!editable ? <p className="text-[11px] leading-4 text-ink-tertiary">{lockedReason}</p> : null}
      </div>

      {editing && editor ? <div className="border-t border-line px-3 py-3">{editor}</div> : null}
    </section>
  );
}
