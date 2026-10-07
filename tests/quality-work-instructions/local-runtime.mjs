// Local-only runner. Never resets/stops/deletes any database, and never prints API keys.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import assert from "node:assert/strict";
const name = "supabase_db_pulse-quality-wi-20261006";
assert.equal(
  execFileSync(
    "docker",
    ["ps", "--filter", "publish=57722", "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim(),
  name,
);
assert.equal(
  execFileSync(
    "docker",
    [
      "inspect",
      name,
      "--format",
      '{{index .Config.Labels "com.supabase.cli.project"}}',
    ],
    { encoding: "utf8" },
  ).trim(),
  "pulse-quality-wi-20261006",
);
const status = spawnSync(
  "npx",
  [
    "--yes",
    "supabase@2.119.0",
    "status",
    "--workdir",
    "scratch/quality-wi-build/db",
    "-o",
    "json",
  ],
  { encoding: "utf8" },
);
if (status.status !== 0)
  throw Error("The isolated WI database is not running.");
const s = JSON.parse(status.stdout);
assert.equal(s.API_URL, "http://127.0.0.1:57721");
const anon = s.ANON_KEY ?? s.PUBLISHABLE_KEY,
  secret = s.SERVICE_ROLE_KEY ?? s.SECRET_KEY;
assert(anon && secret);
const mode = process.argv[2] ?? "dev";
if (mode === "setup") {
  const file = "scratch/quality-wi-build/login.json",
    email = "wi-local-author@pulse.test";
  const saved = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { email, password: randomUUID() + "A!" };
  writeFileSync(file, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
  const bootstrap = new pg.Client({
    host: "127.0.0.1",
    port: 57722,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await bootstrap.connect();
  try {
    await bootstrap.query(
      "insert into public.workspaces(id,name) values('quality-wi-local-demo','WI builder — local test') on conflict(id) do nothing",
    );
    await bootstrap.query(
      "insert into public.workspace_auto_join_domains(domain,workspace_id) values('pulse.test','quality-wi-local-demo') on conflict(domain) do nothing",
    );
  } finally {
    await bootstrap.end();
  }
  const admin = createClient(s.API_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const users = await admin.auth.admin.listUsers();
  if (users.error) throw users.error;
  let user = users.data.users.find((row) => row.email === email);
  if (!user) {
    const result = await admin.auth.admin.createUser({
      email,
      password: saved.password,
      email_confirm: true,
      user_metadata: { full_name: "WI local author" },
    });
    if (result.error) throw result.error;
    user = result.data.user;
  }
  const db = new pg.Client({
    host: "127.0.0.1",
    port: 57722,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(
      "insert into public.workspaces(id,name) values('quality-wi-local-demo','WI builder — local test') on conflict(id) do nothing",
    );
    await db.query(
      "insert into public.workspace_members(workspace_id,user_id,role) values('quality-wi-local-demo',$1,'editor') on conflict(workspace_id,user_id) do nothing",
      [user.id],
    );
    await db.query(
      "insert into public.org_tool_access(workspace_id,user_id,level) values('quality-wi-local-demo',$1,'edit') on conflict(workspace_id,user_id) do nothing",
      [user.id],
    );
    await db.query(
      "insert into public.departments(id,workspace_id,code,name) values('quality-wi-local-pro','quality-wi-local-demo','PRO','Process Engineering') on conflict(id) do nothing",
    );
    await db.query(
      "insert into public.department_members(department_id,user_id) values('quality-wi-local-pro',$1) on conflict(department_id,user_id) do nothing",
      [user.id],
    );
    await db.query("commit");
    writeFileSync(
      file,
      JSON.stringify(
        { ...saved, userId: user.id, workspaceId: "quality-wi-local-demo" },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(
      "Local author and department are ready. Test credentials are in scratch/quality-wi-build/login.json.",
    );
  } finally {
    await db.end();
  }
} else {
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: s.API_URL,
    SUPABASE_URL: s.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: secret,
    PULSE_BROWSER_TEST: "1",
    NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED: "1",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3215",
    RESEND_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    NEXT_PUBLIC_WEB_VITALS_ENDPOINT: "",
  };
  const args =
    mode === "build"
      ? ["next", "build"]
      : mode === "browser"
        ? [
            "playwright",
            "test",
            "--config=tests/quality-work-instructions/playwright.config.ts",
          ]
        : [
            "next",
            mode === "start" ? "start" : "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            "3215",
          ];
  const child = spawn("npx", args, { env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("close", (code) => process.exit(code ?? 0));
}
