import { ASSISTANT_SEATS } from "./billing.fixture";
import { CHECKUP_RUN } from "./onboarding.mocks";

import type { Page, Route } from "@playwright/test";

/** The assistant the home tests open (fictional Sunrise Mind, as the other fixtures). */
export const BOT_ID = "6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60";
/** This chatbot's working copy (stage 3), which an editor's Build edits. */
const DRAFT_ID = "6f9c1a52-2222-4a8e-9a0c-1b2c3d4e5f60";

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
    handover: {
      value: {
        replyWithin: "a few hours",
        hours: { timeZone: "Asia/Kolkata", days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" },
        autoHandBackHours: 12,
        emailAfterMinutes: 15,
        showFirstName: true,
      },
      version: v(19),
    },
    // The website widget (chunk 13).
    widget: {
      value: {
        position: "right",
        label: "Ask us",
        autoOpenSeconds: null,
        showOnPhones: true,
        allowedDomains: ["sunrisemind.in"],
      },
      version: v(20),
    },
    // Who can message it on WhatsApp (chunk 20d-2).
    whatsappAccess: { value: "listed", version: v(21) },
    // Remember people between chats (chunk 8a): off, with a mental-health pack's defaults.
    memory: {
      value: {
        on: false,
        neverStore: [],
        defaults: [
          "Payment details",
          "Passwords and PINs",
          "ID numbers",
          "Symptoms",
          "Conditions",
          "Medicines",
          "Diagnoses",
        ],
      },
      version: v(22),
    },
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

const week = (over: Record<string, number | null> = {}) => ({
  conversations: 142,
  answers: 120,
  answeredWithSource: 109,
  declined: 12,
  wrongDeclineSuspected: 2,
  handedOver: 0,
  crisis: 1,
  thumbsUp: 18,
  thumbsDown: 2,
  answeredPct: 91,
  thumbsUpPct: 90,
  ...over,
});

/** The Overview's scorecard (chunk Q2a): a week against the one before. */
const SCORECARD = {
  thisWeek: week(),
  lastWeek: week({
    conversations: 118,
    answeredPct: 86,
    declined: 15,
    thumbsUpPct: 84,
    crisis: 0,
  }),
  trend: [82, 85, 88, 87, 90, 92, 91].map((answeredPct, i) => ({
    day: `2026-11-0${i + 3}`,
    answeredPct,
  })),
  unanswered: [
    { id: "00000000-0000-4000-8000-0000000000a1", question: "Do you take insurance?", at: "" },
    { id: "00000000-0000-4000-8000-0000000000a2", question: "Is there parking?", at: "" },
  ],
  thumbsDown: [
    {
      id: "00000000-0000-4000-8000-0000000000b1",
      reason: "wrong_info",
      note: "The fee went up last month",
      at: "",
      reply: "Individual sessions are ₹2,000 for 50 minutes.",
      question: "How much is a session?",
    },
  ],
  checkup: { passed: 18, total: 20, at: "2026-11-10T10:00:00.000Z" },
};

/** How it's doing (stage 7, `GET :id/home/overview`): counts only, small groups held back. */
const OVERVIEW = {
  range: 30,
  timeZone: "Asia/Kolkata",
  from: "2026-10-12",
  to: "2026-11-10",
  conversations: 412,
  people: 268,
  days: [
    ["2026-11-04", 22, 15],
    ["2026-11-05", 31, 19],
    ["2026-11-06", 18, 12],
    ["2026-11-07", 3, 3],
    ["2026-11-08", 27, 21],
    ["2026-11-09", 35, 24],
    ["2026-11-10", 29, 20],
  ].map(([day, conversations, people]) => ({
    day,
    conversations: (conversations as number) < 5 ? { lessThan: 5 } : conversations,
    people: (people as number) < 5 ? { lessThan: 5 } : people,
  })),
  answered: { share: 0.88, fewerThan5: false },
  handedToPerson: { count: 14, medianWaitMinutes: 42 },
  ratings: { up: 96, down: 11 },
  byChannel: [
    { key: "page", count: 301 },
    { key: "whatsapp", count: 111 },
  ],
  byLanguage: [
    { key: "en", count: 344 },
    { key: "hi", count: 68 },
  ],
  topUnanswered: [
    { kind: "question", text: "Do you take insurance?", count: 6 },
    { kind: "theme", theme: "no_hits", count: { lessThan: 5 } },
  ],
};

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
  const lists: Record<string, { items: Record<string, unknown>[]; version: string }> = {
    pageAccess: {
      items: [
        { id: "pa-1", kind: "email", value: "asha@example.com", label: "Asha" },
        { id: "pa-2", kind: "email", value: "ravi@example.com", label: null },
      ],
      version: v(1001),
    },
    audience: {
      items: [{ id: "au-1", kind: "phone", value: "+919820012345", label: "Front desk" }],
      version: v(1002),
    },
    team: {
      items: [
        { id: "7", userId: 7, name: "Shehbaz", email: "s***@example.com", role: "owner" },
        { id: "8", userId: 8, name: "Meera", email: "m***@example.com", role: "editor" },
      ],
      version: v(1003),
    },
    documents: { items: DOCUMENTS.map(d => ({ ...d })), version: v(1004) },
    quickReplies: {
      items: [
        {
          id: "qr-crisis",
          kind: "crisis",
          name: "Someone may be at risk",
          patterns: ["suicide", "kill myself"],
          responseText: "Please call Tele-MANAS on 14416, any time.",
          active: true,
          required: true,
          state: "default",
          defaultId: null,
          defaultResponseText: null,
        },
        {
          id: "qr-parking",
          kind: "faq",
          name: "Parking",
          patterns: ["parking", "park"],
          responseText: "There is parking behind the clinic.",
          active: true,
          required: false,
          state: "own",
          defaultId: null,
          defaultResponseText: null,
        },
      ],
      version: v(1005),
    },
  };

  // Stage 3: an editor's Build is the Create and Build screen on this chatbot's working copy.
  const f = home.fields;
  const workingCopy = {
    draftId: DRAFT_ID,
    chatbotId: BOT_ID,
    live: true,
    blank: false,
    touched: true,
    buildMode: "form" as string | null,
    template: null,
    settingsHash: v(4000),
    updatedAt: "2026-11-10T09:30:00.000Z",
    fields: {
      name: f.name,
      assistantName: f.assistantName,
      introduction: f.introduction,
      tone: f.tone,
      instructions: f.instructions,
      languages: { value: ["en", "hi"], version: v(4001) },
      suggestedQuestions: f.suggestedQuestions,
      declineText: f.declineText,
      extraNever: { value: [], version: v(4002) },
      ownerNotes: { value: "", version: v(4003) },
    } as Record<string, { value: unknown; version: string }>,
  };
  const drafts = `/bot-drafts/${DRAFT_ID}`;

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const method = request.method();
    const base = `/chatbots/${BOT_ID}`;

    if (path === `${base}/working-copy` || path === `${drafts}/working-copy`) {
      return json(route, workingCopy);
    }
    if (path === drafts) {
      return json(route, {
        id: DRAFT_ID,
        status: "active",
        version: 1,
        chatbotId: BOT_ID,
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
    if (path === `${drafts}/pending`) {
      return json(route, {
        live: true,
        changes: [],
        settingsHash: workingCopy.settingsHash,
        liveVersion: v(4100),
      });
    }
    if (path === `${drafts}/events`) {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ping\n\n" });
    }
    if (path === `${drafts}/sources`) {
      return json(route, {
        crawl: { status: "idle", domain: null, pagesRead: 0, failure: null },
        queue: [],
        pendingDocumentIds: [],
        live: true,
      });
    }
    if (path === `${drafts}/mode` && method !== "GET") {
      const body = request.postDataJSON() as { mode: string };
      workingCopy.buildMode = body.mode;
      return json(route, { mode: body.mode, touched: true });
    }
    // A form field: the working copy checks the version it was based on, as ally-be does.
    const draftField = new RegExp(`^${drafts}/fields/(\\w+)$`).exec(path);
    if (draftField && method === "PATCH") {
      const name = draftField[1];
      const body = request.postDataJSON() as { value: unknown; version: string };
      const current = workingCopy.fields[name];
      if (current && current.version !== body.version) {
        return json(
          route,
          {
            errorCode: "stale_field",
            message: "This changed while you were editing.",
            details: { field: name, ...current },
          },
          409,
        );
      }
      const next = { value: body.value, version: v(5000 + saves.length) };
      saves.push({ field: name, ...body });
      workingCopy.fields[name] = next;
      return json(route, {
        field: name,
        ...next,
        settingsHash: v(4200 + saves.length),
        staged: true,
      });
    }
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
    // Chunk Q2a: the live scorecard on the Overview.
    if (path === `${base}/scorecard`) return json(route, SCORECARD);
    // Stage 7: How it's doing on the Overview (counts only; groups under 5 held back).
    if (path === `${base}/home/overview`) {
      const range = Number(url.searchParams.get("range") ?? 30);
      return json(route, { ...OVERVIEW, range });
    }
    // CR1 Part C: Share → People's seats, and "This uses 2 of your 3 assistants".
    if (path === `${base}/seats` || path.startsWith(`${base}/seats/`)) {
      return json(route, { ...ASSISTANT_SEATS, chatbotId: BOT_ID });
    }
    // Chunk 20d-2: How it works (the runtime's text, here a short stand-in) and the History.
    if (path === `${base}/how-it-works`) {
      const parts = [
        { layer: "business", text: "# Who you are\nYou are Asha.\n", owner: true },
        { layer: "tone", text: "Your tone: warm.\n", owner: true },
        // Ally's layers arrive with no text (17 Nov 2026).
        { layer: "safety", text: "", owner: false },
        { layer: "base", text: "", owner: false },
      ];
      return json(route, {
        parts,
        search: { top_k: 8, max_passages: 5, min_similarity: 0.35, searches: 2, documents: 5 },
        purpose: "answer",
        safetyPack: "mental_health",
      });
    }
    if (path === `${base}/history`) {
      return json(route, {
        entries: [
          {
            id: "00000000-0000-4000-8000-0000000000e2",
            at: "2026-11-10T09:30:00.000Z",
            kind: "edit",
            origin: "hand",
            who: "Shehbaz",
            fields: [
              { field: "introduction", before: "Hi.", after: "Hi, I'm Asha from Sunrise Mind." },
            ],
            undone: false,
          },
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            at: "2026-11-10T09:00:00.000Z",
            kind: "change",
            origin: "panel",
            who: "Shehbaz",
            fields: [{ field: "tone", before: "formal", after: "warm" }],
            undone: false,
          },
        ],
      });
    }
    // Chunk 20d-2: the checkup's questions, each made from the run's results.
    if (path === `${base}/checkup/cases`) {
      return json(route, {
        cases: (
          CHECKUP_RUN.results as { caseId: string; question: string; safety?: boolean }[]
        ).map((r, n) => ({
          id: r.caseId,
          question: r.question,
          outcome: r.safety ? null : "answer",
          expect: "answer",
          facts: [],
          mustNot: [],
          mustPass: true,
          language: null,
          active: true,
          safety: Boolean(r.safety),
          badge: n === 0 ? "you" : "ally",
          addedFrom: null,
          source: { kind: "page" },
          version: v(3000 + n),
          history: [],
        })),
      });
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
      return json(route, {
        changes: [
          {
            id: "e-1",
            at: "2026-11-10T09:00:00.000Z",
            kind: "change",
            summary: "tone",
            undone: false,
          },
        ],
      });
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
    // Chunk 20d-2: the home's lists, each with its version.
    const listMatch = path.match(new RegExp(`^${base}/home/lists/(\\w+)$`));
    if (listMatch) {
      const name = listMatch[1] as keyof typeof lists;
      const current = lists[name];
      if (method === "PATCH") {
        const body = request.postDataJSON() as {
          op: string;
          id?: string;
          item?: Record<string, unknown>;
          version: string;
        };
        if (body.version !== current.version) {
          return json(
            route,
            {
              errorCode: "stale",
              message: "This changed while you were editing. Here is what it says now.",
              details: { list: name, ...current },
            },
            409,
          );
        }
        if (body.op === "remove") current.items = current.items.filter(i => i.id !== body.id);
        if (body.op === "add") {
          current.items = [
            ...current.items,
            { id: `added-${current.items.length + 1}`, label: null, ...body.item },
          ];
        }
        current.version = v(2000 + current.items.length);
      }
      return json(route, {
        list: name,
        ...current,
        yourOrganisation: { id: "tenant-1", name: "Sunrise Mind" },
      });
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
    // The staff Settings panel (CL1): the classic Settings tab, moved into the ··· menu.
    if (path === `${base}/settings`) {
      const defaults = {
        enabled: true,
        crisisClassifierEnabled: true,
        consentRequired: true,
        helplineNumbers: "",
        rateLimit: { perMinute: 6, perHour: 30, perDay: 100 },
        retrieval: { minSimilarity: 0.35, declineSimilarity: 0.42 },
        maxCitations: 3,
        conversationIdleMinutes: 1440,
      };
      return json(route, { chatbotId: BOT_ID, defaults, overrides: {}, effective: defaults });
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
    // Stage 6: this assistant's credit budget and per-person limits (Settings).
    if (path === `/me/credits/chatbots/${BOT_ID}/budget`) {
      return json(route, {
        chatbotId: BOT_ID,
        hasBudget: true,
        setAsideUsd: 10,
        spentUsd: 2.37,
        reservedUsd: 0.1,
        remainingUsd: 7.53,
        freeBalanceUsd: 4.5,
        reserveUsd: 1,
        userLimits: { dailyUsd: 0.5, weeklyUsd: null, monthlyUsd: 5 },
      });
    }
    // Stage 8: the owner's grant for Ally staff to read conversations, and who looked (Settings).
    if (path === `${base}/staff-access`) {
      return json(route, {
        grants: [
          {
            id: "00000000-0000-4000-8000-0000000000c1",
            grantedBy: 7,
            grantedByName: "Shehbaz",
            reason: "Checking a wrong answer",
            createdAt: "2026-11-01T09:00:00.000Z",
            expiresAt: "2026-11-02T09:00:00.000Z",
            revokedAt: null,
            status: "expired",
          },
        ],
      });
    }
    if (path === `${base}/staff-views`) {
      return json(route, {
        views: [
          {
            id: "00000000-0000-4000-8000-0000000000d1",
            at: "2026-11-01T10:15:00.000Z",
            staffUserId: 2,
            staffName: "Ally support",
            what: "setup",
            conversations: false,
            conversationId: null,
            route: "home",
          },
        ],
      });
    }
    // Stage 7: where the widget has loaded, and the page's own web address (Channels).
    if (path === `${base}/widget-sites`) {
      return json(route, {
        sites: [
          {
            host: "sunrisemind.example",
            firstSeen: "2026-11-02T09:00:00.000Z",
            lastSeen: "2026-11-10T09:00:00.000Z",
            loadCount: 182,
          },
        ],
      });
    }
    if (path === `${base}/page/domains`) return json(route, { domains: [] });
    if (path === "/whatsapp/numbers") return json(route, []);
    if (path === `${base}/audience`) return json(route, []);
    // All numbers on the Overview (CL1): the four analytics routes the classic usage tab read.
    if (path === "/whatsapp/analytics/overview") {
      return json(route, {
        inbound: 1240,
        outbound: 1212,
        uniqueContacts: 318,
        answered: 948,
        declined: 96,
        clarified: 41,
        crisis: 2,
        template: 120,
        errors: 3,
        rateLimited: 2,
        unidentified: 6,
        declineRate: 0.092,
        latencyP50Ms: 6400,
        latencyP95Ms: 14200,
      });
    }
    if (path === "/whatsapp/analytics/timeseries") {
      const days = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
      return json(
        route,
        days.flatMap((day, i) => [
          { bucket: `${day}T00:00:00.000Z`, handledBy: "rag", count: 22 + i * 4 },
          { bucket: `${day}T00:00:00.000Z`, handledBy: "declined", count: 3 + (i % 3) },
          { bucket: `${day}T00:00:00.000Z`, handledBy: "clarified", count: 1 + (i % 2) },
          { bucket: `${day}T00:00:00.000Z`, handledBy: "template", count: 4 },
        ]),
      );
    }
    if (path === "/whatsapp/analytics/languages") {
      return json(route, [
        { language: "English", total: 860, answered: 790, declined: 70, declineRate: 0.081 },
        { language: "Hindi", total: 170, answered: 150, declined: 20, declineRate: 0.118 },
        { language: "Marathi", total: 9, answered: 7, declined: 2, declineRate: null },
      ]);
    }
    if (path === "/whatsapp/analytics/corpus-coverage") {
      return json(route, {
        rows: [
          {
            documentId: "d1",
            title: "Fees and sessions",
            chunkCount: 6,
            citations: 212,
            isArchived: false,
          },
          { documentId: "d2", title: "Our team", chunkCount: 4, citations: 96, isArchived: false },
          {
            documentId: "d3",
            title: "Owner notes",
            chunkCount: 2,
            citations: 31,
            isArchived: false,
          },
          { documentId: "d4", title: "Careers", chunkCount: 3, citations: 0, isArchived: false },
        ],
        totalDocuments: 4,
        omittedDocuments: 0,
      });
    }
    if (path.startsWith("/whatsapp/templates")) return json(route, { templates: [], count: 0 });
    if (path.startsWith("/whatsapp/unanswered")) return json(route, { questions: [], count: 0 });
    if (path === "/whatsapp/conversations/languages") return json(route, []);
    if (path.startsWith("/whatsapp/conversations"))
      return json(route, { conversations: [], count: 0 });
    if (path.startsWith("/knowledge-base/documents"))
      return json(route, { documents: [], count: 0 });
    return json(route, []);
  });
  return { saves, home, workingCopy };
}
