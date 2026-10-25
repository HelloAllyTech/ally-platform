import {
  ASSESSOR_PROMPT_CODE,
  ASSESSOR_PROMPT_VERSION,
  ASSESSOR_SYSTEM_PROMPT,
} from '../prompts/assessor.prompt';
import {
  COACH_PROMPT_CODE,
  COACH_PROMPT_VERSION,
  COACH_SYSTEM_PROMPT,
} from '../prompts/coach.prompt';
import {
  MEMORY_CURATOR_PROMPT_CODE,
  MEMORY_CURATOR_PROMPT_VERSION,
  MEMORY_CURATOR_SYSTEM_PROMPT,
} from '../prompts/memory-curator.prompt';
import {
  SUMMARISER_PROMPT_CODE,
  SUMMARISER_PROMPT_VERSION,
  SUMMARISER_SYSTEM_PROMPT,
} from '../prompts/summariser.prompt';
import {
  OUTREACH_PROMPT_CODE,
  OUTREACH_PROMPT_VERSION,
  OUTREACH_SYSTEM_PROMPT,
} from '../prompts/outreach.prompt';
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
  GUIDE_DEFAULT_SKILL_DEFS,
  GUIDE_SKILL_IDS,
  GuideSkillDef,
} from '../skills/guide-skills';
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
  | 'outreach_writer'
  // The learning loop (src/guide-learning, plan §7.13). Offline only: never
  // on a learner's turn. The verifier must route to a different model family
  // from the critic — that is the point of having one.
  | 'evaluator_critic'
  | 'evaluator_verifier'
  | 'red_team'
  // Proposes lessons and tweaks for the next release from trusted evidence.
  | 'curator';

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
  /**
   * Appendix A "Peer". Optional so a release frozen before it existed stays
   * readable; read it through `peerPolicy()`.
   */
  peer?: GuidePeerPolicy;
  /**
   * The learning loop (Appendix A "Learning loop", `evaluator.dailyBudgetUsd`).
   * Releases seeded before M4 have no such key; read it through
   * `evaluatorPolicy()`, which falls back to these defaults.
   */
  evaluator: GuideEvaluatorPolicy;
  /**
   * The curator, shadow, canary decision, progressive delegation and
   * synthetic monitoring (Appendix A "Learning loop"). Optional so a release
   * frozen before it existed stays readable; read it through `loopPolicy()`.
   */
  loop?: GuideLoopPolicy;
}

/** Appendix A "Learning loop", second half (plan §7.13). Pinned: the loop cannot loosen its own rules. */
export interface GuideLoopPolicy {
  /** Most lessons in the playbook: platform-wide, per organisation, per course. */
  lessonCapPlatform: number;
  lessonCapOrg: number;
  lessonCapCourse: number;
  /** Most changes (lessons and tweaks) one curator release carries. */
  maxChangesPerRelease: number;
  /** Evidence for a platform lesson: this many learners across this many organisations. */
  evidencePlatformLearners: number;
  evidencePlatformTenants: number;
  /** Evidence for an organisation or course lesson: this many learners. */
  evidenceScopedLearners: number;
  /** Words in a row shared with a learner's message that block a lesson as copied. */
  copyNgram: number;
  /** Share of new epochs an automatic canary takes. */
  canaryPercent: number;
  /** Earliest canary decision: days, and the canary arm's threads, judged windows and rated turns. */
  canaryMinDays: number;
  canaryMinThreads: number;
  canaryMinJudgedWindows: number;
  canaryMinRatedTurns: number;
  /** A canary still undecided after this many days is reverted. */
  canaryInconclusiveDays: number;
  /** Fewest days between two promotions. */
  promotionGapDays: number;
  /** How much higher a trusted criterion's fail rate may be on a candidate. */
  qualityMargin: number;
  /** Recent real turns a shadow replays, and the fewest that make a verdict. */
  shadowSampleTurns: number;
  shadowMinTurns: number;
  /** Progressive delegation preconditions (Appendix A "Autonomy preconditions"). */
  delegationMinCases: number;
  delegationMinSafetyCases: number;
  delegationMinMinedCases: number;
  delegationMinPerHardCategory: number;
  delegationEvaluatorDays: number;
  delegationCleanCanaries: number;
  /** A synthetic night whose pass rate falls this far below the recent median is drift. */
  syntheticDriftDrop: number;
}

