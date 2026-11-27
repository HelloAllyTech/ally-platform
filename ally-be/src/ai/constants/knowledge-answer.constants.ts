/**
 * The knowledge answer call's limits. All derived from the WhatsApp inbound SQS consumer's 60s
 * visibility window, less the provider send that follows (capped at 15s); see
 * `AiService.answerKnowledgeQuestion`. One place, so v1, v2 and v2's fallback to v1 spend the
 * same budget.
 */
export const KNOWLEDGE_ANSWER_LIMITS = {
  /** One request to ally-ai (`/knowledge-agent/answer` or `/agent/run`). */
  attemptMs: 25_000,
  /**
   * The whole of one `/agent/run/stream` (Preview). ally-ai ends a run at 20s
   * (`AGENT_RUNTIME__RUN_TIMEOUT_SECONDS`), so its own `error: timeout` arrives first and this
   * only catches a stream that went silent.
   */
  streamMs: 22_000,
  /** Everything spent answering one message: retries, or a v2 run and its v1 fallback. */
  budgetMs: 40_000,
  attempts: 2,
  delayMs: 500,
} as const;

/**
 * One agent run's limits (chunk H1 Part B/C). ally-be names the cap in the request
 * (`run_timeout_s`) and always waits `marginMs` longer, so ally-ai's cap fires first and ally-be
 * never gives up on a run that is still allowed to write. A streamed run also ends when no progress
 * event (a status, step, live step or token) has come for `silenceMs`: it times out on silence,
 * not on total time.
 */
export const AGENT_RUN_LIMITS = {
  /** The bot page, the bubble and Try it: a status line shows while it works. */
  streamedCapS: 45,
  /** WhatsApp: one reply, inside the SQS window (60 s) less the send that follows (15 s). */
  waitedCapS: 38,
  marginMs: 5_000,
  silenceMs: 25_000,
} as const;

/**
 * The crisis classifier's limits (chunk H1 Part C): one 4 s attempt and one quick retry, all inside
 * 6 s, so a finished reply never waits longer than that for the verdict. ally-ai's own call has a
 * shorter timeout and no SDK retries, so it answers `failed` inside an attempt rather than after.
 */
export const CRISIS_CHECK_LIMITS = {
  // 24 Nov: one attempt may use the whole 6 s. At 4 s a slow verdict under load was cut off and
  // the retry got only the ~2 s left, so the check failed where it would have answered.
  attemptMs: 6_000,
  retryDelayMs: 100,
  budgetMs: 6_000,
  /** Less than this left: no retry, the keyword rules decide. */
  minRetryMs: 1_000,
  /**
   * WA-A §0a: how long past `attemptMs` a check keeps listening when the caller wants a late
   * verdict. The turn never waits for it; an at-risk verdict that arrives in this time still
   * flags the chat and alerts the team.
   */
  lateListenMs: 30_000,
} as const;

/** ally-ai's onboarding builder (chunk 20a). */
export const BUILDER_LIMITS = {
  /**
   * One streamed builder step. ally-ai caps a step at 45s (`BUILDER__STEP_TIMEOUT_SECONDS`), so
   * its own `error: timeout` arrives first.
   */
  stepMs: 60_000,
  /** One batch of pages read for facts; ally-ai caps the model call at 40s. */
  extractMs: 50_000,
} as const;
