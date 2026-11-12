import { NON_LEARNER_VISIBLE_PROMPTS } from './debrief-ladder.util';
import {
  DebriefBundle,
  DebriefRecipeKey,
  DebriefStep,
  DEBRIEF_ORCHESTRATOR_DEFAULT,
  DEBRIEF_SEED_BUNDLE,
  MANDATORY_STEPS,
  RecipeStep,
} from '../constants/debrief-release.constants';
import { PINNED_RULE_CODES } from './debrief-console-view.util';

/**
 * Pure rules behind the redesigned Releases page (PmReleases artboard): how a
 * harness status reads to people, what changed between two bundles, and
 * how a draft's steps are turned on and off. The live release is never
 * edited: every change is a draft that climbs the ladder.
 */

export type ReleaseDisplayStatus =
  | 'draft'
  | 'being_tested'
  | 'ready_to_go_live'
  | 'canary'
  | 'live'
  | 'retired';

/** The harness status as people read it; Shadow is shown as being tested. */
export function displayStatus(
  status: string,
  idea: { evidence?: Record<string, any> | null } | null,
): ReleaseDisplayStatus {
  const e = idea?.evidence ?? {};
  switch (status) {
    case 'ga':
      return 'live';
    case 'retired':
      return 'retired';
    case 'canary':
      return 'canary';
    case 'candidate':
      return 'ready_to_go_live';
    case 'evaluating':
    case 'shadow':
      return 'being_tested';
    default: {
      if (e.trial?.status === 'passed') return 'ready_to_go_live';
      const tried = ['screen', 'gate', 'trial'].some(
        (k) => e[k] && e[k].status !== 'off',
      );
      return tried ? 'being_tested' : 'draft';
    }
  }
}

export type RungState =
  | 'passed'
  | 'failed'
  | 'running'
  | 'waiting'
  | 'skipped'
  | 'off';

export interface LadderRung {
  rung: 'quick_test' | 'gate_test' | 'paired_trial' | 'canary';
  state: RungState;
  detail: string | null;
}

const rungState = (r: Record<string, any> | undefined): RungState => {
  if (!r) return 'waiting';
  if (r.status === 'running') return 'running';
  if (r.status === 'waiting') return 'waiting';
  if (r.status === 'off') return 'off';
  if (r.status === 'failed' || r.passed === false) return 'failed';
  if (
    r.passed === true ||
    ['passed', 'promoted'].includes(String(r.status ?? ''))
  ) {
    return 'passed';
  }
  if (r.status === 'reverted') return 'failed';
  return 'waiting';
};

/**
 * The ladder as the Evidence panel draws it, from the idea's evidence. A
 * release with no idea skipped the ladder (a seed release, or one a person
 * made before releases went through it); the reason says which.
 */
export function ladderOf(
  idea: { evidence?: Record<string, any> | null } | null,
  skippedBecause: string | null,
): LadderRung[] {
  const rungs: Array<[LadderRung['rung'], string]> = [
    ['quick_test', 'screen'],
    ['gate_test', 'gate'],
    ['paired_trial', 'trial'],
    ['canary', 'canary'],
  ];
  if (!idea) {
    return rungs.map(([rung]) => ({
      rung,
      state: 'skipped',
      detail: skippedBecause,
    }));
  }
  const e = idea.evidence ?? {};
  return rungs.map(([rung, key]) => {
    const r = e[key] as Record<string, any> | undefined;
    let detail: string | null = null;
    if (r) {
      if (key === 'screen' || key === 'gate') {
        detail =
          r.cases != null
            ? `${r.pairs ?? 0} of ${r.cases} cases scored${r.lift != null ? `, lift ${Number(r.lift).toFixed(2)}` : ''}`
            : (r.error ?? null);
      } else if (key === 'trial') {
        detail =
          r.comparisons != null
            ? `${r.comparisons} comparisons${r.wins != null ? `, better on ${r.wins}, worse on ${r.losses ?? 0}` : ''}`
            : null;
      } else {
        detail =
          r.canaryRuns != null
            ? `${r.canaryRuns} live debriefs${r.reason ? ` · ${r.reason}` : ''}`
            : (r.reason ?? null);
      }
    }
    return { rung, state: rungState(r), detail };
  });
}

