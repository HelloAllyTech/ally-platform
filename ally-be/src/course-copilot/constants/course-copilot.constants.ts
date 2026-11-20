import {
  TRACK_MAX_ITEMS_PER_SECTION,
  TRACK_MAX_SECTIONS,
} from 'src/track/constants/track.constant';
import { ScenarioCategory } from 'src/learn/enum/scenario-category.enum';
import { CourseCopilotJobKind } from '../enum/course-copilot.enum';

// ── Turn loop ───────────────────────────────────────────────────────────────

export const COURSE_COPILOT_TURN_LOCK_PREFIX = 'course-copilot-turn';
/** A turn is one question, or one blueprint plan — minutes, not hours. */
export const COURSE_COPILOT_TURN_LOCK_TTL_SECONDS = 5 * 60;
/** The planner call can sit silent for a minute; proxies drop idle streams. */
export const COURSE_COPILOT_SSE_PING_INTERVAL_MS = 15_000;
/** The blueprint is the largest tool payload, and far smaller than this. */
export const COURSE_COPILOT_INTERVIEW_MAX_TOKENS = 16_000;
export const COURSE_COPILOT_SYSTEM_PROMPT_TTL_MS = 60_000;
export const COURSE_COPILOT_MAX_TRUNCATION_RETRIES = 2;
export const COURSE_COPILOT_SUMMARY_AFTER_MESSAGES = 40;
export const COURSE_COPILOT_SUMMARY_KEEP_RECENT = 16;
export const COURSE_COPILOT_DEFAULT_MAX_TOOL_ITERATIONS = 10;

// ── Build runner ────────────────────────────────────────────────────────────

export const COURSE_COPILOT_DEFAULT_CONCURRENCY = 4;
/** How often a running job proves it is alive. */
export const COURSE_COPILOT_JOB_HEARTBEAT_MS = 30_000;
/**
 * A running job silent for this long is presumed dead (a deploy, a crash).
 * Six missed heartbeats: the beat is a timer, not work, so a live job misses
 * one only when its process is gone.
 */
export const COURSE_COPILOT_JOB_STALE_MS = 3 * 60_000;
/** After boot, resume orphaned builds this soon rather than at the next tick. */
export const COURSE_COPILOT_BOOT_RECONCILE_DELAY_MS = 30_000;
/** Attempts per job: the first run plus one repair pass with the validator's errors. */
export const COURSE_COPILOT_JOB_MAX_ATTEMPTS = 2;
export const COURSE_COPILOT_BUILD_LOCK_PREFIX = 'course-copilot-build';
export const COURSE_COPILOT_STRUCTURE_LOCK_PREFIX = 'course-copilot-structure';
export const COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS = 60;
/** Job results that land together are written as one structure save. */
export const COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS = 2_000;
export const COURSE_COPILOT_RECONCILE_TASK = 'course-copilot.reconcile';
export const COURSE_COPILOT_RECONCILE_INTERVAL = '5min';
export const COURSE_COPILOT_EVENT_PAYLOAD_MAX_BYTES = 8_192;
/** An inline item added mid-turn by an edit tool must come back within a turn. */
export const COURSE_COPILOT_INLINE_SPECIALIST_TIMEOUT_MS = 90_000;

// ── Limits (enforced in code, not only in the prompt) ──────────────────────

export const COURSE_COPILOT_LIMITS = {
  activeSessionsPerUser: 2,
  sections: Math.min(8, TRACK_MAX_SECTIONS),
  items: 40,
  itemsPerSection: Math.min(12, TRACK_MAX_ITEMS_PER_SECTION),
  newRoleplays: 4,
  newCases: 2,
  images: 12,
  languagesPerRoleplay: 4,
  competencies: 15,
  quizQuestions: 20,
  articleQuestions: 5,
  annotationUnits: 60,
  annotationLabels: 6,
  journalPrompts: 3,
  /** Scenes in a generated scenario quiz; the track allows 100, the manual aims for 5-12. */
  scenarioQuizScenes: 20,
  /** Items in a generated bucket sort; the track allows 30, the manual aims for 8-12. */
  bucketSortItems: 20,
  reviewFindings: 10,
} as const;

