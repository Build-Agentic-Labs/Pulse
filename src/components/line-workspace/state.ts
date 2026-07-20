// Client-only workspace state helpers: localStorage view snapshots, the
// procedure draft queue's persistence layer, and the project-switch session
// flags. Pure module — no React. Imported by the LineWorkspace client
// component; every function no-ops on the server (typeof window checks).

import { buildPlannerChromeContext } from "../planner-dashboard-panel";
import type { ManufacturingStep, Task } from "@/domain/types";
import { plannerModules } from "./nav";
import { type ProcedureDraftFieldName } from "./shared";

export type ProcedureDraftSaveStatus = "idle" | "dirty" | "saving" | "saved" | "retrying" | "error" | "conflict";

export type ProcedureDraftField = {
  taskId: string;
  stepId: string;
  fieldName: ProcedureDraftFieldName;
  value: string;
  baseValue: string;
  baseVersion?: number;
  baseUpdatedAt?: string;
  dirty: boolean;
  active: boolean;
  localEditSeq: number;
  lastEditedAt: number;
  saveStatus: ProcedureDraftSaveStatus;
  latestSaveId?: string;
  savingSeq?: number;
  error?: string;
};

export type ProcedureDraftMap = Record<string, ProcedureDraftField>;

const PROCEDURE_SAVE_DEBUG = false;

export const PROCEDURE_DRAFT_STORAGE_KEY_PREFIX = "buildlogic-line-planner-procedure-draft-v1";
export const WORKSPACE_SNAPSHOT_STORAGE_PREFIX = "buildlogic-line-planner-workspace-v1";
export const PROJECT_SWITCH_EVENT = "pulse:project-switch-start";
export const PROJECT_SWITCH_SESSION_KEY = "pulse:project-switch-started-at";
export const PROJECT_SWITCH_TARGET_SESSION_KEY = "pulse:project-switch-target-v1";
export const PROJECT_SWITCH_SESSION_MAX_AGE_MS = 15_000;
export const PROJECT_SWITCH_SKELETON_MIN_MS = 320;

export type ProjectSwitchTarget = {
  projectId: string;
  title: string;
};

export type WorkspaceSnapshot = {
  activeModule: string;
  selectedTaskId?: string;
  selectedStationId?: string;
  activeZoneId?: string;
  detailDrawerCollapsed: boolean;
  sidebarCollapsed?: boolean;
  savedAt: string;
};

export type LegacyProcedureDraftSnapshot = {
  taskId: string;
  task: Task;
  savedAt: string;
};

export type ProcedureFieldDraftSnapshot = {
  version: 2;
  fields: ProcedureDraftField[];
  savedAt: string;
};

export function makeProcedureDraftKey(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) {
  return `${taskId}:${stepId}:${fieldName}`;
}

export function getProcedureStepFieldValue(step: ManufacturingStep | undefined, fieldName: ProcedureDraftFieldName) {
  if (!step) {
    return "";
  }

  return fieldName === "name" ? step.name ?? "" : step.instruction ?? "";
}

export function procedureDraftLog(event: string, detail: Partial<ProcedureDraftField> & {
  saveId?: string;
  saveSeq?: number;
  serverVersion?: number;
  serverUpdatedAt?: string;
  source?: string;
} = {}) {
  if (!PROCEDURE_SAVE_DEBUG) {
    return;
  }

  console.debug("[procedure-save]", event, detail);
}

export function recentProjectSwitchStartedAt() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const startedAt = Number(window.sessionStorage.getItem(PROJECT_SWITCH_SESSION_KEY));
    return Number.isFinite(startedAt) && Date.now() - startedAt < PROJECT_SWITCH_SESSION_MAX_AGE_MS
      ? startedAt
      : undefined;
  } catch {
    return undefined;
  }
}

export function hasRecentProjectSwitchSession() {
  return recentProjectSwitchStartedAt() !== undefined;
}

export function readProjectSwitchTarget(): ProjectSwitchTarget | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(PROJECT_SWITCH_TARGET_SESSION_KEY);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<ProjectSwitchTarget>;
    return typeof parsed.projectId === "string" && typeof parsed.title === "string"
      ? { projectId: parsed.projectId, title: parsed.title }
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildProjectSwitchTargetContext(target?: ProjectSwitchTarget): ReturnType<typeof buildPlannerChromeContext> | undefined {
  if (!target?.title) {
    return undefined;
  }

  return {
    title: target.title,
    status: "",
    statusClass: undefined,
    detail: undefined,
  };
}

export function clearProjectSwitchSession() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(PROJECT_SWITCH_SESSION_KEY);
    window.sessionStorage.removeItem(PROJECT_SWITCH_TARGET_SESSION_KEY);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

export function workspaceSnapshotStorageKey(projectId?: string) {
  return `${WORKSPACE_SNAPSHOT_STORAGE_PREFIX}:${projectId || "default"}`;
}

// Procedure drafts are per-project. A single global key let drafts recovered on one project leak
// into (or be cleared by) another; drafts written under the old un-scoped key cannot be attributed
// to a project safely, so they are intentionally ignored.
export function procedureDraftStorageKey(projectId?: string) {
  return `${PROCEDURE_DRAFT_STORAGE_KEY_PREFIX}:${projectId || "default"}`;
}

export function isKnownModule(moduleId: unknown): moduleId is string {
  return typeof moduleId === "string" && [...plannerModules, { id: "settings" }].some((module) => module.id === moduleId);
}

