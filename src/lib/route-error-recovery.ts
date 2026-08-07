export type RouteErrorLike = Pick<Error, "message" | "name"> & { digest?: string };

const STALE_CLIENT_ERROR_PATTERNS = [
  /chunkloaderror/i,
  /loading (?:css )?chunk \S+ failed/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  /module factory is not available/i,
];

export const ROUTE_ERROR_RELOAD_COOLDOWN_MS = 30_000;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

export function isStaleRouteClientError(error: RouteErrorLike): boolean {
  const description = `${error.name}: ${error.message}`;
  return STALE_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(description));
}

export function shouldReloadStaleRouteError(
  error: RouteErrorLike,
  environment: string | undefined,
): boolean {
  // Development tabs can outlive the dev server or sleep through Turbopack HMR.
  // In production, reload only errors that positively identify a stale client bundle.
  return environment === "development" || isStaleRouteClientError(error);
}

export function claimRouteErrorReload(
  storage: SessionStorageLike,
  pathname: string,
  now = Date.now(),
): boolean {
  const key = `pulse:route-error-reload:${pathname}`;

  try {
    const storedPrevious = storage.getItem(key);
    const previous = storedPrevious === null ? undefined : Number(storedPrevious);
    if (
      previous !== undefined &&
      Number.isFinite(previous) &&
      now - previous < ROUTE_ERROR_RELOAD_COOLDOWN_MS
    ) {
      return false;
    }
    storage.setItem(key, String(now));
    return true;
  } catch {
    // Without session storage there is no safe way to prevent a reload loop.
    return false;
  }
}
