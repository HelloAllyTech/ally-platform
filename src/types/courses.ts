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
// Quiz (sanitized — answer keys stripped server-side)
// ---------------------------------------------------------------------------

export type QuizQuestionType =
  | 'mcq_single'
  | 'mcq_multi'
  | 'true_false'
  | 'ordering'
  | 'matching'
  | 'fill_blank'
  | 'open_ended';

export interface QuizOption {
  id: string;
  text: string;
}

export interface SanitizedQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  points: number;
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
}

export interface SanitizedQuiz {
  settings: {
    passScore: number;
    maxAttempts: number | null;
    showExplanations: string;
  };
  questions: SanitizedQuizQuestion[];
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
}

export type QuizAttemptStatus = 'GRADED' | 'PENDING_GRADING';

export interface QuizQuestionResult {
  questionId: string;
  /** null = pending LLM grading */
  correct: boolean | null;
  pointsAwarded: number;
  pointsPossible: number;
  explanation?: string;
  llmFeedback?: string;
}

export interface QuizAttemptResult {
  attemptId: string;
  attemptNumber: number;
  status: QuizAttemptStatus;
  scorePct: number;
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
  required: boolean;
  placeholder: string | null;
}

export interface JournalSavedResponse {
  promptId: string;
  response: string;
  submittedAt: string | null;
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

export interface StartArticleItemPayload extends StartTrackItemBase {
  type: TrackItemType.ARTICLE;
  html: string;
  minReadSeconds: number;
}

export interface StartVideoItemPayload extends StartTrackItemBase {
  type: TrackItemType.VIDEO;
  source: TrackVideoSource;
  url: string;
  durationSeconds: number;
  requiredWatchPct: number;
  maxWatchedPct: number;
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
