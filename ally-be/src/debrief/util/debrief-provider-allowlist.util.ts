import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import {
  DEBRIEF_APPROVED_PROVIDERS,
  DEBRIEF_MODELS,
  DebriefBundle,
  DebriefProvider,
  DebriefRecipeKey,
  DebriefStep,
  modelProblem,
  providerOfModel,
} from '../constants/debrief-release.constants';

/**
 * An organisation's model-provider allowlist (plan §8.9, v9 FR-57, Q12): when
 * its contract restricts providers, its learners' sessions — live runs,
 * paired-trial probes, Ask Ally — reach only the providers on this list.
 * Stored per provider as `providerAllowed.<provider>` on the org layer of the
 * Debrief agent's policy, so "not set" means allowed and every approved
 * provider is allowed until the owner says otherwise.
 */
export const PROVIDER_ALLOWED_KEY = (p: DebriefProvider) =>
  `providerAllowed.${p}`;

/**
 * What an organisation's allowlist is when it cannot be read: nothing. A learner's data must never
 * reach a provider the organisation's contract may forbid, so every reader fails closed through
 * this one value.
 */
export const ALLOWLIST_WHEN_UNREADABLE: DebriefProvider[] = [];

/** The allowlist from an org layer's stored values; every approved provider when nothing is set. */
export function allowlistFromValues(
  values: Record<string, unknown> | null | undefined,
): DebriefProvider[] {
  return DEBRIEF_APPROVED_PROVIDERS.filter(
    (p) => values?.[PROVIDER_ALLOWED_KEY(p)] !== false,
  );
}

/**
 * A step with no model of its own runs ally-ai's build default, and every
 * build default is a Gemini model (`DEBRIEF_MODELS`).
 */
const BUILD_DEFAULT_PROVIDER: DebriefProvider = 'gemini';

const providerOf = (
  model: string | null | undefined,
): DebriefProvider | null =>
  model ? providerOfModel(model) : BUILD_DEFAULT_PROVIDER;

export interface RestrictedBundle {
  bundle: DebriefBundle;
  /** Recipes that cannot run: a step has no model on an allowed provider. */
  blockedRecipes: DebriefRecipeKey[];
  /** The steps that made them so, as `recipe.step`. */
  blockedSteps: string[];
  /**
   * Steps whose own and backup models are both on providers the organisation
   * does not allow, given a priced model on an allowed provider instead, as
   * `recipe.step` → model. Only with substitutes offered.
   */
  substitutedSteps: Record<string, string>;
  /** Ask Ally's model is not on an allowed provider. */
  replyBlocked: boolean;
  /** The orchestrator was on and had to be switched off for this run. */
  orchestratorOff: boolean;
  /** Anything was changed at all. */
  changed: boolean;
}

/** A model's rough tier, from its id: the fast/cheap family or the strong one. */
export function modelTier(model: string | null | undefined): 'fast' | 'strong' {
  const id = (model ?? '').toLowerCase();
  return /(^|[-_.])(flash|mini|nano|lite|haiku)([-_.]|$)/.test(id)
    ? 'fast'
    : 'strong';
}

const inputPrice = (model: string): number =>
  computeCostUsd(model, 1_000_000, 0).costUsd;

/**
 * A model on an allowed provider to run a step whose own models are not
 * (2026-11-16, Gopi: the learner should get the debrief): one with a known
 * price that may run in a release, never the judge's pinned model, not the
 * model the evaluator must differ from, same tier as the step's own model
 * first, then the cheapest. Null when no candidate fits.
 */
export function substituteModel(
  stepModel: string | null | undefined,
  candidates: readonly string[],
  allowed: readonly DebriefProvider[],
  avoid: ReadonlyArray<string | null | undefined> = [],
): string | null {
  const tier = modelTier(stepModel);
  const fits = [...new Set(candidates)].filter((m) => {
    const p = providerOfModel(m);
    return (
      p !== null &&
      allowed.includes(p) &&
      modelProblem(m) === null &&
      m !== DEBRIEF_MODELS.judge &&
      !avoid.includes(m)
    );
  });
  fits.sort(
    (a, b) =>
      Number(modelTier(a) !== tier) - Number(modelTier(b) !== tier) ||
      inputPrice(a) - inputPrice(b) ||
      a.localeCompare(b),
  );
  return fits[0] ?? null;
}

