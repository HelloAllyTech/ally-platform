import { ClChunkOrigin, ClCollectionId } from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

export const FIRST_PRINCIPLES_DOMAINS = [
  'product_strategy',
  'discovery',
  'ux_ui',
  'interaction',
  'content_copy',
  'data_viz',
  'accessibility',
  'architecture',
  'backend',
  'data',
  'ai_llm',
  'security_privacy',
  'reliability',
  'performance',
  'testing',
  'delivery',
  'metrics_analytics',
  'growth',
] as const;

export const PRD_SECTIONS = [
  'problem',
  'users',
  'goals_metrics',
  'scope',
  'ux_states',
  'requirements',
  'architecture',
  'data_model',
  'api',
  'rollout',
  'risks',
  'testing',
] as const;

export const LIFECYCLE_STAGES = [
  'discovery',
  'definition',
  'design',
  'build',
  'launch',
  'iterate',
] as const;

export const PRINCIPLE_KINDS = [
  'rule',
  'heuristic',
  'anti_pattern',
  'trade_off',
  'checklist_item',
] as const;

export const PRINCIPLE_STRENGTHS = ['must', 'should', 'consider'] as const;

/**
 * Product, UX and engineering principles for the Builder PRD interview, Roadmap Copilot and
 * engineers' editors. The first collection, and the shape Learning Design copies.
 */
export const FIRST_PRINCIPLES_PROFILE: CollectionProfile = {
  id: ClCollectionId.FIRST_PRINCIPLES,
  name: 'First Principles',
  purpose:
    'Short, decontextualised product and engineering principles distilled from documentation. ' +
    'Its readers are agents planning software — the Builder interview turning an idea into a PRD ' +
    'and technical plan, and engineers’ coding agents. A principle is relevant when it would ' +
    'change a decision in the situation the query describes; one on the same subject that would ' +
    'not change that decision is tangential.',
  noun: 'principle',
  nounPlural: 'principles',
  codePrefix: 'FP',
  allowedOrigins: [ClChunkOrigin.DISTILLED, ClChunkOrigin.AUTHORED],
  allowsOrgChunks: false,
  neverGrantTo: [],
  statementMaxChars: 160,
  facets: {
    domain: {
      label: 'Domain',
      values: FIRST_PRINCIPLES_DOMAINS,
      multi: false,
      required: true,
    },
    prdSections: { label: 'PRD sections', values: PRD_SECTIONS, multi: true },
    lifecycleStage: { label: 'Stage', values: LIFECYCLE_STAGES, multi: false },
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
    promptCode: 'context_library_extract_first_principles_system',
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
