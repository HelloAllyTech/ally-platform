/**
 * The arithmetic of retrieval, kept pure so it is tested directly: reciprocal rank fusion
 * across retrievers, queries and collections; relevance bands; diversification; and the
 * bounded in-band prior.
 */

export type RetrieverName = 'bm25' | 'statement' | 'situations';

export interface RankedList {
  /** Which retriever (or collection) produced the list, for the per-signal log. */
  retriever: RetrieverName;
  collectionId: string;
  weight: number;
  ids: string[];
}

export interface FusedCandidate {
  id: string;
  collectionId: string;
  score: number;
  /** Best (lowest) rank each retriever gave it, across all queries. */
  ranks: Partial<Record<RetrieverName, number>>;
}

/** The constant in Σ 1/(k + rank). 60 is the usual choice; tuned by the learning loop. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion. Ranks are 1-based. Scores are comparable across retrievers and
 * collections because only ranks are used — which is why it is the fusion here: a BM25
 * score and a cosine similarity are not on the same scale, and neither are two indexes.
 */
export function rrfFuse(
  lists: RankedList[],
  k: number = RRF_K,
): FusedCandidate[] {
  const byId = new Map<string, FusedCandidate>();
  for (const list of lists) {
    list.ids.forEach((id, i) => {
      const rank = i + 1;
      const entry = byId.get(id) ?? {
        id,
        collectionId: list.collectionId,
        score: 0,
        ranks: {},
      };
      entry.score += list.weight / (k + rank);
      const prev = entry.ranks[list.retriever];
      if (prev === undefined || rank < prev) entry.ranks[list.retriever] = rank;
      byId.set(id, entry);
    });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

export type Band = 'strong' | 'good' | 'low';

/** Graded re-rank (0–3) to a band: 3 strong, 2 good, ≤1 low (dropped unless nothing else). */
export function bandForGrade(grade: number | undefined | null): Band {
  if (grade === 3) return 'strong';
  if (grade === 2) return 'good';
  return 'low';
}

/**
 * Bands when re-rank is off or failed. Without a calibrated grade, a candidate several
 * retrievers agree on is the best evidence of relevance there is: found by two or more →
 * good; by one → good only if it ranked in that retriever's top 5; otherwise low.
 */
export function bandFromAgreement(candidate: FusedCandidate): Band {
  const ranks = Object.values(candidate.ranks).filter(
    (r): r is number => typeof r === 'number',
  );
  if (ranks.length >= 2) return 'good';
  if (ranks.length === 1 && ranks[0] <= 5) return 'good';
  return 'low';
}

/** Word-set Jaccard similarity, the diversity measure for MMR (no extra embedding call). */
export function jaccard(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Maximal marginal relevance: pick, one at a time, the item that best balances relevance
 * against similarity to what is already picked. Stops five rewordings of one idea from
 * filling the list. `relevance` is normalised to 0–1 by the caller.
 */
export function mmrSelect<T>(
  items: T[],
  relevance: (item: T) => number,
  text: (item: T) => string,
  limit: number,
  lambda = 0.7,
): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < limit && pool.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    pool.forEach((item, i) => {
      const redundancy = picked.length
        ? Math.max(...picked.map((p) => jaccard(text(item), text(p))))
        : 0;
      const score = lambda * relevance(item) - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    });
    picked.push(pool.splice(bestIndex, 1)[0]);
  }
  return picked;
}

/**
 * The bounded usage prior: it can reorder near-ties within a band but never lift a chunk into
 * a higher band. `effectiveness` is 0–1 (null = no evidence yet = neutral 0.5).
 */
export function inBandBoost(
  score: number,
  effectiveness: number | null | undefined,
  sourceCount: number,
): number {
  const e = effectiveness ?? 0.5;
  return (
    score * (0.9 + 0.1 * e + 0.05 * Math.min(Math.max(sourceCount - 1, 0), 2))
  );
}

export const BAND_ORDER: Record<Band, number> = { strong: 0, good: 1, low: 2 };
