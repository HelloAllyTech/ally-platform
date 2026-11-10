import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { mockBotPage } from "./botPage.fixture";

/** The bot page's screens in light and dark, at both widths (screenshots, axe). */
for (const theme of ["light", "dark"] as const) {
  test.describe(`bot page, ${theme}`, () => {
    test("cover", async ({ page }) => {
      await mockBotPage(page, { theme });
      await page.goto("/b/sunrise-mind");
      await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`bot-cover-${theme}.png`);
      await expectNoSeriousA11yIssues(page);
    });

    test("email, then pre-chat one question at a time", async ({ page }) => {
      await mockBotPage(page, { theme });
      await page.goto("/b/sunrise-mind");
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
      await expect(page).toHaveScreenshot(`bot-email-${theme}.png`);
      await expectNoSeriousA11yIssues(page);
      await page.getByLabel("Email address").fill("asha@example.com");
      await page.getByRole("button", { name: "Send code" }).click();
      await page.getByLabel("6-digit code").fill("123456");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Question 1 of 2")).toBeVisible();
      await page.getByRole("textbox").fill("Asha");
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByText("Question 2 of 2")).toBeVisible();
      await expect(page).toHaveScreenshot(`bot-prechat-${theme}.png`);
      await expectNoSeriousA11yIssues(page);
    });

    test("chat with a sourced answer", async ({ page }) => {
      await mockBotPage(page, { theme }, "ready");
      await page.goto("/b/sunrise-mind");
      await page.getByRole("button", { name: "Start" }).click();
      await page.getByRole("button", { name: "What are your fees?" }).click();
      await expect(page.getByText(/₹2,000 for 50 minutes/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Services and fees" })).toBeVisible();
      await expect(page).toHaveScreenshot(`bot-chat-${theme}.png`);
      await expectNoSeriousA11yIssues(page);
    });

    test("was this helpful? a thumbs down asks what was wrong", async ({ page }) => {
      await mockBotPage(page, { theme }, "ready");
      await page.goto("/b/sunrise-mind");
      await page.getByRole("button", { name: "Start" }).click();
      await page.getByRole("button", { name: "What are your fees?" }).click();
      await page.getByRole("button", { name: "Not helpful" }).click();
      await expect(page.getByText("What was wrong?")).toBeVisible();
      await page.getByRole("button", { name: "Wrong information" }).click();
      await expect(page).toHaveScreenshot(`bot-feedback-${theme}.png`);
      await expectNoSeriousA11yIssues(page);
    });
  });
}

test("heading styles follow the brand", async ({ page }) => {
  await mockBotPage(page, { headingStyle: "friendly" });
  await page.goto("/b/sunrise-mind");
  await expect(page.locator(".brand-surface")).toHaveAttribute("data-heading", "friendly");
});
