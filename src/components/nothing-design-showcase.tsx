"use client";

import { useState } from "react";
import { useTheme } from "@/components/theme-provider";

function SegmentedProgress({
  filled,
  total,
  tone = "neutral",
  hero = false,
}: {
  filled: number;
  total: number;
  tone?: "neutral" | "good" | "warn" | "over";
  hero?: boolean;
}) {
  return (
    <div className={`nd-progress-segments ${hero ? "mt-3" : "mt-2"}`}>
      {Array.from({ length: total }, (_, index) => {
        const isFilled = index < filled;
        let className = "nd-progress-segment";
        if (hero) className += " nd-progress-segment-hero";
        if (!isFilled) return <div key={index} className={className} />;
        if (tone === "good") className += " nd-progress-segment-good";
        else if (tone === "warn") className += " nd-progress-segment-warn";
        else if (tone === "over") className += " nd-progress-segment-over";
        else className += " nd-progress-segment-filled";
        return <div key={index} className={className} />;
      })}
    </div>
  );
}

function StatRow({
  label,
  value,
  unit,
  tone = "neutral",
  trend,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "neutral" | "good" | "warn" | "over";
  trend?: string;
}) {
  const toneColor =
    tone === "good"
      ? "var(--nd-success)"
      : tone === "warn"
        ? "var(--nd-warning)"
        : tone === "over"
          ? "var(--nd-accent)"
          : "var(--nd-text-primary)";

  return (
    <div className="nd-row">
      <span className="nd-label">{label}</span>
      <span className="nd-data" style={{ color: toneColor }}>
        {value}
        {unit ? (
          <span className="nd-label ml-2 align-top text-[10px]" style={{ color: "var(--nd-text-secondary)" }}>
            {unit}
          </span>
        ) : null}
        {trend ? <span className="ml-2">{trend}</span> : null}
      </span>
    </div>
  );
}

