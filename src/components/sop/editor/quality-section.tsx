import { formatDate } from "@/domain/formatting";
import {
  CircleCheck,
  ShieldCheck,
  Loader2,
  RotateCcw,
  FileText,
} from "lucide-react";
import type { Sop } from "@/domain/sop/schema";
import type { SopSignature } from "@/lib/sop/review";
import {
  nextVersionLabel,
  type ChangeSignificance,
} from "@/domain/sop/version";
import { AutoTextarea } from "../auto-textarea";


export function SopQualitySection({
  sop,
  qualitySignature,
  isCurrentUserAuthor,
  canEditPermission,
  controlledChangeKind,
  setControlledChangeKind,
  handleStartControlledChange,
  controlledChangeReason,
  setControlledChangeReason,
  startingControlledChange,
  setPreviewing,
  isCurrentUserQualityApprover,
  setQualityApprovalOpen,
}: {
  sop: Sop;
  qualitySignature: SopSignature | undefined;
  isCurrentUserAuthor: boolean;
  canEditPermission: boolean;
  controlledChangeKind: ChangeSignificance | null;
  setControlledChangeKind: (kind: ChangeSignificance | null) => void;
  handleStartControlledChange: () => Promise<void>;
  controlledChangeReason: string;
  setControlledChangeReason: (reason: string) => void;
  startingControlledChange: boolean;
  setPreviewing: (open: boolean) => void;
  isCurrentUserQualityApprover: boolean;
  setQualityApprovalOpen: (open: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="ui-panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {sop.status === "effective" ? (
              <CircleCheck
                size={17}
                className="mt-0.5 shrink-0 text-emerald-700"
              />
            ) : (
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-sky-700" />
            )}
            <div>
              <h2 className="ui-setup-section-title">Quality approval</h2>
              <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                {sop.status === "effective"
                  ? "Quality signed the controlled document and released it to the Effective Library."
                  : "Every stakeholder has signed. Quality must verify the controlled PDF, add the final signature, and release it."}
              </p>
            </div>
          </div>
          <span
            className={`ui-chip shrink-0 ${
              sop.status === "effective"
                ? "border-emerald-600 text-emerald-700"
                : "border-sky-600 text-sky-700"
            }`}
          >
            {sop.status === "effective" ? "Effective" : "Awaiting Quality"}
          </span>
        </div>

        {qualitySignature ? (
          <div className="flex items-center gap-3 border-t border-line px-4 py-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {qualitySignature.signerName || "Quality approver"}
              </p>
              <p className="mt-0.5 text-xs text-ink-tertiary">
                Quality final signature
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-medium text-emerald-700">Signed</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-ink-tertiary">
                {formatDate(qualitySignature.signedAt)}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {isCurrentUserAuthor &&
      canEditPermission &&
      sop.status === "effective" ? (
        <section className="ui-panel overflow-hidden">
          <div className="border-b border-line px-4 py-4">
            <h2 className="ui-setup-section-title">
              Start a controlled change
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-tertiary">
              Only you, as the recorded author, can reopen this effective SOP.
              Choose how the version should advance; the system will add the
              change-history entry automatically.
            </p>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  kind: "MINOR" as const,
                  title: "Amendment",
                  description: "A focused correction or clarification.",
                },
                {
                  kind: "MAJOR" as const,
                  title: "New revision",
                  description:
                    "A substantive process or responsibility change.",
                },
              ].map((option) => {
                const selected = controlledChangeKind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    aria-pressed={selected}
                    className={`rounded-lg border px-3 py-3 text-left transition-colors motion-reduce:transition-none ${
                      selected
                        ? "border-ink bg-ink text-canvas"
                        : "border-line bg-canvas text-ink hover:border-ink-tertiary"
                    }`}
                    onClick={() => setControlledChangeKind(option.kind)}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        {option.title}
                      </span>
                      <span
                        className={`ui-mono-label ${selected ? "text-canvas/70" : "text-ink-tertiary"}`}
                      >
                        {nextVersionLabel(sop.meta.version, option.kind)}
                      </span>
                    </span>
                    <span
                      className={`mt-1 block text-xs leading-5 ${selected ? "text-canvas/70" : "text-ink-tertiary"}`}
                    >
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {controlledChangeKind ? (
              <form
                className="space-y-3 border-t border-line pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleStartControlledChange();
                }}
              >
                <label className="block">
                  <span className="ui-field-label">Reason for change</span>
                  <AutoTextarea
                    className="ui-field-standalone mt-2 min-h-24"
                    value={controlledChangeReason}
                    placeholder="Describe what is changing and why."
                    onChange={(event) =>
                      setControlledChangeReason(event.target.value)
                    }
                    disabled={startingControlledChange}
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] leading-4 text-ink-tertiary">
                    {controlledChangeKind === "MINOR"
                      ? `This amendment creates ${nextVersionLabel(sop.meta.version, "MINOR")}.`
                      : `This revision creates ${nextVersionLabel(sop.meta.version, "MAJOR")} and requires retraining review.`}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="ui-btn-ghost h-9 px-3"
                      onClick={() => {
                        setControlledChangeKind(null);
                        setControlledChangeReason("");
                      }}
                      disabled={startingControlledChange}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ui-btn-primary h-9 gap-2 px-4 disabled:opacity-50"
                      disabled={
                        !controlledChangeReason.trim() ||
                        startingControlledChange
                      }
                    >
                      {startingControlledChange ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                      {startingControlledChange
                        ? "Starting…"
                        : controlledChangeKind === "MINOR"
                          ? "Start amendment"
                          : "Start revision"}
                    </button>
                  </div>
                </div>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="ui-btn-ghost h-9 gap-2 border border-line px-3"
          onClick={() => setPreviewing(true)}
        >
          <FileText size={14} />
          Preview signed PDF
        </button>
        {isCurrentUserQualityApprover && sop.status === "approved" ? (
          <button
            type="button"
            className="ui-btn-primary h-9 gap-2 px-4"
            onClick={() => setQualityApprovalOpen(true)}
          >
            <ShieldCheck size={14} />
            Review, sign & release
          </button>
        ) : null}
      </div>
    </div>
  );
}
