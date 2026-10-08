import { requireApiUser } from "@/lib/api-auth";
import { qualityWiClient } from "@/lib/quality-wi/client";
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  let b: Record<string, unknown>;
  try {
    b = await request.json();
    if (!b || typeof b !== "object") throw Error();
  } catch {
    return Response.json({ error: "Invalid import request." }, { status: 400 });
  }
  if (
    typeof b.id !== "string" ||
    typeof b.title !== "string" ||
    typeof b.purpose !== "string" ||
    typeof b.responsibilities !== "string"
  )
    return Response.json(
      { error: "Check the work instruction fields." },
      { status: 400 },
    );
  const result = await qualityWiClient(auth.supabase).rpc(
    "import_quality_wi_conversion",
    {
      p_id: b.id,
      p_title: b.title,
      p_purpose: b.purpose,
      p_responsibilities: b.responsibilities,
    },
  );
  if (result.error)
    return Response.json(
      { error: result.error.message },
      { status: result.error.code === "42501" ? 403 : 400 },
    );
  return Response.json(result.data, {
    headers: { "Cache-Control": "no-store" },
  });
}
