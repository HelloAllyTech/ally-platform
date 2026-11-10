import { KnowledgeChunkPassage } from 'src/ai/dto/knowledge.dto';
import { KbRetrievalOutcome } from '../enum/knowledge-base.enum';

/** What shaping did to one candidate, and why. */
export interface ShapingDecision {
  passage: KnowledgeChunkPassage;
  outcome: KbRetrievalOutcome;
}

/**
 * Shape a raw similarity ranking into the passages a grounded answer should actually see.
 *
 * Vector search ranks each chunk independently, which is exactly what makes its top-k a poor
 * context window: the chunks are 400 tokens with a deliberate 60-token overlap
 * (KB_CHUNK_OVERLAP_TOKENS — overlap exists so a thought that straddles a boundary survives in
 * both neighbours), so two adjacent chunks are near-guaranteed to score alike and to repeat each
 * other's best sentences. Left alone, a top-8 routinely spends half its budget re-reading one
 * page of one document. "When to apply memory and knowledge compression": repetitive or
 * duplicate items in a store reduce retrieval efficiency — the same is true of a result set, and
 * a result set can be de-duplicated at no indexing cost.
 *
 * Two rules, applied in rank order so the highest-similarity passage always survives:
 *  - span overlap: drop a passage whose character span overlaps one already kept from the same
 *    document. This targets the overlap the chunker put there, not merely equal text.
 *  - per-document cap: no single document may supply more than `perDocumentLimit` passages.
 *
 * The cap is a breadth guarantee: an answer grounded entirely in one document is that
 * document's view, and two or three sources is what a considered answer looks like. It costs
 * recall on the genuine case where one source is the only source.
 *
 * Returns the survivors (`kept`) and a verdict on every candidate it was given (`decisions`).
 * The retrieval log records the dropped candidates as well as the survivors, because the drops
 * are where the diagnostic value is. A corpus whose shaping constantly fires
 * DROPPED_SPAN_OVERLAP is a corpus whose chunk profile is cutting mid-thought; one constantly
 * firing DROPPED_DOCUMENT_CAP has one document answering everything. Neither is visible from
 * the survivors alone — the results look fine, because they are the ones that looked fine.
 * One walk produces both, so the log can never describe a shaping the caller didn't get.
 */
export function shapeWithDecisions(
  passages: KnowledgeChunkPassage[],
  options: { limit: number; perDocumentLimit: number },
): { kept: KnowledgeChunkPassage[]; decisions: ShapingDecision[] } {
  const kept: KnowledgeChunkPassage[] = [];
  const decisions: ShapingDecision[] = [];
  const spansByDocument = new Map<string, { start: number; end: number }[]>();

  for (const passage of passages) {
    if (kept.length >= options.limit) {
      // Not "rejected" — simply ranked below the cut once the survivors above it were
      // counted. Recorded distinctly so a short result set is never confused with a
      // strict one.
      decisions.push({
        passage,
        outcome: KbRetrievalOutcome.DROPPED_OVER_LIMIT,
      });
      continue;
    }
    const spans = spansByDocument.get(passage.document_id) ?? [];
    if (spans.length >= options.perDocumentLimit) {
      decisions.push({
        passage,
        outcome: KbRetrievalOutcome.DROPPED_DOCUMENT_CAP,
      });
      continue;
    }
    if (spans.some((span) => overlaps(span, passage))) {
      decisions.push({
        passage,
        outcome: KbRetrievalOutcome.DROPPED_SPAN_OVERLAP,
      });
      continue;
    }
    spans.push({ start: passage.char_start, end: passage.char_end });
    spansByDocument.set(passage.document_id, spans);
    kept.push(passage);
    decisions.push({ passage, outcome: KbRetrievalOutcome.RETURNED });
  }

  return { kept, decisions };
}

/**
 * Half-open span intersection. Touching spans (`end === start`) are adjacent, not overlapping:
 * a document chunked without overlap produces exactly that, and dropping the neighbour there
 * would discard a passage sharing no text at all.
 */
function overlaps(
  span: { start: number; end: number },
  passage: KnowledgeChunkPassage,
): boolean {
  return passage.char_start < span.end && span.start < passage.char_end;
}
