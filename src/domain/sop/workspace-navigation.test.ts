import { expect, it } from "vitest";
import { parseSopWorkspaceTab } from "./workspace-navigation";
it("preserves Review queue when navigation changes to an author detail URL", () => {
  for (const url of ["/sops?tab=review", "/sops/example?step=draft-review&via=review"]) {
    const params = new URL(url, "http://localhost").searchParams;
    expect(parseSopWorkspaceTab(params.get("tab"), params.get("via"))).toBe("review");
  }
});
it("honors explicit tabs and normal All SOPs navigation", () => {
  expect(parseSopWorkspaceTab("library", "review")).toBe("library");
  expect(parseSopWorkspaceTab(null, null)).toBe("all");
});
