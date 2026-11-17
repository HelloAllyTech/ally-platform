import { PmCardKind, PmCardSize, PmRiskLevel } from '../enum/pm-agent.enum';
import {
  PmCandidate,
  PmEvidenceRef,
  PmRankedCandidate,
} from '../pipeline/pm-pipeline.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const EFFORT: Record<string, number> = {
  [PmCardSize.S]: 1,
  [PmCardSize.M]: 1.6,
};
const RISK: Record<string, number> = {
  [PmRiskLevel.LOW]: 1,
  [PmRiskLevel.MEDIUM]: 0.9,
  [PmRiskLevel.HIGH]: 0.75,
};
/** No category may take more than this share of the slots (rounded up). */
const MAX_CATEGORY_SHARE = 0.6;
/** Each card already chosen in a category multiplies the next one's score by this. */
const DIVERSITY_DECAY = 0.5;

export interface PmRankInput {
  candidates: PmCandidate[];
  runEvidence: ReadonlyMap<string, PmEvidenceRef>;
  /** category → effective weight (mandate × learned), 0..∞; missing = 1. */
  categoryWeights: Record<string, number>;
  slots: number;
  /** Max questions among the chosen (Infinity when memory is still thin). */
  maxQuestions: number;
  now: Date;
}

/** Evidence strength 0.2..1: distinct sources and items, discounted for age. */
export function evidenceStrength(
  candidate: PmCandidate,
  runEvidence: ReadonlyMap<string, PmEvidenceRef>,
  now: Date,
): { strength: number; freshness: Date | null } {
  const ids: string[] = Array.isArray(candidate.payload?.evidenceIds)
    ? candidate.payload.evidenceIds
    : [];
  const refs = ids
    .map((id) => runEvidence.get(id))
    .filter((ref): ref is PmEvidenceRef => Boolean(ref));
  if (!refs.length) return { strength: 0.2, freshness: null };
  const sources = new Set(refs.map((ref) => ref.source)).size;
  const oldest = refs.reduce(
    (min, ref) => (ref.fetchedAt < min ? ref.fetchedAt : min),
    refs[0].fetchedAt,
  );
  const breadth =
    Math.min(1, sources / 3) * 0.6 + Math.min(1, refs.length / 4) * 0.4;
  const ageDays = Math.max(0, (now.getTime() - oldest.getTime()) / DAY_MS);
  return {
    strength: Math.max(0.2, breadth * (ageDays > 7 ? 0.8 : 1)),
    freshness: oldest,
  };
}

/** impact × evidence strength ÷ effort, before diversity. Deterministic. */
export function baseScore(
  candidate: PmCandidate,
  input: Pick<PmRankInput, 'runEvidence' | 'categoryWeights' | 'now'>,
): { score: number; freshness: Date | null } {
  const weight = input.categoryWeights[candidate.category] ?? 1;
  if (candidate.kind === PmCardKind.QUESTION) {
    // A question that unblocks a candidate outranks a free-standing one.
    return {
      score: weight * (candidate.unblocks ? 0.9 : 0.6),
      freshness: null,
    };
  }
  const p = candidate.payload ?? {};
  const impact =
    weight * (RISK[p.risk] ?? 0.8) * (p.impactMetric?.name ? 1 : 0.7);
  const { strength, freshness } = evidenceStrength(
    candidate,
    input.runEvidence,
    input.now,
  );
  return { score: (impact * strength) / (EFFORT[p.size] ?? 2), freshness };
}

/**
 * The ranker (plan §5): score, then pick greedily with category diversity — each card already
 * chosen in a category halves the next one's score, and no category may take more than 60% of
 * the slots (rounded up: 3 of 5) — so a run never fills the feed with five of one kind. Questions are
 * capped by `maxQuestions`. Ties break on input order, so the result is stable.
 */
export function rankCandidates(input: PmRankInput): PmRankedCandidate[] {
  const scored = input.candidates.map((candidate, order) => ({
    candidate,
    order,
    ...baseScore(candidate, input),
  }));
  const perCategoryCap = Math.max(
    1,
    Math.ceil(input.slots * MAX_CATEGORY_SHARE),
  );
  const chosen: PmRankedCandidate[] = [];
  const perCategory = new Map<string, number>();
  let questions = 0;
  const pool = [...scored];
  while (chosen.length < input.slots && pool.length) {
    let best = -1;
    let bestScore = -Infinity;
    pool.forEach((item, index) => {
      const used = perCategory.get(item.candidate.category) ?? 0;
      if (used >= perCategoryCap) return;
      if (
        item.candidate.kind === PmCardKind.QUESTION &&
        questions >= input.maxQuestions
      ) {
        return;
      }
      const score = item.score * Math.pow(DIVERSITY_DECAY, used);
      if (
        score > bestScore ||
        (score === bestScore && best >= 0 && item.order < pool[best].order)
      ) {
        best = index;
        bestScore = score;
      }
    });
    if (best < 0) break;
    const [item] = pool.splice(best, 1);
    perCategory.set(
      item.candidate.category,
      (perCategory.get(item.candidate.category) ?? 0) + 1,
    );
    if (item.candidate.kind === PmCardKind.QUESTION) questions += 1;
    chosen.push({
      ...item.candidate,
      rank: Number(bestScore.toFixed(6)),
      evidenceFreshness: item.freshness,
    });
  }
  return chosen;
}
