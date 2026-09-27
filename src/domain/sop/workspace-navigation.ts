/** Preserve queue selection while the outgoing page observes a detail URL. */
export function parseSopWorkspaceTab(raw: string | null, origin: string | null): "dashboard" | "all" | "review" | "library" | "retired" | "settings" {
  if (raw === "dashboard" || raw === "review" || raw === "library" || raw === "retired" || raw === "settings") return raw;
  return origin === "review" ? "review" : "all";
}
