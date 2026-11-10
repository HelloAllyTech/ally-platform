import { BuilderLessonCategory } from 'src/builder/enum/builder.enum';
import { ClChunkOrigin, ClCollectionId } from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/**
 * The lesson categories Builder has always written (`builder_lessons.category` before phase 5).
 * Kept as Builder's enum, so the outcome categoriser and the correction pass that write them and
 * this vocabulary can never disagree.
 */
export const BUILDER_LESSON_CATEGORIES: readonly string[] = Object.values(
  BuilderLessonCategory,
);

/** A lesson is one line an engineer would write down, not a document. */
export const BUILDER_LESSON_MAX_CHARS = 600;

/**
 * Lessons Builder's own builds learned — a trap that cost time, a house convention, how long
 * something really took, how the Builder itself should work — written by the build pipeline
 * (outcomes, corrections) and by people in the Library, and curated hourly by the agent curator.
 * Replaces the `builder_lessons` table and Builder's own lesson curator.
 */
export const BUILDER_LESSONS_PROFILE: CollectionProfile = {
  id: ClCollectionId.BUILDER_LESSONS,
  name: 'Builder Lessons',
  purpose:
    'Short, specific lessons Ally’s Builder agent learned from its own past builds and from ' +
    'review feedback: traps that cost time, house conventions, real effort, and how the Builder ' +
    'itself should work, each naming the repo, file, command or symptom. Its readers are the ' +
    'Builder interview and research passes and engineers’ coding agents. A lesson is relevant ' +
    'when it would change what the agent does in the change the query describes; one about the ' +
    'same repo that would not change that work is tangential.',
  noun: 'lesson',
  nounPlural: 'lessons',
  codePrefix: 'BL',
  allowedOrigins: [ClChunkOrigin.AGENT, ClChunkOrigin.AUTHORED],
  allowsOrgChunks: false,
  neverGrantTo: [],
  statementMaxChars: BUILDER_LESSON_MAX_CHARS,
  facets: {
    category: {
      label: 'Category',
      values: BUILDER_LESSON_CATEGORIES,
      valueLabels: {
        gotcha: 'Gotcha',
        convention: 'Convention',
        estimate: 'Estimate',
        process: 'Process',
      },
      multi: false,
    },
    repos: { label: 'Repos', multi: true },
    tags: { label: 'Tags', multi: true },
  },
  attributes: {
    // Provenance: the Builder sessions whose builds produced (or agreed with) this lesson.
    sessionIds: { label: 'Sessions', type: 'text[]', shown: false },
  },
  densityCap: { perSegment: 0, min: 0, max: 80 },
  agentCuration: {
    agents: ['builder'],
    // The numbers Builder's own curator used: the context a prompt can spend on lessons is
    // fixed, and curating one bullet at a time would spend a model call to decide nothing.
    activeCap: 80,
    candidateTrigger: 10,
    maxActiveChangesPerPass: 10,
    categoryFacet: 'category',
  },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) =>
    [firstFacet(c, 'category'), c.statement].filter(Boolean).join(': '),
  situationsText: (c: ProfileChunkView) =>
    [
      joinList(c.facets?.repos as string[] | undefined),
      joinList(c.facets?.tags as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const repos = Array.isArray(c.facets?.repos)
      ? (c.facets.repos as string[]).join('/')
      : '';
    const head = [c.code, firstFacet(c, 'category'), repos, band ?? '']
      .filter(Boolean)
      .join(' · ');
    return `[${head}] ${c.statement}${c.body ? `\n  ${c.body}` : ''}`;
  },
};
