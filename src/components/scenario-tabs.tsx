import type { ScenarioSummary } from "@/domain/types";

interface ScenarioTabsProps {
  scenarios: ScenarioSummary[];
  // The currently-loaded scenario id (always derivedState.scenario.id in the workspace).
  activeScenarioId: string;
  isSwitching?: boolean;
  onSwitch: (scenarioId: string) => void;
}

const PERIOD_ABBREV: Record<string, string> = {
  shift: "shift",
  day: "day",
  week: "wk",
  month: "mo",
  year: "yr",
  custom: "custom",
};

function targetLabel(scenario: ScenarioSummary): string {
  const period = PERIOD_ABBREV[scenario.targetOutputPeriod] ?? scenario.targetOutputPeriod;
  return `${scenario.targetOutput}/${period}`;
}

// Scenario switcher tab strip shown above the Gantt. The earliest-created scenario (scenarios[0],
// ordered created_at asc by the loader) is the canonical "Main Plan"; every other scenario is an
// independent projection copy. Switching is the only action here in Phase 1 (duplicate/rename/delete
// arrive in later phases).
export function ScenarioTabs({ scenarios, activeScenarioId, isSwitching = false, onSwitch }: ScenarioTabsProps) {
  if (scenarios.length === 0) {
    return null;
  }

  const mainId = scenarios[0]?.id;

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
      {isSwitching ? (
        <span className="ml-1 text-xs text-ink-tertiary" aria-live="polite">
          Switching…
        </span>
      ) : null}
    </div>
  );
}
