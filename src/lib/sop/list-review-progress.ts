import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** Batch reads keep the list refresh cost independent of the number of SOPs. */
export async function listReviewProgress(sopIds: string[], client: SupabaseClient<Database>) {
  if (!sopIds.length) return { signatures: [], comments: [] };
  const [signatures, comments] = await Promise.all([
    client.from("sop_signatures")
      .select("sop_id, signer_id, seat_department_id, review_cycle, signed_content_hash")
      .in("sop_id", sopIds).eq("meaning", "dept_approval"),
    client.from("sop_review_annotations")
      .select("sop_id, review_cycle, created_by")
      .in("sop_id", sopIds).is("resolved_at", null),
  ]);
  if (signatures.error) throw new Error(signatures.error.message);
  if (comments.error) throw new Error(comments.error.message);
  return { signatures: signatures.data ?? [], comments: comments.data ?? [] };
}
