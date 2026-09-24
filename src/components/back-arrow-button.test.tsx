// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));

import { BackArrowButton } from "./user-nav";

function setCanGoBack(value: boolean | undefined) {
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: value === undefined ? undefined : { canGoBack: value },
  });
}

const arrow = () => screen.getByRole("link", { name: /back/i });

beforeEach(() => {
  router.back.mockReset();
});
afterEach(() => setCanGoBack(undefined));

describe("BackArrowButton", () => {
  it("steps back one page when there is an earlier Pulse page", async () => {
    setCanGoBack(true);
    render(<BackArrowButton fallbackHref="/sops" label="Back to All SOPs" />);
    const allowed = fireEvent.click(arrow());
    expect(allowed).toBe(false); // default link navigation prevented
    await act(async () => {});
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("falls back to its link when there is nothing to go back to", () => {
    setCanGoBack(false);
    const onNavigate = vi.fn();
    render(<BackArrowButton fallbackHref="/sops" onNavigate={onNavigate} />);
    expect(arrow().getAttribute("href")).toBe("/sops");
    fireEvent.click(arrow());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });

  it("falls back too when the browser has no Navigation API", () => {
    setCanGoBack(undefined);
    render(<BackArrowButton />);
    expect(arrow().getAttribute("href")).toBe("/");
    fireEvent.click(arrow());
    expect(router.back).not.toHaveBeenCalled();
  });

  it("stays put when the leave guard is declined", async () => {
    setCanGoBack(true);
    render(<BackArrowButton confirmLeave={() => Promise.resolve(false)} />);
    fireEvent.click(arrow());
    await act(async () => {});
    expect(router.back).not.toHaveBeenCalled();
  });
});
