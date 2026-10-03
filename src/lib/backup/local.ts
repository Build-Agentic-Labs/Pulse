import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { acquireRunnerLock, releaseRunnerLock } from "../../../scripts/backup/runner-lock.mjs";

export const localBackupRoot = () => path.resolve("backups/local");
export const validBackupId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
export async function backupReadiness() {
  const problems: string[] = [];
  if (process.env.NODE_ENV === "production" || process.env.PULSE_LOCAL_BACKUPS !== "true") problems.push("Local backup runner is not enabled on this computer.");
  if (!process.env.PULSE_BACKUP_DATABASE_URL) problems.push("A dedicated read-only database connection is required.");
  if (!process.env.PULSE_BACKUP_SCHEMA_DATABASE_URL) problems.push("A dedicated schema-read connection is required.");
  if (!process.env.PULSE_BACKUP_CA_CERT) problems.push("A trusted database CA certificate is required.");
  else try { await readFile(process.env.PULSE_BACKUP_CA_CERT, "utf8"); }
  catch { problems.push("The database CA certificate cannot be read."); }
  if (!process.env.PULSE_BACKUP_STORAGE_READ_TOKEN) problems.push("A dedicated file-read credential is required.");
  else {
    try {
      const payload = JSON.parse(Buffer.from(process.env.PULSE_BACKUP_STORAGE_READ_TOKEN.split(".")[1], "base64url").toString("utf8"));
      if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) problems.push("The file-read credential has expired and must be renewed locally.");
    } catch { problems.push("The file-read credential is invalid and must be renewed locally."); }
  }
  if (process.env.PULSE_BACKUP_RESTORE_VALIDATED !== "true") problems.push("An isolated restore rehearsal must pass before real exports are enabled.");
  try { await promisify(execFile)(process.env.PULSE_BACKUP_PG_DUMP || "pg_dump", ["--version"], { timeout: 3000 }); }
  catch { problems.push("PostgreSQL pg_dump is not installed or configured."); }
  return { ready: problems.length === 0, problems };
}
export async function readBackup(id: string, owner: string) {
  if (!validBackupId(id)) return null;
  try {
    const status = JSON.parse(await readFile(path.join(localBackupRoot(), `${id}.json`), "utf8"));
    if (status.id !== id || status.owner !== owner || !["running", "complete", "failed", "interrupted"].includes(status.state) || typeof status.updatedAt !== "string" || !Number.isFinite(Date.parse(status.updatedAt))) return null;
    // A killed worker must never leave a permanently optimistic running label.
    if (status.state === "running" && Date.now() - Date.parse(status.updatedAt) > 180000) return { ...status, state: "interrupted", error: "The runner stopped responding. This is not a verified backup." };
    return status;
  } catch { return null; }
}
export async function listBackups(owner: string) {
  const files = await readdir(localBackupRoot()).catch(() => [] as string[]);
  const items = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => readBackup(file.slice(0, -5), owner)));
  return items.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function startBackup(owner: string, password: string) {
  const id = randomUUID();
  await mkdir(localBackupRoot(), { recursive: true, mode: 0o700 });
  await acquireRunnerLock(localBackupRoot(), id, owner);
  try {
    await writeFile(path.join(localBackupRoot(), `${id}.json`), JSON.stringify({ id, owner, state: "running", phase: "starting", updatedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    const child = spawn(process.execPath, [path.resolve("scripts/backup/worker.mjs"), id, owner], { detached: true, stdio: ["pipe", "ignore", "ignore"], env: process.env });
    child.on("error", () => { void (async () => { await writeFile(path.join(localBackupRoot(), `${id}.json`), JSON.stringify({ id, owner, state: "failed", updatedAt: new Date().toISOString(), error: "The local runner could not start." }), { mode: 0o600 }); await releaseRunnerLock(localBackupRoot(), id, owner); })().catch(() => {}); });
    child.stdin.on("error", () => {});
    child.stdin.end(password);
    child.unref();
    return id;
  } catch (error) {
    await releaseRunnerLock(localBackupRoot(), id, owner).catch(() => {});
    throw error;
  }
}
