"use client";

import { AlertTriangle, BarChart3, CheckCircle2, ClipboardList, GitBranch, ListChecks } from "lucide-react";
import { useState, type ReactNode } from "react";
import { calculateProductKpis, formatMinutes, round } from "@/domain/calculations";
import type { SaveState } from "@/domain/supabase-planner";
import type { DemandPeriod, PlannerProjectContext, Product } from "@/domain/types";
import { projectContextLabel } from "@/lib/display-names";

function formatManHours(value: number) {
  return `${round(value, 1)} MH`;
}

function periodLabel(period: DemandPeriod) {
  return period === "week"
    ? "week"
    : period === "month"
      ? "month"
      : period === "year"
        ? "year"
        : period === "day"
          ? "day"
          : period === "shift"
            ? "shift"
            : "period";
}

function saveStateLabel(saveState: SaveState) {
  switch (saveState) {
    case "loading":
      return "Loading";
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "draft":
      return "Draft saved locally";
    case "retrying":
      return "Save failed - retrying";
    case "conflict":
      return "Conflict";
    case "error":
      return "Save failed";
    default:
      return "Save";
  }
}

function productStatusLabel(status: Product["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function metricToneClass(tone: "neutral" | "good" | "warn" | "bad") {
  if (tone === "good") return "ui-metric-card-good";
  if (tone === "warn") return "ui-metric-card-warn";
  if (tone === "bad") return "ui-metric-card-bad";
  return "";
}

function StatCard({
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
  return (
    <div className={`ui-metric-card ${metricToneClass(tone)}`}>
      <div className="ui-metric-card-label">{label}</div>
      <div className="ui-metric-card-value">{value}</div>
      {meta ? <div className="ui-metric-card-meta">{meta}</div> : null}
    </div>
  );
}

function DashboardKpiStrip({ kpis, product }: { kpis: ReturnType<typeof calculateProductKpis>; product: Product }) {
  const varianceTone = kpis.targetVariance <= 0 ? "good" : kpis.targetVariancePercent <= 10 ? "warn" : "bad";
  const taktTone = kpis.plannedCycleMinutes <= kpis.taktMinutes ? "good" : "bad";
  const plannedMhMeta =
    kpis.unassignedTaskCount > 0
      ? `${formatManHours(kpis.assignedPlannedManHours)} assigned · ${formatManHours(kpis.unassignedPlannedManHours)} unassigned`
      : `Target ${formatManHours(product.targetManHours)}`;
  const availabilityMeta = `${formatMinutes(kpis.weeklyAvailableMinutes)}/week · ${round(kpis.availableWorkDaysPerMonth, 1)} days/mo`;

  return (
    <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <StatCard label="Net available time" value={formatMinutes(kpis.availableMinutes)} meta={availabilityMeta} />
      <StatCard label="Required takt" value={formatMinutes(kpis.taktMinutes)} meta="Active takt" tone={taktTone} />
      <StatCard label="Unit lead time" value={formatMinutes(kpis.plannedCycleMinutes)} meta="First task start to final finish" />
      <StatCard label="Planned MH" value={formatManHours(kpis.plannedManHours)} meta={plannedMhMeta} tone={varianceTone} />
      <StatCard
        label="Balance"
        value={`${round(kpis.lineBalanceScore, 1)}%`}
        meta={kpis.bottleneckStation?.name ?? "No scheduled work"}
      />
      <StatCard
        label="Capacity gap"
        value={formatManHours(kpis.capacityGapManHours)}
        meta={kpis.capacityGapManHours >= 0 ? "Available labor ahead" : "Labor short"}
        tone={kpis.capacityGapManHours >= 0 ? "good" : "bad"}
      />
    </section>
  );
}

function SnapshotRow({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <div>
        <div className="text-[13px] text-ink-secondary">{label}</div>
        {meta ? <div className="mt-0.5 text-[11px] leading-snug text-ink-tertiary">{meta}</div> : null}
      </div>
      <div className="ui-row-value text-right">{value}</div>
    </div>
  );
}

const quickActions = [
  { id: "gantt", label: "Gantt", description: "Schedule and zones", icon: GitBranch },
  { id: "setup", label: "Setup", description: "Product inputs", icon: ClipboardList },
  { id: "procedure", label: "Procedure", description: "Step instructions", icon: ListChecks },
  { id: "balance", label: "Balance", description: "Station load", icon: BarChart3 },
] as const;

export function PlannerDashboardPanel(props: {
  product: Product;
  scenarioName: string;
  project?: PlannerProjectContext;
  saveState: SaveState;
  saveError?: string;
  kpis: ReturnType<typeof calculateProductKpis>;
  flowDurationMinutes: number;
  zoneCount: number;
  taskCount: number;
  stationCount: number;
  planningRecommendationCount: number;
  onNavigateModule: (moduleId: string) => void;
  children: ReactNode;
}) {
  const p = props;
  const period = periodLabel(p.product.demandPeriod);
  const plannedLaborFits = p.kpis.plannedManHours <= p.product.targetManHours;
  const plannedFteFits = p.kpis.plannedLaborLoadFte <= p.kpis.budgetedCrewEquivalent;
  const peakFits = p.kpis.peakManpower <= p.kpis.wholePersonStaffingRequirement;
  const feasible = plannedLaborFits && plannedFteFits && peakFits;
  const roundingCreatesUnusedCapacity =
    feasible && p.kpis.wholePersonStaffingRequirement > 0 && p.kpis.wholePersonStaffingRequirement > p.kpis.budgetedCrewEquivalent;
  const saveLabel = saveStateLabel(p.saveState);
  const saveToneClass =
    p.saveState === "saved"
      ? "ui-chip-accent"
      : p.saveState === "error" || p.saveState === "retrying" || p.saveState === "conflict"
        ? "ui-state-danger rounded-md px-2.5 py-1 text-[11px] font-semibold"
        : "ui-chip";
  const failedChecks = [
    !plannedLaborFits ? "planned MH exceeds target" : null,
    !plannedFteFits ? "planned load exceeds budgeted crew" : null,
    !peakFits ? "peak manpower exceeds rounded staffing" : null,
  ].filter(Boolean) as string[];
  const hasCrewPlanExceptions = p.planningRecommendationCount > 0;
  const attentionTone: "good" | "warn" | "bad" = !feasible
    ? "bad"
    : roundingCreatesUnusedCapacity || hasCrewPlanExceptions
      ? "warn"
      : "good";
  const noticeClass =
    attentionTone === "good" ? "ui-notice ui-notice-good" : attentionTone === "warn" ? "ui-notice ui-notice-warn" : "ui-notice ui-notice-bad";
  const statusToneClass =
    p.product.status === "released" || p.product.status === "approved"
      ? "ui-chip-accent"
      : p.product.status === "review"
        ? "ui-chip"
        : p.product.status === "obsolete"
          ? "ui-state-danger rounded-md px-2 py-0.5 text-[11px] font-semibold"
          : "ui-chip";
  const [attentionDismissed, setAttentionDismissed] = useState(false);
  const skuRev = [p.product.sku ? `SKU ${p.product.sku}` : null, `Rev ${p.product.revision}`]
    .filter(Boolean)
    .join(" · ");
  const demandMeta = `${round(p.product.demandQuantity, 0)} units per ${period}`;

  return (
    <div className="space-y-5 pb-4">
      <section className="ui-bento p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="ui-eyebrow">Planner dashboard</div>
            <h1 className="ui-brand mt-2">{p.product.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className={statusToneClass}>{productStatusLabel(p.product.status)}</span>
              <span className="ui-chip">Scenario {p.scenarioName}</span>
              {p.project ? (
                <span className="ui-chip">{projectContextLabel(p.project.projectName, p.project.workspaceName)}</span>
              ) : null}
              {skuRev ? <span className="ui-chip">{skuRev}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={saveToneClass}>{saveLabel}</span>
            {p.saveError ? (
              <p className="max-w-[240px] text-right text-[11px] font-medium text-danger">{p.saveError}</p>
            ) : null}
          </div>
        </div>
      </section>

      {!attentionDismissed ? (
        <section className={noticeClass}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {attentionTone === "good" ? (
                <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={20} />
              ) : (
                <AlertTriangle
                  className={`mt-0.5 shrink-0 ${attentionTone === "bad" ? "text-danger" : "text-accent"}`}
                  size={20}
                />
              )}
              <div>
                <p className="text-sm font-medium text-ink">
                  {!feasible
                    ? "Plan needs review"
                    : hasCrewPlanExceptions
                      ? "Line readiness needs attention"
                      : roundingCreatesUnusedCapacity
                        ? "Confirm staffing intent"
                        : "Plan looks feasible"}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                  {!feasible
                    ? "Adjust setup or scheduling before releasing this plan."
                    : hasCrewPlanExceptions
                      ? "Crew plan has unallocated work. Review the open items inside Line Readiness."
                      : roundingCreatesUnusedCapacity
                        ? "Rounding creates unused crew capacity — confirm staffing intent."
                        : "Labor, FTE load, and peak staffing are within budget."}
                </p>
                {failedChecks.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-sm text-ink-secondary">
                    {failedChecks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <button type="button" onClick={() => setAttentionDismissed(true)} className="ui-btn-secondary h-9 px-3 text-xs">
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <DashboardKpiStrip kpis={p.kpis} product={p.product} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div>{p.children}</div>
        <aside className="space-y-4">
          <section className="ui-panel p-3.5">
            <h2 className="ui-section-title">Plan snapshot</h2>
            <p className="ui-section-subtitle">Current scenario totals</p>
            <div className="mt-3">
              <SnapshotRow label="Demand" value={demandMeta} meta="Active demand period" />
              <SnapshotRow label="Flow duration" value={formatMinutes(p.flowDurationMinutes)} meta="First start to final finish" />
              <SnapshotRow
                label="Peak headcount"
                value={`${p.kpis.peakManpower}`}
                meta={`Rounded staffing ${p.kpis.wholePersonStaffingRequirement}`}
              />
              <SnapshotRow
                label="Budgeted crew"
                value={`${round(p.kpis.budgetedCrewEquivalent, 2)} FTE`}
                meta={`${round(p.kpis.plannedLaborLoadFte, 2)} FTE planned load`}
              />
              <SnapshotRow label="Zones" value={`${p.zoneCount}`} />
              <SnapshotRow label="Tasks" value={`${p.taskCount}`} meta="Schedulable rows" />
              <SnapshotRow label="Stations" value={`${p.stationCount}`} meta="Top-level tasks" />
            </div>
          </section>

          <section className="ui-panel p-3.5">
            <h2 className="ui-section-title">Quick actions</h2>
            <p className="ui-section-subtitle">Jump to a workspace module</p>
            <div className="mt-2.5 space-y-1.5">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => p.onNavigateModule(action.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface p-2.5 text-left transition duration-200 ease-ui hover:border-accent/30 hover:bg-surface-muted"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent">
                      <Icon size={15} />
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-ink">{action.label}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-secondary">{action.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
