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
  // Taking over renders new text; load both Plex Serif weights before the shot, or the button and
  // heading can be measured in the fallback face on some runs.
  await page.evaluate(async () => {
    await Promise.all(
      ["400 16px", "600 16px"].map(face => document.fonts.load(`${face} "IBM Plex Serif"`)),
    );
    await document.fonts.ready;
  });
  // The chat is a scroll container; taking over can nudge it by its own padding on some runs.
  await page.getByTestId("inbox-chat").evaluate(el => {
    el.scrollTop = 0;
  });
  await expect(page).toHaveScreenshot("inbox-chat.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
});

// What the assistant remembers (chunk 8a): beside the chat on a wide screen, a sheet on a phone.
test("what the assistant remembers: by section, with its source; forget a line", async ({
  page,
}, info) => {
  await mockInbox(page, { memory: true });
  await page.goto(`/dev/inbox?conversation=${CHAT}&bot=${BOT_ID}`);
  await expect(page.getByTestId("inbox-chat")).toBeVisible();
  const phone = info.project.name === "phone";
  if (phone) {
    await page
      .getByRole("button", { name: "What your assistant remembers about this person" })
      .click();
  }
  const panel = page.getByTestId("memory-panel").locator("visible=true");
  await expect(panel.getByText("prefers evenings")).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "What your assistant remembers about Asha" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("inbox-memory.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
  await panel.getByRole("button", { name: "Forget “prefers evenings”" }).click();
  await expect(panel.getByText("Forgotten.")).toBeVisible();
  await expect(panel.getByText("prefers evenings")).toHaveCount(0);
  // No sideways scroll at either width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
