// Track 2.0 learner types — multi-component learning courses (sections of
// roleplay/case/quiz/article/video/journal items). Mirrors the ally-be
// `v1/learn/tracks` learner API contract (same shapes as ally-web's
// `src/types/tracks.ts`).

export enum TrackItemType {
  ROLEPLAY = 'ROLEPLAY',
  CASE = 'CASE',
  QUIZ = 'QUIZ',
  ARTICLE = 'ARTICLE',
  VIDEO = 'VIDEO',
  JOURNAL = 'JOURNAL',
  GAME = 'GAME',
}

/** Games the app can render; each maps to a bundle under `players/games/`. */
export enum TrackGameKey {
  TREX_RUNNER = 'TREX_RUNNER',
  TIC_TAC_TOE = 'TIC_TAC_TOE',
  MEMORY_MATCH = 'MEMORY_MATCH',
  CUB_N_PUP = 'CUB_N_PUP',
  SNAKE = 'SNAKE',
  SPROUT = 'SPROUT',
  BREATHING_EXERCISE = 'BREATHING_EXERCISE',
}

// There is no IN_PROGRESS status server-side — "in progress" is derived as
// `status === UNLOCKED && startedAt != null`.
export enum TrackItemStatus {
  LOCKED = 'LOCKED',
  UNLOCKED = 'UNLOCKED',
  COMPLETED = 'COMPLETED',
}

export type TrackVideoSource = 's3' | 'youtube' | 'vimeo' | 'loom';

export interface TrackListItem {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  totalItems: number;
  estimatedDurationMinutes: number | null;
  enrolled: boolean;
  completedItems: number;
  completedAt: string | null;
  lastActivityAt: string | null;
  trackEnrollmentId: string | null;
}

export interface GetLearnTracksResponse {
  data: TrackListItem[];
  count: number;
}

export interface TrackCompletionCriteria {
  minScore?: number;
  minDurationSeconds?: number;
  passScore?: number;
  watchPct?: number;
  minReadSeconds?: number;
}

/** Type-specific display metadata for the overview meta line. */
export interface TrackItemContentMeta {
  // QUIZ
  questionCount?: number;
  passScore?: number;
  // VIDEO
  durationSeconds?: number;
  source?: TrackVideoSource;
  // JOURNAL
  promptCount?: number;
  // GAME
  gameKey?: TrackGameKey;
}

/**
 * Why a component reads in English even though the learner picked another
 * language. Null when it reads in their language.
 */
export enum TrackLanguageFallbackReason {
  /** No dubbed cut of this video for the chosen language. */
  VIDEO_NOT_LOCALISED = 'VIDEO_NOT_LOCALISED',
  /** The linked simulation has no translation in the chosen language. */
  SCENARIO_NOT_TRANSLATED = 'SCENARIO_NOT_TRANSLATED',
  /** Cases carry no translations of their own yet. */
  CASE_NOT_TRANSLATED = 'CASE_NOT_TRANSLATED',
}

/** A language this course is published in. */
export interface TrackLanguageOption {
  languageId: number;
  languageCode: string;
  label: string;
  isSource: boolean;
}

export interface GetTrackLanguagesResponse {
  languages: TrackLanguageOption[];
  /** The learner's saved choice for this course, if they have made one. */
  selectedLanguageCode: string | null;
}

export interface TrackDetailItem {
  id: string;
  type: TrackItemType;
  order: number;
  title: string;
  description: string | null;
  /**
   * Optional on purpose: a released build must keep parsing a payload from a
   * backend that predates this field, and an unknown reason should read as
   * "no notice" rather than breaking the card.
   */
  languageFallbackReason?: TrackLanguageFallbackReason | null;
  scenarioId: number | null;
  caseId: string | null;
  completionCriteria: TrackCompletionCriteria | null;
  contentMeta: TrackItemContentMeta | null;
  status: TrackItemStatus;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
  attemptCount: number | null;
  maxWatchedPct: number | null;
  /**
   * Optional for the same released-build reason as `languageFallbackReason`
   * above: a backend that predates course discussions omits it, and it
   * should read as "no discussion" rather than breaking the card.
   */
  hasDiscussion?: boolean;
}

export interface TrackSection {
  id: string;
  title: string;
  description: string | null;
  order: number;
  items: TrackDetailItem[];
}

