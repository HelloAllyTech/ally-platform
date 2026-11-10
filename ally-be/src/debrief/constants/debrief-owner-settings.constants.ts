/**
 * Every threshold the PM agent's test ladder and the learning budget use, as
 * owner settings (v9 FR-60). Defaults are v9's; the baseline job proposes
 * values from production data and a person accepts them. A budget setting
 * never changes without a person (`budget: true`).
 */

export type OwnerSettingKind = 'int' | 'number' | 'share' | 'bool';

export interface OwnerSettingSpec {
  default: number | boolean;
  kind: OwnerSettingKind;
  min?: number;
  max?: number;
  /** A budget head: only a person changes it, and the Console asks to confirm. */
  budget?: boolean;
  group: 'quick' | 'gate' | 'sealed' | 'trials' | 'canary' | 'budget';
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
    default: 30,
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
} as const satisfies Record<string, OwnerSettingSpec>;

export type OwnerSettingKey = keyof typeof OWNER_SETTINGS_SPEC;
export type OwnerSettings = {
  [K in OwnerSettingKey]: (typeof OWNER_SETTINGS_SPEC)[K]['default'] extends boolean
    ? boolean
    : number;
};

export const OWNER_SETTING_KEYS = Object.keys(
  OWNER_SETTINGS_SPEC,
) as OwnerSettingKey[];

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
  value: number | boolean;
  reason: string;
  /** The current value no longer fits the volume (it differs by over half). */
  misfit: boolean;
}

export interface OwnerSettingsBaseline {
  ranAt: string;
  facts: Record<string, unknown>;
  proposals: Partial<Record<OwnerSettingKey, OwnerSettingProposal>>;
}
