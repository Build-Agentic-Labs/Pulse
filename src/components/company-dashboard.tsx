"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardHomeContext } from "./auth-project-gate";

export type SpaceKey = "product" | "planning" | "production" | "quality" | "people" | "insights";

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
    people: (
      <>
        <circle cx="9" cy="8.2" r="3.4" />
        <path d="M3.2 19.4c.9-3.2 3.15-4.8 5.8-4.8s4.9 1.6 5.8 4.8" />
        <circle cx="17.2" cy="9" r="2.4" fill="currentColor" stroke="none" />
        <path d="M16.1 14.5c2.4.3 4.1 1.8 4.9 4.3" />
      </>
    ),
    insights: (
      <>
        <path d="M4.5 4.5v13.8a1.2 1.2 0 0 0 1.2 1.2h13.8" />
        <path d="m7.8 14.6 3.4-4.1 3 2.6 4.3-5.6" />
        <circle cx="18.5" cy="7.5" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
  };

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

type SpaceCard = {
  space: SpaceKey;
  name: string;
  desc: string;
  href?: string;
  soonLabel?: string;
};

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ICON_TILE_CLASSES =
  "grid h-11 w-11 place-items-center rounded-xl border border-line bg-gradient-to-b from-surface-raised to-canvas text-ink-secondary transition group-hover:border-border-strong group-hover:text-ink";

function DashboardCard({ card }: { card: SpaceCard }) {
  const disabled = !card.href;
  const body = (
    <>
      <span className={ICON_TILE_CLASSES}>
        <SpaceIcon space={card.space} />
      </span>
      <div className="mt-auto">
        <h3 className="flex items-center gap-2 text-[15.5px] font-medium tracking-tight text-ink">
          {card.name}
          {disabled ? (
            <span className="ml-auto rounded-full border border-line px-2 py-0.5 ui-mono-label text-ink-tertiary">
              {card.soonLabel ?? "Soon"}
            </span>
          ) : (
            <span className="ml-auto -translate-x-1.5 text-ink opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </span>
          )}
        </h3>
        <p className="mt-1 max-w-[26ch] text-xs text-ink-secondary">{card.desc}</p>
      </div>
    </>
  );

  const baseClasses =
    "group relative flex min-h-[172px] flex-col gap-4 rounded-[14px] border border-line bg-surface p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition duration-200";

  if (disabled) {
    return <div className={`${baseClasses} opacity-50`}>{body}</div>;
  }

  return (
    <Link
      href={card.href!}
      className={`${baseClasses} hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_32px_-12px_rgba(0,0,0,0.45)] active:translate-y-0`}
    >
      {body}
    </Link>
  );
}

export function CompanyDashboard({ groups, displayName, preferredProjectId }: DashboardHomeContext) {
  const workspaceName = groups[0]?.workspace.name ?? "";
  const productHref = preferredProjectId ? `/projects/${preferredProjectId}/planner?view=dashboard` : undefined;
  const peopleHref = preferredProjectId ? `/projects/${preferredProjectId}/planner?view=settings` : undefined;

  const cards: SpaceCard[] = [
    {
      space: "product",
      name: "Product",
      desc: "Line design, work instructions, exploded views and build animations.",
      href: productHref,
      soonLabel: "No projects",
    },
    {
      space: "planning",
      name: "Planning",
      desc: "Work orders, schedules and capacity for the production plan.",
      href: "/planning",
    },
    {
      space: "production",
      name: "Production",
      desc: "Live stations — documents, throughput, targets and travelers.",
      href: "/production",
    },
    {
      space: "quality",
      name: "Quality",
      desc: "SOPs, work instructions and document control.",
      href: "/sops",
    },
    {
      space: "people",
      name: "People",
      desc: "Members, roles and project access.",
      href: peopleHref,
      soonLabel: "No projects",
    },
    {
      space: "insights",
      name: "Insights",
      desc: "Reporting across every space.",
    },
  ];

  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(),
  );

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Soft light-source glow at the top of the page (theme-aware, barely there). */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(720px_340px_at_50%_-120px,color-mix(in_srgb,var(--color-ink)_5%,transparent),transparent_70%)]"
      />

      <header className="sticky top-0 z-10 flex h-12 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="text-[15px] font-bold tracking-tight text-ink">Pulse</span>
        {workspaceName ? (
          <>
            <span className="h-4 w-px bg-border-strong" />
            <span className="ui-mono-label">{workspaceName}</span>
          </>
        ) : null}
        <span className="flex-1" />
        <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-border-strong bg-surface-raised font-mono text-[10px] text-ink">
          {initials(displayName)}
        </span>
      </header>

      <main className="relative mx-auto max-w-[940px] px-8 py-16">
        <div className="mb-10">
          <div className="mb-3 ui-mono-label">{today}</div>
          <h1 className="text-[28px] font-medium tracking-tight text-ink">
            {timeGreeting()}
            {displayName ? `, ${displayName.split(" ")[0]}` : ""}.
          </h1>
          <p className="mt-2 text-[13.5px] text-ink-secondary">Pick a space to get started.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <DashboardCard key={card.space} card={card} />
          ))}
        </div>
      </main>
    </div>
  );
}
