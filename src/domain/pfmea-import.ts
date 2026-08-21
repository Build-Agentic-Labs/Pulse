import {
  createPfmeaRowForProcedureLink,
  isPfmeaRowStarted,
  normalizePfmeaScore,
  type PfmeaDocument,
  type PfmeaImportRecord,
  type PfmeaRow,
} from "./pfmea";
import type { ManufacturingStep, Task, Zone } from "./types";

export type PfmeaTabularValue = string | number | boolean | Date | null | undefined;

export interface PfmeaImportPreview {
  record: PfmeaImportRecord;
  rows: PfmeaRow[];
  warnings: string[];
}

export function parsePfmeaDelimitedText(input: string, delimiter = ","): PfmeaTabularValue[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(value);
      value = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }
  if (value || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

type ColumnMap = {
  interaction: number;
  processStep: number;
  failureMode: number;
  effect: number;
  severity: number;
  cause: number;
  occurrence: number;
  currentControls: number;
  detection: number;
  detectionActivity: number;
  recommendedActions: number;
  actionOwner: number;
  actionsTaken: number;
  resultOccurrence: number;
  resultDetection: number;
};

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cellText(value: PfmeaTabularValue) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value == null) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const TOKEN_ALIASES: Record<string, string> = {
  removal: "remove",
  removing: "remove",
  installation: "install",
  installing: "install",
  assembly: "assemble",
  adding: "add",
  disconnection: "disconnect",
  wiring: "wire",
};

