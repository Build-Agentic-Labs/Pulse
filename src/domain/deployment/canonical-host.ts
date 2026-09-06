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
  requestUrl: string;
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
export function resolveCanonicalRedirect({ requestUrl, vercelEnv, siteUrl }: CanonicalRedirectInput): string | null {
  if (vercelEnv !== "production") return null;
  const canonical = parseUrl(siteUrl);
  const request = parseUrl(requestUrl);
  if (!canonical || !request) return null;
  if (!request.hostname.endsWith(VERCEL_HOST_SUFFIX)) return null;
  if (request.host === canonical.host) return null;
  return new URL(request.pathname + request.search, canonical.origin).toString();
}

/** Banner copy for preview deployments; null everywhere else. */
export function deploymentBannerText(vercelEnv: string | undefined, siteUrl?: string | undefined): string | null {
  if (vercelEnv !== "preview") return null;
  const canonical = parseUrl(siteUrl);
  const destination = canonical ? canonical.hostname : "the production site";
  return `Preview deployment — invitations and password reset are disabled here. Use ${destination} for the real thing.`;
}
