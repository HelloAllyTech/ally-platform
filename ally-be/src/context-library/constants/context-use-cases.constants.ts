import {
  ClAudienceRule,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';

/**
 * Every caller of the retrieval service, with what it may read by default.
 *
 * Grants are data (`cl_use_case_access`, editable in Settings) so they can change without a
 * deploy; these defaults seed that table and are what a missing row falls back to. Locks —
 * collections a use case can never read — live on the collection profile
 * (`neverGrantTo`), in code, where Settings cannot reach them.
 */
export interface UseCaseSpec {
  id: ClUseCase;
  label: string;
  audience: ClAudienceRule;
  /**
   * The query is a person's own words (a learner, or an admin describing someone). Its text
   * is stored but withheld from every read surface, and it is never turned into a learned
   * example query on a chunk.
   */
  querySensitive: boolean;
  defaultCollections: readonly ClCollectionId[];
  defaultLimit: number;
  /** Excluded from usage stats and effectiveness, so tuning and testing don't skew them. */
  excludeFromUsage?: boolean;
}

const builder = (id: ClUseCase, label: string): UseCaseSpec => ({
  id,
  label,
  audience: ClAudienceRule.PLATFORM,
  querySensitive: false,
  defaultCollections: [
    ClCollectionId.FIRST_PRINCIPLES,
    ClCollectionId.BUILDER_LESSONS,
    // What similar shipped plans achieved, so a PRD sets its target knowing them.
    ClCollectionId.PRODUCT_OUTCOMES,
  ],
  defaultLimit: 8,
});

export const CONTEXT_USE_CASES: Record<ClUseCase, UseCaseSpec> = {
  [ClUseCase.BUILDER_INTERVIEW]: builder(
    ClUseCase.BUILDER_INTERVIEW,
    'Builder interview',
  ),
  [ClUseCase.BUILDER_RESEARCH]: builder(
    ClUseCase.BUILDER_RESEARCH,
    'Builder research',
  ),
  [ClUseCase.BUILDER_PRD_REVIEW]: builder(
    ClUseCase.BUILDER_PRD_REVIEW,
    'Builder PRD check',
  ),
  [ClUseCase.BUILDER_BRIEF]: builder(
    ClUseCase.BUILDER_BRIEF,
    'Builder guidance brief',
  ),
  [ClUseCase.BUILDER_BUILD]: {
    id: ClUseCase.BUILDER_BUILD,
    label: 'Builder builds',
    audience: ClAudienceRule.PLATFORM,
    querySensitive: false,
    defaultCollections: [ClCollectionId.BUILDER_LESSONS],
    defaultLimit: 12,
  },
  [ClUseCase.BUG_HUNTER]: {
    id: ClUseCase.BUG_HUNTER,
    label: 'Bug Hunter',
    audience: ClAudienceRule.PLATFORM,
    querySensitive: false,
    defaultCollections: [ClCollectionId.BUG_HUNTER_NOTES],
    defaultLimit: 8,
  },
  [ClUseCase.ROADMAP_COPILOT]: {
    id: ClUseCase.ROADMAP_COPILOT,
    label: 'Roadmap Copilot',
    audience: ClAudienceRule.PLATFORM,
    querySensitive: false,
    defaultCollections: [
      ClCollectionId.FIRST_PRINCIPLES,
      ClCollectionId.PRODUCT_OUTCOMES,
    ],
    defaultLimit: 8,
  },
  [ClUseCase.COURSE_COPILOT]: {
    id: ClUseCase.COURSE_COPILOT,
    label: 'Course Copilot',
    audience: ClAudienceRule.ORGANISATION,
    querySensitive: false,
    defaultCollections: [
      ClCollectionId.LEARNING_DESIGN,
      ClCollectionId.CONTENT_CATALOGUE,
    ],
    defaultLimit: 8,
  },
  [ClUseCase.CHARACTER_INTERVIEW]: {
    id: ClUseCase.CHARACTER_INTERVIEW,
    label: 'Character interview',
    audience: ClAudienceRule.PLATFORM,
    querySensitive: true,
    defaultCollections: [ClCollectionId.CHARACTER_INSIGHTS],
    defaultLimit: 6,
  },
  [ClUseCase.ALLY_GUIDE]: {
    id: ClUseCase.ALLY_GUIDE,
    label: 'Ally guide',
    audience: ClAudienceRule.ORGANISATION,
    querySensitive: true,
    defaultCollections: [ClCollectionId.ALLY_GUIDE_LIBRARY],
    defaultLimit: 6,
  },
  [ClUseCase.DEBRIEF]: {
    id: ClUseCase.DEBRIEF,
    label: 'Debrief',
    audience: ClAudienceRule.ORGANISATION,
    querySensitive: true,
    defaultCollections: [ClCollectionId.DEBRIEF_GUIDANCE],
    defaultLimit: 4,
  },
  [ClUseCase.MCP_DEV]: {
    id: ClUseCase.MCP_DEV,
    label: "Engineers' Claude Code",
    audience: ClAudienceRule.PLATFORM,
    querySensitive: false,
    defaultCollections: [
      ClCollectionId.FIRST_PRINCIPLES,
      ClCollectionId.LEARNING_DESIGN,
      ClCollectionId.BUILDER_LESSONS,
      ClCollectionId.BUG_HUNTER_NOTES,
      ClCollectionId.PRODUCT_OUTCOMES,
    ],
    defaultLimit: 8,
  },
  [ClUseCase.ADMIN_PREVIEW]: {
    id: ClUseCase.ADMIN_PREVIEW,
    label: 'Library search',
    audience: ClAudienceRule.PLATFORM,
    querySensitive: false,
    defaultCollections: Object.values(ClCollectionId),
    defaultLimit: 20,
    excludeFromUsage: true,
  },
  [ClUseCase.EVAL]: {
    id: ClUseCase.EVAL,
    label: 'Evaluation',
    audience: ClAudienceRule.PLATFORM,
    querySensitive: false,
    defaultCollections: Object.values(ClCollectionId),
    defaultLimit: 50,
    excludeFromUsage: true,
  },
};
