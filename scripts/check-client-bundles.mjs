import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

// Gzipped artifact budgets, not network timing targets. Lazy chunks are checked
// individually; entry budgets include shared runtime + referenced client code.
const MAX_CHUNK_KIB = 160;
const MAX_ENTRY_KIB = 350;
const build = JSON.parse(await readFile(".next/build-manifest.json", "utf8"));
const sizes = new Map();
let failed = false;
for (const file of await readdir(".next/static/chunks")) {
  if (!file.endsWith(".js")) continue;
  const name = `static/chunks/${file}`;
  const size = gzipSync(await readFile(path.join(".next", name))).length / 1024;
  sizes.set(name, size);
  if (size > MAX_CHUNK_KIB) {
    console.error(`${file}: ${size.toFixed(1)} KiB gzip exceeds ${MAX_CHUNK_KIB} KiB`);
    failed = true;
  }
}

for (const route of ["projects/[projectId]/planner", "sops", "planning/(workspace)"]) {
  const source = await readFile(`.next/server/app/${route}/page_client-reference-manifest.js`, "utf8");
  // Parse generated JSON without executing the manifest.
  const assignment = source.indexOf(" = {", source.indexOf('globalThis.__RSC_MANIFEST['));
  if (assignment < 0) throw new Error(`Unknown client manifest format: ${route}`);
  const manifest = JSON.parse(source.slice(assignment + 3).trim().replace(/;$/, ""));
  const files = new Set(build.rootMainFiles);
  for (const entry of Object.values(manifest.clientModules)) {
    for (const file of entry.chunks) if (file.endsWith(".js")) files.add(file.replace(/^\/_next\//, ""));
  }
  let total = 0;
  for (const file of files) {
    if (!sizes.has(file)) throw new Error(`Missing emitted client chunk: ${file}`);
    total += sizes.get(file);
  }
  console.log(`${route}: ${total.toFixed(1)} KiB gzip entry budget (${MAX_ENTRY_KIB} KiB maximum)`);
  if (total > MAX_ENTRY_KIB) failed = true;
}
console.log(`Largest chunk: ${Math.max(...sizes.values()).toFixed(1)} KiB gzip (${MAX_CHUNK_KIB} KiB maximum)`);
if (failed) process.exitCode = 1;
