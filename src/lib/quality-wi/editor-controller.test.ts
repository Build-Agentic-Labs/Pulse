import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  applyWiEdit,
  type PendingWiEdit,
  type QualityWi,
} from "@/domain/quality-wi/schema";
import {
  WiEditorController,
  type WiEditorDependencies,
} from "./editor-controller";
const initial: QualityWi = {
  id: "wi",
  workspaceId: "w",
  departmentId: "d",
  departmentCode: "PRO",
  departmentName: "Process",
  title: "Title",
  purpose: "Scope",
  responsibilities: "Author",
  documentNumber: null,
  version: 1,
  hasChanges: true,
  publishedRevisionId: null,
  updatedAt: "",
  steps: [
    {
      id: "step",
      position: 1,
      title: "Open",
      instruction: "Open file",
      image: null,
    },
  ],
};
let controller: WiEditorController;
let server: QualityWi;
let recovery: PendingWiEdit[];
let deps: WiEditorDependencies;
beforeEach(() => {
  vi.useFakeTimers();
  server = structuredClone(initial);
  recovery = [];
  const receipts = new Map<
    string,
    { id: string; version: number; operation: string }
  >();
  deps = {
    loadRecovery: vi.fn(async () => recovery),
    storeRecovery: vi.fn(async (entries) => {
      recovery = structuredClone(entries);
    }),
    acknowledge: vi.fn(async () => undefined),
    reload: vi.fn(async () => structuredClone(server)),
    save: vi.fn(async (entry) => {
      if (receipts.has(entry.operation)) return receipts.get(entry.operation)!;
      if (entry.expectedVersion !== server.version) throw Error("Conflict");
      server = {
        ...applyWiEdit(server, entry.edit),
        version: server.version + 1,
      };
      const result = {
        id: server.id,
        version: server.version,
        operation: entry.operation,
      };
      receipts.set(entry.operation, result);
      return result;
    }),
    publish: vi.fn(async (version, operation) => {
      if (version !== server.version) throw Error("Conflict");
      server = {
        ...server,
        version: version + 1,
        documentNumber: "WI-PRO-001",
        hasChanges: false,
        publishedRevisionId: operation,
      };
      return { id: server.id, version: server.version, operation };
    }),
  };
  controller = new WiEditorController(initial, deps);
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});
it("coalesces typing before sending and confirms Saved only after the database read", async () => {
  await controller.start();
  controller.edit({ kind: "details", payload: { title: "F" } });
  controller.edit({ kind: "details", payload: { title: "Final" } });
  expect(controller.getSnapshot().status).toBe("saving");
  await controller.flush();
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot()).toMatchObject({
    status: "saved",
    pending: 0,
    document: { title: "Final", version: 2 },
  });
});
it("retains an offline edit and retries its same exact operation", async () => {
  await controller.start();
  vi.mocked(deps.save).mockRejectedValueOnce(Error("offline"));
  controller.edit({ kind: "details", payload: { title: "Retain" } });
  expect(await controller.flush()).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({
    status: "error",
    pending: 1,
    document: { title: "Retain" },
  });
  expect(recovery[0].edit.payload).toEqual({ title: "Retain" });
  await controller.flush();
  expect(vi.mocked(deps.save).mock.calls[0][0]).toEqual(
    vi.mocked(deps.save).mock.calls[1][0],
  );
  expect(controller.getSnapshot().status).toBe("saved");
});
it("does not mutate an issued edit when typing continues", async () => {
  await controller.start();
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = deps.save;
  deps.save = vi.fn(async (entry, guard) => {
    await wait;
    return save(entry, guard);
  });
  controller.edit({ kind: "details", payload: { title: "First" } });
  const first = controller.flush();
  await Promise.resolve();
  await Promise.resolve();
  controller.edit({ kind: "details", payload: { title: "Second" } });
  release();
  await first;
  expect(
    vi.mocked(deps.save).mock.calls.map((call) => call[0].edit.payload),
  ).toEqual([{ title: "First" }, { title: "Second" }]);
  expect(server.title).toBe("Second");
});
it("replays a committed edit after confirmation failure without overwriting newer unrelated content", async () => {
  await controller.start();
  vi.mocked(deps.reload).mockRejectedValueOnce(Error("confirmation offline"));
  controller.edit({ kind: "details", payload: { title: "Mine" } });
  expect(await controller.flush()).toBe(false);
  server = { ...server, responsibilities: "Teammate correction", version: 3 };
  await controller.flush();
  expect(controller.getSnapshot().document).toMatchObject({
    title: "Mine",
    responsibilities: "Teammate correction",
    version: 3,
  });
  expect(vi.mocked(deps.save).mock.calls[0][0]).toEqual(
    vi.mocked(deps.save).mock.calls[1][0],
  );
});
it("blocks publishing while any edit fails", async () => {
  await controller.start();
  vi.mocked(deps.save).mockRejectedValue(Error("offline"));
  controller.edit({ kind: "details", payload: { title: "Pending" } });
  expect(await controller.publish("Initial")).toBe(false);
  expect(deps.publish).not.toHaveBeenCalled();
  expect(controller.getSnapshot().document.documentNumber).toBeNull();
});
it("publishes directly after edits are confirmed", async () => {
  await controller.start();
  controller.edit({ kind: "details", payload: { title: "Published title" } });
  expect(await controller.publish("Initial")).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({
    status: "saved",
    pending: 0,
    publishing: false,
    document: { documentNumber: "WI-PRO-001", hasChanges: false },
  });
});
it("stores changes immediately but cancels an unsent timer when leaving", async () => {
  await controller.start();
  controller.edit({ kind: "details", payload: { title: "Unsent" } });
  await Promise.resolve();
  controller.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(deps.save).not.toHaveBeenCalled();
  expect(recovery[0].edit.payload).toEqual({ title: "Unsent" });
});
it("contains local storage failures while preserving database saving", async () => {
  await controller.start();
  vi.mocked(deps.storeRecovery).mockRejectedValue(Error("blocked"));
  controller.edit({ kind: "details", payload: { title: "Online" } });
  expect(await controller.flush()).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({
    status: "saved",
    localWarning: expect.stringContaining("Browser recovery"),
    document: { title: "Online" },
  });
});

it("refuses recovered unissued intent based on an older document version", async () => {
  server = { ...server, title: "Teammate", version: 4 };
  recovery = [
    {
      operation: "unsent",
      baseVersion: 1,
      edit: { kind: "details", payload: { title: "My old edit" } },
    },
  ];
  controller.dispose();
  controller = new WiEditorController(server, deps);
  await controller.start();
  expect(await controller.flush()).toBe(false);
  expect(server.title).toBe("Teammate");
  expect(controller.getSnapshot()).toMatchObject({
    status: "error",
    pending: 1,
    document: { title: "My old edit" },
  });
});