/**
 * The release as one organisation may run it. Each step keeps its model when
 * the provider is allowed (dropping a disallowed backup), falls to its backup
 * when only that is allowed, then — when `substitutes` are offered (the
 * model catalogue) — to a priced model on an allowed provider, and otherwise
 * blocks its recipe. Learner data never reaches a provider the organisation
 * does not allow (plan §8.9, FR-57). The orchestrator is switched off
 * (today's fixed recipe runs) when any of its models is disallowed. Every
 * approved provider allowed → the bundle as is.
 */
export function restrictBundleToProviders(
  bundle: DebriefBundle,
  allowed: readonly DebriefProvider[],
  substitutes: readonly string[] = [],
): RestrictedBundle {
  const ok = (model: string | null | undefined) => {
    const p = providerOf(model);
    return p !== null && allowed.includes(p);
  };
  const none: RestrictedBundle = {
    bundle,
    blockedRecipes: [],
    blockedSteps: [],
    substitutedSteps: {},
    replyBlocked: false,
    orchestratorOff: false,
    changed: false,
  };
  if (DEBRIEF_APPROVED_PROVIDERS.every((p) => allowed.includes(p))) return none;

  const blockedRecipes: DebriefRecipeKey[] = [];
  const blockedSteps: string[] = [];
  const substitutedSteps: Record<string, string> = {};
  const recipes = { ...bundle.recipes } as DebriefBundle['recipes'];
  for (const [key, recipe] of Object.entries(bundle.recipes)) {
    if (!recipe) continue;
    const writerModel = recipe.steps.find(
      (s) => s.step === DebriefStep.WRITER,
    )?.model;
    const steps = recipe.steps.map((s) => {
      if (ok(s.model)) {
        return s.backupModel && !ok(s.backupModel)
          ? { ...s, backupModel: null }
          : s;
      }
      if (s.backupModel && ok(s.backupModel)) {
        return { ...s, model: s.backupModel, backupModel: null };
      }
      const sub = substituteModel(
        s.model,
        substitutes,
        allowed,
        // The evaluator never runs on the writer's model.
        s.step === DebriefStep.EVALUATOR
          ? [writerModel, substitutedSteps[`${key}.${DebriefStep.WRITER}`]]
          : [],
      );
      if (sub) {
        substitutedSteps[`${key}.${s.step}`] = sub;
        return { ...s, model: sub, backupModel: null };
      }
      blockedSteps.push(`${key}.${s.step}`);
      return s;
    });
    if (blockedSteps.some((b) => b.startsWith(`${key}.`))) {
      blockedRecipes.push(key as DebriefRecipeKey);
    }
    (recipes as Record<string, unknown>)[key] = { ...recipe, steps };
  }

  let orchestrator = bundle.orchestrator;
  let orchestratorOff = false;
  if (orchestrator?.enabled) {
    const planner = ok(orchestrator.plannerModel)
      ? orchestrator.plannerModel
      : ok(orchestrator.plannerBackupModel)
        ? (orchestrator.plannerBackupModel as string)
        : null;
    const agentsOk = (orchestrator.agents ?? []).every(
      (a) => ok(a.model) || (!!a.backupModel && ok(a.backupModel)),
    );
    if (!planner || !agentsOk) {
      orchestrator = { ...orchestrator, enabled: false };
      orchestratorOff = true;
    } else {
      orchestrator = {
        ...orchestrator,
        plannerModel: planner,
        plannerBackupModel:
          planner === orchestrator.plannerModel &&
          ok(orchestrator.plannerBackupModel)
            ? orchestrator.plannerBackupModel
            : null,
        agents: (orchestrator.agents ?? []).map((a) =>
          ok(a.model)
            ? { ...a, backupModel: ok(a.backupModel) ? a.backupModel : null }
            : { ...a, model: a.backupModel, backupModel: null },
        ),
      };
    }
  }

  return {
    bundle: {
      ...bundle,
      recipes,
      ...(orchestrator ? { orchestrator } : {}),
    },
    blockedRecipes,
    blockedSteps,
    substitutedSteps,
    replyBlocked: !!bundle.reply && !ok(bundle.reply.model),
    orchestratorOff,
    changed: true,
  };
}

/** Every model a bundle may call is on an allowed provider (for a challenger on a probe). */
export function bundleFitsProviders(
  bundle: DebriefBundle,
  allowed: readonly DebriefProvider[],
  recipe?: DebriefRecipeKey,
): boolean {
  const r = restrictBundleToProviders(bundle, allowed);
  return recipe
    ? !r.blockedRecipes.includes(recipe)
    : r.blockedRecipes.length === 0;
}
