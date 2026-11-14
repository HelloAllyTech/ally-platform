import {
  DEBRIEF_APPROVED_PROVIDERS,
  DebriefBundle,
  DebriefProvider,
  DebriefRecipeKey,
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
  /** Ask Ally's model is not on an allowed provider. */
  replyBlocked: boolean;
  /** The orchestrator was on and had to be switched off for this run. */
  orchestratorOff: boolean;
  /** Anything was changed at all. */
  changed: boolean;
}

/**
 * The release as one organisation may run it. Each step keeps its model when
 * the provider is allowed (dropping a disallowed backup), falls to its backup
 * when only that is allowed, and otherwise blocks its recipe: a run on a
 * blocked recipe goes to a person rather than to another company. The
 * orchestrator is switched off (today's fixed recipe runs) when any of its
 * models is disallowed. Every approved provider allowed → the bundle as is.
 */
export function restrictBundleToProviders(
  bundle: DebriefBundle,
  allowed: readonly DebriefProvider[],
): RestrictedBundle {
  const ok = (model: string | null | undefined) => {
    const p = providerOf(model);
    return p !== null && allowed.includes(p);
  };
  const none: RestrictedBundle = {
    bundle,
    blockedRecipes: [],
    blockedSteps: [],
    replyBlocked: false,
    orchestratorOff: false,
    changed: false,
  };
  if (DEBRIEF_APPROVED_PROVIDERS.every((p) => allowed.includes(p))) return none;

  const blockedRecipes: DebriefRecipeKey[] = [];
  const blockedSteps: string[] = [];
  const recipes = { ...bundle.recipes } as DebriefBundle['recipes'];
  for (const [key, recipe] of Object.entries(bundle.recipes)) {
    if (!recipe) continue;
    const steps = recipe.steps.map((s) => {
      if (ok(s.model)) {
        return s.backupModel && !ok(s.backupModel)
          ? { ...s, backupModel: null }
          : s;
      }
      if (s.backupModel && ok(s.backupModel)) {
        return { ...s, model: s.backupModel, backupModel: null };
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
