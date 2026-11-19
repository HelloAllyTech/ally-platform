import { AssignmentStatus } from 'src/common/type/common.type';
import { McqSingleQuestion, QuizQuestion } from './quiz.type';
import { BranchingRun } from './branching.type';
import { BucketSortAnswer } from './bucket-sort.type';

export enum TrackStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum TrackItemType {
  ROLEPLAY = 'ROLEPLAY',
  CASE = 'CASE',
  QUIZ = 'QUIZ',
  ARTICLE = 'ARTICLE',
  VIDEO = 'VIDEO',
  JOURNAL = 'JOURNAL',
  ANNOTATED_ARTIFACT = 'ANNOTATED_ARTIFACT',
  GAME = 'GAME',
  BRANCHING_SCENARIO = 'BRANCHING_SCENARIO',
  BUCKET_SORT = 'BUCKET_SORT',
}

/**
 * Why a signed-in learner cannot take a course. Returned by the access check
 * behind a shared course link, so the landing page can say "not available"
 * without the learner first hitting a 403 mid-flow.
 */
export enum TrackAccessDenialReason {
  /** Deleted, never published, or archived with no enrolment to finish. */
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  /** The learner's account carries no organisation. */
  NO_ORGANIZATION = 'NO_ORGANIZATION',
  /** The course is not assigned to the learner's organisation. */
  NOT_IN_ORGANIZATION = 'NOT_IN_ORGANIZATION',
  /** Assigned to the organisation, but restricted away from their group. */
  NOT_IN_GROUP = 'NOT_IN_GROUP',
}

export enum TrackProgressionMode {
  SEQUENTIAL = 'SEQUENTIAL',
}

export enum TrackSectionUnlockRule {
  SEQUENTIAL = 'SEQUENTIAL',
}

export enum TrackSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export enum TrackSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum VideoSource {
  S3 = 's3',
  YOUTUBE = 'youtube',
  VIMEO = 'vimeo',
  LOOM = 'loom',
}

export interface TrackFilterOptions {
  status?: string[];
  limit?: number;
  offset?: number;
  search?: string;
  tenantId?: string;
  /** Only meaningful together with tenantId; ignored without it. */
  assignmentStatus?: AssignmentStatus;
  sortBy?: TrackSortBy;
  order?: TrackSortOrder;
  /** Only courses this user created (ContentAccessService.ownerFilterFor). */
  createdByUserId?: number | null;
}

export interface TrackTranslations {
  title?: string;
  description?: string;
}

/**
 * A multiple-choice question embedded in an article's prose. The question
 * itself lives here, in `ArticleContent.questions`; where it *sits* in the
 * article is marked in the HTML by an empty
 * `<div data-ally-question="<id>"></div>` placeholder, the same
 * separate-the-key-from-the-text idea as `FillBlankQuestion.template`'s
 * `{{blankId}}` tokens. Keeping the question out of the HTML means the answer
 * key never passes through the rich-text sanitizer and never reaches the
 * learner's payload — `sanitizeQuizQuestionForLearner` strips it on the way
 * out, exactly as it does for a video interjection.
 *
 * Restricted to single-select MCQ (see `validateArticleQuestions`): an article
 * question is a reading check the learner answers in place, so anything that
 * needs LLM grading or a multi-step widget belongs in a QUIZ component.
 */
export type ArticleQuestion = McqSingleQuestion;

/**
 * A curated external link shown in the "Resources" list after an article's
 * body — supplementary reading, never required: nothing here gates
 * completion, and the player opens it in place (a modal/sheet with an
 * embedded view) rather than sending the learner out of the app, per
 * "reach curated material without leaving the course".
 */
export interface ArticleResource {
  id: string;
  title: string;
  url: string;
}

/**
 * How the learner sees an article. The text is the same in every mode; only
 * the presentation changes, so switching never touches progress or answers.
 */
export enum ArticleExperience {
  /** A simple page of text. The default, and what every older article is. */
  CLASSIC = 'CLASSIC',
  /** Cover photo, big headline and editorial type, for longer reads. */
  MAGAZINE = 'MAGAZINE',
  /**
   * One section per card, swiped through on a phone. A new card starts at
   * each top-level `<h2>`, and each inline question gets a card of its own.
   */
  CARDS = 'CARDS',
}

/** An uploaded photo that opens the article (Magazine and Cards lead with it). */
export interface ArticleCover {
  /** An uploaded file (https). */
  url: string;
  /** What the photo shows, for screen readers. Translatable. */
  alt?: string;
}

