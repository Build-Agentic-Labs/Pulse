import { describe, expect, it } from "vitest";
import {
  claimRouteErrorReload,
  isStaleRouteClientError,
  ROUTE_ERROR_RELOAD_COOLDOWN_MS,
  shouldReloadStaleRouteError,
} from "./route-error-recovery";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("route error recovery", () => {
  it.each([
    ["ChunkLoadError", "Loading chunk 381 failed"],
    ["TypeError", "Failed to fetch dynamically imported module"],
    ["TypeError", "Importing a module script failed"],
    ["Error", "Module factory is not available"],
  ])("identifies stale client failures", (name, message) => {
    expect(isStaleRouteClientError({ name, message })).toBe(true);
  });

  it("does not reload unrelated production failures", () => {
    const error = { name: "Error", message: "The database is unavailable" };

    expect(shouldReloadStaleRouteError(error, "production")).toBe(false);
    expect(shouldReloadStaleRouteError(error, "development")).toBe(true);
  });

  it("allows one automatic reload per route within the cooldown", () => {
    const storage = memoryStorage();
    const now = 10_000;

    expect(claimRouteErrorReload(storage, "/sops/example", now)).toBe(true);
    expect(claimRouteErrorReload(storage, "/sops/example", now + 1_000)).toBe(false);
    expect(
      claimRouteErrorReload(
        storage,
        "/sops/example",
        now + ROUTE_ERROR_RELOAD_COOLDOWN_MS,
      ),
    ).toBe(true);
  });

  it("does not auto-reload when the loop guard cannot be persisted", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(claimRouteErrorReload(storage, "/sops/example")).toBe(false);
  });
});
