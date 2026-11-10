/**
 * The Debrief agent's release bundle: recipes, the prompt versions they run,
 * the model for every step and the run settings.
 *
 * A release is an immutable `agent_releases` row (agentKey `debrief`), the same
 * harness the Ally guide uses, so promotion, rollback and the audit trail are
 * shared. The bundle below is version 1, seeded from code; every later version
 * comes from an approved Improver idea or a person, never from editing GA.
 *
 * Prompts live in the Skills Store. `prompts` pins each code to a version
 * number; `null` means "the store's current version", which is what the seed
 * uses so the first release runs whatever the store serves.
 */

import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';

export const DEBRIEF_AGENT_KEY = 'debrief';

/**
 * The gateway's approved providers (plan §8.9): learner data goes only to
 * providers under a zero-retention, no-training agreement. Adding one is a
 * person's decision, made here in code review.
 */
export const DEBRIEF_APPROVED_PROVIDERS = [
  'gemini',
  'openai',
  'anthropic',
] as const;
export type DebriefProvider = (typeof DEBRIEF_APPROVED_PROVIDERS)[number];

/** Which provider serves a model id; null for one no approved provider serves. */
export function providerOfModel(model: string): DebriefProvider | null {
  const id = model.replace(/^models\//, '').toLowerCase();
  if (id.startsWith('gemini')) return 'gemini';
  if (id.startsWith('claude')) return 'anthropic';
  if (/^(gpt-|o\d)/.test(id)) return 'openai';
  return null;
}

/**
 * Why a model may not run in a release, or null when it may: an approved
 * provider, a pinned id (no "-latest"), and a known price — a model whose
 * price is unknown is never used (v9 NFR-10, plan §8.9).
 */
export function modelProblem(model: string): string | null {
  if (!providerOfModel(model))
    return `${model} is not from an approved provider`;
  if (/latest/i.test(model)) return `${model} is not a pinned model id`;
  if (!computeCostUsd(model, 1, 1).priced) return `${model} has no known price`;
  return null;
}
/** Learning-loop calls (Improver, screens) are ledgered apart from production. */
export const DEBRIEF_LEARNING_AGENT_KEY = 'debrief_learning';

export enum DebriefStep {
  SAFETY_READER = 'safety_reader',
  ANALYST = 'analyst',
  PROGRESS_READER = 'progress_reader',
  GUIDANCE_LOOKUP = 'guidance_lookup',
  WRITER = 'writer',
  CHECKS = 'checks',
  EVALUATOR = 'evaluator',
  REVISER = 'reviser',
}

export enum DebriefRecipeKey {
  STANDARD = 'standard',
  SHORT = 'short',
  /** A session in a case: the client's earlier sessions are memory to respect. */
  CASE = 'case',
  /** A graded course roleplay: every point anchored, the grade never touched. */
  ASSESSMENT = 'assessment',
}

/** Recipes a release may leave out (made before they existed): Standard runs instead. */
export const OPTIONAL_RECIPES: readonly DebriefRecipeKey[] = [
  DebriefRecipeKey.CASE,
  DebriefRecipeKey.ASSESSMENT,
];

export interface RecipeStep {
  step: DebriefStep;
  model?: string | null;
  /** Another approved model, tried once when the first fails. */
  backupModel?: string | null;
  /** Shown in the learner's progress panel while the step runs. */
  label: string;
}

export interface DebriefRecipe {
  key: DebriefRecipeKey;
  steps: RecipeStep[];
  maxRevisionRounds: number;
  /** The Writer writes the short form: opening, important moment, one card. */
  shortForm: boolean;
}

export interface DebriefSettings {
  /** Learner turns at or above this get the Standard recipe. */
  standardMinLearnerTurns: number;
  passScore: number;
  runCeilingUsd: number;
  runFloorUsd: number;
  poolPerSessionUsd: number;
  monthlyCapUsd: number;
  deadlineMs: number;
  riskDeadlineMs: number;
  guidancePassagesPerMoment: number;
  /**
   * Retired with the Knowledge Base's similarity floor: Debrief Guidance answers in relevance
   * bands, not similarities. Releases made before it still carry the value; nothing reads it.
   */
  guidanceMinSimilarity?: number;
}

/** Ask Ally in conversation mode (v9 FR-43): part of the release, like every step. */
export interface DebriefReplyConfig {
  /** A provider the in-process chat can run. */
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  /** Room for a 120-word reply in an Indic script, which costs far more tokens than English. */
  maxTokens: number;
  /** v9 FR-43: dollars one reply may spend across its tool turns; default DEBRIEF_REPLY_BUDGET_USD. */
  budgetUsd?: number;
  /** v9 FR-43: model passes per reply, tool turns included; default DEBRIEF_REPLY_MAX_TURNS. */
  maxTurns?: number;
}

/** v9 FR-43 / NFR-2: an Ask Ally reply costs at most this. */
export const DEBRIEF_REPLY_BUDGET_USD = 0.05;
/** v9 FR-43: at most this many model passes per reply, the last never calling a tool. */
export const DEBRIEF_REPLY_MAX_TURNS = 4;

export interface DebriefBundle {
  /** Standard and Short always; Case and Assessment from the release that added them. */
  recipes: Partial<Record<DebriefRecipeKey, DebriefRecipe>> &
    Record<DebriefRecipeKey.STANDARD | DebriefRecipeKey.SHORT, DebriefRecipe>;
  prompts: Record<string, number | null>;
  settings: DebriefSettings;
  /** Absent in releases made before Ask Ally: the code default then applies. */
  reply?: DebriefReplyConfig;
}

export const DEBRIEF_PROMPT_CODES = {
  safetyReader: 'debrief_safety_reader_system',
  analyst: 'debrief_analyst_system',
  progressReader: 'debrief_progress_reader_system',
  writer: 'debrief_writer_system',
  reviser: 'debrief_reviser_system',
  rubric: 'debrief_quality_rubric',
  improver: 'debrief_improver_system',
  reply: 'debrief_reply_system',
} as const;

/** The on-topic check for reflection XP: a yes or no, cheap and fast. */
export const DEBRIEF_REFLECTION_CHECK_MODEL = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
} as const;

