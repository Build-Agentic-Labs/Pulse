"use client";

import { CircleCheck, Loader2, PencilLine } from "lucide-react";
import type { ReactNode } from "react";
import { formatDate } from "@/domain/formatting";
import type { SopReviewAnnotation, SopReviewSubmission } from "@/lib/sop/review-annotations";
import { REVIEW_CATEGORIES } from "./sop-review-workspace";

export interface FeedbackReviewer {
  userId: string;
  name: string;
  submission?: SopReviewSubmission;
}

export interface FeedbackAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
}

function reviewerState(reviewer: FeedbackReviewer): { label: string; dot: string } {
  if (!reviewer.submission) return { label: "Reviewing", dot: "bg-zinc-400" };
  return reviewer.submission.noChanges
    ? { label: "No changes needed", dot: "bg-emerald-600" }
    : { label: "Changes requested", dot: "bg-red-600" };
}

/**
 * The author's side of draft review, shown beside the document: who responded, the open
 * remarks in document order, and the one next step. Sections with no remarks are omitted.
 */
export function SopFeedbackPanel({
  reviewers,
  remarks,
  activeCategory,
  canResolve,
  resolvingId,
  note,
  action,
  onFocusCategory,
  onEditSection,
  onResolve,
}: {
  reviewers: FeedbackReviewer[];
  /** Open (unresolved) remarks for the current cycle. */
  remarks: SopReviewAnnotation[];
  activeCategory: string;
  /** Remarks can be marked addressed only while the author holds the draft. */
  canResolve: boolean;
  resolvingId: string | null;
  /** One line under the action explaining what happens next, or why it is waiting. */
  note: string;
  action: FeedbackAction | null;
  onFocusCategory: (category: string) => void;
  onEditSection: (category: string) => void;
  onResolve: (annotationId: string) => void;
}) {
  const sections = REVIEW_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    items: remarks.filter((remark) => (remark.category || "overall") === key),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-review-panel-header className="flex-none border-b border-line bg-canvas px-4 py-3">
        <div className="ui-mono-label text-ink-tertiary">Review feedback</div>
        <div className="mt-2 space-y-1.5">
          {reviewers.map((reviewer) => {
            const state = reviewerState(reviewer);
            return (
              <div key={reviewer.userId} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${state.dot}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{reviewer.name}</span>
                <span className="shrink-0 text-ink-tertiary">
                  {state.label}
                  {reviewer.submission ? ` · ${formatDate(reviewer.submission.submittedAt)}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div data-review-panel-scroll className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {sections.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-tertiary">No open remarks.</p>
        ) : (
          sections.map((section) => (
            <section
              key={section.key}
              data-review-field={section.key}
              className={`rounded-md border p-3 transition-colors ${
                activeCategory === section.key ? "border-ink bg-surface-hover" : "border-line"
              }`}
            >
              <button
                type="button"
                className="text-left text-xs font-medium text-ink hover:underline"
                onClick={() => onFocusCategory(section.key)}
              >
                {section.label}
              </button>
              <div className="mt-2 space-y-3">
                {section.items.map((remark) => (
                  <div key={remark.id}>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-ink">{remark.body}</p>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-tertiary">{remark.authorName}</span>
                      <button
                        type="button"
                        className="ui-btn-ghost h-7 gap-1 px-2 text-[11px]"
                        onClick={() => onEditSection(section.key)}
                      >
                        <PencilLine size={12} />
                        Edit
                      </button>
                      {canResolve ? (
                        <button
                          type="button"
                          className="ui-btn-ghost h-7 gap-1 px-2 text-[11px] text-emerald-700 disabled:opacity-50"
                          disabled={resolvingId !== null}
                          onClick={() => onResolve(remark.id)}
                        >
                          {resolvingId === remark.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <CircleCheck size={12} />
                          )}
                          Mark addressed
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="flex-none border-t border-line bg-canvas p-4">
        {action ? (
          <button
            type="button"
            className="ui-btn-primary h-9 w-full gap-2 px-4 disabled:opacity-40"
            disabled={action.disabled || action.busy}
            title={action.title}
            onClick={action.onClick}
          >
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : action.icon}
            {action.label}
          </button>
        ) : null}
        <p className={`text-center text-[11px] leading-4 text-ink-tertiary ${action ? "mt-2" : ""}`}>{note}</p>
      </div>
    </div>
  );
}
