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

