"use client";

export function StatCard({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "ui-metric-card-good"
      : tone === "warn"
        ? "ui-metric-card-warn"
        : tone === "bad"
          ? "ui-metric-card-bad"
          : "";

  return (
    <div className={`ui-metric-card ${toneClass}`}>
      <div className="ui-metric-card-label">{label}</div>
      <div className="ui-metric-card-value">{value}</div>
      {meta ? <div className="ui-metric-card-meta">{meta}</div> : null}
    </div>
  );
}
