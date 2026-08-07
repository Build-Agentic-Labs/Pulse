import type { AccessLevel, WorkspaceRole } from "@/domain/types";

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
