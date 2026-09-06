/**
 * Auth-mail readiness for the health endpoint. Pure. Two questions: is every
 * variable the password-reset / invitation path needs present, and did the most
 * recent canary reset actually get sent AND delivered recently?
 */

/** The canary runs daily; past this, silence is a failure. */
export const CANARY_STALE_HOURS = 26;
/** Resend's delivery webhook normally lands within seconds; allow a slow provider. */
export const CANARY_DELIVERY_GRACE_MINUTES = 15;

export interface CanaryObservation {
  requestedAt: string;
  status: "sent" | "failed";
  error: string | null;
  deliveredAt: string | null;
}

export interface AuthMailHealthInput {
  now: Date;
  missingConfig: string[];
  /** Null when AUTH_MAIL_CANARY_EMAIL is unset — the canary is simply off. */
  canaryEmail: string | null;
  latestCanary: CanaryObservation | null;
}

export type CanaryState = "not_configured" | "never_ran" | "ok" | "stale" | "failed" | "undelivered";

export interface AuthMailHealth {
  healthy: boolean;
  problems: string[];
  canary: CanaryState;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function assessCanary(now: Date, latest: CanaryObservation | null): { state: CanaryState; problem: string | null } {
  if (!latest) return { state: "never_ran", problem: "auth-mail canary has never run" };

  const ageMs = now.getTime() - new Date(latest.requestedAt).getTime();
  if (latest.status === "failed") {
    return { state: "failed", problem: `auth-mail canary failed: ${latest.error ?? "unknown error"}` };
  }
  if (ageMs > CANARY_STALE_HOURS * HOUR_MS) {
    return {
      state: "stale",
      problem: `auth-mail canary last ran ${Math.round(ageMs / HOUR_MS)}h ago (threshold ${CANARY_STALE_HOURS}h)`,
    };
  }
  if (!latest.deliveredAt && ageMs > CANARY_DELIVERY_GRACE_MINUTES * MINUTE_MS) {
    return {
      state: "undelivered",
      problem:
        `auth-mail canary sent ${Math.round(ageMs / MINUTE_MS)} min ago but no delivery event yet ` +
        `(grace ${CANARY_DELIVERY_GRACE_MINUTES} min)`,
    };
  }
  return { state: "ok", problem: null };
}

export function assessAuthMailHealth(input: AuthMailHealthInput): AuthMailHealth {
  const problems: string[] = [];
  if (input.missingConfig.length > 0) {
    problems.push(`auth mail: missing ${input.missingConfig.join(", ")}`);
  }

  let canary: CanaryState = "not_configured";
  if (input.canaryEmail) {
    const verdict = assessCanary(input.now, input.latestCanary);
    canary = verdict.state;
    if (verdict.problem) problems.push(verdict.problem);
  }

  return { healthy: problems.length === 0, problems, canary };
}
