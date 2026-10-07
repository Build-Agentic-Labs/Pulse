import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), allow: vi.fn(() => true) }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth, createApiRateLimiter: () => mocks.allow }));

import { GET } from "./route";

const request = () => new Request("http://localhost:3000/api/quality/work-instruction-template");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allow.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ failure: null, userId: "u-1", email: "rlopez@anacorp.com", supabase: {} });
});

describe("GET /api/quality/work-instruction-template", () => {
  it("passes an auth failure straight through", async () => {
    mocks.auth.mockResolvedValue({ failure: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }), userId: null, email: null, supabase: null });
    expect((await GET(request())).status).toBe(401);
  });

  it("refuses a signed-in member who is not on the preview list", async () => {
    mocks.auth.mockResolvedValue({ failure: null, userId: "u-2", email: "qc@anacorp.com", supabase: {} });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("rate-limits per user", async () => {
    mocks.allow.mockReturnValue(false);
    expect((await GET(request())).status).toBe(429);
  });

  it("serves the template as a Word download to the template owner", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="ANA-Work-Instruction-Template.docx"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A .docx is a zip archive: it starts with the "PK" signature.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });
});
