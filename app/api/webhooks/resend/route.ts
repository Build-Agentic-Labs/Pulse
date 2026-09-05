/**
 * Resend delivery webhook. Verifies the Svix signature with RESEND_WEBHOOK_SECRET,
 * records the event in email_deliveries (replays dedupe on the Svix id), and
 * suppresses addresses that hard-bounced or complained. Unknown event types are
 * acknowledged with 200 so the provider stops retrying them; a database failure
 * answers 500 so it retries.
 * Configure in Resend → Webhooks → https://<site>/api/webhooks/resend.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseResendWebhookEvent } from "@/domain/notifications/resend-webhook";
import { verifySvixSignature } from "@/domain/notifications/webhook-signature";
import { recordDeliveryEvent } from "@/lib/notifications/deliveries-store";
import type { Database } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET missing." }, { status: 503 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const body = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const verified = verifySvixSignature({
    id,
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
    body,
    secret,
    now: new Date(),
  });
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
  }
  const event = parseResendWebhookEvent(json, id);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const outcome = await recordDeliveryEvent(admin, { ...event, payload: json });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Webhook handling failed.";
    console.error("resend webhook: record failed", { eventId: id, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
