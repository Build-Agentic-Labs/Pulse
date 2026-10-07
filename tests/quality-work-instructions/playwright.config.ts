import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57721" ||
  process.env.NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED !== "1"
)
  throw new Error("Run the local WI runner against its isolated database.");
export default defineConfig({
  testDir: ".",
  testMatch: "*.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3215",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: `node tests/quality-work-instructions/local-runtime.mjs ${process.env.CI ? "start" : "dev"}`,
    url: "http://127.0.0.1:3215/sops/work-instructions",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
