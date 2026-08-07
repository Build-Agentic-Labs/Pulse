import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { renderPasswordRecoveryEmail } from "@/domain/auth/password-recovery";
import { createApiRateLimiter } from "@/lib/api-auth";
import type { Database } from "@/lib/database.types";
import { createResendSender } from "@/lib/sop/notifications-drain";

export const dynamic = "force-dynamic";

const checkEmailRateLimit = createApiRateLimiter({ windowMs: 15 * 60_000, maxRequests: 3 });
const checkIpRateLimit = createApiRateLimiter({ windowMs: 15 * 60_000, maxRequests: 10 });
const ACCEPTED_MESSAGE = "If an account exists, a recovery code has been sent.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function accepted() {
  return json({ accepted: true, message: ACCEPTED_MESSAGE });
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function hashed(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function passwordRecoveryOrigin(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const origin = new URL(candidate).origin;
      if (origin.startsWith("https://")) return origin;
    } catch {
      // Try the next trusted deployment value.
    }
  }

  // Localhost is only a fallback for an unconfigured development checkout.
  // When a public Pulse URL exists, recovery email links must always use it so
  // a request made during local support/testing still works for the recipient.
  const localRequest = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin);
  if (localRequest && process.env.NODE_ENV !== "production") {
    return requestOrigin;
  }

  return "";
}

function isMissingUserError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return /user[^a-z]+not[^a-z]+found/i.test(error.message ?? "") || error.code === "user_not_found";
}

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const emailKey = hashed(email);
  const ipKey = hashed(clientAddress(request));
  if (!checkEmailRateLimit(emailKey) || !checkIpRateLimit(ipKey)) {
    return json({ error: "Too many recovery requests. Wait a few minutes and try again." }, 429);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";
  const origin = passwordRecoveryOrigin(request);
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !resendFrom || !origin) {
    return json({ error: "Password recovery is temporarily unavailable." }, 503);
  }

  try {
    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: origin },
    });

    // The public response deliberately does not reveal whether an account exists.
    if (isMissingUserError(error)) {
      return accepted();
    }
    if (error || !data.properties?.email_otp) {
      console.error("Password recovery code generation failed", {
        code: error?.code ?? "missing_otp",
        status: error?.status ?? null,
      });
      return json({ error: "Password recovery is temporarily unavailable." }, 503);
    }

    const send = createResendSender(resendApiKey, resendFrom);
    const result = await send(
      email,
      renderPasswordRecoveryEmail({ code: data.properties.email_otp, email, origin }),
    );
    if (!result.ok) {
      console.error("Password recovery email delivery request failed", {
        status: result.status,
        failure: result.failure,
      });
      return json({ error: "Password recovery is temporarily unavailable." }, 503);
    }
  } catch (error) {
    console.error("Password recovery request failed unexpectedly", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "Password recovery is temporarily unavailable." }, 503);
  }

  return accepted();
}
