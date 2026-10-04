// Characterization (server path, node environment: no window) of the media persistence Phase 4 moves.
// Server code passes a per-request client explicitly, as the SolidWorks routes do; the browser
// singleton is never used here. Also pins the signed-URL cache's server rule: never cache.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerProjectContext } from "@/domain/types";
import { createInMemorySupabase } from "@/test-support/in-memory-supabase";
import { loadTaskPrivateMediaFromSupabase, saveExplodedViewToSupabase, saveTaskVideoToSupabase } from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const PROJECT = { projectId: "project-1", workspaceId: "workspace-1" } as PlannerProjectContext;
type Client = Parameters<typeof saveExplodedViewToSupabase>[1];
let db: ReturnType<typeof createInMemorySupabase>;
const client = () => db.client as unknown as Client;

beforeEach(() => {
  db = createInMemorySupabase({ projectId: PROJECT.projectId });
});

describe("server-side signing", () => {
  it("never caches signed URLs on the server: every read signs again", async () => {
    const path = "workspaces/workspace-1/projects/project-1/tasks/task-s/steps/s/server.png";
    db.seed("tasks", [{ id: "task-s" }]);
    db.seed("step_photos", [{ id: "server", task_id: "task-s", step_id: "s", storage_path: path, deleted_at: null, captured_at: "2026-10-03T00:00:00.000Z" }]);
    await loadTaskPrivateMediaFromSupabase("task-s", PROJECT.projectId, client());
    await loadTaskPrivateMediaFromSupabase("task-s", PROJECT.projectId, client());
    expect(db.storageCalls.filter((call) => call.method.startsWith("createSignedUrl") && call.paths.includes(path))).toHaveLength(2);
  });
});

describe("signed-URL cache isolation, guard by guard", () => {
  it("never reuses a server signature, and never serves a cached browser signature on the server", async () => {
    const path = "workspaces/workspace-1/projects/project-1/tasks/task-g/steps/s/guard.png";
    db.seed("tasks", [{ id: "task-g" }]);
    db.seed("step_photos", [{ id: "guard", task_id: "task-g", step_id: "s", storage_path: path, deleted_at: null, captured_at: "2026-10-03T00:00:00.000Z" }]);
    const signings = () => db.storageCalls.filter((call) => call.method.startsWith("createSignedUrl") && call.paths.includes(path)).length;
    const read = () => loadTaskPrivateMediaFromSupabase("task-g", PROJECT.projectId, client());
    const scope = globalThis as { window?: unknown };
    try {
      await read();                 // server: signs, must not store the signature
      expect(signings()).toBe(1);
      scope.window = globalThis;    // browser conditions in the same process
      await read();                 // a server signature is never reused: signs again, and caches it
      expect(signings()).toBe(2);
      await read();                 // browser cache hit
      expect(signings()).toBe(2);
      delete scope.window;          // back to server conditions
      await read();                 // a cached browser signature is never served on the server
      expect(signings()).toBe(3);
    } finally {
      delete scope.window;
    }
  });
});

describe("SolidWorks ingest with a caller-scoped client", () => {
  it("saves an exploded view to a task-scoped path and returns it signed", async () => {
    const view = await saveExplodedViewToSupabase({
      taskId: "task-1", bytes: new Uint8Array([1, 2, 3]).buffer, contentType: "image/jpeg", fileName: " Frame 3 ",
      caption: "  Exploded  ", frameNumber: 3, components: ["A", "B"], project: PROJECT, uploadedBy: "user-9",
    }, client());

    const upload = db.storageCalls.find((call) => call.method === "upload")!;
    expect(upload.bucket).toBe("step-photos");
    expect(upload.paths[0]).toMatch(/^workspaces\/workspace-1\/projects\/project-1\/tasks\/task-1\/exploded\/view-[^/]+\.jpg$/);
    expect(db.rows("step_exploded_views")).toEqual([expect.objectContaining({
      task_id: "task-1", step_id: null, storage_path: upload.paths[0], file_name: "Frame 3", caption: "Exploded",
      mime_type: "image/jpeg", size_bytes: 3, frame_number: 3, uploaded_by: "user-9", deleted_at: null,
    })]);
    expect(view.dataUrl).toBe(db.signedUrlFor("step-photos", upload.paths[0]!));
  });

  it("refuses a task outside the project before uploading anything", async () => {
    db = createInMemorySupabase({ projectId: "another-project" });
    await expect(saveExplodedViewToSupabase({ taskId: "task-1", bytes: new Blob(["x"]), project: PROJECT }, client())).rejects.toThrow("does not belong");
    await expect(saveTaskVideoToSupabase({ taskId: "task-1", bytes: new Blob(["x"]), project: PROJECT }, client())).rejects.toThrow("does not belong");
    expect(db.storageCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("keeps the row but fails loudly when the exploded view cannot be signed", async () => {
    db = createInMemorySupabase({ projectId: PROJECT.projectId, isUnsignable: (path) => path.includes("/exploded/") });
    await expect(saveExplodedViewToSupabase({ taskId: "task-1", bytes: new Blob(["x"], { type: "image/png" }), project: PROJECT }, client()))
      .rejects.toThrow("could not be created");
    expect(db.rows("step_exploded_views")).toHaveLength(1);
  });

  it("saves a build animation to the task-videos bucket and returns its signed URL", async () => {
    const video = await saveTaskVideoToSupabase({
      taskId: "task-1", bytes: new Blob(["video"], { type: "video/webm" }), durationSeconds: 12, project: PROJECT,
    }, client());
    const upload = db.storageCalls.find((call) => call.method === "upload")!;
    expect(upload.bucket).toBe("task-videos");
    expect(upload.paths[0]).toMatch(/^workspaces\/workspace-1\/projects\/project-1\/tasks\/task-1\/videos\/video-[^/]+\.webm$/);
    expect(db.rows("task_videos")[0]).toMatchObject({
      storage_path: upload.paths[0], file_name: "Build animation", mime_type: "video/webm", duration_seconds: 12,
      public_url: `https://example.supabase.co/storage/v1/object/public/task-videos/${upload.paths[0]}`,
    });
    expect(video.videoUrl).toBe(db.signedUrlFor("task-videos", upload.paths[0]!));
  });
});
