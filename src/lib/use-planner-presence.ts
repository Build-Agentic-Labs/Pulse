"use client";

import { useEffect, useState } from "react";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";

export type PresencePeer = {
  key: string;
  name: string;
};

/**
 * Who else is currently viewing this project. Uses a Supabase Realtime presence
 * channel keyed by user id; returns the OTHER users (self excluded), deduped across
 * tabs. Purely additive telemetry — failures just mean an empty list.
 */
export function usePlannerPresence(projectId?: string): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([]);

  useEffect(() => {
    if (!projectId) {
      setPeers([]);
      return;
    }

    const supabase = createPlannerSupabaseClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const { data } = await getUserFromSession(supabase);
      const user = data.user;
      if (!user || disposed) {
        return;
      }

      const name =
        (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
        user.email ||
        "Someone";

      channel = supabase.channel(`presence:project:${projectId}`, {
        config: { presence: { key: user.id } },
      });

      channel.on("presence", { event: "sync" }, () => {
        if (!channel || disposed) {
          return;
        }
        const state = channel.presenceState<{ name: string }>();
        setPeers(
          Object.entries(state)
            .filter(([key]) => key !== user.id)
            .map(([key, metas]) => ({ key, name: metas[0]?.name ?? "Someone" })),
        );
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel?.track({ name });
        }
      });
    })();

    return () => {
      disposed = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
      setPeers([]);
    };
  }, [projectId]);

  return peers;
}
