// TODO: REMOVE THIS AFTER THE API IS READY
/**
 * Mock AI responses used during development.
 * Replace this with real WebSocket responses once the BE is ready.
 *
 * Each response maps to the Nth user question (0-indexed).
 * If the user sends more questions than responses available,
 * the last response is used as a fallback.
 */
export const MOCK_AI_RESPONSES: string[] = [
  'You responded to resistance with validation and gentle problem-solving, which reduced defensiveness. You validated feelings and offered "start small" steps effectively. Next time, hold the emotional space a bit longer before proposing strategies so the client feels fully heard.',

  "Your active listening skills were strong throughout the session. You paraphrased the client's concerns accurately and maintained appropriate eye contact. One area to improve: try summarizing the client's key points before transitioning to a new topic.",

  'You demonstrated solid empathy when the client shared their frustration. Your tone was warm and non-judgmental. Consider using more open-ended questions early in the conversation to let the client lead the discussion rather than guiding them toward specific topics.',

  'Your use of reflective statements was effective in building rapport. The client visibly relaxed after you mirrored their feelings. To strengthen this further, try incorporating silence strategically — giving the client 3-5 seconds to process can lead to deeper sharing.',

  'You handled the emotional escalation well by staying calm and grounded. Your de-escalation technique of acknowledging the emotion before addressing the content was textbook. One suggestion: slow your speaking pace during high-tension moments to convey more steadiness.',

  'Your closing was well-structured — you summarized key takeaways and set clear next steps. However, the transition to closing felt slightly abrupt. Try signaling the wrap-up 2-3 minutes earlier so the client has time to raise any last concerns.',

  'You showed great adaptability when the client changed topics unexpectedly. You followed their lead without losing track of the session goals. For improvement, consider gently naming the shift ("I notice we moved to a different area — shall we explore this or return to what we were discussing?").',

  'Overall, your session demonstrated growth in emotional attunement and structured communication. The balance between empathy and problem-solving has improved significantly compared to earlier sessions. Keep focusing on pacing and strategic silence as your next development areas.',
];

/** Maximum number of messages (user + AI combined) allowed in the chat */
export const MAX_MESSAGES = 8;

/** Delay in ms before the AI "starts responding" (simulates server processing) */
export const MOCK_RESPONSE_DELAY_MS = 1200;

/** Interval in ms between streaming each word of the AI response (higher = slower) */
export const MOCK_STREAM_INTERVAL_MS = 90;
