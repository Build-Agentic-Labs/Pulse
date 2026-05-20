import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface PortalUrlCandidate {
  label: string;
  url: string;
}

const DEFAULT_PUBLIC_PHONE_PORTAL_URL = "https://pulse.agenticlabs.studio/mobile-photos";

function portalPath() {
  return "/mobile-photos";
}

function normalizePortalUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  const nextPath = portalPath();

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

function findLocalIpv4Candidates(protocol: string, port?: string): PortalUrlCandidate[] {
  const interfaces = networkInterfaces();
  const candidates: PortalUrlCandidate[] = [];
  const nextPath = portalPath();

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
  const publicPortalUrl =
    process.env.PHONE_PORTAL_URL ?? process.env.NEXT_PUBLIC_PHONE_PORTAL_URL ?? DEFAULT_PUBLIC_PHONE_PORTAL_URL;
  const incomingHost = request.headers.get("host") ?? "127.0.0.1:3001";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? (incomingHost.includes("localhost") || incomingHost.includes("127.0.0.1") ? "http" : "https");
  const { hostname, port } = splitHost(incomingHost);
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  const localCandidates = findLocalIpv4Candidates(protocol, port);
  const requestUrl = `${protocol}://${hostname}${port ? `:${port}` : ""}${portalPath()}`;
  const primaryUrl = publicPortalUrl
    ? normalizePortalUrl(publicPortalUrl)
    : localHostnames.has(hostname)
      ? localCandidates[0]?.url ?? requestUrl
      : requestUrl;
  const candidates = [
    { label: "Public", url: normalizePortalUrl(publicPortalUrl) },
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