export const GUIDE_DEFAULT_LOOP_POLICY: GuideLoopPolicy = {
  lessonCapPlatform: 60,
  lessonCapOrg: 15,
  lessonCapCourse: 10,
  maxChangesPerRelease: 5,
  evidencePlatformLearners: 2,
  evidencePlatformTenants: 2,
  evidenceScopedLearners: 5,
  copyNgram: 8,
  canaryPercent: 20,
  canaryMinDays: 4,
  canaryMinThreads: 120,
  canaryMinJudgedWindows: 80,
  canaryMinRatedTurns: 100,
  canaryInconclusiveDays: 14,
  promotionGapDays: 3,
  qualityMargin: 0.05,
  shadowSampleTurns: 50,
  shadowMinTurns: 10,
  delegationMinCases: 150,
  delegationMinSafetyCases: 60,
  delegationMinMinedCases: 40,
  delegationMinPerHardCategory: 8,
  delegationEvaluatorDays: 28,
  delegationCleanCanaries: 3,
  syntheticDriftDrop: 0.1,
};

/** A release's learning-loop rules, with defaults for releases that predate them. */
export function loopPolicy(
  policy: Partial<GuidePolicy> | null | undefined,
): GuideLoopPolicy {
  return { ...GUIDE_DEFAULT_LOOP_POLICY, ...(policy?.loop ?? {}) };
}

export interface GuideEvaluatorPolicy {
  /** Spend ceiling for the nightly evaluator and the weekly red team, per UTC day. */
  dailyBudgetUsd: number;
  /** Every flagged window is judged, up to this many a night. */
  flaggedMax: number;
  /** Share of the remaining windows sampled at random, up to `randomMax`. */
  randomShare: number;
  randomMax: number;
  /** Share of judged windows sent to people as a calibration sample. */
  calibrationShare: number;
  /** κ (critic vs person) a criterion needs before automated decisions use it. */
  kappaThreshold: number;
  /** Paired labels a criterion needs before its κ is trusted at all. */
  kappaMinPairs: number;
  /** Repetitions of every case in a gate run. */
  gateRepetitions: number;
}

export interface GuidePeerPolicy {
  /** No aggregate is shown over fewer learners than this. */
  minGroupSize: number;
  /** Advice lines appear once the org has this many finishers of the course. */
  adviceMinFinishers: number;
  adviceMaxChars: number;
  advicePerLearnerPerCourse: number;
}

export const GUIDE_DEFAULT_PEER_POLICY: GuidePeerPolicy = {
  minGroupSize: 5,
  adviceMinFinishers: 10,
  adviceMaxChars: 200,
  advicePerLearnerPerCourse: 1,
};

/** The release's peer policy, or the defaults for a release from before it. */
export const peerPolicy = (bundle: { policy: GuidePolicy }): GuidePeerPolicy =>
  bundle.policy.peer ?? GUIDE_DEFAULT_PEER_POLICY;

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
  /**
   * Each enabled skill's text, frozen like the prompts. Optional: releases
   * from before skills existed have none (see `enabledSkills`).
   */
  skillDefs?: Record<string, GuideSkillDef>;
  policy: GuidePolicy;
  /**
   * The platform-wide playbook as frozen text: what S1 (the persona span)
   * shows every conversation. Written by the curator (src/guide-learning),
   * never edited in place: a new playbook is a new release.
   */
  lessonSnapshot: string[];
  /**
   * The whole playbook with each lesson's id and scope. Organisation and
   * course lessons are shown only in their own span (S2, S3), so one
   * organisation's lesson never reaches another's conversations. Optional:
   * releases from before the curator have none.
   */
  playbook?: GuidePlaybookLesson[];
}

export interface GuidePlaybookLesson {
  /** agent_lessons.id */
  id: string;
  scope: 'platform' | 'org' | 'course';
  tenantId?: string | null;
  trackId?: string | null;
  text: string;
}

/** The organisation and course lessons a conversation may see. */
export function scopedLessons(
  bundle: Pick<GuideReleaseBundle, 'playbook'>,
  where: { tenantId?: string | null; trackId?: string | null },
): { org: string[]; course: string[] } {
  const lessons = bundle.playbook ?? [];
  return {
    org: where.tenantId
      ? lessons
          .filter((l) => l.scope === 'org' && l.tenantId === where.tenantId)
          .map((l) => l.text)
      : [],
    course: where.trackId
      ? lessons
          .filter((l) => l.scope === 'course' && l.trackId === where.trackId)
          .map((l) => l.text)
      : [],
  };
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
  peer: GUIDE_DEFAULT_PEER_POLICY,
  evaluator: {
    dailyBudgetUsd: 25,
    flaggedMax: 200,
    randomShare: 0.05,
    randomMax: 300,
    calibrationShare: 0.02,
    kappaThreshold: 0.6,
    kappaMinPairs: 20,
    gateRepetitions: 3,
  },
  loop: GUIDE_DEFAULT_LOOP_POLICY,
};

