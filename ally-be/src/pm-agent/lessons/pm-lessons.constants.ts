/**
 * The weekly lessons job's fixed bounds (docs/pm-agent.md, "Weekly lessons"; plan §9b loop 5).
 * Every number is enforced in code, never asked of the model.
 */
export const PM_LESSONS = {
  /** Decisions the job reads. */
  LOOKBACK_DAYS: 90,
  /** A lesson needs at least this many supporting decisions… */
  MIN_SUPPORT: 5,
  /** …and this share of the decisions it matches must agree with it. */
  MIN_CONSISTENCY: 0.75,
  /** A lesson not re-supported for this long expires. */
  EXPIRY_DAYS: 60,
  /** Eval gate: past decided cards the critic is replayed over (balanced accept/reject). */
  EVAL_MAX_CARDS: 20,
  /** Below this many replayable cards the gate cannot judge: the lesson stays proposed. */
  EVAL_MIN_SAMPLE: 8,
  /** Candidate lessons one reflection may submit (more are ignored). */
  MAX_CANDIDATES: 8,
  /** Active lessons injected into one prompt (lane or critic). */
  MAX_INJECTED: 8,
  /** Reflection call output cap. */
  REFLECTION_MAX_TOKENS: 3000,
  /** Rows in the data pack (newest first). */
  PACK_MAX_ROWS: 300,
  /** Data pack characters the model reads, after fencing. */
  PACK_MAX_CHARS: 60_000,
  /** Title words kept per pack row. */
  PACK_WORDS_PER_ROW: 6,
  /** Lesson text bounds. */
  TEXT_MIN: 12,
  TEXT_MAX: 280,
  /** Share of the job's budget held back for the eval gate (the reflection cannot spend it). */
  EVAL_SHARE: 0.6,
  /** Lesson evidence card ids kept. */
  EVIDENCE_MAX: 20,
} as const;

/** Prompt, registry row and forced tool (docs/adding-a-prompt.md, docs/ai-task-registry.md). */
export const PM_LESSONS_PROMPT_CODE = 'pm_agent_lessons';
export const PM_LESSONS_TASK_ID = 'pm-agent-lessons';
export const PM_LESSONS_SUBMIT_TOOL = 'submit_lessons';
/** Ledger lane key and llm_usage metadata.lane for every lessons-job call. */
export const PM_LESSONS_LANE = 'lessons';

/** Advisory lock (namespace PM_OUTBOX_LOCK_NAMESPACE): 1 outbox, 2 run tick, 3 persister. */
export const PM_LESSONS_LOCK_KEY = 6;

/** Why POST /lessons/run (or a scheduled tick) did not run. */
export enum PmLessonsSkipReason {
  DISABLED = 'disabled',
  LESSONS_DISABLED = 'lessons_disabled',
  ALREADY_RUNNING = 'already_running',
  BUDGET_EXHAUSTED = 'budget_exhausted',
  NOT_ENOUGH_DECISIONS = 'not_enough_decisions',
}
