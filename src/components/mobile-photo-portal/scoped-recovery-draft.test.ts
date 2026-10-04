// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { installIndexedDbDouble, type IndexedDbDouble } from "@/test-support/indexeddb-double";
import { createMobileRecoveryDraftStore, recoveryDraftKey, type ScopedRecoveryDraft } from "./recovery-draft-store";

let idb: IndexedDbDouble;
beforeEach(() => { idb = installIndexedDbDouble(); });
afterEach(() => idb.uninstall());
const scope = { userId: "u", projectId: "p", taskId: "t" };
const record = (overrides: Partial<ScopedRecoveryDraft> = {}): ScopedRecoveryDraft => ({
  ...scope, key: recoveryDraftKey(scope), schemaVersion: 2, draftId: "s", stepId: "s", writeToken: "token-a",
  name: "Fit", instruction: "Tighten", durationText: "5", tools: [], photos: [], checks: [], updatedAt: new Date().toISOString(), ...overrides,
});

it("keeps user, product and task recovery slots independent", async () => {
  const store = createMobileRecoveryDraftStore();
  const scopes = [scope, { ...scope, userId: "other" }, { ...scope, projectId: "other" }, { ...scope, taskId: "other" }];
  for (const [index, own] of scopes.entries()) await store.save(record({ ...own, key: recoveryDraftKey(own), name: String(index) }));
  for (const [index, own] of scopes.entries()) expect((await store.load(own))?.name).toBe(String(index));
});

it("uses encoded scope parts without delimiter collisions", () => {
  expect(recoveryDraftKey({ ...scope, userId: "a:b", projectId: "c" })).not.toBe(recoveryDraftKey({ ...scope, userId: "a", projectId: "b:c" }));
  expect(() => recoveryDraftKey({ ...scope, userId: "" })).toThrow();
});

it("an older acknowledgment cannot delete another tab's equal-revision content", async () => {
  const a = createMobileRecoveryDraftStore(); const b = createMobileRecoveryDraftStore();
  await a.save(record());
  await b.save(record({ writeToken: "token-b", name: "Other tab" }));
  expect(await a.acknowledge(record())).toBe(false);
  expect((await b.load(scope))?.name).toBe("Other tab");
  expect(await b.acknowledge(record({ writeToken: "token-b" }))).toBe(true);
  expect(await b.load(scope)).toBeNull();
});

it("serializes local writes and acknowledgment, leaving a newer edit", async () => {
  const store = createMobileRecoveryDraftStore();
  const first = store.save(record());
  const second = store.save(record({ writeToken: "new", name: "New" }));
  const ack = store.acknowledge(record());
  await Promise.all([first, second, ack]);
  expect((await store.load(scope))?.writeToken).toBe("new");
  expect(idb.closes).toBe(idb.opens);
});

it("does not touch the legacy record during scoped writes or acknowledgments", async () => {
  const { saveMobileNewStepRecoveryDraft } = await import("./recovery-draft-store");
  await saveMobileNewStepRecoveryDraft(record());
  const before = structuredClone(idb.records("buildlogic-mobile-drafts", "drafts"));
  const store = createMobileRecoveryDraftStore();
  await store.save(record()); await store.acknowledge(record());
  expect(idb.records("buildlogic-mobile-drafts", "drafts")).toEqual(before);
});

it("preserves and refuses to overwrite an unknown or malformed scoped record", async () => {
  const store = createMobileRecoveryDraftStore(); await store.save(record());
  const rows = idb.databases.get("buildlogic-mobile-drafts")!.get("drafts")!.rows;
  const unknown = { ...record(), schemaVersion: 99 }; rows.set(record().key, unknown);
  expect(await store.load(scope)).toBeNull();
  await expect(store.save(record())).rejects.toThrow("Unrecognized");
  expect(await store.acknowledge(record())).toBe(false);
  expect(rows.get(record().key)).toEqual(unknown);
});

it("transaction abort rejects and closes rather than hanging", async () => {
  idb.uninstall(); idb = installIndexedDbDouble({ transactionAbort: true });
  const store = createMobileRecoveryDraftStore();
  await expect(store.save(record())).rejects.toThrow("abort");
  expect(idb.closes).toBe(idb.opens);
});

it("explicit adoption copies a reviewed legacy record and preserves the source after acknowledgment", async () => {
  const { saveMobileNewStepRecoveryDraft, loadMobileNewStepRecoveryDraft } = await import("./recovery-draft-store");
  const { schemaVersion: _schema, draftId: _draft, writeToken: _token, userId: _user, projectId: _project, ...payload } = record();
  await saveMobileNewStepRecoveryDraft(payload);
  const original = (await loadMobileNewStepRecoveryDraft())!;
  const store = createMobileRecoveryDraftStore();
  const adopted = await store.adoptLegacy(scope, original);
  expect(adopted).toMatchObject({ ...scope, draftId: "s", name: "Fit" });
  expect(await loadMobileNewStepRecoveryDraft()).toEqual(original);
  await store.acknowledge(adopted);
  expect(await loadMobileNewStepRecoveryDraft()).toEqual(original);
});

it("adoption refuses both an occupied destination and a legacy record changed since review", async () => {
  const { saveMobileNewStepRecoveryDraft, loadMobileNewStepRecoveryDraft } = await import("./recovery-draft-store");
  const payload = { taskId: "t", stepId: "s", name: "Legacy", instruction: "", durationText: "5", tools: [], photos: [], checks: [] };
  await saveMobileNewStepRecoveryDraft(payload);
  const original = (await loadMobileNewStepRecoveryDraft())!;
  const store = createMobileRecoveryDraftStore();
  await store.save(record());
  await expect(store.adoptLegacy(scope, original)).rejects.toThrow("Finish your current draft");
  await store.acknowledge(record());
  await saveMobileNewStepRecoveryDraft({ ...payload, name: "Changed" });
  await expect(store.adoptLegacy(scope, original)).rejects.toThrow("changed");
  expect(await store.load(scope)).toBeNull();
  expect((await loadMobileNewStepRecoveryDraft())?.name).toBe("Changed");
});
