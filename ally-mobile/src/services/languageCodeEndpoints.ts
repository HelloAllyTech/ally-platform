/**
 * Endpoints whose responses contain backend-generated, user-facing text
 * (scenarios, cases, pathways, reviews, summaries, checklists, skills, badges,
 * leaderboard). For these, `baseQuery` in `api.ts` injects the active UI
 * `languageCode` into the request params (GET) or body (mutation) so the server
 * returns localized content.
 *
 * Keep this list tight: only add endpoints that return translatable text.
 * Auth, OTP, telemetry, file-upload and similar requests must NOT be here.
 *
 * Note: `startScenarioSession` is intentionally excluded — it has its own
 * `languageId` flow (see `useSimulationTransition.ts`).
 */
export const LANGUAGE_CODE_ENDPOINTS = new Set<string>([
  'getScenarios',
  'getScenarioById',
  'getSimulationPaths',
  'getSimulationPathDetails',
  'getCases',
  'getCaseDetails',
  'getSimulationDetails',
  'getEventChecklist',
  'getSimulationSkills',
  'getReview',
  'getReviewById',
  'getReviews',
  'getAvailableBadges',
  'getLeaderboard',
  'endScenarioSession',
  // Courses. The app language only *seeds* a course's language and picks the
  // reading language for a course the learner has not enrolled in yet — once
  // they enroll, their saved per-course choice on the enrollment wins, and it
  // is the only language their answers are marked in. Deliberately excludes
  // the grading endpoints (`submitQuizAttempt`, `submitAnnotationAttempt`,
  // `submitJournal`): marking must never follow a language named by the
  // request, or a client could be marked in a language it did not render.
  'getLearnTracks',
  'getLearnTrackDetail',
  'enrollTrack',
]);
