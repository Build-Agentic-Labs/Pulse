import type { ManufacturingStep, Product, Scenario, Task, Zone } from "./types";

export const PRODUCT_PFMEA_DOCUMENT_FIELD = "productPfmeaDocument";
export const PFMEA_DOCUMENT_VERSION = 2;
export const PFMEA_HIGH_RPN_THRESHOLD = 100;
export const PFMEA_HIGH_SEVERITY_THRESHOLD = 9;

export type PfmeaDocumentStatus = "draft" | "in_review" | "approved" | "released" | "obsolete";
export type PfmeaLinkStatus = "linked" | "stale" | "unmapped";
export type PfmeaRowSource = "procedure" | "manual" | "import";
export type PfmeaControlTarget = "procedure" | "checklist" | "traveler" | "inspection" | "training" | "documentation";
export type PfmeaProposalStatus = "draft" | "ready" | "accepted" | "rejected";

export interface PfmeaControlProposal {
  id: string;
  target: PfmeaControlTarget;
  status: PfmeaProposalStatus;
  title: string;
  notes: string;
  taskId?: string;
  stepId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PfmeaImportRecord {
  id: string;
  fileName: string;
  fileType: "csv" | "xlsx";
  sourceKey: string;
  importedAt: string;
  rowCount: number;
  matchedTaskCount: number;
  matchedStepCount: number;
  unmappedCount: number;
}

export interface PfmeaSettings {
  highRpnThreshold: number;
  highSeverityThreshold: number;
}

export interface PfmeaRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceKind: PfmeaRowSource;
  sourceImportId?: string;
  taskId?: string;
  taskCodeSnapshot?: string;
  taskNameSnapshot?: string;
  zoneIdSnapshot?: string;
  zoneNameSnapshot?: string;
  stepId?: string;
  stepSequenceSnapshot?: number;
  processStepSnapshot?: string;
  linkStatus: PfmeaLinkStatus;
  failureMode: string;
  effect: string;
  severity?: number;
  cause: string;
  occurrence?: number;
  currentControls: string;
  detection?: number;
  detectionActivity: string;
  recommendedActions: string;
  actionOwner: string;
  targetDate?: string;
  actionsTaken: string;
  resultOccurrence?: number;
  resultDetection?: number;
  sourceRow?: number;
  sourceRaw?: Record<string, string>;
  controlProposals: PfmeaControlProposal[];
}

export interface PfmeaDocument {
  version: typeof PFMEA_DOCUMENT_VERSION;
  id: string;
  productId: string;
  sourceScenarioId: string;
  sourceScenarioName: string;
  documentNumber: string;
  revision: string;
  status: PfmeaDocumentStatus;
  item: string;
  model: string;
  owner: string;
  coreTeam: string;
  originalDate: string;
  effectiveDate?: string;
  createdAt: string;
  updatedAt: string;
  settings: PfmeaSettings;
  imports: PfmeaImportRecord[];
  rows: PfmeaRow[];
}

