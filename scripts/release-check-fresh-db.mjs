// Release check on a fresh, disposable local database holding only the active migrations.
// All logic and safeguards live in scripts/lib/release-check.mjs (see its header); this is the entry.
//
// Usage (from anywhere; the script changes to the repository root):
//   node scripts/release-check-fresh-db.mjs [--skip-browser] [-- <playwright args>]
//
// Never runs `db reset`, never passes --no-backup, never removes a volume, never repairs an unexpected
// environment. Ctrl-C aborts the current step and runs cleanup; a forced kill cannot be cleaned up and
// the recovery commands are printed at startup.
import { createNodeDeps, runReleaseCheck } from "./lib/release-check.mjs";

process.chdir(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const { exitCode } = await runReleaseCheck(await createNodeDeps(), {
  skipBrowser: args.includes("--skip-browser"),
  playwrightArgs: args.includes("--") ? args.slice(args.indexOf("--") + 1) : [],
});
process.exitCode = exitCode;
