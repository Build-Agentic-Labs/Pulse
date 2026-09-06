import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());

function request(body: unknown, origin = "https://pulse.example") {
  return new Request("https://pulse.example/api/performance", {
    method: "POST", headers: { origin }, body: JSON.stringify(body),
  });
}

describe("performance collector", () => {
  it("logs a bounded metric without project IDs, search parameters, or arbitrary fields", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await POST(request({ name: "LCP", value: 1234, rating: "good",
      path: "/projects/private-project/planner?task=secret", entries: ["private text"] }));
    expect(response.status).toBe(204);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "web-vital", name: "LCP", value: 1234, rating: "good", path: "/projects/[projectId]/planner",
    });
  });
  it("rejects invalid metrics, oversized payloads, and cross-origin submissions", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await POST(request({ name: "unknown", value: 1, path: "/" }))).status).toBe(400);
    expect((await POST(request({ name: "INP", value: -1, path: "/" }))).status).toBe(400);
    expect((await POST(request("x".repeat(5000)))).status).toBe(413);
    expect((await POST(request({}, "https://unrelated.example"))).status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });
});
