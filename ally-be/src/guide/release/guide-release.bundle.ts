import {
  ORCHESTRATOR_PROMPT_CODE,
  ORCHESTRATOR_PROMPT_VERSION,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from '../prompts/orchestrator.prompt';
import {
  TUTOR_PROMPT_CODE,
  TUTOR_PROMPT_VERSION,
  TUTOR_SYSTEM_PROMPT,
} from '../prompts/tutor.prompt';
import {
  SENTINEL_PROMPT_CODE,
  SENTINEL_PROMPT_VERSION,
  SENTINEL_SYSTEM_PROMPT,
} from '../prompts/sentinel.prompt';

/**
 * The Ally guide's release bundle (plans/ally-guide/plan.md §7.4) and the
 * defaults it is seeded with. Policy values are Appendix A of the plan;
 * changing any of them is a new release, never an edit in place.
 *
 * Prompts travel INSIDE the bundle as text, not as references to the
 * `prompts` table: a release is then self-contained — its content hash covers
 * every word the models are given, and a rollback restores them exactly.
 * They are deliberately not in `src/prompts/`, which syncs to Prompt
 * Management, where an edit would either do nothing or fork a release out of
 * band.
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

/** One role's prompt, frozen into the release. */
export interface GuidePromptRef {
  code: string;
  version: number;
  text: string;
}

export interface GuideReleaseBundle {
  /** Bumped when this bundle's SHAPE changes, so old releases stay readable. */
  schemaVersion: 1;
  /** Each role's prompt, as text (see the module comment). */
  prompts: Partial<Record<GuideRole, GuidePromptRef>>;
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
 * The code's current defaults. Prompts and capabilities are added as step 1.1
 * lands them; a change here becomes a new seed release at boot (see
 * AgentReleaseService.syncSeed), never an edit to an existing one.
 */
export const GUIDE_DEFAULT_BUNDLE: GuideReleaseBundle = {
  schemaVersion: 1,
  prompts: {
    orchestrator: {
      code: ORCHESTRATOR_PROMPT_CODE,
      version: ORCHESTRATOR_PROMPT_VERSION,
      text: ORCHESTRATOR_SYSTEM_PROMPT,
    },
    sentinel: {
      code: SENTINEL_PROMPT_CODE,
      version: SENTINEL_PROMPT_VERSION,
      text: SENTINEL_SYSTEM_PROMPT,
    },
    tutor: {
      code: TUTOR_PROMPT_CODE,
      version: TUTOR_PROMPT_VERSION,
      text: TUTOR_SYSTEM_PROMPT,
    },
  },
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
    sentinel: { text: { premium: { ...HAIKU, effort: 'low' } } },
    tutor: { text: { premium: OPUS, degraded: SONNET, lite: HAIKU } },
    coach: { text: { premium: OPUS, degraded: SONNET, lite: HAIKU } },
    assessor: { text: { premium: OPUS, degraded: SONNET, lite: HAIKU } },
    memory_curator: { text: { premium: { ...OPUS, effort: 'low' } } },
    summariser: { text: { premium: HAIKU } },
    outreach_writer: { text: { premium: { ...OPUS, effort: 'low' } } },
  },
  capabilities: {
    present_course_item: true,
    show_course_info: true,
    get_progress: true,
    mark_reflection_done: true,
    show_wellbeing_resources: true,
    set_guidance: true,
    consult_tutor: true,
  },
  skills: {},
  policy: GUIDE_DEFAULT_POLICY,
  lessonSnapshot: [],
};
