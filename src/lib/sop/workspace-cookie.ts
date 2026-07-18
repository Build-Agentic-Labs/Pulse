/**
 * The active SOP workspace, mirrored into a cookie so app/sops/page.tsx can
 * server-fetch the right workspace's SOP list (refactor plan, Stage 5).
 *
 * Deliberately a plain module with no "use client": constants exported from a
 * client module become client-reference proxies when imported by a server
 * component — cookieStore.get(<proxy>) silently returns undefined. Both the
 * provider (writer) and the server page (reader) import the name from here.
 */
export const SOP_WORKSPACE_COOKIE = "pulse-sop-workspace-id";
