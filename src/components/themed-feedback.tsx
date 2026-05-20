"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ReactNode } from "react";

export type FeedbackTone = "neutral" | "success" | "warning" | "danger";

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
  onConfirm: () => void;
}

const toneStyles: Record<FeedbackTone, { border: string; icon: string; label: string }> = {
  neutral: {
    border: "border-line",
    icon: "bg-steel text-white",
    label: "Notice",
  },
  success: {
    border: "border-teal/35",
    icon: "bg-teal text-white",
    label: "Complete",
  },
  warning: {
    border: "border-amber/45",
    icon: "bg-amber text-white",
    label: "Review",
  },
  danger: {
    border: "border-signal/35",
    icon: "bg-signal text-white",
    label: "Blocked",
  },
};

function ToneIcon({ tone = "neutral", size = 16 }: { tone?: FeedbackTone; size?: number }) {
  if (tone === "success") {
    return <CheckCircle2 size={size} />;
  }

  if (tone === "danger") {
    return <XCircle size={size} />;
  }

  if (tone === "warning") {
    return <AlertTriangle size={size} />;
  }

  return <Info size={size} />;
}

function BodyText({ body }: { body?: string }) {
  if (!body) {
    return null;
  }

  return <div className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-steel">{body}</div>;
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

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-20 z-[90] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
        {cornerToasts.map((toast) => {
          const tone = toast.tone ?? "neutral";
          const style = toneStyles[tone];

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto overflow-hidden rounded-md border bg-white shadow-soft ${style.border}`}
              role="status"
            >
              <div className="flex items-start gap-3 p-3">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded ${style.icon}`}>
                  <ToneIcon tone={tone} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-wide text-steel">{style.label}</div>
                  <div className="mt-0.5 text-sm font-black text-ink">{toast.title}</div>
                  {toast.content ?? <BodyText body={toast.body} />}
                </div>
                <button
                  type="button"
                  onClick={() => onDismissToast(toast.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-steel transition hover:border-line hover:bg-[#f4f0e7] hover:text-ink"
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
                  className={`pointer-events-auto flex max-h-[inherit] flex-col overflow-hidden rounded-md border bg-white shadow-soft ${style.border}`}
                  role="status"
                >
                  <div className="shrink-0 border-b border-line bg-[#fbfaf6] p-4">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded ${style.icon}`}>
                        <ToneIcon tone={tone} size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-wide text-steel">{style.label}</div>
                        <div className="mt-1 text-lg font-black tracking-normal text-ink">{toast.title}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDismissToast(toast.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent text-steel transition hover:border-line hover:bg-[#f4f0e7] hover:text-ink"
                        aria-label="Dismiss notification"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
                    {toast.content ?? <BodyText body={toast.body} />}
                    <div className="sticky bottom-0 -mx-3 -mb-3 mt-4 flex justify-end border-t border-line bg-white/95 px-3 py-3 sm:-mx-4 sm:-mb-4 sm:px-4">
                      <button
                        type="button"
                        onClick={() => onDismissToast(toast.id)}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-graphite px-4 text-sm font-bold text-white transition hover:bg-ink"
                      >
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/45 p-4" role="presentation">
          <div
            className={`w-full max-w-[460px] overflow-hidden rounded-md border bg-white shadow-soft ${toneStyles[confirm.tone ?? "neutral"].border}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-confirm-title"
          >
            <div className="border-b border-line bg-[#fbfaf6] p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded ${toneStyles[confirm.tone ?? "neutral"].icon}`}>
                  <ToneIcon tone={confirm.tone} size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wide text-steel">
                    {toneStyles[confirm.tone ?? "neutral"].label}
                  </div>
                  <h2 id="feedback-confirm-title" className="mt-1 text-lg font-black tracking-normal text-ink">
                    {confirm.title}
                  </h2>
                </div>
              </div>
            </div>
            <div className="p-4">
              <BodyText body={confirm.body} />
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelConfirm}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-bold text-ink transition hover:bg-[#f4f0e7]"
                >
                  {confirm.cancelLabel ?? "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-graphite px-4 text-sm font-bold text-white transition hover:bg-ink"
                >
                  {confirm.confirmLabel ?? "Continue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
