import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";

import type { Page, Route } from "@playwright/test";

/** The inbox's API (chunk 11a), mocked like the assistant home's: no backend or login needed. */
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const CHAT = "00000000-0000-4000-8000-0000000000c1";
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 9, 10, minutes)).toISOString();

const ITEMS = [
  {
    id: "00000000-0000-4000-8000-0000000000c3",
    chatbotId: BOT_ID,
    assistant: "Sunrise Mind",
    channel: "whatsapp",
    visitor: "…3210",
    preview: "Please help, I feel unsafe",
    lastMessageAt: at(2),
    unread: 1,
    state: "assistant",
    needsPersonReason: null,
    heldBy: null,
    safety: true,
  },
  {
    id: CHAT,
    chatbotId: BOT_ID,
    assistant: "Sunrise Mind",
    channel: "web",
    visitor: "Asha",
    preview: "Can I talk to someone about couples therapy?",
    lastMessageAt: at(8),
    unread: 2,
    state: "needs_person",
    needsPersonReason: "asked",
    heldBy: null,
    safety: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000c2",
    chatbotId: BOT_ID,
    assistant: "Sunrise Mind",
    channel: "web",
    visitor: "Visitor",
    preview: "What are your fees?",
    lastMessageAt: at(5),
    unread: 0,
    state: "assistant",
    needsPersonReason: null,
    heldBy: null,
    safety: false,
  },
];

const THREAD = {
  ...ITEMS[1],
  intake: [
    { id: "q1", label: "Your name", value: "Asha" },
    { id: "q2", label: "What are you looking for?", value: "Couples therapy" },
  ],
  replyWindowClosesAt: null,
  messages: [
    {
      id: "m1",
      role: "user",
      text: "Do you offer couples therapy?",
      citations: [],
      handledBy: null,
      at: at(6),
      sentBy: null,
      rating: null,
      ratingReason: null,
    },
    {
      id: "m2",
      role: "assistant",
      text: "Yes. Couples sessions are 75 minutes with Sara Fernandes.",
      citations: [{ title: "Services and fees" }],
      handledBy: "rag",
      at: at(6),
      sentBy: null,
      rating: "up",
      ratingReason: null,
    },
    {
      id: "m3",
      role: "user",
      text: "Can I talk to someone about couples therapy?",
      citations: [],
      handledBy: null,
      at: at(8),
      sentBy: null,
      rating: null,
      ratingReason: null,
    },
    {
      id: "m4",
      role: "assistant",
      text: "I've asked the team to join. They usually reply within a few hours.",
      citations: [],
      handledBy: "handover",
      at: at(8),
      sentBy: null,
      rating: null,
      ratingReason: null,
    },
  ],
};

/** What the assistant remembers about Asha (chunk 8a). */
const MEMORY = {
  on: true,
  name: "Asha",
  beforeChat: [{ label: "What are you looking for?", value: "Couples therapy" }],
  summary: "She asked about couples sessions and their length.",
  neverStore: ["Payment details", "Passwords and PINs", "ID numbers", "Symptoms"],
  lines: [
    {
      id: "e2",
      section: "open_items",
      text: "waiting to hear about weekend couples sessions",
      saidAt: at(8),
      expiresAt: at(30),
      sourceKind: "person",
      sourceMessageId: "m3",
      sourceConversationId: CHAT,
    },
    {
      id: "e1",
      section: "preferences",
      text: "prefers evenings",
      saidAt: at(6),
      expiresAt: null,
      sourceKind: "person",
      sourceMessageId: "m1",
      sourceConversationId: CHAT,
    },
    {
      id: "e3",
      section: "context",
      text: "comes with her partner",
      saidAt: at(6),
      expiresAt: at(40),
      sourceKind: "owner",
      sourceMessageId: "m1",
      sourceConversationId: CHAT,
    },
  ],
};

export async function mockInbox(
  page: Page,
  options: { held?: boolean; memory?: boolean } = {},
): Promise<void> {
  await mockAssistantHome(page);
  let held = Boolean(options.held);
  let memory = MEMORY;
  await page.route("**/api/v1/inbox/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, "");
    const method = route.request().method();
    if (path === "/inbox/conversations") return json(route, ITEMS);
    if (path === "/inbox/counts") return json(route, { unread: 3, needsPerson: 1, safety: 1 });
    // The live stream: the hello snapshot, then nothing.
    if (path === "/inbox/events") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'event: hello\ndata: {"unread":3,"needsPerson":1,"safety":1}\n\n',
      });
    }
    if (path.endsWith("/take-over") && method === "POST") {
      held = true;
      return json(route, { ok: true });
    }
    if (path.endsWith("/memory") && method === "GET") return json(route, memory);
    if (path.endsWith("/forget") && method === "POST" && path.includes("/memory/")) {
      const id = path.split("/memory/")[1].replace("/forget", "");
      memory = { ...memory, lines: memory.lines.filter(l => l.id !== id) };
      return json(route, { forgotten: true });
    }
    if (path.endsWith(CHAT)) {
      const thread = options.memory ? { ...THREAD, contactId: "p1" } : THREAD;
      return json(
        route,
        held ? { ...thread, state: "held", heldBy: { id: 1, name: "Asha Rao" } } : thread,
      );
    }
    return json(route, {});
  });
}

export { CHAT };
