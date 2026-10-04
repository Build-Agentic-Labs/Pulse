// Playwright configuration for the edit-reliability measurement run (scripts/measure-edit-baseline.mjs).
// Separate from the repository's playwright.config.ts on purpose: CI's browser job runs `e2e/` only and
// must never execute a measurement. Guarded so it cannot be pointed at anything but the isolated API.
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (process.env.PULSE_MEASURE !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:56321') {
  throw new Error('Run node scripts/measure-edit-baseline.mjs; it sets the isolated database and build.');
}
if (!existsSync('package.json') || !existsSync('scripts/measure')) {
  throw new Error('The measurement run must start from the repository root.');
}
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.measure\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 2_400_000, // one test per fixture; the stress fixture seeds 1,100 tasks and takes minutes
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
