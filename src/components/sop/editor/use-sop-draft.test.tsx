import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptySop, type Sop } from "@/domain/sop/schema";
import { saveSop, SopConflictError } from "@/lib/sop/store";
import { useSopDraft } from "./use-sop-draft";

vi.mock("@/lib/sop/store", () => ({
  saveSop: vi.fn(),
  SopConflictError: class extends Error {
    constructor() {
      super("Conflict");
    }
  },
}));
const save = vi.mocked(saveSop);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<Parameters<typeof useSopDraft>[0]> = {}) {
  const initial = {
    ...createEmptySop("test", "2026-10-08"),
    updatedAt: "loaded",
  };
  return renderHook(() =>
    useSopDraft({
      initial,
      isNew: false,
      workspaceId: "local",
      canEditPermission: true,
      deptId: "department",
      hasSelectedDepartment: true,
      reviewCycle: 0,
      pauseAutosave: false,
      ...overrides,
    }),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SOP draft persistence contracts", () => {
  it("does not create a blank draft on open, and debounces real edits", async () => {
    save.mockImplementation(async (sop) => ({ ...sop, updatedAt: "saved" }));
    const { result } = setup({ isNew: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.update({ purpose: "first" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    act(() => result.current.update({ purpose: "latest" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "latest",
        meta: expect.objectContaining({ sopNumber: "", version: "1.0" }),
      }),
      "local",
      {
        expectedUpdatedAt: undefined,
        departmentId: "department",
        docType: "SOP",
      },
    );
    expect(result.current.dirty).toBe(false);
  });

  it("keeps typing that arrives while an older save is in flight", async () => {
    const pending = deferred<Sop>();
    save.mockReturnValueOnce(pending.promise);
    const { result } = setup();
    act(() => result.current.update({ purpose: "old" }));
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.persist();
    });
    act(() => result.current.update({ purpose: "new" }));
    await act(async () => {
      pending.resolve({ ...save.mock.calls[0][0], updatedAt: "fresh" });
      await saving;
    });
    expect(result.current.sop.purpose).toBe("new");
    expect(result.current.dirty).toBe(true);
    expect(result.current.persistedUpdatedAt).toBe("fresh");
    expect(result.current.saveStatus).toBe("idle");
  });

  it("does not treat a stale render's save as containing newer edits", async () => {
    save.mockImplementation(async (sop) => ({ ...sop, updatedAt: "saved" }));
    const { result } = setup();
    act(() => result.current.update({ purpose: "older" }));
    const stalePersist = result.current.persist;
    act(() => result.current.update({ purpose: "newer" }));
    await act(async () => {
      await stalePersist();
    });
    expect(save.mock.calls[0][0].purpose).toBe("older");
    expect(result.current.sop.purpose).toBe("newer");
    expect(result.current.dirty).toBe(true);
  });

  it("serializes a manual save behind autosave using the returned token", async () => {
    const pending = deferred<Sop>();
    save.mockReturnValueOnce(pending.promise);
    save.mockImplementationOnce(async (sop) => ({
      ...sop,
      updatedAt: "second",
    }));
    const { result } = setup();
    act(() => result.current.update({ purpose: "old" }));
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.persist();
    });
    act(() => result.current.update({ purpose: "new" }));
    act(() => {
      second = result.current.persist();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ...save.mock.calls[0][0], updatedAt: "first" });
      await Promise.all([first, second]);
    });
    expect(save.mock.calls[1][0].purpose).toBe("new");
    expect(save.mock.calls[1][2]?.expectedUpdatedAt).toBe("first");
    expect(result.current.dirty).toBe(false);
  });

  it("freezes autosave after a conflict and reload explicitly clears it", async () => {
    save.mockRejectedValue(new SopConflictError());
    const { result } = setup();
    act(() => result.current.update({ purpose: "local" }));
    await act(async () => {
      await result.current.persist();
    });
    act(() => result.current.update({ purpose: "still local" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.conflicted).toBe(true);
    act(() =>
      result.current.replaceWithLatest({
        ...result.current.sop,
        purpose: "server",
        updatedAt: "reload",
      }),
    );
    expect(result.current.conflicted).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.sop.purpose).toBe("server");
  });

  it("uses a workflow transition's token on the next content save", async () => {
    save.mockImplementation(async (sop) => ({ ...sop, updatedAt: "saved" }));
    const { result } = setup();
    act(() => result.current.adoptWorkflowTransition({ status: "draft", updatedAt: "transition" }));
    act(() => result.current.update({ purpose: "edited" }));
    await act(async () => {
      await result.current.persist();
    });
    expect(save.mock.calls[0][2]?.expectedUpdatedAt).toBe("transition");
  });

  it("does not autosave during an approval action or without a department", async () => {
    const { result } = setup({ pauseAutosave: true });
    act(() => result.current.update({ purpose: "edited" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(save).not.toHaveBeenCalled();
    const missingDepartment = setup({
      isNew: true,
      deptId: "",
      hasSelectedDepartment: false,
    });
    await act(async () => {
      expect(await missingDepartment.result.current.persist()).toBe(false);
    });
    expect(save).not.toHaveBeenCalled();
    expect(missingDepartment.result.current.saveError).toContain(
      "owning department",
    );
  });
});

describe("SOP workflow action boundary", () => {
  it("observes a remote status without treating local edits as saved", () => {
    const { result } = setup();
    act(() => result.current.update({ purpose: "unsaved edit" }));
    act(() => result.current.observeWorkflowStatus("in_review"));
    expect(result.current.sop.status).toBe("in_review");
    expect(result.current.sop.purpose).toBe("unsaved edit");
    expect(result.current.dirty).toBe(true);
    expect(result.current.persistedUpdatedAt).toBe("loaded");
  });

  it("adopts a transition's status and token together without discarding local content", () => {
    const { result } = setup();
    act(() => result.current.update({ purpose: "local content" }));
    act(() => result.current.adoptWorkflowTransition({status: "in_review", updatedAt: "transition"}));
    expect(result.current.sop.status).toBe("in_review");
    expect(result.current.sop.updatedAt).toBe("transition");
    expect(result.current.persistedUpdatedAt).toBe("transition");
    expect(result.current.sop.purpose).toBe("local content");
    expect(result.current.dirty).toBe(true);
  });
});
