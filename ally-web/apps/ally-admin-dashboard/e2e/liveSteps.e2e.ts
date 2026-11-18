import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { mockBotPage } from "./botPage.fixture";
import { BOOKED, CRISIS, nextStep, release, slowStream } from "./liveSteps.fixture";

/**
 * Chunk 6b, section E: the assistant's live steps on the bot page, at 1440 and 390 (the two
 * projects). The message stream is replaced in the page by a slowed fake: its steps arrive on a
 * timer, and the reply waits until the test releases it, so each state can be looked at.
 */

async function openChat(page: Page) {
  await mockBotPage(page, {}, "ready");
  await page.goto("/b/sunrise-mind");
  await page.getByRole("button", { name: "Start" }).click();
  await page.evaluate(() => document.fonts.ready);
}

test.describe("live steps", () => {
  test("a booking: steps while it works, then what it did and its card", async ({ page }) => {
    await slowStream(
      page,
      [
        { event: "activity", data: { kind: "find", label: "Slots" }, after: 200 },
        {
          event: "activity",
          data: { kind: "create", label: "Thu 19 Nov 2026, 11:00" },
          held: true,
        },
      ],
      BOOKED,
    );
    await openChat(page);
    await page.getByLabel("Your message").fill("Book me Thursday at 11 please");
    await page.getByLabel("Your message").press("Enter");

    const step = page.getByTestId("live-step");
    await expect(step).toHaveText("Checking free times…");
    await expect(page).toHaveScreenshot("live-step-finding.png");
    await nextStep(page);
    await expect(step).toHaveText("Booking Thu 19 Nov, 11:00…");
    await expect(page).toHaveScreenshot("live-step-booking.png");
    await expectNoSeriousA11yIssues(page);

    await release(page);
    const done = page.getByTestId("steps-done");
    await expect(done).toHaveText(/Checked free times · Booked Thu 19 Nov, 11:00/);
    await expect(page.getByTestId("live-step")).toHaveCount(0);
    const card = page.getByTestId("confirmation-card");
    await expect(card).toContainText("Booked · Appointments");
    await expect(card).toContainText("Thu 19 Nov, 11:00");
    await expect(page).toHaveScreenshot("live-steps-done.png");
    await expectNoSeriousA11yIssues(page);

    await done.getByRole("button").click();
    await expect(done.getByRole("listitem")).toHaveCount(2);
    await expect(page).toHaveScreenshot("live-steps-open.png");
  });

  test("slow: still working on it after 12 s with nothing new", async ({ page }) => {
    await page.clock.install();
    await slowStream(page, [], BOOKED);
    await openChat(page);
    await page.getByLabel("Your message").fill("Book me Thursday at 11 please");
    await page.getByLabel("Your message").press("Enter");
    await expect(page.getByTestId("live-step")).toHaveText("Reading your message…");
    await page.clock.runFor(12_500);
    await expect(page.getByTestId("live-step")).toHaveText("Still working on it…");
  });

  test("a crisis reply arrives whole, with no steps and no card", async ({ page }) => {
    await slowStream(page, [], CRISIS);
    await openChat(page);
    await page.getByLabel("Your message").fill("I have crushing chest pain");
    await page.getByLabel("Your message").press("Enter");
    await release(page);
    await expect(page.getByText(/call 112 or an ambulance/)).toBeVisible();
    await expect(page.getByTestId("steps-done")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-card")).toHaveCount(0);
    await expect(page).toHaveScreenshot("live-steps-crisis.png");
    await expectNoSeriousA11yIssues(page);
  });
});
