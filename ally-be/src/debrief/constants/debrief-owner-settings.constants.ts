/**
 * Every threshold the PM agent's test ladder and the learning budget use, as
 * owner settings (v9 FR-60). Defaults are v9's; the baseline job proposes
 * values from production data and a person accepts them. A budget setting
 * never changes without a person (`budget: true`).
 */

export type OwnerSettingKind = 'int' | 'number' | 'share' | 'bool' | 'text';

export interface OwnerSettingSpec {
  default: number | boolean | string;
  kind: OwnerSettingKind;
  min?: number;
  max?: number;
  /** A budget head: only a person changes it, and the Console asks to confirm. */
  budget?: boolean;
  group:
    | 'quick'
    | 'gate'
    | 'sealed'
    | 'trials'
    | 'canary'
    | 'budget'
    | 'metrics'
    | 'agent'
    | 'progress'
    | 'score'
    | 'autonomy'
    | 'rollout'
    | 'slack';
  /** For text settings: the longest value accepted. */
  maxLength?: number;
}

export const OWNER_SETTINGS_SPEC = {
  // 1. Quick test on the open set.
  quickTestCases: {
    default: 30,
    kind: 'int',
    min: 10,
    max: 200,
    group: 'quick',
  },
  quickTestMinLift: {
    default: 0.2,
    kind: 'number',
    min: 0,
    max: 3,
    group: 'quick',
  },
  // 2. Full test on the gate set, rotated monthly.
  gateCases: { default: 100, kind: 'int', min: 20, max: 500, group: 'gate' },
  gateRotationShare: {
    default: 0.25,
    kind: 'share',
    min: 0,
    max: 0.5,
    group: 'gate',
  },
  gateNoNewHardFails: { default: true, kind: 'bool', group: 'gate' },
  gateJudgeMedianNotLower: { default: true, kind: 'bool', group: 'gate' },
  gateMaxCostIncreasePct: {
    default: 10,
    kind: 'number',
    min: 0,
    max: 100,
    group: 'gate',
  },
  // 5. Monthly re-run of the sealed set.
  sealedCases: { default: 60, kind: 'int', min: 20, max: 300, group: 'sealed' },
  // 3. Paired trials on production sessions.
  pairedMinComparisons: {
    default: 30,
    kind: 'int',
    min: 10,
    max: 1000,
    group: 'trials',
  },
  pairedConfidence: {
    default: 0.95,
    kind: 'share',
    min: 0.8,
    max: 0.99,
    group: 'trials',
  },
  probeCapPerSessionUsd: {
    default: 0.5,
    kind: 'number',
    min: 0,
    max: 5,
    budget: true,
    group: 'trials',
  },
  // 4. Canary to real learners in switched-on organisations.
  canaryShare: {
    default: 0.1,
    kind: 'share',
    min: 0.01,
    max: 0.3,
    group: 'canary',
  },
  canaryMinRuns: {
    default: 40,
    kind: 'int',
    min: 5,
    max: 1000,
    group: 'canary',
  },
  canaryMinDays: { default: 3, kind: 'int', min: 1, max: 30, group: 'canary' },
  // The learning budget: a fixed monthly amount plus a skim of every run's ceiling.
  learningBudgetUsd: {
    default: 150,
    kind: 'number',
    min: 0,
    max: 5000,
    budget: true,
    group: 'budget',
  },
  learningSkimPct: {
    default: 0.2,
    kind: 'share',
    min: 0,
    max: 0.5,
    budget: true,
    group: 'budget',
  },
  // Metrics (v9 §3.3): the weekly steering proxy's weights, normalised by
  // their sum, and how soon a learner's flag should be reviewed.
  steeringWeightJudge: {
    default: 0.5,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'metrics',
  },
  steeringWeightPractise: {
    default: 0.25,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'metrics',
  },
  steeringWeightThumbs: {
    default: 0.25,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'metrics',
  },
  flagReviewSlaHours: {
    default: 24,
    kind: 'int',
    min: 1,
    max: 168,
    group: 'metrics',
  },
  // The PM agent's master switch (v9 FR-55): off runs nothing. On, it starts
  // quick checks, pass tests and side-by-side trials on its own (learners
  // never see them; decided 2026-11-12, so the old `pmAgentStartsQuickTests`
  // switch is gone, migration 1981900910000). Learner try-outs follow the
  // autonomy policy (DebriefAutonomyService); live for everyone, Builder
  // hand-offs and bug reports always wait for a person.
  pmAgentEnabled: { default: true, kind: 'bool', group: 'agent' },
  // What one PM agent run may spend on its own model calls, inside the
  // learning budget.
  pmAgentRunCapUsd: {
    default: 5,
    kind: 'number',
    min: 0.5,
    max: 50,
    budget: true,
    group: 'agent',
  },
  // Agent logs keep each model call's exact input and reply, which hold learner quotes. The
  // retention job (Settings › Schedules, shipped OFF) clears those two fields on rows older than
  // this many days and keeps the tokens, cost, timing and step name.
  agentLogRetentionDays: {
    default: 90,
    kind: 'int',
    min: 7,
    max: 3650,
    group: 'agent',
  },
  // Learner progress in debriefs. On by default: only
  // organisations switched on for the Debrief agent run it anyway. The card
  // ("Your last n sessions") shows every `progressCardEvery`th eligible
  // session; the agent looks back over `progressWindow` published debriefs.
  progressOn: { default: true, kind: 'bool', group: 'progress' },
  progressCardEvery: {
    default: 5,
    kind: 'int',
    min: 1,
    max: 20,
    group: 'progress',
  },
  progressWindow: {
    default: 6,
    kind: 'int',
    min: 3,
    max: 12,
    group: 'progress',
  },
  progressUseFhs: { default: true, kind: 'bool', group: 'progress' },
  progressShowWorseToLearners: {
    default: false,
    kind: 'bool',
    group: 'progress',
  },
  // The nightly check (v9 FR-49): when a day's debriefs count as drifting.
  nightlyLengthCreepShare: {
    default: 0.2,
    kind: 'share',
    min: 0.05,
    max: 1,
    group: 'metrics',
  },
  nightlySamenessMax: {
    default: 0.6,
    kind: 'share',
    min: 0.2,
    max: 0.95,
    group: 'metrics',
  },
  nightlySpecificityDrop: {
    default: 0.5,
    kind: 'number',
    min: 0.1,
    max: 3,
    group: 'metrics',
  },
  nightlyGapMax: {
    default: 1,
    kind: 'number',
    min: 0.2,
    max: 5,
    group: 'metrics',
  },
  // The weekly re-score of the anchor set: drift beyond this re-locks autonomy.
  judgeDriftMax: {
    default: 0.3,
    kind: 'number',
    min: 0.1,
    max: 2,
    group: 'metrics',
  },
  judgeAnchorSize: {
    default: 40,
    kind: 'int',
    min: 10,
    max: 200,
    group: 'metrics',
  },
  // The cumulative score (v2 S1): each run's and each slice's score is the
  // weighted mean of its measures, re-normalised over the measures that have
  // data. The flag rate counts the other way (fewer flags is better).
  scoreWeightQuality: {
    default: 0.4,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'score',
  },
  scoreWeightPass: {
    default: 0.25,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'score',
  },
  scoreWeightHelpful: {
    default: 0.2,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'score',
  },
  scoreWeightFlags: {
    default: 0.15,
    kind: 'share',
    min: 0,
    max: 1,
    group: 'score',
  },
  // After a change goes live for everyone (v2 A4, A5): it is watched for
  // `watchDays`, and undone on its own when its score falls by more than
  // `undoMargin` (on the 0–10 score) against the release before.
  undoMargin: {
    default: 0.3,
    kind: 'number',
    min: 0.05,
    max: 3,
    group: 'rollout',
  },
  watchDays: { default: 14, kind: 'int', min: 1, max: 60, group: 'rollout' },
  // "Always asks a person" (v2 A1). Pinned rules, crisis lines and support
  // copy, and budget increases always ask: they are not settings.
  askLowConfidence: { default: true, kind: 'bool', group: 'autonomy' },
  askModels: { default: false, kind: 'bool', group: 'autonomy' },
  // Slack (v2 K1): the channel for undos, measures past their limit and the
  // weekly summary; the named person safety posts mention. Empty = no post.
  slackChannel: { default: '', kind: 'text', maxLength: 80, group: 'slack' },
  safetyContact: {
    default: '',
    kind: 'text',
    maxLength: 120,
    group: 'slack',
  },
} as const satisfies Record<string, OwnerSettingSpec>;

