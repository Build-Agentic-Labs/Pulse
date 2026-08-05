"use client";

import { ChartPie, LayoutGrid } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuietLoading } from "@/components/quiet-loading";
import type { Department } from "@/domain/departments";
import {
  buildSopDashboardMetrics,
  departmentSopLifecycle,
  type DepartmentSopMetrics,
} from "@/domain/sop/dashboard";
import { listDepartments } from "@/lib/departments/store";
import { SOP_DEMAND_UPDATED_EVENT } from "@/lib/sop/dashboard-events";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { useSopWorkspace } from "./sop-workspace-provider";
import "./sop-dashboard.css";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load the SOP dashboard.";
}

function completionLabel(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function progressTone(value: number | null): "neutral" | "warning" | "success" {
  if (value !== null && value >= 100) return "success";
  if (value !== null && value > 0) return "warning";
  return "neutral";
}

function departmentStatusGradient(metrics: DepartmentSopMetrics): string {
  const lifecycle = departmentSopLifecycle(metrics);
  if (lifecycle.chartTotal <= 0) return "conic-gradient(var(--color-border) 0deg 360deg)";

  const segments = [
    { value: metrics.draft, color: "var(--color-ink)" },
    { value: metrics.inApproval, color: "var(--sop-dashboard-warning)" },
    { value: metrics.effective, color: "var(--sop-dashboard-success)" },
    { value: lifecycle.notStarted, color: "var(--color-border)" },
  ];
  let cursor = 0;
  const stops = segments.flatMap((segment) => {
    if (segment.value <= 0) return [];
    const start = cursor;
    cursor += (segment.value / lifecycle.chartTotal) * 100;
    return [`${segment.color} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`];
  });

  return `conic-gradient(${stops.join(", ")})`;
}

function SegmentedProgress({ metrics }: { metrics: DepartmentSopMetrics }) {
  const segmentCount = 12;
  const ratio = metrics.target > 0 ? Math.min(metrics.effective / metrics.target, 1) : 0;
  const filled = ratio > 0 ? Math.max(1, Math.round(ratio * segmentCount)) : 0;
  const tone = progressTone(metrics.completionPercent);

  return (
    <div
      className="sop-dashboard-progress"
      role={metrics.target > 0 ? "progressbar" : undefined}
      aria-label={`${metrics.name} SOP completion`}
      aria-valuemin={metrics.target > 0 ? 0 : undefined}
      aria-valuemax={metrics.target > 0 ? metrics.target : undefined}
      aria-valuenow={metrics.target > 0 ? metrics.effective : undefined}
      aria-valuetext={metrics.target > 0 ? `${metrics.effective} of ${metrics.target} effective` : "Target not set"}
    >
      {Array.from({ length: segmentCount }, (_, index) => (
        <span
          key={index}
          className={`sop-dashboard-progress-segment ${
            index < filled ? `sop-dashboard-progress-${tone}` : ""
          }`}
        />
      ))}
    </div>
  );
}

function DepartmentCard({ metrics }: { metrics: DepartmentSopMetrics }) {
  const tone = progressTone(metrics.completionPercent);

  return (
    <article className="sop-dashboard-card sop-dashboard-summary-card">
      <header className="sop-dashboard-card-header">
        <div className="min-w-0">
          <h2 title={metrics.name}>{metrics.name}</h2>
        </div>
        <div className={`sop-dashboard-card-percent sop-dashboard-value-${tone}`}>
          {completionLabel(metrics.completionPercent)}
        </div>
      </header>

      <SegmentedProgress metrics={metrics} />

      <div className="sop-dashboard-card-metrics">
        <div>
          <span>Draft</span>
          <strong>{metrics.draft}</strong>
        </div>
        <div>
          <span>In approval</span>
          <strong>{metrics.inApproval}</strong>
        </div>
        <div>
          <span>Effective</span>
          <strong className={metrics.effective > 0 ? "sop-dashboard-value-success" : ""}>
            {metrics.effective}
          </strong>
        </div>
      </div>

      <footer className="sop-dashboard-card-footer">
        <span>{metrics.target > 0 ? `Total ${metrics.target}` : "Total not set"}</span>
        <span>{metrics.target > 0 ? `${metrics.remaining} remaining` : "Set in Quality settings"}</span>
      </footer>
    </article>
  );
}

function DepartmentDonutCard({ metrics }: { metrics: DepartmentSopMetrics }) {
  const lifecycle = departmentSopLifecycle(metrics);
  const gradient = departmentStatusGradient(metrics);
  const completion = completionLabel(metrics.completionPercent);
  const tone = progressTone(metrics.completionPercent);

  return (
    <article className={`sop-dashboard-card sop-dashboard-donut-card sop-dashboard-donut-card-${tone}`}>
      <header className="sop-dashboard-card-header">
        <h2 title={metrics.name}>{metrics.name}</h2>
        <div className="sop-dashboard-donut-total">
          <span>Total</span>
          <strong>{metrics.target}</strong>
        </div>
      </header>

      <div className="sop-dashboard-donut-body">
        <div
          className="sop-dashboard-department-donut"
          role="img"
          aria-label={`${metrics.name}: ${metrics.draft} draft, ${metrics.inApproval} in approval, ${metrics.effective} effective, ${lifecycle.notStarted} not started`}
        >
          <div
            className="sop-dashboard-department-donut-chart"
            style={{ background: gradient }}
            aria-hidden="true"
          />
          <div className="sop-dashboard-department-donut-center">
            <strong>{completion}</strong>
            <span>Effective</span>
          </div>
        </div>

        <ul className="sop-dashboard-donut-legend" aria-label={`${metrics.name} SOP status`}>
          <li>
            <span className="sop-dashboard-donut-swatch sop-dashboard-donut-swatch-draft" aria-hidden="true" />
            Draft
            <strong>{metrics.draft}</strong>
          </li>
          <li>
            <span className="sop-dashboard-donut-swatch sop-dashboard-donut-swatch-approval" aria-hidden="true" />
            In approval
            <strong>{metrics.inApproval}</strong>
          </li>
          <li>
            <span className="sop-dashboard-donut-swatch sop-dashboard-donut-swatch-effective" aria-hidden="true" />
            Effective
            <strong>{metrics.effective}</strong>
          </li>
          <li>
            <span className="sop-dashboard-donut-swatch sop-dashboard-donut-swatch-not-started" aria-hidden="true" />
            Not started
            <strong>{lifecycle.notStarted}</strong>
          </li>
        </ul>
      </div>

      <footer className="sop-dashboard-card-footer">
        <span>
          {metrics.effective} of {metrics.target} effective
        </span>
        <span>
          {lifecycle.overTarget > 0
            ? `+${lifecycle.overTarget} over target`
            : `${metrics.remaining} remaining`}
        </span>
      </footer>
    </article>
  );
}

export function SopDashboard({
  active = true,
  preload = false,
  initialSops,
  initialDepartments,
  initialWorkspaceId,
}: {
  active?: boolean;
  preload?: boolean;
  initialSops?: SopListItem[];
  initialDepartments?: Department[];
  initialWorkspaceId?: string;
}) {
  const { workspaceId } = useSopWorkspace();
  const seeded =
    initialSops !== undefined &&
    initialDepartments !== undefined &&
    initialWorkspaceId === workspaceId;
  const [sops, setSops] = useState<SopListItem[]>(seeded ? initialSops : []);
  const [departments, setDepartments] = useState<Department[]>(seeded ? initialDepartments : []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(seeded ? "ready" : "loading");
  const [error, setError] = useState("");
  const [departmentView, setDepartmentView] = useState<"cards" | "chart">("cards");
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>(
    seeded ? { workspaceId, loadedAt: Date.now() } : { loadedAt: 0 },
  );

  const refresh = useCallback(async (options: { background?: boolean } = {}) => {
    if (!workspaceId) {
      setSops([]);
      setDepartments([]);
      setStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return;
    }

    if (!options.background) setStatus("loading");
    setError("");
    try {
      const [nextSops, nextDepartments] = await Promise.all([
        listSops(workspaceId),
        listDepartments(workspaceId),
      ]);
      setSops(nextSops);
      setDepartments(nextDepartments);
      setStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
    } catch (caught) {
      setError(errorMessage(caught));
      if (!options.background) setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!active && !preload) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 15_000) return;
    void refresh({ background: hasCurrentData });
  }, [active, preload, refresh, workspaceId]);

  useEffect(() => {
    const handleDemandUpdate = () => void refresh({ background: true });
    window.addEventListener(SOP_DEMAND_UPDATED_EVENT, handleDemandUpdate);
    return () => window.removeEventListener(SOP_DEMAND_UPDATED_EVENT, handleDemandUpdate);
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => void refresh({ background: true }), 15_000);
    return () => window.clearInterval(interval);
  }, [active, refresh]);

  const metrics = useMemo(
    () => buildSopDashboardMetrics(departments, sops),
    [departments, sops],
  );

  if (status === "loading") {
    return <QuietLoading active={active} label="Loading dashboard" reserveClassName="min-h-[360px]" />;
  }

  if (status === "error") {
    return (
      <div className="sop-dashboard-state">
        <span>[DASHBOARD UNAVAILABLE]</span>
        <p>{error}</p>
        <button type="button" className="ui-btn-ghost" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="sop-dashboard mx-auto max-w-7xl">
      <header className="sop-dashboard-page-header">
        <div className="sop-dashboard-page-copy">
          <div className="sop-dashboard-kicker">Quality command center</div>
          <h1>SOP readiness</h1>
          <p>Approval flow and effective coverage in one live view.</p>
        </div>
        <section className="sop-dashboard-hero" aria-label="Overall SOP completion">
          <div className="sop-dashboard-hero-main">
            <span className="sop-dashboard-kicker">Overall completion</span>
            <div className="sop-dashboard-hero-value">
              {metrics.completionPercent === null ? "—" : metrics.completionPercent}
              {metrics.completionPercent !== null ? <small>%</small> : null}
            </div>
            {metrics.target > 0 ? (
              <p>
                {`${metrics.effective} effective SOP${metrics.effective === 1 ? "" : "s"} against ${metrics.target} required.`}
              </p>
            ) : null}
          </div>
          <div className="sop-dashboard-hero-stats">
            <div>
              <span>Total SOPs</span>
              <strong>{metrics.target}</strong>
            </div>
            <div>
              <span>In motion</span>
              <strong>{metrics.draft + metrics.inApproval}</strong>
            </div>
            <div>
              <span>Remaining</span>
              <strong>{metrics.remaining}</strong>
            </div>
          </div>
          <div className="sop-dashboard-dot-field" aria-hidden />
        </section>
      </header>

      {error ? <div className="sop-dashboard-inline-status">[REFRESH ERROR] {error}</div> : null}

      <section className="sop-dashboard-departments" aria-labelledby="department-progress-title">
        <div className="sop-dashboard-section-heading">
          <div>
            <h2 id="department-progress-title">Progress by department</h2>
          </div>
          <div className="sop-dashboard-section-actions">
            <span className="sop-dashboard-section-count">{metrics.departments.length} departments</span>
            <div className="sop-dashboard-view-toggle" role="group" aria-label="Department progress view">
              <button
                type="button"
                className={departmentView === "cards" ? "sop-dashboard-view-toggle-active" : ""}
                aria-pressed={departmentView === "cards"}
                onClick={() => setDepartmentView("cards")}
              >
                <LayoutGrid size={13} strokeWidth={1.75} aria-hidden="true" />
                Cards
              </button>
              <button
                type="button"
                className={departmentView === "chart" ? "sop-dashboard-view-toggle-active" : ""}
                aria-pressed={departmentView === "chart"}
                onClick={() => setDepartmentView("chart")}
              >
                <ChartPie size={13} strokeWidth={1.75} aria-hidden="true" />
                Pie chart
              </button>
            </div>
          </div>
        </div>

        {metrics.departments.length === 0 ? (
          <div className="sop-dashboard-state">
            <span>[NO DEPARTMENTS]</span>
            <p>Create departments in Quality settings before setting SOP demand.</p>
          </div>
        ) : departmentView === "cards" ? (
          <div className="sop-dashboard-grid sop-dashboard-card-grid">
            {metrics.departments.map((department) => (
              <DepartmentCard key={department.departmentId} metrics={department} />
            ))}
          </div>
        ) : (
          <div className="sop-dashboard-grid sop-dashboard-donut-grid">
            {metrics.departments.map((department) => (
              <DepartmentDonutCard key={department.departmentId} metrics={department} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
