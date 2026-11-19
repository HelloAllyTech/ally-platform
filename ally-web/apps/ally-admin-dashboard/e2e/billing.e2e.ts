import { expect, test, type Page } from "@playwright/test";
import path from "path";

import { logIn, mockBilling } from "./billing.fixture";

/**
 * CR1 Part A: Ally admin → Models and → Costs from fixtures, at 1440 and 390. Saves full-page
 * screenshots for the plan stop to docs/agents-v2/screenshots/cr1/ (as publishGate does for its
 * PR); no baselines are compared.
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
  await expect(page.getByTestId("billing-plans-placeholder")).toBeVisible();
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
