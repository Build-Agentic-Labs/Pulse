import { AlertTriangle, Check } from "lucide-react";

export function SopStepNavIcon({
  active = false,
  complete = false,
  issueCount = 0,
  pending = false,
  number,
}: {
  active?: boolean;
  complete?: boolean;
  issueCount?: number;
  pending?: boolean;
  number?: number;
}) {
  const hasIssues = issueCount > 0;
  const state = hasIssues
    ? "error"
    : active
      ? "active"
      : complete
        ? "complete"
        : pending
          ? "pending"
          : number !== undefined
            ? "number"
            : "empty";

  return (
    <span
      className="flex h-4 w-4 shrink-0 items-center justify-center"
      data-sop-step-icon={state}
      role={hasIssues ? "img" : undefined}
      aria-label={hasIssues ? `${issueCount} ${issueCount === 1 ? "issue" : "issues"} in this step` : undefined}
    >
      {hasIssues ? (
        <AlertTriangle size={13} strokeWidth={2.5} className="text-danger" aria-hidden="true" />
      ) : active ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      ) : complete ? (
        <Check size={13} style={{ color: "var(--color-success)" }} />
      ) : pending ? (
        <span className="h-1.5 w-1.5 rounded-full bg-ink-tertiary opacity-50" />
      ) : number !== undefined ? (
        <span className="ui-mono-label text-ink-tertiary">{number}</span>
      ) : null}
    </span>
  );
}
