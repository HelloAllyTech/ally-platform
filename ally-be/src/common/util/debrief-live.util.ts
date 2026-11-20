/**
 * The keys a published live debrief writes into `summary.feedback`
 * (DebriefPublishService). A feedback object holding only these was written
 * by the Debrief agent, not by today's debrief.
 */
export const DEBRIEF_AGENT_FEEDBACK_KEYS: ReadonlySet<string> = new Set([
  'supervisorNote',
  'positives',
  'improvements',
  'areasOfGrowth',
  'sessionGlimpse',
  'skillCoverage',
  'emotionalMovement',
  'cumulativeMemory',
  'debriefGenerator',
]);

/**
 * True when today's debrief has written this feedback. Feedback without the
 * agent's stamp is always today's (the guard's old behaviour, unchanged);
 * stamped feedback is today's only if it holds a key the agent never writes.
 */
export function hasLegacyFeedback(
  feedback: Record<string, unknown> | null | undefined,
): boolean {
  if (!feedback) return false;
  if (!('debriefGenerator' in feedback)) return true;
  return Object.keys(feedback).some((k) => !DEBRIEF_AGENT_FEEDBACK_KEYS.has(k));
}