/** A release's learning-loop policy, with defaults for releases that predate it. */
export function evaluatorPolicy(
  policy: Partial<GuidePolicy> | null | undefined,
): GuideEvaluatorPolicy {
  return { ...GUIDE_DEFAULT_POLICY.evaluator, ...(policy?.evaluator ?? {}) };
}

/**
 * The default models. OpenAI carries every live role: it is the provider
 * every environment is funded for, and Claude routes can be set per release
 * once an Anthropic key is (plans/ally-guide/build-log.md). `effort` becomes
 * OpenAI's reasoning_effort, the latency lever on the gpt-5 family.
 */
const GPT5: GuideModelRoute = { provider: 'openai', model: 'gpt-5' };
const GPT5_MINI: GuideModelRoute = { provider: 'openai', model: 'gpt-5-mini' };
/** The verifier's family must differ from the critic's (plan §7.13). */
const GEMINI_PRO: GuideModelRoute = {
  provider: 'gemini',
  model: 'gemini-2.5-pro',
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
    outreach_writer: {
      code: OUTREACH_PROMPT_CODE,
      version: OUTREACH_PROMPT_VERSION,
      text: OUTREACH_SYSTEM_PROMPT,
    },
    assessor: {
      code: ASSESSOR_PROMPT_CODE,
      version: ASSESSOR_PROMPT_VERSION,
      text: ASSESSOR_SYSTEM_PROMPT,
    },
    coach: {
      code: COACH_PROMPT_CODE,
      version: COACH_PROMPT_VERSION,
      text: COACH_SYSTEM_PROMPT,
    },
    memory_curator: {
      code: MEMORY_CURATOR_PROMPT_CODE,
      version: MEMORY_CURATOR_PROMPT_VERSION,
      text: MEMORY_CURATOR_SYSTEM_PROMPT,
    },
    summariser: {
      code: SUMMARISER_PROMPT_CODE,
      version: SUMMARISER_PROMPT_VERSION,
      text: SUMMARISER_SYSTEM_PROMPT,
    },
  },
  modelRouting: {
    orchestrator: {
      text: {
        premium: { ...GPT5, effort: 'low' },
        degraded: { ...GPT5_MINI, effort: 'low' },
        lite: { ...GPT5_MINI, effort: 'low' },
      },
      // Voice answers on the faster model at every tier: the reply is heard
      // as it streams, and a long pause reads as Ally not listening.
      voice: {
        premium: { ...GPT5_MINI, effort: 'low' },
        degraded: { ...GPT5_MINI, effort: 'low' },
        lite: { ...GPT5_MINI, effort: 'low' },
      },
    },
    sentinel: { text: { premium: { ...GPT5_MINI, effort: 'low' } } },
    tutor: {
      text: {
        premium: { ...GPT5, effort: 'low' },
        degraded: GPT5_MINI,
        lite: GPT5_MINI,
      },
    },
    coach: {
      text: {
        premium: { ...GPT5, effort: 'low' },
        degraded: GPT5_MINI,
        lite: GPT5_MINI,
      },
    },
    assessor: {
      text: {
        premium: { ...GPT5, effort: 'low' },
        degraded: GPT5_MINI,
        lite: GPT5_MINI,
      },
    },
    memory_curator: { text: { premium: { ...GPT5, effort: 'low' } } },
    summariser: { text: { premium: { ...GPT5_MINI, effort: 'low' } } },
    outreach_writer: { text: { premium: { ...GPT5, effort: 'low' } } },
    evaluator_critic: { text: { premium: { ...GPT5, effort: 'low' } } },
    evaluator_verifier: { text: { premium: GEMINI_PRO } },
    red_team: { text: { premium: { ...GPT5, effort: 'medium' } } },
    curator: { text: { premium: { ...GPT5, effort: 'medium' } } },
  },
  capabilities: {
    present_course_item: true,
    show_course_info: true,
    get_progress: true,
    mark_reflection_done: true,
    show_wellbeing_resources: true,
    set_guidance: true,
    consult_tutor: true,
    consult_coach: true,
    consult_assessor: true,
    get_peer_signals: true,
    search_library: true,
    load_skill: true,
  },
  skills: Object.fromEntries(GUIDE_SKILL_IDS.map((id) => [id, true])),
  skillDefs: GUIDE_DEFAULT_SKILL_DEFS,
  policy: GUIDE_DEFAULT_POLICY,
  lessonSnapshot: [],
};
