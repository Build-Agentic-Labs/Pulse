import type { AccessLevel, WorkspaceRole } from "@/domain/types";

export type WorkspaceInviteVerificationType = "invite" | "recovery";

export interface WorkspaceInviteAcceptance {
  email: string;
  tokenHash: string;
  type: WorkspaceInviteVerificationType;
}

export function qualityModuleAccessForRole(role: WorkspaceRole): AccessLevel {
  return role === "viewer" ? "view" : "edit";
}

export function qualityModuleAccessLabel(level: AccessLevel): string {
  if (level === "view") return "Viewer";
  if (level === "edit") return "Editor";
  return "No access";
}

export function qualityModuleInviteRedirect(requestUrl: string, configuredSiteUrl?: string): string {
  if (configuredSiteUrl) {
    try {
      return new URL("/?invite=1", configuredSiteUrl).toString();
    } catch {
      // Fall through to the request origin for an invalid deployment setting.
    }
  }
  return new URL("/?invite=1", requestUrl).toString();
}

/**
 * Keep the Supabase credential in the fragment: mail scanners may request the
 * Pulse page, but fragments are not sent to the web server. Pulse verifies the
 * token only after the recipient submits their new password.
 */
export function workspaceInviteAcceptanceUrl(
  siteUrl: string,
  email: string,
  tokenHash: string,
  type: WorkspaceInviteVerificationType = "invite",
): string {
  const url = new URL("/invite", siteUrl);
  url.hash = new URLSearchParams({
    email: email.trim().toLowerCase(),
    token_hash: tokenHash,
    type,
  }).toString();
  return url.toString();
}

export function parseWorkspaceInviteAcceptanceHash(hash: string): WorkspaceInviteAcceptance | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const email = params.get("email")?.trim().toLowerCase() ?? "";
  const tokenHash = params.get("token_hash")?.trim() ?? "";
  const rawType = params.get("type");
  const type = rawType === "invite" || rawType === "recovery" ? rawType : null;

  if (!email || !email.includes("@") || !tokenHash || !type) {
    return null;
  }

  return { email, tokenHash, type };
}
