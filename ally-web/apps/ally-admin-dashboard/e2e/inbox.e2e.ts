import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { BOT_ID } from "./assistantHome.fixture";
import { CHAT, mockInbox } from "./inbox.fixture";

/** The inbox (chunk 11a) from fixtures: the list, a chat, taking over. Baselines and axe. */
test("the inbox: Safety and Needs a person first, with unread counts", async ({ page }) => {
  await mockInbox(page);
  await page.goto("/dev/inbox");
  await expect(page.getByTestId("inbox-list")).toBeVisible();
  await expect(page.getByText("Needs a person · Asked for a person")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("inbox-list.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
});

// The dev route has no signed-in user, so after taking over the chat reads as held by its mocked
// holder; the "You're replying" banner and the reply box are covered by inbox.test.tsx.
test("a chat: take over, then who has it", async ({ page }) => {
  await mockInbox(page);
  await page.goto(`/dev/inbox?conversation=${CHAT}&bot=${BOT_ID}`);
  await expect(page.getByTestId("inbox-chat")).toBeVisible();
  await page.getByRole("button", { name: "Take over" }).click();
  await expect(page.getByText("Asha Rao is replying in this chat.")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("inbox-chat.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
});
