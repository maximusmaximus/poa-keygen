import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', acceptDownloads: true },
  projects: [
    // Desktop engines: full smoke suite + every viewport in tests/e2e/viewports.spec.mjs.
    { name: 'chromium', grepInvert: /@device/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', grepInvert: /@device/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', grepInvert: /@device/, use: { ...devices['Desktop Safari'] } },
    // Emulated phones (mobile UA, DPR, touch), portrait and landscape: smoke suite + native-viewport layout.
    ...[['mobile-chrome', 'Pixel 7'], ['mobile-chrome-landscape', 'Pixel 7 landscape'], ['mobile-safari', 'iPhone 13'],
      ['mobile-safari-landscape', 'iPhone 13 landscape'], ['mobile-safari-se', 'iPhone SE']]
      .map(([name, d]) => ({ name, grep: /smoke|@device/, use: { ...devices[d] } })),
  ],
});
