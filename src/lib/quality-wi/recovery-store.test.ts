// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  installIndexedDbDouble,
  type IndexedDbDouble,
} from "@/test-support/indexeddb-double";
import { createWiRecoveryStore } from "./recovery-store";
import type { PendingWiEdit } from "@/domain/quality-wi/schema";
let idb: IndexedDbDouble;
const scope = { userId: "author", workspaceId: "w", wiId: "wi" };
const entry = (operation = "one", title = "Edit"): PendingWiEdit => ({
  operation,
  expectedVersion: 1,
  edit: { kind: "details", payload: { title } },
});
beforeEach(() => {
  sessionStorage.clear();
  idb = installIndexedDbDouble();
});
afterEach(() => idb.uninstall());
it("isolates account, workspace and document records", async () => {
  await createWiRecoveryStore(scope).write([entry()]);
  for (const different of [
    { ...scope, userId: "other" },
    { ...scope, workspaceId: "other" },
    { ...scope, wiId: "other" },
  ])
    expect(await createWiRecoveryStore(different).load()).toEqual([]);
  expect(await createWiRecoveryStore(scope).load()).toEqual([entry()]);
});
it("keeps each mounted editor's recovery fork", async () => {
  const a = createWiRecoveryStore(scope),
    b = createWiRecoveryStore(scope);
  await a.write([entry("a", "First")]);
  await b.write([entry("b", "Second")]);
  expect(idb.records("pulse-quality-wi-recovery", "drafts")).toHaveLength(2);
  await a.acknowledge(entry("a", "First"));
  expect(await b.load()).toEqual([entry("b", "Second")]);
});
it("acknowledges only exact content, preserving another edit with reused id", async () => {
  const a = createWiRecoveryStore(scope),
    b = createWiRecoveryStore(scope);
  await a.write([entry("same", "First")]);
  await b.write([entry("same", "Second")]);
  await a.acknowledge(entry("same", "First"));
  expect(await b.load()).toEqual([entry("same", "Second")]);
});
it("cannot clean another account's draft", async () => {
  const own = createWiRecoveryStore(scope),
    other = createWiRecoveryStore({ ...scope, userId: "other" });
  await other.write([entry()]);
  await own.acknowledge(entry());
  expect(await other.load()).toEqual([entry()]);
});
it("serializes writes with acknowledgment and closes all connections", async () => {
  const store = createWiRecoveryStore(scope);
  await Promise.all([
    store.write([entry()]),
    store.write([entry(), entry("new", "Next")]),
    store.acknowledge(entry()),
  ]);
  expect(await store.load()).toEqual([entry("new", "Next")]);
  expect(idb.closes).toBe(idb.opens);
});

it("ignores malformed recovered intent without deleting its stored record", async () => {
  const store = createWiRecoveryStore(scope);
  await store.write([entry()]);
  const rows = idb.databases
    .get("pulse-quality-wi-recovery")!
    .get("drafts")!.rows;
  const [key] = [...rows.keys()];
  const original = rows.get(key)! as Record<string, unknown>;
  const malformed = {
    ...original,
    pending: [
      {
        operation: "bad",
        edit: { kind: "details", payload: { workspaceId: "other" } },
      },
    ],
  };
  rows.set(key, malformed);
  expect(await store.load()).toEqual([]);
  await store.acknowledge(entry());
  expect(rows.get(key)).toEqual(malformed);
});

it("archives explicitly replaced drafts without removing their stored content", async () => {
  const store = createWiRecoveryStore(scope);
  await store.write([entry()]);
  await store.archive([entry()]);
  expect(await createWiRecoveryStore(scope).load()).toEqual([]);
});

it("successfully saving a coalesced recovered draft must not revive its older source", async () => {
  const oldEditor = createWiRecoveryStore(scope);
  const oldEdit: PendingWiEdit = {operation:"old",baseVersion:1,edit:{kind:"details",payload:{title:"Old typing"}}};
  await oldEditor.write([oldEdit]);
  const reopened = createWiRecoveryStore(scope);
  expect(await reopened.load()).toEqual([oldEdit]);
  // appendWiEdit replaces the operation when more typing coalesces into an unissued recovered edit.
  const latest: PendingWiEdit = {operation:"latest",baseVersion:1,expectedVersion:1,issued:true,edit:{kind:"details",payload:{title:"Finished typing"}}};
  await reopened.write([latest]);
  await reopened.acknowledge(latest);
  await reopened.write([]);
  expect(await createWiRecoveryStore(scope).load()).toEqual([]);
});


it("preserves a recovered source changed by another live editor", async () => {
  const source = createWiRecoveryStore(scope);
  await source.write([entry("source", "Original")]);
  const reopened = createWiRecoveryStore(scope);
  await reopened.load();
  await source.write([entry("live", "Still typing in the other tab")]);
  await reopened.write([entry("reopened", "Separate edit")]);
  await reopened.acknowledge(entry("reopened", "Separate edit"));
  expect(await createWiRecoveryStore(scope).load()).toEqual([entry("live", "Still typing in the other tab")]);
});

it("does not archive different content that reuses an operation id", async () => {
  const own = createWiRecoveryStore(scope), other = createWiRecoveryStore(scope);
  await own.write([entry("same", "Mine")]);
  await other.write([entry("same", "Other edit")]);
  await own.archive([entry("same", "Mine")]);
  expect(await createWiRecoveryStore(scope).load()).toEqual([entry("same", "Other edit")]);
});
