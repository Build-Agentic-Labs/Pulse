"use client";

import { X } from "lucide-react";
import { useEffect, type CSSProperties, type ReactNode } from "react";

export type FeedbackTone = "neutral" | "success" | "warning" | "danger";

export interface FeedbackAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface FeedbackToast {
  id: number;
  title: string;
  body?: string;
  content?: ReactNode;
  tone?: FeedbackTone;
  placement?: "corner" | "center";
  persistent?: boolean;
}

export interface FeedbackConfirm {
  title: string;
  body?: string;
  tone?: FeedbackTone;
  confirmLabel?: string;
  cancelLabel?: string;
  placement?: "center" | "anchor";
  anchorRect?: FeedbackAnchorRect;
  onConfirm: () => void;
}

const toneStyles: Record<FeedbackTone, { border: string; label: string; text: string }> = {
  neutral: {
    border: "border-line",
    label: "Notice",
    text: "text-ink-secondary",
  },
  success: {
    border: "border-line",
    label: "Complete",
    text: "text-success",
  },
  warning: {
    border: "border-warn/45",
    label: "Review",
    text: "text-warn-strong",
  },
  danger: {
    border: "border-danger/35",
    label: "Blocked",
    text: "text-danger",
  },
};
function BodyText({ body, compact = false }: { body?: string; compact?: boolean }) {
  if (!body) {
    return null;
  }

  return (
    <div className={compact ? "ui-workspace-notice-body" : "ui-workspace-notice-body mt-2 whitespace-pre-line"}>
      {body}
    </div>
  );
}

function anchorPopoverStyle(anchorRect: FeedbackAnchorRect): CSSProperties {
  const popoverWidth = Math.min(272, Math.max(anchorRect.width + 12, 232));
  const left = Math.max(8, anchorRect.left);
  const belowTop = anchorRect.bottom + 6;
  const estimatedHeight = 112;
  const top =
    belowTop + estimatedHeight > window.innerHeight - 12
      ? Math.max(12, anchorRect.top - estimatedHeight - 6)
      : belowTop;

  return {
    top,
    left,
    width: popoverWidth,
  };
}

function ConfirmActions({
  confirm,
  compact = false,
  onCancelConfirm,
  onConfirm,
}: {
  confirm: FeedbackConfirm;
  compact?: boolean;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}) {
  if (compact) {
    const confirmClass =
      confirm.tone === "danger"
        ? "ui-btn-ghost h-8 px-2 text-xs text-danger hover:text-danger"
        : "ui-btn-ghost h-8 px-2 text-xs";

    return (
      <div className="mt-3 flex items-center justify-end gap-1">
        <button type="button" onClick={onCancelConfirm} className="ui-btn-ghost h-8 px-2 text-xs">
          {confirm.cancelLabel ?? "Cancel"}
        </button>
        <button type="button" onClick={onConfirm} className={confirmClass}>
          {confirm.confirmLabel ?? "Continue"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancelConfirm} className="ui-btn-ghost h-9 px-4">
        {confirm.cancelLabel ?? "Cancel"}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className={confirm.tone === "danger" ? "ui-btn-destructive h-9 px-4" : "ui-btn-primary h-9 px-4"}
      >
        {confirm.confirmLabel ?? "Continue"}
      </button>
    </div>
  );
}

export function ThemedFeedbackLayer({
  confirm,
  onCancelConfirm,
  onConfirm,
  onDismissToast,
  toasts,
}: {
  confirm?: FeedbackConfirm;
  onCancelConfirm: () => void;
  onConfirm: () => void;
  onDismissToast: (id: number) => void;
  toasts: FeedbackToast[];
}) {
  const cornerToasts = toasts.filter((toast) => toast.placement !== "center");
  const centerToasts = toasts.filter((toast) => toast.placement === "center");

  // Escape cancels an open confirm, matching every menu/popover in the app.
  useEffect(() => {
    if (!confirm) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancelConfirm();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirm, onCancelConfirm]);

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-20 z-[90] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
        {cornerToasts.map((toast) => {
          const tone = toast.tone ?? "neutral";
          const style = toneStyles[tone];

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto overflow-hidden rounded-md border bg-surface  ${style.border}`}
              role="status"
            >
              <div className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="ui-mono-label">{style.label}</div>
                  <div className="ui-section-title mt-1">{toast.title}</div>
                  {toast.content ?? <BodyText body={toast.body} compact />}
                </div>
                <button
                  type="button"
                  onClick={() => onDismissToast(toast.id)}
                  className="ui-btn-ghost h-7 w-7 shrink-0 px-0"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {centerToasts.length ? (
        <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-4">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[min(860px,calc(100vw-2rem))] flex-col gap-3 sm:max-h-[calc(100dvh-2rem)]">
            {centerToasts.map((toast) => {
              const tone = toast.tone ?? "neutral";
              const style = toneStyles[tone];

              return (
                <div
                  key={toast.id}
                  className={`pointer-events-auto flex max-h-[inherit] flex-col overflow-hidden rounded-md border bg-surface  ${style.border}`}
                  role="status"
                >
                  <div className="shrink-0 border-b border-line px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="ui-mono-label">{style.label}</div>
                        <div className="ui-section-title mt-1">{toast.title}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDismissToast(toast.id)}
                        className="ui-btn-ghost h-8 w-8 shrink-0 px-0"
                        aria-label="Dismiss notification"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 overflow-y-auto p-4">
                    {toast.content ?? <BodyText body={toast.body} />}
                    <div className="mt-4 flex justify-end border-t border-line pt-4">
                      <button type="button" onClick={() => onDismissToast(toast.id)} className="ui-btn-primary h-9 px-4">
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {confirm ? (
        confirm.placement === "anchor" && confirm.anchorRect ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[99] cursor-default bg-transparent"
              onClick={onCancelConfirm}
              aria-label="Dismiss confirmation"
            />
            <div
              className="ui-feedback-popover fixed z-[100]"
              style={anchorPopoverStyle(confirm.anchorRect)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="feedback-confirm-title"
            >
              <p id="feedback-confirm-title" className="text-sm font-medium text-ink">
                {confirm.title}
              </p>
              <BodyText body={confirm.body} compact />
              <ConfirmActions
                compact
                confirm={confirm}
                onCancelConfirm={onCancelConfirm}
                onConfirm={onConfirm}
              />
            </div>
          </>
        ) : (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
            {/* Backdrop: clicking outside cancels (danger confirms included — Escape and
                the explicit Cancel button remain, so this can't destroy data by accident). */}
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-ink/20"
              onClick={onCancelConfirm}
              aria-label="Dismiss confirmation"
            />
            <div
              className={`relative w-full max-w-[460px] overflow-hidden rounded-md border bg-surface shadow-modal ${toneStyles[confirm.tone ?? "neutral"].border}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="feedback-confirm-title"
            >
              <div className="border-b border-line px-4 py-4">
                <div className="ui-mono-label">{toneStyles[confirm.tone ?? "neutral"].label}</div>
                <h2 id="feedback-confirm-title" className="ui-section-title mt-2">
                  {confirm.title}
                </h2>
              </div>
              <div className="p-4">
                <BodyText body={confirm.body} />
                <ConfirmActions confirm={confirm} onCancelConfirm={onCancelConfirm} onConfirm={onConfirm} />
              </div>
            </div>
          </div>
        )
      ) : null}
    </>
  );
}
