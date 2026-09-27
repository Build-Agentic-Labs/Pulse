"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

/** Fail closed. The route and database independently enforce the same pilot gate. */
const PilotAccess = createContext(false);

/** Retain navigation access across Quality page transitions. */
export function ProblemPilotAccessProvider({ children, initialUserId, initialAllowed = false }: { children: ReactNode; initialUserId?: string; initialAllowed?: boolean }) {
  const [allowed, setAllowed] = useState(initialAllowed);
  useEffect(() => {
    const db = createPlannerSupabaseClient();
    let current = true;
    let request = 0;
    const check = async () => {
      const sequence = ++request;
      const { data, error } = await db.rpc("is_problem_solving_pilot");
      if (current && request === sequence) setAllowed(!error && data === true);
    };
    let userId: string | null | undefined = initialUserId;
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;
      if (nextId === userId) return;
      userId = nextId;
      request += 1;
      setAllowed(false);
      if (nextId) {
        const identityRequest = request;
        setTimeout(() => { if (current && request === identityRequest) void check(); }, 0);
      }
    });
    return () => { current = false; data.subscription.unsubscribe(); };
  }, [initialUserId]);
  return <PilotAccess.Provider value={allowed}>{children}</PilotAccess.Provider>;
}

export function ProblemPilotLink() {
  const allowed = useContext(PilotAccess);
  return allowed ? <Link href="/sops/problem-solving" className="ui-nav-item ui-nav-item-idle mt-3"><ClipboardCheck size={15} strokeWidth={1.75} /><span>Problem Solving</span></Link> : null;
}
