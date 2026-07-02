// Environment-specific seeds that used to live in migration history (audit #5:
// hardcoded personal emails in migrations). Idempotent — every statement upserts.
//
// The live production database was already seeded by the original migrations; this
// script exists for fresh environments (staging, local) and for rotating the values
// without touching migration history.
//
// Usage (loads DATABASE_URL from your gitignored env file):
//   node --env-file=.env.local scripts/seed-workspace-defaults.mjs \
//     --superadmin-email you@anacorp.com \
//     --owner-grant-email you@anacorp.com \
//     --auto-join-domain anacorp.com \
//     [--workspace workspace-default]
//
// Any of the three seed flags may be omitted to skip that seed.

import pg from "pg";

function parseArgs(argv) {
  const args = { workspace: "workspace-default" };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--superadmin-email":
        args.superadminEmail = argv[++i];
        break;
      case "--owner-grant-email":
        args.ownerGrantEmail = argv[++i];
        break;
      case "--auto-join-domain":
        args.autoJoinDomain = argv[++i];
        break;
      case "--workspace":
        args.workspace = argv[++i];
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function normalizeEmail(value, label) {
  const email = (value ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`${label} is not a valid email: "${value}"`);
  }
  return email;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.superadminEmail && !args.ownerGrantEmail && !args.autoJoinDomain) {
    throw new Error(
      "Nothing to seed. Pass at least one of --superadmin-email, --owner-grant-email, --auto-join-domain.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Run with --env-file=.env.local.");
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query("begin");

    if (args.superadminEmail) {
      const email = normalizeEmail(args.superadminEmail, "--superadmin-email");
      await client.query(
        `insert into public.platform_admins (email) values ($1) on conflict (email) do nothing`,
        [email],
      );
      console.log(`✓ platform_admins: ${email}`);
    }

    if (args.ownerGrantEmail) {
      const email = normalizeEmail(args.ownerGrantEmail, "--owner-grant-email");
      await client.query(
        `insert into public.workspace_access_grants (workspace_id, email, role, granted_by)
         values ($1, $2, 'owner', null)
         on conflict (workspace_id, email) do update set role = excluded.role`,
        [args.workspace, email],
      );
      console.log(`✓ workspace_access_grants: ${email} -> owner of ${args.workspace}`);
    }

    if (args.autoJoinDomain) {
      const domain = args.autoJoinDomain.trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        throw new Error(`--auto-join-domain is not a valid domain: "${args.autoJoinDomain}"`);
      }
      await client.query(
        `insert into public.workspace_auto_join_domains (domain, workspace_id, role)
         values ($1, $2, 'viewer')
         on conflict (domain) do nothing`,
        [domain, args.workspace],
      );
      console.log(`✓ workspace_auto_join_domains: @${domain} -> viewer of ${args.workspace}`);
    }

    await client.query("commit");
    console.log("\n✅ Seeds applied.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("\n❌ Rolled back. No changes committed.");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
