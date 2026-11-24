import { expect, test, type Page, type Route } from "@playwright/test";

import { expectNoSeriousA11yIssues } from "./a11y";
import { logIn, mockBilling } from "./billing.fixture";

/**
 * Stage 3, the Create and Build screen, from fixtures: `/assistants/new` creates a blank chatbot
 * (idempotent) and opens the split view at once, the test chatbot on the right and the start
 * options on the left; a template applies from its setup fields and opens the form; the form
 * applies as you leave a field. Replaces the SB1 `?split=1` spec. Signs in through the mocked OTP
 * flow (as billing.e2e does) and answers the bot-draft routes here; everything else falls through
 * to `mockBilling`. Not run in this change (no browser here): selectors follow the components.
 */
const SIZES = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x720", width: 1280, height: 720 },
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const field = (value: unknown, version: string) => ({ value, version });

const blankCopy = {
  draftId: "d1",
  chatbotId: "b1",
  live: false,
  blank: true,
  touched: false,
  buildMode: null as string | null,
  template: null as unknown,
  settingsHash: "h0",
  updatedAt: null,
  fields: {
    name: field("Your assistant", "n0"),
    assistantName: field("", "a0"),
    introduction: field("", "i0"),
    tone: field("warm", "t0"),
    instructions: field("", "s0"),
    languages: field(["en"], "l0"),
    suggestedQuestions: field([], "q0"),
    declineText: field("", "x0"),
    extraNever: field([], "r0"),
    ownerNotes: field("", "o0"),
  },
};

async function mockBuild(page: Page, state: { creates: number; edits: unknown[] }) {
  let copy = structuredClone(blankCopy);
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const method = request.method();
    if (path === "/authorization/permissions") {
      return json(route, ["system:access", "edit:whatsapp-bot", "view:whatsapp-bot"]);
    }
    // The create routes need the Chatbots feature as well as the edit grant.
    if (path === "/users/me/feature-toggles") return json(route, ["whatsapp_bot"]);
    if (path === "/bot-drafts" && method === "POST") {
      state.creates += 1;
      return json(route, {
        id: "d1",
        chatbotId: "b1",
        status: "active",
        blank: true,
        reused: state.creates > 1,
      });
    }
    if (path === "/bot-drafts/d1/working-copy") return json(route, copy);
    if (path === "/bot-drafts/d1/pending") {
      return json(route, {
        live: false,
        changes: [],
        settingsHash: copy.settingsHash,
        liveVersion: null,
      });
    }
    if (path === "/bot-drafts/d1/events") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ping\n\n" });
    }
    if (path === "/bot-drafts/d1/sources") {
      return json(route, {
        crawl: { status: "idle", domain: null, pagesRead: 0, failure: null },
        queue: [],
        pendingDocumentIds: [],
        live: false,
      });
    }
    if (path === "/bot-drafts/d1/mode") {
      const body = request.postDataJSON() as { mode: string };
      copy = { ...copy, buildMode: body.mode, touched: true };
      return json(route, { mode: body.mode, touched: true });
    }
    if (path === "/bot-templates") {
      return json(route, {
        templates: [
          {
            id: "lib-helpline-front-door",
            version: 1,
            name: "Helpline front door",
            oneLiner: "Answers first questions and points people to help",
            for: "helplines",
            tone: "warm",
            languages: ["en", "hi"],
            suggestedQuestions: ["When are you open?"],
            documents: [{ title: "Opening hours" }, { title: "Services" }],
            lists: [],
            fields: [
              { key: "name", label: "Your organisation’s name", kind: "text", required: true },
            ],
          },
        ],
      });
    }
    if (path === "/bot-drafts/d1/template") {
      copy = {
        ...copy,
        template: { id: "lib-helpline-front-door", version: 1, name: "Helpline front door" },
        fields: {
          ...copy.fields,
          name: field("Sunrise Helpline", "n1"),
          introduction: field("Hello, this is Sunrise Helpline.", "i1"),
          instructions: field("Answer from the documents.", "s1"),
        },
      };
      return json(route, {
        applied: true,
        template: copy.template,
        sourcesIndexing: 2,
        documents: ["k1", "k2"],
        workingCopy: copy,
      });
    }
    const fieldMatch = /^\/bot-drafts\/d1\/fields\/(\w+)$/.exec(path);
    if (fieldMatch && method === "PATCH") {
      const body = request.postDataJSON() as { value: unknown; version: string };
      state.edits.push({ field: fieldMatch[1], ...body });
      return json(route, {
        field: fieldMatch[1],
        value: body.value,
        version: `${body.version}+`,
        settingsHash: "h1",
        staged: false,
      });
    }
    if (path === "/bot-drafts/d1") {
      return json(route, {
        id: "d1",
        status: "active",
        version: 1,
        chatbotId: "b1",
        crawl: {
          status: "idle",
          domain: null,
          pagesRead: 0,
          pages: [],
          findings: [],
          problem: null,
        },
        learned: { facts: [], dropped: 0 },
        draft: { suggestedQuestions: [] },
      });
    }
    if (path === "/chatbots/b1/documents") return json(route, []);
    return route.fallback();
  });
}

for (const size of SIZES) {
  test.describe(`Create and Build at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("a blank chatbot opens the split view at once, and a template opens the form", async ({
      page,
    }) => {
      const state = { creates: 0, edits: [] as unknown[] };
      await mockBilling(page);
      await mockBuild(page, state);
      await page.goto("/assistants/new");
      await logIn(page);
      await page.goto("/assistants/new");

      await expect(page).toHaveURL(/\/assistants\/new\/d1$/);
      await expect(page.getByTestId("start-panel")).toBeVisible();
      await expect(page.getByTestId("pane").or(page.getByTestId("draft-test-pane"))).toBeVisible();
      await expect(page.getByRole("separator")).toBeVisible();

      await page.getByTestId("start-template").click();
      await page.getByTestId("template-lib-helpline-front-door").click();
      await page.getByLabel("Your organisation’s name").fill("Sunrise Helpline");
      await page.getByRole("button", { name: "Set it up" }).click();
      await expect(page.getByTestId("template-applied")).toContainText("2 sources");
      await expect(page.getByTestId("direct-form")).toBeVisible();
      await expect(page.getByTestId("mode-form")).toHaveAttribute("aria-pressed", "true");
      await expectNoSeriousA11yIssues(page);

      // The form applies as the builder leaves a field: no Save button.
      await page.getByTestId("field-instructions").fill("Answer briefly.");
      await page.getByTestId("field-name").click();
      await expect(page.getByText("Saved").first()).toBeVisible();
      expect(state.edits).toContainEqual({
        field: "instructions",
        value: "Answer briefly.",
        version: "s1",
      });

      // Copilot, then back to the form.
      await page.getByTestId("mode-copilot").click();
      await expect(page.getByTestId("copilot")).toBeVisible();
      await page.getByTestId("mode-form").click();
      await expect(page.getByTestId("direct-form")).toBeVisible();
    });
  });
}

test("below 1280px nothing is created and the laptop message shows", async ({ page }) => {
  const state = { creates: 0, edits: [] as unknown[] };
  await page.setViewportSize({ width: 1024, height: 768 });
  await mockBilling(page);
  await mockBuild(page, state);
  await page.goto("/assistants/new");
  await logIn(page);
  await page.goto("/assistants/new");
  await expect(page.getByTestId("create-narrow")).toBeVisible();
  expect(state.creates).toBe(0);
});