export interface TrackDetail {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  status: string;
  totalItems: number;
  estimatedDurationMinutes: number | null;
  enrolled: boolean;
  trackEnrollmentId: string | null;
  completedItems: number;
  completedAt: string | null;
  sections: TrackSection[];
  /**
   * What the learner is reading this course in right now, and what else they
   * can switch to. Both optional for the same released-build reason as
   * `TrackDetailItem.languageFallbackReason` — an older backend omits them, and
   * the screen then simply shows no language row.
   */
  languageCode?: string;
  availableLanguages?: TrackLanguageOption[];
}

export interface EnrollTrackResponse {
  trackEnrollmentId: string;
  alreadyEnrolled: boolean;
}

export interface NextTrackItem extends TrackDetailItem {
  sectionId: string;
  sectionTitle: string;
}

export interface GetNextTrackItemResponse {
  trackCompleted: boolean;
  nextItem: NextTrackItem | null;
}

// ---------------------------------------------------------------------------
// Progress + consolidated feedback dashboard
// ---------------------------------------------------------------------------

export type SkillFeedbackClassification =
  | 'demonstrated'
  | 'needs_practice'
  | 'insufficient_data';

export interface TrackProgressSectionSummary {
  id: string;
  title: string;
  order: number;
  completedItems: number;
  totalItems: number;
}

/**
 * One skillCoverage category, averaged across every evaluated roleplay
 * session in this course. `category` is a raw pass-through string — both
 * label generations seen across the platform's history can appear.
 */
export interface TrackSkillCategoryFeedback {
  category: string;
  averagePercentage: number | null;
  sampleSize: number;
  classification: SkillFeedbackClassification;
}

export interface TrackRoleplaySessionFeedback {
  trackItemId: string;
  trackItemTitle: string | null;
  scenarioSessionId: string;
  compositeScore: number | null;
  occurredAt: string | null;
  evaluationMarkdown: string | null;
}

export interface TrackProgressDashboard {
  trackId: string;
  title: string;
  trackEnrollmentId: string;
  totalItems: number;
  completedItems: number;
  completionPct: number;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  sections: TrackProgressSectionSummary[];
  evaluatedRoleplaySessionCount: number;
  averageCompositeScore: number | null;
  skillCategories: TrackSkillCategoryFeedback[];
  roleplaySessions: TrackRoleplaySessionFeedback[];
}

// ---------------------------------------------------------------------------
// Quiz (sanitized — answer keys stripped server-side)
// ---------------------------------------------------------------------------

export type QuizQuestionType =
  | 'mcq_single'
  | 'mcq_multi'
  | 'true_false'
  | 'ordering'
  | 'matching'
  | 'fill_blank'
  | 'open_ended'
  | 'likert_scale';

export interface QuizOption {
  id: string;
  text: string;
}

/**
 * A picture or clip shown with a question, part of the stem rather than
 * decoration. Mirrors ally-be's `QuestionMedia`; present on any sanitized
 * question — quiz, video interjection or inline article question.
 */
export interface QuestionMedia {
  kind: 'image' | 'video';
  /** `s3` = a file the trainer uploaded; the rest are third-party embeds. */
  source: 's3' | 'youtube' | 'vimeo' | 'loom';
  url: string;
  /** Images only — what the picture shows, for screen readers. */
  alt?: string;
  /**
   * Uploaded video only: a still frame captured at author time. Without it
   * a paused-at-zero clip is a black box on Android, which is the wrong
   * thing to show someone being asked what they observe.
   */
  posterUrl?: string;
}

export interface SanitizedQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  promptHtml?: string;
  points: number;
  /**
   * false = answered but not scored; absent (older backend) reads as true.
   * Always present, and always false, for `likert_scale`.
   */
  graded?: boolean;
  /** Optional picture or clip shown above the answer controls. */
  media?: QuestionMedia;
  /** mcq_single / mcq_multi */
  options?: QuizOption[];
  /** ordering (pre-shuffled server-side) */
  items?: QuizOption[];
  /** matching */
  left?: QuizOption[];
  /** matching (pre-shuffled server-side, may include distractors) */
  right?: QuizOption[];
  /** fill_blank — template with `{{blankId}}` tokens */
  template?: string;
  blankIds?: string[];
  /** open_ended */
  minWords?: number;
  /** likert_scale — rows to rate, authored order, never shuffled. */
  statements?: QuizOption[];
  /** likert_scale — scale points, lowest first, authored order, never shuffled. */
  scale?: QuizOption[];
}

