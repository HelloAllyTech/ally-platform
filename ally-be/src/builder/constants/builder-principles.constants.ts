import { ContextToolNames } from 'src/context-library/service/context-tools.service';
import {
  FIRST_PRINCIPLES_DOMAINS,
  PRD_SECTIONS,
} from 'src/context-library/profiles/first-principles.profile';

/**
 * The Builder interview's view of the Context Library: First Principles (and, once they move
 * in, Builder Lessons), under tool names and wording that fit a PRD interview. Replaces the
 * Stacks tools; the shared pipeline lives in `src/context-library/`.
 */
export const BUILDER_PRINCIPLE_TOOLS: ContextToolNames = {
  search: 'principles_search',
  get: 'principles_get',
  libraryLabel: "the team's product, UX and engineering principles",
  noun: 'principle',
  nounPlural: 'principles',
  when:
    'Search whenever the interview reaches a product judgement — an empty, loading, edge or ' +
    'failure state; a user-facing label; a threshold, limit, cadence or reward rule; what a view ' +
    'shows and omits; how something should be built — and before asking the admin anything a ' +
    'principle could settle.',
  facets: [
    {
      name: 'domain',
      facet: 'domain',
      description: 'Optional: boost one domain',
      values: FIRST_PRINCIPLES_DOMAINS,
    },
    {
      name: 'prdSection',
      facet: 'prdSections',
      description: 'Optional: boost one PRD section',
      values: PRD_SECTIONS,
    },
  ],
};

/** Cards in the interview's context at once (brief + section focus + lookups). */
export const BUILDER_PRINCIPLES_BUDGET = 25;
/** Cards in the session-start guiding brief. */
export const BUILDER_PRINCIPLES_BRIEF_CARDS = 15;
/** The areas the guiding brief plans searches across. */
export const BUILDER_BRIEF_AREAS = [
  { key: 'problem', label: 'Problem and users' },
  { key: 'scope', label: 'Scope and MVP' },
  { key: 'ux_states', label: 'Screens and states' },
  { key: 'goals_metrics', label: 'Goals and metrics' },
  { key: 'architecture', label: 'Architecture and data' },
  { key: 'security_privacy', label: 'Security and privacy' },
  { key: 'rollout', label: 'Rollout and risks' },
  { key: 'testing', label: 'Testing' },
];
