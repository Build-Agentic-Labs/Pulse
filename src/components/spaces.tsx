import type { ReactNode } from "react";
import { Settings } from "lucide-react";

export type SpaceKey = "product" | "planning" | "production" | "quality" | "insights" | "settings";

/** Canonical company spaces, in dashboard order, with their descriptions. */
export const SPACE_ORDER: SpaceKey[] = ["product", "planning", "production", "quality", "insights", "settings"];

export const SPACE_META: Record<SpaceKey, { name: string; desc: string }> = {
  product: { name: "Product", desc: "Line design, work instructions, exploded views and build animations." },
  planning: { name: "Planning", desc: "Work orders, schedules and capacity for the production plan." },
  production: { name: "Production", desc: "Live stations — documents, throughput, targets and travelers." },
  quality: { name: "Quality", desc: "SOPs, work instructions and document control." },
  insights: { name: "Insights", desc: "Reporting across every space." },
  settings: { name: "Settings", desc: "Account, appearance, organization and workspace configuration." },
};

/**
 * Destination for a space. Product needs the caller's preferred project; without one it
 * is unreachable (returns undefined -> rendered disabled). Settings is organization-wide
 * and remains available even when the organization has no projects.
 */
export function spaceHref(space: SpaceKey, preferredProjectId?: string): string | undefined {
  switch (space) {
    case "product":
      return preferredProjectId ? `/projects/${preferredProjectId}/planner?view=dashboard` : undefined;
    case "planning":
      return "/planning";
    case "production":
      return "/production";
    case "quality":
      return "/sops";
    case "insights":
      return undefined;
    case "settings":
      return "/settings";
  }
}

/** Label shown on a space that has no destination yet. */
export function spaceDisabledLabel(space: SpaceKey): string {
  return space === "insights" ? "Soon" : "No projects";
}

/**
 * The six company-space icons: 24px grid, 1.6px rounded strokes, one small filled
 * accent element each (matches the approved dashboard mockup).
 */
export function SpaceIcon({ space, size = 21 }: { space: SpaceKey; size?: number }) {
  const paths: Record<SpaceKey, ReactNode> = {
    product: (
      <>
        <path d="M12 2.75 4.25 7.1a1 1 0 0 0-.5.87v8.06a1 1 0 0 0 .5.87L12 21.25l7.75-4.35a1 1 0 0 0 .5-.87V7.97a1 1 0 0 0-.5-.87L12 2.75Z" />
        <path d="M4.1 7.4 12 11.8l7.9-4.4M12 11.8v9.2" />
        <circle cx="12" cy="7.3" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    planning: (
      <>
        <path d="M4 5.5h8M4 12h12M4 18.5h7" />
        <rect x="14.5" y="3.25" width="6" height="4.5" rx="2.25" />
        <rect x="13" y="16.25" width="7.5" height="4.5" rx="2.25" />
        <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
    production: (
      <>
        <path d="M3.5 20.5h17" />
        <path d="M5.5 20.5V10.2a.6.6 0 0 1 .93-.5l3.4 2.27V10.2a.6.6 0 0 1 .94-.5l3.4 2.27V6.5a1 1 0 0 1 1-1h2.83a1 1 0 0 1 1 1v14" />
        <circle cx="8" cy="16.4" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12.6" cy="16.4" r="1.4" fill="currentColor" stroke="none" />
      </>
    ),
    quality: (
      <>
        <path d="M12 2.9 5.2 5.7a1 1 0 0 0-.62.93v4.77c0 4.55 2.9 8.63 7.13 10.3a.8.8 0 0 0 .58 0c4.23-1.67 7.13-5.75 7.13-10.3V6.63a1 1 0 0 0-.62-.93L12 2.9Z" />
        <path d="m8.8 12.1 2.25 2.25L15.4 9.7" />
      </>
    ),
    insights: (
      <>
        <path d="M4.5 4.5v13.8a1.2 1.2 0 0 0 1.2 1.2h13.8" />
        <path d="m7.8 14.6 3.4-4.1 3 2.6 4.3-5.6" />
        <circle cx="18.5" cy="7.5" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
    settings: null,
  };

  if (space === "settings") {
    return <Settings size={size} strokeWidth={1.6} aria-hidden="true" />;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[space]}
    </svg>
  );
}