export interface ArticleContent {
  html: string;
  imageUrls?: string[];
  questions?: ArticleQuestion[];
  resources?: ArticleResource[];
  /** Absent ⇒ CLASSIC. */
  experience?: ArticleExperience;
  cover?: ArticleCover;
  /** Short points shown at the end of the article. Translatable. */
  takeaways?: string[];
}

/**
 * Marks a highlight box in an article's HTML:
 * `<div data-ally-callout="say"><p>…</p></div>`. The box's label and icon are
 * drawn by each player from the kind, in the learner's language, so only the
 * kind is stored. A player that does not know a kind shows the text plainly.
 */
export const ARTICLE_CALLOUT_ATTR = 'data-ally-callout';

export enum ArticleCalloutKind {
  /** "Try saying": a line the counsellor could use. */
  SAY = 'say',
  /** "Good to know". */
  INFO = 'info',
  /** "Watch out". */
  WARN = 'warn',
}

/** Matches the placeholder an article question is anchored to in the HTML. */
export const ARTICLE_QUESTION_MARKER_ATTR = 'data-ally-question';

/**
 * Pull the question ids an article's HTML anchors, in reading order. Tolerant
 * of attribute order and quoting so it survives a round trip through TipTap
 * and DOMPurify.
 */
export function parseArticleQuestionMarkers(html: string): string[] {
  const pattern = new RegExp(
    `<div\\b[^>]*\\b${ARTICLE_QUESTION_MARKER_ATTR}\\s*=\\s*["']([^"']+)["'][^>]*>`,
    'gi',
  );
  const ids: string[] = [];
  let match = pattern.exec(html ?? '');
  while (match) {
    ids.push(match[1]);
    match = pattern.exec(html ?? '');
  }
  return ids;
}

/**
 * A quiz question pinned to a moment in a VIDEO item. The player hard-pauses
 * at `timestampSeconds` and requires an answer before resuming. Restricted to
 * S3-hosted video (see `validateInterjections`) since third-party embeds
 * (YouTube/Vimeo/Loom) give us no reliable playback-position control.
 */
export interface VideoInterjection {
  id: string;
  timestampSeconds: number;
  question: QuizQuestion;
}

export interface VideoContent {
  source: VideoSource;
  url: string;
  durationSeconds?: number;
  interjections?: VideoInterjection[];
}

export interface JournalPrompt {
  id: string;
  prompt: string;
  promptHtml?: string;
  required?: boolean;
  placeholder?: string;
}

export interface JournalContent {
  prompts: JournalPrompt[];
}

/**
 * Which gates a ROLEPLAY track item applies when an attempt ends.
 *  - SCORE: minScore only; any length of call counts.
 *  - DURATION: minDurationSeconds only (falling back to the platform default
 *    when unset); any score counts.
 *  - SCORE_AND_DURATION: both. The behaviour of every item created before
 *    this field existed.
 *  - PARTICIPATION: no gate; the item completes when the learner launches it.
 */
export enum TrackItemCompletionLogic {
  SCORE = 'SCORE',
  DURATION = 'DURATION',
  SCORE_AND_DURATION = 'SCORE_AND_DURATION',
  PARTICIPATION = 'PARTICIPATION',
}

/** Why a roleplay attempt did not complete its track item. */
export enum RoleplayAttemptFailureReason {
  INSUFFICIENT_SCORE = 'INSUFFICIENT_SCORE',
  INSUFFICIENT_DURATION = 'INSUFFICIENT_DURATION',
  /**
   * Assessment only: the learner took part but ended before the item's
   * minLearnerTurns. The attempt is not submitted and can be restarted.
   */
  INSUFFICIENT_TURNS = 'INSUFFICIENT_TURNS',
}

/**
 * What kind of roleplay a course item is, as a trainer picks it. Derived, never
 * stored: assessmentMode → ASSESSMENT; else PARTICIPATION → TRIAL; else
 * PRACTICE. See resolveRoleplayType (roleplay-gate.util.ts).
 */
export enum RoleplayType {
  TRIAL = 'TRIAL',
  PRACTICE = 'PRACTICE',
  ASSESSMENT = 'ASSESSMENT',
}

/** Where an assessment roleplay sits in a pre/post pair. */
export enum AssessmentPhase {
  PRE = 'PRE',
  POST = 'POST',
}

/** Bounds for an assessment's minLearnerTurns; absent reads as the minimum. */
export const ASSESSMENT_MIN_LEARNER_TURNS = 1;
export const ASSESSMENT_MAX_LEARNER_TURNS = 50;

