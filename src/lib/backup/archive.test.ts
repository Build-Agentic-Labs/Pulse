import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digest, writeArchive, verifyArchive, verifiedRecords } from "../../../scripts/backup/archive.mjs";
import { assertReadOnly } from "../../../scripts/backup/source.mjs";
const folders: string[] = [];
const password = "fixture-only-password-2026";
async function target() { const root = await mkdtemp(path.join(tmpdir(), "pulse-backup-test-")); folders.push(root); return path.join(root, "test.pulsebackup"); }
afterEach(async () => { for (const root of folders.splice(0)) await rm(root, { recursive: true, force: true }); });
async function* fixture() {
  const bytes = Buffer.from("private photo fixture");
  yield { type: "row", table: "sops", row: { id: "sop-1", title: "Fixture" } };
  yield { type: "file-start", bucket: "step-photos", path: "fixture.jpg" };
  yield { type: "file-chunk", chunk: 0, data: bytes.toString("base64") };
  yield { type: "file-end", bytes: bytes.length, chunks: 1, sha256: digest(bytes) };
}
describe("read-only local backup foundation", () => {
  it("round trips records and media without writing plaintext to disk", async () => {
    const file = await target(); await writeArchive(file, password, fixture());
    const rows: unknown[] = []; const result = await verifyArchive(file, password, (row: unknown) => { rows.push(row); });
    expect(result).toMatchObject({ integrityVerified: true, restoreTested: false, records: 4, files: 1 });
    expect(rows).toHaveLength(4); expect((await readFile(file)).includes(Buffer.from("private photo fixture"))).toBe(false);
  });
  it("rejects wrong passwords and tampered ciphertext", async () => {
    const file = await target(); await writeArchive(file, password, fixture());
    await expect(verifyArchive(file, "another-fixture-password")).rejects.toThrow();
    const bytes = await readFile(file); bytes[50] ^= 1; await writeFile(file, bytes);
    await expect(verifyArchive(file, password)).rejects.toThrow();
  });
  it("does not overwrite an existing verified backup", async () => {
    const file = await target(); await writeArchive(file, password, fixture()); const before = await readFile(file);
    await expect(writeArchive(file, password, fixture())).rejects.toThrow(); expect(await readFile(file)).toEqual(before);
  });
  it("an interrupted source cannot produce a finished archive", async () => {
    const file = await target(); async function* fail() { yield { type: "row" }; throw new Error("source unavailable"); }
    await expect(writeArchive(file, password, fail())).rejects.toThrow("source unavailable");
    await expect(readFile(file)).rejects.toThrow();
  });
  it("rejects a missing or corrupt media chunk even in an authenticated archive", async () => {
    const file = await target(); async function* bad() { yield { type: "file-start" }; yield { type: "file-end", bytes: 20, chunks: 1, sha256: "wrong" }; }
    await writeArchive(file, password, bad()); await expect(verifyArchive(file, password)).rejects.toThrow("File integrity");
  });
  it("refuses privileged and write-capable database credentials", async () => {
    await expect(assertReadOnly({ query: async () => ({ rows: [{ rolsuper: true }] }) })).rejects.toThrow("unprivileged");
    let calls = 0; await expect(assertReadOnly({ query: async () => ({ rows: ++calls === 1 ? [{ rolsuper: false, rolbypassrls: false }] : [{ table_name: "sops" }] }) })).rejects.toThrow("write privileges");
  });
});
it("does not delete an existing interrupted archive on a name collision", async () => {
  const file = await target(); await writeFile(`${file}.partial`, "existing encrypted partial");
  await expect(writeArchive(file, password, fixture())).rejects.toThrow();
  expect(await readFile(`${file}.partial`, "utf8")).toBe("existing encrypted partial");
});
it("never exposes restore records before GCM authentication completes", async () => {
  const file = await target(); await writeArchive(file, password, fixture());
  const bytes = await readFile(file); bytes[bytes.length - 1] ^= 1; await writeFile(file, bytes);
  const recovered: unknown[] = [];
  await expect(verifyArchive(file, password, (record: unknown) => { recovered.push(record); })).rejects.toThrow();
  expect(recovered).toEqual([]);
});
it("rejects truncated archives without exposing any restore records", async () => {
  const file = await target(); await writeArchive(file, password, fixture());
  const bytes = await readFile(file); await writeFile(file, bytes.subarray(0, bytes.length - 18));
  const recovered: unknown[] = [];
  await expect(verifyArchive(file, password, (record: unknown) => { recovered.push(record); })).rejects.toThrow();
  expect(recovered).toEqual([]);
});

it("scalable recovery rejects tampering before yielding any records",async()=>{
 const file=await target();await writeArchive(file,password,fixture());const bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);let yielded=0;
 await expect((async()=>{for await(const r of verifiedRecords(file,password)){void r;yielded++;}})()).rejects.toThrow();expect(yielded).toBe(0);
});
it("scalable recovery yields only records from a fully authenticated archive",async()=>{
 const file=await target();await writeArchive(file,password,fixture());const records=[];for await(const r of verifiedRecords(file,password))records.push(r);
 expect(records).toHaveLength(4);expect(records.at(-1)).toMatchObject({type:"file-end"});
});

it("detects ciphertext mutation during replay and never yields altered records", async () => {
  const file = await target(); const payload = "x".repeat(100000);
  async function* records() { for (let i = 0; i < 8; i++) yield { type: "row", row: { id: i, payload } }; }
  await writeArchive(file, password, records());
  const iterator = verifiedRecords(file, password); const first = await iterator.next();
  expect(first.value).toMatchObject({ row: { id: 0, payload } });
  const handle = await open(file, "r+");
  try { const byte = Buffer.alloc(1); await handle.read(byte, 0, 1, 600000); byte[0] ^= 1; await handle.write(byte, 0, 1, 600000); }
  finally { await handle.close(); }
  const yielded: unknown[] = [];
  await expect((async () => { for await (const record of iterator) yielded.push(record); })()).rejects.toThrow();
  for (const record of yielded) expect(record).toMatchObject({ row: { payload } });
});
it("detects truncation during replay before recovery can finish", async () => {
  const file = await target();
  async function* records() { for (let i = 0; i < 8; i++) yield { type: "row", row: { id: i, payload: "x".repeat(100000) } }; }
  await writeArchive(file, password, records()); const iterator = verifiedRecords(file, password);
  await iterator.next(); const handle = await open(file, "r+");
  try { await handle.truncate(300000); } finally { await handle.close(); }
  await expect((async () => { for await (const record of iterator) void record; })()).rejects.toThrow();
});
