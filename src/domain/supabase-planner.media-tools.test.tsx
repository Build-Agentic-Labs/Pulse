// Characterization (browser path) of the media, tool and realtime persistence that Phase 4 moves out of
// supabase-planner.ts. Runs the real functions against an in-memory client injected the way the app's
// browser singleton is held (globalThis.__buildlogicPlannerSupabaseClient), and asserts on stored rows,
// storage objects, signing calls and authorization ordering.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import type { PlannerProjectContext } from "@/domain/types";
import { createInMemorySupabase } from "@/test-support/in-memory-supabase";
import {
  addStepToolToSupabase,
  copyStepPhotoAttachmentToStep,
  deleteToolLibraryFromSupabase,
  loadTaskPrivateMediaFromSupabase,
  loadToolLibraryFromSupabase,
  refreshSignedMediaUrl,
  removeExplodedViewObject,
  removeStepPhotoAttachmentObject,
  removeStepToolFromSupabase,
  removeTaskVideoObject,
  softDeleteExplodedViewFromSupabase,
  softDeleteStepPhotoAttachmentFromSupabase,
  softDeleteTaskVideoFromSupabase,
  subscribePlannerStateChanges,
  syncStepToolsForStepToSupabase,
  updateStepPhotoCaptionInSupabase,
  uploadStepPhotoAttachment,
  uploadToolLibraryImage,
  upsertToolLibraryMetadata,
} from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const PROJECT: PlannerProjectContext = { projectId: "project-1", workspaceId: "workspace-1" } as PlannerProjectContext;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let db: ReturnType<typeof createInMemorySupabase>;
function useDatabase(options: Parameters<typeof createInMemorySupabase>[0] = { projectId: PROJECT.projectId, userId: "user-1" }) {
  db = createInMemorySupabase(options);
  (globalThis as { __buildlogicPlannerSupabaseClient?: unknown }).__buildlogicPlannerSupabaseClient = db.client;
}
const photo = (id: string, overrides: Partial<StepPhotoAttachment> = {}): StepPhotoAttachment => ({
  id, name: "Bracket.png", dataUrl: PNG, capturedAt: "2026-10-03T00:00:00.000Z", contentType: "image/png", ...overrides,
});

beforeEach(() => {
  useDatabase();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // jsdom never fires image load/error events; decode failure exercises the real "no thumbnail" path.
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
  });
  if (!URL.createObjectURL) {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
  }
});

