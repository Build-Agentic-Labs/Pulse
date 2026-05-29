import { calculatePeakManpower, calculateTaskManHours } from "./calculations";
import type { Station, Task, Zone } from "./types";

/**
 * Pure task/zone/station planning helpers extracted from line-workspace.tsx.
 *
 * These derive WBS process grouping, zone normalization, and the synthetic
 * stations shown in the planner. Every function is pure and returns new
 * objects rather than mutating its inputs.
 */

export function getTaskProcessNumber(task: Task) {
  return task.wbs.split(".")[0] || task.wbs;
}

export function getTaskWbsSuffix(task: Task) {
  const parts = task.wbs.split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : "";
}

export function normalizeTaskGroupZones(tasks: Task[]) {
  const tasksByProcess = tasks.reduce((groups, task) => {
    const processNumber = getTaskProcessNumber(task);
    const group = groups.get(processNumber);
    if (group) {
      group.push(task);
    } else {
      groups.set(processNumber, [task]);
    }

    return groups;
  }, new Map<string, Task[]>());

  const zoneIdByProcess = new Map<string, string | undefined>();

  tasksByProcess.forEach((groupTasks, processNumber) => {
    const topLevelTask = groupTasks.find((task) => task.wbs === processNumber);
    zoneIdByProcess.set(processNumber, topLevelTask ? topLevelTask.zoneId : groupTasks.find((task) => task.zoneId)?.zoneId);
  });

  return tasks.map((task) => {
    const zoneId = zoneIdByProcess.get(getTaskProcessNumber(task));
    return task.zoneId === zoneId ? task : { ...task, zoneId };
  });
}

export function stationIdForZone(zoneId: string) {
  return `station-${zoneId}`;
}

export function stationIdForUnzoned(scenarioId: string) {
  return `station-${scenarioId}-unzoned`;
}

export function normalizeTaskPlanningContext(tasks: Task[], zones: Zone[], stations: Station[], scenarioId: string) {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const zoneNormalizedTasks = normalizeTaskGroupZones(tasks);
  const stationNormalizedTasks = zoneNormalizedTasks.map((task) => {
    if (task.zoneId && zoneById.has(task.zoneId)) {
      const stationId = stationIdForZone(task.zoneId);
      return task.stationId === stationId ? task : { ...task, stationId };
    }

    if (zones.length === 0 && stationById.has(task.stationId)) {
      return task;
    }

    const stationId = stationIdForUnzoned(task.scenarioId || scenarioId);
    return task.stationId === stationId ? task : { ...task, stationId };
  });
  const stationIdsInUse = new Set(stationNormalizedTasks.map((task) => task.stationId).filter(Boolean));
  const generatedStations = zones.reduce<Station[]>((stationsDraft, zone) => {
      const stationId = stationIdForZone(zone.id);
      const zoneTasks = stationNormalizedTasks.filter((task) => task.stationId === stationId);
      if (zoneTasks.length === 0) {
        return stationsDraft;
      }

      const existing = stationById.get(stationId);
      stationsDraft.push({
        id: stationId,
        scenarioId: zone.scenarioId,
        sequence: zone.sequence,
        name: zone.name || "Untitled zone",
        description: existing?.description,
        ownerName: existing?.ownerName ?? "",
        plannedCycleMinutes: 0,
        plannedOperators: calculatePeakManpower(zoneTasks),
        plannedManHours: 0,
        taktStatus: "missing",
        bottleneckFlag: false,
        area: zone.name || "Untitled zone",
        toolsRequired: existing?.toolsRequired,
        equipmentRequired: existing?.equipmentRequired,
        safetyNotes: existing?.safetyNotes,
        qcNotes: existing?.qcNotes,
      });
      return stationsDraft;
    }, []);

  const unzonedTasks = stationNormalizedTasks.filter((task) => task.stationId === stationIdForUnzoned(task.scenarioId || scenarioId));
  if (unzonedTasks.length > 0) {
    const stationId = stationIdForUnzoned(scenarioId);
    const existing = stationById.get(stationId);
    generatedStations.push({
      id: stationId,
      scenarioId,
      sequence: zones.length + 1,
      name: "Unzoned",
      description: existing?.description,
      ownerName: existing?.ownerName ?? "",
      plannedCycleMinutes: 0,
      plannedOperators: calculatePeakManpower(unzonedTasks),
      plannedManHours: 0,
      taktStatus: "missing",
      bottleneckFlag: false,
      area: "Unzoned",
    });
  }

  const passthroughStations = zones.length === 0
    ? stations.filter((station) => stationIdsInUse.has(station.id))
    : [];

  return {
    stations: [...generatedStations, ...passthroughStations],
    tasks: stationNormalizedTasks,
  };
}

export function buildProcessStationForTask(task: Task, tasks: Task[], bottleneckStationId?: string): Station {
  const processNumber = getTaskProcessNumber(task);
  const groupTasks = tasks.filter((candidate) => getTaskProcessNumber(candidate) === processNumber);
  const topLevelTask = groupTasks.find((candidate) => candidate.wbs === processNumber) ?? task;
  const plannedCycleMinutes = groupTasks.reduce((total, candidate) => total + candidate.plannedDurationMinutes, 0);
  const plannedManHours = groupTasks.reduce((total, candidate) => total + calculateTaskManHours(candidate), 0);

  return {
    id: topLevelTask.id,
    scenarioId: topLevelTask.scenarioId,
    sequence: Number.parseFloat(processNumber) || 0,
    name: topLevelTask.name || `Process ${processNumber}`,
    description: topLevelTask.description,
    ownerName: topLevelTask.ownerName ?? "",
    plannedCycleMinutes,
    plannedOperators: topLevelTask.plannedOperators,
    plannedManHours,
    taktStatus: "missing",
    bottleneckFlag: topLevelTask.id === bottleneckStationId,
  };
}
