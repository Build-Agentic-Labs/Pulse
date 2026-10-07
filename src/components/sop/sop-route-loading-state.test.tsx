// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SopRouteLoadingState } from "./sop-route-loading-state";

const route = vi.hoisted(() => ({ pathname: "/sops", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./work-instruction-template-access", () => ({ WORK_INSTRUCTION_TEMPLATE_HREF: "/api/quality/work-instruction-template", useWorkInstructionTemplateAccess: () => false }));
vi.mock("./sop-shell", () => ({ SopShell: ({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) => <div><nav>{sidebar}</nav>{children}</div> }));
afterEach(() => { cleanup(); route.pathname = "/sops"; route.query = ""; });

it.each(["/sops/work-instructions", "/sops/work-instructions/wi-1"])("keeps WI navigation during loading of %s", pathname => {
  vi.stubEnv("NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED", "1");
  route.pathname = pathname;
  render(<SopRouteLoadingState><div>List skeleton</div></SopRouteLoadingState>);
  expect(screen.getByRole("status", { name: "Opening work instructions" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Work instructions" })).toHaveClass("ui-nav-item-active");
  expect(screen.queryByText("SOP Builder")).not.toBeInTheDocument();
  expect(screen.queryByText("Approvals")).not.toBeInTheDocument();
  vi.unstubAllEnvs();
});

it("uses the document builder at the outer boundary without requiring a workspace provider", () => {
  route.pathname = "/sops/sop-1";
  render(<SopRouteLoadingState><div>List skeleton</div></SopRouteLoadingState>);
  expect(screen.getByText("SOP Builder")).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Opening Document" })).toBeInTheDocument();
  expect(screen.queryByText("List skeleton")).not.toBeInTheDocument();
});

it("keeps the document preview loader when entering through the review queue", () => {
  route.pathname = "/sops/sop-1";
  route.query = "step=draft-review&via=review";
  render(<SopRouteLoadingState><div>List skeleton</div></SopRouteLoadingState>);
  expect(screen.getByRole("status", { name: "Opening document" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Review queue/ })).toHaveClass("ui-nav-item-active");
  expect(screen.queryByText("SOP Builder")).not.toBeInTheDocument();
});

it.each(["/sops", "/sops/new", "/sops/problem-solving"])("preserves the existing fallback for %s", pathname => {
  route.pathname = pathname;
  render(<SopRouteLoadingState><div>List skeleton</div></SopRouteLoadingState>);
  expect(screen.getByText("List skeleton")).toBeInTheDocument();
});
