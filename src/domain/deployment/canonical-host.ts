/**
 * Which host is the "real" Pulse. Vercel serves every production deployment on
 * its own *.vercel.app URL as well as the custom domain; someone who lands on the
 * former (a link copied from the dashboard, an old bookmark) should end up on the
 * canonical domain. Preview deployments are different: they exist to be visited
 * on their own host, but they have no service-role config, so email features are
 * off there — say so instead of failing quietly.
 */

const VERCEL_HOST_SUFFIX = ".vercel.app";

export interface CanonicalRedirectInput {
  /** Used for path + query only. */
  requestUrl: string;
  /**
   * The host the browser asked for: `x-forwarded-host`, else `host`. This is the
   * only reliable source — a self-hosted Next server reports its own bind
   * address in `request.url`, not the Host header.
   */
  host: string | null | undefined;
  /** Vercel's VERCEL_ENV: "production" | "preview" | "development" | undefined off-platform. */
  vercelEnv: string | undefined;
  /** NEXT_PUBLIC_SITE_URL. */
  siteUrl: string | undefined;
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The URL to redirect to, or null when the request should be served as-is. */
export function resolveCanonicalRedirect({ requestUrl, host, vercelEnv, siteUrl }: CanonicalRedirectInput): string | null {
  if (vercelEnv !== "production") return null;
  const canonical = parseUrl(siteUrl);
  const request = parseUrl(requestUrl);
  const requestedHost = (host ?? "").trim().toLowerCase();
  if (!canonical || !request || !requestedHost) return null;
  const requestedHostname = requestedHost.split(":")[0];
  if (!requestedHostname.endsWith(VERCEL_HOST_SUFFIX)) return null;
  if (requestedHostname === canonical.hostname) return null;
  return new URL(request.pathname + request.search, canonical.origin).toString();
}

/** Banner copy for preview deployments; null everywhere else. */
export function deploymentBannerText(vercelEnv: string | undefined, siteUrl?: string | undefined): string | null {
  if (vercelEnv !== "preview") return null;
  const canonical = parseUrl(siteUrl);
  const destination = canonical ? canonical.hostname : "the production site";
  return `Preview deployment — invitations and password reset are disabled here. Use ${destination} for the real thing.`;
}
