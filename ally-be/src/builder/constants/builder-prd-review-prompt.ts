/**
 * What the cold PRD reviewer's answer is checked against.
 *
 * The reviewer's instructions are the `builder_prd_review_system` and
 * `builder_prd_recheck_system` prompts in the Skills Store (defaults in
 * src/prompts/builder/). These two constants are rendered into the review
 * prompt as `{{sectionKeys}}` and `{{maxFindings}}`, so what it asks for and
 * what `parseReviewFindings` accepts cannot drift apart.
 *
 * Its five categories are the plan's, and each comes from session 2bc3a5cf,
 * whose PRD v8 read ready while it contradicted itself, described a module
 * whose files had returned 404, missed the admin's last correction, specified
 * a new challenger job beside an existing one, and named no success metric.
 *
 * The section keys are the PRD's JSON keys, so a finding can be pointed at the
 * field that has to change.
 */

export const BUILDER_PRD_REVIEW_MAX_FINDINGS = 8;

export const BUILDER_PRD_REVIEW_SECTION_KEYS = [
  'summary',
  'problem',
  'usersAndContext',
  'existingBehaviour',
  'whereChangesBelong',
  'goals',
  'nonGoals',
  'requirements',
  'assumptions',
  'technicalPlan',
  'testPlanMd',
  'e2ePlanMd',
  'openQuestions',
] as const;