/**
 * The most recent roleplay attempt on a track item, kept on the progress row
 * so the learner can be told why it did not count. Cleared once the item
 * completes.
 */
export interface LastRoleplayAttempt {
  /** At least one entry: only attempts that missed a gate are kept. */
  failureReasons: RoleplayAttemptFailureReason[];
  score: number | null;
  durationSeconds: number;
  /** The bar that applied to this attempt; null where that gate was off. */
  requiredScore: number | null;
  requiredDurationSeconds: number | null;
  /** Assessment only: learner turns taken, and the minimum that applied. */
  learnerTurns?: number;
  requiredTurns?: number | null;
  /** ISO timestamp. */
  endedAt: string;
}

/**
 * The attempt that counts for an assessment roleplay, frozen when it was
 * submitted: later edits to the item's rule never re-judge it.
 */
export interface AssessmentSubmission {
  scenarioSessionId: string | null;
  learnerTurns: number;
  requiredTurns: number;
  score: number | null;
  requiredScore: number | null;
  /** ISO timestamp. */
  submittedAt: string;
}

/**
 * The most recent case roleplay that missed its bar, kept on every track
 * progress row linked to that case session so the learner can be told why
 * the case is not finished. Cleared once the item completes.
 */
export interface LastCaseAttempt {
  failureReasons: RoleplayAttemptFailureReason[];
  score: number | null;
  durationSeconds: number;
  requiredScore: number | null;
  requiredDurationSeconds: number | null;
  /** ISO timestamp. */
  endedAt: string;
}

/**
 * Why the first locked item of a course is locked: what the item before it
 * (the blocker) still needs. Sequential progression means the blocker is
 * always the first non-completed item in track order.
 */
export enum TrackBlockerReason {
  /** Never attempted, in progress, or a type with no gate to report. */
  NOT_FINISHED = 'NOT_FINISHED',
  /** actual/required are points (roleplay, case) or percent (quiz, annotation, branching). */
  BELOW_SCORE = 'BELOW_SCORE',
  /** actual/required in seconds. */
  TOO_SHORT = 'TOO_SHORT',
  /** A scored gate applied but the attempt came back with no score. */
  NOT_SCORED = 'NOT_SCORED',
  /** One-attempt roleplay assessment submitted and not passed. */
  ASSESSMENT_FAILED = 'ASSESSMENT_FAILED',
  /** Quiz answers still waiting to be marked. */
  GRADING_PENDING = 'GRADING_PENDING',
  /** No attempts left; `retryAt` set when a new round opens (branching). */
  OUT_OF_ATTEMPTS = 'OUT_OF_ATTEMPTS',
  /** actual/required in percent watched. */
  WATCH_MORE = 'WATCH_MORE',
  /** Article not read for long enough yet. */
  KEEP_READING = 'KEEP_READING',
}

/** What the locked row offers: retry the blocker, open it, or nothing. */
export enum TrackBlockerAction {
  RETRY = 'RETRY',
  OPEN = 'OPEN',
  NONE = 'NONE',
}

export interface TrackBlockerReasonDetail {
  code: TrackBlockerReason;
  actual?: number | null;
  required?: number | null;
}

export interface TrackBlocker {
  itemId: string;
  title: string;
  type: TrackItemType;
  /** At least one entry; two when a roleplay missed both score and duration. */
  reasons: TrackBlockerReasonDetail[];
  action: TrackBlockerAction;
  /** ISO timestamp a new attempt round opens (OUT_OF_ATTEMPTS, branching). */
  retryAt?: string | null;
}

/**
 * Per-item completion rule. Only the keys relevant to the item's type are
 * read; the rest are ignored:
 *  - ROLEPLAY/CASE → minScore (+ minDurationSeconds for ROLEPLAY, falling back
 *    to config.simulationPath.simulationPathItemMinDurationForCompletion)
 *  - QUIZ / ANNOTATED_ARTIFACT → passScore (kept in sync with
 *    content.settings.passScore on save)
 *  - VIDEO → watchPct
 *  - ARTICLE → minReadSeconds (0 = mark-as-read only)
 *  - GAME → nothing; games never gate progression (see game.type.ts)
 *  - BUCKET_SORT → nothing; it completes once every item has been placed
 *  - BRANCHING_SCENARIO → passScore (kept in sync with
 *    content.settings.passScore on save); absent = completes on any ending
 *
 * `assessmentMode` (ROLEPLAY only) is not a completion rule but rides along
 * here because it is per-item and read in the same places: the learner gets
 * one valid attempt, and the start gate refuses a second session once it is
 * used. An attempt is valid once the learner takes `minLearnerTurns` turns
 * (absent = 1); a shorter one is discarded and can be restarted. The duration
 * gate never applies to an assessment. `showResultsToLearner` (absent = true)
 * hides the score and debrief from the learner after submission.
 * `assessmentPhase` + `assessmentPairKey` pair a PRE with a POST in the same
 * track; the POST can't start until the PRE is submitted.
 *
 * `completionLogic` (ROLEPLAY only) picks which of minScore and
 * minDurationSeconds gate the item — see TrackItemCompletionLogic. Absent
 * reads as SCORE_AND_DURATION, which is how every roleplay item behaved
 * before the field existed. Resolve it with `resolveRoleplayGate`
 * (roleplay-gate.util.ts), never by reading the keys directly.
 */
