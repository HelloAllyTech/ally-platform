import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ClCollection } from '../entity/cl-collection.entity';
import {
  ClLoop,
  ClLoopActionType,
  ClUseCase,
} from '../enum/context-library.enum';
import { RetrievalDefaults, requireProfile } from '../profiles';
import { RRF_K } from '../util/fusion.util';
import {
  ROLLBACK_PRECISION_DROP,
  ROLLBACK_WINDOW_DAYS,
  TUNING_MIN_DAYS_BETWEEN,
  TUNING_MIN_JUDGED_QUERIES,
  challengerWins,
  mean,
  ndcgAt,
  recallAt,
} from '../util/loops.util';
import { ContextLoopActionsService } from './context-loop-actions.service';
import { ContextRetrievalService } from './context-retrieval.service';

/** Holdout searches replayed per setup. Every replay costs three retriever calls (and a re-rank). */
const BENCHMARK_SIZE = 100;
/** Rollback needs at least this many judged, shown results on each side to compare. */
const ROLLBACK_MIN_JUDGED = 30;

export interface BenchmarkScore {
  ndcg: number;
  recall: number;
  queries: number;
}

interface HoldoutQuery {
  retrievalId: string;
  useCase: ClUseCase;
  queries: string[];
  audience: any;
  contextDescriptor: string | null;
  grades: Map<string, number>;
}

/**
 * Tuning and rollback. Weekly at most, a collection's live search setup is benchmarked against
 * one-change-at-a-time challengers on the holdout (judged searches the other loops never see),
 * and the best replaces it only if it is clearly better — nDCG@8 up by at least 0.02 and
 * Recall@50 not down — and only once there are 100 judged holdout searches to measure with.
 * Daily, a promotion that made live precision worse by 0.05 or more over three days is rolled
 * back on its own. Both are loop actions an admin can undo.
 *
 * Index versions (a new embedding model or index shape) are still built and switched by hand;
 * this tunes how the existing index is searched.
 */
@Injectable()
export class ContextTuningService {
  private readonly logger = LoggerService.getInstance(
    ContextTuningService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly retrieval: ContextRetrievalService,
    private readonly actions: ContextLoopActionsService,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
  ) {}

  liveSetup(collection: ClCollection): RetrievalDefaults {
    return (
      collection.activeSearchSetup ??
      requireProfile(collection.id).retrievalDefaults
    );
  }

  /** One change at a time from the live setup, so a promotion always has one explanation. */
  challengers(
    live: RetrievalDefaults,
  ): Array<{ name: string; setup: RetrievalDefaults }> {
    const w = live.weights;
    const k = live.rrfK ?? RRF_K;
    const out: Array<{ name: string; setup: RetrievalDefaults }> = [
      {
        name: 'more keyword weight',
        setup: { ...live, weights: { ...w, bm25: w.bm25 * 1.5 } },
      },
      {
        name: 'less keyword weight',
        setup: { ...live, weights: { ...w, bm25: w.bm25 * 0.6 } },
      },
      {
        name: 'more situations weight',
        setup: { ...live, weights: { ...w, situations: w.situations * 1.5 } },
      },
      {
        name: 'less situations weight',
        setup: { ...live, weights: { ...w, situations: w.situations * 0.6 } },
      },
      {
        name: 'less statement weight',
        setup: { ...live, weights: { ...w, statement: w.statement * 0.6 } },
      },
      {
        name: 'sharper fusion',
        setup: { ...live, rrfK: Math.max(10, Math.round(k / 2)) },
      },
      { name: 'flatter fusion', setup: { ...live, rrfK: k * 2 } },
      {
        name: 'more diversity',
        setup: { ...live, mmrLambda: Math.max(0.3, live.mmrLambda - 0.15) },
      },
      {
        name: 'less diversity',
        setup: { ...live, mmrLambda: Math.min(1, live.mmrLambda + 0.15) },
      },
      {
        name: live.rerank ? 're-rank off' : 're-rank on',
        setup: { ...live, rerank: !live.rerank },
      },
      {
        name: live.contextualise ? 'context off' : 'context on',
        setup: { ...live, contextualise: !live.contextualise },
      },
    ];
    return out;
  }

  async holdout(collectionId: string): Promise<HoldoutQuery[]> {
    const rows: Array<{
      retrieval_id: string;
      use_case: string;
      queries: string[];
      audience: any;
      context_descriptor: string | null;
      grades: Array<{ chunk_id: string; grade: number }>;
    }> = await this.dataSource.query(
      `SELECT r.id AS retrieval_id, r.use_case, r.queries, r.audience, r.context_descriptor,
              json_agg(json_build_object('chunk_id', j.chunk_id, 'grade', j.grade)) AS grades
       FROM cl_judgments j JOIN cl_retrievals r ON r.id = j.retrieval_id
       WHERE j.collection_id = $1 AND j.split = 'holdout' AND cardinality(r.queries) > 0
       GROUP BY r.id
       ORDER BY max(j."createdAt") DESC
       LIMIT $2`,
      [collectionId, BENCHMARK_SIZE],
    );
    return rows.map((r) => ({
      retrievalId: r.retrieval_id,
      useCase: r.use_case as ClUseCase,
      queries: r.queries,
      audience: r.audience,
      contextDescriptor: r.context_descriptor,
      grades: new Map(r.grades.map((g) => [g.chunk_id, Number(g.grade)])),
    }));
  }

