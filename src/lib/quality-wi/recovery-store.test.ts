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
