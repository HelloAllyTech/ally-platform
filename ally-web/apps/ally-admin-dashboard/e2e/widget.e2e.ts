import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { mockBotPage } from "./botPage.fixture";
import { LOCAL_NETWORK_OFF, mockSite, SITE } from "./widget.fixture";

/**
 * The website widget (chunk 13) on an owner's site: a page on another origin (customer.test,
 * served here) carrying the one-line snippet. The loader comes from the dev server, the frame is
 * the real bot page, and the API is mocked as in botPage.e2e.ts.
 */
test.use({ launchOptions: { args: [LOCAL_NETWORK_OFF] } });

test("the bubble on an owner's site: open, chat, ask for a person, close", async ({ page }) => {
  await mockBotPage(page, {}, "ready");
  await mockSite(page);
  await page.goto(`${SITE}/`);
  const bubble = page.getByRole("button", { name: "Ask us" });
  await expect(bubble).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("widget-closed.png");

  await bubble.click();
  const frame = page.frameLocator('iframe[title="Chat with Sunrise Mind"]');
  // No cover in the widget: straight to the chat.
  const box = frame.getByLabel("Your message");
  await expect(box).toBeVisible();
  await box.fill("What are your fees?");
  await box.press("Enter");
  await expect(frame.getByText("Individual sessions are ₹2,000")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Talk to a person" })).toBeVisible();
  await expect(page).toHaveScreenshot("widget-open.png");
  await expectNoSeriousA11yIssues(page);

  await frame.getByRole("button", { name: "Talk to a person" }).click();
  await expect(frame.getByText("I've asked the team to join.")).toBeVisible();

  await frame.getByRole("button", { name: "Close" }).click();
  await expect(page.locator('iframe[title="Chat with Sunrise Mind"]')).toBeHidden();
  await expect(bubble).toHaveAttribute("aria-expanded", "false");
});

test("an unlisted website gets no bubble", async ({ page }) => {
  await mockBotPage(page, {}, "ready");
  await mockSite(page, false);
  await page.goto(`${SITE}/`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Ask us" })).toHaveCount(0);
  await expect(page.locator("[data-ally-widget]")).toHaveCount(0);
});
