import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import path from "node:path";
import { requireApiUser, createApiRateLimiter } from "@/lib/api-auth";
import { backupReadiness, listBackups, localBackupRoot, readBackup, startBackup } from "@/lib/backup/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const limit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 2 });
async function gate(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return { failure: auth.failure, userId: "" };
  const { data, error } = await auth.supabase.rpc("is_super_admin");
  if (error || data !== true) return { failure: NextResponse.json({ error: "Super-admin access is required." }, { status: 403, headers }), userId: "" };
  return { failure: null, userId: auth.userId };
}
function localOnly(request: Request) {
  return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}
export async function GET(request: Request) {
  const auth = await gate(request); if (auth.failure) return auth.failure;
  if (!localOnly(request)) return NextResponse.json({ error: "Backups are available only through the local runner." }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  if (params.get("download")) {
    const backup = await readBackup(params.get("download")!, auth.userId);
    if (!backup || backup.state !== "complete" || !backup.integrityVerified) return NextResponse.json({ error: "Verified backup not found." }, { status: 404, headers });
    const file = path.join(localBackupRoot(), `${backup.id}.pulsebackup`);
    let size: number;
    try { size = (await stat(file)).size; }
    catch { return NextResponse.json({ error: "The local archive is unavailable. No files were changed." }, { status: 404, headers }); }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(size), "Content-Disposition": `attachment; filename="pulse-${backup.id}.pulsebackup"` } });
  }
  return NextResponse.json({ ...await backupReadiness(), backups: await listBackups(auth.userId) }, { headers });
}
export async function POST(request: Request) {
  const auth = await gate(request); if (auth.failure) return auth.failure;
  if (!localOnly(request) || request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Use the local Settings page to create a backup." }, { status: 403, headers });
  if (!limit(auth.userId)) return NextResponse.json({ error: "Please wait before starting another backup." }, { status: 429, headers });
  const readiness = await backupReadiness();
  if (!readiness.ready) return NextResponse.json({ error: "Read-only setup and restore validation are required.", ...readiness }, { status: 503, headers });
  const running = (await listBackups(auth.userId)).some((backup) => backup.state === "running");
  if (running) return NextResponse.json({ error: "A backup is already running." }, { status: 409, headers });
  let body; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers }); }
  if (typeof body?.password !== "string" || body.password.length < 16 || body.password.length > 256) return NextResponse.json({ error: "Use a backup password between 16 and 256 characters." }, { status: 400, headers });
  try { return NextResponse.json({ id: await startBackup(auth.userId, body.password) }, { status: 202, headers }); }
  catch { return NextResponse.json({ error: "The local runner is busy or unavailable. No export started." }, { status: 409, headers }); }
}
