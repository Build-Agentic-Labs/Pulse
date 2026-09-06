/**
 * Notifications console API. Owners/admins only (has_workspace_role, checked
 * with the CALLER's client so RLS is the gate); the service role is used only
 * for the ledgers, which users can never read directly.
 *
 * GET  ?workspaceId=…                     → AdminOverview
 * POST { workspaceId, action: "resend", ledger, id }   → revive a row + drain now
 * POST { workspaceId, action: "unsuppress", email }    → remove a suppression
 * POST { workspaceId, action: "teams_test" }           → post a test card to the saved webhook
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { buildTeamsMessage } from "@/domain/notifications/teams-card";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import type { Database } from "@/lib/database.types";
import { loadAdminOverview, resetLedgerRow, type LedgerName } from "@/lib/notifications/admin-overview";
import { removeSuppression } from "@/lib/notifications/deliveries-store";
import { createStalledDigestDrainStore } from "@/lib/notifications/digest-store";
import { recordDrainRun } from "@/lib/notifications/drain-runs-store";
import { loadTeamsIntegration } from "@/lib/notifications/integrations-store";
import { runDrainRequest } from "@/lib/notifications/run-drain-request";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { createTeamsSender } from "@/lib/notifications/teams-sender";
import { createSopNotificationDrainStore } from "@/lib/sop/notifications-store";
import { createWorkspaceWelcomeDrainStore } from "@/lib/workspace/welcome-store";

export const dynamic = "force-dynamic";

const LEDGERS: LedgerName[] = ["sop_notifications", "workspace_notifications", "notification_digests"];
const actionRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireManager(request: Request, workspaceId: string) {
  const auth = await requireApiUser(request);
  if (auth.failure) return { failure: auth.failure, userId: null };
  const { data, error } = await auth.supabase.rpc("has_workspace_role", {
    target_workspace_id: workspaceId,
    allowed_roles: ["owner", "admin"],
  });
  if (error) return { failure: NextResponse.json({ error: error.message }, { status: 500 }), userId: null };
  if (data !== true) {
    return { failure: NextResponse.json({ error: "Only owners and admins can view notifications." }, { status: 403 }), userId: null };
  }
  return { failure: null, userId: auth.userId };
}

function siteOrigin(request: Request): string {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";
  return process.env.NEXT_PUBLIC_SITE_URL ?? (vercelHost ? `https://${vercelHost}` : new URL(request.url).origin);
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim() ?? "";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  const gate = await requireManager(request, workspaceId);
  if (gate.failure) return gate.failure;
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  try {
    const overview = await loadAdminOverview(admin, workspaceId, new Date());
    return NextResponse.json(overview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load notifications." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { workspaceId?: unknown; action?: unknown; ledger?: unknown; id?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!workspaceId || !action) return NextResponse.json({ error: "workspaceId and action are required." }, { status: 400 });

  const gate = await requireManager(request, workspaceId);
  if (gate.failure) return gate.failure;
  if (!actionRateLimit(gate.userId ?? workspaceId)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });

  try {
    if (action === "resend") {
      const ledger = LEDGERS.find((name) => name === body.ledger);
      const id = typeof body.id === "number" ? body.id : Number.NaN;
      if (!ledger || !Number.isInteger(id)) return NextResponse.json({ error: "ledger and id are required." }, { status: 400 });
      const revived = await resetLedgerRow(admin, ledger, id, workspaceId);
      if (!revived) return NextResponse.json({ ok: false, revived: false, reason: "Row not found, already sent, or outside this workspace." });
      // Drain immediately so the admin sees the outcome instead of waiting for the cron.
      const { send } = createEmailSenderFromEnv();
      const result = await runDrainRequest({
        caller: "manual",
        stores: [
          { label: "sop", store: createSopNotificationDrainStore(admin) },
          { label: "workspace", store: createWorkspaceWelcomeDrainStore(admin) },
          { label: "digest", store: createStalledDigestDrainStore(admin) },
        ],
        send,
        teams: createTeamsSender(),
        now: () => new Date(),
        origin: siteOrigin(request),
        recordRun: (run) => recordDrainRun(admin, run),
      });
      return NextResponse.json({ ok: true, revived: true, drain: result.body });
    }

    if (action === "unsuppress") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email) return NextResponse.json({ error: "email is required." }, { status: 400 });
      await removeSuppression(admin, email);
      return NextResponse.json({ ok: true });
    }

    if (action === "teams_test") {
      const integration = await loadTeamsIntegration(admin, workspaceId);
      if (!integration?.webhookUrl) return NextResponse.json({ ok: false, reason: "No Teams webhook is saved for this workspace." });
      const post = createTeamsSender();
      const result = await post(
        integration.webhookUrl,
        buildTeamsMessage({
          title: "Pulse notifications are connected",
          body: "This is a test card from Settings → Organization → Notifications.",
          kindLabel: "Test",
          link: "/sops/review",
          origin: siteOrigin(request),
        }),
      );
      return NextResponse.json(result.ok ? { ok: true } : { ok: false, reason: `${result.status}: ${result.error}` });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 500 });
  }
}
