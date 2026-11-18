/**
 * The Debrief agent's release bundle: recipes, the prompt versions they run,
 * the model for every step and the run settings.
 *
 * A release is an immutable `agent_releases` row (agentKey `debrief`), the same
 * harness the Ally guide uses, so promotion, rollback and the audit trail are
 * shared. The bundle below is version 1, seeded from code; every later version
 * comes from an approved PM agent idea or a person, never from editing GA.
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
export enum DebriefStep {
  SAFETY_READER = 'safety_reader',
  ANALYST = 'analyst',
  PROGRESS_READER = 'progress_reader',
  GUIDANCE_LOOKUP = 'guidance_lookup',
  /** The guidance agent: optional, between the lookup and the Writer (its tools: `settings.guidanceTools`). */
  GUIDANCE_AGENT = 'guidance_agent',
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

/** The Debrief Guidance tools the guidance agent may be given (gateway tools). */
export const GUIDANCE_TOOL_NAMES = [
  'guidance_index',
  'guidance_search',
  'guidance_fetch',
] as const;
export type GuidanceToolName = (typeof GUIDANCE_TOOL_NAMES)[number];

/**
 * The steps `settings.guidanceTools` may name: only steps ally-ai wires to the toolbox, so nobody
 * (the PM agent included) can switch on a step that would do nothing. The Writer and Reviser take
 * the tools only when their own entry lists some (off by default). Wiring another step later: one
 * toolbox call in that node, plus its key here.
 */
export const GUIDANCE_TOOL_STEPS = [
  'guidance_agent',
  'writer',
  'reviser',
] as const;

export type GuidanceToolsSetting = Partial<Record<string, GuidanceToolName[]>>;

/** Absent setting: only the guidance agent has the tools, all three. */
export const GUIDANCE_TOOLS_DEFAULT: GuidanceToolsSetting = {
  guidance_agent: [...GUIDANCE_TOOL_NAMES],
};

/** The guidance tools one step may call under a release's settings (none for an unlisted step). */
export function guidanceToolsFor(
  setting: unknown,
  step: string,
): GuidanceToolName[] {
  const map =
    setting && typeof setting === 'object' && !Array.isArray(setting)
      ? (setting as GuidanceToolsSetting)
      : GUIDANCE_TOOLS_DEFAULT;
  const list = map[step];
  return Array.isArray(list)
    ? list.filter((t) => (GUIDANCE_TOOL_NAMES as readonly string[]).includes(t))
    : [];
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
   * Tool calls the guidance agent may make in one run (2026-11-17); 0 = the agent is off. Absent
   * in releases made before it: ally-ai reads it as 0.
   */
  guidanceAgentMaxCalls?: number;
  /**
   * The guidance tools each step is offered: an object keyed by step name (`GUIDANCE_TOOL_STEPS`),
   * each a subset of `GUIDANCE_TOOL_NAMES`; a step not listed has none. Absent:
   * `GUIDANCE_TOOLS_DEFAULT` (the guidance agent, all three). The gateway refuses a call a step
   * is not enabled for. The PM agent may later switch a tool off for a step.
   */
  guidanceTools?: GuidanceToolsSetting;
  /**
   * Everything one session may spend: its debrief run and every Ask Ally
   * reply after it (Sandeep, 2026-11-16). Absent in releases made before it:
   * `DEBRIEF_SESSION_BUDGET_DEFAULT` applies.
   */
  sessionBudgetUsd?: number;
  /** Ask Ally replies one session may have. Absent: `DEBRIEF_MAX_REPLIES_DEFAULT`. */
  maxRepliesPerSession?: number;
  /**
   * Retired with the Knowledge Base's similarity floor: Debrief Guidance answers in relevance
   * bands, not similarities. Releases made before it still carry the value; nothing reads it.
   */
  guidanceMinSimilarity?: number;
  /**
   * The release's prompt texts are the neutral ones ("the learner", "the character"), so the
   * transcript says LEARNER and CHARACTER instead of COUNSELLOR and CLIENT. Set by the release
   * that publishes the neutral texts, so prompts and labels never disagree. Absent: legacy labels.
   */
  neutralWording?: boolean;
}