export type OwnerSettingKey = keyof typeof OWNER_SETTINGS_SPEC;
export type OwnerSettings = {
  [K in OwnerSettingKey]: (typeof OWNER_SETTINGS_SPEC)[K]['default'] extends boolean
    ? boolean
    : (typeof OWNER_SETTINGS_SPEC)[K]['default'] extends string
      ? string
      : number;
};

/**
 * The test settings (Settings › Tests, v2 A10): the PM agent tunes them from
 * the baseline as ordinary setting changes; nobody accepts them. The learner
 * try-out's rollout rules and every budget stay the owner's.
 */
export const TEST_SETTING_KEYS: readonly OwnerSettingKey[] = [
  'quickTestCases',
  'quickTestMinLift',
  'gateCases',
  'gateRotationShare',
  'sealedCases',
  'pairedMinComparisons',
  'pairedConfidence',
];

/** Who last changed a setting, when, why, and the change it belongs to (Settings › Tests). */
export interface OwnerSettingChange {
  lastChangedBy: string;
  lastChangedById: number | null;
  lastChangedAt: string;
  why: string | null;
  changeId: string | null;
}

export const OWNER_SETTING_KEYS = Object.keys(
  OWNER_SETTINGS_SPEC,
) as OwnerSettingKey[];

/** v9 FR-55's modes: the master switch alone (propose-only was retired 2026-11-12). */
export type PmAgentAutonomy = 'auto' | 'off';

