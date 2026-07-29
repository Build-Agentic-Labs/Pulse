import { Check } from "lucide-react";

export function SopStepNavIcon({
  active = false,
  complete = false,
  pending = false,
  number,
}: {
  active?: boolean;
  complete?: boolean;
  pending?: boolean;
  number?: number;
}) {
  const state = active
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
    >
      {active ? (
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