/** Ask Ally in conversation mode (v9 FR-43): part of the release, like every step. */
export interface DebriefReplyConfig {
  /** A provider Ask Ally's agent in ally-ai can run. */
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  /** Room for a 120-word reply in an Indic script, which costs far more tokens than English. */
  maxTokens: number;
  /**
   * v9 FR-43: dollars one reply may spend across its passes. ally-ai enforces
   * it and never allows more than $0.05 (`REPLY_BUDGET_USD`, app/core/ask_ally).
   */
  budgetUsd?: number;
  /**
   * v9 FR-43: model passes per reply, tool passes included, the last never
   * calling a tool. ally-ai's default and ceiling is 4 (`REPLY_MAX_TURNS`).
   */
  maxTurns?: number;
}

export interface DebriefBundle {
  /** Standard and Short always; Case and Assessment from the release that added them. */
  recipes: Partial<Record<DebriefRecipeKey, DebriefRecipe>> &
    Record<DebriefRecipeKey.STANDARD | DebriefRecipeKey.SHORT, DebriefRecipe>;
  prompts: Record<string, number | null>;
  settings: DebriefSettings;
  /** Absent in releases made before Ask Ally: the code default then applies. */
  reply?: DebriefReplyConfig;
  /**
   * The orchestrator (spec A1–A5, A11). Absent, or `enabled: false`, runs
   * today's fixed recipes: every release made before it, and the seed, which
   * never carries it (a changed seed auto-promotes to GA). A challenger
   * release turns it on; a person promotes it through the ladder.
   */
  orchestrator?: DebriefOrchestratorConfig;
}

/**
 * The registry agents ally-ai's build defines (one module per agent,
 * `app/core/debrief_graph/registry/agents/`), at the version it has. A release
 * may enable an agent only at a version the build has; ally-ai refuses any
 * other (spec A2: calling an agent outside the release is refused).
 */
export const DEBRIEF_REGISTRY_AGENTS = {
  analyst: { version: 1 },
  progress_reader: { version: 1 },
  guidance_lookup: { version: 1 },
  guidance_agent: { version: 1 },
  case_memory: { version: 1 },
  assessment_anchoring: { version: 1 },
  protocol_check: { version: 1 },
  history_deep: { version: 1 },
  language_specialist: { version: 1 },
  cohort_comparison: { version: 1 },
  course_patterns: { version: 1 },
} as const;
export type DebriefRegistryAgentId = keyof typeof DEBRIEF_REGISTRY_AGENTS;

/** One registry agent a release enables. No model: the build's default (or the recipe's step). */
export interface DebriefReleaseAgent {
  id: DebriefRegistryAgentId;
  version: number;
  model?: string | null;
  backupModel?: string | null;
}

export interface DebriefOrchestratorConfig {
  /** The challenger flag: on, the planner chooses the analysis agents. */
  enabled: boolean;
  /** Fast class, structured, temperature 0 (spec A5). */
  plannerModel: string;
  plannerBackupModel?: string | null;
  /** D3: one evidence top-up after the first failed evaluation. */
  topUp: boolean;
  maxAgentsPerPlan: number;
  agents: DebriefReleaseAgent[];
}

/** Planner limits a release may set (spec Part E: owner settings come later). */
export const DEBRIEF_MAX_AGENTS_PER_PLAN = 10;

