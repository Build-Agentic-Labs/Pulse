"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

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
  onDelete: (scenarioId: string) => void;
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
  onDelete,
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
    <div className="ui-scenario-tabs">
      <div role="tablist" aria-label="Scenarios" className="ui-scenario-tabs-strip">
        {scenarios.map((scenario) => {
          const isMain = scenario.id === mainId;
          const isActive = scenario.id === highlightId;
          const isPending = isSwitching && pendingScenarioId === scenario.id;

          if (renamingId === scenario.id) {
            return (
              <div key={scenario.id} className="ui-scenario-tab ui-scenario-tab-active">
                <input
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
                  className="ui-scenario-tab-rename"
                />
              </div>
            );
          }

          return (
            <div
              key={scenario.id}
              className={[
                "ui-scenario-tab",
                isActive ? "ui-scenario-tab-active" : "ui-scenario-tab-idle",
                isMain ? "ui-scenario-tab-main" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
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
                className="ui-scenario-tab-btn"
              >
                <span>{isMain ? "Main Plan" : scenario.name || "Untitled"}</span>
                {isPending ? <Loader2 size={12} className="shrink-0 animate-spin" /> : null}
              </button>
              {!isMain ? (
                <button
                  type="button"
                  disabled={isSwitching}
                  title="Delete this projection"
                  aria-label={`Delete ${scenario.name || "scenario"}`}
                  onClick={() => onDelete(scenario.id)}
                  className="ui-scenario-tab-close"
                >
                  <X size={11} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onDuplicate}
        disabled={isSwitching}
        title="Duplicate the active scenario into a new projection"
        aria-label="Duplicate scenario"
        className="ui-scenario-tabs-add"
      >
        <Plus size={14} />
      </button>

      <div className="ui-scenario-tabs-target">
        {activeIsMain ? (
          <span className="ui-scenario-tabs-target-note" title="Main Plan uses the product-level demand for takt">
            Takt from product demand
          </span>
        ) : active ? (
          <div className="ui-scenario-tabs-target-fields">
            <span className="ui-scenario-tabs-target-label">Target</span>
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
              className="ui-scenario-tabs-target-input"
            />
            <span className="ui-scenario-tabs-target-divider">/</span>
            <select
              value={active.targetOutputPeriod}
              disabled={isSwitching}
              onChange={(event) => {
                const typed = Number(units);
                const safeUnits = Number.isFinite(typed) && typed > 0 ? typed : active.targetOutput;
                onEditTarget(active.id, safeUnits, event.target.value);
              }}
              aria-label="Target period"
              className="ui-scenario-tabs-target-select"
            >
              {TARGET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}
