#!/usr/bin/env node
/**
 * Apply Pulse's auth settings to the HOSTED Supabase project via the
 * Management API. supabase/config.toml only configures the local stack — and a
 * blind `supabase config push` would clobber production's site_url with the
 * localhost value from that file, so this script patches ONLY the keys listed
 * in DESIRED below. Requires SUPABASE_ACCESS_TOKEN in the environment.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-auth-config.mjs [--dry-run]
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-auth-config.mjs --report
 *     --report prints the hosted mailer configuration (SMTP host, confirmations,
 *     rate limit) and changes nothing — the check the 2026-09-04 notifications
 *     audit could not run: an empty smtp_host means signup/email-change mail is
 *     still on Supabase's built-in mailer.
 */

const MAILER_REPORT_KEYS = [
  "smtp_host",
  "smtp_port",
  "smtp_sender_name",
  "smtp_admin_email",
  "mailer_autoconfirm",
  "external_email_enabled",
  "rate_limit_email_sent",
  "mailer_secure_email_change_enabled",
  "mailer_otp_exp",
  "site_url",
];
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "neaadefipcpxxcqszpud";
const API_BASE = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set. Create one at https://supabase.com/dashboard/account/tokens");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");

  if (process.argv.includes("--report")) {
    const current = await fetchJson(API_BASE, { headers: { Authorization: `Bearer ${token}` } });
    console.log("Hosted auth mailer configuration:");
    for (const key of MAILER_REPORT_KEYS) console.log(`  ${key} = ${preview(current[key])}`);
    if (!current.smtp_host) {
      console.log("\nsmtp_host is empty: signup confirmation and email-change mail use Supabase's built-in mailer.");
      console.log("See docs/runbooks/notifications.md §1 step 5 to route it through Resend SMTP.");
    }
    return;
  }

  const templatePath = path.join(process.cwd(), "supabase", "templates", "invite.html");
  const inviteTemplate = await readFile(templatePath, "utf8");

  const DESIRED = {
    password_min_length: 8,
    site_url: "https://pulse.agenticlabs.studio",
    mailer_subjects_invite: "Create your Pulse password",
    mailer_templates_invite_content: inviteTemplate,
  };

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const before = await fetchJson(API_BASE, { headers });
  const drifted = Object.entries(DESIRED).filter(([key, want]) => before[key] !== want);

  if (drifted.length === 0) {
    console.log("Hosted auth config already matches. Nothing to do.");
    return;
  }

  console.log("Keys to update:");
  for (const [key, want] of drifted) {
    console.log(`  ${key}: ${preview(before[key])} -> ${preview(want)}`);
  }
  if (dryRun) {
    console.log("--dry-run: no changes applied.");
    return;
  }

  const patchBody = Object.fromEntries(drifted);
  const after = await fetchJson(API_BASE, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patchBody),
  });

  const failed = Object.entries(DESIRED).filter(([key, want]) => after[key] !== want);
  if (failed.length > 0) {
    console.error("These keys did not land:", failed.map(([key]) => key).join(", "));
    process.exit(1);
  }
  console.log("Hosted auth config updated and verified.");
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null || typeof body !== "object") {
    throw new Error(`${init?.method ?? "GET"} ${url} failed (${response.status}): ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  return body;
}

function preview(value) {
  const text = JSON.stringify(value ?? null);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
