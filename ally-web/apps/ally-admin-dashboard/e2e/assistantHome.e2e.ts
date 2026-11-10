import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";
import { mockInbox } from "./inbox.fixture";

/** The assistant home (chunk 20d) from fixtures: every section's baseline, axe, Try it, saving. */
const SECTIONS = [
  "overview",
  "knows",
  "personality",
  "safety",
  "how",
  "page",
  "checkup",
  "conversations",
  "share",
];

const open = async (page: import("@playwright/test").Page, section: string) => {
  await page.goto(`/dev/assistant-home/${BOT_ID}?section=${section}`);
  await expect(page.getByTestId(`section-${section}`)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

test.describe("assistant home sections", () => {
  for (const section of SECTIONS) {
    test(`${section}: matches its baseline and has no serious a11y issues`, async ({ page }) => {
      // The Inbox section is this assistant's inbox (chunk 11a), so it needs the inbox's chats too.
      await (section === "conversations" ? mockInbox(page) : mockAssistantHome(page));
      await open(page, section);
      if (section === "conversations") await expect(page.getByTestId("inbox-list")).toBeVisible();
      if (section === "overview") await expect(page.getByTestId("share-qr")).toBeVisible();
      if (section === "page") await expect(page.getByTestId("phone-preview")).toBeVisible();
      await expect(page).toHaveScreenshot(`home-${section}.png`, { fullPage: true });
      await expectNoSeriousA11yIssues(page);
    });
  }
});

test("All numbers opens in place on the Overview", async ({ page }) => {
  await mockAssistantHome(page);
  await open(page, "overview");
  await page.getByRole("button", { name: "See all numbers" }).click();
  await expect(page.getByTestId("all-numbers")).toBeVisible();
  await expect(page.getByRole("img", { name: /8 Nov: \d+ replies/ })).toBeVisible();
  await expect(page).toHaveScreenshot("home-overview-all-numbers.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
});

test("change your assistant: a proposal as before and after", async ({ page }) => {
  await mockAssistantHome(page);
  await open(page, "overview");
  const panel = page.getByTestId("change-panel");
  // Open by default from 1600 px for an editor; a header button (a sheet) below that.
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Change your assistant" }).click();
  }
  await panel.getByRole("button", { name: "Make it more formal" }).click();
  await expect(page.getByTestId("change-proposal")).toBeVisible();
  await expect(page).toHaveScreenshot("home-change.png", { fullPage: true });
  await expectNoSeriousA11yIssues(page);
});

test("Try it draws the bot page chat in the page's brand", async ({ page }) => {
  await mockAssistantHome(page);
  await open(page, "personality");
  await page.getByRole("button", { name: "Try it" }).click();
  const panel = page.getByTestId("try-it");
  await expect(panel.getByText("What are your fees?")).toBeVisible();
  await expect(page).toHaveScreenshot("home-try-it.png");
  await expectNoSeriousA11yIssues(page);
});

test("a field changed in another tab shows that tab's value", async ({ page }) => {
  const { home } = await mockAssistantHome(page);
  await open(page, "personality");
  // Another tab saves first: the field's version moves on.
  home.fields.assistantName = { value: "Ravi", version: "ffffffffffffffff" };
  const name = page.getByLabel("Name", { exact: true });
  await name.fill("Meera");
  await name.blur();
  await expect(page.getByRole("alert")).toHaveText(
    "This changed while you were editing. Here is what it says now.",
  );
  await expect(name).toHaveValue("Ravi");
});

test("a viewer sees everything and can change nothing", async ({ page }) => {
  await mockAssistantHome(page, { role: "viewer" });
  await open(page, "personality");
  await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
  await expect(page.getByText("Changes save as you go")).toHaveCount(0);
});

// Chunk 20d-2: How it answers and Classic view are in the ··· menu, for Ally staff only.
test("only platform admins see How it answers and Classic view", async ({ page }) => {
  await mockAssistantHome(page);
  await open(page, "overview");
  await expect(page.getByRole("button", { name: "More" })).toHaveCount(
    (page.viewportSize()?.width ?? 1440) < 960 ? 1 : 0,
  );
  await expect(page.getByRole("link", { name: "Classic view" })).toHaveCount(0);
  await mockAssistantHome(page, { admin: true });
  await page.reload();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "How it answers" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Classic view" })).toBeVisible();
});

test("a question just added stays until it has words, then saves", async ({ page }) => {
  const { saves } = await mockAssistantHome(page);
  await open(page, "personality");
  await page.getByRole("button", { name: "Add a question" }).first().click();
  const added = page.getByRole("textbox", { name: "Suggested questions 4", exact: true });
  await expect(added).toBeFocused();
  await page.waitForTimeout(1500);
  await expect(added).toHaveValue("");
  expect(saves).toEqual([]);
  await added.fill("Do you see children?");
  await added.blur();
  await expect
    .poll(() => saves.at(-1)?.value)
    .toEqual([
      "What are your fees?",
      "Who speaks Marathi?",
      "How do I book?",
      "Do you see children?",
    ]);
  await expect(added).toHaveValue("Do you see children?");
});

test("a question before the chat stays until it has words", async ({ page }) => {
  const { saves } = await mockAssistantHome(page);
  await open(page, "page");
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("textbox", { name: "Question 3", exact: true })).toHaveValue("");
  expect(saves.filter(s => s.field === "prechat")).toEqual([]);
});
