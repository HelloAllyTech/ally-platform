import { PmCardCategory, PmLane } from '../enum/pm-agent.enum';

/**
 * The generation pipeline's fixed bounds (docs/pm-agent.md "Run pipeline"; plan v3 §5, §10).
 *
 * Every number here is a CAP the deterministic workflow enforces, not a hint to a model:
 * the lane runner stops at `MAX_PASSES`, the ledger refuses a call it cannot reserve, the
 * run stops at its wall clock. Changing one changes what a run may spend.
 */
export const PM_PIPELINE = {
  /** Per-run cap = monthly budget ÷ this (plan §10: ≈ monthly / 20). */
  RUN_BUDGET_DIVISOR: 20,
  /** Below this a run is not worth starting: one lane pass costs about this much. */
  MIN_RUN_BUDGET_USD: 0.02,
  /** Share of the run cap held back for the critic before any lane spends. */
  CRITIC_SHARE: 0.2,
  /** No single lane may take more than this share of the lane budget. */
  LANE_MAX_SHARE: 0.5,
  /** Over-generate: ask lanes for about this many candidates per free slot. */
  CANDIDATE_MULTIPLIER: 3,
  /** Candidates one lane may submit, whatever the slot count. */
  MAX_CANDIDATES_PER_LANE: 6,
  /** Lanes one run may select (revisions excluded). */
  MAX_LANES_PER_RUN: 4,
  /** Tool-loop passes per lane, the forced-submit pass included. */
  MAX_PASSES: 6,
  /** Tool calls a single pass may make (extra calls are refused, not run). */
  MAX_TOOL_CALLS_PER_PASS: 6,
  /** Output cap per lane pass and per critic call. */
  LANE_MAX_TOKENS: 4000,
  CRITIC_MAX_TOKENS: 3000,
  /** Per-call SDK deadline (passed to the provider, so a hung call stops billing). */
  CALL_TIMEOUT_MS: 90_000,
  /** Wall clock per lane and per run. */
  LANE_TIMEOUT_MS: 4 * 60_000,
  RUN_TIMEOUT_MS: 20 * 60_000,
  /**
   * A `running` row older than this is a crashed run (usually a deploy killed the task
   * mid-run); the scheduler's 10-minute tick fails it, and until then the UI shows the
   * agent as running and Run now stays disabled. A live run cannot outlast
   * RUN_TIMEOUT_MS by much: lanes are clamped to the run deadline, then the critic gets
   * one call plus one fallback (2 × CALL_TIMEOUT_MS) — about 23.5 min in all. Keep this
   * just above that, not far above it.
   */
  STALE_RUN_MS: 30 * 60_000,
  /** Tool results the model reads, after fencing. */
  TOOL_RESULT_MAX_CHARS: 12_000,
  /** Evidence snapshot kept per item (internal; never in a compiled PRD). */
  EVIDENCE_SNAPSHOT_MAX_CHARS: 6_000,
  /** Cheap-model switch: below this many estimated lane-costs of run budget left. */
  CHEAP_MODEL_BELOW_LANE_COSTS: 2,
  /** Pending feedback older than this is cancelled rather than revised. */
  REVISION_MAX_AGE_MS: 14 * 24 * 60 * 60 * 1000,
  /** Revisions processed per run (each is one lane run). */
  MAX_REVISIONS_PER_RUN: 3,
} as const;

/** Price assumed for a model the pricing table does not know, per 1M tokens (conservative). */
export const PM_UNPRICED_MODEL_USD = { input: 5, output: 25 } as const;

/** Questions: suppression and share (plan §5 "≤~1 in 3 once context is solid"). */
export const PM_QUESTIONS = {
  /** Memory is "solid" from this many active facts; then questions are capped. */
  SOLID_MEMORY_FACTS: 10,
  /** Once solid, at most this share of the persisted cards are questions. */
  MAX_SHARE_WHEN_SOLID: 1 / 3,
} as const;

/** Lane selection learning (plan §9b loop 3). */
export const PM_BANDIT = {
  /** Fraction of lane slots chosen uniformly at random. */
  EXPLORATION_SHARE: 0.15,
  /** Decisions a lane/category needs before its learned score moves its weight. */
  MIN_DECISIONS: 8,
  /** Half-life of a decision's weight in the learned score. */
  HALF_LIFE_DAYS: 30,
  /** Decisions older than this are ignored entirely. */
  LOOKBACK_DAYS: 180,
  /** A lane with mandate weight > 0 must hold at least this share of recent selections. */
  MIN_SHARE: 0.1,
  /** Recent runs the minimum share and the coverage boost look at. */
  COVERAGE_WINDOW_RUNS: 10,
  /** Coverage boost per run since the lane last ran, capped. */
  COVERAGE_BOOST_PER_RUN: 0.25,
  COVERAGE_BOOST_MAX: 2,
} as const;

