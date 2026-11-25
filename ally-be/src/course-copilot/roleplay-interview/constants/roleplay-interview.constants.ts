// Per-session turn mutex (SET NX EX): concurrent streams would interleave tool loops.
export const ROLEPLAY_INTERVIEW_TURN_LOCK_PREFIX = 'roleplay-interview-turn';
export const ROLEPLAY_INTERVIEW_TURN_LOCK_TTL_SECONDS = 5 * 60;

// SSE keep-alive: proxies drop idle streams.
export const ROLEPLAY_INTERVIEW_SSE_PING_INTERVAL_MS = 15_000;

/** Output cap for one pass. The largest call is propose_plan, a page of text. */
export const ROLEPLAY_INTERVIEW_MAX_TOKENS = 8192;

/** The character question's option for "write a new character" (its other options are ids). */
export const NEW_CHARACTER_VALUE = 'new';

/** Bound on each of the runner's three retries (truncated, unreadable, empty). */
export const ROLEPLAY_INTERVIEW_MAX_RETRIES = 2;

/** Fallback when the environment's Course Copilot setting is unset. */
export const ROLEPLAY_INTERVIEW_DEFAULT_MAX_ITERATIONS = 8;

/** Prompt registry code (src/prompts/roleplay_interview/interviewer_system.txt). */
export const ROLEPLAY_INTERVIEW_PROMPTS = {
  INTERVIEWER_SYSTEM: 'roleplay_interview_interviewer_system',
} as const;

/** What a question card may hold. One short choice at a time. */
export const ROLEPLAY_INTERVIEW_QUESTION_LIMITS = {
  minOptions: 2,
  maxOptions: 4,
  promptChars: 160,
  replyChars: 240,
};

/** Shape bounds on a proposed plan. */
export const ROLEPLAY_INTERVIEW_PLAN_LIMITS = {
  minMoments: 2,
  maxMoments: 5,
  minStates: 3,
  maxStates: 5,
  maxBehaviours: 12,
  defaultMinScore: 70,
};

/** Shape bounds on brief fields. */
export const ROLEPLAY_INTERVIEW_BRIEF_LIMITS = {
  shortText: 300,
  longText: 2000,
  maxCompetencies: 5,
  maxLanguages: 6,
  maxBehaviours: 12,
  maxNotes: 30,
  maxLengthMinutes: 60,
};
