import { notFound, redirect } from "next/navigation";
import { ProblemWorkspace } from "@/components/problem-solving/problem-workspace";
import { getServerAuthContext } from "@/lib/supabase/request-context";
import { fetchInitialSopWorkspaceData } from "@/lib/supabase/server-data";
import { listActions, listCases } from "@/lib/problem-solving/store";

export const metadata = { title: "Problem Solving | Pulse" };

export default async function ProblemSolvingPage() {
  const { supabase, user } = await getServerAuthContext();
  if (!user) redirect("/login");
  const access = await supabase.rpc("is_problem_solving_pilot");
  if (access.error || access.data !== true) notFound();
  let initial;
  try {
    const workspace = await fetchInitialSopWorkspaceData();
    if (workspace?.workspaceId) {
      const cases = await listCases(workspace.workspaceId, supabase);
      initial = { workspaceId: workspace.workspaceId, cases, actions: await listActions(cases.map(c => c.id), supabase) };
    }
  } catch { /* The client retries under the same RLS policies. */ }
  return <ProblemWorkspace initial={initial} />;
}