function tokens(value: string) {
  const stopWords = new Set(["the", "and", "of", "to", "for", "with", "system"]);
  return value.toLowerCase()
    .replace(/after[-\s]?treatment/g, "aftertreatment")
    .split(/[^a-z0-9]+/)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function tokenMatchScore(left: string, right: string) {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function cell(row: PfmeaTabularValue[] | undefined, index: number) {
  return index >= 0 ? cellText(row?.[index]) : "";
}

function findColumn(headers: string[], aliases: string[], excluded: string[] = []) {
  const normalizedAliases = aliases.map(normalize);
  const normalizedExcluded = excluded.map(normalize);
  return headers.findIndex((header) => {
    const normalizedHeader = normalize(header);
    return normalizedAliases.some((alias) => normalizedHeader.includes(alias)) &&
      !normalizedExcluded.some((term) => normalizedHeader.includes(term));
  });
}

function findHeaderRow(rows: PfmeaTabularValue[][]) {
  return rows.findIndex((row) => {
    const normalizedCells = row.map((value) => normalize(cellText(value)));
    return normalizedCells.some((value) => value.includes("potentialfailuremode")) &&
      normalizedCells.some((value) => value.includes("potentialeffect"));
  });
}

function buildColumnMap(rows: PfmeaTabularValue[][], headerIndex: number): { columns: ColumnMap; dataStart: number; headers: string[] } {
  const primary = rows[headerIndex] ?? [];
  const secondary = rows[headerIndex + 1] ?? [];
  const width = Math.max(primary.length, secondary.length);
  const headers = Array.from({ length: width }, (_, index) => `${cellText(primary[index])} ${cellText(secondary[index])}`.trim());
  const secondaryLooksLikeHeader = secondary.some((value) => /actions taken|\bsev\b|\bocc\b|\bdet\b|\brpn\b/i.test(cellText(value)));
  return {
    headers,
    dataStart: headerIndex + (secondaryLooksLikeHeader ? 2 : 1),
    columns: {
      interaction: findColumn(headers, ["interaction", "operation", "procedure task", "process function"]),
      processStep: findColumn(headers, ["process step", "work element"]),
      failureMode: findColumn(headers, ["potential failure mode", "failure mode"]),
      effect: findColumn(headers, ["potential effect", "effect of failure"]),
      severity: findColumn(headers, ["severity"], ["action result"]),
      cause: findColumn(headers, ["potential cause", "mechanism of failure", "failure cause"]),
      occurrence: findColumn(headers, ["occurence", "occurrence"], ["action result"]),
      currentControls: findColumn(headers, ["current process controls", "current controls"]),
      detection: findColumn(headers, ["detection"], ["activity", "action result"]),
      detectionActivity: findColumn(headers, ["detection activity", "detection method"]),
      recommendedActions: findColumn(headers, ["recommended action"]),
      actionOwner: findColumn(headers, ["responsibility and target", "action owner", "responsibility"]),
      actionsTaken: findColumn(headers, ["actions taken", "action results"]),
      resultOccurrence: secondary.findIndex((value) => /^(occ|occurrence)$/i.test(cellText(value))),
      resultDetection: secondary.findIndex((value) => /^(det|detection)$/i.test(cellText(value))),
    },
  };
}

function matchTask(label: string, tasks: Task[]) {
  const needle = normalize(label);
  if (!needle) return undefined;
  const exact = tasks.find((task) => [task.name, task.manufacturingCode, task.wbs].some((value) => value && normalize(value) === needle));
  if (exact) return exact;
  const contained = tasks.find((task) => {
    const candidates = [task.name, task.manufacturingCode].filter(Boolean).map((value) => normalize(value!));
    return candidates.some((candidate) => candidate.length >= 5 && (candidate.includes(needle) || needle.includes(candidate)));
  });
  if (contained) return contained;
  return tasks
    .map((task) => ({ task, score: tokenMatchScore(label, task.name) }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score)[0]?.task;
}

function stepLabel(step: ManufacturingStep) {
  return step.name?.trim() || step.instruction.split("\n").map((line) => line.replace(/^[-•]\s*/, "").trim()).find(Boolean) || `Step ${step.sequence}`;
}

function matchStep(label: string, task: Task | undefined) {
  const needle = normalize(label);
  if (!needle || !task) return undefined;
  const steps = task.manufacturingSteps ?? [];
  const exact = steps.find((step) => normalize(stepLabel(step)) === needle || normalize(`Step ${step.sequence}`) === needle);
  if (exact) return exact;
  const contained = steps.find((step) => {
    const candidate = normalize(stepLabel(step));
    return candidate.length >= 5 && (candidate.includes(needle) || needle.includes(candidate));
  });
  if (contained) return contained;
  return steps
    .map((step) => ({ step, score: tokenMatchScore(label, stepLabel(step)) }))
    .filter((candidate) => candidate.score >= 0.6)
    .sort((left, right) => right.score - left.score)[0]?.step;
}

function targetDate(value: string) {
  const iso = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = value.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : undefined;
}

function sourceRaw(headers: string[], row: PfmeaTabularValue[]) {
  return Object.fromEntries(headers
    .map((header, index) => [header || `Column ${index + 1}`, cellText(row[index])] as const)
    .filter(([, value]) => Boolean(value)));
}

function blankImportedRow(now: Date): PfmeaRow {
  const timestamp = now.toISOString();
  return {
    id: newId("pfmea-row"),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceKind: "import",
    linkStatus: "unmapped",
    failureMode: "",
    effect: "",
    cause: "",
    currentControls: "",
    detectionActivity: "",
    recommendedActions: "",
    actionOwner: "",
    actionsTaken: "",
    controlProposals: [],
  };
}

export function buildPfmeaImportPreview(
  table: PfmeaTabularValue[][],
  options: {
    fileName: string;
    fileType: "csv" | "xlsx";
    sourceKey: string;
    tasks: Task[];
    zones: Zone[];
    now?: Date;
  },
): PfmeaImportPreview {
  const now = options.now ?? new Date();
  const headerIndex = findHeaderRow(table);
  if (headerIndex < 0) {
    throw new Error("The file does not contain recognizable PFMEA column headings.");
  }
  const { columns, dataStart, headers } = buildColumnMap(table, headerIndex);
  if (columns.failureMode < 0) {
    throw new Error("A Potential Failure Mode column is required.");
  }
  const zoneById = new Map(options.zones.map((zone) => [zone.id, zone]));
  const importId = newId("pfmea-import");
  let currentInteraction = "";
  let currentProcessStep = "";
  const rows: PfmeaRow[] = [];

  table.slice(dataStart).forEach((rawRow, offset) => {
    const interaction = cell(rawRow, columns.interaction);
    const processStep = cell(rawRow, columns.processStep);
    const failureMode = cell(rawRow, columns.failureMode);
    const effect = cell(rawRow, columns.effect);
    const cause = cell(rawRow, columns.cause);
    const controls = cell(rawRow, columns.currentControls);
    const recommendedActions = cell(rawRow, columns.recommendedActions);
    const actionsTaken = cell(rawRow, columns.actionsTaken);
    const scoreValues = [cell(rawRow, columns.severity), cell(rawRow, columns.occurrence), cell(rawRow, columns.detection)];
    const hasRiskContent = Boolean(failureMode || effect || cause || controls || recommendedActions || actionsTaken || scoreValues.some(Boolean));

    if (interaction) currentInteraction = interaction;
    if (processStep) currentProcessStep = processStep;
    if (!hasRiskContent) return;

    const task = matchTask(currentInteraction, options.tasks);
    const step = matchStep(currentProcessStep, task);
    const zone = task?.zoneId ? zoneById.get(task.zoneId) : undefined;
    const row = task
      ? createPfmeaRowForProcedureLink(task, step, zone, now, "import")
      : blankImportedRow(now);
    const actionOwner = cell(rawRow, columns.actionOwner);
    rows.push({
      ...row,
      sourceImportId: importId,
      sourceRow: dataStart + offset + 1,
      sourceRaw: sourceRaw(headers, rawRow),
      taskNameSnapshot: task?.name ?? (currentInteraction || undefined),
      taskCodeSnapshot: task?.manufacturingCode,
      processStepSnapshot: step ? stepLabel(step) : currentProcessStep || undefined,
      linkStatus: task ? "linked" : "unmapped",
      failureMode,
      effect,
      severity: normalizePfmeaScore(cell(rawRow, columns.severity)),
      cause,
      occurrence: normalizePfmeaScore(cell(rawRow, columns.occurrence)),
      currentControls: controls,
      detection: normalizePfmeaScore(cell(rawRow, columns.detection)),
      detectionActivity: cell(rawRow, columns.detectionActivity),
      recommendedActions,
      actionOwner,
      targetDate: targetDate(actionOwner),
      actionsTaken,
      resultOccurrence: normalizePfmeaScore(cell(rawRow, columns.resultOccurrence)),
      resultDetection: normalizePfmeaScore(cell(rawRow, columns.resultDetection)),
    });
  });

  const matchedTaskCount = rows.filter((row) => row.taskId).length;
  const matchedStepCount = rows.filter((row) => row.stepId).length;
  const unmappedCount = rows.length - matchedTaskCount;
  const warnings: string[] = [];
  if (rows.length === 0) warnings.push("No PFMEA risk rows were found after the heading row.");
  if (unmappedCount > 0) warnings.push(`${unmappedCount} row(s) could not be matched to a Procedure task and will remain unmapped.`);
  if (matchedTaskCount > matchedStepCount) warnings.push(`${matchedTaskCount - matchedStepCount} matched row(s) have no specific process-step match.`);

  return {
    record: {
      id: importId,
      fileName: options.fileName,
      fileType: options.fileType,
      sourceKey: options.sourceKey,
      importedAt: now.toISOString(),
      rowCount: rows.length,
      matchedTaskCount,
      matchedStepCount,
      unmappedCount,
    },
    rows,
    warnings,
  };
}

function contextKey(row: PfmeaRow) {
  return `${row.taskId ?? "unmapped"}:${row.stepId ?? "task"}`;
}

export function mergePfmeaImport(document: PfmeaDocument, preview: PfmeaImportPreview): PfmeaDocument {
  if (document.imports.some((record) => record.sourceKey === preview.record.sourceKey)) {
    return document;
  }
  const rows = [...document.rows];
  const claimedBlankRows = new Set<string>();

  preview.rows.forEach((importedRow) => {
    const key = contextKey(importedRow);
    const blankIndex = rows.findIndex((row) => contextKey(row) === key && !isPfmeaRowStarted(row) && !claimedBlankRows.has(row.id));
    if (blankIndex >= 0 && importedRow.taskId) {
      const existing = rows[blankIndex];
      rows[blankIndex] = {
        ...importedRow,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      claimedBlankRows.add(existing.id);
      return;
    }
    const lastContextIndex = rows.findLastIndex((row) => contextKey(row) === key);
    const lastTaskIndex = importedRow.taskId ? rows.findLastIndex((row) => row.taskId === importedRow.taskId) : -1;
    const insertAt = Math.max(lastContextIndex, lastTaskIndex);
    rows.splice(insertAt >= 0 ? insertAt + 1 : rows.length, 0, importedRow);
  });

  return {
    ...document,
    updatedAt: preview.record.importedAt,
    imports: [...document.imports, preview.record],
    rows,
  };
}
