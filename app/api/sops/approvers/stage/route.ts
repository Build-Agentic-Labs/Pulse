import { NextResponse } from "next/server";
import { requireApiUser, createApiRateLimiter } from "@/lib/api-auth";
import { parseNominationBody } from "@/domain/workspace/reviewer-nomination";
const limit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 20 });
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  if (!limit(auth.userId)) return NextResponse.json({ error: "Try again in a minute." }, { status: 429 });
  const body = parseNominationBody(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Choose a department and enter a valid email and position title." }, { status: 400 });
  const { error } = await auth.supabase.rpc("stage_sop_approver", { p_sop_id: body.sopId, p_department_id: body.departmentId, p_email: body.email, p_position_title: body.positionTitle });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ mode: "invite", userId: null, emailSent: false, seated: true, deferred: true });
}
