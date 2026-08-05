"use client";

import { ArrowRight } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";
import type { Project } from "@/domain/types";
import { fetchMySpaceAccess } from "@/lib/planning/store";
import type { DashboardHomeContext } from "./auth-project-gate";
import { CompanyTopNav } from "./company-top-nav";
import { announceProjectSwitch } from "./sidebar-workspace-panel";
import { SPACE_META, SPACE_ORDER, spaceDisabledLabel, spaceHref, type SpaceKey } from "./spaces";

type SpaceCard = {
  space: SpaceKey;
  name: string;
  desc: string;
  href?: string;
  soonLabel?: string;
  project?: Project;
  /** Overrides soonLabel and forces the disabled/locked rendering even when href is set. */
  lockedLabel?: string;
};

function SpaceLinkStatus({ name, forcePending }: { name: string; forcePending: boolean }) {
  const { pending: linkPending } = useLinkStatus();
  const pending = forcePending || linkPending;

  if (!pending) {
    return (
      <span className="absolute bottom-5 right-5 z-10 -translate-x-1.5 text-ink opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100">
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
    );
  }

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">Opening {name}</span>
      <span className="ui-space-card-progress" aria-hidden="true" />
    </>
  );
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const SPACE_ART: Record<SpaceKey, { light: string; dark: string }> = {
  product: { light: "/space-art/product.webp", dark: "/space-art/product-dark.webp" },
  planning: { light: "/space-art/planning.webp", dark: "/space-art/planning-dark.webp" },
  production: { light: "/space-art/production.webp", dark: "/space-art/production-dark.webp" },
  quality: { light: "/space-art/quality.webp", dark: "/space-art/quality-dark.webp" },
  insights: { light: "/space-art/insights.webp", dark: "/space-art/insights-dark.webp" },
  settings: { light: "/space-art/settings.webp", dark: "/space-art/settings-dark.webp" },
};

function DashboardCard({
  card,
  pending,
  onNavigate,
}: {
  card: SpaceCard;
  pending: boolean;
  onNavigate: () => void;
}) {
  const disabled = !card.href || Boolean(card.lockedLabel);
  const artPosition = card.space === "production" ? "14px 18px" : undefined;
  const body = (
    <>
      <span
        aria-hidden="true"
        className="ui-space-card-art ui-space-card-art-light pointer-events-none absolute inset-0 bg-[length:110%_auto] bg-left-top bg-no-repeat transition-opacity duration-200"
        style={{ backgroundImage: `url(${SPACE_ART[card.space].light})`, backgroundPosition: artPosition }}
      />
      <span
        aria-hidden="true"
        className="ui-space-card-art ui-space-card-art-dark pointer-events-none absolute inset-0 bg-[length:110%_auto] bg-left-top bg-no-repeat transition-opacity duration-200"
        style={{ backgroundImage: `url(${SPACE_ART[card.space].dark})`, backgroundPosition: artPosition }}
      />
      <div className="relative z-10">
        <h3 className="ui-section-title flex items-center gap-2">
          {card.name}
          {disabled ? (
            <span className="ui-chip ml-auto">{card.lockedLabel ?? card.soonLabel ?? "Soon"}</span>
          ) : null}
        </h3>
        <p className="mt-1 max-w-[26ch] text-xs text-ink-secondary">{card.desc}</p>
      </div>
      {!disabled ? <SpaceLinkStatus name={card.name} forcePending={pending} /> : null}
    </>
  );

  const baseClasses =
    "group relative flex min-h-[172px] flex-col gap-4 overflow-hidden rounded-sm border border-line bg-surface p-6 transition duration-200";

  if (disabled) {
    return <div className={`${baseClasses} opacity-50`}>{body}</div>;
  }

  return (
    <Link
      href={card.href!}
      className={`${baseClasses} hover:-translate-y-0.5 hover:border-border-strong hover:shadow-float active:translate-y-0`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        onNavigate();
        if (card.project) announceProjectSwitch(card.project);
      }}
    >
      {body}
    </Link>
  );
}

export function CompanyDashboard({ groups, displayName, preferredProjectId }: DashboardHomeContext) {
  const workspaceName = groups[0]?.workspace.name ?? "";
  const workspaceId = groups[0]?.workspace.id ?? "";
  const role = groups[0]?.role;
  const isManager = role === "owner" || role === "admin" || Boolean(groups[0]?.isSuperAdmin);

  // Mirrors PlanningWorkspaceProvider's own access check (planning-workspace-provider.tsx):
  // managers implicitly have Planning; editors/viewers need `fetchMySpaceAccess` to resolve.
  // `null` while unknown -- the card renders normally in that state, since the /planning route
  // gate is the real guard and we don't want a locked flash before the check completes.
  const [planningAccess, setPlanningAccess] = useState<boolean | null>(null);
  const [openingSpace, setOpeningSpace] = useState<SpaceKey | null>(null);

  useEffect(() => {
    if (!workspaceId || isManager) {
      setPlanningAccess(true);
      return;
    }
    setPlanningAccess(null);
    let cancelled = false;
    fetchMySpaceAccess(workspaceId, "planning")
      .then((granted) => {
        if (!cancelled) setPlanningAccess(granted);
      })
      .catch(() => {
        if (!cancelled) setPlanningAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, isManager]);

  const planningLocked = planningAccess === false;
  const preferredProject = groups.flatMap((group) => group.projects).find((project) => project.id === preferredProjectId);

  const cards: SpaceCard[] = SPACE_ORDER.map((space) => ({
    space,
    name: SPACE_META[space].name,
    desc: SPACE_META[space].desc,
    href: spaceHref(space, preferredProjectId),
    soonLabel: spaceDisabledLabel(space),
    lockedLabel: space === "planning" && planningLocked ? "Restricted" : undefined,
    project: space === "product" ? preferredProject : undefined,
  }));

  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(),
  );

  return (
    <div className="h-[100dvh] overflow-y-auto bg-canvas text-ink">
      {/* Soft light-source glow at the top of the page (theme-aware, barely there). */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(720px_340px_at_50%_-120px,color-mix(in_srgb,var(--color-ink)_5%,transparent),transparent_70%)]"
      />

      <CompanyTopNav workspaceName={workspaceName} />

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
            <DashboardCard
              key={card.space}
              card={card}
              pending={openingSpace === card.space}
              onNavigate={() => setOpeningSpace(card.space)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