export function pmAgentAutonomy(s: {
  pmAgentEnabled: boolean;
}): PmAgentAutonomy {
  return s.pmAgentEnabled ? 'auto' : 'off';
}

export function defaultOwnerSettings(): OwnerSettings {
  return Object.fromEntries(
    OWNER_SETTING_KEYS.map((k) => [k, OWNER_SETTINGS_SPEC[k].default]),
  ) as OwnerSettings;
}

/** The reason a value is refused for a key, or null when it is acceptable. */
export function ownerSettingProblem(
  key: string,
  value: unknown,
): string | null {
  const spec = (OWNER_SETTINGS_SPEC as Record<string, OwnerSettingSpec>)[key];
  if (!spec) return `${key} is not a setting`;
  if (spec.kind === 'bool') {
    return typeof value === 'boolean' ? null : `${key} must be true or false`;
  }
  if (spec.kind === 'text') {
    if (typeof value !== 'string') return `${key} must be text`;
    if (value.length > (spec.maxLength ?? 200)) {
      return `${key} must be at most ${spec.maxLength ?? 200} characters`;
    }
    // One line: a channel (#name or id) or a person (a name, or a Slack
    // mention such as <@U0123ABC>).
    if (/[\r\n]/.test(value)) return `${key} must be one line`;
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${key} must be a number`;
  }
  if (spec.kind === 'int' && !Number.isInteger(value)) {
    return `${key} must be a whole number`;
  }
  if (spec.min != null && value < spec.min) {
    return `${key} must be at least ${spec.min}`;
  }
  if (spec.max != null && value > spec.max) {
    return `${key} must be at most ${spec.max}`;
  }
  return null;
}

/** One proposed value from the baseline job, with the reasoning beside it. */
export interface OwnerSettingProposal {
  value: number | boolean | string;
  reason: string;
  /** The current value no longer fits the volume (it differs by over half). */
  misfit: boolean;
}

export interface OwnerSettingsBaseline {
  ranAt: string;
  facts: Record<string, unknown>;
  proposals: Partial<Record<OwnerSettingKey, OwnerSettingProposal>>;
}
