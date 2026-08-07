// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayNamePrompt } from "./display-name-prompt";
import { ACCOUNT_MENU_VISIBILITY_EVENT } from "@/lib/app-chrome-events";
import {
  activateInvitePasswordSetup,
  completeInvitePasswordSetup,
} from "@/lib/invite-password-setup";

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
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    mocks.profileResult = { data: { full_name: "Rosendo Lopez" }, error: null };
    mocks.session = null;
    mocks.authCallback = null;
    mocks.profileReads = 0;
    mocks.updateName.mockReset();
    mocks.updateName.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("stays out of the way for signed-out users", async () => {
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.authCallback).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Add your name" })).toBeNull();
    expect(mocks.profileReads).toBe(0);
  });

  it("stays out of the way for users with a completed profile", async () => {
    mocks.session = userSession;
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.profileReads).toBe(1));
    expect(screen.queryByRole("region", { name: "Add your name" })).toBeNull();
  });

  it("prompts on app open when the profile name is blank", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    expect(await screen.findByRole("region", { name: "Add your name" })).toBeTruthy();
    expect(screen.getByText("Replace your email with your first and last name.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("prompts after login when the stored name is blank", async () => {
    mocks.profileResult = { data: { full_name: "" }, error: null };
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.authCallback).not.toBeNull());

    await act(async () => {
      mocks.authCallback?.("SIGNED_IN", userSession);
    });

    expect(await screen.findByRole("region", { name: "Add your name" })).toBeTruthy();
  });

  it("prompts when an email address is stored as the display name", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: "rlopez@anacorp.com" }, error: null };
    render(<DisplayNamePrompt />);

    expect(await screen.findByRole("region", { name: "Add your name" })).toBeTruthy();
  });

  it("does not interrupt password recovery", async () => {
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);
    await waitFor(() => expect(mocks.authCallback).not.toBeNull());

    await act(async () => {
      mocks.authCallback?.("PASSWORD_RECOVERY", userSession);
    });

    expect(screen.queryByRole("region", { name: "Add your name" })).toBeNull();
    expect(mocks.profileReads).toBe(0);
  });

  it("waits for invitation password setup before prompting for a name", async () => {
    window.history.replaceState(null, "", "/?invite=1");
    expect(activateInvitePasswordSetup()).toBe(true);
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await waitFor(() => expect(mocks.authCallback).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Add your name" })).toBeNull();
    expect(mocks.profileReads).toBe(0);

    act(() => completeInvitePasswordSetup());

    expect(await screen.findByRole("region", { name: "Add your name" })).toBeTruthy();
    expect(mocks.profileReads).toBe(1);
  });

  it("saves a normalized name and lets the user continue", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: "" }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "First name" }), {
      target: { value: "  Rosendo  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Last name" }), {
      target: { value: "  Lopez  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(mocks.updateName).toHaveBeenCalledWith("Rosendo Lopez"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Add your name" })).toBeNull());
  });

  it("keeps the prompt open when saving fails", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    mocks.updateName.mockRejectedValue(new Error("Unable to update the display name."));
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "First name" }), {
      target: { value: "Rosendo" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Last name" }), {
      target: { value: "Lopez" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update the display name.");
    expect(screen.getByRole("region", { name: "Add your name" })).toBeTruthy();
  });

  it("keeps the compact toast visible when the form is collapsed", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: "rlopez@anacorp.com" }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    const formReveal = screen.getByTestId("display-name-form-reveal");
    expect(formReveal).toHaveClass("grid-rows-[0fr]", "opacity-0");

    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    expect(formReveal).toHaveClass("grid-rows-[1fr]", "opacity-100", "duration-300");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.getByRole("region", { name: "Add your name" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(formReveal).toHaveClass("grid-rows-[0fr]", "opacity-0");
  });

  it("rejects an email address before attempting to save", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: "rlopez@anacorp.com" }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "First name" }), {
      target: { value: "rlopez@anacorp.com" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Last name" }), {
      target: { value: "Lopez" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("first name, not an email address");
    expect(mocks.updateName).not.toHaveBeenCalled();
  });

  it("requires the last-name field before attempting to save", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "First name" }), {
      target: { value: "Rosendo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your last name.");
    expect(mocks.updateName).not.toHaveBeenCalled();
  });

  it("peeks aside immediately for the account menu", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    const shell = screen.getByTestId("display-name-prompt-shell");
    vi.useFakeTimers();

    act(() => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_MENU_VISIBILITY_EVENT, { detail: true }));
    });
    expect(shell).toHaveAttribute("data-peeked", "true");
    expect(screen.getByRole("button", { name: "Open name reminder" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open name reminder" }));
    expect(shell).not.toHaveAttribute("data-peeked");

    act(() => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_MENU_VISIBILITY_EVENT, { detail: true }));
    });
    expect(shell).toHaveAttribute("data-peeked", "true");

    act(() => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_MENU_VISIBILITY_EVENT, { detail: false }));
    });
    expect(shell).toHaveAttribute("data-peeked", "true");

    vi.useRealTimers();
  });

  it("minimizes after five seconds unattended without requiring the account menu", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    const shell = screen.getByTestId("display-name-prompt-shell");
    const updateButton = screen.getByRole("button", { name: "Update name" });
    vi.useFakeTimers();

    fireEvent.focus(updateButton);
    fireEvent.blur(updateButton);

    act(() => vi.advanceTimersByTime(4999));
    expect(shell).not.toHaveAttribute("data-peeked");
    act(() => vi.advanceTimersByTime(1));
    expect(shell).toHaveAttribute("data-peeked", "true");
  });

  it("minimizes immediately after leaving an opened but untouched form", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    const shell = screen.getByTestId("display-name-prompt-shell");
    vi.useFakeTimers();
    fireEvent.mouseEnter(shell);
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    expect(screen.getByRole("textbox", { name: "First name" })).toHaveFocus();

    fireEvent.mouseLeave(shell);

    expect(shell).toHaveAttribute("data-peeked", "true");
    expect(screen.queryByRole("textbox", { name: "First name" })).toBeNull();
  });

  it("keeps the screen-edge gap inside the hover boundary", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    const shell = screen.getByTestId("display-name-prompt-shell");
    const edgeBridge = screen.getByTestId("display-name-prompt-edge-bridge");

    expect(edgeBridge).toHaveClass("pointer-events-auto", "right-0", "h-full", "w-4");
    fireEvent.mouseEnter(shell);
    fireEvent.mouseEnter(edgeBridge);

    expect(shell).not.toHaveAttribute("data-peeked");
  });

  it("stays visible while the user is entering a name", async () => {
    mocks.session = userSession;
    mocks.profileResult = { data: { full_name: null }, error: null };
    render(<DisplayNamePrompt />);

    await screen.findByRole("region", { name: "Add your name" });
    const shell = screen.getByTestId("display-name-prompt-shell");
    vi.useFakeTimers();
    fireEvent.mouseEnter(shell);
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "First name" }), {
      target: { value: "Rosendo" },
    });
    fireEvent.mouseLeave(shell);
    act(() => vi.advanceTimersByTime(5000));

    expect(shell).not.toHaveAttribute("data-peeked");
    vi.useRealTimers();
  });
});
