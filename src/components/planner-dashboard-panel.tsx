"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { calculateProductKpis, formatMinutes, round } from "@/domain/calculations";
import type { DemandPeriod, Product } from "@/domain/types";

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

function productStatusLabel(status: Product["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatProductRevisionChip(revision: string) {
  const trimmed = revision.trim();
  if (!trimmed) return null;
  return /^rev\b/i.test(trimmed) ? trimmed : `Rev ${trimmed}`;
}

export function buildPlannerChromeContext(product: Product) {
  const skuRev = [product.sku ? `SKU ${product.sku}` : null, formatProductRevisionChip(product.revision)]
    .filter(Boolean)
    .join(" · ");
  const status = productStatusLabel(product.status);
  const statusClass =
    product.status === "obsolete"
      ? "font-semibold text-danger"
      : product.status === "released" || product.status === "approved"
        ? "text-ink"
        : undefined;

  return {
    title: product.name,
    status,
    statusClass,
    detail: skuRev || undefined,
  };
}

export type PlannerChromeContext = ReturnType<typeof buildPlannerChromeContext>;

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
    <section className="ui-metric-strip ui-planner-dashboard-kpis">
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
    <div className="ui-planner-snapshot-row">
      <div className="min-w-0">
        <div className="ui-row-label">{label}</div>
        {meta ? <div className="mt-0.5 ui-metric-card-meta">{meta}</div> : null}
      </div>
      <div className="ui-row-value shrink-0 text-right">{value}</div>
    </div>
  );
}

export function PlannerDashboardPanel(props: {
  product: Product;
  saveError?: string;
  kpis: ReturnType<typeof calculateProductKpis>;
  flowDurationMinutes: number;
  zoneCount: number;
  taskCount: number;
  stationCount: number;
  planningRecommendationCount: number;
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
    attentionTone === "good" ? "ui-planner-notice ui-planner-notice-good" : attentionTone === "warn" ? "ui-planner-notice ui-planner-notice-warn" : "ui-planner-notice ui-planner-notice-bad";
  const [attentionDismissed, setAttentionDismissed] = useState(false);
  const demandMeta = `${round(p.product.demandQuantity, 0)} units per ${period}`;

  return (
    <div className="ui-planner-dashboard">
      {p.saveError ? (
        <header className="ui-planner-dashboard-header">
          <p className="ui-section-subtitle font-medium text-danger">{p.saveError}</p>
        </header>
      ) : null}

      {!attentionDismissed ? (
        <section className={noticeClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              {attentionTone === "good" ? (
                <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={16} />
              ) : (
                <AlertTriangle
                  className={`mt-0.5 shrink-0 ${attentionTone === "bad" ? "text-danger" : "text-accent"}`}
                  size={16}
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {!feasible
                    ? "Plan needs review"
                    : hasCrewPlanExceptions
                      ? "Line readiness needs attention"
                      : roundingCreatesUnusedCapacity
                        ? "Confirm staffing intent"
                        : "Plan looks feasible"}
                </p>
                <p className="ui-section-subtitle leading-relaxed">
                  {!feasible
                    ? "Adjust setup or scheduling before releasing this plan."
                    : hasCrewPlanExceptions
                      ? "Crew plan has unallocated work. Review the open items below."
                      : roundingCreatesUnusedCapacity
                        ? "Rounding creates unused crew capacity — confirm staffing intent."
                        : "Labor, FTE load, and peak staffing are within budget."}
                </p>
                {failedChecks.length > 0 ? (
                  <ul className="ui-section-subtitle mt-1.5 list-disc space-y-0.5 pl-4">
                    {failedChecks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <button type="button" onClick={() => setAttentionDismissed(true)} className="ui-btn-ghost h-8 px-2 text-xs">
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <DashboardKpiStrip kpis={p.kpis} product={p.product} />

      <div className="ui-planner-dashboard-grid">
        <section className="ui-planner-dashboard-main">{p.children}</section>

        <aside className="ui-planner-dashboard-aside">
          <h2 className="ui-section-title">Plan snapshot</h2>
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
        </aside>
      </div>
    </div>
  );
}