/** Ask Ally's default: fast first words matter more than depth for a reply. */
export const DEBRIEF_REPLY_DEFAULT: DebriefReplyConfig = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  maxTokens: 900,
};

/**
 * Prompts the Improver may propose edits to. The rubric and the Safety
 * reader are pinned (named people only), and the Improver's own instructions
 * change only through a person.
 */
export const IMPROVER_EDITABLE_PROMPTS: ReadonlySet<string> = new Set([
  DEBRIEF_PROMPT_CODES.analyst,
  DEBRIEF_PROMPT_CODES.progressReader,
  DEBRIEF_PROMPT_CODES.writer,
  DEBRIEF_PROMPT_CODES.reviser,
]);

/**
 * Settings the Improver may propose, each with the range it may move in. The
 * budget ceiling and cap are the owner's, and the deadlines are learner
 * promises, so neither is here.
 */
export const IMPROVER_SETTINGS: Record<string, { min: number; max: number }> = {
  maxRevisionRounds: { min: 0, max: 3 },
  guidancePassagesPerMoment: { min: 0, max: 3 },
  standardMinLearnerTurns: { min: 3, max: 10 },
};

/** Every step's model. Writer and Evaluator differ from each other and from the pinned judge. */
export const DEBRIEF_MODELS = {
  safetyReader: 'gemini-2.5-flash',
  analyst: 'gemini-2.5-pro',
  progressReader: 'gemini-2.5-flash',
  writer: 'gemini-3-flash-preview',
  // Only three Gemini models are priced, and 2.5-pro is the judge's. A run
  // that falls back to this shares the Evaluator's model; the run records it.
  writerBackup: 'gemini-2.5-flash',
  evaluator: 'gemini-2.5-flash',
  reviser: 'gemini-3-flash-preview',
  improver: 'gemini-2.5-pro',
  judge: 'gemini-2.5-pro',
} as const;

const step = (
  s: DebriefStep,
  label: string,
  model?: string,
  backupModel?: string,
): RecipeStep => ({
  step: s,
  label,
  model: model ?? null,
  backupModel: backupModel ?? null,
});

