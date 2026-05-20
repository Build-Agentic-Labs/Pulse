"use client";

import { AlertTriangle, BarChart3, CheckCircle2, ClipboardList, GitBranch, LayoutDashboard, ListChecks } from "lucide-react";
import { useState, type ReactNode } from "react";
import { calculateProductKpis, formatMinutes, round } from "@/domain/calculations";
import type { SaveState } from "@/domain/supabase-planner";
import type { DemandPeriod, PlannerProjectContext, Product } from "@/domain/types";

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
  const toneClass =
    tone === "good"
      ? "border-teal/30 bg-[#ecf5f1]"
      : tone === "warn"
        ? "border-amber/40 bg-[#fbf1d9]"
        : tone === "bad"
          ? "border-signal/30 bg-[#f9e7e3]"
          : "border-line bg-white";

  return (
    <div className={`rounded-md border p-3 shadow-sm ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-steel">{label}</div>
      <div className="mt-2 text-xl font-black tracking-normal text-ink">{value}</div>
      {meta ? <div className="mt-1 truncate text-xs font-medium text-steel">{meta}</div> : null}
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
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Net Available Time" value={formatMinutes(kpis.availableMinutes)} meta={availabilityMeta} />
      <StatCard label="Required Takt" value={formatMinutes(kpis.taktMinutes)} meta="Active takt" tone={taktTone} />
      <StatCard label="Unit Lead Time" value={formatMinutes(kpis.plannedCycleMinutes)} meta="First task start to final finish" />
      <StatCard label="Planned MH" value={formatManHours(kpis.plannedManHours)} meta={plannedMhMeta} tone={varianceTone} />
      <StatCard
        label="Balance"
        value={`${round(kpis.lineBalanceScore, 1)}%`}
        meta={kpis.bottleneckStation?.name ?? "No scheduled work"}
      />
      <StatCard
        label="Capacity Gap"
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
        <div className="text-[10px] font-black uppercase tracking-wide text-steel">{label}</div>
        {meta ? <div className="mt-0.5 text-[11px] font-semibold text-steel">{meta}</div> : null}
      </div>
      <div className="text-right text-sm font-black text-ink">{value}</div>
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
      ? "border-teal/25 bg-teal/10 text-teal"
      : p.saveState === "error" || p.saveState === "retrying" || p.saveState === "conflict"
        ? "border-signal/25 bg-signal/10 text-signal"
        : "border-line bg-white text-steel";
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
  const attentionClass =
    attentionTone === "good"
      ? "border-teal/30 bg-[#ecf5f1]"
      : attentionTone === "warn"
        ? "border-amber/40 bg-[#fbf1d9]"
        : "border-signal/30 bg-[#f9e7e3]";
  const statusToneClass =
    p.product.status === "released" || p.product.status === "approved"
      ? "border-teal/25 bg-teal/10 text-teal"
      : p.product.status === "review"
        ? "border-amber/40 bg-[#fbf1d9] text-amber"
        : p.product.status === "obsolete"
          ? "border-signal/25 bg-signal/10 text-signal"
          : "border-line bg-[#fbfaf6] text-steel";
  const [attentionDismissed, setAttentionDismissed] = useState(false);
  const skuRev = [p.product.sku ? `SKU ${p.product.sku}` : null, `Rev ${p.product.revision}`]
    .filter(Boolean)
    .join(" · ");
  const demandMeta = `${round(p.product.demandQuantity, 0)} units per ${period}`;

  return (
    <div className="space-y-4 pb-4">
      <section className="rounded-md border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-copper">
              <LayoutDashboard size={20} />
              <span className="text-[11px] font-black uppercase tracking-wide">Planner Dashboard</span>
            </div>
            <h1 className="mt-2 text-2xl font-black text-ink">{p.product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusToneClass}`}
              >
                {productStatusLabel(p.product.status)}
              </span>
              <span className="text-xs font-semibold text-steel">Scenario {p.scenarioName}</span>
            </div>
            {p.project ? (
              <p className="mt-2 text-xs font-semibold text-steel">
                {p.project.workspaceName} / {p.project.projectName}
              </p>
            ) : null}
            {skuRev ? <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-steel">{skuRev}</p> : null}
          </div>
          <div className="flex min-w-[180px] flex-col items-end gap-1">
            <span
              className={`rounded border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${saveToneClass}`}
            >
              {saveLabel}
            </span>
            {p.saveError ? (
              <p className="max-w-[240px] text-right text-[11px] font-semibold text-signal">{p.saveError}</p>
            ) : null}
          </div>
        </div>
      </section>

      {!attentionDismissed ? (
        <section className={`rounded-md border p-4 shadow-sm ${attentionClass}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {feasible ? (
                <CheckCircle2 className="mt-0.5 shrink-0 text-teal" size={22} />
              ) : (
                <AlertTriangle className="mt-0.5 shrink-0 text-signal" size={22} />
              )}
              <div>
                <p className="text-sm font-black text-ink">
                  {!feasible
                    ? "Plan needs review"
                    : hasCrewPlanExceptions
                      ? "Line readiness needs attention"
                      : roundingCreatesUnusedCapacity
                        ? "Confirm staffing intent"
                        : "Plan looks feasible"}
                </p>
                <p className="mt-1 text-xs font-semibold text-steel">
                  {!feasible
                    ? "Adjust setup or scheduling before releasing this plan."
                    : hasCrewPlanExceptions
                      ? "Crew plan has unallocated work. Review the open items inside Line Readiness."
                      : roundingCreatesUnusedCapacity
                        ? "Rounding creates unused crew capacity — confirm staffing intent."
                        : "Labor, FTE load, and peak staffing are within budget."}
                </p>
                {failedChecks.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs font-semibold text-steel">
                    {failedChecks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setAttentionDismissed(true)}
                className="rounded border border-line bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-steel hover:border-copper hover:text-copper"
              >
                Dismiss
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <DashboardKpiStrip kpis={p.kpis} product={p.product} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>{p.children}</div>
        <aside className="space-y-4">
          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-ink">Plan Snapshot</h2>
            <p className="mt-1 text-xs font-semibold text-steel">Current scenario totals</p>
            <div className="mt-3">
              <SnapshotRow label="Demand" value={demandMeta} meta="Active demand period" />
              <SnapshotRow
                label="Flow Duration"
                value={formatMinutes(p.flowDurationMinutes)}
                meta="First start to final finish"
              />
              <SnapshotRow
                label="Peak Headcount"
                value={`${p.kpis.peakManpower}`}
                meta={`Rounded staffing ${p.kpis.wholePersonStaffingRequirement}`}
              />
              <SnapshotRow
                label="Budgeted Crew"
                value={`${round(p.kpis.budgetedCrewEquivalent, 2)} FTE`}
                meta={`${round(p.kpis.plannedLaborLoadFte, 2)} FTE planned load`}
              />
              <SnapshotRow label="Zones" value={`${p.zoneCount}`} />
              <SnapshotRow label="Tasks" value={`${p.taskCount}`} meta="Schedulable rows" />
              <SnapshotRow label="Stations" value={`${p.stationCount}`} meta="Top-level tasks" />
            </div>
          </section>

          <section className="rounded-md border border-line bg-[#fbfaf6] p-4 shadow-sm">
            <h2 className="text-sm font-black text-ink">Quick Actions</h2>
            <p className="mt-1 text-xs font-semibold text-steel">Jump to a workspace module</p>
            <div className="mt-3 space-y-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => p.onNavigateModule(action.id)}
                    className="flex w-full items-start gap-3 rounded-md border border-line bg-white p-3 text-left shadow-sm transition hover:border-copper hover:bg-white"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-copper/20 bg-[#fff7e8] text-copper">
                      <Icon size={18} />
                    </span>
                    <span>
                      <span className="block text-sm font-black text-ink">{action.label}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-steel">{action.description}</span>
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
