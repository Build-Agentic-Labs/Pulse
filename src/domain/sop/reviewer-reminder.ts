/**
 * The manual "Remind" button's cooldown, mirrored for UX. The database
 * (remind_sop_reviewer) is the gate; this only decides what the button shows.
 */

export const REVIEWER_REMINDER_COOLDOWN_HOURS = 24;

const COOLDOWN_MS = REVIEWER_REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000;

/** When a reviewer last reminded at `lastRemindedAt` may be reminded again. */
export function nextReminderAllowedAt(lastRemindedAt: string): string {
  return new Date(new Date(lastRemindedAt).getTime() + COOLDOWN_MS).toISOString();
}

/** True while the cooldown window that ends at `nextAllowedAt` is still open. */
export function reminderCoolingDown(nextAllowedAt: string | null | undefined, now: Date): boolean {
  if (!nextAllowedAt) return false;
  const until = new Date(nextAllowedAt).getTime();
  return Number.isFinite(until) && until > now.getTime();
}
