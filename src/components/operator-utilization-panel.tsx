"use client";

import { useMemo } from "react";
import { formatMinutes, round } from "@/domain/calculations";
import { computeOperatorIdleAnalysis } from "@/domain/operator-allocation";
import type { Task } from "@/domain/types";

/**
 * Labor utilization / idle-time analysis for the active scenario. Shows, per operator, how much of
 * the line's run they spend working vs. idle (waiting for their next task), plus the line-level
 * roll-up: efficiency and balance delay (idle %). Idle = makespan − busy, so a low-utilization
 * operator is one standing around while the line runs. Pure read of the current tasks; updates as
 * the plan is edited or optimized.
 */
export function OperatorUtilizationPanel({
  tasks,
  availableOperatorIds,
}: {
  tasks: Task[];
  availableOperatorIds: string[];
}) {
  const analysis = useMemo(
    () => computeOperatorIdleAnalysis(tasks, availableOperatorIds),
    [tasks, availableOperatorIds],
  );

  const efficiency = round(analysis.efficiencyPercent, 0);
  const efficiencyColor =
    analysis.efficiencyPercent >= 85
      ? "var(--color-success)"
      : analysis.efficiencyPercent >= 70
        ? "var(--color-warning, var(--color-accent))"
        : "var(--color-danger)";

  return (
    <section className="ui-panel mt-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="ui-section-title">Labor utilization</h3>
          <p className="ui-section-subtitle">
            Idle = time an operator waits, on the clock but not working, while the line runs.
          </p>
        </div>
        {analysis.operatorsUsed > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            <Rollup label="Line efficiency" value={`${efficiency}%`} valueColor={efficiencyColor} />
            <Rollup label="Idle (balance delay)" value={`${round(analysis.balanceDelayPercent, 0)}%`} />
            <Rollup label="Total idle" value={formatMinutes(analysis.totalIdleMinutes)} />
            <Rollup label="Operators" value={`${analysis.operatorsUsed}`} />
          </div>
        ) : null}
      </div>

      {analysis.operatorsUsed === 0 ? (
        <p className="mt-3 ui-mono-label text-ink-tertiary">
          No operators assigned yet. Run Optimize line or assign operators on the Gantt to see idle time.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {analysis.operators.map((operator) => {
            const utilization = Math.min(100, Math.max(0, operator.utilizationPercent));
            return (
              <div key={operator.operatorId} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-ink">
                  {operator.operatorId}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted" title={`${round(operator.utilizationPercent, 0)}% utilized`}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${utilization}%`, backgroundColor: "var(--color-accent)" }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right ui-mono-label">
                  <span className="text-ink-secondary">{formatMinutes(operator.busyMinutes)} work</span>
                  <span className="mx-1 text-ink-tertiary">·</span>
                  <span className={operator.idleMinutes > 0 ? "text-danger" : "text-ink-tertiary"}>
                    {formatMinutes(operator.idleMinutes)} idle
                  </span>
                  <span className="ml-1 font-semibold text-steel">{round(operator.utilizationPercent, 0)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Rollup({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="text-right">
      <div className="ui-mono-label text-ink-tertiary">{label}</div>
      <div className="text-sm font-semibold text-ink" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
    </div>
  );
}
