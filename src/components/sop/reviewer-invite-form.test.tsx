// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewerInviteForm } from "./reviewer-invite-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("ReviewerInviteForm", () => {
  it("posts the nomination and reports the outcome", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      jsonResponse(200, { mode: "invite", userId: "u-6", emailSent: true, seated: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onNominated = vi.fn();

    render(<ReviewerInviteForm sopId="sop-1" departmentId="dept-prd" departmentCode="PRO" onNominated={onNominated} onCancel={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer email" }), { target: { value: "new@anacorp.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(onNominated).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sops/reviewers/nominate",
      expect.objectContaining({ method: "POST" }),
    );
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, string>;
    expect(sent).toMatchObject({ sopId: "sop-1", departmentId: "dept-prd", email: "new@anacorp.com" });
    expect(sent.positionTitle).not.toBe("");
    expect(onNominated).toHaveBeenCalledWith({ mode: "invite", userId: "u-6", emailSent: true, seated: true }, "new@anacorp.com");
    expect(screen.getByText(/Invitation sent to new@anacorp.com/)).toBeTruthy();
  });

  it("shows the server's refusal inline and keeps the typed address", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(400, { error: "Quality approvers are managed by an admin." })));
    render(<ReviewerInviteForm sopId="sop-1" departmentId="dept-qas" departmentCode="QAS" onNominated={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer email" }), { target: { value: "x@anacorp.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Quality approvers are managed by an admin.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Reviewer email" })).toHaveValue("x@anacorp.com");
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    render(<ReviewerInviteForm sopId="sop-1" departmentId="dept-prd" departmentCode="PRO" onNominated={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel invite" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
