import type { Task } from "./types";

// Exploded views attach at the TASK level (one gallery per procedure task), not per manufacturing
// step. The backing table is still named `step_exploded_views` for historical reasons; its step_id
// column is unused (null) for these task-level views.
export const EXPLODED_VIEWS_FIELD = "taskExplodedViews";

/**
 * A SolidWorks-generated exploded view attached to a procedure task. Shaped like a step photo so the
 * existing storage/signing plumbing is reused, plus fields carrying the SolidWorks provenance.
 */
export interface ExplodedView {
  id: string;
  name: string;
  dataUrl: string;
  capturedAt: string;
  contentType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  storagePath?: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  caption?: string;
  // SolidWorks provenance:
  solidworksFilePath?: string;
  explodeConfigName?: string;
  frameNumber?: number;
  components?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Keep only non-empty string part numbers; return undefined for an empty/absent list. */
export function normalizeComponents(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const components = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return components.length > 0 ? components : undefined;
}

function sanitizeExplodedView(value: unknown): ExplodedView | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : "";
  const storagePath = typeof value.storagePath === "string" ? value.storagePath : undefined;
  const hasRenderableUrl = dataUrl.startsWith("data:image/") || /^https?:\/\//.test(dataUrl);

  // Require an id, plus either a renderable URL (inline data URL or http(s)) or a storage path a
  // fresh signed URL can be minted from. Signing can fail on load (private bucket); keeping the
  // view with an empty dataUrl lets the gallery show a placeholder instead of dropping it.
  if (!id || (!hasRenderableUrl && !storagePath)) {
    return null;
  }

  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Exploded view",
    dataUrl: hasRenderableUrl ? dataUrl : "",
    capturedAt:
      typeof value.capturedAt === "string" && value.capturedAt.trim()
        ? value.capturedAt
        : new Date().toISOString(),
    contentType: typeof value.contentType === "string" ? value.contentType : undefined,
    sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    storagePath,
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : undefined,
    thumbnailStoragePath: typeof value.thumbnailStoragePath === "string" ? value.thumbnailStoragePath : undefined,
    caption: typeof value.caption === "string" ? value.caption : undefined,
    solidworksFilePath: typeof value.solidworksFilePath === "string" ? value.solidworksFilePath : undefined,
    explodeConfigName: typeof value.explodeConfigName === "string" ? value.explodeConfigName : undefined,
    frameNumber: typeof value.frameNumber === "number" ? value.frameNumber : undefined,
    components: normalizeComponents(value.components),
  };
}

export function getTaskExplodedViews(task: Pick<Task, "customFields">): ExplodedView[] {
  const raw = task.customFields?.[EXPLODED_VIEWS_FIELD];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(sanitizeExplodedView).filter((view): view is ExplodedView => Boolean(view));
}

export function countTaskExplodedViews(task: Pick<Task, "customFields">) {
  return getTaskExplodedViews(task).length;
}

function writeExplodedViews(task: Task, views: ExplodedView[]): Task {
  const nextCustomFields = { ...task.customFields };
  if (views.length > 0) {
    nextCustomFields[EXPLODED_VIEWS_FIELD] = views;
  } else {
    delete nextCustomFields[EXPLODED_VIEWS_FIELD];
  }
  return { ...task, customFields: nextCustomFields };
}

export function addTaskExplodedViews(task: Task, views: ExplodedView[]): Task {
  if (views.length === 0) {
    return task;
  }
  return writeExplodedViews(task, [...getTaskExplodedViews(task), ...views]);
}

export function upsertTaskExplodedViews(task: Task, views: ExplodedView[]): Task {
  if (views.length === 0) {
    return task;
  }
  const byId = new Map(getTaskExplodedViews(task).map((view) => [view.id, view]));
  views.forEach((view) => byId.set(view.id, view));
  return writeExplodedViews(task, [...byId.values()]);
}

export function removeTaskExplodedView(task: Task, viewId: string): Task {
  return writeExplodedViews(task, getTaskExplodedViews(task).filter((view) => view.id !== viewId));
}

export function updateTaskExplodedView(task: Task, viewId: string, patch: Partial<ExplodedView>): Task {
  const views = getTaskExplodedViews(task);
  if (!views.some((view) => view.id === viewId)) {
    return task;
  }
  return writeExplodedViews(task, views.map((view) => (view.id === viewId ? { ...view, ...patch } : view)));
}
