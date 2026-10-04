// @vitest-environment jsdom
// Unit characterization of the IndexedDB recovery-draft store over a minimal IndexedDB double, plus the
// real jsdom FileReader for readBlobAsDataUrl. Error paths use the double's failure injection.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installIndexedDbDouble, type IndexedDbDouble } from "@/test-support/indexeddb-double";
import {
  clearMobileNewStepRecoveryDraft,
  loadMobileNewStepRecoveryDraft,
  readBlobAsDataUrl,
  saveMobileNewStepRecoveryDraft,
  type MobileNewStepDraftRecord,
} from "./recovery-draft-store";

const DB = "buildlogic-mobile-drafts";
const STORE = "drafts";
const KEY = "mobile-new-step-draft-v1";
const draft: Omit<MobileNewStepDraftRecord, "key" | "updatedAt"> = {
  taskId: "task-a", stepId: "step-1", name: "Fit", instruction: "Tighten", durationText: "5", tools: ["T"], photos: [], checks: ["c"], checkValues: { c: { value: "pass" } as never },
};
let idb: IndexedDbDouble | null = null;
afterEach(() => { idb?.uninstall(); idb = null; vi.restoreAllMocks(); });

describe("recovery-draft store over IndexedDB", () => {
  beforeEach(() => { idb = installIndexedDbDouble(); });

  it("saves one record under the fixed key with an ISO updatedAt in the named database and store, then closes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    await saveMobileNewStepRecoveryDraft(draft);
    vi.useRealTimers();
    expect(idb!.records(DB, STORE)).toEqual([{ ...draft, key: KEY, updatedAt: "2026-10-04T12:00:00.000Z" }]);
    expect(idb!.databases.get(DB)!.get(STORE)!.keyPath).toBe("key");
    expect(idb!.upgrades).toBe(1);
    expect(idb!.closes).toBe(1);
  });

  it("loads the saved record, or null when nothing is stored", async () => {
    expect(await loadMobileNewStepRecoveryDraft()).toBeNull();
    await saveMobileNewStepRecoveryDraft(draft);
    expect(await loadMobileNewStepRecoveryDraft()).toMatchObject({ ...draft, key: KEY });
    expect(idb!.closes).toBe(3);
  });

  it("a second save overwrites the single record", async () => {
    await saveMobileNewStepRecoveryDraft(draft);
    await saveMobileNewStepRecoveryDraft({ ...draft, name: "Fit bracket", taskId: "task-b" });
    expect(idb!.records(DB, STORE)).toHaveLength(1);
    expect(idb!.records(DB, STORE)[0]).toMatchObject({ key: KEY, name: "Fit bracket", taskId: "task-b" });
  });

  it("clear deletes the record and is a no-op when nothing is stored", async () => {
    await saveMobileNewStepRecoveryDraft(draft);
    await clearMobileNewStepRecoveryDraft();
    expect(idb!.records(DB, STORE)).toEqual([]);
    await expect(clearMobileNewStepRecoveryDraft()).resolves.toBeUndefined();
    expect(idb!.closes).toBe(3);
  });

  it("does not create a second store or upgrade on later opens", async () => {
    await saveMobileNewStepRecoveryDraft(draft);
    await loadMobileNewStepRecoveryDraft();
    await clearMobileNewStepRecoveryDraft();
    expect(idb!.opens).toBe(3);
    expect(idb!.upgrades).toBe(1);
    expect([...idb!.databases.get(DB)!.keys()]).toEqual([STORE]);
  });
});

describe("recovery-draft store failure behaviour", () => {
  it("rejects with the unavailable-storage message when indexedDB is missing", async () => {
    expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe("undefined");
    await expect(saveMobileNewStepRecoveryDraft(draft)).rejects.toThrow("Local draft storage is not available in this browser.");
    await expect(loadMobileNewStepRecoveryDraft()).rejects.toThrow("Local draft storage is not available in this browser.");
    await expect(clearMobileNewStepRecoveryDraft()).rejects.toThrow("Local draft storage is not available in this browser.");
  });

  it("propagates an open error", async () => {
    idb = installIndexedDbDouble({ openError: new Error("open blocked") });
    await expect(loadMobileNewStepRecoveryDraft()).rejects.toThrow("open blocked");
    expect(idb.closes).toBe(0);
  });

  it("propagates a transaction error from save and clear and still closes the database", async () => {
    idb = installIndexedDbDouble({ transactionError: new Error("tx failed") });
    await expect(saveMobileNewStepRecoveryDraft(draft)).rejects.toThrow("tx failed");
    await expect(clearMobileNewStepRecoveryDraft()).rejects.toThrow("tx failed");
    expect(idb.closes).toBe(2);
  });

  it("propagates a request error from load and still closes the database", async () => {
    idb = installIndexedDbDouble({ requestError: new Error("read failed") });
    await expect(loadMobileNewStepRecoveryDraft()).rejects.toThrow("read failed");
    expect(idb.closes).toBe(1);
  });
});

describe("readBlobAsDataUrl", () => {
  it("reads a blob as a data URL with the real FileReader", async () => {
    const url = await readBlobAsDataUrl(new Blob(["hello"], { type: "text/plain" }));
    expect(url).toBe("data:text/plain;base64,aGVsbG8=");
  });

  it("rejects with its own message when the reader errors", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => this.onerror?.(new ProgressEvent("error") as never));
    });
    await expect(readBlobAsDataUrl(new Blob(["x"]))).rejects.toThrow("Unable to read compressed photo.");
  });
});
