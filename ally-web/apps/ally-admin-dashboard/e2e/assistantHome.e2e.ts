import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";
import { mockInbox } from "./inbox.fixture";
import { mockLists } from "./lists.fixture";

/** The assistant home (chunk 20d) from fixtures: every section's baseline, axe, Try it, saving. */
// Stage 2: six sections replace the ten. Build and Knowledge have two parts each (`part`).
// Screenshot baselines are named after these ids and must be regenerated (`--update-snapshots`).
const SECTIONS = [
  "overview",
  "build",
  "build-checkup",
  "conversations",
  "channels",
  "knowledge",
  "knowledge-lists",
  "settings",
];

/** "build-checkup" is the Build section's Check-up part. */
const split = (id: string): { section: string; part?: string } => {
  const [section, part] = id.split("-");
  return { section, part };
};

const open = async (page: import("@playwright/test").Page, id: string) => {
  const { section, part } = split(id);
  await page.goto(`/dev/assistant-home/${BOT_ID}?section=${section}${part ? `&part=${part}` : ""}`);
  await expect(page.getByTestId(`section-${section}`)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

test.describe("assistant home sections", () => {
  for (const section of SECTIONS) {
    test(`${section}: matches its baseline and has no serious a11y issues`, async ({ page }) => {
      // The Inbox section is this assistant's inbox (chunk 11a), so it needs the inbox's chats too.
      await (section === "conversations" ? mockInbox(page) : mockAssistantHome(page));
      // Lists (chunk 5b) answers from its own fixture, with Slots and Appointments.
      if (section === "knowledge-lists") await mockLists(page, { start: "booked" });
      await open(page, section);
      if (section === "conversations") await expect(page.getByTestId("inbox-list")).toBeVisible();
      // The link and QR code moved from Overview to Channels, with the page's phone preview.
      if (section === "channels") {
        await expect(page.getByTestId("share-qr")).toBeVisible();
        await expect(page.getByTestId("phone-preview")).toBeVisible();
      }
      await expect(page).toHaveScreenshot(`home-${section}.png`, { fullPage: true });
      await expectNoSeriousA11yIssues(page);
    });
  }
});

// Stage 7: the Overview is How it's doing (counts only); reply time, languages and document use
// ("See all numbers") are Ally staff's alone, so an owner never sees the button. The staff path is
// unit tested (Overview.test.tsx); this harness has no signed-in user.
test("the Overview shows how it's doing, and All numbers stays with Ally staff", async ({
  page,
}) => {
  await mockAssistantHome(page);
  await open(page, "overview");
  await expect(page.getByTestId("overview-doing")).toContainText("412");
  await expect(page.getByRole("button", { name: "See all numbers" })).toHaveCount(0);
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
  await open(page, "build");
  await page.getByRole("button", { name: "Try it" }).click();
  const panel = page.getByTestId("try-it");
  await expect(panel.getByText("What are your fees?")).toBeVisible();
  await expect(page).toHaveScreenshot("home-try-it.png");
  await expectNoSeriousA11yIssues(page);
});

// Stage 3: an editor's Build is the Create and Build form on the chatbot's working copy. A field
// another tab saved first is not applied; the typed text stays, and "Use theirs" shows what it says now.
test("a field changed in another tab keeps your text and offers theirs", async ({ page }) => {
  const { workingCopy } = await mockAssistantHome(page);
  await open(page, "build");
  const name = page.getByLabel("Name it uses in chat", { exact: true });
  // Wait until the form holds the working copy it will be compared against.
  await expect(name).toHaveValue("Asha");
  // Another tab saves first: the field's version moves on.
  workingCopy.fields.assistantName = { value: "Ravi", version: "ffffffffffffffff" };
  await name.fill("Meera");
  await name.blur();
  const stale = page.getByTestId("field-stale-assistantName");
  await expect(stale).toContainText("This changed somewhere else while you were typing.");
  await expect(name).toHaveValue("Meera");
  await stale.getByRole("button", { name: "Use theirs" }).click();
  await expect(name).toHaveValue("Ravi");
});

test("a viewer sees everything and can change nothing", async ({ page }) => {
  await mockAssistantHome(page, { role: "viewer" });
  await open(page, "build");
  await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
  await expect(page.getByText("Changes save as you go")).toHaveCount(0);
});

// Chunk 20d-2: How it answers is in the ··· menu. CL1 removed Classic view and put this assistant's
// own Settings beside it. Since A1 both are the owner's, not Ally staff's.
test("only owners see How it answers and Settings", async ({ page }) => {
  await mockAssistantHome(page, { role: "viewer" });
  await open(page, "overview");
  await expect(page.getByRole("button", { name: "More" })).toHaveCount(
    (page.viewportSize()?.width ?? 1440) < 960 ? 1 : 0,
  );
  await mockAssistantHome(page);
  await page.reload();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "How it answers" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Classic view" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});

// Suggested questions are one per line in the Build form: a blank line is never a question.
test("a blank suggested question is never saved, and the rest saves on leaving", async ({
  page,
}) => {
  const { saves } = await mockAssistantHome(page);
  await open(page, "build");
  const box = page.getByTestId("field-suggestedQuestions");
  await expect(box).toHaveValue("What are your fees?\nWho speaks Marathi?\nHow do I book?");
  await box.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  expect(saves.filter(s => s.field === "suggestedQuestions")).toEqual([]);
  await page.keyboard.type("Do you see children?");
  await box.blur();
  await expect
    .poll(() => saves.filter(s => s.field === "suggestedQuestions").at(-1)?.value)
    .toEqual([
      "What are your fees?",
      "Who speaks Marathi?",
      "How do I book?",
      "Do you see children?",
    ]);
});

test("a question before the chat stays until it has words", async ({ page }) => {
  const { saves } = await mockAssistantHome(page);
  await open(page, "channels");
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("textbox", { name: "Question 3", exact: true })).toHaveValue("");
  expect(saves.filter(s => s.field === "prechat")).toEqual([]);
});
