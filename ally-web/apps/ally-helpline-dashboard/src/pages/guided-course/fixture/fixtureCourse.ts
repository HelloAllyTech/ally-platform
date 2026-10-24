/**
 * The example course the fixture server plays (dev only, `?fixture=1`).
 * Shapes follow the guide contract and the classic course API; the words are
 * placeholders in Ally's voice, not product copy.
 */
import type { GuideCard, GuideItemType } from "../contract/wire";

export interface FixtureItem {
  id: string;
  type: GuideItemType;
  title: string;
  framing: string;
  minutes: number;
  sectionId: string;
  hasWarnings?: boolean;
}

export const FIXTURE_SECTIONS = [
  {
    id: "fx-s1",
    title: "Opening a call",
    stakes: "The first ninety seconds decide whether a caller stays.",
  },
  {
    id: "fx-s2",
    title: "Hearing what's under the words",
    stakes: "Meera says she's “just tired”. She isn't.",
  },
  { id: "fx-s3", title: "Closing well", stakes: null },
];

export const FIXTURE_ITEMS: FixtureItem[] = [
  {
    id: "fx-i1",
    type: "ARTICLE",
    title: "Opening a call",
    framing: "What a caller decides in the first ninety seconds.",
    minutes: 4,
    sectionId: "fx-s1",
  },
  {
    id: "fx-i2",
    type: "QUIZ",
    title: "Opening moves",
    framing: "Two quick questions on how you'd begin.",
    minutes: 3,
    sectionId: "fx-s1",
  },
  {
    id: "fx-i3",
    type: "VIDEO",
    title: "Meera's first call",
    framing: "Listen for what she doesn't say.",
    minutes: 6,
    sectionId: "fx-s2",
    hasWarnings: true,
  },
  {
    id: "fx-i4",
    type: "JOURNAL",
    title: "When you stayed quiet",
    framing: "A short reflection on silence.",
    minutes: 4,
    sectionId: "fx-s2",
    hasWarnings: true,
  },
  {
    id: "fx-i5",
    type: "ROLEPLAY",
    title: "Meera calls back",
    framing: "Ten minutes, by voice.",
    minutes: 10,
    sectionId: "fx-s2",
    hasWarnings: true,
  },
  {
    id: "fx-i6",
    type: "BUCKET_SORT",
    title: "Feeling or fact?",
    framing: "Sort what callers say.",
    minutes: 3,
    sectionId: "fx-s3",
  },
  {
    id: "fx-i7",
    type: "GAME",
    title: "Memory match",
    framing: "Just for fun.",
    minutes: 3,
    sectionId: "fx-s3",
  },
];

const PRESENTATION: Record<GuideItemType, GuideCard["presentation"]> = {
  ARTICLE: "shelf",
  VIDEO: "shelf",
  BUCKET_SORT: "shelf",
  QUIZ: "inline",
  JOURNAL: "inline",
  BRANCHING_SCENARIO: "inline",
  ROLEPLAY: "theatre",
  CASE: "theatre",
  ANNOTATED_ARTIFACT: "theatre",
  GAME: "theatre",
};

export const cardForItem = (item: FixtureItem, cardId: string): GuideCard => {
  const section = FIXTURE_SECTIONS.find(s => s.id === item.sectionId);
  return {
    cardId,
    kind: "course_item",
    presentation: PRESENTATION[item.type],
    state: "ready",
    title: item.title,
    framing: item.framing,
    tone: item.type === "ROLEPLAY" ? "warm" : "quiet",
    meta: { minutes: item.minutes, format: null },
    trackItem: {
      id: item.id,
      type: item.type,
      title: item.title,
      sectionId: item.sectionId,
      sectionTitle: section?.title ?? null,
    },
    payload: {},
  };
};

export const FIXTURE_ARTICLE_HTML = `
<h2>Opening a call</h2>
<p>In the first ninety seconds, a caller is deciding whether you are safe to talk to, not whether you are clever.</p>
<p>Say your name. Say you're glad they called. Then stop, and let the silence be theirs.</p>
<p>Most of what makes an opening work is what you leave out: no script, no rush to fix, no list of questions.</p>
<p>If the caller goes quiet, wait. Count to five in your head before you say anything.</p>
`;

