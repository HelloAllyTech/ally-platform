/**
 * A fixture backend for the guided journey, for building and checking the UI
 * before the runtime brain (plan step 1.1) streams real cards. DEV ONLY:
 * loaded by `GuidedCourseGate` when the URL has `?fixture=1` and
 * `import.meta.env.DEV` is true, and by tests.
 *
 * It wraps `window.fetch` and answers the guide's routes (and the few classic
 * course routes a card's player needs) from an in-memory thread that speaks
 * the wire contract: durable events get monotonic seqs, the SSE stream
 * replays after `Last-Event-ID`, pings every 15 s, and turns stream word by
 * word. Phrases in a message trigger the designed states:
 *   crisis-demo · care-demo · fail-demo · slow-demo · provider-demo ·
 *   other-tab-demo · closing-demo · practice-demo · quickcheck-demo ·
 *   reflection-demo · finale-demo (add "hushed" or "nomentor") · offline (use devtools)
 *
 * `?fixture=visitor` plays a signed-out visitor: the landing, an allowance of
 * four messages (the counter shows at two), the sign-in card when it runs
 * out, and "paused-demo" for paused anonymous chat.
 */
import {
  cardForItem,
  FIXTURE_ITEMS,
  FIXTURE_SECTIONS,
  fixturePublicOutline,
  fixtureStartPayload,
  fixtureTrackDetail,
} from "./fixtureCourse";

import type { GuideBootstrapWire } from "../contract/bootstrap";
import type {
  GuideAtmosphere,
  GuideCard,
  GuideCrisisState,
  GuideEvent,
  GuideMode,
  GuideAdviceLines,
  GuideMemoryView,
  GuideMicroActivityRequest,
  GuideMicroActivityResult,
  GuideSceneView,
  GuidePrefs,
  GuideTurnRequest,
} from "../contract/wire";

type Listener = (event: GuideEvent) => void;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sseFrame = (event: GuideEvent) =>
  `event: ${event.type}\n${event.durable ? `id: ${event.seq}\n` : ""}data: ${JSON.stringify(event)}\n\n`;

/** Draft crisis copy from the voice and tone guide (PENDING CLINICAL REVIEW); the real text comes from the server. */
const FIXTURE_CRISIS_TEXT =
  "I'm really glad you told me. What you're feeling matters, and you deserve support from a person right now. I'm an AI, so I can't give you the help you need, but the people at these numbers can, at any hour. If you're in immediate danger, please call 112.";

export interface FixtureOptions {
  /** Multiplies every delay; 0 makes the fixture synchronous-ish for tests. */
  delayScale?: number;
  /**
   * A signed-out visitor (M2): anonymous chat on, the public routes, an
   * allowance, and the claim when they sign in. The thread starts empty so
   * the landing shows; "paused-demo" pauses anonymous chat.
   */
  visitor?: boolean;
  /** Messages a visitor may send before sign-in (default 4, so the counter shows early). */
  allowance?: number;
  /** The visitor signs in to an account that can't take this course (claim refused, 403). */
  claimDenied?: boolean;
}

const VISITOR_TOKEN = "fx-visitor-token";

export class GuideFixtureServer {
  readonly threadId = "fx-thread";
  private seq = 0;
  private log: GuideEvent[] = [];
  private listeners = new Set<Listener>();
  private mode: GuideMode = "NORMAL";
  private crisis: GuideCrisisState | null = null;
  private atmosphere: GuideAtmosphere = "bright";
  private cards = new Map<string, GuideCard & { seq: number }>();
  private done = new Set<string>();
  private presented = 0;
  private sceneId: string | null = null;
  private turnCount = 0;
  private busy = false;
  private turnsByClientId = new Map<string, string>();
  /** M3 Shelf data: the learner's prefs, notebook and what Ally remembers. */
  private prefs: GuidePrefs & { challenge?: "normal" | "more" } = {
    guidance: "walk",
    voiceEnabled: true,
    sideQuests: true,
    memoryEnabled: true,
    outreach: "in_app",
    preferClassic: false,
  };
  private notebook = [
    {
      id: "fx-note-1",
      trackId: "",
      kind: "first_move",
      text: "I'd say: I'm glad you called. Take your time.",
      createdAt: "2026-10-20T10:00:00.000Z",
    },
    {
      id: "fx-note-2",
      trackId: "",
      kind: "noticing",
      text: "You waited before you spoke.",
      createdAt: "2026-10-21T10:00:00.000Z",
    },
  ];
  private memories: GuideMemoryView[] = [
    {
      id: "fx-mem-1",
      kind: "goal",
      body: "Wants to feel steadier on night shifts.",
      revision: 2,
      lastConfirmedAt: "2026-10-21T10:00:00.000Z",
      expiresAt: "2027-04-19T10:00:00.000Z",
      sources: [
        {
          messageId: "fx-src-1",
          threadId: "fx-thread",
          excerpt: "Night shifts are when I feel least sure of myself.",
          at: "2026-10-20T21:40:00.000Z",
        },
      ],
    },
    {
      id: "fx-mem-2",
      kind: "preference",
      body: "Likes short examples before the theory.",
      revision: 1,
      lastConfirmedAt: null,
      expiresAt: null,
      sources: [],
    },
  ];
  /** The mentor door: the learner's own line and the org's approved lines. */
  private advice: GuideAdviceLines = {
    lines: [
      "Let the silence sit longer than feels comfortable.",
      "Say your name first. It helps more than you think.",
    ],
    maxChars: 200,
  };
  readonly ratings = new Map<string, { rating: number; comment?: string }>();
  /** Side quests the fixture can mark: card id → the course's answers. */
  private practiceKeys = new Map<string, Record<string, string>>();
  readonly requests: Array<{ method: string; path: string; body: unknown }> = [];
  /** Visitor mode: whether the visitor has a thread yet, and what's left of the allowance. */
  private visitor: boolean;
  private visitorThread = false;
  private allowance: { remaining: number; limit: number };

