"use client";

import type { SaveState } from "@/domain/supabase-planner";

export function AwiSaveStatus({ saveState }: { saveState: SaveState }) {
  const status = saveState === "error" || saveState === "retrying" ? "Save pending — keep this draft open"
    : saveState === "conflict" ? "Conflicting edit — keep this draft open"
    : saveState === "loading" ? "Loading…" : saveState === "saving" || saveState === "draft" ? "Saving…" : "Saved";
  return <span role="status" className="hidden text-[11px] text-ink-secondary sm:inline">{status}</span>;
}