export interface SanitizedQuiz {
  settings: {
    passScore: number;
    maxAttempts: number | null;
    showExplanations: string;
  };
  questions: SanitizedQuizQuestion[];
  /** Graded questions only; 0 means a survey with no score to pass. */
  totalPoints: number;
}

export interface QuizAnswerInput {
  questionId: string;
  selectedOptionIds?: string[];
  booleanAnswer?: boolean;
  orderedItemIds?: string[];
  pairs?: {leftId: string; rightId: string}[];
  blanks?: {blankId: string; answer: string}[];
  text?: string;
  /** likert_scale — one rating per statement; every statement must be rated. */
  ratings?: {statementId: string; scaleOptionId: string}[];
}

// ---------------------------------------------------------------------------
// Video interjections (learner playback only — trainer authoring is
// web-only). Only ever populated for `source === 's3'` items; empty
// otherwise. Mirrors ally-be's `VideoInterjection` learner contract.
// ---------------------------------------------------------------------------

/** Locally/server-tracked outcome of an already-answered interjection. */
export interface VideoInterjectionAnsweredState {
  passed: boolean;
  pointsAwarded?: number;
}

export interface VideoInterjection {
  id: string;
  timestampSeconds: number;
  /** Sanitized — no answer key. */
  question: SanitizedQuizQuestion;
  answered?: VideoInterjectionAnsweredState;
}

export interface VideoInterjectionAnswerGrading {
  questionId: string;
  /** null = pending LLM grading (not expected here — see `llm`). */
  correct: boolean | null;
  pointsAwarded: number;
  pointsPossible: number;
  llm?: {
    feedback?: string;
  };
}

export interface VideoInterjectionAnswerResult {
  correct: boolean | null;
  grading: VideoInterjectionAnswerGrading;
}

export type QuizAttemptStatus = 'GRADED' | 'PENDING_GRADING';

/**
 * The answer key as the results screen shows it. Same field names as
 * `QuizAnswerInput`, so "your answer" and "correct answer" resolve through
 * one set of question-shape lookups. Mirrors ally-be's `QuizCorrectAnswer`.
 * Never present for `likert_scale` or `open_ended`.
 */
export interface QuizCorrectAnswer {
  selectedOptionIds?: string[];
  booleanAnswer?: boolean;
  orderedItemIds?: string[];
  pairs?: {leftId: string; rightId: string}[];
  blanks?: {blankId: string; acceptedAnswers: string[]}[];
}

export interface QuizQuestionResult {
  questionId: string;
  /**
   * null now means EITHER pending LLM grading OR ungraded-without-a-key.
   * Pending = `correct === null && graded !== false`.
   */
  correct: boolean | null;
  /** false = not scored; absent (older backend) reads as true. */
  graded?: boolean;
  pointsAwarded: number;
  pointsPossible: number;
  explanation?: string;
  llmFeedback?: string;
  /**
   * The answer key, present only when the question has one and the trainer
   * didn't hide it (`showCorrectAnswer !== false`). Absent on a graded
   * question means: show the verdict, not "hidden".
   */
  correctAnswer?: QuizCorrectAnswer;
}