  constructor(
    readonly trackId: string,
    private readonly options: FixtureOptions = {},
  ) {
    // Field initialisers can run before `trackId` is assigned: fill it in here.
    for (const entry of this.notebook) entry.trackId = trackId;
    this.visitor = Boolean(options.visitor);
    const limit = options.allowance ?? 4;
    this.allowance = { remaining: limit, limit };
    // A visitor arrives to an empty thread: the landing is the first screen.
    if (this.visitor) return;
    this.openScene(FIXTURE_SECTIONS[0].id);
    this.durable("assistant.message", {
      messageId: "fx-m0",
      turnId: "fx-u0",
      text: "Hi, I'm Ally, an AI guide. I'll walk this course with you, one step at a time. The first piece is short: how a call opens.",
      channel: "text",
    });
    this.present();
  }

  // ----------------------------------------------------------- events
  private base(durable: boolean) {
    return {
      v: 1 as const,
      seq: this.seq,
      threadId: this.threadId,
      at: new Date().toISOString(),
      durable,
    };
  }

  private durable(type: GuideEvent["type"], data: unknown): GuideEvent {
    this.seq += 1;
    const event = { ...this.base(true), type, data } as GuideEvent;
    this.log.push(event);
    this.listeners.forEach(listener => listener(event));
    return event;
  }

  private ephemeral(type: GuideEvent["type"], data: unknown): GuideEvent {
    const event = { ...this.base(false), type, data } as GuideEvent;
    this.listeners.forEach(listener => listener(event));
    return event;
  }

  private wait(ms: number) {
    const scaled = ms * (this.options.delayScale ?? 1);
    return scaled > 0 ? new Promise(resolve => setTimeout(resolve, scaled)) : Promise.resolve();
  }

  // ------------------------------------------------------------ course
  private openScene(sectionId: string) {
    const section = FIXTURE_SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    if (this.sceneId) {
      this.durable("scene.closed", {
        sceneId: this.sceneId,
        sectionId: this.sceneId.replace("scene-", ""),
        receipt: {
          behaviourLabels: ["Let the caller lead"],
          sideQuests: 1,
          noticing: "You waited before you spoke.",
        },
      });
    }
    this.sceneId = `scene-${sectionId}`;
    this.durable("scene.opened", {
      sceneId: this.sceneId,
      sectionId,
      title: section.title,
      stakes: section.stakes,
    });
  }

  private nextItem() {
    return FIXTURE_ITEMS[this.presented] ?? null;
  }

  private present(): GuideCard | null {
    const item = this.nextItem();
    if (!item) return null;
    if (`scene-${item.sectionId}` !== this.sceneId) this.openScene(item.sectionId);
    const card = cardForItem(item, `fx-card-${item.id}`);
    const event = this.durable("card.presented", { card });
    this.cards.set(card.cardId, { ...card, seq: event.seq });
    this.presented += 1;
    this.durable("spine.updated", {
      currentItemId: item.id,
      completedItems: this.done.size,
      totalItems: FIXTURE_ITEMS.length,
    });
    return card;
  }

  private nextStepData() {
    const item = this.nextItem();
    return item
      ? { hidden: false, itemId: item.id, title: item.title, minutes: item.minutes }
      : { hidden: true, itemId: null, title: null, minutes: null };
  }

  // ------------------------------------------------------------- turns
  private async streamReply(turnId: string, text: string, caption = "Looking at the course…") {
    const messageId = `fx-m-${turnId}`;
    this.ephemeral("presence", { state: "thinking", caption });
    this.ephemeral("tool.activity", { turnId, label: caption });
    await this.wait(700);
    this.ephemeral("presence", { state: "speaking", caption: null });
    const words = text.split(/(\s+)/);
    for (let i = 0; i < words.length; i += 4) {
      this.ephemeral("assistant.delta", {
        turnId,
        messageId,
        text: words.slice(i, i + 4).join(""),
      });
      await this.wait(45);
    }
    this.durable("assistant.message", { messageId, turnId, text, channel: "text" });
    this.ephemeral("presence", { state: "idle", caption: null });
  }

