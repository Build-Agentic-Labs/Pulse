import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AwiMaster } from "@/lib/awi/store";
import { listAwiMasters } from "@/lib/awi/store";
import { AwiDirectory } from "./awi-directory";
import { AwiDirectoryLoadingState } from "./awi-directory-loading";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./space-top-nav", () => ({ SpaceTopNav: () => null }));
vi.mock("./sidebar-workspace-panel", () => ({ SidebarWorkspacePanel: () => null }));
vi.mock("./line-workspace/nav", () => ({ SidebarReopenButton: () => null }));
vi.mock("./line-workspace", () => ({}));
vi.mock("@/lib/awi/store", () => ({
  awiDraftStatus: () => "Draft", createAwiMaster: vi.fn(), listAwiMasters: vi.fn(),
}));

function master(id: string, title: string): AwiMaster {
  return { id, title, document_number: "AWI-0001", task_id: `task-${id}` } as AwiMaster;
}

beforeEach(() => { vi.mocked(listAwiMasters).mockReset(); });

describe("AWI directory freshness", () => {
  it("uses the approved route fallback without fetching or creating instructions", () => {
    const { container } = render(<AwiDirectoryLoadingState />);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Opening AWI Master List");
    expect(screen.getByRole("heading", { name: "AWI Master List" })).toBeVisible();
    expect(container.querySelectorAll(".ui-skeleton-line")).toHaveLength(12);
    expect(listAwiMasters).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add AWI" })).not.toBeInTheDocument();
  });

  it("replaces placeholders with data while retaining the shell and collapsed-sidebar state", () => {
    vi.mocked(listAwiMasters).mockReturnValue(new Promise(() => {}));
    const view = render(<AwiDirectory workspaceId="a" />);
    const main = screen.getByRole("main");
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(view.container.firstElementChild).toHaveStyle("--workspace-sidebar-width: 0px");
    view.rerender(<AwiDirectory workspaceId="a" initialMasters={[master("one", "Ready instruction")]} />);
    expect(screen.getByRole("main")).toBe(main);
    expect(main).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AWI-0001\s*Ready instruction\s*Draft/ })).toBeVisible();
    expect(view.container.querySelectorAll(".ui-skeleton-line")).toHaveLength(0);
    expect(view.container.firstElementChild).toHaveStyle("--workspace-sidebar-width: 0px");
  });

  it("accepts refreshed names and an empty server list without extra browser reads", () => {
    const view = render(<AwiDirectory workspaceId="a" initialMasters={[master("one", "Old name")]} />);
    view.rerender(<AwiDirectory workspaceId="a" initialMasters={[master("one", "Updated name")]} />);
    expect(screen.getByText("Updated name")).toBeVisible();
    expect(screen.queryByText("Old name")).not.toBeInTheDocument();
    view.rerender(<AwiDirectory workspaceId="a" initialMasters={[]} />);
    expect(screen.queryByText("Updated name")).not.toBeInTheDocument();
    expect(listAwiMasters).not.toHaveBeenCalled();
  });

  it("replaces the list when server props change workspace", () => {
    const view = render(<AwiDirectory workspaceId="a" initialMasters={[master("a", "Workspace A instruction")]} />);
    view.rerender(<AwiDirectory workspaceId="b" initialMasters={[master("b", "Workspace B instruction")]} />);
    expect(screen.getByText("Workspace B instruction")).toBeVisible();
    expect(screen.queryByText("Workspace A instruction")).not.toBeInTheDocument();
  });

  it("ignores a previous workspace's late response while the current list loads", async () => {
    let resolveA!: (rows: AwiMaster[]) => void;
    let resolveB!: (rows: AwiMaster[]) => void;
    vi.mocked(listAwiMasters).mockImplementation((id) => new Promise((resolve) => {
      if (id === "a") resolveA = resolve; else resolveB = resolve;
    }));
    const view = render(<AwiDirectory workspaceId="a" />);
    view.rerender(<AwiDirectory workspaceId="b" />);
    await act(async () => { resolveA([master("a", "Old workspace result")]); });
    expect(screen.queryByText("Old workspace result")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Opening AWI Master List");
    await act(async () => { resolveB([master("b", "Current workspace result")]); });
    expect(screen.getByText("Current workspace result")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("recovers from a failed fallback when valid server data arrives", async () => {
    vi.mocked(listAwiMasters).mockRejectedValue(new Error("Connection lost"));
    const view = render(<AwiDirectory workspaceId="a" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Connection lost"));
    view.rerender(<AwiDirectory workspaceId="a" initialMasters={[master("a", "Recovered instruction")]} />);
    expect(screen.getByText("Recovered instruction")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