const SEED_RECIPES_BASE = {
  recipes: {
    [DebriefRecipeKey.STANDARD]: {
      key: DebriefRecipeKey.STANDARD,
      maxRevisionRounds: 2,
      shortForm: false,
      steps: [
        step(
          DebriefStep.SAFETY_READER,
          'Reading your session…',
          DEBRIEF_MODELS.safetyReader,
        ),
        step(
          DebriefStep.ANALYST,
          'Reading your session…',
          DEBRIEF_MODELS.analyst,
        ),
        step(
          DebriefStep.PROGRESS_READER,
          'Looking at your past sessions…',
          DEBRIEF_MODELS.progressReader,
        ),
        step(DebriefStep.GUIDANCE_LOOKUP, 'Looking up guidance…'),
        step(
          DebriefStep.WRITER,
          'Writing your debrief…',
          DEBRIEF_MODELS.writer,
          DEBRIEF_MODELS.writerBackup,
        ),
        step(DebriefStep.CHECKS, 'Reviewing my draft…'),
        step(
          DebriefStep.EVALUATOR,
          'Reviewing my draft…',
          DEBRIEF_MODELS.evaluator,
        ),
        step(
          DebriefStep.REVISER,
          'Making it clearer…',
          DEBRIEF_MODELS.reviser,
          DEBRIEF_MODELS.writerBackup,
        ),
      ],
    },
    [DebriefRecipeKey.SHORT]: {
      key: DebriefRecipeKey.SHORT,
      maxRevisionRounds: 0,
      shortForm: true,
      steps: [
        step(
          DebriefStep.SAFETY_READER,
          'Reading your session…',
          DEBRIEF_MODELS.safetyReader,
        ),
        step(
          DebriefStep.ANALYST,
          'Reading your session…',
          DEBRIEF_MODELS.analyst,
        ),
        step(
          DebriefStep.WRITER,
          'Writing your debrief…',
          DEBRIEF_MODELS.writer,
          DEBRIEF_MODELS.writerBackup,
        ),
        step(DebriefStep.CHECKS, 'Reviewing my draft…'),
        step(
          DebriefStep.EVALUATOR,
          'Reviewing my draft…',
          DEBRIEF_MODELS.evaluator,
        ),
      ],
    },
  },
  prompts: {
    [DEBRIEF_PROMPT_CODES.safetyReader]: null,
    [DEBRIEF_PROMPT_CODES.analyst]: null,
    [DEBRIEF_PROMPT_CODES.progressReader]: null,
    [DEBRIEF_PROMPT_CODES.writer]: null,
    [DEBRIEF_PROMPT_CODES.reviser]: null,
    [DEBRIEF_PROMPT_CODES.rubric]: null,
  },
  settings: {
    standardMinLearnerTurns: 6,
    passScore: 8,
    runCeilingUsd: 0.5,
    runFloorUsd: 0.15,
    poolPerSessionUsd: 0.25,
    monthlyCapUsd: 500,
    deadlineMs: 150_000,
    riskDeadlineMs: 180_000,
    guidancePassagesPerMoment: 2,
  },
  reply: DEBRIEF_REPLY_DEFAULT,
};

const standardSeed = SEED_RECIPES_BASE.recipes[DebriefRecipeKey.STANDARD]!;

export const DEBRIEF_SEED_BUNDLE: DebriefBundle = {
  ...SEED_RECIPES_BASE,
  recipes: {
    ...SEED_RECIPES_BASE.recipes,
    [DebriefRecipeKey.CASE]: { ...standardSeed, key: DebriefRecipeKey.CASE },
    [DebriefRecipeKey.ASSESSMENT]: {
      ...standardSeed,
      key: DebriefRecipeKey.ASSESSMENT,
    },
  },
};

/** Steps no recipe may drop (plan §8.2): safety, writing, the checks and the evaluation. */
export const MANDATORY_STEPS: readonly DebriefStep[] = [
  DebriefStep.SAFETY_READER,
  DebriefStep.WRITER,
  DebriefStep.CHECKS,
  DebriefStep.EVALUATOR,
];

/**
 * The platform's LLM catalog (Admin → Model Catalog), as the debrief reads it:
 * the active model ids each place a debrief model runs can call. The steps
 * run in ally-ai; Ask Ally and the reflection check run in ally-be.
 */
export interface DebriefModelCatalog {
  steps: ReadonlySet<string>;
  reply: ReadonlySet<string>;
}

