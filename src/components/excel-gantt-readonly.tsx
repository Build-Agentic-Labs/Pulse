"use client";

import { AlertTriangle, CalendarDays, Clock3, Factory, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  applyCalculatedFields,
  calculateProductKpis,
  formatMinutes,
  getTaskWindow,
  getTimelineBounds,
  round,
} from "@/domain/calculations";
import { loadPlannerStateFromSupabase } from "@/domain/supabase-planner";
import type { PlannerState, Task, Zone } from "@/domain/types";
import { chartPalette } from "@/theme/chart-tokens";
import { AppLoadingShell } from "@/components/app-flow-panels";

type LoadState = "loading" | "ready" | "error";

type GanttRow =
  | {
      kind: "zone";
      id: string;
      zone: Zone;
      tasks: Task[];
    }
  | {
      kind: "task";
      id: string;
      task: Task;
      zone?: Zone;
    };

const UNZONED_ZONE: Zone = {
  id: "unassigned-zone",
  scenarioId: "excel",
  sequence: 999,
  name: "Unzoned",
  color: chartPalette.steel,
  createdAt: "",
  updatedAt: "",
};

function compareWbsValues(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function getTopLevelTasks(tasks: Task[]) {
  return tasks
    .filter((task) => !task.parentTaskId)
    .sort((left, right) => compareWbsValues(left.wbs, right.wbs));
}

function formatHourOffset(minutes: number) {
  return `${round(minutes / 60, minutes % 60 === 0 ? 0 : 1)}h`;
}

function shortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function textColorForFill(fill: string) {
  const hex = fill.replace("#", "");
  if (hex.length !== 6) {
    return chartPalette.white;
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.65 ? chartPalette.ink : chartPalette.white;
}

function tickStep(durationMinutes: number) {
  if (durationMinutes > 1_440) {
    return 360;
  }

  if (durationMinutes > 720) {
    return 120;
  }

  return 60;
}

function buildTicks(durationMinutes: number) {
  const step = tickStep(durationMinutes);
  const ticks: number[] = [];

  for (let minute = 0; minute <= durationMinutes + step; minute += step) {
    ticks.push(minute);
  }

  return ticks;
}

function buildRows(tasks: Task[], zones: Zone[]): GanttRow[] {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const topLevelTasks = getTopLevelTasks(tasks);
  const tasksByZone = new Map<string, Task[]>();

  topLevelTasks.forEach((task) => {
    const zoneId = task.zoneId && zoneById.has(task.zoneId) ? task.zoneId : UNZONED_ZONE.id;
    tasksByZone.set(zoneId, [...(tasksByZone.get(zoneId) ?? []), task]);
  });

  const orderedZones = [
    ...zones.filter((zone) => tasksByZone.has(zone.id)).sort((left, right) => left.sequence - right.sequence),
    ...(tasksByZone.has(UNZONED_ZONE.id) ? [UNZONED_ZONE] : []),
  ];

  return orderedZones.flatMap((zone) => {
    const zoneTasks = tasksByZone.get(zone.id) ?? [];
    return [
      {
        kind: "zone" as const,
        id: `zone-${zone.id}`,
        zone,
        tasks: zoneTasks,
      },
      ...zoneTasks.map((task) => ({
        kind: "task" as const,
        id: `task-${task.id}`,
        task,
        zone,
      })),
    ];
  });
}

function metricValueClass(tone?: "warning" | "success") {
  if (tone === "warning") {
    return "border-danger/25 bg-danger-muted";
  }

  if (tone === "success") {
    return "border-accent/25 bg-accent-muted";
  }

  return "border-line bg-surface";
}

function MetricCard({
  icon: Icon,
  label,
  value,
  meta,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  meta: string;
  tone?: "warning" | "success";
}) {
  return (
    <div className={`rounded-md border p-3 ${metricValueClass(tone)}`}>
      <div className="flex items-center gap-2 ui-mono-label">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-2 text-xl font-medium leading-none text-ink">{value}</div>
      <div className="mt-1 truncate text-[11px] text-ink-secondary">{meta}</div>
    </div>
  );
}

export function ExcelGanttReadonly({ projectId, onReady }: { projectId?: string; onReady?: () => void }) {
  const [plannerState, setPlannerState] = useState<PlannerState>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  function loadPlanner() {
    setLoadState("loading");
    setError("");

    void loadPlannerStateFromSupabase(projectId)
      .then((state) => {
        if (!state) {
          throw new Error("No saved planner state was found.");
        }

        setPlannerState(state);
        setLoadState("ready");
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : "Unable to load planner state.");
        setLoadState("error");
      });
  }

  useEffect(() => {
    loadPlanner();
  }, [projectId]);

  useEffect(() => {
    if (loadState !== "loading") {
      onReady?.();
    }
  }, [loadState, onReady]);

  const derivedState = useMemo(() => {
    if (!plannerState) {
      return undefined;
    }

    const calculated = applyCalculatedFields(plannerState.product, plannerState.stations, plannerState.tasks);
    return {
      ...plannerState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };
  }, [plannerState]);

  const viewModel = useMemo(() => {
    if (!derivedState) {
      return undefined;
    }

    const topLevelTasks = getTopLevelTasks(derivedState.tasks);
    const bounds = getTimelineBounds(topLevelTasks);
    const rows = buildRows(topLevelTasks, derivedState.zones);
    const kpis = calculateProductKpis(derivedState.product, derivedState.stations, derivedState.tasks);
    const ticks = buildTicks(bounds.durationMinutes);

    return {
      bounds,
      kpis,
      rows,
      ticks,
      topLevelTasks,
    };
  }, [derivedState]);

  if (loadState === "loading" && !derivedState) {
    return (
      <AppLoadingShell title="Loading workspace" />
    );
  }

  return (
    <main className="h-[100dvh] overflow-y-auto bg-canvas text-ink">
      <section className="px-5 py-4">
        {loadState === "error" ? (
          <div className="rounded-md border border-danger/30 bg-danger-muted p-5 text-danger">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle size={16} />
              Unable to load Gantt
            </div>
            <div className="mt-1 text-xs font-bold">{error}</div>
          </div>
        ) : null}

        {derivedState && viewModel ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MetricCard
                icon={Clock3}
                label="Lead Time"
                value={formatMinutes(viewModel.bounds.durationMinutes)}
                meta="First task to final finish"
              />
              <MetricCard
                icon={CalendarDays}
                label="Required Takt"
                value={formatMinutes(viewModel.kpis.taktMinutes)}
                meta="Active takt"
                tone={viewModel.kpis.plannedCycleMinutes > viewModel.kpis.taktMinutes ? "warning" : undefined}
              />
              <MetricCard
                icon={Factory}
                label="Tasks"
                value={`${viewModel.topLevelTasks.length}`}
                meta={`${derivedState.zones.length} zones`}
              />
              <MetricCard
                icon={Users}
                label="Peak Crew"
                value={`${round(viewModel.kpis.peakManpower, 1)}`}
                meta="Planned simultaneous operators"
              />
              <MetricCard
                icon={Clock3}
                label="Planned MH"
                value={`${round(viewModel.kpis.plannedManHours, 1)} MH`}
                meta={`${round(viewModel.kpis.assignedPlannedManHours, 1)} assigned`}
                tone="success"
              />
              <MetricCard
                icon={AlertTriangle}
                label="Bottleneck"
                value={viewModel.kpis.bottleneckStation?.sequence ? `${viewModel.kpis.bottleneckStation.sequence}` : "-"}
                meta={viewModel.kpis.bottleneckStation?.name ?? "No active bottleneck"}
                tone="warning"
              />
            </div>

            <section className="overflow-hidden ui-panel ">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-raised px-4 py-3">
                <div>
                  <h2 className="text-base font-medium text-ink">Manufacturing Gantt</h2>
                  <div className="text-xs font-semibold text-steel">
                    {derivedState.product.name} / {derivedState.scenario.name} / view only
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-xs font-bold text-steel">
                    <div>{shortDateTime(new Date(viewModel.bounds.startMs).toISOString())}</div>
                    <div>to {shortDateTime(new Date(viewModel.bounds.finishMs).toISOString())}</div>
                  </div>
                  <button
                    type="button"
                    onClick={loadPlanner}
                    className="inline-flex h-9 items-center gap-2 ui-panel px-3 text-sm font-medium text-ink transition hover:bg-surface-sunken"
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="overflow-auto">
                <div className="min-w-[1120px]">
                  <div className="grid grid-cols-[360px_minmax(760px,1fr)] border-b border-line bg-surface">
                    <div className="border-r border-line px-4 py-3 ui-mono-label">
                      Task / Zone
                    </div>
                    <div className="relative h-11 px-4">
                      {viewModel.ticks.map((tick) => {
                        const left = `${Math.min((tick / viewModel.bounds.durationMinutes) * 100, 100)}%`;
                        return (
                          <div key={tick} className="absolute top-0 h-full border-l border-line/80" style={{ left }}>
                            <span className="absolute left-1 top-3 whitespace-nowrap text-[10px] font-medium text-steel">
                              {formatHourOffset(tick)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    {viewModel.rows.map((row) => {
                      if (row.kind === "zone") {
                        const zoneMinutes = row.tasks.reduce((total, task) => total + task.plannedDurationMinutes, 0);
                        return (
                          <div key={row.id} className="grid min-h-10 grid-cols-[360px_minmax(760px,1fr)] border-b border-line bg-surface-muted">
                            <div className="flex items-center gap-3 border-r border-line px-4 py-2">
                              <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: row.zone.color }} />
                              <div className="min-w-0">
                                <div className="truncate text-xs ui-mono-label tracking-wide text-ink">{row.zone.name}</div>
                                <div className="text-[10px] font-bold text-steel">
                                  {row.tasks.length} tasks / {formatMinutes(zoneMinutes)}
                                </div>
                              </div>
                            </div>
                            <div className="relative min-h-10 px-4">
                              {viewModel.ticks.map((tick) => (
                                <div
                                  key={tick}
                                  className="absolute top-0 h-full border-l border-line/60"
                                  style={{ left: `${Math.min((tick / viewModel.bounds.durationMinutes) * 100, 100)}%` }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      }

                      const window = getTaskWindow(row.task, viewModel.bounds.startMs);
                      const left = `${Math.min((window.startMinute / viewModel.bounds.durationMinutes) * 100, 100)}%`;
                      const width = `${Math.max(((window.finishMinute - window.startMinute) / viewModel.bounds.durationMinutes) * 100, 0.5)}%`;
                      const overTakt = viewModel.kpis.taktMinutes > 0 && row.task.plannedDurationMinutes > viewModel.kpis.taktMinutes;
                      const fill = overTakt ? "#c33d2e" : row.zone?.color ?? UNZONED_ZONE.color;

                      return (
                        <div key={row.id} className="grid min-h-[52px] grid-cols-[360px_minmax(760px,1fr)] border-b border-line bg-surface">
                          <div className="grid grid-cols-[46px_minmax(0,1fr)_76px] items-center gap-3 border-r border-line px-4 py-2">
                            <div className="font-mono text-sm font-medium text-steel">{row.task.wbs}</div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-ink">{row.task.name}</div>
                            </div>
                            <div className="text-right text-xs font-medium text-ink">
                              <div>{formatMinutes(row.task.plannedDurationMinutes)}</div>
                              <div className="font-mono text-[10px] text-steel">{round(row.task.plannedManHours, 1)} MH</div>
                            </div>
                          </div>

                          <div className="relative min-h-[52px] px-4">
                            {viewModel.ticks.map((tick) => (
                              <div
                                key={tick}
                                className="absolute top-0 h-full border-l border-line/60"
                                style={{ left: `${Math.min((tick / viewModel.bounds.durationMinutes) * 100, 100)}%` }}
                              />
                            ))}
                            <div
                              className="absolute top-3 flex h-7 min-w-12 items-center overflow-hidden rounded-sm px-2"
                              style={{
                                left,
                                width,
                                backgroundColor: fill,
                                color: textColorForFill(fill),
                              }}
                            >
                              <span className="truncate text-xs font-medium">
                                {row.task.wbs} {row.task.name}
                              </span>
                            </div>
                            <div
                              className="absolute top-10 h-1 rounded-full bg-black/10"
                              style={{
                                left,
                                width: `${Math.max((row.task.percentComplete / 100) * Number.parseFloat(width), 0)}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
