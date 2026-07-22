"use client";

import { ArrowLeft, LayoutGrid, LogOut, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { NotificationBell } from "@/components/notification-bell";
import { useTheme } from "@/components/theme-provider";
import { SPACE_META, SPACE_ORDER, SpaceIcon, spaceDisabledLabel, spaceHref } from "@/components/spaces";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";

function readLastProjectId(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Hover/click menu on the spaces grid button — jump straight to any company space. */
function SpacesMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [projectId, setProjectId] = useState<string>();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setProjectId(readLastProjectId());
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => onOpenChange(false), 140);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        onOpenChange(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <Link
        href="/"
        className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0"
        title="All spaces"
        aria-label="Go to the company dashboard"
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={() => onOpenChange(true)}
        onBlur={scheduleClose}
      >
        <LayoutGrid size={15} strokeWidth={1.75} />
      </Link>

      {open ? (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 ui-panel p-1.5 shadow-modal">
          <div className="px-2.5 pb-1.5 pt-1 ui-mono-label text-ink-tertiary">Spaces</div>
          {SPACE_ORDER.map((space) => {
            const href = spaceHref(space, projectId);
            const content = (
              <>
                <span className="text-ink-secondary">
                  <SpaceIcon space={space} size={16} />
                </span>
                <span className="flex-1 truncate text-[13px] text-ink">{SPACE_META[space].name}</span>
                {!href ? (
                  <span className="ui-mono-label text-ink-tertiary">{spaceDisabledLabel(space)}</span>
                ) : null}
              </>
            );
            const rowClass = "flex items-center gap-2.5 rounded-sm px-2.5 py-1.5";
            return href ? (
              <Link key={space} href={href} role="menuitem" className={`${rowClass} transition hover:bg-surface-hover`}>
                {content}
              </Link>
            ) : (
              <div key={space} className={`${rowClass} opacity-45`} aria-disabled="true">
                {content}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type UserProfile = {
  fullName?: string;
  email?: string;
  avatarUrl?: string;
};

function userInitials(name: string, email?: string) {
  const source = name.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function resolveDisplayName(profile: UserProfile) {
  const trimmed = profile.fullName?.trim();
  if (trimmed) {
    return trimmed;
  }

  const emailLocal = profile.email?.split("@")[0]?.trim();
  return emailLocal || "Signed in";
}

// Survives navigations within the tab: a remounting UserNav paints the last known
// identity immediately instead of flashing the signed-out fallback while the session
// re-hydrates. undefined = never resolved, null = known signed out.
let lastKnownProfile: UserProfile | null | undefined;

function useUserProfile(supabase: ReturnType<typeof createPlannerSupabaseClient>) {
  const [profile, setProfile] = useState<UserProfile | null | undefined>(lastKnownProfile);

  useEffect(() => {
    let mounted = true;

    function applyProfile(next: UserProfile | null) {
      lastKnownProfile = next;
      if (mounted) {
        setProfile(next);
      }
    }

    async function hydrateUser() {
      const { session } = await resolveSupabaseSession(supabase);
      const user = session?.user;

      if (!mounted) {
        return;
      }

      if (!user) {
        applyProfile(null);
        return;
      }

      const email = user.email ?? undefined;
      let fullName =
        typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined;
      let avatarUrl =
        typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined;

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!mounted) {
        return;
      }

      if (profileRow?.full_name) {
        fullName = String(profileRow.full_name);
      }

      if (profileRow?.avatar_url) {
        avatarUrl = String(profileRow.avatar_url);
      }

      applyProfile({ fullName, email, avatarUrl });
    }

    void hydrateUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        applyProfile(null);
        return;
      }

      void hydrateUser();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  return profile;
}

/**
 * The consistent far-left back affordance on every space surface: a full arrow (distinct
 * from the sidebar-collapse chevron) that returns to the company dashboard. Pass
 * `onNavigate` to guard the exit (e.g. unsaved-changes confirms).
 */
export function BackToDashboardButton({
  onNavigate,
}: {
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="ui-btn-ghost inline-flex h-8 w-8 shrink-0 items-center justify-center px-0"
      title="Back to dashboard"
      aria-label="Back to the company dashboard"
    >
      <ArrowLeft size={15} strokeWidth={1.75} />
    </Link>
  );
}

/**
 * The consistent top-right chrome control on every Pulse surface: a "spaces" grid link
 * back to the company dashboard plus the profile avatar with its account menu
 * (identity + sign out). Replaces the per-surface back links and the old sidebar
 * user panel.
 */
export function UserNav({ showSpacesLink = true }: { showSpacesLink?: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const { theme, toggleTheme } = useTheme();
  const profile = useUserProfile(supabase);
  const [openMenu, setOpenMenu] = useState<"spaces" | "account" | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const accountOpen = openMenu === "account";

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      setOpenMenu(null);
      // Land on the root: it shows the sign-in form while signed out, and signing back
      // in reveals the company dashboard right there (not the last-visited project).
      router.push("/");
    } finally {
      setIsSigningOut(false);
    }
  }

  const displayName = profile ? resolveDisplayName(profile) : "";

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={toggleTheme}
        className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0"
        title="Toggle theme"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {theme === "dark" ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
      </button>

      <NotificationBell />

      {showSpacesLink ? (
        <SpacesMenu
          open={openMenu === "spaces"}
          onOpenChange={(nextOpen) => {
            setOpenMenu((current) => nextOpen ? "spaces" : current === "spaces" ? null : current);
          }}
        />
      ) : null}

      {profile?.email ? (
        <>
          <button
            type="button"
            onClick={() => setOpenMenu((current) => current === "account" ? null : "account")}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center overflow-hidden rounded-full border border-border-strong bg-surface-raised font-mono text-[10px] text-ink transition hover:border-ink-secondary"
            title={displayName}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Account menu"
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              userInitials(displayName, profile.email)
            )}
          </button>

          {accountOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-60 ui-panel p-1.5 shadow-modal"
            >
              <div className="px-2.5 py-2">
                <div className="truncate text-[13px] font-medium text-ink">{displayName}</div>
                <div className="mt-0.5 truncate ui-mono-label text-ink-tertiary">{profile.email}</div>
              </div>
              <div className="my-1 h-px bg-line" />
              <Link
                href="/settings"
                role="menuitem"
                className="ui-btn-ghost flex h-8 w-full items-center justify-start gap-2 px-2.5 text-[12px]"
                onClick={() => setOpenMenu(null)}
              >
                <Settings size={13} strokeWidth={1.75} />
                Account settings
              </Link>
              <button
                type="button"
                role="menuitem"
                className="ui-btn-ghost flex h-8 w-full items-center justify-start gap-2 px-2.5 text-[12px] disabled:opacity-40"
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
              >
                <LogOut size={13} strokeWidth={1.75} />
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : null}
        </>
      ) : profile === undefined ? (
        // Session still resolving on this tab's first mount: hold layout with a quiet
        // placeholder instead of flashing the signed-out state.
        <span aria-hidden="true" className="h-[30px] w-[30px] shrink-0 rounded-full border border-line bg-surface-raised" />
      ) : (
        <Link href="/login" className="ui-btn-ghost inline-flex h-8 items-center px-3 text-[12px]">
          Sign in
        </Link>
      )}
    </div>
  );
}
