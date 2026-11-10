import { ContextToolNames } from 'src/context-library/service/context-tools.service';
import {
  COURSE_ITEM_TYPES,
  COURSE_STAGES,
  LEARNING_DESIGN_DOMAINS,
} from 'src/context-library/profiles/learning-design.profile';

/**
 * Course Copilot's view of the Context Library's Learning Design collection: the
 * `design_guidance_search` / `design_guidance_get` pair, on the same pipeline, card format,
 * honesty about failures and usage logging as Builder's and Roadmap Copilot's `principles_*`
 * (PLAN.md §9.5). Replaces the third-party Stacks lookups these two tools made before.
 */
export const COURSE_COPILOT_GUIDANCE_TOOLS: ContextToolNames = {
  search: 'design_guidance_search',
  get: 'design_guidance_get',
  libraryLabel: "the team's learning-design principles",
  noun: 'principle',
  nounPlural: 'principles',
  when:
    'Search before deciding outcomes, sequencing, how learners practise, the assessment, ' +
    'feedback or the difficulty progression, and before asking the trainer anything a ' +
    'principle could settle.',
  facets: [
    {
      name: 'domain',
      facet: 'domain',
      description: 'Optional: boost one domain',
      values: LEARNING_DESIGN_DOMAINS,
    },
    {
      name: 'courseStage',
      facet: 'courseStage',
      description: 'Optional: boost one stage of building the course',
      values: COURSE_STAGES,
    },
    {
      name: 'itemType',
      facet: 'itemTypes',
      description: 'Optional: boost one course item type',
      values: COURSE_ITEM_TYPES,
    },
  ],
};
