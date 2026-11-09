import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";

/** The assistant home (chunk 20d) from fixtures: every section's baseline, axe, Try it, saving. */
const SECTIONS = [
  "overview",
  "knows",
  "personality",
  "safety",
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
      await mockAssistantHome(page);
      await open(page, section);
      if (section === "overview") await expect(page.getByTestId("share-qr")).toBeVisible();
      if (section === "page") await expect(page.getByTestId("phone-preview")).toBeVisible();
      await expect(page).toHaveScreenshot(`home-${section}.png`, { fullPage: true });
      await expectNoSeriousA11yIssues(page);
    });
  }
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

test("only platform admins see the engine", async ({ page }) => {
  await mockAssistantHome(page);
  await open(page, "overview");
  await expect(page.getByRole("button", { name: "Engine" })).toHaveCount(0);
  await mockAssistantHome(page, { admin: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Engine" })).toBeVisible();
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
