import { readFile } from "node:fs/promises";
import path from "node:path";
import { Packer } from "docx";
import { NextResponse } from "next/server";
import { canDownloadWorkInstructionTemplate } from "@/domain/quality/template-access";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import { buildWorkInstructionTemplate } from "@/lib/quality/work-instruction-template-docx";

/**
 * Downloads the blank general work instruction template (.docx).
 *
 * This route is the gate: the Manage link in Quality only mirrors it. Access
 * follows canDownloadWorkInstructionTemplate (owner-only until QC approves).
 * The logo is traced into this function by next.config.mjs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILE_NAME = "ANA-Work-Instruction-Template.docx";
const LOGO_PATH = path.join(process.cwd(), "public", "sop", "ana-logo.png");
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const limit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 10 });

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(LOGO_PATH));
  } catch (error) {
    // The document still renders, with the "ANA INC." wordmark in place of the logo.
    console.error("work-instruction-template: logo unavailable", error);
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  if (!canDownloadWorkInstructionTemplate(auth.email)) {
    return NextResponse.json({ error: "The work instruction template is not available to you yet." }, { status: 403, headers });
  }
  if (!limit(auth.userId)) {
    return NextResponse.json({ error: "Too many downloads. Try again in a minute." }, { status: 429, headers });
  }

  try {
    const buffer = await Packer.toBuffer(buildWorkInstructionTemplate(await loadLogo()));
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...headers,
        "Content-Type": DOCX_TYPE,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
      },
    });
  } catch (error) {
    console.error("work-instruction-template: build failed", error);
    return NextResponse.json({ error: "Could not build the template. Try again." }, { status: 500, headers });
  }
}
