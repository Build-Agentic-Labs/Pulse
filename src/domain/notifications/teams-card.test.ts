import { describe, expect, it } from "vitest";
import { buildTeamsMessage, isTeamsWebhookUrl } from "./teams-card";

describe("buildTeamsMessage", () => {
  it("wraps an Adaptive Card 1.4 with title, body, kind label, and an absolute Open action", () => {
    const message = buildTeamsMessage({
      title: 'Review requested: SOP-0042 "Line Clearance"',
      body: "Sam Submitter sent it for review.",
      kindLabel: "Review requested",
      link: "/sops/sop-1",
      origin: "https://pulse.example.com",
    });
    expect(message).toEqual({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: "Pulse · Review requested", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
              { type: "TextBlock", text: 'Review requested: SOP-0042 "Line Clearance"', size: "Medium", weight: "Bolder", wrap: true },
              { type: "TextBlock", text: "Sam Submitter sent it for review.", wrap: true, spacing: "Small" },
            ],
            actions: [{ type: "Action.OpenUrl", title: "Open in Pulse", url: "https://pulse.example.com/sops/sop-1" }],
          },
        },
      ],
    });
  });

  it("omits the action when there is no link and the body when it is empty", () => {
    const message = buildTeamsMessage({ title: "T", body: "", kindLabel: "K", link: null, origin: "https://x" });
    const card = message.attachments[0].content;
    expect(card.actions).toEqual([]);
    expect(card.body).toHaveLength(2);
  });
});

describe("isTeamsWebhookUrl", () => {
  it("accepts Microsoft incoming-webhook and Power Automate hosts over https only", () => {
    expect(isTeamsWebhookUrl("https://contoso.webhook.office.com/webhookb2/abc")).toBe(true);
    expect(isTeamsWebhookUrl("https://prod-12.westus.logic.azure.com:443/workflows/abc")).toBe(true);
    expect(isTeamsWebhookUrl("http://contoso.webhook.office.com/webhookb2/abc")).toBe(false);
    expect(isTeamsWebhookUrl("https://evil.example.com/webhook.office.com")).toBe(false);
    expect(isTeamsWebhookUrl("not a url")).toBe(false);
  });
});
