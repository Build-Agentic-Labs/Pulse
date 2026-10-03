import { defineConfig, devices } from '@playwright/test';

if (process.env.PULSE_BROWSER_TEST !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:56321') {
  throw new Error('Run npm run test:browser to use the isolated database and build.');
}
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0, // A flaky first attempt should fail CI, not quietly pass on retry.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/awi',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