  private async runTurn(turnId: string, request: GuideTurnRequest) {
    const text = request.text ?? "";
    if (text) {
      this.durable("learner.message", {
        messageId: `fx-lm-${turnId}`,
        turnId,
        clientTurnId: request.clientTurnId,
        text,
        channel: "text",
        ...(request.anchor ? { anchor: request.anchor } : {}),
      });
    }
    this.ephemeral("turn.started", {
      turnId,
      trigger: request.intent ? "intent" : "learner_message",
    });
    const lower = text.toLowerCase();

    if (lower.includes("crisis-demo")) {
      this.mode = "CRISIS";
      this.atmosphere = "still";
      this.durable("mode.changed", { mode: "CRISIS", atmosphere: "still" });
      this.crisis = {
        messageId: `fx-crisis-${turnId}`,
        text: FIXTURE_CRISIS_TEXT,
        language: "en",
        lines: [],
      };
      this.durable("crisis.response", this.crisis);
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (this.mode === "CRISIS") {
      // "I'm safe right now" (intent `safe_now`) moves the thread to CARE; any
      // other words would go to the Sentinel, which the fixture doesn't model.
      this.crisis = null;
      this.mode = "CARE";
      this.atmosphere = "hushed";
      this.durable("mode.changed", { mode: "CARE", atmosphere: "hushed" });
      await this.streamReply(
        turnId,
        "Thank you for telling me. We can take this slowly. There's no rush to go on.",
        "…",
      );
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (lower.includes("care-demo")) {
      this.mode = "CARE";
      this.atmosphere = "hushed";
      this.durable("mode.changed", { mode: "CARE", atmosphere: "hushed" });
      this.ephemeral("next_step", { hidden: true, itemId: null, title: null, minutes: null });
      await this.streamReply(
        turnId,
        "That sounds like it's touching something close to home. We can stop the course here for now. Would it help to talk about it, take a few slow breaths together, or just sit for a minute?",
        "…",
      );
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (lower.includes("fail-demo")) {
      await this.wait(400);
      this.ephemeral("turn.failed", { turnId, code: "internal_error", message: "fixture failure" });
      return;
    }
    if (lower.includes("provider-demo")) {
      await this.wait(400);
      this.ephemeral("turn.failed", {
        turnId,
        code: "provider_unavailable",
        message: "fixture outage",
      });
      return;
    }
    if (lower.includes("other-tab-demo")) {
      this.ephemeral("turn.failed", {
        turnId,
        code: "turn_in_progress",
        message: "Ally is replying in another tab.",
      });
      return;
    }
    if (lower.includes("slow-demo")) {
      this.ephemeral("presence", { state: "thinking", caption: "Finding the right section…" });
      await this.wait(9000);
    }
    if (lower.includes("closing-demo")) {
      await this.streamReply(turnId, "Before you go, one thing I noticed today.");
      const card: GuideCard = {
        cardId: `fx-closing-${turnId}`,
        kind: "closing_ritual",
        presentation: "inline",
        state: "ready",
        title: "Before you go",
        payload: {
          noticing: "Today you stayed with a long silence instead of filling it.",
          watchFor: "when a caller says “fine”",
          teaser: "Meera calls back, and this time she says why.",
        },
      };
      const event = this.durable("card.presented", { card });
      this.cards.set(card.cardId, { ...card, seq: event.seq });
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (lower.includes("finale-demo")) {
      const hushed = lower.includes("hushed");
      await this.streamReply(
        turnId,
        "That's the whole course. Before you go, have a look at how far you've come.",
      );
      const card: GuideCard = {
        cardId: `fx-finale-${turnId}`,
        kind: "finale",
        presentation: "theatre",
        state: "ready",
        tone: hushed ? "quiet" : "festive",
        title: "Looking back on Answering the first call",
        cta: { label: "Open", action: "open" },
        payload: {
          hushed,
          firstMove: {
            text: "I'd ask for their name and what's wrong.",
            question: "Meera goes quiet. What do you say first?",
            invitation: "This is how you answered at the very start. How would you answer it now?",
          },
          possibleSelf: {
            text: "Someone callers trust in the first minute.",
            invitation: "You said this is the helper you want to become. Does it still fit?",
          },
          noticings: [
            "You waited before you spoke.",
            "You reflected her words back before offering anything.",
          ],
          doors: [
            {
              kind: "field_assignment",
              title: "Try it on your next shift",
              body: "On your next shift, watch for this: when a caller says “fine”. Afterwards, come back and tell me what happened.",
              available: true,
            },
            {
              kind: "spaced_recall",
              title: "A short look back in a week",
              body: "Three quick questions, seven days from now, to help what you learned stick.",
              suggestedAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              available: true,
            },
            {
              kind: "mentor",
              title: "Leave a line for the next learner",
              body: "What would you tell someone just starting this course?",
              maxChars: 200,
              // The fixture plays the server once advice lines are wired into the finale.
              available: !lower.includes("nomentor"),
            },
          ],
        },
      };
      const event = this.durable("card.presented", { card });
      this.cards.set(card.cardId, { ...card, seq: event.seq });
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (lower.includes("quickcheck-demo") || lower.includes("reflection-demo")) {
      const written = lower.includes("reflection-demo");
      await this.streamReply(turnId, "Want to try a quick one? It's optional.");
      const cardId = `fx-sq-${turnId}`;
      const activity = written
        ? {
            kind: "reflection",
            prompt: "When did a silence on a call feel hard to sit with?",
            placeholder: "A sentence or two is plenty.",
          }
        : {
            kind: "quick_check",
            intro: "Two questions on how a call opens.",
            questions: [
              {
                id: "q1",
                prompt: "The caller goes quiet. What comes first?",
                options: [
                  { id: "a", text: "Wait a little longer" },
                  { id: "b", text: "Ask if they're still there" },
                  { id: "c", text: "Fill the silence" },
                ],
              },
              {
                id: "q2",
                prompt: "What does a reflection do?",
                options: [
                  { id: "a", text: "Shows you heard them" },
                  { id: "b", text: "Fixes the problem" },
                ],
              },
            ],
          };
      if (!written) this.practiceKeys.set(cardId, { q1: "a", q2: "a" });
      // Like the server's: no trackItem on a side quest card.
      const card: GuideCard = {
        cardId,
        kind: "micro_activity",
        presentation: "inline",
        state: "ready",
        title: written ? "A moment to reflect" : "Opening a call",
        meta: { format: "practice" },
        cta: { label: "Try it", action: "open" },
        payload: { activity },
      };
      const event = this.durable("card.presented", { card });
      this.cards.set(card.cardId, { ...card, seq: event.seq });
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (lower.includes("practice-demo")) {
      await this.streamReply(
        turnId,
        "Want to try a quick one? It's optional and doesn't count toward the course.",
      );
      const card: GuideCard = {
        cardId: `fx-practice-${turnId}`,
        kind: "micro_activity",
        presentation: "inline",
        state: "ready",
        title: "What would you do?",
        meta: { minutes: 1, format: null },
        trackItem: { id: FIXTURE_ITEMS[0].id, type: "ARTICLE", title: FIXTURE_ITEMS[0].title },
        payload: {
          practiceKind: "What would you do?",
          prompt: "Meera goes quiet for ten seconds. What do you do?",
          options: ["Wait a little longer", "Ask if she's still there", "Fill the silence"],
        },
      };
      const event = this.durable("card.presented", { card });
      this.cards.set(card.cardId, { ...card, seq: event.seq });
      this.ephemeral("turn.completed", { turnId });
      return;
    }

    // A visitor's "Let's start" chip is words, not the start intent.
    if (request.intent === "continue" || request.intent === "start" || lower === "let's start") {
      const item = this.nextItem();
      if (!item) {
        await this.streamReply(
          turnId,
          "That's the whole course. The conversation stays open whenever you'd like to talk it over.",
        );
      } else {
        await this.streamReply(turnId, `Next: ${item.title}. ${item.framing}`);
        this.present();
      }
      this.ephemeral("next_step", this.nextStepData());
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (request.intent === "not_now") {
      await this.streamReply(turnId, "Okay. I'll be here when you're ready.");
      this.ephemeral("next_step", { ...this.nextStepData(), hidden: true });
      this.ephemeral("turn.completed", { turnId });
      return;
    }
    if (request.intent === "locked_peek") {
      const item = FIXTURE_ITEMS.find(i => i.id === request.anchor?.itemId);
      await this.streamReply(
        turnId,
        `${item ? `“${item.title}” comes later.` : "That one comes later."} The course sets the order, so let's finish what's in front of us first.`,
      );
      this.ephemeral("turn.completed", { turnId });
      return;
    }

    // "Ask about this": the answer names what was asked about.
    if (request.anchor?.itemId) {
      const anchor = request.anchor;
      const item = FIXTURE_ITEMS.find(i => i.id === anchor.itemId);
      const about = anchor.quote
        ? `On “${anchor.quote.slice(0, 60)}”: that's the caller testing whether it's safe to say more.`
        : typeof anchor.timestampSec === "number"
          ? `At that moment the counsellor waits, and it works because the caller fills the silence.`
          : `That's covered in “${item?.title ?? "the first article"}”. Have another look there.`;
      await this.streamReply(turnId, about);
      this.ephemeral("turn.completed", { turnId });
      return;
    }

    await this.streamReply(
      turnId,
      "Good question. The short answer: give the caller room first, then reflect what you hear. When you're ready, the next step is below.",
    );
    this.ephemeral("next_step", this.nextStepData());
    this.ephemeral("turn.completed", { turnId });
  }

  /** `POST threads/:id/micro-activities/:cardId/responses`: marked, or one note. */
  private answerPractice(cardId: string, body: GuideMicroActivityRequest): Response {
    const card = this.cards.get(cardId);
    if (!card || card.kind !== "micro_activity")
      return json({ message: "Practice not found" }, 404);
    if (card.state === "done") {
      return json({ statusCode: 400, message: "This practice is already done." }, 400);
    }
    const key = this.practiceKeys.get(cardId);
    const kind =
      (card.payload as { activity?: { kind?: string } } | undefined)?.activity?.kind ?? "";
    let result: GuideMicroActivityResult;
    if (key) {
      if (!body?.answers?.length)
        return json({ statusCode: 400, message: "Choose an answer first." }, 400);
      result = {
        cardId,
        kind,
        results: body.answers.map(answer => ({
          questionId: answer.questionId,
          correct: key[answer.questionId] === answer.optionId,
          correctOptionId: key[answer.questionId] ?? "",
          feedback:
            key[answer.questionId] === answer.optionId
              ? "Yes. Giving the silence room lets the caller choose what comes next."
              : "Most callers fill a silence themselves if you give it a few seconds.",
        })),
      };
    } else {
      if (!body?.text?.trim())
        return json({ statusCode: 400, message: "Write something first." }, 400);
      result = {
        cardId,
        kind,
        note: "Noticing that it felt hard is the first step; next time, count three breaths before you speak.",
      };
    }
    this.cards.set(cardId, { ...card, state: "done" });
    this.durable("card.updated", { cardId, state: "done" });
    return json(result, 201);
  }

  acceptTurn(request: GuideTurnRequest): Response {
    if (!request || typeof request.clientTurnId !== "string")
      return json({ message: "bad request" }, 400);
    if ((request.text ?? "").length > 2000) {
      return json(
        { statusCode: 400, message: "too long", errorCode: "GUIDE_MESSAGE_TOO_LONG" },
        400,
      );
    }
    const existing = this.turnsByClientId.get(request.clientTurnId);
    if (existing) return json({ turnId: existing }, 202);
    this.turnCount += 1;
    const turnId = `fx-u${this.turnCount}`;
    this.turnsByClientId.set(request.clientTurnId, turnId);
    if (this.busy) {
      setTimeout(
        () => this.ephemeral("turn.failed", { turnId, code: "turn_in_progress", message: "busy" }),
        0,
      );
      return json({ turnId }, 202);
    }
    this.busy = true;
    const visitor = this.visitor;
    setTimeout(() => {
      void this.runTurn(turnId, request).finally(() => {
        this.busy = false;
        // The visitor's counter, after every turn they take (plan §5.14).
        if (visitor && this.visitor) this.ephemeral("allowance", { ...this.allowance });
      });
    }, 0);
    return json({ turnId }, 202);
  }

  cardEvent(cardId: string, body: { type?: string }): Response {
    const card = this.cards.get(cardId);
    if (!card) return json({ message: "no card" }, 404);
    if (body.type === "completed_claim" && card.state !== "done") {
      const itemId = card.trackItem?.id;
      if (itemId && card.kind === "course_item") this.done.add(itemId);
      this.cards.set(cardId, { ...card, state: "done" });
      this.durable("card.updated", { cardId, state: "done", tone: card.tone ?? "quiet" });
      if (card.trackItem?.type === "JOURNAL") {
        this.durable("notebook.added", {
          entryId: `fx-n-${cardId}`,
          kind: "journal_line",
          text: "Your journal entry",
        });
      }
      if (card.trackItem?.type === "ROLEPLAY") {
        this.durable("milestone", {
          kind: "boss_complete",
          tone: "warm",
          label: "You stayed on the line.",
        });
      }
      const next = this.nextItem();
      this.durable("spine.updated", {
        currentItemId: next?.id ?? null,
        completedItems: this.done.size,
        totalItems: FIXTURE_ITEMS.length,
      });
      this.ephemeral("next_step", this.nextStepData());
    }
    if (body.type === "dismissed") {
      this.cards.set(cardId, { ...card, state: "dismissed" });
      this.durable("card.updated", { cardId, state: "dismissed" });
    }
    const updated = this.cards.get(cardId);
    return json(
      {
        cardId,
        state: updated?.state ?? card.state,
        ...(body.type === "completed_claim" ? { verified: updated?.state === "done" } : {}),
      },
      201,
    );
  }

  /** The thread as `GET /v1/guide/tracks/:trackId/bootstrap` describes it (contract `GuideBootstrap`). */
  bootstrap(): GuideBootstrapWire {
    const messages = this.log
      .filter(e => e.type === "assistant.message" || e.type === "learner.message")
      .map(e => ({
        id: (e.data as { messageId: string }).messageId,
        seq: e.seq,
        role: e.type === "learner.message" ? ("learner" as const) : ("ally" as const),
        kind: "chat" as const,
        text: (e.data as { text: string }).text,
        turnId: (e.data as { turnId?: string | null }).turnId ?? null,
        createdAt: e.at,
      }));
    const current = this.nextItem() ?? null;
    return {
      availability: {
        guided: true,
        anonymousChat: false,
        voice: true,
        languages: ["en"],
        reason: null,
      },
      access: { hasAccess: true, enrolled: true, reason: null },
      thread: {
        id: this.threadId,
        trackId: this.trackId,
        mode: this.mode,
        atmosphere: this.atmosphere,
        lastEventSeq: this.seq,
      },
      course: {
        id: this.trackId,
        title: "Answering the first call",
        languageCode: "en",
        estimatedMinutes: 33,
      },
      spine: {
        sections: FIXTURE_SECTIONS.map((section, index) => ({
          id: section.id,
          index,
          title: section.title,
          items: FIXTURE_ITEMS.filter(i => i.sectionId === section.id).map(item => ({
            id: item.id,
            type: item.type,
            title: item.title,
            state: this.done.has(item.id) ? ("completed" as const) : ("available" as const),
            minutes: item.minutes,
            boss: item.type === "ROLEPLAY" || item.type === "CASE",
            tension:
              item.type === "ROLEPLAY" || item.type === "CASE"
                ? ("high" as const)
                : item.type === "QUIZ" || item.type === "BUCKET_SORT"
                  ? ("medium" as const)
                  : ("low" as const),
            hasWarnings: item.hasWarnings ?? false,
          })),
        })),
        completed: this.done.size,
        total: FIXTURE_ITEMS.length,
        currentItemId:
          [...this.cards.values()].filter(c => c.kind === "course_item").at(-1)?.trackItem?.id ??
          current?.id ??
          null,
        finished: this.done.size === FIXTURE_ITEMS.length,
      },
      messages,
      cards: [...this.cards.values()].map(({ seq, ...card }) => ({ seq, card })),
      prefs: { ...this.prefs },
      nextStep: this.nextStepData(),
      scenes: this.sceneViews(),
      ...(this.mode === "CRISIS" && this.crisis ? { crisis: this.crisis } : {}),
    };
  }

  /** Chapter scenes as bootstrap returns them (`GuideBootstrap.scenes`), from the event log. */
  private sceneViews(): GuideSceneView[] {
    const views = new Map<string, GuideSceneView>();
    for (const event of this.log) {
      if (event.type === "scene.opened") {
        const data = event.data as {
          sceneId: string;
          sectionId: string;
          title: string;
          stakes?: string | null;
        };
        views.set(data.sceneId, {
          sceneId: data.sceneId,
          sectionId: data.sectionId,
          title: data.title,
          stakes: data.stakes ?? null,
          openedSeq: event.seq,
          closedSeq: null,
        });
      }
      if (event.type === "scene.closed") {
        const data = event.data as { sceneId: string; receipt?: GuideSceneView["receipt"] };
        const view = views.get(data.sceneId);
        if (view) views.set(data.sceneId, { ...view, closedSeq: event.seq, receipt: data.receipt });
      }
    }
    return [...views.values()];
  }

  /** `GET /v1/guide/public/tracks/:trackId/bootstrap`: the preview, the visit so far and the allowance. */
  visitorBootstrap(token: string | null): GuideBootstrapWire {
    const full = this.bootstrap();
    const known = token === VISITOR_TOKEN;
    return {
      ...full,
      availability: { ...full.availability, anonymousChat: true, voice: false },
      access: { hasAccess: false, enrolled: false, reason: null },
      ...(known && this.visitorThread ? {} : { thread: undefined, messages: [], cards: [] }),
      spine: full.spine && {
        ...full.spine,
        // A preview: the first item is open, the rest wait for sign-in.
        sections: full.spine.sections.map((section, s) => ({
          ...section,
          items: section.items.map((item, i) => ({
            ...item,
            state: s === 0 && i === 0 ? ("available" as const) : ("locked" as const),
          })),
        })),
      },
      nextStep: { hidden: true, itemId: null, title: null, minutes: null },
      ...(known ? { allowance: { ...this.allowance } } : {}),
    };
  }

  private visitorThreadOpened() {
    if (!this.visitorThread) {
      this.visitorThread = true;
      this.openScene(FIXTURE_SECTIONS[0].id);
    }
    return json({
      id: this.threadId,
      trackId: this.trackId,
      mode: this.mode,
      atmosphere: this.atmosphere,
      lastEventSeq: this.seq,
    });
  }

  /** A visitor's turn: refused (nothing stored) when paused or out of messages. */
  private acceptVisitorTurn(request: GuideTurnRequest): Response {
    const paused = (request?.text ?? "").toLowerCase().includes("paused-demo");
    if (paused || this.allowance.remaining <= 0) {
      this.turnCount += 1;
      const turnId = `fx-u${this.turnCount}`;
      setTimeout(
        () =>
          this.ephemeral("turn.failed", {
            turnId,
            code: paused ? "anonymous_paused" : "allowance_exhausted",
            message: "",
          }),
        0,
      );
      return json({ turnId }, 202);
    }
    this.allowance = { ...this.allowance, remaining: this.allowance.remaining - 1 };
    return this.acceptTurn(request);
  }

  /** Signing in with the visitor token: the conversation becomes the learner's, and Ally says so. */
  private claim(): Response {
    if (this.options.claimDenied) {
      return json(
        { statusCode: 403, message: "Not your course", errorCode: "GUIDE_NO_ACCESS" },
        403,
      );
    }
    const had = this.visitor && this.visitorThread;
    this.visitor = false;
    if (had) {
      this.turnCount += 1;
      const turnId = `fx-u${this.turnCount}`;
      setTimeout(() => {
        this.ephemeral("turn.started", { turnId, trigger: "platform_event" });
        void this.streamReply(
          turnId,
          "You're signed in, so this conversation is yours now. Let's carry on where we were.",
          "…",
        ).then(() => this.ephemeral("turn.completed", { turnId }));
      }, 0);
    }
    return json({
      id: this.threadId,
      trackId: this.trackId,
      mode: this.mode,
      atmosphere: this.atmosphere,
      lastEventSeq: this.seq,
      claim: had ? "claimed" : "none",
    });
  }

  /** Builds the SSE body: hello, replay after `afterSeq`, then live events and pings. */
  stream(afterSeq: number, signal?: AbortSignal | null): Response {
    const encoder = new TextEncoder();
    let listener: Listener | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (listener) this.listeners.delete(listener);
      if (ping) clearInterval(ping);
      listener = null;
      ping = null;
    };
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        const write = (event: GuideEvent) => {
          try {
            controller.enqueue(encoder.encode(sseFrame(event)));
          } catch {
            cleanup();
          }
        };
        write({
          ...this.base(false),
          seq: afterSeq,
          type: "hello",
          data: { lastSeq: this.seq, mode: this.mode, atmosphere: this.atmosphere },
        } as GuideEvent);
        for (const event of this.log) if (event.seq > afterSeq) write(event);
        listener = write;
        this.listeners.add(listener);
        ping = setInterval(
          () => write({ ...this.base(false), type: "ping", data: {} } as GuideEvent),
          15_000,
        );
        signal?.addEventListener("abort", () => {
          cleanup();
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {
            // already closed
          }
        });
      },
      cancel: cleanup,
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  /** Answers a request, or returns null to let it through. */
  async handle(
    url: string,
    method: string,
    bodyText: string | null,
    signal?: AbortSignal | null,
    headers?: Headers,
  ): Promise<Response | null> {
    const path = new URL(url, "http://fixture.local").pathname.replace(/^.*?\/api\//, "/");
    let body: unknown = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = null;
    }
    const m = (pattern: RegExp) => path.match(pattern);
    let match: RegExpMatchArray | null;
    this.requests.push({ method, path, body });

    const visitorToken = headers?.get("x-guide-visitor") ?? null;
    if (m(/^\/v1\/guide\/public\/availability\//)) {
      return json({
        guided: true,
        anonymousChat: this.visitor,
        voice: false,
        languages: ["en"],
        reason: null,
      });
    }
    // Anonymous visitors (M2).
    if (m(/^\/v1\/guide\/public\/visitors$/) && method === "POST") {
      return json({ token: VISITOR_TOKEN }, 201);
    }
    if (m(/^\/v1\/guide\/public\//) && visitorToken && visitorToken !== VISITOR_TOKEN) {
      return json(
        { statusCode: 401, message: "Unknown visitor", errorCode: "GUIDE_VISITOR_INVALID" },
        401,
      );
    }
    if (m(/^\/v1\/guide\/public\/tracks\/[^/]+\/bootstrap$/)) {
      return json(this.visitorBootstrap(visitorToken));
    }
    if (m(/^\/v1\/guide\/public\/tracks\/[^/]+\/threads$/) && method === "POST") {
      return this.visitorThreadOpened();
    }
    if (m(/^\/v1\/guide\/public\/threads\/[^/]+\/turns$/) && method === "POST") {
      return this.acceptVisitorTurn(body as GuideTurnRequest);
    }
    if (m(/^\/v1\/guide\/public\/threads\/[^/]+\/events$/)) {
      const lastId = Number(new URL(url, "http://fixture.local").searchParams.get("afterSeq") ?? 0);
      return this.stream(Number.isFinite(lastId) ? lastId : 0, signal);
    }

    if (m(/^\/v1\/guide\/tracks\/[^/]+\/bootstrap$/)) return json(this.bootstrap());
    if (m(/^\/v1\/guide\/tracks\/[^/]+\/threads$/) && method === "POST") {
      if (visitorToken) return this.claim();
      return json({
        id: this.threadId,
        trackId: this.trackId,
        mode: this.mode,
        atmosphere: this.atmosphere,
        lastEventSeq: this.seq,
      });
    }
    if (m(/^\/v1\/guide\/threads\/[^/]+\/turns$/) && method === "POST")
      return this.acceptTurn(body as GuideTurnRequest);
    if (m(/^\/v1\/guide\/threads\/[^/]+\/events$/)) {
      const lastId = Number(new URL(url, "http://fixture.local").searchParams.get("afterSeq") ?? 0);
      return this.stream(Number.isFinite(lastId) ? lastId : 0, signal);
    }
    if ((match = m(/^\/v1\/guide\/threads\/[^/]+\/cards\/([^/]+)\/events$/))) {
      return this.cardEvent(decodeURIComponent(match[1]), (body ?? {}) as { type?: string });
    }
    if (m(/^\/v1\/guide\/threads\/[^/]+\/enroll$/)) {
      return json({ trackEnrollmentId: "fx-enrolment", alreadyEnrolled: true });
    }
    if (m(/^\/v1\/guide\/threads\/[^/]+\/voice-session$/)) {
      return json(
        { statusCode: 403, message: "Voice isn't on in the fixture", errorCode: "GUIDE_DISABLED" },
        403,
      );
    }
    if (m(/^\/v1\/guide\/threads\/[^/]+\/appointment$/)) return json({ ok: true });
    if (m(/^\/v1\/guide\/prefs$/)) {
      if (method === "PUT") this.prefs = { ...this.prefs, ...(body as Partial<GuidePrefs>) };
      return json({ ...this.prefs });
    }
    if ((match = m(/^\/v1\/guide\/threads\/[^/]+\/micro-activities\/([^/]+)\/responses$/))) {
      return this.answerPractice(
        decodeURIComponent(match[1]),
        (body ?? {}) as GuideMicroActivityRequest,
      );
    }
    if (m(/^\/v1\/guide\/notebook\/export$/)) {
      const markdown = ["# Notebook", ...this.notebook.map(n => `- ${n.text}`)].join("\n");
      return new Response(markdown, { status: 200, headers: { "Content-Type": "text/markdown" } });
    }
    if ((match = m(/^\/v1\/guide\/notebook\/([^/]+)$/)) && method === "DELETE") {
      this.notebook = this.notebook.filter(n => n.id !== decodeURIComponent(match![1]));
      return json({ removed: 1 });
    }
    if (m(/^\/v1\/guide\/notebook$/)) return json(this.notebook);
    if ((match = m(/^\/v1\/guide\/messages\/([^/]+)\/feedback$/)) && method === "POST") {
      const rating = (body as { rating?: number; comment?: string }) ?? {};
      this.ratings.set(decodeURIComponent(match[1]), {
        rating: rating.rating ?? 0,
        comment: rating.comment,
      });
      return json({ messageId: decodeURIComponent(match[1]), rating: rating.rating }, 201);
    }
    if (m(/^\/v1\/guide\/tracks\/[^/]+\/advice$/)) {
      if (method === "POST") {
        const text = String((body as { text?: string })?.text ?? "").trim();
        if (this.advice.mine && this.advice.mine.status !== "pending") {
          return json(
            { statusCode: 409, message: "You have already left your advice for this course." },
            409,
          );
        }
        if (text.length > this.advice.maxChars) {
          return json(
            { statusCode: 400, message: `Keep it under ${this.advice.maxChars} characters.` },
            400,
          );
        }
        this.advice = {
          ...this.advice,
          mine: { id: "fx-advice", text, status: "pending", createdAt: new Date().toISOString() },
        };
        return json(this.advice.mine, 201);
      }
      return json(this.advice);
    }
    if ((match = m(/^\/v1\/guide\/memory\/([^/]+)$/)) && method === "DELETE") {
      this.memories = this.memories.filter(n => n.id !== decodeURIComponent(match![1]));
      return json({ forgotten: 1 });
    }
    if (m(/^\/v1\/guide\/memory$/)) {
      if (method === "DELETE") {
        const forgotten = this.memories.length;
        this.memories = [];
        return json({ forgotten });
      }
      return json(this.memories);
    }

    if ((match = m(/^\/v1\/learn\/tracks\/([^/]+)\/public$/))) {
      return json(fixturePublicOutline(decodeURIComponent(match[1])));
    }
    if (m(/^\/v1\/learn\/tracks\/[^/]+\/access$/)) {
      return json(
        this.options.claimDenied
          ? { hasAccess: false, enrolled: false, reason: "NOT_IN_ORGANIZATION" }
          : { hasAccess: true, enrolled: true, reason: null },
      );
    }
    if ((match = m(/^\/v1\/learn\/tracks\/items\/([^/]+)\/start$/))) {
      const payload = fixtureStartPayload(match[1]);
      return payload ? json(payload) : json({ message: "This fixture can't open that item." }, 400);
    }
    if (m(/^\/v1\/learn\/tracks\/items\/[^/]+\/resources\/embeddability$/))
      return json({ resources: [] });
    if (m(/^\/v1\/learn\/tracks\/items\/[^/]+\/(article-read|journal\/submit)$/)) {
      return json({
        completed: true,
        unlockedItemIds: [],
        sectionCompleted: false,
        trackCompleted: false,
      });
    }
    if (m(/^\/v1\/learn\/tracks\/items\/[^/]+\/journal$/)) return json({ ok: true });
    if (m(/^\/v1\/learn\/tracks\/items\/[^/]+\/game-result$/)) return json({ ok: true });
    if ((match = m(/^\/v1\/learn\/tracks\/items\/([^/]+)\/quiz-attempts$/))) {
      return json({
        attemptId: "fx-attempt",
        attemptNumber: 1,
        status: "GRADED",
        scorePct: 100,
        passed: true,
        passScore: 50,
        attemptsUsed: 1,
        maxAttempts: 2,
        questions: [
          { questionId: "fx-q1", correct: true, pointsAwarded: 1, pointsPossible: 1 },
          { questionId: "fx-q2", correct: true, pointsAwarded: 1, pointsPossible: 1 },
        ],
        itemCompleted: true,
        unlockedItemIds: [],
        sectionCompleted: false,
        trackCompleted: false,
      });
    }
    if (m(/^\/v1\/learn\/tracks\/[^/]+$/)) return json(fixtureTrackDetail(this.trackId, this.done));
    return null;
  }
}

/**
 * Wraps `window.fetch` so the app's own RTK Query calls and the SSE hook hit
 * the fixture. Unknown API routes pass through when someone is signed in,
 * and 404 otherwise (a stray 401 would sign the page out).
 */
export const installGuideFixture = (trackId: string, options?: FixtureOptions) => {
  const server = new GuideFixtureServer(trackId, options);
  const realFetch = window.fetch.bind(window);
  const fixtureFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    if (!url.includes("/api/")) return realFetch(input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    let bodyText: string | null = null;
    if (init?.body && typeof init.body === "string") bodyText = init.body;
    else if (request && method !== "GET") bodyText = await request.clone().text();
    const headers = new Headers(init?.headers ?? request?.headers);
    const lastEventId = headers.get("Last-Event-ID");
    const effectiveUrl =
      lastEventId && url.endsWith("/events")
        ? `${url}?afterSeq=${encodeURIComponent(lastEventId)}`
        : url;
    const answered = await server.handle(
      effectiveUrl,
      method,
      bodyText,
      init?.signal ?? request?.signal,
      headers,
    );
    if (answered) return answered;
    if (localStorage.getItem("accessToken")) return realFetch(input, init);
    return json({ message: "Not in the fixture" }, 404);
  };
  window.fetch = fixtureFetch;
  globalThis.fetch = fixtureFetch;
  (window as unknown as { __guideFixture?: GuideFixtureServer }).__guideFixture = server;
  return {
    server,
    uninstall: () => {
      if (window.fetch === fixtureFetch) window.fetch = realFetch;
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = realFetch;
    },
  };
};
