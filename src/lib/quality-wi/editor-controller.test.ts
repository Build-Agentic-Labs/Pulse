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

it("leaves Saving when a save request stalls and retries the same operation", async () => {
  await controller.start();
  const normalSave = deps.save;
  deps.save = vi.fn(() => new Promise<never>(() => {}));
  controller.edit({ kind: "details", payload: { title: "Retained title" } });
  const saving = controller.flush();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await saving).toBe(false);
  expect(controller.getSnapshot().status).toBe("error");
  expect(controller.getSnapshot().message).toContain("Work instruction save timed out");
  expect(controller.getSnapshot().document.title).toBe("Retained title");
  const operation = recovery[0].operation;
  deps.save = normalSave;
  expect(await controller.flush()).toBe(true);
  expect(controller.getSnapshot().status).toBe("saved");
  expect(vi.mocked(normalSave).mock.calls.at(-1)?.[0].operation).toBe(operation);
});

it("reports a stalled confirmation without dropping the pending edit", async () => {
  await controller.start();
  deps.reload = vi.fn(() => new Promise<never>(() => {}));
  controller.edit({ kind: "details", payload: { title: "Retained title" } });
  const saving = controller.flush();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await saving).toBe(false);
  expect(controller.getSnapshot().message).toContain("Saved draft confirmation timed out");
  expect(controller.getSnapshot().pending).toBe(1);
});

it("stops autosaving after a conflict and loads the saved draft only on explicit acceptance", async () => {
  await controller.start();
  deps.save = vi.fn(async () => { throw Object.assign(new Error("Changed elsewhere"), { code: "PT409" }); });
  deps.archiveRecovery = vi.fn(async () => undefined);
  controller.edit({ kind: "details", payload: { title: "Local intent" } });
  expect(await controller.flush()).toBe(false);
  expect(controller.getSnapshot().conflicted).toBe(true);
  controller.edit({ kind: "details", payload: { title: "Keep editing" } });
  await vi.advanceTimersByTimeAsync(1000);
  expect(deps.save).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().document.title).toBe("Keep editing");
  expect(controller.getSnapshot().status).toBe("error");
  expect(await controller.acceptSaved()).toBe(true);
  expect(deps.archiveRecovery).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().status).toBe("saved");
  expect(controller.getSnapshot().document.title).toBe(server.title);
});

it("navigation must not resubmit a known conflict", async () => {
  await controller.start();
  deps.save = vi.fn(async () => { throw Object.assign(new Error("Changed elsewhere"), {code: "PT409"}); });
  controller.edit({kind:"details",payload:{title:"Local"}});
  await controller.flush();
  await controller.flush();
  expect(deps.save).toHaveBeenCalledTimes(1);
});

it("accepting saved must not drop edits made during archive", async () => {
  await controller.start();
  deps.save = vi.fn(async () => { throw Object.assign(new Error("Changed elsewhere"), {code: "PT409"}); });
  controller.edit({kind:"details",payload:{title:"Old local"}});
  await controller.flush();
  let entered!: () => void;
  const archiving = new Promise<void>(resolve => { entered=resolve; });
  let release!: () => void;
  deps.archiveRecovery = vi.fn(async () => { entered(); await new Promise<void>(resolve => { release=resolve; }); });
  const normalSave = deps.save;
  const accepting = controller.acceptSaved();
  await archiving;
  controller.edit({kind:"details",payload:{title:"Typed during reload"}});
  release();
  await accepting;
  expect(controller.getSnapshot().document.title).toBe("Typed during reload");
  expect(controller.getSnapshot().pending).toBe(1);
  expect(deps.archiveRecovery).toHaveBeenCalledWith([
    expect.objectContaining({ edit: { kind: "details", payload: { title: "Old local" } } }),
  ]);
  expect(normalSave).toHaveBeenCalledTimes(1);
});

it("publish must time out instead of staying Saving indefinitely", async () => {
  await controller.start();
  deps.publish = vi.fn(() => new Promise<never>(() => {}));
  void controller.publish("Initial");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(controller.getSnapshot().publishing).toBe(false);
  expect(controller.getSnapshot().status).toBe("error");
});
