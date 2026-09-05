/**
 * Microsoft Teams channel payloads (incoming webhook / Power Automate) and the
 * URL rule that keeps the drain from posting workspace data anywhere else. Pure.
 */

export interface TeamsCardInput {
  title: string;
  body: string;
  /** Small eyebrow beside the wordmark, e.g. "SOP document control". */
  kindLabel: string;
  /** App-relative link; null renders no action. */
  link: string | null;
  origin: string;
}

export interface TeamsTextBlock {
  type: "TextBlock";
  text: string;
  wrap?: boolean;
  size?: string;
  weight?: string;
  color?: string;
  spacing?: string;
}

export interface TeamsMessage {
  type: "message";
  attachments: {
    contentType: "application/vnd.microsoft.card.adaptive";
    contentUrl: null;
    content: {
      $schema: string;
      type: "AdaptiveCard";
      version: "1.4";
      body: TeamsTextBlock[];
      actions: { type: "Action.OpenUrl"; title: string; url: string }[];
    };
  }[];
}

export function buildTeamsMessage(input: TeamsCardInput): TeamsMessage {
  const body: TeamsTextBlock[] = [
    { type: "TextBlock", text: `Pulse · ${input.kindLabel}`, size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: input.title, size: "Medium", weight: "Bolder", wrap: true },
  ];
  if (input.body) body.push({ type: "TextBlock", text: input.body, wrap: true, spacing: "Small" });
  const actions = input.link
    ? [{ type: "Action.OpenUrl" as const, title: "Open in Pulse", url: `${input.origin.replace(/\/$/, "")}${input.link}` }]
    : [];
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          actions,
        },
      },
    ],
  };
}

const TEAMS_HOST_SUFFIXES = [".webhook.office.com", ".logic.azure.com"];

/** Only Microsoft's webhook hosts over https — the drain must never post workspace data elsewhere. */
export function isTeamsWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return TEAMS_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}
