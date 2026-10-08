import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerAuthContext } from "@/lib/supabase/request-context";
import { SOP_WORKSPACE_COOKIE } from "@/lib/sop/workspace-cookie";
/** Read-only accelerator; missing auth/cookie/schema falls back to the client. */
export async function wiServerSeed<T>(
  read: (
    workspaceId: string,
    client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
    userId: string,
  ) => Promise<T>,
) {
  try {
    const { supabase: client, user } = await getServerAuthContext();
    if (!user) return undefined;
    const workspaceId = (await cookies()).get(SOP_WORKSPACE_COOKIE)?.value;
    if (!workspaceId) return undefined;
    return {
      workspaceId,
      userId: user.id,
      value: await read(workspaceId, client, user.id),
    };
  } catch {
    return undefined;
  }
}