/**
 * Every problem with a bundle, empty when it may be used. A release whose
 * bundle fails this is never run: the runner falls back to the seed. With the
 * catalog, every model must also be active there for the place it runs, so a
 * model switched off in Admin → Model Catalog stops being used here too.
 */
export function validateDebriefBundle(
  bundle: unknown,
  catalog?: DebriefModelCatalog,
): string[] {
  const problems: string[] = [];
  const b = bundle as Partial<DebriefBundle> | null;
  if (!b || typeof b !== 'object') return ['bundle is not an object'];
  const models = new Set<string>();
  for (const recipe of Object.values(b.recipes ?? {})) {
    for (const st of recipe?.steps ?? []) {
      if (st.model) models.add(st.model);
      if (st.backupModel) models.add(st.backupModel);
    }
  }
  for (const m of models) {
    const problem = modelProblem(m);
    if (problem) problems.push(problem);
    else if (catalog && !catalog.steps.has(m)) {
      problems.push(
        `${m} is not an active model in the LLM catalog for ally-ai`,
      );
    }
  }
  if (b.reply?.model) {
    const problem = modelProblem(b.reply.model);
    if (problem) problems.push(problem);
    else if (catalog && !catalog.reply.has(b.reply.model)) {
      problems.push(
        `${b.reply.model} is not an active model in the LLM catalog for ally-be`,
      );
    }
  }
  if (b.reply) {
    if (!['gemini', 'openai', 'anthropic'].includes(b.reply.provider)) {
      problems.push(`Ask Ally cannot run on provider ${b.reply.provider}`);
    }
    if (!b.reply.model) problems.push('Ask Ally has no model');
    if (!(b.reply.maxTokens > 0 && b.reply.maxTokens <= 1000)) {
      problems.push('Ask Ally replies must be 1 to 1000 tokens');
    }
  }
  for (const key of Object.values(DebriefRecipeKey)) {
    const recipe = b.recipes?.[key];
    if (!recipe) {
      if (!OPTIONAL_RECIPES.includes(key)) {
        problems.push(`recipe ${key} is missing`);
      }
      continue;
    }
    const steps = (recipe.steps ?? []).map((s) => s.step);
    for (const required of MANDATORY_STEPS) {
      if (!steps.includes(required)) {
        problems.push(`recipe ${key} drops the ${required} step`);
      }
    }
    if (steps[0] !== DebriefStep.SAFETY_READER) {
      problems.push(`recipe ${key} must start with the safety reader`);
    }
    const w = steps.indexOf(DebriefStep.WRITER);
    if (w >= 0 && steps.indexOf(DebriefStep.CHECKS) < w) {
      problems.push(`recipe ${key} runs the checks before the writer`);
    }
    if (w >= 0 && steps.indexOf(DebriefStep.EVALUATOR) < w) {
      problems.push(`recipe ${key} evaluates before the writer`);
    }
    const writer = recipe.steps.find((s) => s.step === DebriefStep.WRITER);
    const evaluator = recipe.steps.find(
      (s) => s.step === DebriefStep.EVALUATOR,
    );
    if (writer?.model && writer.model === evaluator?.model) {
      problems.push(`recipe ${key}: the evaluator runs on the writer's model`);
    }
    if (
      writer?.model === DEBRIEF_MODELS.judge ||
      evaluator?.model === DEBRIEF_MODELS.judge
    ) {
      problems.push(`recipe ${key}: a step runs on the judge's pinned model`);
    }
    if (
      !Number.isInteger(recipe.maxRevisionRounds) ||
      recipe.maxRevisionRounds < 0 ||
      recipe.maxRevisionRounds > 3
    ) {
      problems.push(`recipe ${key}: maxRevisionRounds must be 0–3`);
    }
  }
  const s = b.settings;
  if (!s) problems.push('settings are missing');
  else {
    if (!(s.runFloorUsd > 0 && s.runFloorUsd <= s.runCeilingUsd)) {
      problems.push(
        'settings: the floor must be above 0 and at most the ceiling',
      );
    }
    if (!(s.monthlyCapUsd > 0))
      problems.push('settings: monthly cap must be set');
    if (!(s.riskDeadlineMs > 0 && s.deadlineMs > 0)) {
      problems.push('settings: deadlines must be set');
    }
  }
  return problems;
}
