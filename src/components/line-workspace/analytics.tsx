"use client";

import { AlertTriangle, ChevronDown, ChevronUp, Timer } from "lucide-react";
import { useMemo, useState } from "react";
import {
  calculateAvailabilityMinutesForDemandPeriod,
  calculatePeakManpower,
  calculateTaskManHours,
  calculateProductKpis,
  formatMinutes,
  getTopLevelTasks,
  round,
} from "@/domain/calculations";
import { getTaskOperatorIds } from "@/domain/operator-assignments";
import { type UnallocatedWorkReview } from "@/domain/smart-allocation-report";
import { formatManHours, periodLabel } from "@/domain/formatting";
import type { Product, Station, Task, Zone } from "@/domain/types";
import { WORKER_ICON_LETTERS, WorkerIcon } from "../worker-icon";
import { StatCard } from "./shared";

export function KpiStrip({ kpis, product }: { kpis: ReturnType<typeof calculateProductKpis>; product: Product }) {
  const varianceTone = kpis.targetVariance <= 0 ? "good" : kpis.targetVariancePercent <= 10 ? "warn" : "bad";
  const taktTone = kpis.taktMinutes <= 0 ? "neutral" : kpis.plannedCycleMinutes <= kpis.taktMinutes ? "good" : "bad";
  const unitCycleMinutes = kpis.bottleneckStation?.plannedCycleMinutes ?? 0;
  const unitCycleTone = kpis.taktMinutes <= 0 ? "neutral" : unitCycleMinutes <= kpis.taktMinutes ? "good" : "bad";
  const balanceTone = kpis.lineBalanceScore >= 85 ? "good" : kpis.lineBalanceScore >= 70 ? "warn" : "bad";
  const bottleneckTone = kpis.bottleneckStation
    ? kpis.bottleneckStation.taktStatus === "red"
      ? "bad"
      : kpis.bottleneckStation.taktStatus === "yellow"
        ? "warn"
        : "neutral"
    : "neutral";
  const plannedMhMeta = kpis.unassignedTaskCount > 0
    ? `${formatManHours(kpis.assignedPlannedManHours)} assigned - ${formatManHours(kpis.unassignedPlannedManHours)} unassigned`
    : `Target ${formatManHours(product.targetManHours)}`;
  const unitCycleMeta = kpis.bottleneckStation
    ? `${kpis.bottleneckStation.name} is the bottleneck`
    : "No scheduled work";
  const bottleneckValue = kpis.bottleneckStation?.name ?? "-";
  const bottleneckMeta = kpis.bottleneckStation
    ? `Cycle ${formatMinutes(kpis.bottleneckStation.plannedCycleMinutes)}`
    : "No scheduled work";
  const balanceMeta = `Variance ${formatManHours(kpis.targetVariance)} vs target`;

  return (
    <section className="ui-kpi-strip">
      <StatCard label="Required Takt" value={formatMinutes(kpis.taktMinutes)} meta="Active takt" tone={taktTone} />
      <StatCard label="Unit Lead Time" value={formatMinutes(kpis.plannedCycleMinutes)} meta="First task start to final finish" />
      <StatCard label="Planned MH" value={formatManHours(kpis.plannedManHours)} meta={plannedMhMeta} tone={varianceTone} />
      <StatCard label="Unit Cycle Time" value={formatMinutes(unitCycleMinutes)} meta={unitCycleMeta} tone={unitCycleTone} />
      <StatCard label="Bottleneck" value={bottleneckValue} meta={bottleneckMeta} tone={bottleneckTone} />
      <StatCard label="Line Balance" value={`${round(kpis.lineBalanceScore, 1)}%`} meta={balanceMeta} tone={balanceTone} />
    </section>
  );
}

interface ZoneMetric {
  id: string;
  name: string;
  color: string;
  taskCount: number;
  headcount: number;
  manHours: number;
  cycleMinutes: number;
}