export interface PfmeaRowIssue {
  field: keyof PfmeaRow;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function taskCode(task: Task) {
  return task.manufacturingCode?.trim() || task.wbs?.trim() || task.name;
}

function stepLabel(step: ManufacturingStep) {
  const instructionFirstLine = step.instruction
    .split("\n")
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .find(Boolean);
  return step.name?.trim() || instructionFirstLine || `Step ${step.sequence}`;
}

export function normalizePfmeaScore(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

export function calculatePfmeaRpn(severity?: number, occurrence?: number, detection?: number) {
  if (severity == null || occurrence == null || detection == null) {
    return undefined;
  }
  return severity * occurrence * detection;
}

export function calculateRowRpn(row: Pick<PfmeaRow, "severity" | "occurrence" | "detection">) {
  return calculatePfmeaRpn(row.severity, row.occurrence, row.detection);
}

export function calculateResidualRpn(
  row: Pick<PfmeaRow, "severity" | "resultOccurrence" | "resultDetection">,
) {
  return calculatePfmeaRpn(row.severity, row.resultOccurrence, row.resultDetection);
}

export function isPfmeaRowStarted(row: PfmeaRow) {
  return Boolean(
    row.failureMode.trim() ||
    row.effect.trim() ||
    row.cause.trim() ||
    row.currentControls.trim() ||
    row.detectionActivity.trim() ||
    row.recommendedActions.trim() ||
    row.actionsTaken.trim() ||
    row.severity ||
    row.occurrence ||
    row.detection,
  );
}

export function isHighPriorityPfmeaRow(row: PfmeaRow) {
  const rpn = calculateRowRpn(row);
  return (rpn != null && rpn >= PFMEA_HIGH_RPN_THRESHOLD) || (row.severity ?? 0) >= PFMEA_HIGH_SEVERITY_THRESHOLD;
}

export function getPfmeaRowIssues(row: PfmeaRow): PfmeaRowIssue[] {
  if (!isPfmeaRowStarted(row)) {
    return [];
  }
  const issues: PfmeaRowIssue[] = [];
  if (!row.failureMode.trim()) issues.push({ field: "failureMode", message: "Failure mode is required." });
  if (!row.effect.trim()) issues.push({ field: "effect", message: "Failure effect is required." });
  if (row.severity == null) issues.push({ field: "severity", message: "Severity score is required." });
  if (!row.cause.trim()) issues.push({ field: "cause", message: "Failure cause is required." });
  if (row.occurrence == null) issues.push({ field: "occurrence", message: "Occurrence score is required." });
  if (!row.currentControls.trim()) issues.push({ field: "currentControls", message: "Current process controls are required." });
  if (row.detection == null) issues.push({ field: "detection", message: "Detection score is required." });
  if (row.recommendedActions.trim() && !row.actionOwner.trim()) {
    issues.push({ field: "actionOwner", message: "An owner is required when an action is recommended." });
  }
  if (row.actionsTaken.trim() && row.resultOccurrence == null) {
    issues.push({ field: "resultOccurrence", message: "Result occurrence is required when actions are recorded." });
  }
  if (row.actionsTaken.trim() && row.resultDetection == null) {
    issues.push({ field: "resultDetection", message: "Result detection is required when actions are recorded." });
  }
  return issues;
}

export function isPfmeaRowComplete(row: PfmeaRow) {
  return isPfmeaRowStarted(row) && getPfmeaRowIssues(row).length === 0;
}

export function createPfmeaRowForProcedureLink(
  task: Task,
  step: ManufacturingStep | undefined,
  zone?: Zone,
  now = new Date(),
  sourceKind: PfmeaRowSource = "manual",
): PfmeaRow {
  const timestamp = now.toISOString();
  return {
    id: newId("pfmea-row"),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceKind,
    taskId: task.id,
    taskCodeSnapshot: taskCode(task),
    taskNameSnapshot: task.name,
    zoneIdSnapshot: zone?.id,
    zoneNameSnapshot: zone?.name,
    stepId: step?.id,
    stepSequenceSnapshot: step?.sequence,
    processStepSnapshot: step ? stepLabel(step) : task.name,
    linkStatus: "linked",
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

function procedureRows(tasks: Task[], zones: Zone[], now = new Date()) {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const procedureTasks = tasks
    .filter((task) => task.rowType === "task" && !task.parentTaskId)
    .sort((left, right) => {
      const leftZone = left.zoneId ? zoneById.get(left.zoneId) : undefined;
      const rightZone = right.zoneId ? zoneById.get(right.zoneId) : undefined;
      const zoneOrder = (leftZone?.sequence ?? Number.MAX_SAFE_INTEGER) - (rightZone?.sequence ?? Number.MAX_SAFE_INTEGER);
      if (zoneOrder !== 0) {
        return zoneOrder;
      }
      const leftWbs = Number.parseFloat(left.wbs);
      const rightWbs = Number.parseFloat(right.wbs);
      if (Number.isFinite(leftWbs) && Number.isFinite(rightWbs) && leftWbs !== rightWbs) {
        return leftWbs - rightWbs;
      }
      return left.wbs.localeCompare(right.wbs, undefined, { numeric: true }) || left.name.localeCompare(right.name);
    });

  return procedureTasks
    .flatMap((task) => {
      const zone = task.zoneId ? zoneById.get(task.zoneId) : undefined;
      const steps = [...(task.manufacturingSteps ?? [])].sort((left, right) => left.sequence - right.sequence);
      return steps.length > 0
        ? steps.map((step) => createPfmeaRowForProcedureLink(task, step, zone, now, "procedure"))
        : [createPfmeaRowForProcedureLink(task, undefined, zone, now, "procedure")];
    });
}

export function createPfmeaDocumentFromProcedure(
  product: Product,
  scenario: Scenario,
  tasks: Task[],
  zones: Zone[],
  now = new Date(),
): PfmeaDocument {
  const timestamp = now.toISOString();
  const date = timestamp.slice(0, 10);
  const productNumber = product.productCode?.trim() || product.sku?.trim() || product.name.replace(/\s+/g, "-").toUpperCase();

  return {
    version: PFMEA_DOCUMENT_VERSION,
    id: newId("pfmea"),
    productId: product.id,
    sourceScenarioId: scenario.id,
    sourceScenarioName: scenario.name,
    documentNumber: `${productNumber}-PFMEA-001`,
    revision: product.revision || "A",
    status: "draft",
    item: product.name,
    model: product.family || product.sku || product.name,
    owner: product.ownerName || "Manufacturing Engineering",
    coreTeam: "",
    originalDate: date,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {
      highRpnThreshold: PFMEA_HIGH_RPN_THRESHOLD,
      highSeverityThreshold: PFMEA_HIGH_SEVERITY_THRESHOLD,
    },
    imports: [],
    rows: procedureRows(tasks, zones, now),
  };
}

export function duplicatePfmeaRow(row: PfmeaRow, now = new Date()): PfmeaRow {
  const timestamp = now.toISOString();
  return {
    ...row,
    id: newId("pfmea-row"),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceKind: "manual",
    sourceImportId: undefined,
    failureMode: "",
    effect: "",
    severity: undefined,
    cause: "",
    occurrence: undefined,
    currentControls: "",
    detection: undefined,
    detectionActivity: "",
    recommendedActions: "",
    actionOwner: "",
    targetDate: undefined,
    actionsTaken: "",
    resultOccurrence: undefined,
    resultDetection: undefined,
    sourceRow: undefined,
    sourceRaw: undefined,
    controlProposals: [],
  };
}

export function createPfmeaControlProposal(
  row: PfmeaRow,
  input: {
    target: PfmeaControlTarget;
    title: string;
    notes?: string;
    status?: PfmeaProposalStatus;
  },
  now = new Date(),
): PfmeaControlProposal {
  const timestamp = now.toISOString();
  return {
    id: newId("pfmea-proposal"),
    target: input.target,
    status: input.status ?? "draft",
    title: input.title.trim(),
    notes: input.notes?.trim() ?? "",
    taskId: row.taskId,
    stepId: row.stepId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function syncPfmeaDocumentWithProcedure(
  document: PfmeaDocument,
  scenario: Scenario,
  tasks: Task[],
  zones: Zone[],
  now = new Date(),
): PfmeaDocument {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const existingLinkKeys = new Set<string>();

  const rows: PfmeaRow[] = document.rows.map((row): PfmeaRow => {
    const task = row.taskId ? taskById.get(row.taskId) : undefined;
    if (!task) {
      return { ...row, linkStatus: row.taskId ? "stale" as const : "unmapped" as const };
    }
    const steps = task.manufacturingSteps ?? [];
    const step = row.stepId ? steps.find((candidate) => candidate.id === row.stepId) : undefined;
    if (row.stepId && !step) {
      return { ...row, linkStatus: "stale" as const };
    }
    const zone = task.zoneId ? zoneById.get(task.zoneId) : undefined;
    existingLinkKeys.add(`${task.id}:${step?.id ?? "task"}`);
    return {
      ...row,
      taskCodeSnapshot: taskCode(task),
      taskNameSnapshot: task.name,
      zoneIdSnapshot: zone?.id,
      zoneNameSnapshot: zone?.name,
      stepSequenceSnapshot: step?.sequence,
      processStepSnapshot: step ? stepLabel(step) : task.name,
      linkStatus: "linked" as const,
    };
  });

  procedureRows(tasks, zones, now).forEach((row) => {
    const key = `${row.taskId}:${row.stepId ?? "task"}`;
    if (!existingLinkKeys.has(key)) {
      rows.push(row);
      existingLinkKeys.add(key);
    }
  });

  return {
    ...document,
    sourceScenarioId: scenario.id,
    sourceScenarioName: scenario.name,
    updatedAt: now.toISOString(),
    rows,
  };
}

function parseControlProposal(value: unknown, fallbackTimestamp: string): PfmeaControlProposal | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const target = value.target;
  const validTarget: PfmeaControlTarget = target === "procedure" || target === "checklist" || target === "traveler" || target === "inspection" || target === "training" || target === "documentation"
    ? target
    : "procedure";
  const status = value.status;
  const validStatus: PfmeaProposalStatus = status === "draft" || status === "ready" || status === "accepted" || status === "rejected"
    ? status
    : "draft";
  return {
    id: value.id,
    target: validTarget,
    status: validStatus,
    title: text(value.title),
    notes: text(value.notes),
    taskId: optionalText(value.taskId),
    stepId: optionalText(value.stepId),
    createdAt: text(value.createdAt) || fallbackTimestamp,
    updatedAt: text(value.updatedAt) || fallbackTimestamp,
  };
}

function parsePfmeaRow(value: unknown, fallbackTimestamp: string): PfmeaRow | undefined {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }
  const rawLinkStatus = value.linkStatus;
  const linkStatus: PfmeaLinkStatus = rawLinkStatus === "linked" || rawLinkStatus === "stale" || rawLinkStatus === "unmapped"
    ? rawLinkStatus
    : optionalText(value.taskId) ? "linked" : "unmapped";
  return {
    id: value.id,
    createdAt: text(value.createdAt) || fallbackTimestamp,
    updatedAt: text(value.updatedAt) || fallbackTimestamp,
    sourceKind: value.sourceKind === "manual" || value.sourceKind === "import" ? value.sourceKind : "procedure",
    sourceImportId: optionalText(value.sourceImportId),
    taskId: optionalText(value.taskId),
    taskCodeSnapshot: optionalText(value.taskCodeSnapshot),
    taskNameSnapshot: optionalText(value.taskNameSnapshot),
    zoneIdSnapshot: optionalText(value.zoneIdSnapshot),
    zoneNameSnapshot: optionalText(value.zoneNameSnapshot),
    stepId: optionalText(value.stepId),
    stepSequenceSnapshot: typeof value.stepSequenceSnapshot === "number" ? value.stepSequenceSnapshot : undefined,
    processStepSnapshot: optionalText(value.processStepSnapshot),
    linkStatus,
    failureMode: text(value.failureMode),
    effect: text(value.effect),
    severity: normalizePfmeaScore(value.severity),
    cause: text(value.cause),
    occurrence: normalizePfmeaScore(value.occurrence),
    currentControls: text(value.currentControls),
    detection: normalizePfmeaScore(value.detection),
    detectionActivity: text(value.detectionActivity),
    recommendedActions: text(value.recommendedActions),
    actionOwner: text(value.actionOwner),
    targetDate: optionalText(value.targetDate),
    actionsTaken: text(value.actionsTaken),
    resultOccurrence: normalizePfmeaScore(value.resultOccurrence),
    resultDetection: normalizePfmeaScore(value.resultDetection),
    sourceRow: typeof value.sourceRow === "number" ? value.sourceRow : undefined,
    sourceRaw: isRecord(value.sourceRaw)
      ? Object.fromEntries(Object.entries(value.sourceRaw).map(([key, entry]) => [key, text(entry)]))
      : undefined,
    controlProposals: Array.isArray(value.controlProposals)
      ? value.controlProposals.map((proposal) => parseControlProposal(proposal, fallbackTimestamp)).filter((proposal): proposal is PfmeaControlProposal => Boolean(proposal))
      : [],
  };
}

function parseImportRecord(value: unknown): PfmeaImportRecord | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.fileName !== "string") return undefined;
  return {
    id: value.id,
    fileName: value.fileName,
    fileType: value.fileType === "xlsx" ? "xlsx" : "csv",
    sourceKey: text(value.sourceKey),
    importedAt: text(value.importedAt),
    rowCount: Number.isFinite(Number(value.rowCount)) ? Math.max(0, Math.round(Number(value.rowCount))) : 0,
    matchedTaskCount: Number.isFinite(Number(value.matchedTaskCount)) ? Math.max(0, Math.round(Number(value.matchedTaskCount))) : 0,
    matchedStepCount: Number.isFinite(Number(value.matchedStepCount)) ? Math.max(0, Math.round(Number(value.matchedStepCount))) : 0,
    unmappedCount: Number.isFinite(Number(value.unmappedCount)) ? Math.max(0, Math.round(Number(value.unmappedCount))) : 0,
  };
}

export function getProductPfmeaDocument(customFields?: Record<string, unknown>): PfmeaDocument | undefined {
  const raw = customFields?.[PRODUCT_PFMEA_DOCUMENT_FIELD];
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== PFMEA_DOCUMENT_VERSION) || typeof raw.id !== "string" || typeof raw.productId !== "string") {
    return undefined;
  }
  const status = raw.status;
  const validStatus: PfmeaDocumentStatus = status === "draft" || status === "in_review" || status === "approved" || status === "released" || status === "obsolete"
    ? status
    : "draft";
  const createdAt = text(raw.createdAt) || new Date(0).toISOString();
  const highRpnThreshold = isRecord(raw.settings) ? Number(raw.settings.highRpnThreshold) : PFMEA_HIGH_RPN_THRESHOLD;
  const highSeverityThreshold = isRecord(raw.settings) ? Number(raw.settings.highSeverityThreshold) : PFMEA_HIGH_SEVERITY_THRESHOLD;
  return {
    version: PFMEA_DOCUMENT_VERSION,
    id: raw.id,
    productId: raw.productId,
    sourceScenarioId: text(raw.sourceScenarioId),
    sourceScenarioName: text(raw.sourceScenarioName),
    documentNumber: text(raw.documentNumber),
    revision: text(raw.revision) || "A",
    status: validStatus,
    item: text(raw.item),
    model: text(raw.model),
    owner: text(raw.owner),
    coreTeam: text(raw.coreTeam),
    originalDate: text(raw.originalDate),
    effectiveDate: optionalText(raw.effectiveDate),
    createdAt,
    updatedAt: text(raw.updatedAt) || createdAt,
    settings: {
      highRpnThreshold: Number.isFinite(highRpnThreshold) ? Math.max(1, Math.round(highRpnThreshold)) : PFMEA_HIGH_RPN_THRESHOLD,
      highSeverityThreshold: normalizePfmeaScore(highSeverityThreshold) ?? PFMEA_HIGH_SEVERITY_THRESHOLD,
    },
    imports: Array.isArray(raw.imports) ? raw.imports.map(parseImportRecord).filter((record): record is PfmeaImportRecord => Boolean(record)) : [],
    rows: Array.isArray(raw.rows) ? raw.rows.map((row) => parsePfmeaRow(row, createdAt)).filter((row): row is PfmeaRow => Boolean(row)) : [],
  };
}

export function serializePfmeaDocument(document: PfmeaDocument): PfmeaDocument {
  return {
    ...document,
    settings: { ...document.settings },
    imports: document.imports.map((record) => ({ ...record })),
    rows: document.rows.map((row) => ({
      ...row,
      sourceRaw: row.sourceRaw ? { ...row.sourceRaw } : undefined,
      controlProposals: row.controlProposals.map((proposal) => ({ ...proposal })),
    })),
  };
}
