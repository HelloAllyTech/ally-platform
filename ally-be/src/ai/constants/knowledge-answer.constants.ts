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
