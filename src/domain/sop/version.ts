/**
 * SOP revision numbering: `major.minor`. Drafts sit at `0.x`; the first time an SOP becomes
 * effective it is `1.0`. A MAJOR (substantive) change bumps the major and resets minor and
 * flags retraining; a MINOR (editorial) change bumps the minor.
 */

export type ChangeSignificance = "MAJOR" | "MINOR";

export interface SopVersion {
  major: number;
  minor: number;
}

export function formatVersion(v: SopVersion): string {
  return `${v.major}.${v.minor}`;
}

/** The version a brand-new draft starts at (pre-first-approval). */
export function initialVersion(): SopVersion {
  return { major: 0, minor: 1 };
}

/** The version assigned when an SOP first becomes effective. */
export function firstEffectiveVersion(): SopVersion {
  return { major: 1, minor: 0 };
}

/**
 * Version for the next revision of an already-effective SOP.
 * MAJOR → (major+1).0 ; MINOR → major.(minor+1).
 */
export function nextVersion(current: SopVersion, significance: ChangeSignificance): SopVersion {
  if (significance === "MAJOR") {
    return { major: current.major + 1, minor: 0 };
  }
  return { major: current.major, minor: current.minor + 1 };
}
