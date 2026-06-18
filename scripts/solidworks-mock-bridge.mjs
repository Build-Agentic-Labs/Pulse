#!/usr/bin/env node
// Mock SolidWorks bridge — exercises the Pulse <-> plugin HTTP contract end to end WITHOUT SolidWorks.
// It authenticates as the service account, lists picker targets, and uploads a placeholder PNG to a
// step, exactly as the real C# plugin will. Use it to verify the Pulse side before any plugin exists.
//
// Required env:
//   PULSE_BASE_URL          e.g. http://localhost:3000  (the running Next.js app)
//   SUPABASE_URL            your project's Supabase URL (NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_ANON_KEY       the anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY)
//   SW_BRIDGE_EMAIL         the SolidWorks service-account email
//   SW_BRIDGE_PASSWORD      its password
// Optional env (otherwise the script auto-picks the first project/task/step it can see):
//   PROJECT_ID, TASK_ID
//
// Run:  node scripts/solidworks-mock-bridge.mjs

// Convenience for local testing: fall back to .env.local for the Supabase URL/key (from the
// NEXT_PUBLIC_* vars) and default PULSE_BASE_URL to the local dev server, so a local run only needs
// SW_BRIDGE_EMAIL + SW_BRIDGE_PASSWORD. Explicit env vars always win.
import { readFileSync } from "node:fs";

function loadDotEnvLocal() {
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) {
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const dotenv = loadDotEnvLocal();
process.env.PULSE_BASE_URL ||= "http://localhost:3000";
process.env.SUPABASE_URL ||= dotenv.NEXT_PUBLIC_SUPABASE_URL ?? "";
process.env.SUPABASE_ANON_KEY ||= dotenv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const required = ["PULSE_BASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SW_BRIDGE_EMAIL", "SW_BRIDGE_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}`);
  console.error("Local run needs at least: SW_BRIDGE_EMAIL=… SW_BRIDGE_PASSWORD=… node scripts/solidworks-mock-bridge.mjs");
  process.exit(1);
}

const {
  PULSE_BASE_URL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SW_BRIDGE_EMAIL,
  SW_BRIDGE_PASSWORD,
  PROJECT_ID,
  TASK_ID,
} = process.env;

// A 1x1 transparent PNG — stands in for a rendered exploded view.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: SW_BRIDGE_EMAIL, password: SW_BRIDGE_PASSWORD }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Sign-in failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function getJson(path, token) {
  const response = await fetch(`${PULSE_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function resolveTarget(token) {
  if (PROJECT_ID && TASK_ID) {
    return { projectId: PROJECT_ID, taskId: TASK_ID };
  }

  const { projects } = await getJson("/api/solidworks/targets", token);
  if (!projects?.length) {
    throw new Error("No accessible projects for the service account.");
  }

  // Search projects (the one pinned by PROJECT_ID, else all) for the first task (task-level attach).
  const candidates = PROJECT_ID ? projects.filter((p) => p.projectId === PROJECT_ID) : projects;
  for (const project of candidates) {
    const { tasks } = await getJson(
      `/api/solidworks/targets?projectId=${encodeURIComponent(project.projectId)}`,
      token,
    );
    const task = TASK_ID ? tasks.find((t) => t.id === TASK_ID) : tasks[0];
    if (task) {
      console.log(`Using project ${project.projectId} (${project.projectName})`);
      console.log(`Using task "${task.name}"${task.scenarioName ? ` [${task.scenarioName}]` : ""}`);
      return { projectId: project.projectId, taskId: task.id };
    }
    console.log(`(skipping ${project.projectName} — no tasks)`);
  }

  throw new Error("No task found in any accessible project.");
}

async function uploadExplodedView(token, target) {
  const form = new FormData();
  form.append("file", new Blob([PLACEHOLDER_PNG], { type: "image/png" }), "mock-explode.png");
  form.append(
    "meta",
    JSON.stringify({
      projectId: target.projectId,
      taskId: target.taskId,
      fileName: "Mock exploded view",
      caption: "Uploaded by solidworks-mock-bridge",
      solidworksFilePath: "C:/vault/MOCK-ASM-0001.SLDASM",
      explodeConfigName: "Manufacturing_Explode_01",
      frameNumber: 1,
      components: ["PN-1000", "PN-1001"],
    }),
  );

  const response = await fetch(`${PULSE_BASE_URL}/api/solidworks/exploded-view`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data.explodedView;
}

async function main() {
  const token = await signIn();
  console.log("✓ Signed in as service account");
  const target = await resolveTarget(token);
  const view = await uploadExplodedView(token, target);
  console.log("✓ Exploded view ingested:");
  console.log(JSON.stringify(view, null, 2));
  console.log("\nOpen the planner/mobile portal on that step — the view should appear (live via realtime).");
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
