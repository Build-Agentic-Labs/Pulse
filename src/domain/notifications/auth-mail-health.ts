/**
 * Auth-mail readiness for the health endpoint. Pure. Two questions: is every
 * variable the password-reset / invitation path needs present, and did any real
 * reset or invitation send fail recently? Real traffic is the probe — there is no
 * synthetic account, so the signup-domain trigger stays untouched.
 */

/** How far back the health check looks for failed transactional sends. */
export const FAILURE_WINDOW_HOURS = 24;

export interface RecentTransactionalFailures {
  count: number;
  /** Ledger error text of the newest failure, e.g. "500: generate_link: unexpected_failure". */
  latestError: string | null;
}

export interface AuthMailHealthInput {
  missingConfig: string[];
  recentFailures: RecentTransactionalFailures;
}

export interface AuthMailHealth {
  healthy: boolean;
  problems: string[];
  failedInWindow: number;
}

export function assessAuthMailHealth(input: AuthMailHealthInput): AuthMailHealth {
  const problems: string[] = [];
  if (input.missingConfig.length > 0) {
    problems.push(`auth mail: missing ${input.missingConfig.join(", ")}`);
  }
  if (input.recentFailures.count > 0) {
    problems.push(
      `auth mail: ${input.recentFailures.count} send(s) failed in the last ${FAILURE_WINDOW_HOURS}h ` +
        `(latest: ${input.recentFailures.latestError ?? "unknown error"})`,
    );
  }
  return { healthy: problems.length === 0, problems, failedInWindow: input.recentFailures.count };
}
