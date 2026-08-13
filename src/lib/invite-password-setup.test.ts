// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateInvitePasswordSetup,
  beginInvitePasswordSetup,
  completeInvitePasswordSetup,
  INVITE_PASSWORD_SETUP_COMPLETED_EVENT,
  isInvitePasswordSetupActive,
} from "./invite-password-setup";

describe("invite password setup", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("persists and consumes the invitation URL intent", () => {
    window.history.replaceState(null, "", "/?invite=1#access_token=test");

    expect(isInvitePasswordSetupActive()).toBe(true);
    expect(activateInvitePasswordSetup()).toBe(true);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#access_token=test");
    expect(isInvitePasswordSetupActive()).toBe(true);
  });

  it("can begin setup before Supabase creates the invite session", () => {
    expect(beginInvitePasswordSetup()).toBe(true);
    expect(isInvitePasswordSetupActive()).toBe(true);
  });

  it("clears setup state and announces completion", () => {
    window.history.replaceState(null, "", "/?invite=1");
    activateInvitePasswordSetup();
    const listener = vi.fn();
    window.addEventListener(INVITE_PASSWORD_SETUP_COMPLETED_EVENT, listener);

    completeInvitePasswordSetup();

    expect(isInvitePasswordSetupActive()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(INVITE_PASSWORD_SETUP_COMPLETED_EVENT, listener);
  });
});