function buildZoneMetrics(zones: Zone[], tasks: Task[]): ZoneMetric[] {
  const topLevelTasks = getTopLevelTasks(tasks);
  const sortedZones = [...zones].sort((a, b) => a.sequence - b.sequence);
  const metrics = sortedZones.map((zone) => {
    const zoneTasks = topLevelTasks.filter((task) => task.zoneId === zone.id);
    return {
      id: zone.id,
      name: zone.name || "Untitled zone",
      color: zone.color,
      taskCount: zoneTasks.length,
      headcount: calculatePeakManpower(zoneTasks),
      manHours: zoneTasks.reduce((total, task) => total + calculateTaskManHours(task), 0),
      cycleMinutes: Math.max(0, ...zoneTasks.map((task) => task.plannedDurationMinutes)),
    };
  });

  const assignedZoneIds = new Set(sortedZones.map((zone) => zone.id));
  const unzonedTasks = topLevelTasks.filter((task) => !task.zoneId || !assignedZoneIds.has(task.zoneId));
  if (unzonedTasks.length) {
    metrics.push({
      id: "zone-unzoned",
      name: "Unzoned",
      color: "#52606d",
      taskCount: unzonedTasks.length,
      headcount: calculatePeakManpower(unzonedTasks),
      manHours: unzonedTasks.reduce((total, task) => total + calculateTaskManHours(task), 0),
      cycleMinutes: Math.max(0, ...unzonedTasks.map((task) => task.plannedDurationMinutes)),
    });
  }

  return metrics;
}

