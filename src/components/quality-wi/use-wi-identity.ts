"use client";
import { useEffect, useState } from "react";
import {
  createPlannerSupabaseClient,
  getUserFromSession,
} from "@/domain/supabase-planner";
export function useWiIdentity(initialUserId?: string) {
  const [userId, setUserId] = useState<string | null | undefined>(
    initialUserId,
  );
  useEffect(() => {
    const db = createPlannerSupabaseClient();
    let active = true;
    let sequence = 0;
    const request = sequence;
    void getUserFromSession(db).then((result) => {
      if (active && request === sequence)
        setUserId(result.data.user?.id ?? null);
    });
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      sequence++;
      if (active) setUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sequence++;
      data.subscription.unsubscribe();
    };
  }, []);
  return userId;
}
