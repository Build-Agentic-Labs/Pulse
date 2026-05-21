import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface PortalUrlCandidate {
  label: string;
  url: string;
}

const DEFAULT_PUBLIC_PHONE_PORTAL_URL = "https://pulse.agenticlabs.studio/mobile-photos";

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

export function GET(request: Request) {
  const requestUrlObject = new URL(request.url);
  const projectId = requestUrlObject.searchParams.get("projectId")?.trim() || undefined;
  const publicPortalUrl =
    process.env.PHONE_PORTAL_URL ?? process.env.NEXT_PUBLIC_PHONE_PORTAL_URL ?? DEFAULT_PUBLIC_PHONE_PORTAL_URL;
  const incomingHost = request.headers.get("host") ?? "127.0.0.1:3001";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? (incomingHost.includes("localhost") || incomingHost.includes("127.0.0.1") ? "http" : "https");
  const { hostname, port } = splitHost(incomingHost);
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  const localCandidates = findLocalIpv4Candidates(protocol, port, projectId);
  const requestUrl = `${protocol}://${hostname}${port ? `:${port}` : ""}${portalPath(projectId)}`;
  const primaryUrl = publicPortalUrl
    ? normalizePortalUrl(publicPortalUrl, projectId)
    : localHostnames.has(hostname)
      ? localCandidates[0]?.url ?? requestUrl
      : requestUrl;
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
