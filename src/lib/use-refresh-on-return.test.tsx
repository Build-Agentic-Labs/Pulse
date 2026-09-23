// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_ON_RETURN_MIN_INTERVAL_MS } from "@/domain/refresh-on-return";
import { useRefreshOnReturn } from "./use-refresh-on-return";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

async function returnToTab() {
  await act(async () => {
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

describe("useRefreshOnReturn", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes once for the focus + visibilitychange burst of a single return", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRefreshOnReturn(refresh));

    await returnToTab();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on mount -- the initial load already ran", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRefreshOnReturn(refresh));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes again on a later return", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRefreshOnReturn(refresh));

    await returnToTab();
    vi.setSystemTime(Date.now() + REFRESH_ON_RETURN_MIN_INTERVAL_MS);
    await returnToTab();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ignores a return to a hidden tab", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRefreshOnReturn(refresh));

    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRefreshOnReturn(refresh, false));

    await returnToTab();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("survives a failed refresh and tries again on the next return", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    renderHook(() => useRefreshOnReturn(refresh));

    await returnToTab();
    vi.setSystemTime(Date.now() + REFRESH_ON_RETURN_MIN_INTERVAL_MS);
    await returnToTab();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("calls the latest callback without re-subscribing", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ cb }) => useRefreshOnReturn(cb), { initialProps: { cb: first } });

    rerender({ cb: second });
    await returnToTab();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
