import { defineConfig, devices } from '@playwright/test';

// The suite builds the app (global-setup.ts), then starts and restarts its own
// production server (server.ts), so there's no `webServer` block here.
// Run with: npm run test:e2e  (or npm run test:e2e:ui to watch it)
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 4399}`,
    // Optional: point at an already-installed Chromium instead of `npx playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
});