export function NothingDesignShowcase() {
  const { theme, setTheme } = useTheme();
  const [segment, setSegment] = useState<"overview" | "system" | "storage">("overview");
  const [toggleOn, setToggleOn] = useState(true);
  const [saved, setSaved] = useState(false);

  return (
    <div className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-12">
        <header className="flex flex-col gap-8 border-b border-[var(--nd-border)] pb-8 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="nd-label">Nothing Design System</p>
            <h1 className="nd-display-md mt-4">Pulse</h1>
            <p className="nd-body mt-4 max-w-md text-[var(--nd-text-secondary)]">
              Monochrome, typographic, industrial. Swiss hierarchy with mechanical data widgets.
            </p>
          </div>

          <div className="flex flex-col items-start gap-4 md:items-end">
            <div className="nd-segmented">
              <button
                type="button"
                className={`nd-segment ${theme === "dark" ? "nd-segment-active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className={`nd-segment ${theme === "light" ? "nd-segment-active" : ""}`}
                onClick={() => setTheme("light")}
              >
                Light
              </button>
            </div>

            <nav className="nd-nav-bracket flex flex-wrap gap-x-4 gap-y-2">
              <span className="nd-nav-bracket-active">[ Overview ]</span>
              <span>Gallery</span>
              <span>Info</span>
            </nav>
          </div>
        </header>

        <section className="grid gap-12 py-12 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
          <div>
            <p className="nd-label">Primary metric</p>
            <div className="mt-6 flex items-end gap-3">
              <span className="nd-display-xl nd-data">36</span>
              <span className="nd-label mb-3">GB/s</span>
            </div>
            <p className="nd-body mt-6 max-w-lg text-[var(--nd-text-secondary)]">
              Throughput readout uses Space Mono at display scale. One hero number per screen — everything else steps down.
            </p>

            <div className="mt-10">
              <div className="flex items-end justify-between gap-4">
                <span className="nd-label">Line readiness</span>
                <span className="nd-data text-[var(--nd-success)]">78%</span>
              </div>
              <SegmentedProgress filled={16} total={20} tone="good" hero />
            </div>

            <div className="mt-8">
              <div className="flex items-end justify-between gap-4">
                <span className="nd-label">Buffer over limit</span>
                <span className="nd-data text-[var(--nd-accent)]">112%</span>
              </div>
              <SegmentedProgress filled={22} total={20} tone="over" hero />
            </div>
          </div>

          <div className="nd-surface p-6 md:p-8">
            <p className="nd-label">System status</p>
            <div className="mt-6 space-y-0">
              <StatRow label="Cycle time" value="4.2" unit="s" tone="good" trend="↑" />
              <StatRow label="Scrap rate" value="2.8" unit="%" tone="warn" />
              <StatRow label="Downtime" value="47" unit="min" tone="over" trend="↑" />
              <StatRow label="OEE" value="86.4" unit="%" tone="neutral" />
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-[var(--nd-border)] pt-6">
              <div>
                <p className="nd-label">Auto sync</p>
                <p className="nd-caption mt-2">Push updates every 15 min</p>
              </div>
              <button
                type="button"
                className={`nd-toggle ${toggleOn ? "nd-toggle-on" : ""}`}
                aria-pressed={toggleOn}
                onClick={() => setToggleOn((value) => !value)}
              >
                <span className="nd-toggle-thumb" />
              </button>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--nd-border)] py-12">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="nd-label">Module</p>
              <h2 className="nd-heading mt-3">Instrument panel</h2>
            </div>

            <div className="nd-segmented">
              {(["overview", "system", "storage"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`nd-segment ${segment === item ? "nd-segment-active" : ""}`}
                  onClick={() => setSegment(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="nd-surface p-6">
              <p className="nd-label">CPU load</p>
              <p className="nd-data nd-display-lg mt-4">42</p>
              <SegmentedProgress filled={8} total={12} tone="neutral" />
            </div>
            <div className="nd-surface p-6">
              <p className="nd-label">Memory</p>
              <p className="nd-data nd-display-lg mt-4 text-[var(--nd-warning)]">71</p>
              <SegmentedProgress filled={9} total={12} tone="warn" />
            </div>
            <div className="nd-surface p-6">
              <p className="nd-label">Temp</p>
              <p className="nd-data nd-display-lg mt-4 text-[var(--nd-success)]">38</p>
              <SegmentedProgress filled={5} total={12} tone="good" />
            </div>
          </div>
        </section>

        <section className="grid gap-12 border-t border-[var(--nd-border)] py-12 lg:grid-cols-2">
          <div>
            <p className="nd-label">Controls</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="nd-btn nd-btn-primary">
                Primary
              </button>
              <button type="button" className="nd-btn nd-btn-secondary">
                Secondary
              </button>
              <button type="button" className="nd-btn nd-btn-ghost">
                Ghost
              </button>
              <button type="button" className="nd-btn nd-btn-destructive">
                Delete
              </button>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              <span className="nd-tag nd-tag-active">Active</span>
              <span className="nd-tag">Draft</span>
              <span className="nd-tag">Archived</span>
            </div>

            <div className="mt-10">
              <label className="nd-label" htmlFor="line-code">
                Line code
              </label>
              <input id="line-code" className="nd-input mt-3" defaultValue="FB-LINE-04" />
            </div>

            <div className="mt-8 flex items-center gap-4">
              <button
                type="button"
                className="nd-btn nd-btn-secondary"
                onClick={() => {
                  setSaved(true);
                  window.setTimeout(() => setSaved(false), 2400);
                }}
              >
                Save
              </button>
              {saved ? <span className="nd-status">[SAVED]</span> : null}
            </div>
          </div>

          <div>
            <p className="nd-label">Shift log</p>
            <div className="nd-surface-raised mt-6 overflow-hidden">
              <table className="nd-table">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Status</th>
                    <th>Output</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="nd-row-active">
                    <td>Assembly A1</td>
                    <td style={{ color: "var(--nd-success)" }}>Running</td>
                    <td>1,248</td>
                  </tr>
                  <tr>
                    <td>Test B2</td>
                    <td style={{ color: "var(--nd-warning)" }}>Pending</td>
                    <td>892</td>
                  </tr>
                  <tr>
                    <td>Pack C3</td>
                    <td style={{ color: "var(--nd-accent)" }}>Stopped</td>
                    <td>0</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--nd-border)] py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="nd-label">Loading state</p>
              <div className="mt-4 flex items-center gap-4">
                <div className="nd-spinner-segments" aria-hidden="true">
                  <span className="nd-spinner-segment" />
                  <span className="nd-spinner-segment" />
                  <span className="nd-spinner-segment" />
                  <span className="nd-spinner-segment" />
                </div>
                <span className="nd-status">[LOADING...]</span>
              </div>
            </div>

            <div className="text-left md:text-right">
              <p className="nd-label">Period</p>
              <div className="mt-3 flex items-center gap-4">
                <button type="button" className="nd-btn nd-btn-ghost px-0">
                  &lt;
                </button>
                <span className="nd-label text-[var(--nd-text-display)]">Week 21 · 2026</span>
                <button type="button" className="nd-btn nd-btn-ghost px-0">
                  &gt;
                </button>
              </div>
            </div>
          </div>

          <p className="nd-caption mt-12 text-[var(--nd-text-disabled)]">
            Nothing-inspired UI tokens · Space Grotesk · Space Mono · No shadows · No toasts
          </p>
        </section>
      </div>
    </div>
  );
}