export interface QuizAttemptResult {
  attemptId: string;
  attemptNumber: number;
  status: QuizAttemptStatus;
  /** null when the quiz has no graded questions (a survey). */
  scorePct: number | null;
  passed: boolean;
  passScore: number;
  attemptsUsed: number;
  maxAttempts: number | null;
  questions: QuizQuestionResult[];
  itemCompleted: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface JournalPrompt {
  id: string;
  prompt: string;
  promptHtml?: string;
  required: boolean;
  placeholder: string | null;
}

export interface JournalSavedResponse {
  promptId: string;
  response: string;
  submittedAt: string | null;
}

// ---------------------------------------------------------------------------
// Breathing Exercise
// ---------------------------------------------------------------------------

export interface BreathingExerciseContent {
  inhale: number;
  holdIn: number;
  exhale: number;
  holdOut: number;
  cycles: number;
  inhaleText: string;
  holdInText: string;
  exhaleText: string;
  holdOutText: string;
}

// ---------------------------------------------------------------------------
// Start-item payload (type-discriminated)
// ---------------------------------------------------------------------------

interface StartTrackItemBase {
  trackItemProgressId: string;
}

export interface StartRoleplayItemPayload extends StartTrackItemBase {
  type: TrackItemType.ROLEPLAY;
  scenarioId: number;
  completionCriteria: TrackCompletionCriteria | null;
  /** Latest ended scenario session for this item, when already completed. */
  lastScenarioSessionId: string | null;
}

export interface StartCaseItemPayload extends StartTrackItemBase {
  type: TrackItemType.CASE;
  caseId: string;
  caseSessionId: string;
  caseCompleted: boolean;
}

export interface StartQuizItemPayload extends StartTrackItemBase {
  type: TrackItemType.QUIZ;
  quiz: SanitizedQuiz;
  attemptsUsed: number;
  maxAttempts: number | null;
}

/**
 * How the learner has already answered one inline article question. Present
 * on a resumed article so the reader redraws the resolved state rather than
 * offering a second go at a question that is already spent.
 */
export interface AnsweredArticleQuestion {
  selectedOptionId: string;
  correct: boolean;
  /** ISO timestamp. */
  answeredAt: string;
}

/**
 * A single-select MCQ embedded in an article's prose. Where it sits is marked
 * in `html` by an empty `<div data-ally-question="<id>">` placeholder, which
 * the player splits the body on. Sanitized like any other learner-bound
 * question: `correctOptionId` and `explanation` arrive only once the question
 * has been answered and can never be answered again.
 */
export interface ArticleQuestion extends SanitizedQuizQuestion {
  answered: AnsweredArticleQuestion | null;
  correctOptionId: string | null;
  explanation: string | null;
}

/** A curated external link shown after the article body. Supplementary — never gates completion. */
export interface ArticleResource {
  id: string;
  title: string;
  url: string;
}

export interface StartArticleItemPayload extends StartTrackItemBase {
  type: TrackItemType.ARTICLE;
  html: string;
  minReadSeconds: number;
  /** Empty for an article authored without questions. */
  questions?: ArticleQuestion[];
  answeredQuestionCount?: number;
  resources?: ArticleResource[];
}

/** Response to `POST .../article-questions/:questionId/answer`. */
export interface SubmitArticleQuestionAnswerResult {
  correct: boolean;
  selectedOptionId: string;
  correctOptionId: string;
  explanation: string | null;
  answeredQuestionCount: number;
  totalQuestionCount: number;
  /** Non-null only when this answer completed the article. */
  completion: TrackItemCompletionResult | null;
}

export interface StartVideoItemPayload extends StartTrackItemBase {
  type: TrackItemType.VIDEO;
  source: TrackVideoSource;
  url: string;
  durationSeconds: number;
  requiredWatchPct: number;
  maxWatchedPct: number;
  /**
   * Quiz questions embedded at specific timestamps. Empty when the source
   * isn't `s3` or none were authored; optional so a released build still
   * parses a payload from a backend that predates this field.
   */
  interjections?: VideoInterjection[];
}

export interface StartJournalItemPayload extends StartTrackItemBase {
  type: TrackItemType.JOURNAL;
  prompts: JournalPrompt[];
  savedResponses: JournalSavedResponse[];
}

/**
 * A game completes the moment it is opened, so the payload carries the
 * completion result the other players get back from a submit — the player
 * reports it on mount and Next is live immediately.
 */
export interface StartGameItemPayload extends StartTrackItemBase {
  type: TrackItemType.GAME;
  gameKey: TrackGameKey;
  intro: string | null;
  /** Personal best across every run so far, or null before the first. */
  bestScore: number | null;
  playCount: number;
  completion: TrackItemCompletionResult;
  breathingExercise?: BreathingExerciseContent;
}

export type StartTrackItemResponse =
  | StartRoleplayItemPayload
  | StartCaseItemPayload
  | StartQuizItemPayload
  | StartArticleItemPayload
  | StartVideoItemPayload
  | StartJournalItemPayload
  | StartGameItemPayload;

// ---------------------------------------------------------------------------
// Completion results
// ---------------------------------------------------------------------------

export interface TrackItemCompletionResult {
  completed: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
}

export interface VideoProgressResult extends TrackItemCompletionResult {
  maxWatchedPct: number;
}

/**
 * Roleplay/case return-to-track context persisted (via AsyncStorage — see
 * `src/utils/activeTrackContext.ts`) before launching a simulation/case from
 * the course player, so the learner can be routed back into the player once
 * that flow reports completion out-of-band.
 */
export interface ActiveTrackContext {
  trackId: string;
  itemId: string;
}
