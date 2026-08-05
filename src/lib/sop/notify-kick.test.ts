// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { kickSopNotifications } from "./notify-kick";

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchLike = () => Promise.resolve(new Response(null))) {
  const fetchMock = vi.fn<FetchLike>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("kickSopNotifications", () => {
  it("POSTs the drain route", () => {
    const fetchMock = stubFetch();

    kickSopNotifications();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sops/notifications/drain");
    expect(init?.method).toBe("POST");
  });

  it("marks the kick keepalive so a navigation right after the mutation cannot abort it", () => {
    // The kick fires immediately before the UI navigates (sign-in bootstrap,
    // send-for-review). A plain fetch is cancelled when the document unloads,
    // which silently downgrades delivery to the next daily cron.
    const fetchMock = stubFetch();

    kickSopNotifications();

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.keepalive).toBe(true);
  });

  it("swallows a rejected kick — the cron is the delivery guarantee", async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error("offline")));

    expect(() => kickSopNotifications()).not.toThrow();
    await expect(fetchMock.mock.results[0]?.value).rejects.toThrow("offline");
  });
});
