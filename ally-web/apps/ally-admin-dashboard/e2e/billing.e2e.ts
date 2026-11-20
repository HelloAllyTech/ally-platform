import { expect, test, type Page } from "@playwright/test";
import path from "path";

import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";
import { logIn, mockBilling } from "./billing.fixture";

/**
 * CR1: Ally admin → Models, → Costs and → Plans, a user's Spend and Plan, the owner's Plan and
 * usage, Share → People's seats and the publish limit, from fixtures, at 1440 and 390. Saves
 * full-page screenshots for the stop to docs/agents-v2/screenshots/cr1/ (as publishGate does for
 * its PR); no baselines are compared.
 */
const SHOTS = path.join(__dirname, "../../../../docs/agents-v2/screenshots/cr1");

const open = async (page: Page, url: string) => {
  await mockBilling(page);
  await page.goto(url);
  await logIn(page);
  await page.goto(url);
};

/**
 * The admin shell scrolls an inner container, so a full-page screenshot stops at the viewport.
 * Grow the viewport to the tallest scroller's content, let the layout (and the chart) settle,
 * then shoot; the viewport goes back after.
 */
const shoot = async (page: Page, name: string) => {
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const tallest = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollHeight,
      ...[...document.querySelectorAll("*")].map(el => {
        const node = el as HTMLElement;
        return node.scrollHeight > node.clientHeight + 1
          ? node.scrollHeight + node.getBoundingClientRect().top
          : 0;
      }),
    ),
  );
  await page.setViewportSize({ width: size.width, height: Math.ceil(tallest) + 40 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(SHOTS, `${name}-${size.width}.png`), fullPage: true });
  await page.setViewportSize(size);
};

/** One part of a page (a user's Spend, their Plan), with the viewport grown as `shoot` does. */
const shootPart = async (page: Page, testId: string, name: string) => {
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const tallest = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollHeight,
      ...[...document.querySelectorAll("*")].map(el => {
        const node = el as HTMLElement;
        return node.scrollHeight > node.clientHeight + 1
          ? node.scrollHeight + node.getBoundingClientRect().top
          : 0;
      }),
    ),
  );
  await page.setViewportSize({ width: size.width, height: Math.ceil(tallest) + 40 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.fonts.ready);
  await page
    .getByTestId(testId)
    .screenshot({ path: path.join(SHOTS, `${name}-${size.width}.png`) });
  await page.setViewportSize(size);
};

/** No page-level horizontal scroll: wide tables scroll inside their own box. */
const expectNoPageScrollX = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
};

test("Models: prices per million tokens, the unpriced banner and WhatsApp rates", async ({
  page,
}) => {
  await open(page, "/billing/models");
  const pageRoot = page.getByTestId("billing-models-page");
  await expect(pageRoot).toBeVisible();
  await expect(page.getByTestId("billing-unknown-models")).toContainText("gpt-5.1-mini");
  const table = page.getByTestId("billing-models-table");
  await expect(table.getByText("gpt-4.1-mini", { exact: true })).toBeVisible();
  await expect(table.getByText("$0.400").first()).toBeVisible();
  await expectNoPageScrollX(page);
  await shoot(page, "models");

  // A model with usage can't be deleted; the panel says to retire it instead.
  await table.getByText("gpt-4.1-mini", { exact: true }).click();
  await expect(page.getByTestId("billing-model-panel")).toBeVisible();
  await expect(page.getByTestId("billing-model-delete")).toBeDisabled();
  await page.getByRole("button", { name: "Close panel" }).click();

  await page.getByRole("button", { name: "WhatsApp rates" }).click();
  await expect(page.getByTestId("billing-whatsapp-table").getByText("$0.0118")).toBeVisible();
});

test("Costs: totals, the trend, breakdown, alerts, fixed costs and settings", async ({ page }) => {
  await open(page, "/billing/costs");
  await expect(page.getByTestId("billing-costs-page")).toBeVisible();
  await expect(page.getByTestId("cost-month-all-in")).toContainText("$263.75");
  await expect(page.getByTestId("billing-cost-alerts")).toContainText("Sunrise Mind");
  await expect(page.getByTestId("billing-cost-trend")).toBeVisible();
  await expect(page.getByTestId("billing-cost-breakdown")).toContainText("Calm Corner Clinic");
  await expect(page.getByTestId("billing-fixed-costs")).toContainText("Hetzner servers");
  const margins = page.getByTestId("billing-plan-margins");
  await expect(margins).toContainText("Pro");
  await expect(margins).toContainText("$256.40");
  await expectNoPageScrollX(page);
  await shoot(page, "costs");

  // An assistant's drill-down links its conversations to the Inbox.
  await page.getByRole("button", { name: "Sunrise Mind" }).click();
  const panel = page.getByTestId("billing-assistant-panel");
  await expect(panel).toContainText("Most expensive conversations");
  await expect(panel.getByRole("link", { name: "Open in Inbox" }).first()).toHaveAttribute(
    "href",
    /\/assistants\/bot-sunrise\?section=conversations&conversation=c-1$/,
  );
});