  async benchmark(
    collectionId: string,
    setup: RetrievalDefaults,
    holdout: HoldoutQuery[],
  ): Promise<BenchmarkScore> {
    const ndcgs: number[] = [];
    const recalls: number[] = [];
    for (const q of holdout) {
      try {
        const res = await this.retrieval.search(
          {
            useCase: q.useCase,
            audience: q.audience,
            collections: [collectionId],
            queries: q.queries,
            contextDescriptor: q.contextDescriptor,
            limit: 8,
          },
          { replay: true, setupOverride: { [collectionId]: setup } },
        );
        ndcgs.push(
          ndcgAt(
            res.results.map((r) => r.chunk.id),
            q.grades,
            8,
          ),
        );
        const recall = recallAt(res.candidateIds ?? [], q.grades, 50);
        if (recall !== null) recalls.push(recall);
      } catch {
        // A replay that fails is left out of both setups' scores alike only if it fails for
        // both; one failing here is a real cost for this setup.
        ndcgs.push(0);
      }
    }
    return {
      ndcg: mean(ndcgs) ?? 0,
      recall: mean(recalls) ?? 0,
      queries: holdout.length,
    };
  }

  /** Weekly: benchmark challengers and promote a clear winner. */
  async tune(collectionId: string): Promise<boolean> {
    const collection = await this.collections.findOne({
      where: { id: collectionId },
    });
    if (!collection) return false;
    if (
      collection.setupPromotedAt &&
      Date.now() - +collection.setupPromotedAt <
        TUNING_MIN_DAYS_BETWEEN * 86_400_000
    )
      return false;
    const holdout = await this.holdout(collectionId);
    if (holdout.length < TUNING_MIN_JUDGED_QUERIES) return false;

    const live = this.liveSetup(collection);
    const liveScore = await this.benchmark(collectionId, live, holdout);
    let best: {
      name: string;
      setup: RetrievalDefaults;
      score: BenchmarkScore;
    } | null = null;
    const scores: Record<string, BenchmarkScore> = { live: liveScore };
    for (const challenger of this.challengers(live)) {
      const score = await this.benchmark(
        collectionId,
        challenger.setup,
        holdout,
      );
      scores[challenger.name] = score;
      if (
        challengerWins(liveScore, score) &&
        (!best || score.ndcg > best.score.ndcg)
      ) {
        best = { ...challenger, score };
      }
    }
    if (!best) {
      this.logger.debug(`Tuning ${collectionId}: live setup kept`);
      return false;
    }
    await this.collections.update(
      { id: collectionId },
      {
        previousSearchSetup: live,
        activeSearchSetup: best.setup,
        setupPromotedAt: new Date(),
      },
    );
    await this.actions.record({
      collectionId,
      loop: ClLoop.TUNING,
      action: ClLoopActionType.PROMOTE_SETUP,
      reason: `Search setup changed (${best.name}): holdout nDCG@8 ${liveScore.ndcg.toFixed(3)} → ${best.score.ndcg.toFixed(3)}, Recall@50 ${liveScore.recall.toFixed(3)} → ${best.score.recall.toFixed(3)} over ${holdout.length} judged searches`,
      before: { setup: live },
      after: { setup: best.setup },
      evidence: { scores },
    });
    return true;
  }

  /** Daily: undo a promotion that made live results worse. */
  async rollbackIfWorse(collectionId: string): Promise<boolean> {
    const collection = await this.collections.findOne({
      where: { id: collectionId },
    });
    if (!collection?.setupPromotedAt || !collection.previousSearchSetup)
      return false;
    const promotedAt = collection.setupPromotedAt;
    if (Date.now() - +promotedAt < ROLLBACK_WINDOW_DAYS * 86_400_000)
      return false;
    if (Date.now() - +promotedAt > 30 * 86_400_000) return false;

    const precision = async (from: string, to: string) => {
      const [row]: Array<{ n: string; useful: string }> =
        await this.dataSource.query(
          `SELECT count(*) AS n, count(*) FILTER (WHERE grade >= 2) AS useful
           FROM cl_judgments
           WHERE collection_id = $1 AND final_rank IS NOT NULL AND split = 'learn'
             AND "createdAt" >= $2 AND "createdAt" < $3`,
          [collectionId, from, to],
        );
      const n = Number(row?.n ?? 0);
      return { n, value: n ? Number(row.useful) / n : null };
    };
    const day = 86_400_000;
    const after = await precision(
      new Date(Date.now() - ROLLBACK_WINDOW_DAYS * day).toISOString(),
      new Date().toISOString(),
    );
    const before = await precision(
      new Date(+promotedAt - 14 * day).toISOString(),
      promotedAt.toISOString(),
    );
    if (
      after.n < ROLLBACK_MIN_JUDGED ||
      before.n < ROLLBACK_MIN_JUDGED ||
      after.value === null ||
      before.value === null ||
      before.value - after.value < ROLLBACK_PRECISION_DROP
    )
      return false;

    const current = this.liveSetup(collection);
    await this.collections.update(
      { id: collectionId },
      {
        activeSearchSetup: collection.previousSearchSetup,
        previousSearchSetup: null,
        setupPromotedAt: new Date(),
      },
    );
    await this.actions.record({
      collectionId,
      loop: ClLoop.ROLLBACK,
      action: ClLoopActionType.ROLLBACK_SETUP,
      reason: `Search setup rolled back: live precision fell from ${(before.value * 100).toFixed(0)}% to ${(after.value * 100).toFixed(0)}% after the last change`,
      before: { setup: current },
      after: { setup: collection.previousSearchSetup },
      evidence: { before, after },
    });
    return true;
  }
}
