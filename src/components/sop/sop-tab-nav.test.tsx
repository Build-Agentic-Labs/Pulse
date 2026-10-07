import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ allowed: false }));
vi.mock("./work-instruction-template-access", () => ({
  WORK_INSTRUCTION_TEMPLATE_HREF: "/api/quality/work-instruction-template",
  useWorkInstructionTemplateAccess: () => access.allowed,
}));

import { SopTabNav } from "./sop-tab-nav";

beforeEach(() => {
  access.allowed = false;
});

describe("SopTabNav — work instruction template", () => {
  it("hides the template and the Manage section from members without access", () => {
    render(<SopTabNav active="all" manage={false} />);
    expect(screen.queryByText("Manage")).toBeNull();
    expect(screen.queryByRole("link", { name: /WI template/ })).toBeNull();
  });

  it("keeps Quality settings for managers without showing the template", () => {
    render(<SopTabNav active="all" manage />);
    expect(screen.getByRole("link", { name: /Quality settings/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /WI template/ })).toBeNull();
  });

  it("offers the template as a direct download under Manage when allowed", () => {
    access.allowed = true;
    render(<SopTabNav active="all" manage />);
    const link = screen.getByRole("link", { name: /WI template/ });
    expect(link.getAttribute("href")).toBe("/api/quality/work-instruction-template");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("shows Manage with only the template for an allowed non-manager", () => {
    access.allowed = true;
    render(<SopTabNav active="all" manage={false} />);
    expect(screen.getByText("Manage")).toBeTruthy();
    expect(screen.getByRole("link", { name: /WI template/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Quality settings/ })).toBeNull();
  });
});


afterEach(() => vi.unstubAllEnvs());

it("offers the released WI builder to members by default", () => {
  vi.stubEnv("NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED", undefined);
  render(<SopTabNav active="work-instructions" manage={false} />);
  expect(screen.getByRole("link", { name: "Work instructions" }).getAttribute("href")).toBe("/sops/work-instructions");
});

it("honors the explicit WI rollback switch", () => {
  vi.stubEnv("NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED", "0");
  render(<SopTabNav active="all" manage={false} />);
  expect(screen.queryByRole("link", { name: "Work instructions" })).toBeNull();
});
