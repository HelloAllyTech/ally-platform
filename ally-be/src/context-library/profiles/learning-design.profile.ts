import {
  ClChunkOrigin,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';
import {
  PRINCIPLE_KINDS,
  PRINCIPLE_STRENGTHS,
} from './first-principles.profile';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/**
 * What a learning-design principle is about (PLAN.md §5). The decisions Course Copilot makes while
 * it interviews a trainer and plans a course: what the learners should be able to do, in what
 * order, how they practise it, how it is assessed, what feedback they get, how hard each step is,
 * what keeps them going, who can take part, and how a trainer runs it.
 */
export const LEARNING_DESIGN_DOMAINS = [
  'outcomes',
  'sequencing',
  'practice',
  'assessment',
  'feedback',
  'difficulty',
  'motivation',
  'accessibility',
  'facilitation',
] as const;

/**
 * Where in building a course a principle bears — Course Copilot's own stages: the brief (learners
 * and outcomes), the blueprint (structure, sequence, item types), the content of each item, the
 * review before publishing, and the course once learners are in it.
 */
export const COURSE_STAGES = [
  'brief',
  'blueprint',
  'content',
  'review',
  'delivery',
] as const;

/** The course item types a principle can be about, as Course Copilot's blueprint names them. */
export const COURSE_ITEM_TYPES = [
  'roleplay',
  'case',
  'quiz',
  'article',
  'video',
  'journal',
  'annotated_artifact',
  'game',
] as const;

/**
 * Learning-design principles for building courses that train mental-health helpers — counsellors,
 * peer supporters, helpline volunteers — distilled from documents or written by admins. Course
 * Copilot reads them through `design_guidance_search` / `design_guidance_get`; engineers' editors
 * read them too. The same shape as First Principles: a statement, why it holds, the question it
 * raises and what breaking it looks like, with course-shaped facets in place of PRD ones.
 */
export const LEARNING_DESIGN_PROFILE: CollectionProfile = {
  id: ClCollectionId.LEARNING_DESIGN,
  name: 'Learning Design',
  purpose:
    'Short, decontextualised principles of learning design — outcomes, sequencing, practice, ' +
    'assessment, feedback, difficulty, motivation, accessibility and facilitation — for courses ' +
    'that train mental-health helpers such as counsellors, peer supporters and helpline ' +
    'volunteers. Its readers are Course Copilot as it interviews a trainer and plans a course, ' +
    'and engineers’ coding agents building learning features. A principle is relevant when it ' +
    'would change a decision about the course in the situation the query describes; one on the ' +
    'same subject that would not change that decision is tangential.',
  noun: 'principle',
  nounPlural: 'principles',
  codePrefix: 'LD',
  allowedOrigins: [ClChunkOrigin.DISTILLED, ClChunkOrigin.AUTHORED],
  allowsOrgChunks: false,
  // Granted only to Course Copilot and engineers (PLAN.md §2.2). The defaults do that; these
  // locks keep every other agent out whatever Settings says.
  neverGrantTo: [
    ClUseCase.BUILDER_INTERVIEW,
    ClUseCase.BUILDER_RESEARCH,
    ClUseCase.BUILDER_PRD_REVIEW,
    ClUseCase.BUILDER_BRIEF,
    ClUseCase.BUILDER_BUILD,
    ClUseCase.BUG_HUNTER,
    ClUseCase.ROADMAP_COPILOT,
    ClUseCase.CHARACTER_INTERVIEW,
    ClUseCase.ALLY_GUIDE,
    ClUseCase.DEBRIEF,
  ],
  statementMaxChars: 160,
  facets: {
    domain: {
      label: 'Domain',
      values: LEARNING_DESIGN_DOMAINS,
      valueLabels: {
        outcomes: 'Outcomes',
        sequencing: 'Sequencing',
        practice: 'Practice',
        assessment: 'Assessment',
        feedback: 'Feedback',
        difficulty: 'Difficulty',
        motivation: 'Motivation',
        accessibility: 'Accessibility',
        facilitation: 'Facilitation',
      },
      multi: false,
      required: true,
    },
    courseStage: {
      label: 'Course stage',
      values: COURSE_STAGES,
      valueLabels: {
        brief: 'Brief',
        blueprint: 'Blueprint',
        content: 'Content',
        review: 'Review',
        delivery: 'Delivery',
      },
      multi: false,
    },
    itemTypes: {
      label: 'Item types',
      values: COURSE_ITEM_TYPES,
      valueLabels: {
        roleplay: 'Roleplay',
        case: 'Case',
        quiz: 'Quiz',
        article: 'Article',
        video: 'Video',
        journal: 'Journal',
        annotated_artifact: 'Annotated example',
        game: 'Game',
      },
      multi: true,
    },
  },
  attributes: {
    rationale: {
      label: 'Why',
      type: 'text',
      maxChars: 300,
      required: true,
      shown: true,
    },
    probe: {
      label: 'Question it raises',
      type: 'text',
      maxChars: 200,
      shown: true,
    },
    antiPattern: {
      label: 'Warning sign',
      type: 'text',
      maxChars: 200,
      shown: true,
    },
    kind: {
      label: 'Kind',
      type: 'enum',
      values: PRINCIPLE_KINDS,
      required: true,
      shown: true,
    },
    strength: {
      label: 'Strength',
      type: 'enum',
      values: PRINCIPLE_STRENGTHS,
      required: true,
      shown: true,
    },
  },
  extraction: {
    promptCode: 'context_library_extract_learning_design_system',
    maxCandidatesPerSegment: 8,
    criticChecks: [],
  },
  densityCap: { perSegment: 0.5, min: 3, max: 80 },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) =>
    `${firstFacet(c, 'domain')}: ${c.statement} ${String(c.attributes.rationale ?? '')}`.trim(),
  situationsText: (c: ProfileChunkView) =>
    [
      firstFacet(c, 'domain'),
      joinList(c.facets?.itemTypes as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
      String(c.attributes.probe ?? ''),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const head = [
      c.code,
      String(c.attributes.strength ?? ''),
      firstFacet(c, 'domain'),
      band ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    const when = c.situations.length
      ? `\n  When: ${c.situations.join('; ')}`
      : '';
    return `[${head}] ${c.statement}${when}`;
  },
};
