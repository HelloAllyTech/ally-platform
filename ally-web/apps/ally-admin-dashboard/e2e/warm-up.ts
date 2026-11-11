import { chromium, type FullConfig } from "@playwright/test";

/**
 * Visit each entry once before the tests, so the dev server has compiled them: the first visit
 * to a Vite dev server page can take longer than a test should wait.
 */
export default async function warmUp(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:8081";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const path of [
    "/dev/onboarding?screen=make&hold=1",
    "/b/sunrise-mind",
    // The assistant home and every section it imports (its API unanswered here; it still compiles).
    "/dev/assistant-home/warm-up",
  ]) {
    await page
      .goto(`${baseURL}${path}`, { timeout: 300_000, waitUntil: "load" })
      .catch(() => undefined);
    await page.waitForTimeout(2000);
  }
  await browser.close();
}
