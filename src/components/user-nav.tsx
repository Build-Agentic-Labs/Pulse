"use client";

import { ArrowLeft, LayoutGrid, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

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

function useUserProfile(supabase: ReturnType<typeof createPlannerSupabaseClient>) {
  const [profile, setProfile] = useState<UserProfile>();

  useEffect(() => {
    let mounted = true;

    async function hydrateUser() {
      const { session } = await resolveSupabaseSession(supabase);
      const user = session?.user;

      if (!mounted) {
        return;
      }

      if (!user) {
        setProfile(undefined);
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

      setProfile({ fullName, email, avatarUrl });
    }

    void hydrateUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setProfile(undefined);
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
  const profile = useUserProfile(supabase);
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      setOpen(false);
      router.push("/login");
    } finally {
      setIsSigningOut(false);
    }
  }

  const displayName = profile ? resolveDisplayName(profile) : "";

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center gap-1">
      {showSpacesLink ? (
        <Link
          href="/"
          className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0"
          title="All spaces"
          aria-label="Go to the company dashboard"
        >
          <LayoutGrid size={14} strokeWidth={1.75} />
        </Link>
      ) : null}

      {profile?.email ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center overflow-hidden rounded-full border border-border-strong bg-surface-raised font-mono text-[10px] text-ink transition hover:border-ink-secondary"
            title={displayName}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Account menu"
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              userInitials(displayName, profile.email)
            )}
          </button>

          {open ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-60 ui-panel p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.45)]"
            >
              <div className="px-2.5 py-2">
                <div className="truncate text-[13px] font-medium text-ink">{displayName}</div>
                <div className="mt-0.5 truncate ui-mono-label text-ink-tertiary">{profile.email}</div>
              </div>
              <div className="my-1 h-px bg-line" />
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
      ) : (
        <Link href="/login" className="ui-btn-ghost inline-flex h-8 items-center px-3 text-[12px]">
          Sign in
        </Link>
      )}
    </div>
  );
}
