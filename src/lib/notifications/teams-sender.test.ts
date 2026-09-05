import { describe, expect, it } from "vitest";
import { createTeamsSender } from "./teams-sender";

const message = { type: "message", attachments: [] };

describe("createTeamsSender", () => {
  it("posts the JSON message to the webhook and reports success on 2xx", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const send = createTeamsSender(async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response("1", { status: 200 });
    });
    expect(await send("https://contoso.webhook.office.com/webhookb2/abc", message)).toEqual({ ok: true });
    expect(seen[0].url).toBe("https://contoso.webhook.office.com/webhookb2/abc");
    expect(seen[0].init.method).toBe("POST");
    expect((seen[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(seen[0].init.body))).toEqual(message);
  });

  it("reports a non-2xx with its status and a bounded error body", async () => {
    const send = createTeamsSender(async () => new Response("x".repeat(2000), { status: 429 }));
    const result = await send("https://contoso.webhook.office.com/webhookb2/abc", message);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.error).toHaveLength(500);
    }
  });

  it("reports a thrown fetch as a failure rather than throwing", async () => {
    const send = createTeamsSender(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await send("https://contoso.webhook.office.com/webhookb2/abc", message)).toEqual({ ok: false, status: 0, error: "ECONNRESET" });
  });

  it("refuses to post anywhere but a Teams webhook host", async () => {
    let called = false;
    const send = createTeamsSender(async () => {
      called = true;
      return new Response("1", { status: 200 });
    });
    const result = await send("https://attacker.example.com/collect", message);
    expect(result).toEqual({ ok: false, status: 0, error: "Not a Microsoft Teams webhook URL." });
    expect(called).toBe(false);
  });
});
