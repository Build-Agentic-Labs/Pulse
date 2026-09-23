import { describe, expect, it } from "vitest";
import { REFRESH_ON_RETURN_MIN_INTERVAL_MS, sameSnapshot, shouldRefreshOnReturn } from "./refresh-on-return";

const base = { visible: true, inFlight: false, lastRefreshAt: 0, now: 100_000 };

describe("shouldRefreshOnReturn", () => {
  it("refreshes when the tab comes back into view", () => {
    expect(shouldRefreshOnReturn(base)).toBe(true);
  });

  it("never refreshes a hidden tab", () => {
    expect(shouldRefreshOnReturn({ ...base, visible: false })).toBe(false);
  });

  it("skips while a refresh is already running", () => {
    expect(shouldRefreshOnReturn({ ...base, inFlight: true })).toBe(false);
  });

  // focus and visibilitychange both fire on one tab return; quick tab flipping must not
  // re-query the whole membership set every time.
  it("coalesces returns inside the minimum interval", () => {
    const last = base.now - (REFRESH_ON_RETURN_MIN_INTERVAL_MS - 1);
    expect(shouldRefreshOnReturn({ ...base, lastRefreshAt: last })).toBe(false);
  });

  it("refreshes again once the minimum interval has passed", () => {
    const last = base.now - REFRESH_ON_RETURN_MIN_INTERVAL_MS;
    expect(shouldRefreshOnReturn({ ...base, lastRefreshAt: last })).toBe(true);
  });
});

describe("sameSnapshot", () => {
  it("treats structurally equal data as unchanged", () => {
    expect(sameSnapshot([{ id: "a", role: "member" }], [{ id: "a", role: "member" }])).toBe(true);
  });

  it("sees a changed role or a removed project", () => {
    expect(sameSnapshot([{ id: "a", role: "member" }], [{ id: "a", role: "admin" }])).toBe(false);
    expect(sameSnapshot([{ id: "a" }, { id: "b" }], [{ id: "a" }])).toBe(false);
  });
});
