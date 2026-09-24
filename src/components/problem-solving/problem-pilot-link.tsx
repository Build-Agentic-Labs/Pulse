"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

/** Fail closed. The route and database independently enforce the same pilot gate. */
export function ProblemPilotLink() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const db = createPlannerSupabaseClient();
    let current = true;
    let request = 0;
    const check = async () => {
      const sequence = ++request;
      const { data, error } = await db.rpc("is_problem_solving_pilot");
      if (current && request === sequence) setAllowed(!error && data === true);
    };
    void check();
    const { data } = db.auth.onAuthStateChange(() => { setAllowed(false); setTimeout(() => { if (current) void check(); }, 0); });
    return () => { current = false; data.subscription.unsubscribe(); };
  }, []);
  return allowed ? <Link href="/sops/problem-solving" className="ui-nav-item ui-nav-item-idle mt-3"><ClipboardCheck size={15} strokeWidth={1.75} /><span>Problem Solving</span></Link> : null;
}
