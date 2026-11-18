import { expect, test } from "@playwright/test";
import path from "path";

import { COPY } from "../src/pages/Onboarding/copy";

/**
 * Q3-fast Part 3: publishing below the checkup's quality gate shows the score and asks "Publish
 * anyway" (dev harness, `?gate=below`). Saves the 1440 screenshot for the PR.
 */
test("publishing below the quality gate shows the score and Publish anyway", async ({
  page,
}, info) => {
  await page.goto("/dev/onboarding?screen=share&gate=below");
  const box = page.getByTestId("must-pass");
  await expect(box).toBeVisible();
  await expect(box).toContainText("8 of 14 questions need a fix");
  await expect(box.getByRole("button", { name: COPY.share.publishAnyway })).toBeVisible();
  await expect(box.getByText(COPY.share.goLiveAnyway)).toHaveCount(0);
  if (info.project.name === "desktop") {
    await page.screenshot({
      path: path.join(
        __dirname,
        "../../../../docs/agents-v2/evals/prod-17nov/runs/publish-gate-1440.png",
      ),
      fullPage: true,
    });
  }
});
