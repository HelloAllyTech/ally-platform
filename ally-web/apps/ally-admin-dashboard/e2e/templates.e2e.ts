import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";
import { mockLists } from "./lists.fixture";
import { mockOnboardingApi } from "./onboarding.mocks";
import CATALOGUE from "./templates.catalogue.json";

import type { Page, Route } from "@playwright/test";

/**
 * Use-case templates (T1), at 1440 and 390 (the two projects): the cards in setup (from nothing,
 * and after the site is read) and in Tools → Add from a template, with axe and no sideways scroll;
 * baselines for the cards, the questions and Tools' result. The catalogue is the one ally-be
 * served on the local stack (`templates.catalogue.json`).
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const RESULT = {
  template: { id: "clinic", name: "Clinic or doctor" },
  added: ["Slots", "Appointments"],
  skipped: ["Callback requests"],
  pack: { outcome: "kept", pack: "Mental health safety", asked: "Medical safety" },
  checkups: 7,
  examples: 0,
  channels: null,
};

/** Suggested for an assistant: the clinic first among the businesses. */
const SUGGESTED = {
  suggested: "clinic",
  groups: CATALOGUE.groups.map(group => ({
    ...group,
    templates: group.templates.map(t => ({ ...t, suggested: t.id === "clinic" })),
  })),
};

/** Registered after the screens' own mocks, so these answer first; anything else falls through. */
const mockTemplates = async (page: Page) => {
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, "");
    const method = route.request().method();
    if (path === "/assistant-templates") return json(route, CATALOGUE);
    if (path === "/bot-drafts/current") return json(route, { draft: null });
    if (path === `/chatbots/${BOT_ID}/templates` && method === "GET") return json(route, SUGGESTED);
    if (path === `/chatbots/${BOT_ID}/templates/origin`) {
      return json(route, {
        template: { id: "clinic", name: "Clinic or doctor" },
        examples_left: { total: 2, lists: [{ key: "price_list", name: "Price list", count: 2 }] },
      });
    }
    if (path.startsWith(`/chatbots/${BOT_ID}/templates/`) && method === "POST") {
      return json(route, RESULT);
    }
    return route.fallback();
  });
};

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

test.describe("Templates in setup", () => {
  test.beforeEach(async ({ page }) => {
    await mockOnboardingApi(page);
    await mockTemplates(page);
  });

  // Stage 3: "Pick a template" on a new chatbot is the Create and Build screen's now
  // (createBuild.e2e.ts); the old start screen's template cards are gone.

  test("after the site is read: a head start from a template", async ({ page }) => {
    await page.goto("/dev/onboarding?screen=learned&hold=1");
    await page
      .getByTestId("draft-template")
      .getByRole("button", { name: "Start from a template" })
      .click();
    await page.getByTestId("template-card-clinic").click();
    await page.getByTestId("template-set-up").click();
    await expect(page.getByTestId("template-result")).toContainText("Clinic or doctor");
    await check(page);
  });
});

test.describe("Templates in Tools", () => {
  test("Add from a template: the suggested one first, then what it added and kept", async ({
    page,
  }) => {
    await mockAssistantHome(page);
    await mockLists(page, { start: "empty" });
    await mockTemplates(page);
    await page.goto(`/dev/assistant-home/${BOT_ID}?section=knowledge&part=lists`);
    await expect(page.getByTestId("lists-empty")).toBeVisible();
    await page.getByTestId("lists-start-template").first().click();

    const businesses = page.getByTestId("template-group-businesses");
    await expect(businesses.locator(".ally-templates__name").first()).toHaveText(
      "Clinic or doctor",
    );
    await expect(page.getByTestId("template-card-clinic")).toContainText("Suggested for you");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("templates-tools-cards.png", { fullPage: true });
    await check(page);

    await page.getByTestId("template-card-clinic").click();
    await expect(
      page.getByText("This adds to your assistant. Nothing you already have is changed."),
    ).toBeVisible();
    await page.getByTestId("template-set-up").click();
    const result = page.getByTestId("template-result");
    await expect(result).toContainText("Added: Slots, Appointments.");
    await expect(result).toContainText(
      "You already have Callback requests, so we left it as it is.",
    );
    await expect(result).toContainText(
      "Your assistant already uses Mental health safety, which is stricter. We kept it.",
    );
    await expect(page).toHaveScreenshot("templates-tools-result.png");
    await check(page);
  });

  test("Overview says where it came from, and the examples to replace", async ({ page }) => {
    await mockAssistantHome(page);
    await mockTemplates(page);
    await page.goto(`/dev/assistant-home/${BOT_ID}?section=overview`);
    const origin = page.getByTestId("template-origin");
    await expect(origin).toContainText("Set up from: Clinic or doctor");
    await expect(origin).toContainText("2 example entries are still in Price list.");
    await check(page);
  });
});
