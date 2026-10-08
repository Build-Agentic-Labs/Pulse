// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { WiLibrary } from "./wi-library";
import { loadWiLibraryDepartments } from "@/lib/quality-wi/library-departments";
import { wiConversionRequest } from "@/lib/quality-wi/conversion-client";
vi.mock("@/lib/quality-wi/conversion-client", () => ({ wiConversionRequest: vi.fn() }));
import { deleteQualityWi } from "@/lib/quality-wi/write-store";
import type { Department } from "@/domain/departments";
const confirmation = vi.hoisted(() => vi.fn());
vi.mock("@/components/confirm-provider", () => ({ useConfirm: () => confirmation }));
vi.mock("@/lib/quality-wi/write-store", () => ({ createQualityWi: vi.fn(), deleteQualityWi: vi.fn() }));
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
  vi.mocked(wiConversionRequest).mockReset().mockResolvedValue([]);
  workspace.workspaceId = "w";
  workspace.role = "owner";
  workspace.canEditSops = true;
  confirmation.mockReset().mockResolvedValue(true);
  vi.mocked(deleteQualityWi).mockReset().mockResolvedValue({id: "wi", version: 1});
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
  expect(within(screen.getByRole("row", { name: "Number Title Status Updated Actions" })).getAllByRole("columnheader").map(el => el.textContent)).toEqual(["Number", "Title", "Status", "Updated", "Actions"]);
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


it("only offers delete on the current user's own WIs, including when they have no Quality edit access", () => {
  workspace.canEditSops = false;
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[
    { ...row, createdBy: "u" }, { ...row, id: "other", title: "Other author", createdBy: "other" },
  ]} />);
  expect(screen.getByRole("button", { name: "Delete Order entry" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete Other author" })).toBeNull();
});

it("confirms deletion and only removes the row after database success", async () => {
  let finish!: (value: {id: string; version: number}) => void;
  vi.mocked(deleteQualityWi).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[{ ...row, createdBy: "u", version: 7 }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Order entry" }));
  await waitFor(() => expect(deleteQualityWi).toHaveBeenCalledWith("wi", "w", 7, undefined, expect.any(Function), "u"));
  expect(screen.getByRole("link", { name: "Order entry" })).toBeTruthy();
  expect(confirmation.mock.calls[0][0].body).toContain("permanently deletes");
  await act(async () => finish({ id: "wi", version: 7 }));
  expect(screen.queryByRole("link", { name: "Order entry" })).toBeNull();
});

it("keeps the document when deletion is cancelled or rejected", async () => {
  confirmation.mockResolvedValueOnce(false);
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[{ ...row, createdBy: "u" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Order entry" }));
  await act(async () => {});
  expect(deleteQualityWi).not.toHaveBeenCalled();
  vi.mocked(deleteQualityWi).mockRejectedValueOnce(new Error("This work instruction changed. Refresh the list before deleting it."));
  fireEvent.click(screen.getByRole("button", { name: "Delete Order entry" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Refresh the list"));
  expect(screen.getByRole("link", { name: "Order entry" })).toBeTruthy();
});

it("restores server-side conversions as table rows without opening an overlay", async () => {
  vi.mocked(wiConversionRequest).mockResolvedValue([{ id: "job", departmentId: "manufacturing", fileName: "Delivery Photos.docx", status: "processing", createdAt: new Date().toISOString() }]);
  render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  await screen.findByText("Delivery Photos");
  expect(screen.getByRole("progressbar", { name: "Converting Delivery Photos.docx" })).not.toHaveAttribute("value");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "New WI" })).toBeEnabled();
});
it("offers completed conversion review and hides jobs on published pages", async () => {
  vi.mocked(wiConversionRequest).mockResolvedValue([{ id: "job", departmentId: "manufacturing", fileName: "Delivery Photos.docx", status: "ready", createdAt: new Date().toISOString() }]);
  const view = render(<WiLibrary initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  await screen.findByRole("button", { name: "Review" });
  expect(screen.queryByRole("progressbar")).toBeNull();
  view.rerender(<WiLibrary view="published" initialWorkspaceId="w" initialUserId="u" initialRows={[]} initialDepartments={assigned} />);
  expect(screen.queryByText("Delivery Photos")).toBeNull();
});
