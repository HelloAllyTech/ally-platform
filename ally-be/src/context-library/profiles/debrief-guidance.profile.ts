import { WorkerType } from 'src/user/enum/user.enum';
import {
  ClChunkOrigin,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';
import { bodyOpening, citationLine } from './ally-guide-library.profile';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/**
 * The four kinds of material the Debrief agent's guidance held in the Knowledge Base: practice
 * guidelines, the debrief style guide, level guides for lay and professional helpers, and
 * organisations' own protocols.
 */
export const DEBRIEF_GUIDELINE_KINDS = [
  'practice_guideline',
  'style_guide',
  'level_guide',
  'protocol',
] as const;

/**
 * Who a guideline is written for: the learner levels a debrief is pitched at
 * (`users.metadata.workerType`), lower-cased. Absent means every level.
 */
export const DEBRIEF_GUIDELINE_LEVELS: readonly string[] = Object.values(
  WorkerType,
).map((level) => level.toLowerCase());

/**
 * What the Debrief agent reads beside a pivotal moment of a learner's practice roleplay, and Ask
 * Ally beside a finished debrief (PLAN.md §9.7). Replaces the Knowledge Base's
 * `debrief_knowledge` corpus, whose passages were imported here word for word with the
 * organisations each was targeted at.
 *
 * Curated centrally and targeted at organisations by hand (`tenantIds`), as before; organisations
 * do not write here. The clinical advisor's sign-off went with the corpus: `clinical` is
 * information only.
 */
export const DEBRIEF_GUIDANCE_PROFILE: CollectionProfile = {
  id: ClCollectionId.DEBRIEF_GUIDANCE,
  name: 'Debrief Guidance',
  purpose:
    'Practice guidelines, the debrief style guide, level guides for lay and professional helpers, ' +
    'and organisations’ own protocols. Its reader is the Debrief agent writing a trainee ' +
    'counsellor’s feedback after a practice roleplay; the query describes one pivotal moment in ' +
    'that session or the skills the debrief is about. A guideline is relevant when it says what ' +
    'good practice is at THAT kind of moment; general material on the same topic is tangential.',
  noun: 'guideline',
  nounPlural: 'guidelines',
  codePrefix: 'DG',
  allowedOrigins: [
    ClChunkOrigin.AUTHORED,
    ClChunkOrigin.IMPORTED,
    ClChunkOrigin.DISTILLED,
  ],
  // Targeted at organisations by platform admins; never written by an organisation's own admins.
  allowsOrgChunks: false,
  neverGrantTo: [ClUseCase.MCP_DEV],
  statementMaxChars: 200,
  facets: {
    kind: {
      label: 'Kind',
      values: DEBRIEF_GUIDELINE_KINDS,
      valueLabels: {
        practice_guideline: 'Practice guideline',
        style_guide: 'Style guide',
        level_guide: 'Level guide',
        protocol: 'Protocol',
      },
      multi: false,
    },
    level: {
      label: 'Level',
      values: DEBRIEF_GUIDELINE_LEVELS,
      valueLabels: {
        lay: 'Lay helpers',
        early_professional: 'Early professionals',
        experienced_professional: 'Experienced professionals',
      },
      multi: true,
    },
    skills: { label: 'Skills', multi: true },
  },
  attributes: {
    detail: {
      label: 'What good practice looks like',
      type: 'text',
      maxChars: 600,
      shown: true,
    },
    // Information only, now that sign-off is dropped (PLAN.md §1, decision 8; §13).
    clinical: { label: 'Clinical', type: 'bool', shown: true },
  },
  extraction: {
    promptCode: 'context_library_extract_debrief_guidance_system',
    maxCandidatesPerSegment: 8,
    criticChecks: ['identifiability', 'clinical_plausibility'],
  },
  densityCap: { perSegment: 1, min: 3, max: 120 },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) =>
    [
      firstFacet(c, 'kind'),
      c.statement,
      String(c.attributes.detail ?? '') || bodyOpening(c.body, 40),
    ]
      .filter(Boolean)
      .join(': ')
      .trim(),
  situationsText: (c: ProfileChunkView) =>
    [
      joinList(c.facets?.skills as string[] | undefined),
      joinList(c.facets?.level as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
      bodyOpening(c.body),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const head = [
      c.code,
      firstFacet(c, 'kind'),
      c.attributes.clinical === true ? 'clinical' : '',
      band ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    const lines = [`[${head}] ${c.statement}`];
    const from = citationLine(c);
    if (from) lines.push(`  From: ${from}`);
    const text = (c.body ?? '').trim() || String(c.attributes.detail ?? '');
    if (text) lines.push(`  ${text}`);
    return lines.join('\n');
  },
};
