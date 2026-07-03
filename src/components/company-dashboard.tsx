"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { DashboardHomeContext } from "./auth-project-gate";
import { SPACE_META, SPACE_ORDER, SpaceIcon, spaceDisabledLabel, spaceHref, type SpaceKey } from "./spaces";
import { UserNav } from "./user-nav";

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
        <h3 className="ui-section-title flex items-center gap-2">
          {card.name}
          {disabled ? (
            <span className="ui-chip ml-auto">{card.soonLabel ?? "Soon"}</span>
          ) : (
            <span className="ml-auto -translate-x-1.5 text-ink opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100">
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
        </h3>
        <p className="mt-1 max-w-[26ch] text-xs text-ink-secondary">{card.desc}</p>
      </div>
    </>
  );

  const baseClasses =
    "group relative flex min-h-[172px] flex-col gap-4 rounded-xl border border-line bg-surface p-6 transition duration-200";

  if (disabled) {
    return <div className={`${baseClasses} opacity-50`}>{body}</div>;
  }

  return (
    <Link
      href={card.href!}
      className={`${baseClasses} hover:-translate-y-0.5 hover:border-border-strong hover:shadow-float active:translate-y-0`}
    >
      {body}
    </Link>
  );
}

export function CompanyDashboard({ groups, displayName, preferredProjectId }: DashboardHomeContext) {
  const workspaceName = groups[0]?.workspace.name ?? "";
  const cards: SpaceCard[] = SPACE_ORDER.map((space) => ({
    space,
    name: SPACE_META[space].name,
    desc: SPACE_META[space].desc,
    href: spaceHref(space, preferredProjectId),
    soonLabel: spaceDisabledLabel(space),
  }));

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
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
        {workspaceName ? (
          <>
            <span className="h-4 w-px bg-border-strong" />
            <span className="ui-mono-label">{workspaceName}</span>
          </>
        ) : null}
        <span className="flex-1" />
        <UserNav showSpacesLink={false} />
      </header>

      <main className="relative mx-auto max-w-[940px] px-8 py-16">
        <div className="mb-10">
          <div className="mb-3 ui-mono-label">{today}</div>
          <h1 className="text-[28px] font-medium tracking-tight text-ink">
            {timeGreeting()}
            {displayName ? `, ${displayName.split(" ")[0]}` : ""}.
          </h1>
          <p className="mt-2 text-sm text-ink-secondary">Pick a space to get started.</p>
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