export interface TrackItemCompletionCriteria {
  completionLogic?: TrackItemCompletionLogic;
  minScore?: number;
  minDurationSeconds?: number;
  assessmentMode?: boolean;
  minLearnerTurns?: number;
  showResultsToLearner?: boolean;
  assessmentPhase?: AssessmentPhase;
  assessmentPairKey?: string;
  passScore?: number;
  watchPct?: number;
  minReadSeconds?: number;
}

export interface AnsweredArticleQuestion {
  selectedOptionId: string;
  correct: boolean;
  /** ISO timestamp. */
  answeredAt: string;
}

export interface TrackItemProgressMeta {
  maxWatchedPct?: number;
  articleFirstOpenedAt?: string;
  articleReadAt?: string;
  /** GAME: the learner's best score so far. Shown back to them, never graded. */
  bestGameScore?: number;
  /** GAME: how many runs they have finished, for the same reason. */
  gamePlayCount?: number;
  /** BRANCHING_SCENARIO: finished runs; also the attempts used against maxAttempts. */
  branchingRunCount?: number;
  /** BRANCHING_SCENARIO: runs in the current round; counts against maxAttempts. */
  branchingRoundRuns?: BranchingRun[];
  /** BRANCHING_SCENARIO: highest and most recent run score (0-100). */
  branchingBestScore?: number;
  branchingLastScore?: number;
  /** BRANCHING_SCENARIO: distinct ending node ids the learner has reached. */
  branchingEndingsReached?: string[];
  /** BRANCHING_SCENARIO: choice ids of the most recent finished run. */
  branchingLastPath?: string[];
  /**
   * BUCKET_SORT: the learner's first placement of each item, keyed by
   * BucketSortItem.id. Written once per item and never rewritten, so it stays
   * the record of what they believed before the feedback.
   */
  bucketSortAnswers?: Record<string, BucketSortAnswer>;
  /** BUCKET_SORT: best first-try score across rounds (0-100), for reporting. */
  bucketSortBestFirstTryPct?: number;
  /** BUCKET_SORT: how many rounds the learner has finished. */
  bucketSortRounds?: number;
  /** VIDEO: per-interjection result, keyed by VideoInterjection.id. */
  answeredInterjections?: Record<
    string,
    { passed: boolean; pointsAwarded?: number }
  >;
  /**
   * ARTICLE: per-inline-question result, keyed by ArticleQuestion.id. Written
   * once and never rewritten — an article question is answered exactly once,
   * which is also what makes this the record the completion rule counts.
   */
  answeredArticleQuestions?: Record<string, AnsweredArticleQuestion>;
  /** ROLEPLAY: the latest attempt that did not complete the item, and why. */
  lastRoleplayAttempt?: LastRoleplayAttempt;
  /** CASE: the latest case roleplay that missed its bar, and why. */
  lastCaseAttempt?: LastCaseAttempt;
  /**
   * ROLEPLAY in assessment mode: when the learner's one attempt ended. Set
   * whether or not it passed; drives the learner's "submitted" state.
   */
  assessmentSubmittedAt?: string;
  /**
   * ROLEPLAY in assessment mode: when a trainer last gave the attempt back.
   * Sessions started before this no longer count against the learner.
   */
  assessmentReopenedAt?: string;
  /**
   * ROLEPLAY in assessment mode: attempts the learner took part in but ended
   * below minLearnerTurns since the last reopen. Shown to trainers.
   */
  assessmentIncompleteStarts?: number;
  /** ROLEPLAY in assessment mode: the attempt that counts, frozen at submission. */
  assessmentSubmission?: AssessmentSubmission;
}
