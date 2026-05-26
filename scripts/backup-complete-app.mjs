import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const cwd = process.cwd();
const label = process.argv[2] || "before-ui-edit";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(cwd, "backups", `complete-app-${label}-${timestamp}`);

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  "out",
  "backups",
  ".git",
  ".vercel",
  "UFO",
]);

const EXCLUDED_FILE_NAMES = new Set(["tsconfig.tsbuildinfo"]);

const ROOT_FILES = [
  ".gitignore",
  ".env.example",
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "next-env.d.ts",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "manufacturing_line_gantt_app_spec.md",
  "smart-allocation-status.md",
];

const ROOT_DIRS = ["app", "src", "public", "scripts", "supabase", "office", "certificates"];

function shouldExclude(relativePath) {
  const parts = relativePath.split(/[/\\]/).filter(Boolean);
  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part))) {
    return true;
  }
  const base = parts[parts.length - 1];
  return EXCLUDED_FILE_NAMES.has(base);
}

async function copyTree(sourceRelative, destinationRelative) {
  const source = path.join(cwd, sourceRelative);
  if (!existsSync(source)) {
    return false;
  }

  const destination = path.join(backupRoot, destinationRelative);
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: (src) => {
      const relative = path.relative(cwd, src);
      if (!relative) {
        return true;
      }
      return !shouldExclude(relative);
    },
  });
  return true;
}

function runGit(command) {
  try {
    return execSync(command, { cwd, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function writeText(relativePath, content) {
  const filePath = path.join(backupRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function redactEnv(envText) {
  return envText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        return line;
      }

      const key = line.slice(0, line.indexOf("="));
      const value = line.slice(line.indexOf("=") + 1);
      if (!value.trim()) {
        return line;
      }

      if (/^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_PHONE_PORTAL_URL|PHONE_PORTAL_URL|OPENAI_MODEL)$/.test(key.trim())) {
        return line;
      }

      return `${key}=<redacted>`;
    })
    .join("\n");
}

await mkdir(backupRoot, { recursive: true });

for (const dirName of ROOT_DIRS) {
  await copyTree(dirName, path.join("code", dirName));
}

for (const fileName of ROOT_FILES) {
  const source = path.join(cwd, fileName);
  if (!existsSync(source)) {
    continue;
  }
  await copyTree(fileName, path.join("code", fileName));
}

const gitDir = path.join(backupRoot, "git");
await mkdir(gitDir, { recursive: true });

const gitFiles = {
  "branch.txt": runGit("git branch --show-current"),
  "commit.txt": runGit("git rev-parse HEAD"),
  "status.txt": runGit("git status --short"),
  "diff.patch": runGit("git diff"),
  "diff-staged.patch": runGit("git diff --cached"),
  "log.txt": runGit("git log -5 --oneline"),
};

for (const [name, content] of Object.entries(gitFiles)) {
  await writeFile(path.join(gitDir, name), content ? `${content}\n` : "", "utf8");
}

let envNote = "No .env.local copied.";
if (existsSync(path.join(cwd, ".env.local"))) {
  const envText = await readFile(path.join(cwd, ".env.local"), "utf8");
  await writeText("local/.env.local.redacted", redactEnv(envText));
  const hasServiceKey = /^SUPABASE_SERVICE_ROLE_KEY=.+/m.test(envText);
  envNote = hasServiceKey
    ? "SUPABASE_SERVICE_ROLE_KEY is set locally but redacted from this backup. Run `node scripts/backup-flexboost.mjs` separately for database/storage backup."
    : "SUPABASE_SERVICE_ROLE_KEY is not set. Code backup only; add the key and run `node scripts/backup-flexboost.mjs` for data.";
}

const readme = [
  "# Complete App Backup",
  "",
  `Created: ${new Date().toISOString()}`,
  `Label: ${label}`,
  `Backup folder: ${backupRoot}`,
  "",
  "## Contents",
  "",
  "- `code/`: application source, config, scripts, and Supabase migrations",
  "- `local/.env.local.redacted`: local environment shape with secrets redacted (if present)",
  "- `git/`: branch, commit, status, and uncommitted diffs for restore reference",
  "",
  "## Restore code",
  "",
  "Copy files from `code/` back into the project root, or use `git/diff.patch` to review what changed since this snapshot.",
  "",
  "## Data backup",
  "",
  envNote,
  "",
].join("\n");

await writeText("README.md", readme);

const manifest = {
  label,
  createdAt: new Date().toISOString(),
  backupRoot,
  git: {
    branch: gitFiles["branch.txt"],
    commit: gitFiles["commit.txt"],
    hasUncommittedChanges: Boolean(gitFiles["status.txt"] || gitFiles["diff.patch"]),
  },
  copiedRoots: ROOT_DIRS.filter((dirName) => existsSync(path.join(cwd, dirName))),
  copiedRootFiles: ROOT_FILES.filter((fileName) => existsSync(path.join(cwd, fileName))),
  envLocalRedacted: existsSync(path.join(cwd, ".env.local")),
};

await writeText("manifest.json", JSON.stringify(manifest, null, 2));

console.log(JSON.stringify(manifest, null, 2));
