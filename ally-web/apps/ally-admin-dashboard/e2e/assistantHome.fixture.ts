import { CHECKUP_RUN } from "./onboarding.mocks";

import type { Page, Route } from "@playwright/test";

/** The assistant the home tests open (fictional Sunrise Mind, as the other fixtures). */
export const BOT_ID = "6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60";

const v = (n: number) => n.toString(16).padStart(16, "0");

export const CHATBOT = {
  id: BOT_ID,
  name: "Sunrise Mind",
  description: null,
  status: "live",
  accessMode: "listed",
  answerMode: "documents_only",
  knowledgeSource: "selected",
  persona: { displayName: "Asha", greeting: "Hi, I'm Asha from Sunrise Mind.", tone: "warm" },
  model: null,
  effectiveRuntime: "v2",
  myRole: "owner",
  connectors: [],
  documentCount: 6,
  readyDocumentCount: 6,
  audienceCount: 0,
  memberCount: 1,
  stats: {
    messages: 214,
    people: 38,
    answered: 181,
    declined: 12,
    openUnanswered: 3,
    lastMessageAt: "2026-11-08T17:20:00.000Z",
  },
  lastTestedAt: null,
  setupDraftId: null,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-08T09:00:00.000Z",
};

const PACK = {
  id: "mental_health",
  name: "Mental health safety",
  industryLabel: "mental health practices",
  always: ["Be warm and non-judgemental", "Suggest speaking to a therapist for anything personal"],
  never: ["Diagnose or suggest a condition", "Recommend or discuss medication"],
  atRisk: ["Share the crisis line and encourage reaching out now"],
};

export const HOME = {
  canEdit: true,
  fields: {
    name: { value: "Sunrise Mind", version: v(1) },
    assistantName: { value: "Asha", version: v(2) },
    introduction: { value: "Hi, I'm Asha from Sunrise Mind.", version: v(3) },
    tone: { value: "warm", version: v(4) },
    instructions: { value: "Answer questions about Sunrise Mind's services.", version: v(5) },
    declineText: {
      value: "I don't know that yet. Please call us on 98200 12345.",
      version: v(6),
    },
    disclaimer: {
      value:
        "This is an automated assistant. It is not a crisis service or medical advice: in an emergency, contact your local emergency number.",
      version: v(7),
    },
    crisisText: { value: "", version: v(8) },
    suggestedQuestions: {
      value: ["What are your fees?", "Who speaks Marathi?", "How do I book?"],
      version: v(9),
    },
    prechat: {
      value: [
        { id: "name", label: "What's your name?", type: "text", required: true },
        {
          id: "reason",
          label: "What brings you here?",
          type: "choice",
          required: false,
          options: ["Anxiety or stress", "Relationships", "Something else"],
        },
      ],
      version: v(10),
    },
    pageLimits: {
      value: { messagesPerVisitorPerHour: 30, maxMessageChars: 1000, dailyCapPerBot: 500 },
      version: v(11),
    },
    language: { value: "auto", version: v(12) },
    busyText: { value: "", version: v(13) },
    unknownNumberText: { value: "", version: v(14) },
    unsupportedMediaText: { value: "", version: v(15) },
    pageStatus: { value: "on", version: v(16) },
    pageAccess: { value: "invite", version: v(17) },
    avoidTopics: { value: ["Prices for other clinics"], version: v(18) },
  },
  safety: {
    pack: PACK,
    rules: [
      ...PACK.never.map((text, n) => ({ id: `pack-${n}`, text, fixed: true })),
      { id: "own-0", text: "Quote prices for group sessions", fixed: false },
    ],
    version: v(20),
  },
  facts: [
    {
      id: "f1",
      section: "services",
      text: "Individual sessions cost ₹2,000 for 50 minutes.",
      sourceUrl: "https://sunrisemind.example/fees",
      sourceTitle: "Fees",
      version: v(30),
    },
    {
      id: "f2",
      section: "services",
      text: "Couples sessions cost ₹2,500.",
      sourceUrl: "owner",
      byOwner: true,
      version: v(31),
      correction: {
        text: "Couples sessions cost ₹2,500.",
        originalText: "Couples sessions cost ₹2,200.",
        appliedTo: "page",
        documentId: "doc-fees",
        notesDocumentId: "doc-notes",
        pageHash: "a".repeat(64),
        at: "2026-11-08T10:00:00.000Z",
      },
    },
    {
      id: "f3",
      section: "hours",
      text: "Open Monday to Saturday, 9 am to 7 pm.",
      sourceUrl: "https://sunrisemind.example/contact",
      sourceTitle: "Contact",
      version: v(32),
    },
    {
      id: "f4",
      section: "team",
      text: "Dr Meera Kulkarni is a clinical psychologist who speaks Marathi and English.",
      sourceUrl: "https://sunrisemind.example/team",
      sourceTitle: "Our team",
      version: v(33),
    },
  ],
};

const PAGE_VIEW = {
  saved: true,
  status: "on",
  slug: "sunrise-mind",
  access: "invite",
  link: "http://localhost:8081/b/sunrise-mind",
  publicAllowed: false,
  live: { ok: true },
  settings: {
    branding: {
      logoUrl: null,
      accentColour: "#B5431F",
      title: "Sunrise Mind",
      subtitle: "Ask about fees, timings, our therapists and how to book.",
      assistantName: "Asha",
      avatarUrl: null,
      disclaimer: HOME.fields.disclaimer.value,
      footerLink: null,
    },
    brand: {
      logo: null,
      accent: "#B5431F",
      accentContrast: "#B5431F",
      headingStyle: "classic",
      theme: "light",
      coverImage: null,
      shareImage: null,
      landingImages: { hero: null, gallery: [] },
      peoplePhotos: {},
    },
    suggestedQuestions: HOME.fields.suggestedQuestions.value,
    prechat: HOME.fields.prechat.value,
    limits: HOME.fields.pageLimits.value,
    language: "auto",
  },
};

