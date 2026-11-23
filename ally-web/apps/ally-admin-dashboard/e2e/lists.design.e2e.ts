import { expect, test } from "@playwright/test";
import path from "path";

import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";
import { mockLists } from "./lists.fixture";

import type { Page } from "@playwright/test";

/**
 * Lists' design review shots (chunk 5b, the stop before building the rest). Not a baseline: it
 * writes PNGs to docs/agents-v2/design/5b/ when LISTS_DESIGN_SHOTS is set, at both widths.
 *   LISTS_DESIGN_SHOTS=1 npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts lists.design
 */
test.skip(!process.env.LISTS_DESIGN_SHOTS, "design shots only on request");

const OUT = path.resolve(__dirname, "../../../../docs/agents-v2/design/5b");

/** `fullPage` for short pages; long ones shoot the section itself (the header is sticky). */
/** No sideways scroll on any Lists screen: the page is never wider than the window. */
export const noSideScroll = async (page: Page, name: string) => {
  const { scroll, inner, wide } = await page.evaluate(() => {
    const inner = window.innerWidth;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter(el => el.getBoundingClientRect().right > inner + 1)
      .filter(el => !el.closest(".ally-home__nav, .ally-lists__tabs, .ally-lists__table-wrap"))
      .slice(0, 5)
      .map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    return { scroll: document.documentElement.scrollWidth, inner, wide };
  });
  expect(
    scroll,
    `${name}: page is ${scroll}px wide in ${inner}px (${wide.join(", ")})`,
  ).toBeLessThanOrEqual(inner);
};

const shot = async (page: Page, name: string, project: string, fullPage = true) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await noSideScroll(page, name);
  const file = `${OUT}/${name}-${project}.png`;
  // The home's header and left list are sticky: a full-page capture stitches them in partway down
  // the image. Unstick them for the capture only; the page itself is unchanged.
  await page.screenshot({
    path: file,
    fullPage,
    style: ".ally-home__top, .ally-home__nav ul { position: static !important; }",
  });
};

const open = async (page: Page) => {
  await page.goto(`/dev/assistant-home/${BOT_ID}?section=lists`);
  await expect(page.getByTestId("section-lists")).toBeVisible();
};

test("empty, ready-made picker and the guided setup", async ({ page }, info) => {
  const p = info.project.name;
  await mockAssistantHome(page);
  await mockLists(page, { start: "empty" });
  await open(page);
  await expect(page.getByTestId("lists-empty")).toBeVisible();
  await shot(page, "01-empty", p);

  await page
    .getByRole("button", { name: /Start from a ready-made list/ })
    .first()
    .click();
  await expect(page.getByTestId("ready-made-setup")).toBeVisible();
  await shot(page, "02-picker", p);

  await page.getByRole("button", { name: "Use this list: Appointments" }).click();
  await expect(page.getByText(/Make Appointments yours/)).toBeVisible();
  await shot(page, "03-setup-yours", p, false);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("repeat-weekly")).toBeVisible();
  await expect(page.getByTestId("repeat-count")).toContainText("This adds");
  await shot(page, "04-setup-times", p);

  await page.getByRole("button", { name: "Add them" }).click();
  await expect(page.getByTestId("list-abilities")).toBeVisible();
  await shot(page, "05-setup-assistant", p);

  await page.getByRole("button", { name: "Next" }).click();
  await shot(page, "06-setup-try", p, false);
});

test("a list with entries, its form, details, rules and abilities", async ({ page }, info) => {
  const p = info.project.name;
  await mockAssistantHome(page);
  await mockLists(page, { start: "booked", otherBots: true });
  await open(page);
  await page.getByRole("tab", { name: /Appointments/ }).click();
  await expect(page.getByTestId("list-entries")).toBeVisible();
  await shot(page, "07-table", p);

  if (p === "phone") {
    await page.locator(".ally-lists__card").nth(1).click();
  } else {
    await page
      .getByRole("button", { name: /^Edit / })
      .nth(1)
      .click();
  }
  await expect(page.getByTestId("entry-form")).toBeVisible();
  await shot(page, "08-entry-form", p, false);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Details", exact: false }).first().click();
  await shot(page, "09-details", p);
  await page.getByRole("button", { name: "Details", exact: false }).first().click();

  await page.getByTestId("list-rules").getByRole("button").first().click();
  await page.getByRole("button", { name: /Add a rule/ }).click();
  await shot(page, "10-rules", p);
  await page.getByTestId("list-rules").getByRole("button").first().click();

  await page.getByTestId("list-assistant").getByRole("button").first().click();
  await shot(page, "11-assistant", p);

  await page.getByRole("tab", { name: /Slots/ }).click();
  await page.getByRole("button", { name: "Repeat weekly" }).first().click();
  await expect(page.getByTestId("repeat-count")).toContainText("This adds");
  await shot(page, "12-repeat", p, false);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Switch assistant" }).click();
  await shot(page, "13-switcher", p, false);
});

test("states: refusal at its field, no matches, a slot in use, loading error", async ({
  page,
}, info) => {
  const p = info.project.name;
  await mockAssistantHome(page);
  await mockLists(page, { start: "booked" });
  await open(page);
  await page.getByRole("tab", { name: /Appointments/ }).click();
  await page.getByRole("button", { name: "Add an entry" }).click();
  await page.getByLabel(/^Slot/).click();
  await page.getByRole("option").nth(3).click();
  await page.getByRole("button", { name: "Add it" }).click();
  await shot(page, "14-refusal", p, false);
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: /Slots/ }).click();
  await page.getByPlaceholder(/Search Slots/).fill("Dr Nobody");
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await shot(page, "15-no-match", p, false);
});

test("loading failed", async ({ page }, info) => {
  await mockAssistantHome(page);
  await mockLists(page, { start: "booked", failEntries: true });
  await open(page);
  await expect(page.getByText("We couldn't load these entries.")).toBeVisible();
  await shot(page, "16-error", info.project.name, false);
});
