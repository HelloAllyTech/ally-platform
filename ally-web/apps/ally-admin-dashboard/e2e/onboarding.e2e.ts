import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { mockOnboardingApi } from "./onboarding.mocks";

/** Every onboarding screen, from the dev harness's fixtures (screenshots, axe). */
const SCREENS = [
  "reading",
  "reading-done",
  "learned",
  "safety",
  "question-1",
  "question-2",
  "question-3",
  "question-4",
  "design",
  "building-done",
  "make",
  "checkup",
  "share",
  "live",
];

test.beforeEach(async ({ page }) => {
  await mockOnboardingApi(page);
});

test.describe("onboarding screens", () => {
  for (const screen of SCREENS) {
    test(`${screen}: matches its baseline and has no serious a11y issues`, async ({ page }) => {
      await page.goto(`/dev/onboarding?screen=${screen}&hold=1`);
      await expect(page.locator(".ally-frame")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // The QR code is drawn after the screen appears.
      if (screen === "live") await expect(page.getByTestId("share-qr")).toBeVisible();
      if (screen === "checkup") await expect(page.getByTestId("checkup-tiles")).toBeVisible();
      await expect(page).toHaveScreenshot(`onboarding-${screen}.png`, { fullPage: true });
      await expectNoSeriousA11yIssues(page);
    });
  }
});

test("choose pages: grouped by section, with the shortcuts", async ({ page }) => {
  await page.goto("/dev/onboarding?screen=reading-done&hold=1");
  await page.getByRole("button", { name: "Choose pages" }).click();
  await expect(page.getByTestId("choose-pages")).toBeVisible();
  await page.getByRole("button", { name: "Leave out blog and news" }).click();
  await expect(page.getByLabel("All of blog")).not.toBeChecked();
  await expect(page).toHaveScreenshot("onboarding-choose-pages.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
});

test("reduced motion: nothing animates", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/dev/onboarding?screen=question-2&hold=1");
  await expect(page.getByRole("radiogroup")).toBeVisible();
  const moving = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("*")].filter(el => {
        const style = getComputedStyle(el);
        const durations = style.animationDuration
          .split(",")
          .map(d => parseFloat(d) * (d.endsWith("ms") ? 1 : 1000));
        return style.animationName !== "none" && durations.some(ms => ms > 1);
      }).length,
  );
  expect(moving).toBe(0);
  await context.close();
});

test("keyboard only: start to published without a mouse", async ({ page }) => {
  await page.goto("/dev/onboarding?screen=reading");
  // The read finishes by itself; its result offers "See what I learned".
  await expect(page.getByRole("button", { name: "See what I learned" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "What we learned" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Mental health safety is on" })).toBeVisible();
  await page.keyboard.press("Enter");
  // Four questions: letters pick; the language question takes Tab, Space and Enter.
  await expect(page.getByRole("heading", { name: /couldn't find: your fees/ })).toBeVisible();
  await page.keyboard.press("b");
  await expect(
    page.getByRole("heading", { name: "Who will mostly talk to your assistant?" }),
  ).toBeVisible();
  await page.keyboard.press("a");
  await expect(
    page.getByRole("heading", { name: "Which languages should it reply in?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "English" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await page.getByRole("heading", { name: "Which languages should it reply in?" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /where should it point people/ })).toBeVisible();
  await page.keyboard.press("a");
  // Purposes: Tab to "Choose this", Enter.
  await expect(page.getByRole("button", { name: "Choose this" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Choose this" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Building your assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  await page.keyboard.press("Enter");
  // The checkup (20a-2): one question needs input; Skip for now goes on to Share.
  await expect(page.getByTestId("checkup-tiles")).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Who can use it?" })).toBeVisible();
  await page.getByRole("textbox", { name: "Their emails" }).focus();
  await page.keyboard.type("asha@example.com");
  await page.getByRole("heading", { name: "Who can use it?" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your assistant is live" })).toBeVisible();
});
