/**
 * How much Builder does on its own, as one level rather than five switches.
 *
 * "Design autonomy sliders to build user trust": expose autonomy as a
 * few clearly labelled levels with predictable behaviour at each, and make
 * moving between them one step. The switches stay underneath (and stay
 * settable on their own, which reads back as `custom`).
 */
export type BuilderAutonomyLevel = 'off' | 'assist' | 'auto_merge' | 'auto';
export const BUILDER_AUTONOMY_LEVELS: BuilderAutonomyLevel[] = [
  'off',
  'assist',
  'auto_merge',
  'auto',
];

interface AutonomySwitches {
  autoReviewEnabled: boolean;
  autoFixEnabled: boolean;
  autoApproveEnabled: boolean;
  autoMergeEnabled: boolean;
  autoReleaseEnabled: boolean;
}

const LEVELS: Record<BuilderAutonomyLevel, AutonomySwitches> = {
  off: {
    autoReviewEnabled: false,
    autoFixEnabled: false,
    autoApproveEnabled: false,
    autoMergeEnabled: false,
    autoReleaseEnabled: false,
  },
  assist: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: false,
    autoReleaseEnabled: false,
  },
  auto_merge: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: true,
    autoReleaseEnabled: false,
  },
  auto: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: true,
    autoReleaseEnabled: true,
  },
};

export const switchesForAutonomyLevel = (
  level: BuilderAutonomyLevel,
): AutonomySwitches => ({ ...LEVELS[level] });

export const autonomyLevelOf = (
  settings: AutonomySwitches,
): BuilderAutonomyLevel | 'custom' =>
  BUILDER_AUTONOMY_LEVELS.find((level) =>
    (Object.keys(LEVELS[level]) as (keyof AutonomySwitches)[]).every(
      (key) => Boolean(settings[key]) === LEVELS[level][key],
    ),
  ) ?? 'custom';

/** The level after this one, for suggesting it once it has been earned. */
export const nextAutonomyLevel = (
  level: BuilderAutonomyLevel | 'custom',
): 'auto_merge' | 'auto' | null =>
  level === 'assist' ? 'auto_merge' : level === 'auto_merge' ? 'auto' : null;

/**
 * A per-session autonomy override (BuilderSession.autonomyOverride). Only `auto` exists: the
 * PM Agent's sessions merge and release on their own while every other session keeps the
 * global switches. Stored as a column so it is visible and auditable on the session row.
 */
export type BuilderAutonomyOverride = 'auto';
export const BUILDER_AUTONOMY_OVERRIDES: BuilderAutonomyOverride[] = ['auto'];

/**
 * The switches that govern ONE session: the global settings, with the session's override
 * applied on top.
 *
 * The global kill switch always wins — an override never turns a disabled Builder back on,
 * and with `enabled` false the settings come back untouched. Every other field (spend caps,
 * fix-run ceiling, models) is the global value; only the five autonomy switches move.
 */
export const effectiveAutonomySettings = <
  T extends AutonomySwitches & { enabled: boolean },
>(
  settings: T,
  override: string | null | undefined,
): T => {
  if (!settings.enabled || override !== 'auto') return settings;
  return { ...settings, ...switchesForAutonomyLevel('auto') };
};
