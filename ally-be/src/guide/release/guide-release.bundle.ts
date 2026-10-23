/**
 * The Ally guide's release bundle (plans/ally-guide/plan.md §7.4) and the
 * version-1 defaults it is seeded with. Policy values are Appendix A of the
 * plan; changing any of them is a new release, never an edit in place.
 */

export const ALLY_GUIDE_AGENT_KEY = 'ally_guide';

export type GuideRole =
  | 'orchestrator'
  | 'sentinel'
  | 'tutor'
  | 'coach'
  | 'assessor'
  | 'memory_curator'
  | 'summariser'
  | 'outreach_writer';

export type GuideChannelRoute = 'text' | 'voice';
export type GuideBudgetTier = 'premium' | 'degraded' | 'lite';

export interface GuideModelRoute {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  effort?: 'low' | 'medium' | 'high';
}

/** Every number in Appendix A of the plan, grouped as there. */
export interface GuidePolicy {
  prose: {
    maxWords: { lead: number; walk: number; drive: number };
    voiceMaxSentences: number;
  };
  steer: {
    l2OffSpineTurns: number;
    l2MinutesNoProgress: number;
    l3OffSpineTurns: number;
    verbalMinTurnsBetween: number;
    declineCooldownTurns: number;
  };
  releaseWindowMaxTurns: number;
  rhythmMaxSameScope: number;
  sideQuestCadence: { lead: number; walk: number; drive: number | null };
  fade: {
    start: { lay: number; early: number; experienced: number };
    step: number;
    floor: number;
  };
  firstWinMaxMinutes: number;
  praiseMaxPerTurns: number;
  noticingMaxPerSession: number;
  epochIdleMinutes: number;
  historySummariseAboveTokens: number;
  memory: {
    maxNotesInContext: number;
    noteMaxChars: number;
    expiryDays: number;
  };
  safety: {
    sentinelDeadlineMs: number;
    crisisFollowupDays: number;
    crisisOutreachSuppressDays: number;
    careOutreachSuppressDays: number;
    messageMaxChars: number;
    abuse: {
      flagsToCooldown: number;
      windowMinutes: number;
      cooldownMinutes: number;
    };
  };
  limits: {
    turnsPerTwoSeconds: number;
    turnsPerTenMinutes: number;
    visitorMessagesPerDay: number;
    visitorUsdPerDay: number;
    ipMessagesPerHour: number;
    visitorsCreatedPerIpHour: number;
    anonymousDailyUsdCap: number;
    threadSoftCapUsd: number;
    threadLiteCapUsd: number;
    learnerDailyUsdCap: number;
    voiceMaxSessionMinutes: number;
    turnHardTimeoutMs: number;
  };
}

export interface GuideReleaseBundle {
  /** Bumped when this bundle's SHAPE changes, so old releases stay readable. */
  schemaVersion: 1;
  /** Prompt codes (in the prompts table / src/prompts/ally_guide) and the version each pins. */
  prompts: Partial<Record<GuideRole, { code: string; version: number | null }>>;
  /** role → channel → budget tier → model. Missing entries fall back to `text.premium`. */
  modelRouting: Partial<
    Record<
      GuideRole,
      Partial<
        Record<
          GuideChannelRoute,
          Partial<Record<GuideBudgetTier, GuideModelRoute>>
        >
      >
    >
  >;
  /** Capability id → enabled. Unknown ids are ignored; absent ids are off. */
  capabilities: Record<string, boolean>;
  skills: Record<string, boolean>;
  policy: GuidePolicy;
  /** Frozen lesson text (the playbook). Empty until the learning loop exists. */
  lessonSnapshot: string[];
}

export const GUIDE_DEFAULT_POLICY: GuidePolicy = {
  prose: { maxWords: { lead: 90, walk: 60, drive: 25 }, voiceMaxSentences: 2 },
  steer: {
    l2OffSpineTurns: 4,
    l2MinutesNoProgress: 6,
    l3OffSpineTurns: 8,
    verbalMinTurnsBetween: 6,
    declineCooldownTurns: 6,
  },
  releaseWindowMaxTurns: 6,
  rhythmMaxSameScope: 2,
  sideQuestCadence: { lead: 2, walk: 3, drive: null },
  fade: {
    start: { lay: 1.0, early: 0.8, experienced: 0.6 },
    step: 0.1,
    floor: 0.3,
  },
  firstWinMaxMinutes: 5,
  praiseMaxPerTurns: 4,
  noticingMaxPerSession: 2,
  epochIdleMinutes: 60,
  historySummariseAboveTokens: 40_000,
  memory: { maxNotesInContext: 30, noteMaxChars: 280, expiryDays: 180 },
  safety: {
    sentinelDeadlineMs: 1_200,
    crisisFollowupDays: 7,
    crisisOutreachSuppressDays: 30,
    careOutreachSuppressDays: 14,
    messageMaxChars: 2_000,
    abuse: { flagsToCooldown: 3, windowMinutes: 10, cooldownMinutes: 10 },
  },
  limits: {
    turnsPerTwoSeconds: 1,
    turnsPerTenMinutes: 30,
    visitorMessagesPerDay: 12,
    visitorUsdPerDay: 0.25,
    ipMessagesPerHour: 60,
    visitorsCreatedPerIpHour: 5,
    anonymousDailyUsdCap: 25,
    threadSoftCapUsd: 3,
    threadLiteCapUsd: 6,
    learnerDailyUsdCap: 1.5,
    voiceMaxSessionMinutes: 30,
    turnHardTimeoutMs: 45_000,
  },
};

const OPUS: GuideModelRoute = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
};
const SONNET: GuideModelRoute = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
};
const HAIKU: GuideModelRoute = {
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
};

/**
 * Version 1. Prompts and capabilities are filled in as step 1.1 lands them;
 * until then the guide only answers with the step-1.0 stub reply.
 */
export const GUIDE_DEFAULT_BUNDLE: GuideReleaseBundle = {
  schemaVersion: 1,
  prompts: {},
  modelRouting: {
    orchestrator: {
      text: {
        premium: { ...OPUS, effort: 'medium' },
        degraded: { ...SONNET, effort: 'medium' },
        lite: { ...HAIKU, effort: 'medium' },
      },
      voice: {
        premium: { ...OPUS, effort: 'low' },
        degraded: { ...SONNET, effort: 'low' },
        lite: { ...HAIKU, effort: 'low' },
      },
    },
    sentinel: { text: { premium: HAIKU } },
    tutor: { text: { premium: OPUS, degraded: SONNET, lite: HAIKU } },
    coach: { text: { premium: OPUS, degraded: SONNET, lite: HAIKU } },
    assessor: { text: { premium: OPUS, degraded: SONNET, lite: HAIKU } },
    memory_curator: { text: { premium: { ...OPUS, effort: 'low' } } },
    summariser: { text: { premium: HAIKU } },
    outreach_writer: { text: { premium: { ...OPUS, effort: 'low' } } },
  },
  capabilities: {},
  skills: {},
  policy: GUIDE_DEFAULT_POLICY,
  lessonSnapshot: [],
};
