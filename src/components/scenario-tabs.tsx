"use client";

import { useEffect, useState } from "react";

import type { ScenarioSummary } from "@/domain/types";

interface ScenarioTabsProps {
  scenarios: ScenarioSummary[];
  // The currently-loaded scenario id (always derivedState.scenario.id in the workspace).
  activeScenarioId: string;
  isSwitching?: boolean;
  onSwitch: (scenarioId: string) => void;
  onDuplicate: () => void;
  onEditTarget: (scenarioId: string, targetOutput: number, targetOutputPeriod: string) => void;
}

const PERIOD_ABBREV: Record<string, string> = {
  shift: "shift",
  day: "day",
  week: "wk",
  month: "mo",
  year: "yr",
  custom: "custom",
};

// Periods offered by the target editor (the availability model handles these; 'custom' is omitted).
const TARGET_PERIODS = ["shift", "day", "week", "month", "year"] as const;

function targetLabel(scenario: ScenarioSummary): string {
  const period = PERIOD_ABBREV[scenario.targetOutputPeriod] ?? scenario.targetOutputPeriod;
  return `${scenario.targetOutput}/${period}`;
}

// Scenario switcher tab strip shown above the Gantt. The earliest-created scenario (scenarios[0],
// ordered created_at asc by the loader) is the canonical "Main Plan"; every other scenario is an
// independent high-level projection copy. Supports switching, duplicating the active scenario, and
// editing a projection scenario's target (units + period), which drives its Gantt takt flagging.
export function ScenarioTabs({
  scenarios,
  activeScenarioId,
  isSwitching = false,
  onSwitch,
  onDuplicate,
  onEditTarget,
}: ScenarioTabsProps) {
  const mainId = scenarios[0]?.id;
  const active = scenarios.find((scenario) => scenario.id === activeScenarioId);
  const activeIsMain = active ? active.id === mainId : true;
  const activeId = active?.id;
  const activeTarget = active?.targetOutput;

  // Local, editable copy of the active scenario's target units (committed on blur / Enter). Resets
  // when the active scenario changes (switch) or its target changes (after a commit).
  const [units, setUnits] = useState<string>(activeTarget !== undefined ? String(activeTarget) : "");
  useEffect(() => {
    setUnits(activeTarget !== undefined ? String(activeTarget) : "");
  }, [activeId, activeTarget]);

  if (scenarios.length === 0) {
    return null;
  }

  function commitUnits() {
    if (!active || activeIsMain) {
      return;
    }
    const next = Number(units);
    if (Number.isFinite(next) && next > 0 && next !== active.targetOutput) {
      onEditTarget(active.id, next, active.targetOutputPeriod);
    } else {
      setUnits(String(active.targetOutput));
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Scenarios"
      className="flex items-center gap-1.5 border-b border-line bg-surface px-3 py-1.5 text-sm"
    >
      {scenarios.map((scenario) => {
        const isMain = scenario.id === mainId;
        const isActive = scenario.id === activeScenarioId;
        const label = isMain ? "Main Plan" : scenario.name || "Untitled scenario";

        return (
          <button
            key={scenario.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={isActive || isSwitching}
            title={!isMain && scenario.notes ? scenario.notes : undefined}
            onClick={() => onSwitch(scenario.id)}
            className={[
              "flex items-center gap-1.5 rounded-md border px-3 py-1 transition-colors",
              isActive
                ? "border-accent bg-accent-muted text-ink"
                : "border-line bg-surface text-ink-secondary hover:bg-surface-hover disabled:opacity-60",
            ].join(" ")}
          >
            <span className="font-medium">{label}</span>
            {!isMain ? (
              <span className="rounded bg-accent-subtle px-1 text-[10px] uppercase tracking-wide text-accent">
                Projection
              </span>
            ) : null}
            {!isMain ? <span className="text-xs text-ink-tertiary">{targetLabel(scenario)}</span> : null}
          </button>
        );
      })}

      <button
        type="button"
        onClick={onDuplicate}
        disabled={isSwitching}
        title="Duplicate the active scenario into a new high-level projection"
        className="flex items-center gap-1 rounded-md border border-dashed border-line px-2.5 py-1 text-ink-secondary hover:bg-surface-hover disabled:opacity-60"
      >
        + Duplicate
      </button>

      {isSwitching ? (
        <span className="text-xs text-ink-tertiary" aria-live="polite">
          Working…
        </span>
      ) : null}

      {/* Target editor (right-aligned). Main shows the product-derived takt source, read-only. */}
      <div className="ml-auto flex items-center gap-1.5 text-xs text-ink-secondary">
        {activeIsMain ? (
          <span title="Main Plan uses the product-level demand for takt">Target: from product</span>
        ) : active ? (
          <>
            <span>Target</span>
            <input
              type="number"
              min={1}
              value={units}
              disabled={isSwitching}
              onChange={(event) => setUnits(event.target.value)}
              onBlur={commitUnits}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              aria-label="Target units"
              className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-right text-ink"
            />
            <span>/</span>
            <select
              value={active.targetOutputPeriod}
              disabled={isSwitching}
              onChange={(event) => {
                const typed = Number(units);
                const safeUnits = Number.isFinite(typed) && typed > 0 ? typed : active.targetOutput;
                onEditTarget(active.id, safeUnits, event.target.value);
              }}
              aria-label="Target period"
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-ink"
            >
              {TARGET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {PERIOD_ABBREV[period] ?? period}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </div>
  );
}
