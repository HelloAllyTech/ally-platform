import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { mockBotPage } from "./botPage.fixture";

/**
 * BT1, act by tap, at 1440 and 390 (the two projects), light, axe clean: time chips, the card to
 * confirm, the done card with Cancel and Move, and Try it's "Test only, not saved". The message
 * stream is replaced in the page: each send gets the next reply in the queue, and the test reads
 * what each tap sent.
 */

const CHIPS = {
  reply: "These Bandra Sunday food drives have places on Sun 29 Nov:",
  citations: [],
  messageId: "m1",
  conversationId: "c1",
  parts: {
    choices: {
      list: "Food drives",
      options: ["10:00", "12:00", "13:00", "14:00"].map((t, i) => ({
        kind: "choose",
        label: `Sun 29 Nov · ${t}`,
        token: `chip-${i}`,
      })),
    },
  },
};

const CARD = (testOnly?: string) => ({
  reply:
    "Shall I register Priya Test for Bandra Sunday food drive on Sun 29 Nov 2026, 12:00 at Bandra West station (1 place)?",
  citations: [],
  messageId: "m2",
  conversationId: "c1",
  parts: {
    offer: {
      question: "Shall I register Priya Test for Bandra Sunday food drive?",
      action: "create",
      card: {
        list: "Registrations",
        title: "Sun 29 Nov 2026, 12:00",
        details: [
          { label: "Where", value: "Bandra West station, skywalk exit" },
          { label: "Places", value: "1" },
        ],
      },
      buttons: [
        { kind: "confirm", label: "Confirm", token: "confirm-1" },
        { kind: "change", label: "Change", token: "change-1" },
      ],
      ...(testOnly ? { testOnly } : {}),
    },
  },
});

const DONE = {
  reply: "Done: you're registered for Sun 29 Nov 2026, 12:00, Bandra West station, skywalk exit.",
  citations: [],
  messageId: "m3",
  conversationId: "c1",
  confirmation: {
    action: "create",
    list: "Registrations",
    title: "Sun 29 Nov 2026, 12:00",
    headline: "registered",
    details: [{ label: "Where", value: "Bandra West station, skywalk exit" }],
  },
  parts: {
    done: {
      buttons: [
        { kind: "cancel", label: "Cancel", token: "cancel-1" },
        { kind: "move", label: "Move", token: "move-1" },
      ],
    },
  },
};

/** Each send gets the next reply; what each send carried is kept on `window.__sent`. */
async function queueStream(page: Page, finals: unknown[]) {
  await page.addInitScript(
    ({ finals }) => {
      const realFetch = window.fetch.bind(window);
      const queue = [...finals];
      const sent: unknown[] = [];
      (window as unknown as { __sent: unknown[] }).__sent = sent;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (!url.includes("/messages/stream")) return realFetch(input, init);
        sent.push(JSON.parse(String(init?.body ?? "{}")));
        const final = queue.shift();
        const body = new TextEncoder().encode(
          `event: token\ndata: ${JSON.stringify({ text: (final as { reply: string }).reply })}\n\n` +
            `event: final\ndata: ${JSON.stringify(final)}\n\n`,
        );
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      };
    },
    { finals },
  );
}

const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);

async function openChat(page: Page) {
  await mockBotPage(page, {}, "ready");
  await page.goto("/b/sunrise-mind");
  await page.getByRole("button", { name: "Start" }).click();
  await page.evaluate(() => document.fonts.ready);
}

/** Screenshots for review, only when BT1_SHOTS names a folder (never compared, never committed). */
const shot = async (page: Page, name: string) => {
  const dir = process.env.BT1_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png` });
};

test.describe("act by tap", () => {
  test("a registration in 2 taps: a time chip, then Confirm; then Cancel and Move", async ({
    page,
  }) => {
    await queueStream(page, [CHIPS, CARD(), DONE]);
    await openChat(page);
    await page.getByLabel("Your message").fill("Which food drives can I join?");
    await page.getByLabel("Your message").press("Enter");

    const chips = page.getByRole("group", { name: "Food drives" });
    await expect(chips.getByRole("button")).toHaveCount(4);
    await shot(page, "1-time-chips");
    await expectNoSeriousA11yIssues(page);

    await chips.getByRole("button", { name: "Sun 29 Nov · 12:00" }).click();
    const card = page.getByTestId("offer-card");
    await expect(card).toContainText("Sun 29 Nov 2026, 12:00");
    await expect(card).toContainText("Bandra West station, skywalk exit");
    await expect(chips.getByRole("button").first()).toBeDisabled();
    await shot(page, "2-confirmation-card");
    await expectNoSeriousA11yIssues(page);

    await card.getByRole("button", { name: "Confirm" }).click();
    const done = page.getByTestId("confirmation-card");
    await expect(done).toContainText("Registered · Registrations");
    await expect(done.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await expect(done.getByRole("button", { name: "Move" })).toBeEnabled();
    await shot(page, "3-done-card-cancel-move");
    await expectNoSeriousA11yIssues(page);

    expect(await sent(page)).toEqual([
      { message: "Which food drives can I join?" },
      { message: "Sun 29 Nov · 12:00", action: "chip-1" },
      { message: "Confirm", action: "confirm-1" },
    ]);
  });

  test("Try it's cards say they are a test", async ({ page }) => {
    await queueStream(page, [CARD("Test only, not saved")]);
    await openChat(page);
    await page.getByLabel("Your message").fill("Register me for Sunday at 12");
    await page.getByLabel("Your message").press("Enter");
    await expect(page.getByTestId("test-only")).toHaveText("Test only, not saved");
    await shot(page, "4-test-only");
    await expectNoSeriousA11yIssues(page);
  });
});