export const DEBRIEF_PROMPT_CODES = {
  safetyReader: 'debrief_safety_reader_system',
  /** Pinned: the one definition of a clear and a possible risk cue. */
  riskCueDefinition: 'debrief_risk_cue_definition',
  analyst: 'debrief_analyst_system',
  progressReader: 'debrief_progress_reader_system',
  /** The progress agent (learner progress over past sessions); its step key stays `progress_reader`. */
  progress: 'debrief_progress_system',
  /** The guidance agent: browses the Debrief Guidance index and fetches entries before the Writer. */
  guidanceAgent: 'debrief_guidance_agent_system',
  writer: 'debrief_writer_system',
  reviser: 'debrief_reviser_system',
  rubric: 'debrief_quality_rubric',
  /** Pinned: what the Evaluator is told to do last (its own code, not the judge's). */
  evaluator: 'debrief_evaluator_system',
  evaluatorFix: 'debrief_evaluator_fix_system',
  pmAgent: 'debrief_improver_system',
  reply: 'debrief_reply_system',
  planner: 'debrief_planner_system',
  /** How each analysis agent is described to the planner. */
  plannerAgents: 'debrief_planner_agents',
  pmInvestigator: 'debrief_pm_investigator_system',
  /** Pinned: what a safe change is. */
  pmReviewer: 'debrief_pm_reviewer_system',
  protocolCheck: 'debrief_protocol_check_system',
  historyDeep: 'debrief_history_deep_system',
  languageSpecialist: 'debrief_language_specialist_system',
} as const;

/** The orchestrator's prompts, sent to ally-ai only when a release turns it on. */
export const DEBRIEF_ORCHESTRATOR_PROMPT_CODES: readonly string[] = [
  DEBRIEF_PROMPT_CODES.planner,
  DEBRIEF_PROMPT_CODES.plannerAgents,
  DEBRIEF_PROMPT_CODES.protocolCheck,
  DEBRIEF_PROMPT_CODES.historyDeep,
  DEBRIEF_PROMPT_CODES.languageSpecialist,
];

/** The on-topic check for reflection XP: a yes or no, cheap and fast. */
export const DEBRIEF_REFLECTION_CHECK_MODEL = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
} as const;

/** Ask Ally's default: fast first words matter more than depth for a reply. */
/** A session's whole budget, debrief and Ask Ally together, when the release names none. */
export const DEBRIEF_SESSION_BUDGET_DEFAULT = 1;
/** Ask Ally replies per session when the release names none. */
export const DEBRIEF_MAX_REPLIES_DEFAULT = 20;
/** Below this left in the session, a reply could not finish one pass: Ask Ally stops. */
export const DEBRIEF_MIN_REPLY_USD = 0.01;
/** ally-ai's own ceiling for one reply (`REPLY_BUDGET_USD`, app/core/ask_ally). */
export const DEBRIEF_REPLY_BUDGET_MAX = 0.05;

export const DEBRIEF_REPLY_DEFAULT: DebriefReplyConfig = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  maxTokens: 900,
};

/**
 * Prompts the PM agent may propose edits to. The rubric and the Safety
 * reader are pinned (named people only), and the PM agent's own instructions
 * change only through a person. The orchestrator's planner and its
 * prompt-only registry agents are route A too (spec C3: default plans and
 * changed manifests), but only while the GA release runs the orchestrator:
 * otherwise a change to them could not be tested (DebriefPmAgentToolsService).
 */
export const PM_AGENT_EDITABLE_PROMPTS: ReadonlySet<string> = new Set([
  DEBRIEF_PROMPT_CODES.analyst,
  DEBRIEF_PROMPT_CODES.progressReader,
  DEBRIEF_PROMPT_CODES.writer,
  DEBRIEF_PROMPT_CODES.reviser,
  ...DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
]);

/**
 * Settings the PM agent may propose, each with the range it may move in. The
 * budget ceiling and cap are the owner's, and the deadlines are learner
 * promises, so neither is here.
 */
export const PM_AGENT_SETTINGS: Record<string, { min: number; max: number }> = {
  maxRevisionRounds: { min: 0, max: 3 },
  guidancePassagesPerMoment: { min: 0, max: 3 },
  guidanceAgentMaxCalls: { min: 0, max: 5 },
  standardMinLearnerTurns: { min: 3, max: 10 },
};

