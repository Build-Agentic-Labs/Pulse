import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSopAnnexFiles,
  removeSopAnnexFile,
  uploadSopAnnexFile,
  type SopAnnexFile,
} from "@/lib/sop/annex-files";
import { useSopAttachments } from "./use-sop-attachments";
vi.mock("@/lib/sop/annex-files", () => ({
  listSopAnnexFiles: vi.fn(),
  removeSopAnnexFile: vi.fn(),
  uploadSopAnnexFile: vi.fn(),
  createSopAnnexFileUrl: vi.fn(),
  openSopAnnexFile: vi.fn(),
  renameSopAnnexFile: vi.fn(),
}));
const file: SopAnnexFile = {
  id: "file",
  annexId: "annex",
  sopId: "test",
  workspaceId: "local",
  storagePath: "local/file",
  originalName: "form.csv",
  contentType: "text/csv",
  sizeBytes: 4,
  uploadedBy: "author",
  createdAt: "now",
  updatedAt: "now",
};
function setup(
  overrides: Partial<Parameters<typeof useSopAttachments>[0]> = {},
) {
  const options = {
    sopId: "test",
    annexes: [{ id: "annex", label: "Form", description: "" }],
    workspaceId: "local",
    hasPersistedSop: false,
    persist: vi.fn().mockResolvedValue(true),
    updateReferenceDocs: vi.fn(),
    updateAnnexes: vi.fn(),
    isAnnexPersisted: vi.fn().mockReturnValue(false),
    ...overrides,
  };
  return { ...renderHook(() => useSopAttachments(options)), options };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSopAnnexFiles).mockResolvedValue([]);
  vi.mocked(uploadSopAnnexFile).mockResolvedValue(file);
});
describe("SOP attachment ordering", () => {
  it("waits for a new annex row to save before uploading", async () => {
    let finish!: (saved: boolean) => void;
    const persist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = setup({ persist });
    let upload!: Promise<void>;
    act(() => {
      upload = result.current.handleAnnexUpload(
        0,
        new File(["test"], "form.csv"),
      );
    });
    expect(result.current.annexUploadStatus?.phase).toBe("saving");
    expect(uploadSopAnnexFile).not.toHaveBeenCalled();
    await act(async () => {
      finish(true);
      await upload;
    });
    expect(uploadSopAnnexFile).toHaveBeenCalledOnce();
    expect(result.current.annexUploadStatus?.phase).toBe("success");
  });
  it("pauses annex upload when saving fails", async () => {
    const { result } = setup({ persist: vi.fn().mockResolvedValue(false) });
    await act(async () => {
      await result.current.handleAnnexUpload(0, new File(["test"], "form.csv"));
    });
    expect(uploadSopAnnexFile).not.toHaveBeenCalled();
    expect(result.current.annexUploadStatus?.phase).toBe("error");
    expect(result.current.uploadingAnnexId).toBeNull();
  });
  it("does not save again for an already-persisted annex row", async () => {
    const { result, options } = setup({ isAnnexPersisted: () => true });
    await act(async () => {
      await result.current.handleAnnexUpload(0, new File(["test"], "form.csv"));
    });
    expect(options.persist).not.toHaveBeenCalled();
    expect(uploadSopAnnexFile).toHaveBeenCalledOnce();
  });
  it("adds reference metadata only after the file upload succeeds", async () => {
    const { result, options } = setup();
    vi.mocked(uploadSopAnnexFile).mockImplementation(async () => {
      expect(options.persist).toHaveBeenCalledOnce();
      expect(options.updateReferenceDocs).not.toHaveBeenCalled();
      return file;
    });
    await act(async () => {
      await result.current.handleReferenceDocUpload(
        new File(["test"], "reference.csv"),
      );
    });
    expect(options.updateReferenceDocs).toHaveBeenCalledOnce();
    expect(result.current.uploadingReferenceDoc).toBe(false);
  });
  it("retains an annex row and attachment when storage deletion fails", async () => {
    vi.mocked(listSopAnnexFiles).mockResolvedValue([file]);
    vi.mocked(removeSopAnnexFile).mockRejectedValue(
      new Error("storage unavailable"),
    );
    const { result, options } = setup({ hasPersistedSop: true });
    await act(async () => {});
    await act(async () => {
      await result.current.handleAnnexRowRemove(0);
    });
    expect(options.updateAnnexes).not.toHaveBeenCalled();
    expect(result.current.annexFiles).toEqual([file]);
    expect(result.current.annexFileError).toBe("storage unavailable");
  });
});
describe("SOP attachment list refetch", () => {
  it("does not re-list attached files when an autosave advances the concurrency token", async () => {
    const persisted = {
      sopId: "test",
      annexes: [{ id: "annex", label: "Form", description: "" }],
      workspaceId: "local",
      hasPersistedSop: true,
      persist: vi.fn().mockResolvedValue(true),
      updateReferenceDocs: vi.fn(),
      updateAnnexes: vi.fn(),
      isAnnexPersisted: vi.fn().mockReturnValue(true),
    };
    // Autosave advances `persistedUpdatedAt` on every save; the hook must not key on it.
    const firstSave = { ...persisted, persistedUpdatedAt: "2026-10-09T10:00:00Z" };
    const { rerender } = renderHook((options) => useSopAttachments(options), {
      initialProps: firstSave,
    });
    await act(async () => {});
    expect(listSopAnnexFiles).toHaveBeenCalledOnce();
    rerender({ ...firstSave, persistedUpdatedAt: "2026-10-09T10:00:05Z" });
    rerender({ ...firstSave, persistedUpdatedAt: "2026-10-09T10:00:10Z" });
    await act(async () => {});
    expect(listSopAnnexFiles).toHaveBeenCalledOnce();
  });
  it("lists attached files once a new SOP is first persisted", async () => {
    const unsaved = {
      sopId: "test",
      annexes: [],
      workspaceId: "local",
      hasPersistedSop: false,
      persist: vi.fn().mockResolvedValue(true),
      updateReferenceDocs: vi.fn(),
      updateAnnexes: vi.fn(),
      isAnnexPersisted: vi.fn().mockReturnValue(false),
    };
    const { rerender } = renderHook((options) => useSopAttachments(options), {
      initialProps: unsaved,
    });
    await act(async () => {});
    expect(listSopAnnexFiles).not.toHaveBeenCalled();
    rerender({ ...unsaved, hasPersistedSop: true });
    await act(async () => {});
    expect(listSopAnnexFiles).toHaveBeenCalledOnce();
  });
});
