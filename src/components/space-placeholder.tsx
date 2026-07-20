"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SpaceIcon, type SpaceKey } from "./spaces";
import { BackToDashboardButton, UserNav } from "./user-nav";

type SpacePlaceholderProps = {
  space: SpaceKey;
  name: string;
  description: string;
  /** What this space will hold once built — rendered as a numbered outline. */
  planned: string[];
  /** Optional template preview rendered below the outline (e.g. Planning's work-order board). */
  children?: ReactNode;
};

/**
 * Scaffold page for a company space that hasn't been built yet: an honest destination
 * for its dashboard card, plus a template outline the real space grows into.
 */
export function SpacePlaceholder({ space, name, description, planned, children }: SpacePlaceholderProps) {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-canvas text-ink">
      <header className="ui-chrome sticky top-0 z-10 flex h-12 items-center gap-3 px-4">
        <BackToDashboardButton />
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
        <span className="ui-chrome-divider" />
        <span className="ui-chrome-context-label truncate">{name}</span>
        <span className="flex-1" />
        <UserNav />
      </header>

      <main className="mx-auto max-w-[760px] px-8 py-16">
        <span className="grid h-11 w-11 place-items-center rounded-sm border border-line bg-gradient-to-b from-surface-raised to-canvas text-ink-secondary">
          <SpaceIcon space={space} />
        </span>
        <h1 className="ui-page-title mt-5">{name}</h1>
        <p className="mt-2 max-w-[52ch] text-sm text-ink-secondary">{description}</p>

        <section className="ui-panel mt-8 p-5">
          <div className="ui-mono-label">This space is coming together</div>
          <ul className="mt-4 space-y-2.5">
            {planned.map((item, index) => (
              <li key={item} className="flex items-baseline gap-3 text-[13px] text-ink-secondary">
                <span className="font-mono text-[10px] text-ink-tertiary">{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {children}
      </main>
    </div>
  );
}