/** Gate layer 2 (dedupe). */
export const PM_DEDUPE = {
  /** Similarity at or above which two items are the same idea. */
  DUPLICATE_THRESHOLD: 0.6,
  /** Roadmap opportunities and bug findings compared against, newest first. */
  CORPUS_LIMIT: 400,
} as const;

/** Memory and exemplar retrieval per lane (plan §9, §9b loop 2). */
export const PM_CONTEXT = {
  MEMORY_TOP_K: 8,
  EXEMPLARS_POSITIVE: 2,
  EXEMPLARS_NEGATIVE: 2,
  /** Facts/lessons fenced into a prompt are cut to this length each. */
  MEMORY_VALUE_MAX_CHARS: 400,
  MANDATE_MAX_CHARS: 4000,
  STRATEGY_MAX_CHARS: 8000,
  PRODUCT_MAP_MAX_CHARS: 24_000,
} as const;

/** Repos a card may target. `ally-mobile` has no release pipeline (plan §8). */
export const PM_RELEASABLE_REPOS = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
] as const;

/** The forced tool every lane ends with, and the critic's. */
export const PM_SUBMIT_TOOL = 'submit_candidates';
export const PM_CRITIC_SUBMIT_TOOL = 'submit_verdicts';

/** Prompt codes (src/prompts/pm_agent/*.txt; contracts in prompt-contracts.ts). */
export const PM_PROMPT_CODES: Record<PmLane, string> & { CRITIC: string } = {
  [PmLane.ANALYTICS]: 'pm_agent_lane_analytics',
  [PmLane.UX_SIGNALS]: 'pm_agent_lane_ux_signals',
  [PmLane.CODE_HEALTH]: 'pm_agent_lane_code_health',
  [PmLane.INFRA_COST]: 'pm_agent_lane_infra_cost',
  [PmLane.STRATEGY_CONTENT]: 'pm_agent_lane_strategy_content',
  [PmLane.REVISIONS]: 'pm_agent_lane_revisions',
  CRITIC: 'pm_agent_critic',
};

/** AI-task-registry row ids (one per prompt, all labelled LlmTask.PM_AGENT). */
export const PM_TASK_IDS: Record<PmLane, string> & { CRITIC: string } = {
  [PmLane.ANALYTICS]: 'pm-agent-lane-analytics',
  [PmLane.UX_SIGNALS]: 'pm-agent-lane-ux-signals',
  [PmLane.CODE_HEALTH]: 'pm-agent-lane-code-health',
  [PmLane.INFRA_COST]: 'pm-agent-lane-infra-cost',
  [PmLane.STRATEGY_CONTENT]: 'pm-agent-lane-strategy-content',
  [PmLane.REVISIONS]: 'pm-agent-lane-revisions',
  CRITIC: 'pm-agent-critic',
};

/** Which categories each (non-revision) lane proposes in; drives mandate weights. */
export const PM_LANE_CATEGORIES: Record<
  Exclude<PmLane, PmLane.REVISIONS>,
  PmCardCategory[]
> = {
  [PmLane.ANALYTICS]: [PmCardCategory.PRODUCT, PmCardCategory.UI_UX],
  [PmLane.UX_SIGNALS]: [PmCardCategory.UI_UX, PmCardCategory.PRODUCT],
  [PmLane.CODE_HEALTH]: [
    PmCardCategory.CODE_HEALTH,
    PmCardCategory.ARCHITECTURE,
  ],
  [PmLane.INFRA_COST]: [PmCardCategory.INFRA, PmCardCategory.COST],
  [PmLane.STRATEGY_CONTENT]: [
    PmCardCategory.STRATEGY_CONTENT,
    PmCardCategory.PRODUCT,
  ],
};

/** The lanes the selector rotates over (revisions always run first, outside selection). */
export const PM_SELECTABLE_LANES = Object.keys(PM_LANE_CATEGORIES) as Exclude<
  PmLane,
  PmLane.REVISIONS
>[];

/** Scheduler: the daily-run check and its advisory lock (outbox uses key 1). */
export const PM_RUN_SCHEDULE_CRON = '0 */10 * * * *';
export const PM_RUN_LOCK_KEY = 2;

/** Stop reasons recorded on pm_agent_runs.stopReason (varchar 40). */
export enum PmStopReason {
  DISABLED = 'disabled',
  QUEUE_FULL = 'queue_full',
  BUDGET = 'budget',
  NO_CANDIDATES = 'no_candidates',
  TIMEOUT = 'timeout',
  ERROR = 'error',
  ABANDONED = 'abandoned',
}
