import { calculateProductKpis, formatMinutes, getTimelineBounds, round } from "./calculations";
import { getStoredTaskOperatorIds } from "./operator-assignments";
import { compareTasksByWbs } from "./task-planning";
import { countTaskStepPhotoAttachments } from "./step-photos";
import { countTaskStepTools } from "./step-tools";
import type { PlannerState, Station, Task } from "./types";

function formatManHours(value: number) {
  return `${round(value, 1)} MH`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function documentCell(value: unknown, align: "left" | "right" | "center" = "left") {
  return `<td class="${align}">${escapeHtml(value)}</td>`;
}

function documentHeaderCell(value: unknown, align: "left" | "right" | "center" = "left") {
  return `<th class="${align}">${escapeHtml(value)}</th>`;
}

function isSummaryReportTask(task: Task, tasks: Task[]) {
  const childPrefix = `${task.wbs}.`;
  return tasks.some((candidate) => candidate.id !== task.id && candidate.wbs.startsWith(childPrefix));
}


function documentTable(headers: string[], rows: string[][], alignments: Array<"left" | "right" | "center"> = []) {
  const header = headers
    .map((item, index) => documentHeaderCell(item, alignments[index] ?? "left"))
    .join("");
  const body = rows.length
    ? rows.map((row) => `<tr>${row.join("")}</tr>`).join("\n")
    : `<tr><td colspan="${headers.length}" class="muted">No rows.</td></tr>`;

  return `<table>
    <thead><tr>${header}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function stationRows(stations: Station[]) {
  return stations
    .map(
      (station) =>
        `| ${station.sequence} | ${station.name} | ${formatMinutes(station.plannedCycleMinutes)} | ${formatManHours(
          station.plannedManHours,
        )} | ${station.plannedOperators} | ${station.taktStatus} | ${station.bottleneckFlag ? "Yes" : "No"} |`,
    )
    .join("\n");
}

function taskRows(tasks: Task[], stations: Station[]) {
  const stationById = new Map(stations.map((station) => [station.id, station]));

  return tasks
    .map((task) => {
      const station = stationById.get(task.stationId);
      const dependencyText = task.dependencyIds.length ? task.dependencyIds.join(", ") : "None";
      return `| ${task.wbs} | ${task.name} | ${station?.name ?? "Unassigned"} | ${formatMinutes(
        task.plannedDurationMinutes,
      )} | ${task.plannedOperators} | ${formatManHours(task.plannedManHours)} | ${dependencyText} | ${
        task.qualityGate ? "Yes" : "No"
      } |`;
    })
    .join("\n");
}

function taskReferenceSections(tasks: Task[]) {
  const tasksWithReferences = tasks.filter(
    (task) => (task.manufacturingSteps?.length ?? 0) > 0 || (task.partReferences?.length ?? 0) > 0,
  );

  if (tasksWithReferences.length === 0) {
    return "No task-level manufacturing steps or part references have been added.";
  }

  return tasksWithReferences
    .map((task) => {
      const stepRows =
        task.manufacturingSteps && task.manufacturingSteps.length > 0
          ? [
              "| Seq | Instruction | Minutes | Quality / Reference Check |",
              "|---:|---|---:|---|",
              ...[...task.manufacturingSteps]
                .sort((a, b) => a.sequence - b.sequence)
                .map(
                  (step) =>
                    `| ${step.sequence} | ${step.instruction || "TBD"} | ${
                      step.durationMinutes ?? ""
                    } | ${step.qualityCheck || ""} |`,
                ),
            ].join("\n")
          : "No manufacturing steps added.";

      const partRows =
        task.partReferences && task.partReferences.length > 0
          ? [
              "| Part Number | Description | Qty | Disposition / Note |",
              "|---|---|---:|---|",
              ...task.partReferences.map(
                (part) =>
                  `| ${part.partNumber || "TBD"} | ${part.description || ""} | ${
                    part.quantity ?? ""
                  } | ${part.disposition || ""} |`,
              ),
            ].join("\n")
          : "No part references added.";

      return `### ${task.wbs} ${task.name}

${stepRows}

${partRows}`;
    })
    .join("\n\n");
}

export function buildMarkdownReport(state: PlannerState) {
  const { product, scenario, stations, tasks, dependencies } = state;
  const kpis = calculateProductKpis(product, stations, tasks);

  return `# ${product.name} Line Plan

## Product Overview

- Product: ${product.name}
- SKU: ${product.sku ?? "N/A"}
- Family: ${product.family ?? "N/A"}
- Revision: ${product.revision}
- Status: ${product.status}
- Owner: ${product.ownerName}
- Scenario: ${scenario.name}

## Demand and Takt

- Demand: ${product.demandQuantity} unit(s) per ${product.demandPeriod}
- Workday Time: ${formatMinutes(product.grossAvailableMinutes)}
- Breaks: ${formatMinutes(product.breakMinutes)}
- Lunch: ${formatMinutes(product.lunchMinutes)}
- Work Days / Week: ${round(product.workDaysPerWeek, 2)}
- Weeks / Month: ${round(product.workWeeksPerMonth, 2)}
- Available Work Days / Month: ${round(kpis.availableWorkDaysPerMonth, 1)}
- Net Available Time / Day: ${formatMinutes(kpis.availableMinutes)}
- Net Available Time / Week: ${formatMinutes(kpis.weeklyAvailableMinutes)}
- Net Available Time / Month: ${formatMinutes(kpis.monthlyAvailableMinutes)}
- Meetings: ${formatMinutes(product.meetingMinutes)}
- Planned Downtime: ${formatMinutes(product.plannedDowntimeMinutes)}
- Active Takt Time: ${formatMinutes(kpis.taktMinutes)}
- Unit Lead Time: ${formatMinutes(kpis.plannedCycleMinutes)}

## Man-Hour Target

- Target Man-Hours: ${formatManHours(product.targetManHours)}
- Planned Man-Hours: ${formatManHours(kpis.plannedManHours)}
- Variance: ${formatManHours(kpis.targetVariance)}
- Variance Percent: ${round(kpis.targetVariancePercent, 1)}%
- Capacity Gap: ${formatManHours(kpis.capacityGapManHours)}

## Crew Equivalent

- Target Labor Budget: ${formatManHours(kpis.targetLaborBudgetManHours)} per ${product.demandPeriod}
- Budgeted Crew Equivalent: ${round(kpis.budgetedCrewEquivalent, 2)} FTE
- Whole-Person Staffing Requirement: ${kpis.wholePersonStaffingRequirement}
- Required Average Allocation: ${round(kpis.requiredAverageAllocationPercent, 1)}%
- Planned Labor Load: ${round(kpis.plannedLaborLoadFte, 2)} FTE
- Crew Utilization: ${round(kpis.crewUtilizationPercent, 1)}%
- Peak Manpower: ${round(kpis.peakManpower, 1)}

## Station Balance

- Bottleneck Station: ${kpis.bottleneckStation?.name ?? "None"}
- Line Balance Score: ${round(kpis.lineBalanceScore, 1)}%

| # | Station | Planned Cycle | Planned MH | Operators | Takt Status | Bottleneck |
|---:|---|---:|---:|---:|---|---|
${stationRows(stations)}

## Task List

| Task ID | Task | Station | Duration | Operators | Planned MH | Dependencies | Quality Gate |
|---|---|---|---:|---:|---:|---|---|
${taskRows(tasks, stations)}

## Task Manufacturing Steps and Part References

${taskReferenceSections(tasks)}

## Dependencies

${dependencies
  .map(
    (dependency) =>
      `- ${dependency.predecessorTaskId} -> ${dependency.successorTaskId} (${dependency.type}${
        dependency.constraintType ? `, ${dependency.constraintType}` : ""
      })`,
  )
  .join("\n")}

## Scenario Notes

${scenario.notes ?? "No scenario notes."}
`;
}

function setupChecklistItems({
  station,
  task,
  taktMinutes,
}: {
  station?: Station;
  task: Task;
  taktMinutes: number;
}) {
  const hasWorkInstruction = Boolean(task.workInstructionLink || task.sopLink);
  const hasManufacturingSteps = (task.manufacturingSteps?.length ?? 0) > 0;
  const hasQualityCheck =
    Boolean(task.qcChecklist || station?.qcNotes) ||
    (task.manufacturingSteps ?? []).some((step) => Boolean(step.qualityCheck));
  const hasSafetyNotes = Boolean(task.safetyNotes || station?.safetyNotes);
  const hasToolsOrEquipment = Boolean(
    (task.toolsRequired?.length ?? 0) > 0 ||
      (task.equipmentRequired?.length ?? 0) > 0 ||
      (station?.toolsRequired?.length ?? 0) > 0 ||
      (station?.equipmentRequired?.length ?? 0) > 0 ||
      countTaskStepTools(task) > 0,
  );
  const hasMaterialSetup = Boolean(task.materialKit || (task.partReferences?.length ?? 0) > 0);
  const hasOperators = getStoredTaskOperatorIds(task).length > 0;
  const hasStepPhotos = countTaskStepPhotoAttachments(task) > 0;
  const overTakt = taktMinutes > 0 && task.plannedDurationMinutes > taktMinutes;
  const items: string[] = [];

  if (!hasWorkInstruction) {
    items.push(hasManufacturingSteps ? "Convert entered steps into work instruction" : "Create work instruction");
  }

  if (task.travelerSignoffRequired) {
    items.push("Add traveler signoff requirement");
  }

  if (task.qualityGate) {
    items.push(hasQualityCheck ? "Add hard QC check to station/traveler" : "Define hard QC checklist");
  }

  if (!hasSafetyNotes) {
    items.push("Add safety notes");
  }

  if (!hasToolsOrEquipment) {
    items.push("Confirm tools and equipment");
  }

  if (!hasMaterialSetup) {
    items.push("Confirm material kit or part references");
  }

  if (hasManufacturingSteps && !hasStepPhotos) {
    items.push("Capture step photos");
  }

  if (!hasOperators) {
    items.push("Assign operator coverage");
  }

  if (overTakt) {
    items.push("Review takt overage");
  }

  if (items.length === 0) {
    items.push("Review entered setup before release");
  }

  return items;
}

function setupChecklistMarkup(items: string[]) {
  return `<ul class="checklist">${items.map((item) => `<li><span class="box"></span>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function taskSetupChecklistRows(state: PlannerState) {
  const { stations, tasks, zones } = state;
  const kpis = calculateProductKpis(state.product, stations, tasks);
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));

  return tasks
    .filter((task) => task.plannedDurationMinutes > 0)
    .filter((task) => !isSummaryReportTask(task, tasks))
    .sort(compareTasksByWbs)
    .map((task) => {
      const operators = getStoredTaskOperatorIds(task);
      const station = stationById.get(task.stationId);
      const zone = zoneById.get(task.zoneId ?? "");
      const checklistItems = setupChecklistItems({ station, task, taktMinutes: kpis.taktMinutes });
      return [
        documentCell(task.wbs, "right"),
        documentCell(`${task.name}${task.description ? ` - ${task.description}` : ""}`),
        documentCell(`${zone?.name ?? "Unzoned"} / ${station?.name ?? "Unassigned"}`),
        documentCell(`${formatMinutes(task.plannedDurationMinutes)} / ${operators.join(", ") || "Unassigned"}`),
        `<td>${setupChecklistMarkup(checklistItems)}</td>`,
      ];
    });
}

export function buildStationSetupDocumentHtml(state: PlannerState) {
  const { product, scenario, stations, tasks } = state;
  const kpis = calculateProductKpis(product, stations, tasks);
  const bounds = getTimelineBounds(tasks);
  const exportedAt = new Date().toLocaleString();

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(product.name)} Station Setup Document</title>
  <style>
    body { background: #fbfaf6; font-family: Arial, Helvetica, sans-serif; color: #13211b; margin: 32px; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h2 { border-bottom: 1px solid #d8d0c2; font-size: 16px; margin: 28px 0 10px; padding-bottom: 6px; }
    .meta { color: #52606d; font-size: 12px; margin-bottom: 18px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 18px; }
    .metric { background: #fff; border: 1px solid #d8d0c2; padding: 8px; }
    .metric-label { color: #52606d; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .metric-value { font-size: 16px; font-weight: 800; margin-top: 4px; }
    table { border-collapse: collapse; font-size: 11px; margin: 8px 0 18px; width: 100%; }
    th { background: #f4f0e7; color: #344253; font-size: 10px; text-transform: uppercase; }
    th, td { background: #fff; border: 1px solid #d8d0c2; padding: 6px; vertical-align: top; }
    .checklist { list-style: none; margin: 0; padding: 0; }
    .checklist li { margin: 0 0 5px; }
    .box { border: 1.5px solid #344253; display: inline-block; height: 10px; margin-right: 7px; vertical-align: -1px; width: 10px; }
    .right { text-align: right; }
    .center { text-align: center; }
    .muted { color: #52606d; }
    @media print {
      body { background: #fff; margin: 18px; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(product.name)} Station Setup Document</h1>
  <div class="meta">
    Scenario: ${escapeHtml(scenario.name)} | Revision: ${escapeHtml(product.revision)} | Exported: ${escapeHtml(exportedAt)}
  </div>

  <div class="summary">
    <div class="metric"><div class="metric-label">Required Takt</div><div class="metric-value">${escapeHtml(formatMinutes(kpis.taktMinutes))}</div></div>
    <div class="metric"><div class="metric-label">Planned Flow</div><div class="metric-value">${escapeHtml(formatMinutes(bounds.durationMinutes))}</div></div>
    <div class="metric"><div class="metric-label">Planned MH</div><div class="metric-value">${escapeHtml(formatManHours(kpis.plannedManHours))}</div></div>
    <div class="metric"><div class="metric-label">Peak Manpower</div><div class="metric-value">${escapeHtml(round(kpis.peakManpower, 1))}</div></div>
  </div>

  <h2>Station Setup Checklist</h2>
  ${documentTable(
    ["WBS", "Task", "Area", "Time / Operators", "Needed"],
    taskSetupChecklistRows(state),
    ["right", "left", "left", "left", "left"],
  )}
</body>
</html>`;
}
