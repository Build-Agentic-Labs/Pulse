"use client";

import { Check, CircleCheck, ExternalLink, Loader2, MessageSquare, PencilLine } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SopReviewComment } from "./sop-review-comment";
import type { SopReviewAnnotation } from "@/lib/sop/review-annotations";

/**
 * One section's returned remarks, pinned in the document margin beside that section: who said
 * what, and — while the author holds the draft — edit the section right here and mark each
 * remark addressed. Sections too large for a card (the process flow, annexes) open the builder.
 */
export function SopRemarkCard({
  label,
  hideEditAction = false,
  remarks,
  addressedRemarks = [],
  onUndo,
  onOpenAttachment,
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
  hideEditAction?: boolean;
  remarks: SopReviewAnnotation[];
  addressedRemarks?: SopReviewAnnotation[];
  onUndo?: (id: string) => void;
  onOpenAttachment?: (id: string) => void;
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
  const [replyingIds, setReplyingIds] = useState<Set<string>>(new Set());
  return (
    <section
      className="space-y-1"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-ink-secondary"><MessageSquare size={12} className="shrink-0" aria-hidden="true" /><span>Feedback on {label}</span></span>
        {editable && !hideEditAction ? (
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

      <div className="space-y-1">
        {remarks.map((remark) => (
          <div key={remark.id}>
            <SopReviewComment remark={remark} canReply={editable} onOpenAttachment={onOpenAttachment} onReplyStateChange={(editing) => setReplyingIds((current) => { const next = new Set(current); if (editing) next.add(remark.id); else next.delete(remark.id); return next; })} />
            {editable ? (
              <button
                type="button"
                className="ui-btn-ghost mt-1 h-7 gap-1 px-2 text-[11px] text-emerald-700 disabled:opacity-50"
                disabled={resolvingId !== null || replyingIds.has(remark.id)}
                onClick={() => onResolve(remark.id)}
              >
                {resolvingId === remark.id ? <Loader2 size={12} className="animate-spin" /> : <CircleCheck size={12} />}
                Mark addressed
              </button>
            ) : null}
          </div>
        ))}
        {addressedRemarks.length ? <details className="px-1 text-[11px] text-ink-secondary"><summary className="cursor-pointer py-1">Addressed ({addressedRemarks.length})</summary><div className="space-y-2 pt-2">{addressedRemarks.map((remark) => <div key={remark.id}><SopReviewComment remark={remark} canReply={editable} onOpenAttachment={onOpenAttachment} onReplyStateChange={(editing) => setReplyingIds((current) => { const next = new Set(current); if (editing) next.add(remark.id); else next.delete(remark.id); return next; })} />{editable && onUndo ? <button type="button" className="ui-btn-ghost h-7 px-2 text-[11px]" disabled={resolvingId !== null || replyingIds.has(remark.id)} onClick={() => onUndo(remark.id)}>Undo</button> : null}</div>)}</div></details> : null}
        {!editable ? <p className="text-[11px] leading-4 text-ink-tertiary">{lockedReason}</p> : null}
      </div>

      {editing && editor ? <div className="pt-2">{editor}</div> : null}
    </section>
  );
}
