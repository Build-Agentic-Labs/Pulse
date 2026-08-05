/**
 * Fire-and-forget nudge to the notification drain after an SOP mutation, so
 * first-touch email lands in seconds instead of at the next daily cron. The
 * drain is idempotent — a failed or duplicate kick costs nothing, which is why
 * this swallows every error. Browser-only by construction (matches the
 * createPlannerSupabaseClient contract of its callers).
 *
 * `keepalive` is load-bearing, not a micro-optimisation: every caller fires this
 * immediately before the UI moves (sign-in bootstrap redeems grants then renders
 * the workspace; send-for-review navigates out of the editor). A plain fetch is
 * cancelled when the document unloads, so the kick would land only when the
 * mutation happened to leave the user on the same page — silently downgrading
 * delivery to the next daily cron, and looking for all the world like
 * notifications that fire "only when they want to".
 */
export function kickSopNotifications(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/sops/notifications/drain", { method: "POST", keepalive: true }).catch(() => {
    // Intentionally silent: the daily cron is the delivery guarantee.
  });
}
