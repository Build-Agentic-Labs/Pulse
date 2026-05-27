import type { DocumentTypeCode, ManufacturingComponent, ManufacturingStep, Task, Zone } from "./types";

const DEFAULT_TASK_NUMBER_START = 10;
const DEFAULT_TASK_NUMBER_INCREMENT = 10;
const DEFAULT_STEP_NUMBER_START = 10;
const DEFAULT_STEP_NUMBER_INCREMENT = 10;
const DEFAULT_SEPARATOR = "-";

export const defaultDocumentTypeCodes: Array<Pick<DocumentTypeCode, "code" | "name" | "active">> = [
  { code: "WI", name: "Work Instruction", active: true },
  { code: "QC", name: "Quality Check", active: true },
  { code: "MAT", name: "Material List", active: true },
  { code: "TRV", name: "Traveler", active: true },
];

export type NomenclatureSettings = {
  taskNumberStart: number;
  taskNumberIncrement: number;
  stepNumberStart: number;
  stepNumberIncrement: number;
  separator: string;
};

export const defaultNomenclatureSettings: NomenclatureSettings = {
  taskNumberStart: DEFAULT_TASK_NUMBER_START,
  taskNumberIncrement: DEFAULT_TASK_NUMBER_INCREMENT,
  stepNumberStart: DEFAULT_STEP_NUMBER_START,
  stepNumberIncrement: DEFAULT_STEP_NUMBER_INCREMENT,
  separator: DEFAULT_SEPARATOR,
};

export function normalizeCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
}

export function buildManufacturingCode(
  componentCode?: string,
  zoneCode?: string,
  taskNumber?: number,
  separator = DEFAULT_SEPARATOR,
) {
  const normalizedZone = normalizeCode(zoneCode ?? "");
  const normalizedComponent = normalizeCode(componentCode ?? "");
  const normalizedTaskNumber = Number.isFinite(taskNumber) && taskNumber ? String(Math.trunc(Number(taskNumber))) : "";

  return [normalizedComponent, normalizedZone, normalizedTaskNumber].filter(Boolean).join(separator || DEFAULT_SEPARATOR);
}

export function getZoneCode(zone?: Zone) {
  return normalizeCode(zone?.code || zone?.name?.slice(0, 3) || "");
}

export function getComponentCode(component?: ManufacturingComponent) {
  return normalizeCode(component?.code || "");
}

export function nextTaskNumberForComponent(
  tasks: Task[],
  componentId: string | undefined,
  zoneId: string | undefined,
  settings: Pick<NomenclatureSettings, "taskNumberStart" | "taskNumberIncrement"> = defaultNomenclatureSettings,
) {
  const existingNumbers = tasks
    .filter((task) => task.componentId && task.componentId === componentId && task.zoneId === zoneId)
    .map((task) => task.taskNumber)
    .filter((value): value is number => Number.isFinite(value));

  if (existingNumbers.length === 0) {
    return settings.taskNumberStart;
  }

  return Math.max(...existingNumbers) + settings.taskNumberIncrement;
}

export function generateTaskCode(
  task: Pick<Task, "zoneId" | "componentId" | "taskNumber">,
  zones: Zone[],
  components: ManufacturingComponent[],
  settings: Pick<NomenclatureSettings, "separator"> = defaultNomenclatureSettings,
) {
  const zone = zones.find((candidate) => candidate.id === task.zoneId);
  const component = components.find((candidate) => candidate.id === task.componentId);
  const zoneCode = getZoneCode(zone);
  const componentCode = getComponentCode(component);

  if (!zoneCode || !componentCode || !task.taskNumber) {
    return "";
  }

  return buildManufacturingCode(componentCode, zoneCode, task.taskNumber, settings.separator);
}

export function taskDisplayCode(task: Pick<Task, "manufacturingCode" | "wbs">) {
  return task.manufacturingCode?.trim() || "Uncoded";
}

export function taskDisplayLabel(task: Pick<Task, "manufacturingCode" | "wbs" | "name">) {
  const code = taskDisplayCode(task);
  return task.name ? `${code} - ${task.name}` : code;
}

export function nextStepNumber(index: number, settings = defaultNomenclatureSettings) {
  return settings.stepNumberStart + index * settings.stepNumberIncrement;
}

export function documentDisplayCode(
  task: Pick<Task, "manufacturingCode" | "wbs">,
  documentTypeCode = "WI",
  documentNumber = 1,
) {
  const taskCode = task.manufacturingCode?.trim();
  const docType = normalizeCode(documentTypeCode);

  if (!taskCode || !docType || documentNumber < 1) {
    return "";
  }

  return `${taskCode}-${docType}${Math.trunc(documentNumber)}`;
}

export function stepDisplayCode(
  task: Pick<Task, "manufacturingCode" | "wbs">,
  step: Pick<ManufacturingStep, "sequence">,
  documentTypeCode = "WI",
  documentNumber = 1,
  settings = defaultNomenclatureSettings,
) {
  const documentCode = documentDisplayCode(task, documentTypeCode, documentNumber);

  if (!documentCode) {
    return "";
  }

  const stepNumber = nextStepNumber(Math.max(step.sequence - 1, 0), settings);
  return `${documentCode}-S${stepNumber}`;
}
