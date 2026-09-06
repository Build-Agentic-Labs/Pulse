import { parseWebVital } from "@/lib/web-vitals";

/** Small same-origin collector; structured events are available in hosting logs. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4096) return new Response(null, { status: 413 });
  try {
    const body = await request.text();
    if (body.length > 4096) return new Response(null, { status: 413 });
    const metric = parseWebVital(JSON.parse(body));
    if (!metric) return new Response(null, { status: 400 });
    console.info(JSON.stringify({ event: "web-vital", ...metric }));
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
