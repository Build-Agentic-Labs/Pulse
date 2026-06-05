"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";

import type { ScenarioSummary } from "@/domain/types";

interface ScenarioTabsProps {
  scenarios: ScenarioSummary[];
  // The currently-loaded scenario id (always derivedState.scenario.id in the workspace).
  activeScenarioId: string;
  // The scenario being switched to (set immediately on click for instant tab feedback).
  pendingScenarioId?: string;
  isSwitching?: boolean;
  onSwitch: (scenarioId: string) => void;
  onDuplicate: () => void;
  onRename: (scenarioId: string, name: string) => void;
  onEditTarget: (scenarioId: string, targetOutput: number, targetOutputPeriod: string) => void;
}

// Periods offered by the target editor (the availability model handles these; 'custom' is omitted).
const TARGET_PERIODS = ["shift", "day", "week", "month", "year"] as const;

// Scenario switcher shown above the Gantt. The earliest-created scenario (scenarios[0], ordered
// created_at asc by the loader) is the canonical "Main Plan"; every other scenario is an independent
// high-level projection. Switch (click), duplicate (+ Duplicate), rename a projection (double-click),
// and set a projection's target (units + period, which drives its Gantt takt). Main can't be renamed.
export function ScenarioTabs({
  scenarios,
  activeScenarioId,
  pendingScenarioId,
  isSwitching = false,
  onSwitch,
  onDuplicate,
  onRename,
  onEditTarget,
}: ScenarioTabsProps) {
  const mainId = scenarios[0]?.id;
  // While switching, highlight the target tab immediately (don't wait for the reload to finish).
  const highlightId = isSwitching && pendingScenarioId ? pendingScenarioId : activeScenarioId;
  const active = scenarios.find((scenario) => scenario.id === activeScenarioId);
  const activeIsMain = active ? active.id === mainId : true;

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingId]);

  const activeId = active?.id;
  const activeTarget = active?.targetOutput;
  const [units, setUnits] = useState(activeTarget !== undefined ? String(activeTarget) : "");
  useEffect(() => {
    setUnits(activeTarget !== undefined ? String(activeTarget) : "");
  }, [activeId, activeTarget]);

  if (scenarios.length === 0) {
    return null;
  }

  function startRename(scenario: ScenarioSummary) {
    setRenamingId(scenario.id);
    setDraftName(scenario.name);
  }

  function commitRename() {
    const id = renamingId;
    setRenamingId(null);
    if (!id) {
      return;
    }
    const current = scenarios.find((scenario) => scenario.id === id);
    const name = draftName.trim();
    if (current && name && name !== current.name) {
      onRename(id, name);
    }
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
      className="flex items-stretch gap-1 border-b border-line bg-surface px-3 text-sm"
    >
      {scenarios.map((scenario) => {
        const isMain = scenario.id === mainId;
        const isActive = scenario.id === highlightId;
        const isPending = isSwitching && pendingScenarioId === scenario.id;

        if (renamingId === scenario.id) {
          return (
            <input
              key={scenario.id}
              ref={renameRef}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitRename();
                } else if (event.key === "Escape") {
                  setRenamingId(null);
                }
              }}
              aria-label="Rename scenario"
              className="my-1.5 w-44 self-center rounded border border-accent bg-surface px-2 py-0.5 text-ink"
            />
          );
        }

        return (
          <button
            key={scenario.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={isSwitching}
            title={isMain ? "Master plan" : scenario.notes || "Double-click to rename"}
            onClick={() => onSwitch(scenario.id)}
            onDoubleClick={() => {
              if (!isMain) {
                startRename(scenario);
              }
            }}
            className={[
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-medium transition-colors",
              isActive
                ? "border-accent text-ink"
                : "border-transparent text-ink-tertiary hover:text-ink-secondary disabled:opacity-60",
            ].join(" ")}
          >
            <span>{isMain ? "Main Plan" : scenario.name || "Untitled"}</span>
            {isPending ? <Loader2 size={13} className="animate-spin text-accent" /> : null}
          </button>
        );
      })}

      <button
        type="button"
        onClick={onDuplicate}
        disabled={isSwitching}
        title="Duplicate the active scenario into a new projection"
        className="my-1.5 ml-1 flex items-center gap-1 self-center rounded-md px-2 py-1 text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink-secondary disabled:opacity-60"
      >
        <Plus size={14} />
        Duplicate
      </button>

      {/* Target editor (right). Main is read-only (takt comes from product-level demand). */}
      <div className="ml-auto flex items-center gap-1.5 self-center text-xs text-ink-tertiary">
        {activeIsMain ? (
          <span title="Main Plan uses the product-level demand for takt">Takt from product demand</span>
        ) : active ? (
          <>
            <span className="text-ink-secondary">Target</span>
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
              className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-right text-ink"
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
              className="rounded border border-line bg-surface px-1 py-0.5 text-ink"
            >
              {TARGET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </div>
  );
}
