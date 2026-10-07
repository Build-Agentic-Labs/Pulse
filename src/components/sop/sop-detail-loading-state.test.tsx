// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SopDetailLoadingState } from "./sop-detail-loading-state";
vi.mock("./sop-workspace-provider", () => ({ useSopWorkspace: () => ({ role: "owner", workspaceId: "workspace" }), canManage: () => true }));
vi.mock("@/lib/sop/review-queue-count", () => ({ useReviewQueueCount: () => 2 }));
vi.mock("./work-instruction-template-access", () => ({ WORK_INSTRUCTION_TEMPLATE_HREF: "/api/quality/work-instruction-template", useWorkInstructionTemplateAccess: () => false }));
vi.mock("./sop-shell", () => ({ SopShell: ({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) => <div><nav>{sidebar}</nav>{children}</div> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
it("keeps queue navigation during author-page loading instead of flashing builder steps", () => {
  render(<SopDetailLoadingState initialView="draft-review" fromReviewQueue />);
  expect(screen.getByRole("link", { name: /Review queue/ })).toHaveClass("ui-nav-item-active");
  expect(screen.getByLabelText("2 waiting on you")).toBeInTheDocument();
  expect(screen.queryByText("SOP Builder")).not.toBeInTheDocument();
});
it("keeps builder loading for ordinary authoring entry", () => {
  render(<SopDetailLoadingState />);
  expect(screen.getByText("SOP Builder")).toBeInTheDocument();
});