describe("step photo storage", () => {
  it("uploads a new photo to its project-scoped path, records attribution, and returns the signed URL", async () => {
    const saved = await uploadStepPhotoAttachment("task-1", "step-1", photo("photo-new"), PROJECT);

    const path = "workspaces/workspace-1/projects/project-1/tasks/task-1/steps/step-1/photo-new.png";
    expect(db.rpcCalls[0]).toEqual({ name: "task_project_id", args: { target_task_id: "task-1" } });
    expect(db.storageCalls.find((call) => call.method === "upload")).toEqual({ bucket: "step-photos", method: "upload", paths: [path] });
    expect(db.rows("step_photos")).toEqual([expect.objectContaining({
      id: "photo-new", task_id: "task-1", step_id: "step-1", storage_path: path,
      public_url: `https://example.supabase.co/storage/v1/object/public/step-photos/${path}`,
      uploaded_by: "user-1", deleted_at: null, mime_type: "image/png", file_name: "Bracket.png",
    })]);
    expect(saved).toMatchObject({ id: "photo-new", storagePath: path, dataUrl: db.signedUrlFor("step-photos", path) });
  });

  it("refuses a task outside the project before touching storage or rows", async () => {
    useDatabase({ projectId: "another-project", userId: "user-1" });
    await expect(uploadStepPhotoAttachment("task-1", "step-1", photo("photo-x"), PROJECT)).rejects.toThrow("does not belong to the active workspace");
    expect(db.storageCalls).toEqual([]);
    expect(db.rows("step_photos")).toEqual([]);
  });

  it("re-saves only the metadata of a photo that already lives in storage", async () => {
    const stored = photo("photo-stored", { dataUrl: "https://signed.test/old", storagePath: "workspaces/workspace-1/projects/project-1/tasks/task-1/steps/step-1/photo-stored.jpg" });
    await uploadStepPhotoAttachment("task-1", "step-1", stored, PROJECT);
    expect(db.storageCalls.filter((call) => call.method === "upload")).toEqual([]);
    expect(db.rows("step_photos")[0]).toMatchObject({ id: "photo-stored", storage_path: stored.storagePath });
  });

  it("keeps the row but fails loudly when the uploaded photo cannot be signed", async () => {
    const path = "workspaces/workspace-1/projects/project-1/tasks/task-1/steps/step-1/photo-unsigned.png";
    useDatabase({ projectId: PROJECT.projectId, userId: "user-1", unsignablePaths: [path] });
    await expect(uploadStepPhotoAttachment("task-1", "step-1", photo("photo-unsigned"), PROJECT)).rejects.toThrow("could not be created");
    expect(db.rows("step_photos")).toHaveLength(1);
  });

  it("copies a stored photo to a new path server-side and refuses a copy onto its own path", async () => {
    const source = "workspaces/workspace-1/projects/project-1/tasks/task-1/steps/step-1/photo-a.png";
    const copied = await copyStepPhotoAttachmentToStep("task-2", "step-2", photo("photo-b"), source, undefined, PROJECT);
    expect(db.storageCalls.find((call) => call.method === "copy")?.paths).toEqual([source, "workspaces/workspace-1/projects/project-1/tasks/task-2/steps/step-2/photo-b.png"]);
    expect(copied.storagePath).toContain("tasks/task-2/steps/step-2/photo-b.png");
    await expect(copyStepPhotoAttachmentToStep("task-1", "step-1", photo("photo-a"), source, undefined, PROJECT)).rejects.toThrow("destination path matches the source path");
  });

  it("removes the stored object and thumbnail, soft-deletes rows, and checks the project first when a task is given", async () => {
    await removeStepPhotoAttachmentObject(photo("p", { storagePath: "a/p.png", thumbnailStoragePath: "a/thumbnails/p.webp" }));
    await removeStepPhotoAttachmentObject(photo("q"));
    expect(db.storageCalls.filter((call) => call.method === "remove")).toEqual([{ bucket: "step-photos", method: "remove", paths: ["a/p.png", "a/thumbnails/p.webp"] }]);

    db.seed("step_photos", [{ id: "p1", deleted_at: null, caption: null }]);
    db.seed("step_exploded_views", [{ id: "v1", deleted_at: null }]);
    db.seed("task_videos", [{ id: "m1", deleted_at: null }]);
    await updateStepPhotoCaptionInSupabase("p1", "  Torque  ", "task-1", PROJECT.projectId);
    await softDeleteStepPhotoAttachmentFromSupabase("p1", "task-1", PROJECT.projectId);
    await softDeleteExplodedViewFromSupabase("v1");
    await softDeleteTaskVideoFromSupabase("m1");
    expect(db.rows("step_photos")[0]).toMatchObject({ caption: "Torque", deleted_at: expect.any(String) });
    expect(db.rows("step_exploded_views")[0]!.deleted_at).toEqual(expect.any(String));
    expect(db.rows("task_videos")[0]!.deleted_at).toEqual(expect.any(String));
    await removeExplodedViewObject({ storagePath: "a/view.png" });
    await removeTaskVideoObject({ storagePath: "a/video.mp4" });
    expect(db.storageCalls.filter((call) => call.method === "remove").slice(1)).toEqual([
      { bucket: "step-photos", method: "remove", paths: ["a/view.png"] },
      { bucket: "task-videos", method: "remove", paths: ["a/video.mp4"] },
    ]);

    useDatabase({ projectId: "another-project" });
    db.seed("step_photos", [{ id: "p2", deleted_at: null }]);
    await expect(softDeleteStepPhotoAttachmentFromSupabase("p2", "task-1", PROJECT.projectId)).rejects.toThrow("does not belong");
    expect(db.rows("step_photos")[0]!.deleted_at).toBeNull();
  });
});

describe("signed URLs in the browser", () => {
  it("caches photo signatures across reads, while a refresh always re-signs and updates the cache", async () => {
    const path = "workspaces/workspace-1/projects/project-1/tasks/task-c/steps/s/cached.png";
    db.seed("tasks", [{ id: "task-c" }]);
    db.seed("step_photos", [{ id: "cached", task_id: "task-c", step_id: "s", storage_path: path, deleted_at: null, captured_at: "2026-10-03T00:00:00.000Z" }]);
    const photoSignings = () => db.storageCalls.filter((call) => call.method.startsWith("createSignedUrl") && call.paths.includes(path)).length;

    await loadTaskPrivateMediaFromSupabase("task-c", PROJECT.projectId);
    await loadTaskPrivateMediaFromSupabase("task-c", PROJECT.projectId);
    expect(photoSignings()).toBe(1);

    expect(await refreshSignedMediaUrl(path, "photo")).toBe(db.signedUrlFor("step-photos", path));
    expect(photoSignings()).toBe(2);
    expect(await refreshSignedMediaUrl("", "photo")).toBeUndefined();
    expect(await refreshSignedMediaUrl("a/video.mp4", "video")).toBe(db.signedUrlFor("task-videos", "a/video.mp4"));
  });
});

