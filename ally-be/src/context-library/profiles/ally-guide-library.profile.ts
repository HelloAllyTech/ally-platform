import {
  ClChunkOrigin,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/**
 * What an Ally Guide Library entry is. `material` is Ally's own, about becoming and being a
 * helper (helping skills, self-care, supervision, the work itself); `protocol` is an
 * organisation's own procedure — who to call, in what order, what to write down — which is what
 * organisations added to the Knowledge Base's library before it moved here.
 */
export const ALLY_GUIDE_ENTRY_KINDS = ['material', 'protocol'] as const;

/** An entry is a passage a learner may be shown, not a document. */
export const ALLY_GUIDE_STATEMENT_MAX_CHARS = 200;

/** The words a citation is written with, everywhere a card shows one. */
export function citationLine(c: ProfileChunkView): string {
  const cite = c.citation;
  if (!cite?.title) return '';
  const pages =
    cite.pageFrom && cite.pageFrom > 0
      ? cite.pageTo && cite.pageTo > cite.pageFrom
        ? `pp. ${cite.pageFrom}–${cite.pageTo}`
        : `p. ${cite.pageFrom}`
      : '';
  return [cite.title, cite.sectionPath ?? '', pages].filter(Boolean).join(', ');
}

/** The opening of a body, for the situations vector: enough to say what it is about. */
export function bodyOpening(body: string | null | undefined, words = 60) {
  return (body ?? '').split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}

/**
 * Ally's library: material on becoming and being a helper, and each organisation's own
 * protocols, which the Ally guide searches for a learner (PLAN.md §9.6). Replaces the Knowledge
 * Base's `ally_guide_library` corpus, whose passages were imported here word for word.
 *
 * The one collection organisations write to: an organisation's admins add entries only their own
 * learners' guide reads, and see Ally's global entries read-only. A written or imported entry's
 * `body` is shown and cited exactly as written; a distilled one (from an uploaded document)
 * carries its own short `detail` instead, since no document text is kept.
 */
export const ALLY_GUIDE_LIBRARY_PROFILE: CollectionProfile = {
  id: ClCollectionId.ALLY_GUIDE_LIBRARY,
  name: 'Ally Guide Library',
  purpose:
    'Material on becoming and being a helper — helping skills, self-care, supervision, the work ' +
    'itself — plus organisations’ own protocols. Its reader is Ally, a guide walking a learner ' +
    'through a course on mental-health helping skills; the query is Ally’s own search, usually ' +
    'prompted by something the learner asked. An entry is relevant when Ally could use it to ' +
    'answer or ground what the learner asked; one on the same topic that does not bear on the ' +
    'question is tangential.',
  noun: 'entry',
  nounPlural: 'entries',
  codePrefix: 'AG',
  allowedOrigins: [
    ClChunkOrigin.AUTHORED,
    ClChunkOrigin.IMPORTED,
    ClChunkOrigin.DISTILLED,
  ],
  allowsOrgChunks: true,
  // Learner-facing, and organisations' own protocols: never in engineers' editors.
  neverGrantTo: [ClUseCase.MCP_DEV],
  statementMaxChars: ALLY_GUIDE_STATEMENT_MAX_CHARS,
  facets: {
    kind: {
      label: 'Kind',
      values: ALLY_GUIDE_ENTRY_KINDS,
      valueLabels: { material: 'Material', protocol: 'Protocol' },
      multi: false,
    },
    // Free text, as the old library's document tags were: its curation was by tag, not by a
    // fixed list, and organisations name their own procedures.
    topic: { label: 'Topic', multi: true },
  },
  attributes: {
    detail: {
      label: 'What it says',
      type: 'text',
      maxChars: 600,
      shown: true,
    },
    // Information only. Clinical sign-off was dropped (PLAN.md §1, decision 8): a clinical entry
    // goes live through the same checks as any other, and the flag stays visible in the Library.
    clinical: { label: 'Clinical', type: 'bool', shown: true },
  },
  extraction: {
    promptCode: 'context_library_extract_ally_guide_library_system',
    maxCandidatesPerSegment: 8,
    criticChecks: ['identifiability'],
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
      joinList(c.facets?.topic as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
      bodyOpening(c.body),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const head = [c.code, firstFacet(c, 'kind'), band ?? '']
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
