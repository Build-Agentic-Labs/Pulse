"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

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

export function SidebarUserPanel() {
  const router = useRouter();
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [profile, setProfile] = useState<UserProfile>();
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function hydrateUser() {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

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

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      router.push("/login");
    } finally {
      setIsSigningOut(false);
    }
  }

  if (!profile?.email) {
    return null;
  }

  const displayName = resolveDisplayName(profile);
  const initials = userInitials(displayName, profile.email);

  return (
    <div className="border-t border-line pt-2">
      <div className="flex min-w-0 items-center gap-2 px-2 py-1">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[10px] font-medium text-ink-secondary">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-ink">{displayName}</div>
          <div className="truncate text-[10px] text-ink-tertiary">{profile.email}</div>
        </div>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center p-0 text-ink-secondary transition-colors duration-200 hover:text-ink disabled:opacity-40"
          onClick={() => void handleSignOut()}
          disabled={isSigningOut}
          title={isSigningOut ? "Signing out…" : "Log out"}
          aria-label={isSigningOut ? "Signing out" : "Log out"}
        >
          <LogOut size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
