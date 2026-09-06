import { describe, expect, it } from "vitest";
import { deploymentBannerText, resolveCanonicalRedirect } from "./canonical-host";

const SITE = "https://pulse.agenticlabs.studio";
const DEPLOYMENT_HOST = "buildlogic-line-planner-abc123-team.vercel.app";

describe("resolveCanonicalRedirect", () => {
  it("sends a production vercel.app host to the canonical domain, keeping path and query", () => {
    expect(
      resolveCanonicalRedirect({
        requestUrl: `https://${DEPLOYMENT_HOST}/settings?section=account`,
        host: DEPLOYMENT_HOST,
        vercelEnv: "production",
        siteUrl: SITE,
      }),
    ).toBe("https://pulse.agenticlabs.studio/settings?section=account");
  });

  it("trusts the Host header, not the request url — self-hosted Next reports localhost there", () => {
    expect(
      resolveCanonicalRedirect({
        requestUrl: "http://localhost:3100/settings?x=1",
        host: DEPLOYMENT_HOST,
        vercelEnv: "production",
        siteUrl: SITE,
      }),
    ).toBe("https://pulse.agenticlabs.studio/settings?x=1");
  });

  it("also covers the stable project alias and ignores a port suffix", () => {
    expect(
      resolveCanonicalRedirect({
        requestUrl: "https://buildlogic-line-planner.vercel.app/",
        host: "buildlogic-line-planner.vercel.app:443",
        vercelEnv: "production",
        siteUrl: SITE,
      }),
    ).toBe("https://pulse.agenticlabs.studio/");
  });

  it("does nothing on the canonical host itself", () => {
    expect(
      resolveCanonicalRedirect({ requestUrl: `${SITE}/sops`, host: "pulse.agenticlabs.studio", vercelEnv: "production", siteUrl: SITE }),
    ).toBeNull();
  });

  it("leaves preview deployments alone — they are meant to be visited on their own host", () => {
    expect(
      resolveCanonicalRedirect({
        requestUrl: `https://${DEPLOYMENT_HOST}/`,
        host: DEPLOYMENT_HOST,
        vercelEnv: "preview",
        siteUrl: SITE,
      }),
    ).toBeNull();
  });

  it("does nothing without a configured site url, without a host, or off Vercel", () => {
    expect(resolveCanonicalRedirect({ requestUrl: "https://x.vercel.app/", host: "x.vercel.app", vercelEnv: "production", siteUrl: undefined })).toBeNull();
    expect(resolveCanonicalRedirect({ requestUrl: "https://x.vercel.app/", host: null, vercelEnv: "production", siteUrl: SITE })).toBeNull();
    expect(resolveCanonicalRedirect({ requestUrl: "http://localhost:3000/", host: "localhost:3000", vercelEnv: undefined, siteUrl: SITE })).toBeNull();
  });

  it("never redirects a custom secondary domain — only vercel.app hosts", () => {
    expect(
      resolveCanonicalRedirect({ requestUrl: "https://pulse.anacorp.com/", host: "pulse.anacorp.com", vercelEnv: "production", siteUrl: SITE }),
    ).toBeNull();
  });

  it("tolerates an unparseable site url", () => {
    expect(resolveCanonicalRedirect({ requestUrl: "https://x.vercel.app/", host: "x.vercel.app", vercelEnv: "production", siteUrl: "not a url" })).toBeNull();
  });
});

describe("deploymentBannerText", () => {
  it("names the production host on preview deployments", () => {
    expect(deploymentBannerText("preview", SITE)).toBe(
      "Preview deployment — invitations and password reset are disabled here. Use pulse.agenticlabs.studio for the real thing.",
    );
  });

  it("falls back to generic wording when the site url is unknown", () => {
    expect(deploymentBannerText("preview", undefined)).toBe(
      "Preview deployment — invitations and password reset are disabled here. Use the production site for the real thing.",
    );
  });

  it("shows nothing in production or local development", () => {
    expect(deploymentBannerText("production", SITE)).toBeNull();
    expect(deploymentBannerText("development", SITE)).toBeNull();
    expect(deploymentBannerText(undefined, SITE)).toBeNull();
  });
});