function ZoneMetricsPanel({
  zones,
  tasks,
  compact = false,
  embedded = false,
}: {
  zones: Zone[];
  tasks: Task[];
  compact?: boolean;
  embedded?: boolean;
}) {
  const metrics = buildZoneMetrics(zones, tasks);

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line bg-surface-raised p-3 text-xs font-semibold text-ink-secondary">
        Create a zone in the Gantt to see headcount, man-hours, and cycle time by area.
      </div>
    );
  }

  if (embedded) {
    return (
      <div className="ui-planner-zone-list">
        {metrics.map((metric) => (
          <div key={metric.id} className="ui-planner-zone-row">
            <div className="ui-planner-zone-name">
              <span className="ui-planner-zone-dot" style={{ backgroundColor: metric.color }} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{metric.name}</div>
                <div className="text-[11px] text-ink-tertiary">{metric.taskCount} tasks</div>
              </div>
            </div>
            <div className="ui-planner-zone-metrics">
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">HC</div>
                <div className="ui-row-value mt-0.5">{round(metric.headcount, 1)}</div>
              </div>
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">MH</div>
                <div className="ui-row-value mt-0.5">{formatManHours(metric.manHours)}</div>
              </div>
              <div className="ui-planner-zone-metric">
                <div className="ui-mono-label">Cycle</div>
                <div className="ui-row-value mt-0.5">{formatMinutes(metric.cycleMinutes)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3"}`}>
      {metrics.map((metric) => (
        <div key={metric.id} className="ui-panel-raised p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs ui-mono-label tracking-wide text-ink">{metric.name}</div>
              <div className="text-[11px] font-semibold text-ink-secondary">{metric.taskCount} high-level task(s)</div>
            </div>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: metric.color }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="ui-mono-label">{compact ? "HC" : "Headcount"}</div>
              <div className="mt-1 text-lg font-medium text-ink">{round(metric.headcount, 1)}</div>
            </div>
            <div>
              <div className="ui-mono-label">MHs</div>
              <div className="mt-1 text-lg font-medium text-ink">{formatManHours(metric.manHours)}</div>
            </div>
            <div>
              <div className="ui-mono-label">Cycle</div>
              <div className="mt-1 text-lg font-medium text-ink">{formatMinutes(metric.cycleMinutes)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CrewReadinessCard({
  kpis,
  onClearPlanningRecommendations,
  onOpenTaskDetail,
  planningRecommendations = [],
  product,
  tasks,
  compact = false,
  embedded = false,
}: {
  kpis: ReturnType<typeof calculateProductKpis>;
  onClearPlanningRecommendations?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  planningRecommendations?: UnallocatedWorkReview[];
  product: Product;
  tasks: Task[];
  compact?: boolean;
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const period = periodLabel(product.demandPeriod);
  const plannedLaborFits = kpis.plannedManHours <= product.targetManHours;
  const plannedFteFits = kpis.plannedLaborLoadFte <= kpis.budgetedCrewEquivalent;
  const peakFits = kpis.peakManpower <= kpis.wholePersonStaffingRequirement;
  const feasible = plannedLaborFits && plannedFteFits && peakFits;
  const visibleWorkerCount = Math.min(Math.max(kpis.wholePersonStaffingRequirement, 0), WORKER_ICON_LETTERS.length);
  const visibleWorkers = WORKER_ICON_LETTERS.slice(0, visibleWorkerCount);
  const operatorAllocations = useMemo(() => {
    const periodMinutes = calculateAvailabilityMinutesForDemandPeriod(product);
    const demandQuantity = Math.max(product.demandQuantity, 0);
    const allocationMinutes = Object.fromEntries(visibleWorkers.map((letter) => [letter, 0]));

    getTopLevelTasks(tasks).forEach((task) => {
      const assignedOperators = getTaskOperatorIds(task, visibleWorkers);
      const taskPeriodMinutes = Math.max(task.plannedDurationMinutes, 0) * demandQuantity;

      assignedOperators.forEach((operatorId) => {
        allocationMinutes[operatorId] = (allocationMinutes[operatorId] ?? 0) + taskPeriodMinutes;
      });
    });

    return Object.fromEntries(
      visibleWorkers.map((letter) => [
        letter,
        periodMinutes > 0 ? Math.min((allocationMinutes[letter] / periodMinutes) * 100, 999) : 0,
      ]),
    );
  }, [product, tasks, visibleWorkers]);
  const roundingCreatesUnusedCapacity =
    feasible && kpis.wholePersonStaffingRequirement > 0 && kpis.wholePersonStaffingRequirement > kpis.budgetedCrewEquivalent;
  const toneClass = !feasible
    ? "border-line border-l-danger"
    : roundingCreatesUnusedCapacity
      ? "border-line border-l-warn"
      : "border-line border-l-accent";
  const statusClass = !feasible
    ? "border-danger/25 bg-danger-muted/10 text-danger"
    : roundingCreatesUnusedCapacity
      ? "border-warn/30 bg-warn-muted/20 text-warn-strong"
      : "border-accent/20 bg-accent/10 text-accent";
  const statusLabel = feasible ? "Feasible" : "Needs Review";
  const planChecks = [
    {
      label: "Planned MH/unit",
      value: `${formatManHours(kpis.plannedManHours)} / ${formatManHours(product.targetManHours)}`,
      fits: plannedLaborFits,
    },
    {
      label: "Planned Load",
      value: `${round(kpis.plannedLaborLoadFte, 2)} / ${round(kpis.budgetedCrewEquivalent, 2)} FTE`,
      fits: plannedFteFits,
    },
    {
      label: "Peak Manpower",
      value: `${round(kpis.peakManpower, 1)} / ${kpis.wholePersonStaffingRequirement}`,
      fits: peakFits,
    },
    ...(kpis.unassignedTaskCount > 0
      ? [
          {
            label: "Unassigned Labor",
            value: `${formatManHours(kpis.unassignedPlannedManHours)} · ${kpis.unassignedTaskCount} task(s)`,
            fits: false,
          },
        ]
      : []),
  ];

  const expandedBody = expanded ? (
    <>
      <div className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "xl:grid-cols-[250px_minmax(0,1fr)_220px]"}`}>
        <div className={`space-y-2 ${compact ? "" : "xl:border-r xl:border-line xl:pr-4"}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Rounded Staffing</span>
            <span className="text-sm font-medium text-ink">{kpis.wholePersonStaffingRequirement} people</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Avg Allocation</span>
            <span className="text-sm font-medium text-ink">{round(kpis.requiredAverageAllocationPercent, 1)}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-mono-label">Labor Budget</span>
            <span className="text-sm font-medium text-ink">{formatManHours(kpis.targetLaborBudgetManHours)}/{period}</span>
          </div>
        </div>

        <div className={`min-w-0 ${compact ? "border-t border-line pt-3" : "xl:border-r xl:border-line xl:px-4"}`}>
          <div className="mb-2 ui-mono-label">Plan Fit</div>
          <div className={`grid gap-x-5 gap-y-2 ${compact ? "grid-cols-1" : "sm:grid-cols-4"}`}>
            {planChecks.map((check) => (
              <div key={check.label} className="min-w-0">
                <div className="flex items-center gap-1.5 ui-mono-label">
                  <span className={`h-1.5 w-1.5 rounded-full ${check.fits ? "bg-accent" : "bg-danger"}`} />
                  {check.label}
                </div>
                <div className={`mt-1 text-sm font-medium ${check.fits ? "text-ink" : "text-danger"}`}>{check.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`min-w-0 bg-surface ${compact ? "border-t border-line pt-3" : "xl:pl-1"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="ui-mono-label">Operators</div>
            <div className="text-[10px] font-medium text-ink-secondary">
              {visibleWorkerCount}/{kpis.wholePersonStaffingRequirement}
            </div>
          </div>
          {visibleWorkers.length ? (
            <div className="grid grid-cols-4 gap-x-2 gap-y-2">
              {visibleWorkers.map((letter, index) => {
                const allocation = operatorAllocations[letter] ?? 0;
                return (
                  <div
                    key={letter}
                    className="flex min-w-0 flex-col items-center gap-0.5 bg-surface"
                    title={`Operator ${letter}: ${allocation}% allocated`}
                  >
                    <WorkerIcon colorIndex={index} letter={letter} />
                    <span className="text-[9px] font-medium leading-none text-ink-secondary">{round(allocation, 0)}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] font-semibold text-ink-secondary">No staffing requirement yet.</div>
          )}
          {kpis.wholePersonStaffingRequirement > WORKER_ICON_LETTERS.length ? (
            <div className="mt-2 text-[10px] font-semibold text-ink-secondary">First {WORKER_ICON_LETTERS.length} icons shown.</div>
          ) : null}
        </div>
      </div>

      {!embedded ? (
        <PlanningRecommendationsPanel
          onClear={onClearPlanningRecommendations}
          recommendations={planningRecommendations}
          onOpenTaskDetail={onOpenTaskDetail}
        />
      ) : null}
    </>
  ) : null;

  if (embedded) {
    return (
      <div className="ui-planner-crew">
        <div className="ui-metric-strip ui-planner-crew-metrics">
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Budgeted crew</div>
            <div className="ui-metric-card-value">{round(kpis.budgetedCrewEquivalent, 2)} FTE</div>
            <div className="ui-metric-card-meta">
              {kpis.wholePersonStaffingRequirement} people · {round(kpis.requiredAverageAllocationPercent, 1)}% avg
            </div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Peak manpower</div>
            <div className="ui-metric-card-value">{round(kpis.peakManpower, 1)}</div>
            <div className="ui-metric-card-meta">Rounded {kpis.wholePersonStaffingRequirement}</div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Planned load</div>
            <div className="ui-metric-card-value">{round(kpis.plannedLaborLoadFte, 2)} FTE</div>
            <div className="ui-metric-card-meta">Budget {round(kpis.budgetedCrewEquivalent, 2)} FTE</div>
          </div>
          <div className="ui-metric-card">
            <div className="ui-metric-card-label">Status</div>
            <div className={`ui-metric-card-value ${feasible ? "" : "text-danger"}`}>{statusLabel}</div>
            {planningRecommendations.length > 0 ? (
              <div className="ui-metric-card-meta text-warn-strong">{planningRecommendations.length} open</div>
            ) : null}
          </div>
        </div>
        {planningRecommendations.length > 0 ? (
          <PlanningRecommendationsPanel
            embedded
            onClear={onClearPlanningRecommendations}
            recommendations={planningRecommendations}
            onOpenTaskDetail={onOpenTaskDetail}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`ui-crew-card rounded-md border border-l-4 bg-surface ${expanded ? "p-3" : "p-3"} ${toneClass}`}>
      <div
        className={`flex flex-wrap items-start justify-between gap-3 ${expanded ? "border-b border-line pb-3" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="ui-eyebrow">Budgeted Crew</div>
          <div className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-1">
            <span className="text-xl font-medium leading-none tracking-normal text-ink">
              {round(kpis.budgetedCrewEquivalent, 2)}
            </span>
            <span className="pb-0.5 text-xs ui-mono-label text-ink">FTE</span>
            {!expanded ? (
              <span className="pb-0.5 text-[11px] font-medium text-ink-secondary">
                · {kpis.wholePersonStaffingRequirement} people · {round(kpis.requiredAverageAllocationPercent, 1)}% avg
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {planningRecommendations.length > 0 ? (
            <span className="inline-flex h-6 items-center rounded border border-warn/35 bg-accent-muted px-2 text-[10px] ui-mono-label tracking-wide text-warn-strong">
              {planningRecommendations.length} open
            </span>
          ) : null}
          <span className={`inline-flex h-7 items-center rounded border px-2 text-[11px] ui-mono-label ${statusClass}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-ink-secondary transition hover:border-line hover:bg-surface-muted hover:text-ink"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse crew plan" : "Expand crew plan"}
            title={expanded ? "Collapse crew plan" : "Expand crew plan"}
          >
            {expanded ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {expandedBody}
    </div>
  );
}

function PlanningRecommendationsPanel({
  embedded = false,
  onClear,
  onOpenTaskDetail,
  recommendations,
}: {
  embedded?: boolean;
  onClear?: () => void;
  onOpenTaskDetail?: (taskId: string) => void;
  recommendations: UnallocatedWorkReview[];
}) {
  const [showAll, setShowAll] = useState(false);

  if (recommendations.length === 0) {
    return null;
  }

  const visibleRecommendations = embedded
    ? recommendations.slice(0, 3)
    : showAll
      ? recommendations
      : recommendations.slice(0, 4);
  const hiddenCount = recommendations.length - visibleRecommendations.length;

  if (embedded) {
    return (
      <div className="ui-planner-recommendations">
        <div className="ui-planner-readiness-section-head">
          <div>
            <div className="ui-planner-recommendations-title">Open allocations</div>
            <p className="ui-planner-recommendations-subtitle">
              {recommendations.length} required task{recommendations.length === 1 ? "" : "s"} still unallocated
            </p>
          </div>
          {onClear ? (
            <button type="button" onClick={onClear} className="ui-btn-ghost h-8 px-2 text-xs">
              Clear
            </button>
          ) : null}
        </div>

        <div>
          {visibleRecommendations.map((recommendation) => (
            <div key={recommendation.taskId} className="ui-planner-recommendation-row">
              <div className="min-w-0 flex-1">
                <div className="ui-planner-recommendation-title truncate" title={recommendation.taskLabel}>
                  {recommendation.taskLabel}
                </div>
                <div className="ui-planner-recommendation-condition">{recommendation.condition}</div>
                <div className="ui-planner-recommendation-copy">{recommendation.recommendation}</div>
              </div>
              {onOpenTaskDetail ? (
                <button
                  type="button"
                  onClick={() => onOpenTaskDetail(recommendation.taskId)}
                  className="ui-btn-ghost h-8 shrink-0 px-2 text-xs"
                >
                  Review
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {hiddenCount > 0 ? (
          <p className="ui-planner-recommendations-more">
            {hiddenCount} more in the Smart Allocation audit packet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-planner-recommendations-compact mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] ui-mono-label tracking-wide text-warn-strong">
            <AlertTriangle size={13} />
            Planning Recommendations
          </div>
          <div className="mt-1 text-[11px] leading-snug text-ink-secondary">
            {recommendations.length} allocation issue{recommendations.length === 1 ? "" : "s"} need review.
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hiddenCount > 0 || showAll ? (
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              className="ui-btn-ghost h-7 px-2 text-[10px]"
            >
              {showAll ? "Show less" : `Show all ${recommendations.length}`}
            </button>
          ) : null}
          {onClear ? (
            <button type="button" onClick={onClear} className="ui-btn-ghost h-7 px-2 text-[10px]">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 divide-y divide-line border-y border-line">
        {visibleRecommendations.map((recommendation) => (
          <div key={recommendation.taskId} className="grid gap-2 py-2.5 text-xs lg:grid-cols-[minmax(150px,0.7fr)_minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium text-ink" title={recommendation.taskLabel}>
                {recommendation.taskLabel}
              </div>
              <div className="mt-0.5 text-[10px] ui-mono-label text-warn-strong">{recommendation.classification}</div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] leading-snug text-ink-secondary" title={recommendation.condition}>
                {recommendation.condition}
              </div>
              <div className="truncate text-[11px] leading-snug text-ink" title={recommendation.recommendation}>
                {recommendation.recommendation}
              </div>
            </div>
            {onOpenTaskDetail ? (
              <button
                type="button"
                onClick={() => onOpenTaskDetail(recommendation.taskId)}
                className="ui-btn-ghost h-7 justify-self-start px-2 text-[10px] lg:justify-self-end"
              >
                Review
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineReadinessPanel({
  allocationRecommendations,
  onClearPlanningRecommendations,
  scenarioName,
  stationCount,
  taskCount,
  zones,
  tasks,
  bottleneckStation,
  targetVariance,
  targetVariancePercent,
  kpis,
  onOpenTaskDetail,
  product,
  compact = false,
  embedded = false,
}: {
  allocationRecommendations?: UnallocatedWorkReview[];
  onClearPlanningRecommendations?: () => void;
  scenarioName: string;
  stationCount: number;
  taskCount: number;
  zones: Zone[];
  tasks: Task[];
  bottleneckStation?: Station;
  targetVariance: number;
  targetVariancePercent: number;
  kpis: ReturnType<typeof calculateProductKpis>;
  onOpenTaskDetail?: (taskId: string) => void;
  product: Product;
  compact?: boolean;
  embedded?: boolean;
}) {
  const content = (
    <div className={embedded ? "ui-planner-readiness" : "space-y-5"}>
      {!embedded ? (
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="ui-section-title text-base">Line readiness</h2>
            <div className="ui-section-subtitle">{scenarioName}</div>
          </div>
          <Timer className="text-accent" size={20} />
        </div>
      ) : (
        <div className="ui-planner-readiness-head">
          <h2 className="ui-section-title">Line readiness</h2>
          <p className="ui-section-subtitle">{scenarioName}</p>
        </div>
      )}

      {!embedded ? (
        <div>
          <div className="mb-3 ui-mono-label">Line summary</div>
          <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
            <StatCard label="Stations" value={`${stationCount}`} meta="High-level tasks" />
            <StatCard label="Tasks" value={`${taskCount}`} meta="Schedulable rows" />
            <StatCard
              label="Bottleneck"
              value={bottleneckStation ? `${bottleneckStation.sequence}` : "-"}
              meta={bottleneckStation?.name ?? "No scheduled work"}
              tone={bottleneckStation ? (bottleneckStation.taktStatus === "red" ? "bad" : "warn") : "neutral"}
            />
            <StatCard
              label="Variance"
              value={formatManHours(targetVariance)}
              meta={`${round(targetVariancePercent, 1)}% vs target`}
              tone={targetVariance <= 0 ? "good" : "bad"}
            />
          </div>
        </div>
      ) : null}

      <section className={embedded ? "ui-planner-readiness-section" : undefined}>
        {embedded ? (
          <div className="ui-planner-readiness-section-head">
            <div>
              <h3 className="ui-planner-readiness-section-title">Crew plan</h3>
              <p className="ui-section-subtitle">Budget, load, and staffing fit</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 ui-mono-label">Crew plan</div>
        )}
        <CrewReadinessCard
          kpis={kpis}
          onClearPlanningRecommendations={onClearPlanningRecommendations}
          onOpenTaskDetail={onOpenTaskDetail}
          planningRecommendations={allocationRecommendations}
          product={product}
          tasks={tasks}
          compact={compact || embedded}
          embedded={embedded}
        />
      </section>

      <section className={embedded ? "ui-planner-readiness-section" : undefined}>
        {embedded ? (
          <div className="ui-planner-readiness-section-head">
            <div>
              <h3 className="ui-planner-readiness-section-title">Zones</h3>
              <p className="ui-section-subtitle">Headcount, man-hours, and cycle by area</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 ui-mono-label">Zone metrics</div>
        )}
        <ZoneMetricsPanel zones={zones} tasks={tasks} compact={compact || embedded} embedded={embedded} />
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <section className="ui-readiness-workspace">{content}</section>;
}
