"use client";

import { useEffect, useState } from "react";
import { canDownloadWorkInstructionTemplate } from "@/domain/quality/template-access";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

/** Same-origin GET; the auth cookie rides along and the route enforces access. */
export const WORK_INSTRUCTION_TEMPLATE_HREF = "/api/quality/work-instruction-template";

/**
 * Whether to show the template download in the Work instructions page. Fails closed and
 * re-evaluates when the signed-in identity changes. A mirror only: the API
 * route is the gate (CLAUDE.md — UI checks are never the enforcement layer).
 */
export function useWorkInstructionTemplateAccess(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let client: ReturnType<typeof createPlannerSupabaseClient>;
    try {
      client = createPlannerSupabaseClient();
    } catch (error) {
      // An optional link must never take the Work instructions page down with it.
      console.error("WI template access: Supabase client unavailable", error);
      return;
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setAllowed(canDownloadWorkInstructionTemplate(session?.user.email));
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return allowed;
}