/** Settings a person changes through Budgets: they don't change what learners read. */
export const BUDGET_SETTING_KEYS = [
  'runCeilingUsd',
  'runFloorUsd',
  'poolPerSessionUsd',
  'monthlyCapUsd',
] as const;

export interface BundleDiff {
  prompts: Array<{
    code: string;
    before: number | null;
    after: number | null;
    pinned: boolean;
  }>;
  settings: Array<{ key: string; before: unknown; after: unknown }>;
  recipes: Array<{ recipe: string; before: unknown; after: unknown }>;
  steps: Array<{
    step: string;
    field: 'enabled' | 'model' | 'backupModel';
    before: unknown;
    after: unknown;
  }>;
  reply: { before: unknown; after: unknown } | null;
  orchestrator: { before: unknown; after: unknown } | null;
  /** Only budget settings changed: the change does not alter what learners read. */
  budgetOnly: boolean;
  /**
   * Spec §4: whether learners could see a difference. False when the change
   * touches only prompts no learner-facing step runs (the judge's, the PM
   * agent's) and budget settings; such a change skips the canary.
   */
  learnerVisible: boolean;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Each step's model, backup and presence across the bundle's recipes. */
export function stepsOf(
  b: Partial<DebriefBundle>,
): Map<string, { model: string | null; backupModel: string | null }> {
  const out = new Map<
    string,
    { model: string | null; backupModel: string | null }
  >();
  for (const recipe of Object.values(b.recipes ?? {})) {
    for (const s of recipe?.steps ?? []) {
      if (!out.has(s.step)) {
        out.set(s.step, {
          model: s.model ?? null,
          backupModel: s.backupModel ?? null,
        });
      }
    }
  }
  for (const a of b.orchestrator?.agents ?? []) {
    const key = `agent:${a.id}`;
    if (!out.has(key)) {
      out.set(key, {
        model: a.model ?? null,
        backupModel: a.backupModel ?? null,
      });
    }
  }
  return out;
}

/** What changed from `before` to `after`, release to release. */
export function bundleDiff(
  before: Partial<DebriefBundle> | null,
  after: Partial<DebriefBundle>,
): BundleDiff {
  const b = before ?? {};
  const codes = new Set([
    ...Object.keys(b.prompts ?? {}),
    ...Object.keys(after.prompts ?? {}),
  ]);
  const prompts = [...codes]
    .filter((c) => !same(b.prompts?.[c], after.prompts?.[c]))
    .map((code) => ({
      code,
      before: b.prompts?.[code] ?? null,
      after: after.prompts?.[code] ?? null,
      pinned: PINNED_RULE_CODES.has(code),
    }));
  const keys = new Set([
    ...Object.keys(b.settings ?? {}),
    ...Object.keys(after.settings ?? {}),
  ]);
  const settings = [...keys]
    .filter(
      (k) =>
        !same(
          (b.settings as Record<string, unknown> | undefined)?.[k],
          (after.settings as Record<string, unknown> | undefined)?.[k],
        ),
    )
    .map((key) => ({
      key,
      before: (b.settings as Record<string, unknown> | undefined)?.[key],
      after: (after.settings as Record<string, unknown> | undefined)?.[key],
    }));
  const recipeKeys = new Set([
    ...Object.keys(b.recipes ?? {}),
    ...Object.keys(after.recipes ?? {}),
  ]);
  const shape = (r: any) =>
    r
      ? {
          steps: (r.steps ?? []).map((s: RecipeStep) => s.step),
          maxRevisionRounds: r.maxRevisionRounds,
          shortForm: r.shortForm,
        }
      : null;
  const recipes = [...recipeKeys]
    .filter(
      (k) =>
        !same(
          shape((b.recipes as any)?.[k]),
          shape((after.recipes as any)?.[k]),
        ),
    )
    .map((recipe) => ({
      recipe,
      before: shape((b.recipes as any)?.[recipe]),
      after: shape((after.recipes as any)?.[recipe]),
    }));
  const sb = stepsOf(b);
  const sa = stepsOf(after);
  const steps: BundleDiff['steps'] = [];
  for (const step of new Set([...sb.keys(), ...sa.keys()])) {
    const x = sb.get(step);
    const y = sa.get(step);
    if (!!x !== !!y) {
      steps.push({ step, field: 'enabled', before: !!x, after: !!y });
      continue;
    }
    if (x && y) {
      if (x.model !== y.model) {
        steps.push({ step, field: 'model', before: x.model, after: y.model });
      }
      if (x.backupModel !== y.backupModel) {
        steps.push({
          step,
          field: 'backupModel',
          before: x.backupModel,
          after: y.backupModel,
        });
      }
    }
  }
  const reply = same(b.reply, after.reply)
    ? null
    : { before: b.reply ?? null, after: after.reply ?? null };
  const orchestrator = same(
    { ...(b.orchestrator ?? {}), agents: undefined },
    { ...(after.orchestrator ?? {}), agents: undefined },
  )
    ? null
    : {
        before: b.orchestrator
          ? { ...b.orchestrator, agents: undefined }
          : null,
        after: after.orchestrator
          ? { ...after.orchestrator, agents: undefined }
          : null,
      };
  const budgetOnly =
    settings.length > 0 &&
    settings.every((s) =>
      (BUDGET_SETTING_KEYS as readonly string[]).includes(s.key),
    ) &&
    !prompts.length &&
    !recipes.length &&
    !steps.length &&
    !reply &&
    !orchestrator;
  const learnerVisible = !(
    prompts.length > 0 &&
    prompts.every((x) => NON_LEARNER_VISIBLE_PROMPTS.includes(x.code)) &&
    settings.every((x) =>
      (BUDGET_SETTING_KEYS as readonly string[]).includes(x.key),
    ) &&
    !recipes.length &&
    !steps.length &&
    !reply &&
    !orchestrator
  );
  return {
    learnerVisible,
    prompts,
    settings,
    recipes,
    steps,
    reply,
    orchestrator,
    budgetOnly,
  };
}

/** Recipe steps a person may turn off on a draft; the mandatory ones and the judge are fixed. */
export const OPTIONAL_STEPS: readonly DebriefStep[] = [
  DebriefStep.ANALYST,
  DebriefStep.PROGRESS_READER,
  DebriefStep.GUIDANCE_LOOKUP,
  DebriefStep.REVISER,
];

export function isFixedStep(step: string): boolean {
  return (
    step === 'judge' || (MANDATORY_STEPS as readonly string[]).includes(step)
  );
}

export interface StepEdit {
  /** A recipe step (`writer`) or an orchestrator agent (`agent:protocol_check`). */
  step: string;
  enabled?: boolean;
  model?: string | null;
  backupModel?: string | null;
}

/**
 * Apply step edits to a draft's bundle (a copy). Turning a recipe step off
 * removes it from every recipe (the Reviser also sets revision rounds to 0);
 * on puts it back where the seed recipe has it. An orchestrator agent is
 * added to or removed from the planner's list. Mandatory steps and the judge
 * are fixed. Returns the new bundle or the reason it is refused; the bundle
 * is then checked by `validateDebriefBundle` like every release.
 */
export function applyStepEdits(
  bundle: DebriefBundle,
  edits: StepEdit[],
): { bundle: DebriefBundle } | { problem: string } {
  const next = JSON.parse(JSON.stringify(bundle)) as DebriefBundle;
  for (const e of edits) {
    if (isFixedStep(e.step) && e.enabled === false) {
      return { problem: `${e.step} is fixed and cannot be turned off` };
    }
    if (e.step === 'judge') {
      return { problem: "the judge's model is pinned (never-list)" };
    }
    if (e.step.startsWith('agent:')) {
      const id = e.step.slice('agent:'.length);
      if (!next.orchestrator) {
        return {
          problem: 'this release has no orchestrator; agents are off',
        };
      }
      const agents = next.orchestrator.agents;
      const at = agents.findIndex((a) => a.id === id);
      if (e.enabled === false && at >= 0) agents.splice(at, 1);
      if (e.enabled === true && at < 0) {
        const seed = DEBRIEF_ORCHESTRATOR_DEFAULT.agents.find(
          (a) => a.id === id,
        );
        if (!seed) return { problem: `${id} is not a registry agent` };
        agents.push({ ...seed });
      }
      const a = agents.find((x) => x.id === id);
      if (a && e.model !== undefined) a.model = e.model;
      if (a && e.backupModel !== undefined) a.backupModel = e.backupModel;
      continue;
    }
    if (!(Object.values(DebriefStep) as string[]).includes(e.step)) {
      return { problem: `${e.step} is not a step` };
    }
    for (const [key, recipe] of Object.entries(next.recipes)) {
      if (!recipe) continue;
      const at = recipe.steps.findIndex((s) => s.step === e.step);
      if (e.enabled === false && at >= 0) {
        recipe.steps.splice(at, 1);
        if (e.step === DebriefStep.REVISER) recipe.maxRevisionRounds = 0;
      }
      if (e.enabled === true && at < 0) {
        const seed = (
          DEBRIEF_SEED_BUNDLE.recipes as Record<string, typeof recipe>
        )[key];
        const seedAt = seed?.steps.findIndex((s) => s.step === e.step) ?? -1;
        if (seedAt < 0) continue; // the seed's recipe never runs it
        const def = { ...seed!.steps[seedAt] };
        // Insert after the step the seed has before it.
        const prevStep = seed!.steps[seedAt - 1]?.step;
        const after = recipe.steps.findIndex((s) => s.step === prevStep);
        recipe.steps.splice(after + 1, 0, def);
        if (e.step === DebriefStep.REVISER && recipe.maxRevisionRounds === 0) {
          recipe.maxRevisionRounds = seed!.maxRevisionRounds || 1;
        }
      }
      const s = recipe.steps.find((x) => x.step === e.step);
      if (s && e.model !== undefined) s.model = e.model;
      if (s && e.backupModel !== undefined) s.backupModel = e.backupModel;
    }
  }
  return { bundle: next };
}

export const RECIPE_LABELS: Record<string, string> = {
  [DebriefRecipeKey.STANDARD]: 'Standard',
  [DebriefRecipeKey.SHORT]: 'Short',
  [DebriefRecipeKey.CASE]: 'Case',
  [DebriefRecipeKey.ASSESSMENT]: 'Assessment',
};

/** A prompt code as people say it: `debrief_writer_system` → "Writer". */
export function promptLabel(code: string): string {
  const known: Record<string, string> = {
    debrief_safety_reader_system: 'Safety reader',
    debrief_analyst_system: 'Analyst',
    debrief_progress_reader_system: 'Progress reader',
    debrief_writer_system: 'Writer',
    debrief_reviser_system: 'Reviser',
    debrief_quality_rubric: 'Rubric',
    debrief_improver_system: 'PM agent',
    debrief_reply_system: 'Ask Ally',
    debrief_planner_system: 'Planner',
    debrief_protocol_check_system: 'Protocol check',
    debrief_history_deep_system: 'History (deep)',
    debrief_language_specialist_system: 'Language specialist',
    debrief_quality_judge_system: 'Judge',
  };
  if (known[code]) return known[code];
  const words = code
    .replace(/^debrief_/, '')
    .replace(/_system$/, '')
    .split('_');
  const w = words.join(' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** A step key as people say it: `progress_reader` → "Progress reader", `agent:protocol_check` → "Protocol check". */
export function stepLabel(step: string): string {
  if (step === 'ask_ally') return 'Ask Ally';
  const w = step.replace(/^agent:/, '').replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * The part of a prompt that changed, with a little context either side: the
 * common start and end are trimmed. For release notes; the full texts are in
 * the compare view.
 */
export function changedExcerpt(
  before: string | null,
  after: string | null,
  context = 60,
  max = 400,
): { before: string | null; after: string | null } {
  if (before == null || after == null) {
    return {
      before: before?.slice(0, max) ?? null,
      after: after?.slice(0, max) ?? null,
    };
  }
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  const from = Math.max(0, start - context);
  const cut = (t: string) => {
    const to = Math.min(t.length, t.length - end + context);
    const piece = t.slice(from, to);
    const text = (from > 0 ? '…' : '') + piece + (to < t.length ? '…' : '');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };
  return { before: cut(before), after: cut(after) };
}

/**
 * The bundle a release really runs (plan §8.8): every prompt it left
 * unpinned resolved to the exact version recorded when it was created
 * (`changeSet.pinnedPrompts`). Rolling back to it therefore restores those
 * versions, whatever the Skills Store serves now.
 */
export function withPinnedPrompts<
  T extends { prompts?: Record<string, number | null> },
>(bundle: T, pins: Record<string, number> | null | undefined): T {
  if (!pins || !bundle?.prompts) return bundle;
  const prompts = { ...bundle.prompts };
  for (const [code, v] of Object.entries(prompts)) {
    if (v == null && pins[code] != null) prompts[code] = pins[code];
  }
  return { ...bundle, prompts };
}
