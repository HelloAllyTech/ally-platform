import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";
import { mockLists } from "./lists.fixture";

import type { Page } from "@playwright/test";

/**
 * Lists (chunk 5b), at 1440 and 390 (the two projects): every screen and state with axe and no
 * sideways scroll; baselines for the empty state, the table, the entry form and the guided setup;
 * the assistant switcher keeping the section.
 */

const open = async (page: Page) => {
  await page.goto(`/dev/assistant-home/${BOT_ID}?section=lists`);
  await expect(page.getByTestId("section-lists")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

/** Every Lists screen fits the window: never a sideways scroll. */
const fits = async (page: Page) => {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(inner);
};

const check = async (page: Page) => {
  await fits(page);
  await expectNoSeriousA11yIssues(page);
};

test.describe("Lists", () => {
  test("the empty state, then the guided ready-made setup step by step", async ({ page }) => {
    await mockAssistantHome(page);
    await mockLists(page, { start: "empty" });
    await open(page);
    await expect(page.getByTestId("lists-empty")).toBeVisible();
    await expect(page).toHaveScreenshot("lists-empty.png", { fullPage: true });
    await check(page);

    await page
      .getByRole("button", { name: /Start from a ready-made list/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Start from a ready-made list" })).toBeVisible();
    await check(page);

    await page.getByRole("button", { name: "Use this list: Appointments" }).click();
    await expect(page.getByRole("heading", { name: "Make Appointments yours" })).toBeVisible();
    await expect(page).toHaveScreenshot("lists-setup-yours.png");
    await check(page);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("repeat-count")).toContainText("This adds");
    await check(page);
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByTestId("list-abilities")).toBeVisible();
    await check(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("button", { name: "Open Try it" })).toBeVisible();
    await check(page);
  });

  test("the table, its form, a refusal with free times, and the blocks", async ({ page }) => {
    await mockAssistantHome(page);
    await mockLists(page, { start: "booked" });
    await open(page);
    await page.getByRole("tab", { name: /Appointments/ }).click();
    await expect(page.getByText("By your assistant").first()).toBeVisible();
    await expect(page).toHaveScreenshot("lists-table.png", { fullPage: true });
    await check(page);

    await page.getByRole("button", { name: "Add an entry" }).click();
    const form = page.getByTestId("entry-form");
    await form.getByLabel(/^Slot/).click();
    await page.getByRole("option").nth(3).click();
    await form.getByRole("button", { name: "Add it" }).click();
    await expect(form.getByText("That slot is already taken.")).toBeVisible();
    await expect(form.getByText("Free nearby:")).toBeVisible();
    await expect(page).toHaveScreenshot("lists-refusal.png");
    await check(page);
    await form.getByRole("button", { name: /Mon 16 Nov, 15:00/ }).click();
    await expect(form.getByLabel(/^Slot/)).toHaveValue("Mon 16 Nov, 15:00");
    await page.keyboard.press("Escape");

    for (const block of ["list-details", "list-rules", "list-assistant"]) {
      await page.getByTestId(block).getByRole("button").first().click();
      await check(page);
    }
  });

  test("Repeat weekly sets the other details for each one", async ({ page }) => {
    await mockAssistantHome(page);
    await mockLists(page, { start: "booked" });
    await open(page);
    await page.getByRole("tab", { name: /Slots/ }).click();
    await page.getByRole("button", { name: "Repeat weekly" }).first().click();
    const repeat = page.getByTestId("repeat-weekly");
    await expect(repeat.getByText("For each one")).toBeVisible();
    await repeat.getByLabel("Practitioner").fill("Dr Mehta");
    await expect(page.getByTestId("repeat-count")).toContainText(
      "This adds 32 slots. 3 are already there, so they're skipped.",
    );
    await check(page);
  });

  test("a load error offers Try again", async ({ page }) => {
    await mockAssistantHome(page);
    await mockLists(page, { start: "booked", failEntries: true });
    await open(page);
    await expect(page.getByText("We couldn't load these entries.")).toBeVisible();
    await check(page);
  });

  test("switching assistant keeps you on Lists", async ({ page }) => {
    await mockAssistantHome(page);
    await mockLists(page, { start: "booked", otherBots: true });
    await open(page);
    await page.getByRole("button", { name: "Switch assistant" }).click();
    await expect(page.getByRole("menuitem", { name: /Glow Salon/ })).toBeVisible();
    await check(page);
    await page.getByRole("menuitem", { name: /Glow Salon/ }).click();
    await expect(page).toHaveURL(/\/dev\/assistant-home\/7a0d2b63-[^?]+\?section=lists$/);
  });
});