/** Durations the interview offers, minutes. Anything else is still accepted. */
// ── Reference material ───────────────────────────────────────────────────────

/**
 * Limits on the files a trainer attaches to one session. A partner manual is rarely more than a
 * few hundred pages; the character cap keeps one session's passages small enough to rank in
 * memory on every writer call.
 */
export const COURSE_COPILOT_SOURCE_LIMITS = {
  maxFiles: 10,
  maxBytes: 50 * 1024 * 1024,
  maxCharsPerSession: 2_000_000,
  /** The interviewer's overview of every file, in its system context. */
  overviewChars: 12_000,
  /** Passages handed to one writer or planner call. */
  referenceChars: 9_000,
};

/**
 * How reference material may be used (decided 2026-11-19): take the CONTENT — facts, steps,
 * examples, structure — and write it in your own words; key terms, the partner's own tool and
 * programme names, and helpline numbers stay exactly as written.
 */
export const COURSE_COPILOT_SOURCE_RULES = {
  interviewer:
    'Use these files before asking the trainer anything: draft the brief from them (audience, ' +
    "outcomes, the partner's terms, existing exercises) and ask only what they do not answer. " +
    'Call search_sources for detail. The course should follow their content — facts, steps, ' +
    "examples, structure — written in Ally's own words; key terms, the partner's own tool and " +
    'programme names, and helpline numbers stay exactly as written. When the files and the ' +
    'trainer disagree, the trainer wins.',
  writer:
    'REFERENCE MATERIAL — passages from files the trainer attached for this course. Base the ' +
    'content on them: follow their facts, steps, examples and order, and do not contradict them. ' +
    'Write in your own words, in the format asked for above; do not copy sentences. Keep key ' +
    "terms, the partner's own tool and programme names, and helpline numbers exactly as written. " +
    'If a passage is off-topic for this item, ignore it.',
};

/**
 * Course lengths the interview offers. (Course Pilot's "under 30 minutes" is the TRAINER's time
 * to build a course, not the course's length — its own example is a 90-minute course.)
 */
export const COURSE_COPILOT_DURATION_OPTIONS = [30, 60, 90, 120];
/** Used for an hour-long course when the brief names no duration. */
export const COURSE_COPILOT_DEFAULT_DURATION_MINUTES = 60;

/**
 * How an interview question may look (Course Pilot: choice-only steps). Checked on every
 * question before the trainer sees it; a question that breaks one is sent back once.
 */
export const COURSE_COPILOT_QUESTION_LIMITS = {
  minOptions: 2,
  maxOptions: 5,
  promptChars: 160,
  /** The reply shown above a question: one short sentence, not an account of the work. */
  replyChars: 220,
};

// ── Cost ────────────────────────────────────────────────────────────────────

export const COURSE_COPILOT_DEFAULT_BUDGET_USD = 15;
/**
 * Images have no row in the pricing table by design, so the copilot counts
 * each one at a flat rate. Close enough for a ceiling; wrong for an invoice.
 */
export const COURSE_COPILOT_DEFAULT_IMAGE_COST_USD = 0.1;

/**
 * Static per-job estimates, USD. Approval is refused when the sum exceeds the
 * remaining budget, so these err high. Tune against real `llm_usage` sums
 * after a few builds (plan §10, "Cost check").
 */
export const COURSE_COPILOT_JOB_COST_ESTIMATE_USD: Record<
  CourseCopilotJobKind,
  number
> = {
  [CourseCopilotJobKind.COURSE_META]: 0.01,
  [CourseCopilotJobKind.ARTICLE]: 0.05,
  [CourseCopilotJobKind.QUIZ]: 0.08,
  [CourseCopilotJobKind.JOURNAL]: 0.01,
  [CourseCopilotJobKind.ANNOTATED_ARTIFACT]: 0.1,
  [CourseCopilotJobKind.BRANCHING_SCENARIO]: 0.1,
  [CourseCopilotJobKind.BUCKET_SORT]: 0.05,
  [CourseCopilotJobKind.GAME]: 0,
  [CourseCopilotJobKind.VIDEO]: 0,
  [CourseCopilotJobKind.ROLEPLAY_NEW]: 0.6,
  [CourseCopilotJobKind.ROLEPLAY_REF]: 0,
  [CourseCopilotJobKind.CASE_NEW]: 0,
  [CourseCopilotJobKind.CASE_REF]: 0,
  [CourseCopilotJobKind.COVER_IMAGE]: 0.11,
  [CourseCopilotJobKind.ARTICLE_IMAGE]: 0.11,
  [CourseCopilotJobKind.COURSE_REVIEW]: 0.1,
};
/** Each spoken language past the first adds its per-language field calls. */
export const COURSE_COPILOT_EXTRA_LANGUAGE_COST_USD = 0.15;
/** The interview itself, so a fresh session can't approve to the cent. */
export const COURSE_COPILOT_PLANNER_COST_USD = 0.1;

