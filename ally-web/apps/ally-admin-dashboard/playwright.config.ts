import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the Agents v2 screens (chunk 20d): screenshots at 1440 and 390 px, axe,
 * keyboard-only and reduced motion. They run against the admin dev server: onboarding through the
 * dev-only fixture harness (/dev/onboarding), the bot page with its public API mocked, so no
 * backend or login is needed.
 *
 *   npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts
 *
 * Screenshot baselines are made in the Playwright Docker image (fonts render differently on each
 * OS); see e2e/README.md.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  // The dev server compiles each page on first visit; a cold, busy machine needs the headroom.
  timeout: 120_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  globalSetup: "./e2e/warm-up.ts",
  reporter: [["list"]],
  expect: {
    // Vite's dev server may still be compiling (or reload once after optimising dependencies)
    // when a page first opens; waits, not comparisons, get the slack.
    timeout: 30_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8081",
    // Screenshots without motion: entrance animations would make them differ run to run. Motion
    // itself is covered by the reduced-motion test and the unit tests.
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Vite directly, not `nx serve`: Nx's task lock can outlive a killed run and block the next.
        command: "npx vite --port 8081 --strictPort",
        cwd: ".",
        url: "http://localhost:8081",
        reuseExistingServer: true,
        timeout: 420_000,
      },
});
