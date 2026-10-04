# NOT AUTHORIZED FOR PRODUCTION

This folder holds database work that is **isolated and unapproved**. Nothing here may be applied to
production, or to any shared or hosted database, without separate, explicit authorization.

| File | What it is |
|---|---|
| `migrations/20261003210000_step_recovery_and_tool_changes.sql` | Additive recovery table and the `delete_manufacturing_step`, `restore_manufacturing_step` and `apply_step_tool_changes` functions (`docs/restore-step-design.md`) |
| `tests/step_recovery_test.sql` | pgTAP tests for that migration (48 assertions) |
| `tests/compat_cutover_test.sql` | pgTAP design characterization of the client-compatibility cutover (16 assertions). It calls the functions above, so it needs the migration. |

## Why it lives here

The repository's tooling only looks in `supabase/migrations` and `supabase/tests`:
- CI's `supabase db reset` and `supabase test db`;
- `scripts/apply-migration-safely.mjs`;
- `scripts/repair-migration-ledger.mjs`;
- `scripts/test-browser.mjs`;
- `supabase migration list` / `db push`.

None of them discover this folder, so the migration cannot be picked up as "pending" by accident.

**Coverage consequence:** the two pgTAP files are **excluded from the normal database suite**. CI does not run them. Their 64 assertions are not part of the active suite's count, and a smaller active count must not be read as equivalent coverage.

## Using it on an isolated database only

Apply to the isolated local database, with a record-preservation check (refuses anything but `127.0.0.1:56322`):

```
node scripts/verify-local-migration.mjs supabase/isolated/2026-10-03-step-recovery/migrations/20261003210000_step_recovery_and_tool_changes.sql
```

Run the tests against that database:

```
npx --yes supabase@2.119.0 test db --workdir scratch/browser-db supabase/isolated/2026-10-03-step-recovery/tests/<file>.sql
```

Moving anything back into `supabase/migrations` or `supabase/tests` is a production decision that needs explicit approval.
