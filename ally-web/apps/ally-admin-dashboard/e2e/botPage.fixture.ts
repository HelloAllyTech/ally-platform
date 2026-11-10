import type { Page, Route } from "@playwright/test";

/** A published page as ally-be's public API returns it (fictional Sunrise Mind). */
export const PAGE = {
  slug: "sunrise-mind",
  access: "invite",
  branding: {
    logoUrl: null,
    accentColour: "#B5431F",
    title: "Questions about therapy at Sunrise Mind?",
    subtitle:
      "Ask about fees, timings, our therapists and how to book. Answers come from our own information.",
    assistantName: "Sunrise Mind",
    avatarUrl: null,
    disclaimer:
      "An assistant, not a therapist. Not a crisis service: if you might be in danger, call 112.",
    footerLink: null,
    look: { headingStyle: "classic", theme: "light", accent: "#B5431F", logo: null, cover: null },
  },
  suggestedQuestions: ["What are your fees?", "Who speaks Marathi?", "How do I book?"],
  prechat: [
    { id: "name", label: "What's your name?", type: "text", required: true },
    {
      id: "reason",
      label: "What brings you here?",
      type: "choice",
      required: true,
      options: ["Anxiety or stress", "Relationships", "Something else"],
    },
  ],
  maxMessageChars: 1000,
  language: "en",
  turnstileSiteKey: null,
};

type Look = Partial<(typeof PAGE)["branding"]["look"]>;

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Mocks the page's public API. `state` picks where the visitor starts: the cover (asks for an
 * email), or signed in with the pre-chat done and a reply ready to stream.
 */
export async function mockBotPage(page: Page, look: Look = {}, state: "new" | "ready" = "new") {
  const body = {
    ...PAGE,
    branding: { ...PAGE.branding, look: { ...PAGE.branding.look, ...look } },
  };
  await page.route("**/api/v1/public/bots/sunrise-mind**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/public\/bots\/sunrise-mind/, "");
    if (path === "" || path === "/") return json(route, body);
    if (path === "/session") {
      return json(
        route,
        state === "ready"
          ? { state: "ready", intakeDone: true, signedInAs: "a***@example.com" }
          : { state: "needs_email", intakeDone: false, signedInAs: null },
      );
    }
    if (path === "/otp/verify")
      return json(route, { state: "ready", intakeDone: false, signedInAs: "a***@example.com" });
    if (path === "/intake") return json(route, { intakeDone: true });
    if (path.startsWith("/conversation"))
      return json(route, { conversationId: null, messages: [] });
    if (path === "/messages/m2/feedback") return json(route, { rating: "down" });
    if (path === "/messages/stream") {
      const final = {
        reply: "Individual sessions are ₹2,000 for 50 minutes, in person or online.",
        citations: [{ title: "Services and fees", url: "https://sunrisemind.example/services" }],
        messageId: "m2",
        conversationId: "c1",
        // "Was this helpful?" shows under it (chunk Q2a).
        rateable: true,
      };
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: status\ndata: {"code":"searching"}\n\nevent: final\ndata: ${JSON.stringify(final)}\n\n`,
      });
    }
    return json(route, {});
  });
}