/** Default minutes per item type when the planner leaves one out. */
export const COURSE_COPILOT_DEFAULT_ITEM_MINUTES: Record<string, number> = {
  ARTICLE: 6,
  QUIZ: 5,
  JOURNAL: 4,
  ANNOTATED_ARTIFACT: 8,
  BRANCHING_SCENARIO: 8,
  BUCKET_SORT: 4,
  ROLEPLAY: 12,
  CASE: 25,
  GAME: 3,
  VIDEO: 5,
};

// ── Model calls ─────────────────────────────────────────────────────────────

/** Prompt codes: `course_copilot/<file>.txt` → `course_copilot_<file>`. */
export const COURSE_COPILOT_PROMPTS = {
  INTERVIEWER_SYSTEM: 'course_copilot_interviewer_system',
  BLUEPRINT_PLANNER: 'course_copilot_blueprint_planner',
  ARTICLE_WRITER: 'course_copilot_article_writer',
  QUIZ_WRITER: 'course_copilot_quiz_writer',
  JOURNAL_WRITER: 'course_copilot_journal_writer',
  ANNOTATION_WRITER: 'course_copilot_annotation_writer',
  SCENARIO_QUIZ_WRITER: 'course_copilot_scenario_quiz_writer',
  BUCKET_SORT_WRITER: 'course_copilot_bucket_sort_writer',
  COURSE_META: 'course_copilot_course_meta',
  COURSE_REVIEWER: 'course_copilot_course_reviewer',
  HISTORY_SUMMARY: 'course_copilot_history_summary',
  ROLEPLAY_BRIEF: 'course_copilot_roleplay_brief',
  ROLEPLAY_FIT_CHECK: 'course_copilot_roleplay_fit_check',
  IMAGE_PROMPT: 'course_copilot_image_prompt',
  LANDING_PAGE_WRITER: 'course_copilot_landing_page_writer',
  ALLY_NOTES_WRITER: 'course_copilot_ally_notes_writer',
} as const;

/** AI-task-registry row ids, one per call site. */
export const COURSE_COPILOT_AI_TASKS = {
  INTERVIEW: 'course-copilot-interview',
  BLUEPRINT: 'course-copilot-blueprint',
  ARTICLE: 'course-copilot-article',
  QUIZ: 'course-copilot-quiz',
  JOURNAL: 'course-copilot-journal',
  ANNOTATION: 'course-copilot-annotation',
  SCENARIO_QUIZ: 'course-copilot-scenario-quiz',
  BUCKET_SORT: 'course-copilot-bucket-sort',
  META: 'course-copilot-meta',
  REVIEW: 'course-copilot-review',
  SUMMARY: 'course-copilot-summary',
  ROLEPLAY_BRIEF: 'course-copilot-roleplay-brief',
  ROLEPLAY_FIT_CHECK: 'course-copilot-roleplay-fit-check',
  IMAGE_PROMPT: 'course-copilot-image-prompt',
  IMAGE: 'course-copilot-image',
  LANDING_PAGE: 'course-copilot-landing-page',
  ALLY_NOTES: 'course-copilot-ally-notes',
} as const;

/** Category every generated roleplay carries, so the library can filter them. */
export const COURSE_COPILOT_SCENARIO_CATEGORY = ScenarioCategory.COURSE_COPILOT;

/** Where generated images land — the same prefix the editor's uploads use. */
export const COURSE_COPILOT_MEDIA_PREFIX = 'track-media/image';
