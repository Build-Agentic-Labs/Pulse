// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayNamePrompt } from "./display-name-prompt";

const mocks = vi.hoisted(() => ({
  profileResult: { data: { full_name: "Rosendo Lopez" }, error: null } as {
    data: { full_name: string | null } | null;
    error: Error | null;
  },
  session: null as { user: { id: string; email?: string } } | null,
  authCallback: null as ((event: string, session: { user: { id: string; email?: string } } | null) => void) | null,
  profileReads: 0,
  updateName: vi.fn(),
}));

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: () => ({
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle() {
        mocks.profileReads += 1;
        return Promise.resolve(mocks.profileResult);
      },
    }),
    auth: {
      onAuthStateChange: (callback: typeof mocks.authCallback) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
  updateOwnProfileNameInSupabase: mocks.updateName,
}));

vi.mock("@/lib/supabase-auth", () => ({
  resolveSupabaseSession: vi.fn(() => Promise.resolve({ session: mocks.session, error: null })),
}));

const userSession = {
  user: { id: "user-1", email: "rlopez@anacorp.com" },
};

describe("DisplayNamePrompt", () => {
  beforeEach(() => {
    mocks.profileResult = { data: { full_name: "Rosendo Lopez" }, error: null };
    mocks.session = null;
    mocks.authCallback = null;
    mocks.profileReads = 0;
    mocks.updateName.mockReset();
    mocks.updateName.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("stays out of the way for signed-out users", async () => {
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.authCallback).not.toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.profileReads).toBe(0);
  });

  it("stays out of the way for users with a completed profile", async () => {
    mocks.session = userSession;
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.profileReads).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prompts on app open when the profile name is blank", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    expect(await screen.findByRole("dialog", { name: "Finish your profile" })).toBeTruthy();
    expect(screen.getByText(/SOP authorship, reviews, and approvals/)).toBeTruthy();
  });

  it("prompts after login when the stored name is blank", async () => {
    mocks.profileResult = { data: { full_name: "" }, error: null };
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.authCallback).not.toBeNull());

    await act(async () => {
      mocks.authCallback?.("SIGNED_IN", userSession);
    });

    expect(await screen.findByRole("dialog", { name: "Finish your profile" })).toBeTruthy();
  });

  it("does not reinterpret an existing display-name value", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: "rlopez@anacorp.com" }, error: null };
    render(<DisplayNamePrompt />);

    await waitFor(() => expect(mocks.profileReads).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not interrupt password recovery", async () => {
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.authCallback).not.toBeNull());

    await act(async () => {
      mocks.authCallback?.("PASSWORD_RECOVERY", userSession);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.profileReads).toBe(0);
  });

  it("saves a normalized name and lets the user continue", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: "" }, error: null };
    render(<DisplayNamePrompt />);

    const input = await screen.findByRole("textbox", { name: "Display name" });
    fireEvent.change(input, { target: { value: "  Rosendo   Lopez  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(mocks.updateName).toHaveBeenCalledWith("Rosendo Lopez"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the prompt open when saving fails", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    mocks.updateName.mockRejectedValue(new Error("Unable to update the display name."));
    render(<DisplayNamePrompt />);

    const input = await screen.findByRole("textbox", { name: "Display name" });
    fireEvent.change(input, { target: { value: "Rosendo Lopez" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update the display name.");
    expect(screen.getByRole("dialog", { name: "Finish your profile" })).toBeTruthy();
  });
});