const DOCUMENTS = [
  { id: "doc-home", title: "Sunrise Mind", status: "indexed" },
  { id: "doc-fees", title: "Fees", status: "indexed" },
  { id: "doc-team", title: "Our team", status: "indexed" },
  { id: "doc-contact", title: "Contact", status: "indexed" },
  { id: "doc-notes", title: "Owner notes", status: "indexed" },
].map(d => ({
  ...d,
  isGlobal: false,
  archived: false,
  private: true,
  updatedAt: "2026-11-08T09:00:00.000Z",
}));

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Answers every API call the home makes, from the fixtures above. Field saves check the version
 * they were based on, as ally-be does, so a stale save gets a 409 with the current value.
 * `role` opens it as a viewer; `admin` as a platform admin.
 */
export async function mockAssistantHome(
  page: Page,
  options: { role?: "owner" | "viewer"; admin?: boolean } = {},
) {
  const home = structuredClone(HOME);
  home.canEdit = options.role !== "viewer";
  const bot = { ...CHATBOT, myRole: options.role ?? "owner" };
  const saves: { field: string; value: unknown; version: string }[] = [];

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, "");
    const method = request.method();
    const base = `/chatbots/${BOT_ID}`;

    if (path === "/chatbots")
      return json(route, { chatbots: [bot], canCreate: Boolean(options.admin) });
    if (path === base) return json(route, bot);
    if (path === `${base}/home` && method === "GET") return json(route, home);
    if (path === `${base}/home` && method === "PATCH") {
      const body = request.postDataJSON() as { field: string; value: unknown; version: string };
      saves.push(body);
      const current = (home.fields as Record<string, { value: unknown; version: string }>)[
        body.field
      ];
      if (current.version !== body.version) {
        return json(
          route,
          {
            errorCode: "stale",
            message: "This changed while you were editing. Here is what it says now.",
            details: { field: body.field, ...current },
          },
          409,
        );
      }
      const next = { value: body.value, version: v(1000 + saves.length) };
      (home.fields as Record<string, unknown>)[body.field] = next;
      return json(route, { field: body.field, ...next });
    }
    // Chunk 20a-2: the checkup, change by chat and the pages it learned from.
    if (path === `${base}/checkup`) {
      return json(route, {
        latest: CHECKUP_RUN,
        trend: [
          { at: "2026-11-08T10:00:00.000Z", accuracy: 60 },
          { at: "2026-11-09T10:00:00.000Z", accuracy: 75 },
          { at: "2026-11-10T10:00:00.000Z", accuracy: 80 },
        ],
        fallback: "Please call us on 98200 12345.",
        audience: "Clients",
      });
    }
    if (path === `${base}/changes`) {
      return json(route, [
        {
          id: "e-1",
          at: "2026-11-10T09:00:00.000Z",
          kind: "change",
          summary: "tone",
          undone: false,
        },
      ]);
    }
    if (path === `${base}/changes/propose` && method === "POST") {
      return json(route, {
        refused: false,
        message: "",
        changes: [{ field: "tone", before: "warm", after: "formal" }],
      });
    }
    if (path === `${base}/sources`) {
      return json(route, [
        {
          url: "https://sunrise.example/",
          title: "Sunrise Mind",
          details: 4,
          removed: false,
          eventId: null,
        },
        {
          url: "https://sunrise.example/fees",
          title: "Fees",
          details: 3,
          removed: false,
          eventId: null,
        },
        {
          url: "https://sunrise.example/blog/sleep",
          title: "Sleep and stress",
          details: 1,
          removed: true,
          eventId: "00000000-0000-4000-8000-000000000001",
        },
      ]);
    }
    if (path === `${base}/page`) return json(route, PAGE_VIEW);
    if (path === `${base}/page/access`) return json(route, { entries: [] });
    if (path === `${base}/images`) return json(route, []);
    if (path === `${base}/team-names`) return json(route, { names: ["Dr Meera Kulkarni"] });
    if (path === `${base}/documents`) return json(route, DOCUMENTS);
    if (path.startsWith(`${base}/documents/`)) {
      return json(route, {
        ...DOCUMENTS.find(d => path.endsWith(d.id)),
        sourceType: "paste",
        fileName: null,
        statusMessage: null,
        rawText: "We're closed on public holidays.",
      });
    }
    if (path === `${base}/members`) {
      return json(route, [
        {
          userId: 7,
          name: "Shehbaz",
          email: "s***@example.com",
          role: "owner",
          addedAt: "2026-11-01T09:00:00.000Z",
        },
      ]);
    }
    if (path === `${base}/audience`) return json(route, []);
    if (path.startsWith("/whatsapp/templates")) return json(route, { templates: [], count: 0 });
    if (path.startsWith("/whatsapp/unanswered")) return json(route, { questions: [], count: 0 });
    if (path === "/whatsapp/conversations/languages") return json(route, []);
    if (path.startsWith("/whatsapp/conversations"))
      return json(route, { conversations: [], count: 0 });
    if (path.startsWith("/knowledge-base/documents"))
      return json(route, { documents: [], count: 0 });
    return json(route, []);
  });
  return { saves, home };
}