export function readWorkspaceSnapshot(projectId?: string): WorkspaceSnapshot | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawSnapshot = window.localStorage.getItem(workspaceSnapshotStorageKey(projectId));
    if (!rawSnapshot) {
      return undefined;
    }

    const parsed = JSON.parse(rawSnapshot) as Partial<WorkspaceSnapshot>;
    if (!isKnownModule(parsed.activeModule)) {
      return undefined;
    }

    return {
      activeModule: parsed.activeModule,
      selectedTaskId: typeof parsed.selectedTaskId === "string" ? parsed.selectedTaskId : undefined,
      selectedStationId: typeof parsed.selectedStationId === "string" ? parsed.selectedStationId : undefined,
      activeZoneId: typeof parsed.activeZoneId === "string" ? parsed.activeZoneId : undefined,
      detailDrawerCollapsed:
        typeof parsed.detailDrawerCollapsed === "boolean" ? parsed.detailDrawerCollapsed : true,
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function writeWorkspaceSnapshot(projectId: string | undefined, snapshot: WorkspaceSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(workspaceSnapshotStorageKey(projectId), JSON.stringify(snapshot));
  } catch {
    // Losing the view snapshot should not block planner editing.
  }
}

export function readProcedureDraftSnapshot(projectId?: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawDraft = window.localStorage.getItem(procedureDraftStorageKey(projectId));
    if (!rawDraft) {
      return undefined;
    }

    const parsed = JSON.parse(rawDraft) as Partial<LegacyProcedureDraftSnapshot> & Partial<ProcedureFieldDraftSnapshot>;
    if (parsed.version === 2) {
      const fields = Array.isArray(parsed.fields)
        ? parsed.fields.filter((field): field is ProcedureDraftField =>
            typeof field?.taskId === "string" &&
            typeof field.stepId === "string" &&
            (field.fieldName === "instruction" || field.fieldName === "name") &&
            typeof field.value === "string",
          )
        : [];

      return {
        version: 2,
        fields: fields.map((field) => ({
          ...field,
          baseValue: typeof field.baseValue === "string" ? field.baseValue : "",
          dirty: field.dirty !== false,
          active: false,
          localEditSeq: Number.isFinite(field.localEditSeq) ? field.localEditSeq : 1,
          lastEditedAt: Number.isFinite(field.lastEditedAt) ? field.lastEditedAt : Date.now(),
          saveStatus: field.dirty === false ? "saved" : "dirty",
        })),
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
      } satisfies ProcedureFieldDraftSnapshot;
    }

    if (!parsed.taskId || !("task" in parsed) || !parsed.task || typeof parsed.task !== "object") {
      return undefined;
    }

    return parsed as LegacyProcedureDraftSnapshot;
  } catch {
    return undefined;
  }
}

export function writeProcedureFieldDraftSnapshot(projectId: string | undefined, drafts: ProcedureDraftMap) {
  if (typeof window === "undefined") {
    return;
  }

  const fields = Object.values(drafts).filter((field) => field.dirty);
  if (fields.length === 0) {
    clearProcedureDraftSnapshot(projectId);
    return;
  }

  const draft: ProcedureFieldDraftSnapshot = {
    version: 2,
    fields,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(procedureDraftStorageKey(projectId), JSON.stringify(draft));
  } catch {
    // The in-memory editor state remains the immediate source of truth if local storage is unavailable.
  }
}

export function clearProcedureDraftSnapshot(projectId?: string, taskId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (taskId) {
    const currentDraft = readProcedureDraftSnapshot(projectId);
    if (currentDraft && "version" in currentDraft && currentDraft.version === 2) {
      const remainingFields = currentDraft.fields.filter((field) => field.taskId !== taskId);
      if (remainingFields.length > 0) {
        try {
          window.localStorage.setItem(
            procedureDraftStorageKey(projectId),
            JSON.stringify({ version: 2, fields: remainingFields, savedAt: new Date().toISOString() }),
          );
        } catch {
          // Ignore local storage cleanup failures.
        }
        return;
      }
    } else if (currentDraft && "taskId" in currentDraft && currentDraft.taskId !== taskId) {
      return;
    }
  }

  try {
    window.localStorage.removeItem(procedureDraftStorageKey(projectId));
  } catch {
    // Ignore local storage cleanup failures.
  }
}

export function applyProcedureVersionSnapshot(task: Task, versionSource: Task) {
  const sourceStepById = new Map((versionSource.manufacturingSteps ?? []).map((step) => [step.id, step]));

  return {
    ...task,
    version: versionSource.version,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
      ...step,
      version: sourceStepById.get(step.id)?.version ?? step.version,
    })),
  };
}

export function mergeProcedureDraftWithServer(serverTask: Task, draftTask: Task) {
  const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
  const draftStepIds = new Set((draftTask.manufacturingSteps ?? []).map((step) => step.id));
  const mergedSteps = [
    ...(draftTask.manufacturingSteps ?? []).map((draftStep) => {
      const serverStep = serverStepById.get(draftStep.id);
      return serverStep ? { ...serverStep, ...draftStep } : draftStep;
    }),
    ...(serverTask.manufacturingSteps ?? []).filter((step) => !draftStepIds.has(step.id)),
  ];

  return applyProcedureVersionSnapshot(
    {
      ...serverTask,
      ...draftTask,
      manufacturingSteps: mergedSteps.length > 0 ? mergedSteps : serverTask.manufacturingSteps,
    },
    serverTask,
  );
}