/** Every step's model. Writer and Evaluator differ from each other and from the pinned judge. */
export const DEBRIEF_MODELS = {
  safetyReader: 'gemini-2.5-flash',
  // At temperature 0, 2.5-flash loops on about 1% of sessions until its output limit (65k tokens,
  // ~4 min), and retrying it repeats the loop; this model read those sessions cleanly 6/6 and
  // passes the safety-recall gate (18/18 x3, 2026-11-11). Without a backup, both attempts fail
  // and a person has to finish the debrief.
  safetyReaderBackup: 'gemini-3-flash-preview',
  analyst: 'gemini-2.5-pro',
  progressReader: 'gemini-2.5-flash',
  /** The guidance agent (its own step key `guidance_agent`; not a recipe step). */
  guidanceAgent: 'gemini-2.5-flash',
  writer: 'gemini-3-flash-preview',
  // Only three Gemini models are priced, and 2.5-pro is the judge's. A run
  // that falls back to this shares the Evaluator's model; the run records it.
  writerBackup: 'gemini-2.5-flash',
  evaluator: 'gemini-2.5-flash',
  reviser: 'gemini-3-flash-preview',
  pmAgent: 'gemini-2.5-pro',
  // The PM agent's backup when its model fails or its breaker is open.
  pmAgentBackup: 'gemini-2.5-flash',
  judge: 'gemini-2.5-pro',
  /** The orchestrator's planner: fast, the learner is waiting (spec A5). */
  planner: 'gemini-2.5-flash',
  /** The prompt-only registry agents (ally-ai manifests name the same). */
  registryAgent: 'gemini-2.5-flash',
  registryAgentBackup: 'gemini-3-flash-preview',
  /** V2_AUTONOMY F1: answering a learner's flag, the Writer's models. */
  flagAnswer: 'gemini-3-flash-preview',
  flagAnswerBackup: 'gemini-2.5-flash',
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
          DEBRIEF_MODELS.safetyReaderBackup,
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
          DebriefStep.GUIDANCE_AGENT,
          'Choosing guidance…',
          DEBRIEF_MODELS.guidanceAgent,
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
      // One round: with none, any blocking check (a score mentioned, a body too long) sent a
      // short session's debrief to a person instead of being fixed.
      maxRevisionRounds: 1,
      shortForm: true,
      steps: [
        step(
          DebriefStep.SAFETY_READER,
          'Reading your session…',
          DEBRIEF_MODELS.safetyReader,
          DEBRIEF_MODELS.safetyReaderBackup,
        ),
        step(
          DebriefStep.ANALYST,
          'Reading your session…',
          DEBRIEF_MODELS.analyst,
        ),
        step(
          DebriefStep.GUIDANCE_AGENT,
          'Choosing guidance…',
          DEBRIEF_MODELS.guidanceAgent,
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
        step(
          DebriefStep.REVISER,
          'Making it clearer…',
          DEBRIEF_MODELS.reviser,
          DEBRIEF_MODELS.writerBackup,
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
    // Lowered from 500 on 2026-11-10 as a safety net while the Debrief agent
    // is still in development (~$3 a month today). Raise it to a proper level
    // once the whole loop is finished.
    monthlyCapUsd: 50,
    deadlineMs: 150_000,
    riskDeadlineMs: 180_000,
    // 0: the fixed per-moment lookup is off and the guidance agent is the guidance step (local
    // comparison 2026-11-17: same judge scores, 5-16 s faster). Above 0 the lookup runs and the
    // planner may choose the agent besides it.
    guidancePassagesPerMoment: 0,
    guidanceAgentMaxCalls: 3,
    // The guidance agent has all three; the Writer and Reviser can take them but ship off.
    guidanceTools: {
      guidance_agent: [...GUIDANCE_TOOL_NAMES],
      writer: [],
      reviser: [],
    } as GuidanceToolsSetting,
  },
  reply: DEBRIEF_REPLY_DEFAULT,
};

/**
 * The orchestrator, on by default (Gopi, 2026-11-16): every registry agent at
 * the build's version, today's recipe models for the agents that were recipe
 * steps, the build's defaults for the rest. The planner decides per session
 * whether to add any agent to the code-owned floor; adding none is a valid
 * plan. Shipped off on 2026-11-11 as a precaution only.
 */
export const DEBRIEF_ORCHESTRATOR_DEFAULT: DebriefOrchestratorConfig = {
  enabled: true,
  plannerModel: DEBRIEF_MODELS.planner,
  plannerBackupModel: null,
  topUp: true,
  maxAgentsPerPlan: 6,
  agents: (
    Object.entries(DEBRIEF_REGISTRY_AGENTS) as Array<
      [DebriefRegistryAgentId, { version: number }]
    >
  ).map(([id, { version }]) => ({ id, version })),
};

const standardSeed = SEED_RECIPES_BASE.recipes[DebriefRecipeKey.STANDARD]!;

/**
 * The code's defaults. A deploy that changes them makes a new live release
 * (three-way merge over what people promoted; a conflict waits as a draft).
 */
export const DEBRIEF_SEED_BUNDLE: DebriefBundle = {
  ...SEED_RECIPES_BASE,
  prompts: {
    ...SEED_RECIPES_BASE.prompts,
    ...Object.fromEntries(
      DEBRIEF_ORCHESTRATOR_PROMPT_CODES.filter(
        (c) => !(c in SEED_RECIPES_BASE.prompts),
      ).map((c) => [c, null]),
    ),
  },
  orchestrator: DEBRIEF_ORCHESTRATOR_DEFAULT,
  recipes: {
    ...SEED_RECIPES_BASE.recipes,
    [DebriefRecipeKey.CASE]: { ...standardSeed, key: DebriefRecipeKey.CASE },
    [DebriefRecipeKey.ASSESSMENT]: {
      ...standardSeed,
      key: DebriefRecipeKey.ASSESSMENT,
    },
  },
};

/**
 * A challenger bundle (spec A11): `base` (normally the live GA bundle) with
 * the orchestrator on, as a DRAFT release from the Console action. Since
 * 2026-11-16 the seed runs the orchestrator too; this stays for trying an
 * orchestrator variant against the live release.
 */
export function debriefChallengerBundle(
  base: DebriefBundle,
  orchestrator: Partial<DebriefOrchestratorConfig> = {},
): DebriefBundle {
  return {
    ...base,
    prompts: {
      ...base.prompts,
      ...Object.fromEntries(
        DEBRIEF_ORCHESTRATOR_PROMPT_CODES.filter(
          (c) => !(c in (base.prompts ?? {})),
        ).map((c) => [c, null]),
      ),
    },
    orchestrator: {
      ...DEBRIEF_ORCHESTRATOR_DEFAULT,
      ...(base.orchestrator ?? {}),
      ...orchestrator,
      enabled: orchestrator.enabled ?? true,
    },
  };
}

/** True when a bundle runs the orchestrator rather than the fixed recipes. */
export function isOrchestrated(bundle: Partial<DebriefBundle>): boolean {
  return bundle.orchestrator?.enabled === true;
}

/** Every model the orchestrator block names (for prices and validation). */
export function orchestratorModels(bundle: Partial<DebriefBundle>): string[] {
  const o = bundle.orchestrator;
  if (!o) return [];
  return [
    o.plannerModel,
    o.plannerBackupModel,
    ...(o.agents ?? []).flatMap((a) => [a.model, a.backupModel]),
    // The prompt-only agents' build defaults run when the release names none.
    ...(o.enabled
      ? [DEBRIEF_MODELS.registryAgent, DEBRIEF_MODELS.registryAgentBackup]
      : []),
  ].filter((m): m is string => typeof m === 'string' && m.length > 0);
}

/** Every problem with an orchestrator block (none when it may be used). */
export function orchestratorProblems(
  o: unknown,
  catalog?: DebriefModelCatalog,
): string[] {
  if (o === undefined || o === null) return [];
  const c = o as Partial<DebriefOrchestratorConfig>;
  if (typeof c !== 'object') return ['orchestrator is not an object'];
  const problems: string[] = [];
  if (typeof c.enabled !== 'boolean') {
    problems.push('orchestrator: enabled must be true or false');
  }
  if (typeof c.topUp !== 'boolean') {
    problems.push('orchestrator: topUp must be true or false');
  }
  if (
    !Number.isInteger(c.maxAgentsPerPlan) ||
    (c.maxAgentsPerPlan as number) < 1 ||
    (c.maxAgentsPerPlan as number) > DEBRIEF_MAX_AGENTS_PER_PLAN
  ) {
    problems.push(
      `orchestrator: maxAgentsPerPlan must be 1–${DEBRIEF_MAX_AGENTS_PER_PLAN}`,
    );
  }
  if (!c.plannerModel) problems.push('orchestrator: no planner model');
  if (!Array.isArray(c.agents)) {
    problems.push('orchestrator: agents must be a list');
  } else {
    const seen = new Set<string>();
    for (const a of c.agents) {
      const known =
        DEBRIEF_REGISTRY_AGENTS[a?.id as DebriefRegistryAgentId] ?? null;
      if (!known) {
        problems.push(`orchestrator: no registry agent ${String(a?.id)}`);
        continue;
      }
      if (seen.has(a.id))
        problems.push(`orchestrator: ${a.id} is listed twice`);
      seen.add(a.id);
      if (a.version !== known.version) {
        problems.push(
          `orchestrator: ${a.id} v${String(a.version)} is not in this build (v${known.version})`,
        );
      }
    }
  }
  const models = [
    c.plannerModel,
    c.plannerBackupModel,
    ...(Array.isArray(c.agents) ? c.agents : []).flatMap((a) => [
      a?.model,
      a?.backupModel,
    ]),
  ].filter((m): m is string => typeof m === 'string' && m.length > 0);
  for (const m of new Set(models)) {
    const problem = modelProblem(m);
    if (problem) problems.push(`orchestrator: ${problem}`);
    else if (catalog && !catalog.steps.has(m)) {
      problems.push(
        `orchestrator: ${m} is not an active model in the LLM catalog for ally-ai`,
      );
    }
  }
  return problems;
}

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
 * and Ask Ally run in ally-ai (both read its list).
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
        `${b.reply.model} is not an active model in the LLM catalog for ally-ai`,
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
  problems.push(...orchestratorProblems(b.orchestrator, catalog));
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
    if (s.guidanceAgentMaxCalls != null) {
      const r = PM_AGENT_SETTINGS.guidanceAgentMaxCalls;
      if (
        !Number.isInteger(s.guidanceAgentMaxCalls) ||
        s.guidanceAgentMaxCalls < r.min ||
        s.guidanceAgentMaxCalls > r.max
      ) {
        problems.push(
          `settings: guidanceAgentMaxCalls must be a whole number ${r.min}–${r.max}`,
        );
      }
    }
    if (s.guidanceTools != null) {
      const g = s.guidanceTools as unknown;
      const bad =
        !g ||
        typeof g !== 'object' ||
        Array.isArray(g) ||
        Object.entries(g).some(
          ([step, tools]) =>
            !(GUIDANCE_TOOL_STEPS as readonly string[]).includes(step) ||
            !Array.isArray(tools) ||
            tools.some(
              (t) => !(GUIDANCE_TOOL_NAMES as readonly string[]).includes(t),
            ),
        );
      if (bad) {
        problems.push(
          `settings: guidanceTools must map a step (${GUIDANCE_TOOL_STEPS.join(', ')}) to a list of ${GUIDANCE_TOOL_NAMES.join(', ')}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The PM agent's own Skills Store texts, sent with every run and conversation
 * turn (`prompts`): its subagents and its skills (each skill's SKILL.md).
 */
export const DEBRIEF_PM_AGENT_PROMPT_CODES: readonly string[] = [
  DEBRIEF_PROMPT_CODES.pmInvestigator,
  DEBRIEF_PROMPT_CODES.pmReviewer,
  'debrief_pm_skill_builder_brief',
  'debrief_pm_skill_prompt_change',
  'debrief_pm_skill_registry_agent',
];