/** Classic start payloads for the item types the fixture can open. */
export const fixtureStartPayload = (itemId: string): unknown | null => {
  const item = FIXTURE_ITEMS.find(i => i.id === itemId);
  if (!item) return null;
  const base = { trackItemProgressId: `progress-${itemId}` };
  switch (item.type) {
    case "ARTICLE":
      return {
        ...base,
        type: "ARTICLE",
        html: FIXTURE_ARTICLE_HTML,
        minReadSeconds: 5,
        questions: [],
        resources: [],
      };
    case "JOURNAL":
      return {
        ...base,
        type: "JOURNAL",
        prompts: [
          {
            id: "fx-p1",
            prompt:
              "When did you last stay quiet longer than felt comfortable? What happened next?",
            required: true,
            placeholder: null,
          },
        ],
        savedResponses: [],
      };
    case "QUIZ":
      return {
        ...base,
        type: "QUIZ",
        attemptsUsed: 0,
        maxAttempts: 2,
        quiz: {
          settings: { passScore: 50, maxAttempts: 2, showExplanations: "after_submit" },
          totalPoints: 2,
          questions: [
            {
              id: "fx-q1",
              type: "mcq_single",
              prompt: "A caller says hello and then goes quiet. What do you do first?",
              points: 1,
              options: [
                { id: "a", text: "Ask why they are calling" },
                { id: "b", text: "Wait, and let them speak when ready" },
                { id: "c", text: "Explain how the helpline works" },
              ],
            },
            {
              id: "fx-q2",
              type: "mcq_single",
              prompt: "Which opening line leaves the most room for the caller?",
              points: 1,
              options: [
                { id: "a", text: "“What's the problem?”" },
                { id: "b", text: "“I'm here. Take your time.”" },
              ],
            },
          ],
        },
      };
    case "GAME":
      return {
        ...base,
        type: "GAME",
        gameKey: "MEMORY_MATCH",
        intro: null,
        bestScore: null,
        playCount: 0,
        completion: {
          completed: true,
          unlockedItemIds: [],
          sectionCompleted: false,
          trackCompleted: false,
        },
      };
    default:
      return null;
  }
};

/** Classic course detail for the fixture (the item host looks items up here). */
export const fixtureTrackDetail = (trackId: string, doneIds: Set<string>) => ({
  id: trackId,
  title: "Answering the first call",
  description: "A short course on the first minutes of a helpline call.",
  coverImageUrl: null,
  status: "PUBLISHED",
  totalItems: FIXTURE_ITEMS.length,
  simulationsCount: 1,
  estimatedDurationMinutes: 33,
  enrolled: true,
  trackEnrollmentId: "fx-enrolment",
  completedItems: doneIds.size,
  completedAt: null,
  languageCode: "en",
  sections: FIXTURE_SECTIONS.map((section, order) => ({
    id: section.id,
    title: section.title,
    description: null,
    order,
    items: FIXTURE_ITEMS.filter(i => i.sectionId === section.id).map((item, index) => ({
      id: item.id,
      type: item.type,
      order: index,
      title: item.title,
      description: item.framing,
      scenarioId: item.type === "ROLEPLAY" ? 1 : null,
      caseId: null,
      completionCriteria: null,
      contentMeta: null,
      status: doneIds.has(item.id) ? "COMPLETED" : "UNLOCKED",
      startedAt: null,
      completedAt: null,
      score: null,
      attemptCount: null,
      maxWatchedPct: null,
    })),
  })),
});

/**
 * The course's public outline with a story frame (`GET /v1/learn/tracks/:id/public`),
 * so the visitor landing shows a story line and first-move replies.
 */
export const fixturePublicOutline = (trackId: string) => ({
  id: trackId,
  title: "Answering the first call",
  description: "How to open a call, listen first, and stay with a caller in the hard moments.",
  coverImageUrl: null,
  totalItems: FIXTURE_ITEMS.length,
  simulationsCount: 1,
  estimatedDurationMinutes: 33,
  languageCode: "en",
  sections: [],
  story: {
    hook: "Meera has rung off twice before saying a word. Tonight she stays on the line.",
    question: null,
    courseLine: null,
    buttonLabel: null,
    persona: null,
    firstMove: {
      sceneLine: null,
      personaLine: "“…Hello? I don't really know why I called.”",
      prompt: "What do you say first?",
      replies: [
        {
          text: "I'm glad you called. Take your time.",
          label: "I'm glad you called. Take your time.",
          why: null,
        },
        {
          text: "What's been happening for you today?",
          label: "What's been happening today?",
          why: null,
        },
        { text: "Can I take your name first?", label: "Can I take your name first?", why: null },
      ],
    },
    arc: null,
    outcomes: [
      "Open a call so the caller feels heard",
      "Reflect what you hear before you advise",
      "Stay steady when a caller goes quiet",
    ],
    howItPlays: null,
    cast: null,
    xp: null,
    contentNotes: null,
  },
});
