// Planner step tools and the project tool library: per-row step-tool writes and one-step / whole-task tool
// list syncs (ids in the client format tool-<step>-<name>), and the project-scoped library (load with
// signed images, image upload, metadata upsert with rename, delete with object cleanup). Every library
// mutation requires a project. Moved verbatim from supabase-planner.ts (Phase 4).

import { plannerClient } from "./client";
import type { StepToolRow, ToolLibraryRow } from "./media-rows";
import {
  dataUrlToBlob,
  removeStorageObjects,
  safeStorageSegment,
  stableStoragePublicUrl,
  stepPhotoBucket,
  withSignedToolLibraryRows,
} from "./media-storage";
import { assertTaskInProject, throwIfError } from "./query-helpers";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import { getTaskStepToolListMap } from "@/domain/step-tools";
import type { PlannerProjectContext, Task } from "@/domain/types";

export type ToolLibraryItem = {
  id: string;
  projectId?: string;
  toolName: string;
  imageUrl?: string;
  storagePath?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function addStepToolToSupabase(taskId: string, stepId: string, toolName: string, sequence = 1, projectId?: string) {
  const tool = toolName.trim();
  if (!tool) {
    return;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(
    supabase.from("step_tools").upsert({
      id: stepToolId(stepId, tool),
      task_id: taskId,
      step_id: stepId,
      tool_name: tool,
      sequence,
    }),
  );
}

export async function removeStepToolFromSupabase(stepId: string, toolName: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(supabase.from("step_tools").delete().eq("id", stepToolId(stepId, toolName)));
}

export async function syncStepToolsForStepToSupabase(
  taskId: string,
  stepId: string,
  toolNames: string[],
  projectId?: string,
  assertCurrent?: () => void,
) {
  assertCurrent?.();
  const cleanedToolNames = toolNames
    .map((toolName) => toolName.trim())
    .filter(Boolean)
    .filter(
      (tool, index, list) =>
        list.findIndex((candidate) => candidate.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index,
    );
  const nextTools = cleanedToolNames.map((toolName, index) => ({
    id: stepToolId(stepId, toolName),
    task_id: taskId,
    step_id: stepId,
    tool_name: toolName,
    sequence: index + 1,
  }));
  const nextToolIds = nextTools.map((tool) => tool.id);
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const existingTools = await throwIfError(
    supabase.from("step_tools").select("id").eq("task_id", taskId).eq("step_id", stepId),
  );
  const staleToolIds = (existingTools ?? [])
    .map((tool) => String(tool.id))
    .filter((toolId) => !nextToolIds.includes(toolId));

  if (nextTools.length) {
    assertCurrent?.();
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (staleToolIds.length) {
    assertCurrent?.();
    await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
  }
}

// Tools are project-scoped; every tool-library mutation requires a project context.
function requireToolLibraryProjectId(projectId: string | undefined, action: string): string {
  if (!projectId) {
    throw new Error(`Select a workspace before ${action} the library.`);
  }
  return projectId;
}

export async function loadToolLibraryFromSupabase(projectId?: string): Promise<ToolLibraryItem[]> {
  // Tools are project-scoped; with no project context there is no library to load.
  if (!projectId) {
    return [];
  }

  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase.from("tool_library").select("*").eq("project_id", projectId).order("tool_name"),
  );
  const signedRows = await withSignedToolLibraryRows(supabase, (rows ?? []) as ToolLibraryRow[]);
  return signedRows.map(mapToolLibraryRow);
}

export async function uploadToolLibraryImage(
  toolName: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
): Promise<ToolLibraryItem> {
  const tool = toolName.trim();
  if (!tool) {
    throw new Error("Add a tool name before uploading an image.");
  }

  if (!project) {
    throw new Error("Select a workspace before adding tools to the library.");
  }

  const supabase = plannerClient();
  const projectId = project.projectId;
  const blob = await dataUrlToBlob(photo.dataUrl);
  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const pathSegments = ["workspaces", project.workspaceId, "projects", project.projectId, "tool-library", `${toolLibraryId(tool, projectId)}.${extension}`];
  const storagePath = pathSegments.map(safeStorageSegment).join("/");

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType: photo.contentType ?? blob.type ?? "image/jpeg",
      upsert: true,
    }),
  );

  const row = {
    id: toolLibraryId(tool, projectId),
    project_id: projectId,
    tool_name: tool,
    image_url: stableStoragePublicUrl(storagePath),
    storage_path: storagePath,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  const [signedSaved] = await withSignedToolLibraryRows(supabase, [saved as ToolLibraryRow]);
  return mapToolLibraryRow(signedSaved);
}

export async function upsertToolLibraryMetadata(input: {
  toolName: string;
  category?: string;
  projectId?: string;
  previousToolName?: string;
}): Promise<ToolLibraryItem> {
  const toolName = input.toolName.trim();
  if (!toolName) {
    throw new Error("Tool name is required.");
  }

  const projectId = requireToolLibraryProjectId(input.projectId, "saving tools to");

  const supabase = plannerClient();
  const previousName = input.previousToolName?.trim();
  let existing: ToolLibraryRow | null = null;

  if (previousName && previousName.toLocaleLowerCase() !== toolName.toLocaleLowerCase()) {
    const oldId = toolLibraryId(previousName, projectId);
    existing = (await throwIfError(
      supabase.from("tool_library").select("*").eq("id", oldId).maybeSingle(),
    )) as ToolLibraryRow | null;

    if (existing) {
      await throwIfError(supabase.from("tool_library").delete().eq("id", oldId));
    }
  } else {
    existing = (await throwIfError(
      supabase.from("tool_library").select("*").eq("id", toolLibraryId(toolName, projectId)).maybeSingle(),
    )) as ToolLibraryRow | null;
  }

  const row = {
    id: toolLibraryId(toolName, projectId),
    project_id: projectId,
    tool_name: toolName,
    category: input.category?.trim() || null,
    image_url: existing?.image_url ?? null,
    storage_path: existing?.storage_path ?? null,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  const [signedSaved] = await withSignedToolLibraryRows(supabase, [saved as ToolLibraryRow]);
  return mapToolLibraryRow(signedSaved);
}

export async function deleteToolLibraryFromSupabase(id: string, projectId?: string) {
  const ensuredProjectId = requireToolLibraryProjectId(projectId, "removing tools from");
  const supabase = plannerClient();
  // Read the storage path before the row delete so the object can be cleaned up afterwards.
  const existing = (await throwIfError(
    supabase
      .from("tool_library")
      .select("storage_path")
      .eq("id", id)
      .eq("project_id", ensuredProjectId)
      .maybeSingle(),
  )) as Pick<ToolLibraryRow, "storage_path"> | null;
  await throwIfError(
    supabase.from("tool_library").delete().eq("id", id).eq("project_id", ensuredProjectId),
  );
  if (existing?.storage_path) {
    await removeStorageObjects(supabase, stepPhotoBucket, [existing.storage_path]);
  }
}

function stepToolId(stepId: string, toolName: string) {
  return `tool-${safeStorageSegment(stepId)}-${safeStorageSegment(toolName.trim().toLocaleLowerCase())}`;
}

function toolLibraryId(toolName: string, projectId?: string) {
  const scope = projectId ? safeStorageSegment(projectId) : "global";
  return `tool-library-${scope}-${safeStorageSegment(toolName.trim().toLocaleLowerCase())}`;
}

function mapToolLibraryRow(row: ToolLibraryRow): ToolLibraryItem {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    toolName: String(row.tool_name),
    imageUrl: row.image_url ?? undefined,
    storagePath: row.storage_path ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function stepToolRowsFromTask(task: Task): StepToolRow[] {
  return Object.entries(getTaskStepToolListMap(task)).flatMap(([stepId, tools]) =>
    tools.map((toolName, index) => ({
      id: stepToolId(stepId, toolName),
      task_id: task.id,
      step_id: stepId,
      tool_name: toolName,
      sequence: index + 1,
    })),
  );
}

// Batched equivalent of calling syncStepToolsForTask per task: one existence read, one upsert,
// one stale-delete across the whole task set (was 2-3 queries PER task). Preserves the default
// allowEmptyWipe=false semantics -- a task that ends up with no tools keeps its existing tools
// (only tasks that contribute at least one tool have their stale rows removed).
export async function syncStepToolsForTasks(supabase: ReturnType<typeof plannerClient>, tasks: Task[]) {
  if (tasks.length === 0) {
    return;
  }

  const taskIds = tasks.map((task) => task.id);
  const nextToolsByTask = new Map(tasks.map((task) => [task.id, stepToolRowsFromTask(task)] as const));
  const nextTools = [...nextToolsByTask.values()].flat();
  const nextToolIds = new Set(nextTools.map((tool) => tool.id));
  const wipeableTaskIds = new Set(
    [...nextToolsByTask].filter(([, tools]) => tools.length > 0).map(([id]) => id),
  );

  const existingTools = await throwIfError(
    supabase.from("step_tools").select("id, task_id").in("task_id", taskIds),
  );
  const staleToolIds = (existingTools ?? [])
    .filter((tool) => !nextToolIds.has(String(tool.id)) && wipeableTaskIds.has(String(tool.task_id)))
    .map((tool) => String(tool.id));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (staleToolIds.length) {
    await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
  }
}

export async function syncStepToolsForTask(
  supabase: ReturnType<typeof plannerClient>,
  task: Task,
  options: { allowEmptyWipe?: boolean } = {},
) {
  const nextTools = stepToolRowsFromTask(task);
  const nextToolIds = nextTools.map((tool) => tool.id);
  const existingTools = await throwIfError(supabase.from("step_tools").select("id").eq("task_id", task.id));
  const staleToolIds = (existingTools ?? [])
    .map((tool) => String(tool.id))
    .filter((toolId) => !nextToolIds.includes(toolId));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (!staleToolIds.length) {
    return;
  }

  if (nextTools.length === 0 && !options.allowEmptyWipe) {
    return;
  }

  await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
}
