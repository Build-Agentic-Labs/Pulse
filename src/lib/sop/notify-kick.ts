/**
 * Fire-and-forget nudge to the notification drain after an SOP mutation, so
 * first-touch email lands in seconds instead of at the next daily cron. The
 * drain is idempotent — a failed or duplicate kick costs nothing, which is why
 * this swallows every error. Browser-only by construction (matches the
 * createPlannerSupabaseClient contract of its callers).
 */
export function kickSopNotifications(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/sops/notifications/drain", { method: "POST" }).catch(() => {
    // Intentionally silent: the daily cron is the delivery guarantee.
  });
}
