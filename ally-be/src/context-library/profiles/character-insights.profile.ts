import {
  ClChunkOrigin,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/**
 * What part of a person an insight helps draft — the five subjects the character interview
 * works through, in interview order.
 *
 * Named for the SUBJECT, not for the interviewer prompt's phase numbering: the prompt's wording
 * and order change without a migration, while these are what a person is made of. They were
 * the Knowledge Base's character topics, and moved here with the corpus they described.
 */
export const CHARACTER_INSIGHT_ASPECTS = [
  'identity',
  'life_context',
  'inner_life',
  'history_and_presenting_concern',
  'speech_and_language',
] as const;
export type CharacterInsightAspect = (typeof CHARACTER_INSIGHT_ASPECTS)[number];

/** What an admin sees for each aspect, written for the person, not the schema. */
export const CHARACTER_INSIGHT_ASPECT_LABELS: Readonly<
  Record<CharacterInsightAspect, string>
> = {
  identity: 'Who they are',
  life_context: 'Their life',
  inner_life: 'Inner life',
  history_and_presenting_concern: 'History & concern',
  speech_and_language: 'How they speak',
};

/**
 * Where an insight's knowledge comes from. Lived experience (how it is to live it) and clinical
 * presentation (how a condition shows from the outside) ground different questions; character
 * craft is about writing a believable person at all.
 */
export const CHARACTER_INSIGHT_BASES = [
  'lived_experience',
  'clinical_presentation',
  'character_craft',
] as const;

/**
 * `sensitive` for insights about self-harm, suicide, abuse, trauma or similar. The extraction
 * gate is strict for these: any failed check or any doubt rejects rather than publishing at low
 * confidence (see ContextExtractionService.decide).
 */
export const CHARACTER_INSIGHT_SENSITIVITIES = [
  'standard',
  'sensitive',
] as const;

/**
 * Short, general insights into how people in particular situations live, feel and talk, for the
 * character interview that drafts simulated clients for counsellor training. Replaces the
 * Knowledge Base's character corpus: where that served whole passages of documents, this serves
 * distilled insights — decontextualised, never about an identifiable person, never clinical
 * treatment guidance (that does not belong in a character).
 */
export const CHARACTER_INSIGHTS_PROFILE: CollectionProfile = {
  id: ClCollectionId.CHARACTER_INSIGHTS,
  name: 'Character Insights',
  purpose:
    'Short, decontextualised insights into how people in particular situations live, feel and ' +
    'talk, distilled from clinical and lived-experience material. Its reader is the character ' +
    'interview agent, which helps an admin draft a realistic, non-stereotyped simulated client ' +
    'for counsellor training. An insight is relevant when it would make a question or a detail ' +
    'of the draft more specific and true to life for the person the query describes; one about ' +
    'the same condition that would not change the draft is tangential.',
  noun: 'insight',
  nounPlural: 'insights',
  codePrefix: 'CI',
  allowedOrigins: [ClChunkOrigin.DISTILLED, ClChunkOrigin.AUTHORED],
  allowsOrgChunks: false,
  // Material describing people stays out of engineers' editors.
  neverGrantTo: [ClUseCase.MCP_DEV],
  statementMaxChars: 200,
  facets: {
    aspect: {
      label: 'Aspect',
      values: CHARACTER_INSIGHT_ASPECTS,
      valueLabels: CHARACTER_INSIGHT_ASPECT_LABELS,
      multi: false,
      required: true,
    },
    themes: { label: 'Themes', multi: true },
    basis: {
      label: 'Basis',
      values: CHARACTER_INSIGHT_BASES,
      valueLabels: {
        lived_experience: 'Lived experience',
        clinical_presentation: 'How it presents',
        character_craft: 'Character craft',
      },
      multi: false,
      required: true,
    },
    sensitivity: {
      label: 'Sensitivity',
      values: CHARACTER_INSIGHT_SENSITIVITIES,
      multi: false,
    },
  },
  attributes: {
    detail: {
      label: 'What it looks like',
      type: 'text',
      maxChars: 320,
      required: true,
      shown: true,
    },
    voiceSamples: {
      label: 'How it might sound',
      type: 'text[]',
      maxChars: 160,
      shown: true,
    },
    avoid: {
      label: 'Stereotype to avoid',
      type: 'text',
      maxChars: 200,
      shown: true,
    },
    handlingNote: {
      label: 'Handle with care',
      type: 'text',
      maxChars: 240,
      shown: true,
    },
  },
  extraction: {
    promptCode: 'context_library_extract_character_insights_system',
    maxCandidatesPerSegment: 12,
    criticChecks: [
      'identifiability',
      'stereotype',
      'clinical_plausibility',
      'treatment_protocol',
    ],
  },
  // Character material is dense with usable observations, so more survive per part than for
  // principles.
  densityCap: { perSegment: 1, min: 4, max: 150 },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) =>
    `${firstFacet(c, 'aspect')}: ${c.statement} ${String(c.attributes.detail ?? '')}`.trim(),
  situationsText: (c: ProfileChunkView) =>
    [
      firstFacet(c, 'aspect'),
      joinList(c.facets?.themes as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
      joinList(c.attributes.voiceSamples as string[] | undefined),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const head = [
      c.code,
      firstFacet(c, 'aspect'),
      firstFacet(c, 'basis'),
      band ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    const lines = [`[${head}] ${c.statement}`];
    const detail = String(c.attributes.detail ?? '').trim();
    if (detail) lines.push(`  Looks like: ${detail}`);
    const samples = Array.isArray(c.attributes.voiceSamples)
      ? (c.attributes.voiceSamples as unknown[]).map(String).filter(Boolean)
      : [];
    if (samples.length)
      lines.push(
        `  Might sound like: ${samples
          .slice(0, 2)
          .map((s) => `"${s}"`)
          .join(' / ')}`,
      );
    const avoid = String(c.attributes.avoid ?? '').trim();
    if (avoid) lines.push(`  Avoid: ${avoid}`);
    const care = String(c.attributes.handlingNote ?? '').trim();
    if (care) lines.push(`  Care: ${care}`);
    return lines.join('\n');
  },
};
