import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { IeSmartAllocationPlan, IeSmartAllocationRequest } from "@/domain/ie-smart-allocation";

export async function requestIeSmartAllocationPlan(request: IeSmartAllocationRequest): Promise<IeSmartAllocationPlan> {
  const supabase = createPlannerSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("Sign in before running smart allocation.");
  }

  const response = await fetch("/api/smart-allocation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Smart allocation agent failed.");
  }

  if (!payload.plan) {
    throw new Error("Smart allocation agent did not return a plan.");
  }

  return payload.plan as IeSmartAllocationPlan;
}
