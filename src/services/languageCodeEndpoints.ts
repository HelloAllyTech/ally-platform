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
]);
