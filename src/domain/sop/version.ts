/**
 * SOP revision numbering: `major.minor`. A new SOP is V1 (stored as `1.0`) throughout authoring
 * and first release. A MAJOR (substantive) change bumps the major and resets minor and flags
 * retraining; a MINOR amendment bumps the minor.
 */

export type ChangeSignificance = "MAJOR" | "MINOR";

export interface SopVersion {
  major: number;
  minor: number;
}

export function formatVersion(v: SopVersion): string {
  return `${v.major}.${v.minor}`;
}

/** Human-facing controlled-document label: 1.0 -> V1, 1.1 -> V1.1. */
export function formatVersionLabel(v: SopVersion): string {
  return v.minor === 0 ? `V${v.major}` : `V${v.major}.${v.minor}`;
}

export function versionLabel(version: string): string {
  const parsed = parseVersion(version);
  if (!parsed) return version.trim();
  return formatVersionLabel(parsed);
}

export function parseVersion(version: string): SopVersion | null {
  const match = /^(?:V)?(\d+)(?:\.(\d+))?$/i.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
}

export function nextVersionLabel(version: string, significance: ChangeSignificance): string {
  return formatVersionLabel(nextVersion(parseVersion(version) ?? firstEffectiveVersion(), significance));
}

/** The version a brand-new draft starts at and keeps through first release. */
export function initialVersion(): SopVersion {
  return { major: 1, minor: 0 };
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
