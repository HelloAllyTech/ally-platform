import {
  PolicyLayerInput,
  PolicyValues,
  ResolvedPolicyValues,
  applyPolicyValues,
  flattenPolicy,
  resolvePolicyValues,
} from 'src/llm-agent/harness/config/policy-schema';
import { GuideLearnerPrefsValue } from '../entity/guide-learner-prefs.entity';
import { GuideEpochConfig } from '../entity/guide-thread.entity';
import { GuideMode } from '../enum/guide.enum';
import { GuidePolicy } from '../release/guide-release.bundle';
import { GUIDE_POLICY_SCHEMA } from '../release/policy.schema';

/**
 * Ally's configuration plane, pure half (plans/ally-guide/plan.md §7.5):
 *
 *   release defaults → org → course → learner prefs → runtime
 *
 * The org and course layers are FROZEN into the epoch snapshot when an epoch
 * begins (`GuideEpochConfig`), so an admin's change reaches a conversation at
 * its next epoch and never shifts the rules mid-exchange. The learner layer
 * (their own switches) and the runtime layer (mode, visitor) are read every
 * turn: they are the learner's and the moment's, and must act at once.
 */

export type { GuideEpochConfig };

export interface GuideConfigRuntime {
  mode: GuideMode;
  visitor: boolean;
}

export interface ResolvedGuideConfig {
  policy: GuidePolicy;
  resolved: ResolvedPolicyValues;
}

const SIDE_QUEST_KEYS = [
  'sideQuestCadence.lead',
  'sideQuestCadence.walk',
  'sideQuestCadence.drive',
] as const;

const sideQuestsOff = (): PolicyValues =>
  Object.fromEntries(SIDE_QUEST_KEYS.map((key) => [key, null]));

/** The release's own values, restricted to declared keys. */
export function releaseLayer(policy: GuidePolicy): PolicyLayerInput {
  const flat = flattenPolicy(policy);
  const values: PolicyValues = {};
  for (const key of Object.keys(GUIDE_POLICY_SCHEMA)) {
    if (key in flat) values[key] = flat[key] as PolicyValues[string];
  }
  return { layer: 'release', values };
}

/**
 * What the learner's own switches decide. Side quests off means none are
 * offered, whatever the course or organisation allows (plan §4.11: side
 * quests can be switched off). The guidance dial is not a value here: it
 * chooses which of `prose.maxWords.*` and `sideQuestCadence.*` applies.
 */
export function learnerLayer(
  prefs: GuideLearnerPrefsValue | null | undefined,
): PolicyLayerInput | null {
  if (prefs?.sideQuests === false) {
    return {
      layer: 'learner',
      values: sideQuestsOff(),
      reason: 'the learner switched side quests off',
    };
  }
  return null;
}

/** What the moment decides: no side quests in a hard moment or for a visitor. */
export function runtimeLayer(
  runtime: GuideConfigRuntime,
): PolicyLayerInput | null {
  if (runtime.visitor) {
    return {
      layer: 'runtime',
      values: sideQuestsOff(),
      reason: 'anonymous visitor',
    };
  }
  if (runtime.mode !== GuideMode.NORMAL) {
    return {
      layer: 'runtime',
      values: sideQuestsOff(),
      reason: `mode ${runtime.mode}`,
    };
  }
  return null;
}

/** Resolve one turn's policy. Pure: same inputs, same answer. */
export function resolveGuidePolicy(input: {
  releasePolicy: GuidePolicy;
  epochConfig: GuideEpochConfig | null | undefined;
  prefs: GuideLearnerPrefsValue | null | undefined;
  runtime: GuideConfigRuntime;
}): ResolvedGuideConfig {
  const layers: PolicyLayerInput[] = [releaseLayer(input.releasePolicy)];
  if (input.epochConfig) {
    layers.push({ layer: 'org', values: input.epochConfig.org ?? {} });
    layers.push({ layer: 'course', values: input.epochConfig.course ?? {} });
  }
  const learner = learnerLayer(input.prefs);
  if (learner) layers.push(learner);
  const runtime = runtimeLayer(input.runtime);
  if (runtime) layers.push(runtime);

  const resolved = resolvePolicyValues(GUIDE_POLICY_SCHEMA, layers);
  const values: PolicyValues = {};
  for (const entry of Object.values(resolved.entries)) {
    values[entry.key] = entry.value;
  }
  return {
    policy: applyPolicyValues(input.releasePolicy, values),
    resolved,
  };
}

/**
 * The thread's policy outside a turn (bootstrap, progress events): the
 * release, plus the org and course layers frozen into its current epoch.
 * Turn-scoped layers are left out — nothing here decides a side quest.
 */
export function epochPolicy(
  releasePolicy: GuidePolicy,
  epochConfig: GuideEpochConfig | null | undefined,
): GuidePolicy {
  if (!epochConfig) return releasePolicy;
  return resolveGuidePolicy({
    releasePolicy,
    epochConfig,
    prefs: null,
    runtime: { mode: GuideMode.NORMAL, visitor: false },
  }).policy;
}
