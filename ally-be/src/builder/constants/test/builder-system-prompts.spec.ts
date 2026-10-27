import {
  BUILDER_PRD_REVIEW_SYSTEM,
  BUILDER_PRD_RECHECK_SYSTEM,
  BUILDER_DISCOVERY_PLAN_SYSTEM,
  BUILDER_EVAL_ADMIN_SYSTEM,
  BUILDER_EVAL_JUDGE_SYSTEM,
  BUILDER_CORRECTION_SYSTEM,
  BUILDER_EPIC_SYSTEM,
  BUILDER_RESEARCH_SYSTEM,
  BUILDER_OUTCOME_SYSTEM,
  BUILDER_LESSON_CURATOR_SYSTEM,
  BUILDER_EXEMPLAR_RANK_SYSTEM,
  BUILDER_EXEMPLAR_SUMMARY_SYSTEM,
  BUILDER_INTERVIEW_SUMMARY_SYSTEM,
  PromptDefinition,
} from 'src/prompt/contracts';
import { expectWorkingBase } from 'src/prompt/contracts/test/shipped-prompt-base';
import { BUILDER_CORRECTION_CATEGORIES } from '../../entity/builder-correction.entity';
import {
  BuilderFailureTag,
  BuilderLessonCategory,
} from '../../enum/builder.enum';
import { BUILDER_PRD_REVIEW_CATEGORIES } from '../../type/builder-prd.type';
import { BUILDER_DISCOVERY_TOOLS } from '../../util/builder-discovery.util';

const json = (...keys: string[]) => keys.map((key) => `"${key}"`);
const lessonCategories = Object.values(BuilderLessonCategory).join('|');

/**
 * Builder's one-shot system prompts live in the Skills Store; their defaults
 * in src/prompts/builder are minimal bases. Each must still carry what its
 * parser reads — the JSON keys, the enum values it accepts, the operation
 * grammar, the tool names — so a fresh clone runs end to end.
 */
const cases: [PromptDefinition, string[]][] = [
  [
    BUILDER_PRD_REVIEW_SYSTEM,
    [
      ...json('findings', 'category', 'section', 'detail', 'fix', 'quote'),
      ...BUILDER_PRD_REVIEW_CATEGORIES,
    ],
  ],
  [BUILDER_PRD_RECHECK_SYSTEM, json('checks', 'id', 'resolved', 'note')],
  [
    BUILDER_DISCOVERY_PLAN_SYSTEM,
    [
      ...json('queries', 'tool', 'query', 'repo'),
      ...BUILDER_DISCOVERY_TOOLS.map((tool) => `"${tool}"`),
    ],
  ],
  [
    BUILDER_EVAL_ADMIN_SYSTEM,
    [
      ...json('message', 'optionIds', 'lines', 'verdict', 'correction'),
      ...json('about', 'done', 'confirm', 'correct'),
    ],
  ],
  [BUILDER_EVAL_JUDGE_SYSTEM, [...json('items', 'id', 'met', 'evidence')]],
  [
    BUILDER_CORRECTION_SYSTEM,
    [
      '{"isCorrection":false}',
      ...json('isCorrection', 'category', 'subject', 'detail', 'lesson'),
      ...json('capability', 'name', 'whatItIs', 'reuseWhen'),
      ...json('doc', 'path', 'fix', 'checklistItem', 'text', 'kind'),
      'must_not',
      ...BUILDER_CORRECTION_CATEGORIES,
    ],
  ],
  [
    BUILDER_EPIC_SYSTEM,
    json('title', 'summary', 'requirementIds', 'technicalNotes'),
  ],
  [
    BUILDER_RESEARCH_SYSTEM,
    [
      'github_repo_tree',
      'github_search_code',
      'github_read_file',
      'stacks_search',
      'update_prd',
      'assumptions',
    ],
  ],
  [
    BUILDER_OUTCOME_SYSTEM,
    [
      ...json('tags', 'lessons', 'category', 'lesson', 'contradictedLessonIds'),
      lessonCategories,
      ...Object.values(BuilderFailureTag),
    ],
  ],
  [
    BUILDER_LESSON_CURATOR_SYSTEM,
    [
      ...['AGREE', 'EDIT', 'ADD', 'REMOVE'].map((op) => `{"op":"${op}"`),
      ...json('id', 'candidateId', 'lesson', 'category', 'tags'),
      lessonCategories,
    ],
  ],
  [BUILDER_EXEMPLAR_RANK_SYSTEM, ['JSON array of ids']],
  [BUILDER_EXEMPLAR_SUMMARY_SYSTEM, ['120-150 word']],
  [BUILDER_INTERVIEW_SUMMARY_SYSTEM, ['[receipt]']],
];

describe('Builder system prompt defaults', () => {
  it.each(
    cases.map(([definition, markers]) => [
      definition.code,
      definition,
      markers,
    ]),
  )('%s is a working base', async (_code, definition, markers) => {
    await expectWorkingBase(
      definition as PromptDefinition,
      markers as string[],
    );
  });
});
