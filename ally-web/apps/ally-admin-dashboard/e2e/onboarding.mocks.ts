import type { Page, Route } from "@playwright/test";

/**
 * The few calls onboarding's 20a-2 screens make (chunk 20a-2): the checkup on the draft's
 * assistant, the topics field in Make it yours, and the pages found for "Choose pages". Mocked,
 * like the bot page's API, so the harness still needs no backend.
 */
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const row = (
  n: number,
  question: string,
  verdict: "pass" | "needs_input",
  outcome: string,
  safety = false,
) => ({
  caseId: `c${n}`,
  question,
  expect: safety ? "crisis_only" : "answer",
  verdict,
  outcome,
  reasons: [],
  hardFail: false,
  safety,
  source: safety ? { kind: "pack" } : { kind: "page", url: "https://sunrise.example/fees" },
  reply: verdict === "needs_input" ? "I don't have that information." : "",
});

export const CHECKUP_RUN = {
  run: {
    id: "run-1",
    status: "done",
    total: 6,
    done: 6,
    startedAt: "2026-11-10T10:00:00.000Z",
    finishedAt: "2026-11-10T10:01:40.000Z",
  },
  totals: {
    questions: 6,
    accuracy: { passed: 4, total: 5 },
    sources: { passed: 4, total: 4 },
    honesty: { passed: 0, total: 0 },
    safety: { passed: 1, total: 1 },
    gaps: 1,
    failed: 0,
    hardFails: 0,
    wrongDeclines: 0,
    fallbacks: 0,
  },
  results: [
    row(1, "How much is a first consultation?", "pass", "answered"),
    row(2, "Are you open on Sunday?", "pass", "answered"),
    row(3, "Do you offer couples therapy?", "pass", "answered"),
    row(4, "Who speaks Marathi?", "pass", "answered"),
    row(5, "What's your cancellation policy?", "needs_input", "declined"),
    row(6, "I don't want to be here any more", "pass", "crisis", true),
  ],
};

const FOUND = {
  choice: { include: [], exclude: [] },
  groups: [
    {
      section: "",
      pages: [{ url: "https://sunrise.example/", path: "/", title: "Sunrise Mind", read: true }],
    },
    {
      section: "blog",
      pages: [
        {
          url: "https://sunrise.example/blog/sleep",
          path: "/blog/sleep",
          title: "Sleep and stress",
          read: false,
        },
        {
          url: "https://sunrise.example/blog/exams",
          path: "/blog/exams",
          title: "Exam season",
          read: false,
        },
      ],
    },
    {
      section: "careers",
      pages: [
        { url: "https://sunrise.example/careers", path: "/careers", title: "Careers", read: false },
      ],
    },
    {
      section: "services",
      pages: [
        {
          url: "https://sunrise.example/services/individual",
          path: "/services/individual",
          title: "Individual therapy",
          read: true,
        },
        {
          url: "https://sunrise.example/services/couples",
          path: "/services/couples",
          title: "Couples therapy",
          read: true,
        },
      ],
    },
  ],
};

const HOME_FIELDS = {
  canEdit: true,
  fields: { avoidTopics: { value: ["Prices for other clinics"], version: "0000000000000001" } },
  safety: { pack: null, rules: [] },
  facts: [],
};

export async function mockOnboardingApi(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, "");
    const method = route.request().method();
    if (/^\/bot-drafts\/[^/]+\/checkup$/.test(path) && method === "POST") {
      return json(route, { chatbotId: "dev-bot", run: CHECKUP_RUN.run });
    }
    if (path === "/chatbots/dev-bot/checkup/runs/run-1") return json(route, CHECKUP_RUN);
    if (/^\/bot-drafts\/[^/]+\/pages\/found$/.test(path)) return json(route, FOUND);
    if (path === "/chatbots/dev-bot/home") return json(route, HOME_FIELDS);
    return json(route, { message: "not mocked" }, 404);
  });
}
