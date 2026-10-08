// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { WiLibrary } from "./wi-library";
import { loadWiLibraryDepartments } from "@/lib/quality-wi/library-departments";
import type { Department } from "@/domain/departments";
const workspace = vi.hoisted(() => ({ workspaceId: "w", role: "owner", canEditSops: true }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/sop/sop-workspace-provider", () => ({ useSopWorkspace: () => workspace }));
vi.mock("./use-wi-identity", () => ({ useWiIdentity: () => "u" }));
vi.mock("@/components/sop/work-instruction-template-access", () => ({ useWorkInstructionTemplateAccess: () => true, WORK_INSTRUCTION_TEMPLATE_HREF: "/template" }));
vi.mock("@/components/sop/sop-shell", () => ({ SopShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/quality-wi/library-departments", () => ({ loadWiLibraryDepartments: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/quality-wi/read-store", () => ({ listQualityWis: () => new Promise(() => {}) }));
vi.mock("./wi-preview", () => ({ WiPreview: ({ document, publishedOnly }: { document: QualityWi; publishedOnly: boolean }) => <div role="dialog">{publishedOnly ? "Released document" : "Working draft"}: {document.title}</div> }));
afterEach(cleanup);
beforeEach(() => {
  workspace.workspaceId = "w";
  workspace.role = "owner";
  vi.mocked(loadWiLibraryDepartments).mockReset().mockImplementation(() => new Promise(() => {}));
});
const departments = [
  { id: "sales", workspaceId: "w", code: "INS", name: "Inside Sales" },
  { id: "manufacturing", workspaceId: "w", code: "MFG", name: "Manufacturing/Production" },
] as Department[];
const assigned = { departments, memberDepartmentIds: ["manufacturing"] };
const row = { id: "wi", workspaceId: "w", departmentId: "d", departmentName: "Inside Sales", departmentCode: "INS", title: "Order entry", documentNumber: "WI-INS-001", publishedRevisionId: "release", hasChanges: false, updatedAt: "2026-10-07", steps: [] } as unknown as QualityWi;

it("opens published rows in a released-version preview with no draft creation or review column", () => {
  render(<WiLibrary view="published" initialWorkspaceId="w" initialUserId="u" initialRows={[row]} />);
  expect(within(screen.getByRole("row", { name: "Number Title Status Updated" })).getAllByRole("columnheader").map(el => el.textContent)).toEqual(["Number", "Title", "Status", "Updated"]);
  expect(screen.queryByRole("button", { name: "New WI" })).toBeNull();
  expect(screen.queryByText("WI template")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Order entry" }));
  expect(screen.getByRole("dialog").textContent).toContain("Released document: Order entry");
});

it("keeps draft rows linked to the builder and offers draft creation", () => {
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[{ ...row, publishedRevisionId: null }]} />);
  expect(screen.getByRole("link", { name: "Order entry" }).getAttribute("href")).toBe("/sops/work-instructions/wi");
  expect(screen.getByRole("button", { name: "New WI" })).toBeTruthy();
  expect(screen.getByText("Draft")).toBeTruthy();
});


it("renders the assigned department immediately for an owner while revalidation is pending", () => {
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  expect(screen.getByRole("button", { name: "Department for new work instruction" }).textContent).toContain("MFG · Manufacturing/Production");
  expect(screen.queryByRole("status", { name: "Loading departments" })).toBeNull();
  expect(screen.getByRole("button", { name: "New WI" })).not.toBeDisabled();
});

it("loads the assigned department independently of a slow WI list", async () => {
  vi.mocked(loadWiLibraryDepartments).mockResolvedValue(assigned);
  render(<WiLibrary />);
  expect(screen.getByRole("status", { name: "Loading departments" })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Department for new work instruction" }).textContent).toContain("MFG · Manufacturing/Production"));
});

it("does not silently assign an unrelated department to an owner without membership", () => {
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={{ departments, memberDepartmentIds: [] }} />);
  expect(screen.getByRole("button", { name: "Department for new work instruction" }).textContent).toContain("Choose department");
  expect(screen.getByRole("button", { name: "New WI" })).toBeDisabled();
});

it("hides the previous workspace's selection until the new workspace is ready", () => {
  const view = render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  workspace.workspaceId = "other";
  view.rerender(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  expect(screen.queryByRole("button", { name: "Department for new work instruction" })).toBeNull();
  expect(screen.getByRole("button", { name: "New WI" })).toBeDisabled();
});


it("keeps a manual department choice when background membership refresh finishes", async () => {
  let finish!: (value: typeof assigned) => void;
  vi.mocked(loadWiLibraryDepartments).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  fireEvent.click(screen.getByRole("button", { name: "Department for new work instruction" }));
  fireEvent.click(screen.getByRole("option", { name: "INS · Inside Sales" }));
  await act(async () => finish(assigned));
  expect(screen.getByRole("button", { name: "Department for new work instruction" }).textContent).toContain("INS · Inside Sales");
});

it("limits non-manager options to assigned departments", () => {
  workspace.role = "editor";
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  fireEvent.click(screen.getByRole("button", { name: "Department for new work instruction" }));
  expect(screen.getByRole("option", { name: "MFG · Manufacturing/Production" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "INS · Inside Sales" })).toBeNull();
});
