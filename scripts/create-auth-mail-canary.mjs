#!/usr/bin/env node
/**
 * One-time setup for the daily auth-mail canary: create (or confirm) the
 * dedicated Supabase auth user whose address receives the canary password-reset
 * email. The default address is Resend's test sink, which accepts every message
 * and reports it delivered, so the canary never reaches a real inbox.
 *
 *   node scripts/create-auth-mail-canary.mjs            # uses AUTH_MAIL_CANARY_EMAIL or delivered@resend.dev
 *   node scripts/create-auth-mail-canary.mjs --dry-run  # report only
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment, falling back to .env.local. Prints ids, never keys.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_CANARY = "delivered@resend.dev";

function loadLocalEnv() {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, name, raw] = match;
      if (!process.env[name]) process.env[name] = raw.replace(/^"|"$/g, "");
    }
  } catch {
    // No .env.local — rely on the environment.
  }
}

async function main() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    process.exit(1);
  }
  const email = (process.env.AUTH_MAIL_CANARY_EMAIL || DEFAULT_CANARY).trim().toLowerCase();
  const dryRun = process.argv.includes("--dry-run");

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // listUsers has no email filter; page through until found (the project is small).
  let existing = null;
  for (let page = 1; page <= 20 && !existing; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    existing = data.users.find((user) => (user.email ?? "").toLowerCase() === email) ?? null;
    if (data.users.length < 200) break;
  }

  if (existing) {
    console.log(`Canary account already exists: ${email} (id ${existing.id}, confirmed: ${Boolean(existing.email_confirmed_at)})`);
    return;
  }
  if (dryRun) {
    console.log(`--dry-run: would create confirmed canary account ${email}.`);
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { pulse_canary: true, full_name: "Pulse auth-mail canary" },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  console.log(`Created canary account ${email} (id ${data.user.id}). It has no workspace access and no password.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
