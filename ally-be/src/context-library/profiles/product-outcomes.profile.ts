import { ClChunkOrigin, ClCollectionId } from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/** The verdicts an outcome review can reach (plan_outcome_reviews.verdict, minus "measurement_broken"). */
export const PRODUCT_OUTCOME_VERDICTS: readonly string[] = [
  'hit',
  'partial',
  'miss',
  'too_early',
];

/**
 * What Ally's shipped product changes actually did, one outcome review per chunk: the metric,
 * the result against its target and baseline, and the lesson for the next plan in that area.
 * Written by the roadmap's outcome reviewer (`agent: 'planning'`) after each review date
 * (plans/roadmap-owns-planning rev 5.2 decision 11); people can add or correct entries in the
 * Library. Read by the PRD interview and research passes, the roadmap copilot and engineers,
 * so a new plan sees what similar plans achieved before it sets its own target.
 */
export const PRODUCT_OUTCOMES_PROFILE: CollectionProfile = {
  id: ClCollectionId.PRODUCT_OUTCOMES,
  name: 'Product Outcomes',
  purpose:
    'What shipped product changes on Ally actually achieved: the metric each moved or failed to ' +
    'move, against its baseline and target, and what the next plan in that area should know. ' +
    'Its readers are the PRD interview, the roadmap copilot and engineers. An outcome is ' +
    'relevant when it concerns the same users, area or metric as the plan the query describes; ' +
    'one about a different area that would not change that plan’s target is tangential.',
  noun: 'outcome',
  nounPlural: 'outcomes',
  codePrefix: 'PO',
  allowedOrigins: [ClChunkOrigin.AGENT, ClChunkOrigin.AUTHORED],
  allowsOrgChunks: false,
  neverGrantTo: [],
  statementMaxChars: 600,
  facets: {
    verdict: {
      label: 'Verdict',
      values: PRODUCT_OUTCOME_VERDICTS,
      valueLabels: {
        hit: 'Hit',
        partial: 'Partial',
        miss: 'Miss',
        too_early: 'Too early to tell',
      },
      multi: false,
    },
    repos: { label: 'Repos', multi: true },
    tags: { label: 'Tags', multi: true },
  },
  attributes: {
    sessionIds: { label: 'Plans', type: 'text[]', shown: false },
  },
  densityCap: { perSegment: 0, min: 0, max: 400 },
  agentCuration: {
    agents: ['planning'],
    activeCap: 400,
    candidateTrigger: 10,
    maxActiveChangesPerPass: 10,
    categoryFacet: 'verdict',
  },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) =>
    [firstFacet(c, 'verdict'), c.statement].filter(Boolean).join(': '),
  situationsText: (c: ProfileChunkView) =>
    [
      joinList(c.facets?.tags as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const head = [c.code, firstFacet(c, 'verdict'), band ?? '']
      .filter(Boolean)
      .join(' · ');
    return `[${head}] ${c.statement}${c.body ? `\n  ${c.body}` : ''}`;
  },
};
