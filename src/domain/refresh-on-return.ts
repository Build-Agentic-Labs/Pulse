/**
 * When a returning tab should re-read access (role, visible projects, space and tool grants).
 * Access changes made by an admin in another session are enforced by RLS immediately, but the
 * open app only learns of them on its next read -- this decides when that read happens.
 */

/** focus + visibilitychange fire together on one return; quick tab flips should not re-query. */
export const REFRESH_ON_RETURN_MIN_INTERVAL_MS = 10_000;

export interface RefreshOnReturnInput {
  visible: boolean;
  inFlight: boolean;
  lastRefreshAt: number;
  now: number;
}

export function shouldRefreshOnReturn({ visible, inFlight, lastRefreshAt, now }: RefreshOnReturnInput): boolean {
  if (!visible || inFlight) return false;
  return now - lastRefreshAt >= REFRESH_ON_RETURN_MIN_INTERVAL_MS;
}

/**
 * Plain-data equality for a background re-read, so an unchanged result keeps the current
 * object identity and nothing downstream re-renders.
 */
export function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