describe("step tools and the tool library", () => {
  it("writes per-row step tools by client-format id and syncs one step's list", async () => {
    await addStepToolToSupabase("task-1", "step-1", " Torque Wrench ", 2, PROJECT.projectId);
    expect(db.rows("step_tools")).toEqual([{ id: "tool-step-1-torque-wrench", task_id: "task-1", step_id: "step-1", tool_name: "Torque Wrench", sequence: 2 }]);
    await removeStepToolFromSupabase("step-1", "Torque Wrench", "task-1", PROJECT.projectId);
    expect(db.rows("step_tools")).toEqual([]);

    db.seed("step_tools", [{ id: "tool-step-1-old", task_id: "task-1", step_id: "step-1", tool_name: "Old", sequence: 1 }]);
    await syncStepToolsForStepToSupabase("task-1", "step-1", ["Hex Key", "hex key", " ", "Mallet"], PROJECT.projectId);
    expect(db.rows("step_tools").map((row) => [row.id, row.tool_name, row.sequence])).toEqual([
      ["tool-step-1-hex-key", "Hex Key", 1], ["tool-step-1-mallet", "Mallet", 2],
    ]);
  });

  it("requires a project for the library, scopes ids and paths to it, and signs images", async () => {
    expect(await loadToolLibraryFromSupabase(undefined)).toEqual([]);
    expect(db.writes).toEqual([]);
    await expect(upsertToolLibraryMetadata({ toolName: "Hex Key" })).rejects.toThrow("Select a workspace before saving tools to the library.");
    await expect(uploadToolLibraryImage("Hex Key", photo("img"))).rejects.toThrow("Select a workspace");

    const uploaded = await uploadToolLibraryImage("Hex Key", photo("img"), PROJECT);
    const imagePath = "workspaces/workspace-1/projects/project-1/tool-library/tool-library-project-1-hex-key.png";
    expect(db.rows("tool_library")[0]).toMatchObject({ id: "tool-library-project-1-hex-key", project_id: "project-1", storage_path: imagePath });
    expect(uploaded).toMatchObject({ toolName: "Hex Key", imageUrl: db.signedUrlFor("step-photos", imagePath) });

    const renamed = await upsertToolLibraryMetadata({ toolName: "Hex Driver", category: "power", projectId: "project-1", previousToolName: "Hex Key" });
    expect(db.rows("tool_library").map((row) => [row.id, row.tool_name, row.category, row.storage_path])).toEqual([
      ["tool-library-project-1-hex-driver", "Hex Driver", "power", imagePath],
    ]);
    expect(renamed.toolName).toBe("Hex Driver");
    expect((await loadToolLibraryFromSupabase("project-1")).map((item) => item.toolName)).toEqual(["Hex Driver"]);

    db.seed("tool_library", [{ id: "other", project_id: "project-2", tool_name: "Other" }]);
    await deleteToolLibraryFromSupabase("tool-library-project-1-hex-driver", "project-1");
    await deleteToolLibraryFromSupabase("other", "project-1");
    expect(db.rows("tool_library").map((row) => row.id)).toEqual(["other"]);
    expect(db.storageCalls.filter((call) => call.method === "remove").at(-1)?.paths).toEqual([imagePath]);
    await expect(deleteToolLibraryFromSupabase("other")).rejects.toThrow("Select a workspace before removing tools from the library.");
  });
});

describe("realtime subscription", () => {
  it("registers scoped listeners, emits only changes in the shown scenario, and removes the channel on cleanup", () => {
    const listeners: Array<{ filter: { table: string; filter?: string }; callback: (payload: Record<string, unknown>) => void }> = [];
    const channel = {
      on: vi.fn((_event: string, filter: { table: string; filter?: string }, callback: (payload: Record<string, unknown>) => void) => {
        listeners.push({ filter, callback });
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const removeChannel = vi.fn(async () => "ok");
    (globalThis as { __buildlogicPlannerSupabaseClient?: unknown }).__buildlogicPlannerSupabaseClient = { channel: vi.fn(() => channel), removeChannel };
    const onChange = vi.fn();

    const unsubscribe = subscribePlannerStateChanges(onChange, { productId: "product-1", scenarioId: "scenario-1", isTaskInScope: (taskId) => taskId === "task-in" });
    expect(listeners.map(({ filter }) => `${filter.table}${filter.filter ? `?${filter.filter}` : ""}`)).toEqual([
      "products?id=eq.product-1", "scenarios?product_id=eq.product-1", "stations?scenario_id=eq.scenario-1",
      "zones?scenario_id=eq.scenario-1", "tasks?scenario_id=eq.scenario-1", "task_dependencies", "manufacturing_steps",
      "part_references", "actual_events", "step_photos", "step_exploded_views", "task_videos", "step_tools",
      "custom_columns?product_id=eq.product-1", "custom_columns?scenario_id=eq.scenario-1",
    ]);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);

    const steps = listeners.find(({ filter }) => filter.table === "manufacturing_steps")!;
    steps.callback({ eventType: "UPDATE", new: { task_id: "task-out" }, old: {} });
    steps.callback({ eventType: "UPDATE", new: { task_id: "task-in" }, old: {} });
    listeners.find(({ filter }) => filter.table === "zones")!.callback({ eventType: "DELETE", new: {}, old: { id: "z" } });
    expect(onChange.mock.calls.map(([payload]) => payload)).toEqual([
      { table: "manufacturing_steps", eventType: "UPDATE", new: { task_id: "task-in" }, old: {} },
      { table: "zones", eventType: "DELETE", new: {}, old: { id: "z" } },
    ]);

    unsubscribe();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
