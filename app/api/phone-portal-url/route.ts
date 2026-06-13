import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface PortalUrlCandidate {
  label: string;
  url: string;
}

const DEFAULT_PUBLIC_PHONE_PORTAL_URL = "https://pulse.agenticlabs.studio/mobile-photos";

// Pick the first env value that is actually set to a non-empty string, else the
// hardcoded default. `??` alone would let an env var set to "" slip through and
// fall back to a LAN IP / per-deployment host, which is what made the QR drift.
function firstConfiguredUrl(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return DEFAULT_PUBLIC_PHONE_PORTAL_URL;
}

function portalPath(projectId?: string) {
  return projectId ? `/projects/${projectId}/mobile-photos` : "/mobile-photos";
}

function normalizePortalUrl(value: string, projectId?: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  const nextPath = portalPath(projectId);

  if (trimmed.endsWith(nextPath)) {
    return trimmed;
  }

  const projectMobileIndex = trimmed.indexOf("/projects/");
  if (projectMobileIndex >= 0 && trimmed.endsWith("/mobile-photos")) {
    return `${trimmed.slice(0, projectMobileIndex)}${nextPath}`;
  }

  if (trimmed.endsWith("/mobile-photos")) {
    return `${trimmed.slice(0, -"/mobile-photos".length)}${nextPath}`;
  }

  return `${trimmed}${nextPath}`;
}

function findLocalIpv4Candidates(protocol: string, port?: string, projectId?: string): PortalUrlCandidate[] {
  const interfaces = networkInterfaces();
  const candidates: PortalUrlCandidate[] = [];
  const nextPath = portalPath(projectId);

  for (const [name, values] of Object.entries(interfaces)) {
    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal) {
        candidates.push({
          label: name === "en0" ? "Wi-Fi" : name,
          url: `${protocol}://${value.address}${port ? `:${port}` : ""}${nextPath}`,
        });
      }
    }
  }

  return candidates.sort((left, right) => {
    if (left.label === "Wi-Fi") return -1;
    if (right.label === "Wi-Fi") return 1;
    return left.label.localeCompare(right.label);
  });
}

function splitHost(host: string) {
  const [hostname, port] = host.split(":");
  return {
    hostname: hostname || "127.0.0.1",
    port,
  };
}

export async function GET(request: Request) {
  // The response enumerates the host's LAN interfaces — sign-in required so that
  // network topology is only visible to workspace users, not anonymous callers.
  const auth = await requireApiUser(request);
  if (auth.failure) {
    return auth.failure;
  }

  const requestUrlObject = new URL(request.url);
  const projectId = requestUrlObject.searchParams.get("projectId")?.trim() || undefined;
  const publicPortalUrl = firstConfiguredUrl(
    process.env.PHONE_PORTAL_URL,
    process.env.NEXT_PUBLIC_PHONE_PORTAL_URL,
  );
  const incomingHost = request.headers.get("host") ?? "127.0.0.1:3001";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? (incomingHost.includes("localhost") || incomingHost.includes("127.0.0.1") ? "http" : "https");
  const { hostname, port } = splitHost(incomingHost);
  const localCandidates = findLocalIpv4Candidates(protocol, port, projectId);
  const requestUrl = `${protocol}://${hostname}${port ? `:${port}` : ""}${portalPath(projectId)}`;
  // publicPortalUrl is always a non-empty string (env override or the hardcoded
  // default), so the primary URL is stable across deploys and networks — it never
  // falls back to a LAN IP or a per-deployment request host. The LAN candidates
  // below stay in the response as informational alternatives only.
  const primaryUrl = normalizePortalUrl(publicPortalUrl, projectId);
  const candidates = [
    { label: "Public", url: normalizePortalUrl(publicPortalUrl, projectId) },
    ...localCandidates,
    { label: hostname, url: requestUrl },
  ].filter(
    (candidate, index, list) =>
      candidate.url === primaryUrl || list.findIndex((item) => item.url === candidate.url) === index,
  );

  return NextResponse.json({
    candidates,
    url: primaryUrl,
  });
}