test("Plans: renewals due, plans and seat types with their limits and prices", async ({ page }) => {
  await open(page, "/billing/plans");
  await expect(page.getByTestId("billing-plans-page")).toBeVisible();
  await expect(page.getByTestId("billing-renewals-due")).toContainText(
    "dr.kulkarni@sunrise.example",
  );
  const plans = page.getByTestId("billing-plans-table");
  await expect(plans).toContainText("Free");
  // The cost cap per creator: Ally's guard, in dollars, on this screen only.
  await expect(plans).toContainText("Cost cap / creator / month");
  await expect(plans).toContainText("$120.00");
  await expect(plans).toContainText("No cap");
  await expect(plans).toContainText("$49.00");
  await expect(page.getByTestId("billing-seat-types-table")).toContainText("Premium");
  await expectNoPageScrollX(page);
  await shoot(page, "plans");

  // Every change asks why: editing a plan, then saving, opens the note.
  await plans.getByText("Pro", { exact: true }).click();
  await expect(page.getByTestId("billing-plan-panel")).toBeVisible();
  await page.getByTestId("billing-plan-save").click();
  await expect(page.getByTestId("billing-note")).toBeVisible();
});

test("a custom login's Spend and Plan", async ({ page }) => {
  await open(page, "/user-management?tab=custom-logins");
  await page.getByTestId("custom-login-row").first().click();
  await expect(page.getByTestId("custom-login-detail")).toBeVisible();
  const spend = page.getByTestId("user-spend-section");
  await expect(spend.getByTestId("spend-used")).toContainText("$2.37");
  await expect(spend.getByTestId("spend-cap")).toContainText("$10.00");
  await expect(spend).toContainText("Sunrise Mind");
  const plan = page.getByTestId("user-plan-section");
  await expect(plan.getByTestId("user-plan-line")).toContainText(
    "Free · 2 of 3 assistants published",
  );
  await expect(plan.getByTestId("user-plan-assistant").first()).toContainText("Premium");
  await expectNoPageScrollX(page);
  await shootPart(page, "user-spend-section", "user-spend");
  await shootPart(page, "user-plan-section", "user-plan");
});

test("the owner's Plan and usage: counts and bars, never dollars", async ({ page }) => {
  await open(page, "/account/plan");
  const body = page.getByTestId("my-plan");
  await expect(body.getByTestId("plan-line")).toContainText("Free · 2 of 3 assistants published");
  await expect(body.getByTestId("plan-tokens")).toHaveCount(0);
  await expect(body).not.toContainText(/tokens/i);
  await expect(body).toContainText("Basic · 500 messages a month");
  await expect(body.getByTestId("plan-alerts")).toContainText("84% used");
  await expect(body).not.toContainText("$");
  await expectNoPageScrollX(page);
  await shoot(page, "my-plan");
});

test("Share → People: the seats, who holds each, and Give them a seat", async ({ page }) => {
  await mockAssistantHome(page);
  await page.goto(`/dev/assistant-home/${BOT_ID}?section=share`);
  const seats = page.getByTestId("share-seats");
  await expect(seats).toBeVisible();
  await expect(seats.getByTestId("seat-summary")).toContainText("5 included · 2 extra Premium");
  await expect(seats.getByTestId("give-seat")).toBeVisible();
  await expect(seats).not.toContainText("$");
  await expectNoPageScrollX(page);
  await shoot(page, "share-people");
});

test("Publish: the plan has no room, so publishing waits", async ({ page }) => {
  await page.route("**/api/v1/chatbots/*/publish-use", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        planName: "Free",
        maxPublished: 3,
        published: 3,
        wouldUse: 4,
        canPublish: false,
        message: "Free publishes up to 3 assistants. Ask Ally about Pro.",
      }),
    }),
  );
  await page.goto("/dev/onboarding?screen=share");
  await expect(page.getByTestId("publish-limit")).toContainText("Ask Ally about Pro");
  await expectNoPageScrollX(page);
  await shoot(page, "publish-limit");
});
