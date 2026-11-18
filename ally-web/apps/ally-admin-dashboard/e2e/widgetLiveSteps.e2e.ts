import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { mockBotPage } from "./botPage.fixture";
import { BOOKED, slowStream } from "./liveSteps.fixture";
import { LOCAL_NETWORK_OFF, mockSite, SITE } from "./widget.fixture";

/** Chunk 6b, section E: the live steps inside the website widget (the bot page in a frame). */
test.use({ launchOptions: { args: [LOCAL_NETWORK_OFF] } });

test.describe("live steps in the bubble", () => {
  test("the same steps, card and quiet line inside the website widget", async ({ page }) => {
    await slowStream(
      page,
      [
        { event: "activity", data: { kind: "find", label: "Slots" }, after: 200 },
        {
          event: "activity",
          data: { kind: "create", label: "Thu 19 Nov 2026, 11:00" },
          after: 300,
        },
      ],
      BOOKED,
    );
    await mockBotPage(page, {}, "ready");
    await mockSite(page);
    await page.goto(`${SITE}/`);
    await page.getByRole("button", { name: "Ask us" }).click();
    const frame = page.frameLocator('iframe[title="Chat with Sunrise Mind"]');
    const box = frame.getByLabel("Your message");
    await box.fill("Book me Thursday at 11 please");
    await box.press("Enter");
    await expect(frame.getByTestId("live-step")).toHaveText("Booking Thu 19 Nov, 11:00…");
    await expect(page).toHaveScreenshot("widget-live-step.png");
    await page
      .frames()
      .find(f => f.url().includes("/b/sunrise-mind"))!
      .evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(frame.getByTestId("confirmation-card")).toBeVisible();
    await expect(frame.getByTestId("steps-done")).toBeVisible();
    await expect(page).toHaveScreenshot("widget-live-steps-done.png");
    await expectNoSeriousA11yIssues(page);
  });
});
