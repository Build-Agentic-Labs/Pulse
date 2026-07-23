import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPlannerSupabaseClient: vi.fn(),
  getUserFromSession: vi.fn(),
}));

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: mocks.createPlannerSupabaseClient,
  getUserFromSession: mocks.getUserFromSession,
}));

import { annexDownloadName, removeSopAnnexFile, uploadSopAnnexFile, type SopAnnexFile } from "./annex-files";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.createPlannerSupabaseClient.mockReset();
  mocks.getUserFromSession.mockReset();
});

describe("annexDownloadName", () => {
  it("keeps browser-viewable types inline (no forced download)", () => {
    expect(annexDownloadName("application/pdf", "spec.pdf")).toBeUndefined();
    expect(annexDownloadName("image/png", "photo.png")).toBeUndefined();
    expect(annexDownloadName("image/jpeg", "photo.jpg")).toBeUndefined();
  });

  it("forces the original file name for types the browser downloads", () => {
    expect(
      annexDownloadName(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "MTS Work Orders Master - DEC - CYP.xlsx",
      ),
    ).toBe("MTS Work Orders Master - DEC - CYP.xlsx");
    expect(annexDownloadName("text/csv", "export.csv")).toBe("export.csv");
    expect(annexDownloadName("application/msword", "form.doc")).toBe("form.doc");
  });

  it("falls back to a generic name when the original is blank", () => {
    expect(annexDownloadName("text/csv", "")).toBe("download");
  });
});

const sampleFile: SopAnnexFile = {
  id: "file-1",
  workspaceId: "ws-1",
  sopId: "sop-1",
  annexId: "annex-1",
  storagePath: "workspaces/ws-1/sops/sop-1/annexes/annex-1/uuid-form.pdf",
  originalName: "form.pdf",
  contentType: "application/pdf",
  sizeBytes: 10,
  uploadedBy: "user-1",
  createdAt: "2026-07-23T00:00:00Z",
  updatedAt: "2026-07-23T00:00:00Z",
};

describe("removeSopAnnexFile", () => {
  function makeClient(opts: {
    deleteError?: { message: string } | null;
    removeError?: { message: string } | null;
  }) {
    const state = { deletedBeforeRemove: false, rowDeleted: false, removedPaths: [] as string[][] };
    const client = {
      from: () => ({
        delete: () => ({
          eq: () => {
            state.rowDeleted = true;
            return Promise.resolve({ data: null, error: opts.deleteError ?? null });
          },
        }),
      }),
      storage: {
        from: () => ({
          remove: (paths: string[]) => {
            state.deletedBeforeRemove = state.rowDeleted;
            state.removedPaths.push(paths);
            return Promise.resolve({ data: null, error: opts.removeError ?? null });
          },
        }),
      },
    };
    return { client, state };
  }

  it("deletes the metadata row before removing the storage object", async () => {
    const { client, state } = makeClient({});
    mocks.createPlannerSupabaseClient.mockReturnValue(client);

    await removeSopAnnexFile(sampleFile);

    expect(state.rowDeleted).toBe(true);
    expect(state.deletedBeforeRemove).toBe(true);
    expect(state.removedPaths).toEqual([[sampleFile.storagePath]]);
  });

  it("throws and never removes the object when the row delete is rejected", async () => {
    const { client, state } = makeClient({ deleteError: { message: "row level security" } });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);

    await expect(removeSopAnnexFile(sampleFile)).rejects.toThrow("row level security");
    expect(state.removedPaths).toEqual([]);
  });

  it("does not throw when the storage removal fails after the row is gone", async () => {
    const { client, state } = makeClient({ removeError: { message: "object not found" } });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(removeSopAnnexFile(sampleFile)).resolves.toBeUndefined();
    expect(state.rowDeleted).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("uploadSopAnnexFile race cleanup", () => {
  function makeClient(opts: {
    existing: Record<string, unknown> | null;
    winnerStoragePath?: string;
  }) {
    const state = { uploadedPath: "", removedPaths: [] as string[][] };
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.existing, error: null }),
              single: () =>
                Promise.resolve({
                  data: {
                    id: "row-1",
                    workspace_id: "ws-1",
                    sop_id: "sop-1",
                    annex_id: "annex-1",
                    storage_path: opts.winnerStoragePath ?? state.uploadedPath,
                    original_name: "form.pdf",
                    content_type: "application/pdf",
                    size_bytes: 10,
                    uploaded_by: "user-1",
                    created_at: "2026-07-23T00:00:00Z",
                    updated_at: "2026-07-23T00:00:00Z",
                  },
                  error: null,
                }),
            }),
          }),
        }),
        upsert: () => Promise.resolve({ data: null, error: null }),
      }),
      storage: {
        from: () => ({
          upload: (path: string) => {
            state.uploadedPath = path;
            return Promise.resolve({ data: { path }, error: null });
          },
          remove: (paths: string[]) => {
            state.removedPaths.push(paths);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      },
    };
    return { client, state };
  }

  const uploadInput = () => ({
    workspaceId: "ws-1",
    sopId: "sop-1",
    annexId: "annex-1",
    file: { size: 10, type: "application/pdf", name: "form.pdf" } as unknown as File,
  });

  it("removes its own orphaned object when a concurrent upload won the slot", async () => {
    const winnerStoragePath = "workspaces/ws-1/sops/sop-1/annexes/annex-1/rival-form.pdf";
    const { client, state } = makeClient({ existing: null, winnerStoragePath });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await uploadSopAnnexFile(uploadInput());

    expect(result.storagePath).toBe(winnerStoragePath);
    expect(state.removedPaths).toEqual([[state.uploadedPath]]);
  });

  it("removes the replaced object (not its own) when it won the slot", async () => {
    const oldPath = "workspaces/ws-1/sops/sop-1/annexes/annex-1/old-form.pdf";
    const { client, state } = makeClient({
      existing: {
        id: "row-1",
        workspace_id: "ws-1",
        sop_id: "sop-1",
        annex_id: "annex-1",
        storage_path: oldPath,
        original_name: "old.pdf",
        content_type: "application/pdf",
        size_bytes: 5,
        uploaded_by: "user-1",
        created_at: "2026-07-23T00:00:00Z",
        updated_at: "2026-07-23T00:00:00Z",
      },
    });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await uploadSopAnnexFile(uploadInput());

    expect(result.storagePath).toBe(state.uploadedPath);
    expect(state.removedPaths).toEqual([[oldPath]]);
  });

  it("keeps both objects when it won a fresh slot with no prior file", async () => {
    const { client, state } = makeClient({ existing: null });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await uploadSopAnnexFile(uploadInput());

    expect(result.storagePath).toBe(state.uploadedPath);
    expect(state.removedPaths).toEqual([]);
  });
});
