import { ClChunk } from 'src/context-library/entity/cl-chunk.entity';
import { AgentChunkHit } from 'src/context-library/service/context-agent-chunk.service';
import { Band } from 'src/context-library/util/fusion.util';

/**
 * Bug Hunter's memory is the Context Library's Bug Hunter Notes collection. These turn its
 * chunks back into the note shape the pipeline, the sweep prompt and the fix dossier have always
 * read: the note's text, its open tags and its repos.
 */

const BAND_SCORE: Record<Band, number> = { strong: 0.9, good: 0.7, low: 0.4 };

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];

/** The note's full text: the statement, or the whole body when a long note was clipped. */
export function noteText(chunk: Pick<ClChunk, 'statement' | 'body'>): string {
  return chunk.body?.trim() || chunk.statement;
}

export function noteTags(chunk: Pick<ClChunk, 'facets'>): string[] {
  return list(chunk.facets?.tags);
}

/** Null means platform-wide, as the notes always said it. */
export function noteRepos(chunk: Pick<ClChunk, 'facets'>): string[] | null {
  const repos = list(chunk.facets?.repos);
  return repos.length ? repos : null;
}

export function toNoteHit(hit: AgentChunkHit) {
  return {
    id: hit.chunk.id,
    code: hit.chunk.code,
    body: noteText(hit.chunk),
    tags: noteTags(hit.chunk),
    repos: noteRepos(hit.chunk),
    pinned: hit.chunk.pinned,
    band: hit.band,
    similarity: BAND_SCORE[hit.band] ?? 0,
  };
}
